/**
 * insight-view.js — Persona Walk Insight ranking page.
 *
 * - Loads aggregated metrics from /api/insight (one row per result file).
 * - Lets user pick personas (multi-select with search).
 * - Renders one big sortable table; toggleable columns.
 * - For each selected metric column we display a per-row rank (1, 2, 3 ...)
 *   computed across the currently selected personas, ascending (lower = better).
 */

(() => {
    const METRICS = [
        { key: 'total_steps',      label: 'Steps',        color: 'var(--col-steps)',    fmt: v => v.toFixed(0)  },
        { key: 'total_distance_m', label: 'Distance (m)', color: 'var(--col-distance)', fmt: v => v.toFixed(1)  },
        { key: 'rest_count',       label: 'Rest count',   color: 'var(--col-rest)',     fmt: v => v.toFixed(0)  },
        { key: 'sum_heat',         label: 'Σ Heat',       color: 'var(--col-heat)',     fmt: v => v.toFixed(2)  },
        { key: 'sum_fatigue',      label: 'Σ Fatigue',    color: 'var(--col-fatigue)',  fmt: v => v.toFixed(2)  },
    ];

    const SURVEY_FIELDS = [
        'Q2_gender', 'Q3_stamina', 'Q4_activity', 'Q5_familiarity',
        'Q6_heat_sensitivity', 'Q7_noticing', 'Q8_env_preference',
        'Q9_time_pressure', 'Q10_detour_openness',
    ];

    const state = {
        rows: [],                  // all rows from /api/insight
        filter: '',                // search filter for picker
        selected: new Set(),       // filenames currently checked
        visibleCols: new Set(METRICS.map(m => m.key)),  // metric columns to show
        sortKey: 'total_steps',    // column being sorted
        sortDir: 'asc',            // 'asc' | 'desc'
        surveyFilters: {},         // { Q2_gender: 'Male', ... } — non-empty values only
        ageMin: null,              // null = no lower bound
        ageMax: null,              // null = no upper bound
        view: 'podium',            // 'podium' | 'map'
    };

    // ---------- DOM refs ----------
    const elList     = document.getElementById('persona-list');
    const elSearch   = document.getElementById('picker-search');
    const elCount    = document.getElementById('picker-count');
    const elTheadRow = document.getElementById('insight-thead-row');
    const elTbody    = document.getElementById('insight-tbody');
    const elStatus   = document.getElementById('status-text');
    const elPodium   = document.getElementById('insight-podium');
    const elPodiumSub    = document.getElementById('podium-sub');
    const elPodiumLegend = document.getElementById('podium-legend');

    // ---------- helpers ----------
    function statusMsg(msg, isError) {
        elStatus.textContent = msg || '';
        elStatus.style.color = isError ? 'var(--danger)' : 'var(--text-muted)';
    }

    function rowMatchesSurveyFilter(r) {
        const s = r.survey || {};
        // Age range
        const age = s.Q1_age;
        if (state.ageMin != null && (age == null || age < state.ageMin)) return false;
        if (state.ageMax != null && (age == null || age > state.ageMax)) return false;
        // Categorical filters
        for (const [key, val] of Object.entries(state.surveyFilters)) {
            if (!val) continue;
            if ((s[key] ?? '') !== val) return false;
        }
        return true;
    }

    function visiblePersonaRows() {
        const q = state.filter.trim().toLowerCase();
        return state.rows.filter(r => {
            if (!rowMatchesSurveyFilter(r)) return false;
            if (!q) return true;
            return (
                (r.persona_id || '').toLowerCase().includes(q) ||
                (r.filename   || '').toLowerCase().includes(q) ||
                (r.provider   || '').toLowerCase().includes(q)
            );
        });
    }

    function selectedRows() {
        return state.rows.filter(r => state.selected.has(r.filename));
    }

    // Compute ranks (1..N) for one metric across the given rows. Lower = better
    // (ties share a rank — standard "1224" competition ranking).
    function computeRanks(rows, metricKey) {
        const sorted = [...rows].sort((a, b) => (a[metricKey] - b[metricKey]));
        const ranks = new Map();
        let lastVal = null;
        let lastRank = 0;
        sorted.forEach((r, i) => {
            const v = r[metricKey];
            if (v === lastVal) {
                ranks.set(r.filename, lastRank);
            } else {
                lastRank = i + 1;
                lastVal = v;
                ranks.set(r.filename, lastRank);
            }
        });
        return ranks;
    }

    // Top-3 ("podium") get the bold solid-color treatment; 4+ get the
    // light-tint treatment. (See .insight-table .rank-cell.top in style.css.)
    function rankBadgeClass(rank) {
        return rank <= 3 ? 'top' : '';
    }

    // ---------- rendering: persona picker ----------
    function renderPicker() {
        const rows = visiblePersonaRows();
        if (rows.length === 0) {
            elList.innerHTML = '<div class="insight-empty" style="padding:24px;">No personas match.</div>';
        } else {
            const html = rows.map(r => {
                const checked = state.selected.has(r.filename) ? 'checked' : '';
                return `
                    <label class="persona-row">
                        <input type="checkbox" data-fn="${r.filename}" ${checked}>
                        <span style="flex:1;min-width:0;">
                            <div class="pid">${r.persona_id || '(unknown)'}</div>
                            <div class="meta">${r.provider} · ${r.outcome}</div>
                        </span>
                    </label>
                `;
            }).join('');
            elList.innerHTML = html;
            elList.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                cb.addEventListener('change', e => {
                    const fn = e.target.dataset.fn;
                    if (e.target.checked) state.selected.add(fn);
                    else state.selected.delete(fn);
                    updateCount();
                    renderTable();
                });
            });
        }
        updateCount();
    }

    function updateCount() {
        elCount.textContent = `${state.selected.size} / ${state.rows.length} selected`;
    }

    // ---------- rendering: ranking table ----------
    function renderTable() {
        // Header
        const visibleMetrics = METRICS.filter(m => state.visibleCols.has(m.key));
        const arrow = (key) => {
            if (state.sortKey !== key) return '';
            return `<span class="sort-arrow">${state.sortDir === 'asc' ? '▲' : '▼'}</span>`;
        };
        let head = `
            <th data-sort="persona_id">Persona ${arrow('persona_id')}</th>
            <th data-sort="provider">Provider ${arrow('provider')}</th>
            <th data-sort="outcome">Outcome ${arrow('outcome')}</th>
        `;
        visibleMetrics.forEach(m => {
            head += `<th data-sort="${m.key}" data-col="${m.key}" style="--col-color:${m.color};">`
                  + `<span class="col-dot"></span>${m.label}`
                  + `<span class="rank-badge">RANK</span> ${arrow(m.key)}</th>`;
        });
        elTheadRow.innerHTML = head;
        elTheadRow.querySelectorAll('th').forEach(th => {
            th.addEventListener('click', () => {
                const key = th.dataset.sort;
                if (state.sortKey === key) {
                    state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
                } else {
                    state.sortKey = key;
                    state.sortDir = 'asc';
                }
                renderTable();
            });
        });

        // Body
        const rows = selectedRows();
        if (rows.length === 0) {
            const span = 3 + visibleMetrics.length;
            elTbody.innerHTML = `<tr><td colspan="${span}"><div class="insight-empty">Select personas on the left to populate the ranking table.</div></td></tr>`;
            return;
        }

        // Compute ranks for each visible metric column (lower = better).
        const rankByMetric = {};
        visibleMetrics.forEach(m => {
            rankByMetric[m.key] = computeRanks(rows, m.key);
        });

        // Sort rows
        const sortKey = state.sortKey;
        const dir = state.sortDir === 'asc' ? 1 : -1;
        const sorted = [...rows].sort((a, b) => {
            const va = a[sortKey];
            const vb = b[sortKey];
            if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
            return String(va || '').localeCompare(String(vb || '')) * dir;
        });

        const outcomeBadge = (o) => {
            const cls = o === 'reached_goal' ? 'badge-fresh' : 'badge-tired';
            return `<span class="badge ${cls}">${o || '-'}</span>`;
        };

        const html = sorted.map(r => {
            let tds = `
                <td><strong>${r.persona_id || '(unknown)'}</strong></td>
                <td>${r.provider || ''}</td>
                <td>${outcomeBadge(r.outcome)}</td>
            `;
            visibleMetrics.forEach(m => {
                const rank = rankByMetric[m.key].get(r.filename);
                const cls = rankBadgeClass(rank);
                tds += `<td style="--col-color:${m.color};">`
                     + `<span class="rank-cell ${cls}">#${rank}</span>`
                     + `${m.fmt(r[m.key])}</td>`;
            });
            return `<tr>${tds}</tr>`;
        }).join('');
        elTbody.innerHTML = html;

        renderPodium();
    }

    // ---------- Podium chart (top-3 personas, grouped bars per metric) ----------
    //
    // - "Top 3" is determined by the column the user is currently sorting by
    //   (state.sortKey). If that key is not a metric, fall back to the first
    //   visible metric, or total_steps.
    // - For each top-3 persona we draw one group of bars: one bar per visible
    //   metric column, colored by the metric's --col-color.
    // - Bar height is INVERSE rank within the selected pool: rank 1 = full
    //   height, rank N = ~0. This way "tall = good" matches the podium metaphor.
    // - Layout order is podium style: #2 left, #1 center, #3 right.
    function renderPodium() {
        const rows = selectedRows();
        const visibleMetrics = METRICS.filter(m => state.visibleCols.has(m.key));

        // Choose the metric that defines the podium ranking.
        let sortMetric = METRICS.find(m => m.key === state.sortKey);
        if (!sortMetric) sortMetric = visibleMetrics[0] || METRICS[0];

        // Legend = clickable column-visibility toggles (merged with old
        // "Show columns" row). Every metric appears; click to add / remove
        // it from state.visibleCols.
        elPodiumLegend.innerHTML = METRICS.map(m => {
            const active = state.visibleCols.has(m.key);
            return `<button type="button" class="lg-item ${active ? 'is-active' : 'is-inactive'}" `
                 + `data-col="${m.key}" style="--col-color:${m.color};" `
                 + `title="${active ? 'Hide' : 'Show'} ${m.label} column">`
                 + `<span class="lg-swatch"></span>${m.label}</button>`;
        }).join('');

        if (rows.length === 0 || visibleMetrics.length === 0) {
            elPodiumSub.textContent = 'Select personas and at least one metric column to see the podium.';
            elPodium.innerHTML = '<div class="podium-empty">Nothing to plot yet.</div>';
            return;
        }

        // Top-3 by sortMetric (ascending — lower is better).
        const sortedBySortMetric = [...rows].sort((a, b) => a[sortMetric.key] - b[sortMetric.key]);
        const top3 = sortedBySortMetric.slice(0, Math.min(3, sortedBySortMetric.length));

        // Podium ordering: 2nd left, 1st middle, 3rd right.
        const podium = [];
        if (top3[1]) podium.push({ podiumRank: 2, persona: top3[1] });
        if (top3[0]) podium.push({ podiumRank: 1, persona: top3[0] });
        if (top3[2]) podium.push({ podiumRank: 3, persona: top3[2] });

        // Per-metric ranks across the full selected pool — drives bar heights.
        const ranksByMetric = {};
        visibleMetrics.forEach(m => {
            ranksByMetric[m.key] = computeRanks(rows, m.key);
        });

        elPodiumSub.innerHTML = `Top 3 by <strong>${sortMetric.label}</strong> · bar height = inverse rank within ${rows.length} selected personas.`;

        // SVG geometry.
        const W = 900;
        const H = 340;
        const pad = { top: 50, right: 24, bottom: 70, left: 24 };
        const innerW = W - pad.left - pad.right;
        const innerH = H - pad.top - pad.bottom;
        const groupW = innerW / podium.length;
        const N = rows.length;
        const barGap = 6;
        const groupInnerPad = 24;
        const barW = Math.max(10, (groupW - groupInnerPad - barGap * (visibleMetrics.length - 1)) / visibleMetrics.length);
        const baselineY = pad.top + innerH;

        let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Top 3 personas podium">`;
        svg += `<line x1="${pad.left}" y1="${baselineY}" x2="${W - pad.right}" y2="${baselineY}" stroke="currentColor" stroke-opacity="0.35" stroke-width="1"/>`;

        podium.forEach((entry, gi) => {
            const groupCx = pad.left + groupW * (gi + 0.5);
            const totalBarsW = barW * visibleMetrics.length + barGap * (visibleMetrics.length - 1);
            const groupLeft = groupCx - totalBarsW / 2;

            visibleMetrics.forEach((m, bi) => {
                const x = groupLeft + bi * (barW + barGap);
                const persRank = ranksByMetric[m.key].get(entry.persona.filename);
                // Inverse-rank height: rank 1 → 1.0, rank N → 1/N.
                const heightRatio = (N - persRank + 1) / N;
                const h = Math.max(6, innerH * heightRatio);
                const y = baselineY - h;
                const isTop3 = persRank <= 3;
                const opacity = isTop3 ? 1 : 0.32;

                svg += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" `
                     + `width="${barW.toFixed(1)}" height="${h.toFixed(1)}" `
                     + `rx="4" style="fill:${m.color};opacity:${opacity};"/>`;

                // Rank label above the bar.
                svg += `<text x="${(x + barW/2).toFixed(1)}" y="${(y - 18).toFixed(1)}" `
                     + `text-anchor="middle" font-size="10" font-weight="700" `
                     + `style="fill:${m.color};">#${persRank}</text>`;

                // Value above the bar.
                svg += `<text x="${(x + barW/2).toFixed(1)}" y="${(y - 5).toFixed(1)}" `
                     + `text-anchor="middle" font-size="11" font-weight="600" fill="currentColor">`
                     + `${m.fmt(entry.persona[m.key])}</text>`;
            });

            // Persona name below the group.
            const isWinner = entry.podiumRank === 1;
            svg += `<text x="${groupCx.toFixed(1)}" y="${(baselineY + 22).toFixed(1)}" `
                 + `text-anchor="middle" font-size="${isWinner ? 15 : 13}" font-weight="700" fill="currentColor">`
                 + `${escapeXml(entry.persona.persona_id || '(unknown)')}</text>`;

            // Podium rank chip below name.
            const chipOpacity = entry.podiumRank === 1 ? '1'
                              : entry.podiumRank === 2 ? '0.78'
                              : '0.62';
            svg += `<text x="${groupCx.toFixed(1)}" y="${(baselineY + 42).toFixed(1)}" `
                 + `text-anchor="middle" font-size="11" font-weight="600" fill="currentColor" fill-opacity="${chipOpacity}">`
                 + `#${entry.podiumRank} by ${escapeXml(sortMetric.label)}</text>`;
        });

        svg += `</svg>`;
        elPodium.innerHTML = svg;
    }

    function escapeXml(s) {
        return String(s).replace(/[<>&"']/g, c => ({
            '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'
        }[c]));
    }

    // ---------- event wiring ----------
    elSearch.addEventListener('input', e => {
        state.filter = e.target.value;
        renderPicker();
    });

    document.getElementById('btn-select-all').addEventListener('click', () => {
        state.rows.forEach(r => state.selected.add(r.filename));
        renderPicker();
        renderTable();
    });
    document.getElementById('btn-select-none').addEventListener('click', () => {
        state.selected.clear();
        renderPicker();
        renderTable();
    });
    document.getElementById('btn-select-visible').addEventListener('click', () => {
        visiblePersonaRows().forEach(r => state.selected.add(r.filename));
        renderPicker();
        renderTable();
    });

    // Column visibility is now controlled from the podium legend chips.
    // Use event delegation so the listener survives re-renders of the legend.
    elPodiumLegend.addEventListener('click', (ev) => {
        const btn = ev.target.closest('.lg-item[data-col]');
        if (!btn) return;
        const key = btn.dataset.col;
        if (state.visibleCols.has(key)) state.visibleCols.delete(key);
        else state.visibleCols.add(key);
        // If the sort key got hidden, fall back to the first visible metric.
        if (!state.visibleCols.has(state.sortKey)
            && !['persona_id', 'provider', 'outcome'].includes(state.sortKey)) {
            const firstVisible = METRICS.find(m => state.visibleCols.has(m.key));
            state.sortKey = firstVisible ? firstVisible.key : 'persona_id';
        }
        renderTable();   // re-renders both the table and the podium (incl. legend)
    });

    document.getElementById('btn-refresh').addEventListener('click', loadData);

    // ---------- Survey filter ----------
    function populateFilterDropdowns(rows) {
        // For each Qx field, gather unique non-empty values across all rows and
        // build <option>s. Sort alphabetically for predictable order.
        SURVEY_FIELDS.forEach(qKey => {
            const sel = document.querySelector(`.filter-field select[data-q="${qKey}"]`);
            if (!sel) return;
            const values = new Set();
            rows.forEach(r => {
                const v = r.survey && r.survey[qKey];
                if (v != null && v !== '') values.add(String(v));
            });
            const sorted = [...values].sort((a, b) => a.localeCompare(b));
            const prev = state.surveyFilters[qKey] || '';
            sel.innerHTML = '<option value="">Any</option>' +
                sorted.map(v => `<option value="${v}">${v}</option>`).join('');
            if (prev && values.has(prev)) sel.value = prev;
        });
    }

    function syncFilterActiveStates() {
        SURVEY_FIELDS.forEach(qKey => {
            const sel = document.querySelector(`.filter-field select[data-q="${qKey}"]`);
            if (!sel) return;
            sel.parentElement.classList.toggle('active', !!sel.value);
        });
        document.querySelector('.filter-field-age')
            ?.classList.toggle('active', state.ageMin != null || state.ageMax != null);
    }

    // Wire up survey filter selects
    document.querySelectorAll('.filter-field select[data-q]').forEach(sel => {
        sel.addEventListener('change', () => {
            const key = sel.dataset.q;
            if (sel.value) state.surveyFilters[key] = sel.value;
            else delete state.surveyFilters[key];
            syncFilterActiveStates();
            renderPicker();
        });
    });

    // Age range inputs
    const elAgeMin = document.getElementById('f-age-min');
    const elAgeMax = document.getElementById('f-age-max');
    function onAgeChange() {
        const lo = elAgeMin.value === '' ? null : Number(elAgeMin.value);
        const hi = elAgeMax.value === '' ? null : Number(elAgeMax.value);
        state.ageMin = Number.isFinite(lo) ? lo : null;
        state.ageMax = Number.isFinite(hi) ? hi : null;
        syncFilterActiveStates();
        renderPicker();
    }
    elAgeMin?.addEventListener('input', onAgeChange);
    elAgeMax?.addEventListener('input', onAgeChange);

    // Reset button
    document.getElementById('btn-filter-reset')?.addEventListener('click', (ev) => {
        ev.preventDefault();  // don't toggle the <details>
        ev.stopPropagation();
        state.surveyFilters = {};
        state.ageMin = null;
        state.ageMax = null;
        document.querySelectorAll('.filter-field select[data-q]').forEach(s => { s.value = ''; });
        if (elAgeMin) elAgeMin.value = '';
        if (elAgeMax) elAgeMax.value = '';
        syncFilterActiveStates();
        renderPicker();
    });

    // ---------- Podium / Map tab switching ----------
    const viewPanes = {
        podium: document.getElementById('view-podium'),
        map:    document.getElementById('view-map'),
    };
    document.querySelectorAll('.view-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const v = tab.dataset.view;
            if (!viewPanes[v] || state.view === v) return;
            state.view = v;
            document.querySelectorAll('.view-tab').forEach(t => {
                t.classList.toggle('active', t.dataset.view === v);
            });
            Object.entries(viewPanes).forEach(([k, el]) => {
                el.hidden = (k !== v);
            });
            if (v === 'map') renderMap();
        });
    });

    // ---------- Map view: overlay selected personas' paths ----------
    let mapInitialized = false;
    const resultCache = {};

    async function ensureMapInit() {
        if (mapInitialized) return true;
        try {
            const graph = await DataLoader.loadGraph();
            // Render into the insight page's graph container (different id from
            // map.html / playback.html, so it gets its own renderer instance).
            GraphRenderer.init('insight-graph-container', graph);
            mapInitialized = true;
            return true;
        } catch (e) {
            const sub = document.getElementById('map-sub');
            if (sub) sub.textContent = `Failed to load graph: ${e.message}`;
            return false;
        }
    }

    async function loadResultCached(filename) {
        if (!resultCache[filename]) {
            resultCache[filename] = await DataLoader.loadResult(filename);
        }
        return resultCache[filename];
    }

    async function renderMap() {
        const ok = await ensureMapInit();
        if (!ok) return;
        GraphRenderer.clearPaths();
        const rows = selectedRows();
        const sub = document.getElementById('map-sub');
        if (rows.length === 0) {
            if (sub) sub.textContent = 'Select personas on the left to draw their walked paths.';
            return;
        }
        // Single tinted color, low opacity → overlap density shows where many
        // personas walked (additive on the canvas).
        const color = 'rgba(9,132,227,0.28)';
        let drawn = 0;
        for (const r of rows) {
            try {
                const result = await loadResultCached(r.filename);
                if (!result.path || result.path.length < 2) continue;
                GraphRenderer.highlightPath(result.path, color, null, 5);
                drawn++;
            } catch (e) {
                console.warn(`Failed to load ${r.filename}:`, e);
            }
        }
        if (sub) sub.textContent = `Overlaid paths from ${drawn} / ${rows.length} selected persona${rows.length === 1 ? '' : 's'}.`;
    }

    // When selection changes (via picker), refresh map if it's the active view.
    const _origRenderTable = renderTable;
    renderTable = function patchedRenderTable() {  // eslint-disable-line no-func-assign
        _origRenderTable();
        if (state.view === 'map') renderMap();
    };

    // ---------- bootstrap ----------
    async function loadData() {
        statusMsg('Loading...');
        try {
            const resp = await fetch('api/insight.json');
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const rows = await resp.json();
            state.rows = rows;
            // Pre-select up to 8 personas so the table isn't empty on first load.
            if (state.selected.size === 0) {
                rows.slice(0, Math.min(8, rows.length)).forEach(r => state.selected.add(r.filename));
            }
            populateFilterDropdowns(rows);
            syncFilterActiveStates();
            renderPicker();
            renderTable();
            statusMsg(`${rows.length} runs loaded`);
        } catch (e) {
            statusMsg(`Failed to load: ${e.message}`, true);
            elList.innerHTML = `<div class="insight-empty" style="padding:24px;color:var(--danger);">${e.message}</div>`;
        }
    }

    loadData();
})();
