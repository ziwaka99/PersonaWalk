/**
 * playback-view.js — playback page (square 1:1 map layout).
 *
 * Layout:
 *   LEFT  : frameless info strip (persona + body state)
 *           square 1:1 map (with adjustable basemap + floating reasoning panel)
 *           playback controls
 *   RIGHT : route-thumbnail gallery (image-only) + "Download combined" button
 *             + polar-area rose chart of average element composition
 *           multi-select environment bar charts with labels rendered as HTML
 *             around a stretching SVG plot so fonts stay a constant size;
 *             per-metric custom Y-axis min/max/intervals saved to localStorage
 *           Fatigue + Heat Load folded into the same selectable timeline stack
 *
 * Env + segmentation values per step come from the edge walked that step.
 * Rest steps carry the previous value forward; no route thumbnail emitted.
 */

(async () => {
    // ---------- DOM ----------
    const resultSelect    = document.getElementById('result-select');
    const statusText      = document.getElementById('status-text');
    const personaCard     = document.getElementById('persona-card');
    const stateLine       = document.getElementById('state-line');
    const stepSlider      = document.getElementById('step-slider');
    const stepIndicator   = document.getElementById('step-indicator');
    const btnPlay         = document.getElementById('btn-play');
    const btnPrev         = document.getElementById('btn-prev');
    const btnNext         = document.getElementById('btn-next');
    const speedSelect     = document.getElementById('speed-select');
    const envCheckboxes   = document.getElementById('env-checkboxes');
    const envChartsStack  = document.getElementById('env-charts-stack');
    const envSubtitle     = document.getElementById('env-subtitle');

    // Routes gallery (single-image playback mode)
    const routeCurrentWrap      = document.getElementById('route-current-wrap');
    const routeImageLayer       = document.getElementById('route-image-layer');
    const routeCurrentCaption   = document.getElementById('route-current-caption');
    const routeImgIndex         = document.getElementById('route-img-index');
    const btnRoutePrev          = document.getElementById('btn-route-prev');
    const btnRouteNext          = document.getElementById('btn-route-next');
    const routesGallerySubtitle = document.getElementById('routes-gallery-subtitle');
    const segRoseBlock          = document.getElementById('seg-rose-block');
    const segRoseTitle          = document.getElementById('seg-rose-title');
    const segRoseCanvas         = document.getElementById('seg-rose-chart');
    const btnDownloadRoutes     = document.getElementById('btn-download-routes');
    const btnPrintSegBar        = document.getElementById('btn-print-seg-bar');

    // Chart size controls (env)
    const ctlCw = document.getElementById('ctl-cw');
    const ctlCh = document.getElementById('ctl-ch');
    const valCw = document.getElementById('val-cw');
    const valCh = document.getElementById('val-ch');

    // Body chart size controls
    const ctlBcw = document.getElementById('ctl-bcw');
    const ctlBch = document.getElementById('ctl-bch');
    const valBcw = document.getElementById('val-bcw');
    const valBch = document.getElementById('val-bch');
    const bodyChartWrap = document.getElementById('body-chart-wrap');

    // Panel reorder
    const playbackRight = document.getElementById('playback-right');

    // Basemap
    const basemapImg       = document.getElementById('basemap-img');
    const mapPortrait      = document.getElementById('map-portrait');
    const chkBasemap       = document.getElementById('chk-basemap');
    const btnBasemapPanel  = document.getElementById('btn-basemap-panel');
    const btnToggleReasoning = document.getElementById('btn-toggle-reasoning');
    const btnBasemapClose  = document.getElementById('btn-basemap-close');
    const btnBasemapReset  = document.getElementById('btn-basemap-reset');
    const btnBasemapSave   = document.getElementById('btn-basemap-save');
    const btnBasemapClear  = document.getElementById('btn-basemap-clear');
    const basemapPanel     = document.getElementById('basemap-panel');
    const ctlOx = document.getElementById('ctl-ox');
    const ctlOy = document.getElementById('ctl-oy');
    const ctlSc = document.getElementById('ctl-sc');
    const ctlRt = document.getElementById('ctl-rt');
    const ctlOp = document.getElementById('ctl-op');
    const ctlUrl = document.getElementById('ctl-url');
    const ctlFile = document.getElementById('ctl-file');
    const valOx = document.getElementById('val-ox');
    const valOy = document.getElementById('val-oy');
    const valSc = document.getElementById('val-sc');
    const valRt = document.getElementById('val-rt');
    const valOp = document.getElementById('val-op');

    // Reasoning: floating draggable bubble overlaid on the rendered view.
    const reasoningBubble     = document.getElementById('reasoning-bubble');
    const reasoningBubbleHead = document.getElementById('reasoning-bubble-head');
    const reasoningBubbleClose= document.getElementById('reasoning-bubble-close');
    const reasoningPanelBody  = document.getElementById('reasoning-panel-body');
    let reasoningVisible = false;

    // ---------- Constants ----------
    const FATIGUE_BANDS  = [0.25, 0.50, 0.75];
    const FATIGUE_LABELS = ['fresh', 'warming up', 'tired', 'exhausted'];
    const HEAT_BANDS     = [0.25, 0.50, 0.75];
    const HEAT_LABELS    = ['comfortable', 'warm', 'hot', 'overheating'];
    const BADGE_MAP = {
        'fresh': 'badge-fresh', 'warming up': 'badge-warming',
        'tired': 'badge-tired', 'exhausted': 'badge-exhausted',
        'comfortable': 'badge-comfortable', 'warm': 'badge-warm',
        'hot': 'badge-hot', 'overheating': 'badge-overheating',
    };

    const ENVIRONMENT_METRICS = ['Sky exposure', 'Windspeed', 'MRT', 'UTCI', 'PET'];
    const BODY_METRICS = ['Fatigue', 'Heat Load'];
    const BODY_COMBINED_METRIC = 'Fatigue & Heat Load';
    const ENV_METRICS = [...ENVIRONMENT_METRICS, BODY_COMBINED_METRIC];
    const ENV_UNITS = {
        'Sky exposure': '',
        'Windspeed':    'm/s',
        'MRT':          '°C',
        'UTCI':         '°C',
        'PET':          '°C',
        [BODY_COMBINED_METRIC]: '',
    };
    const ENV_Y_AXIS_LABEL = {
        'Sky exposure': 'Sky exposure (0–1)',
        'Windspeed':    'Wind speed (m/s)',
        'MRT':          'MRT (°C)',
        'UTCI':         'UTCI (°C)',
        'PET':          'PET (°C)',
        [BODY_COMBINED_METRIC]: 'Load (0–1)',
    };

    const SEG_KEYS  = ['Sky', 'Greenery', 'Topo', 'Building', 'Pavement'];
    const SEG_COLORS = {
        'Sky':      '#7fcfe0',
        'Greenery': '#00b894',
        'Topo':     '#a68b5b',
        'Building': '#636e72',
        'Pavement': '#b2bec3',
    };
    const DEFAULT_BODY_COLORS = {
        'Fatigue': '#e17055',
        'Heat Load': '#d63031',
    };
    // Export-only size for the Average element composition print PNG.
    // Change these numbers to adjust the downloaded image dimensions without
    // changing the on-page chart size.
    const SEG_PRINT_SIZE = {
        width: 2600,
        height: 1800,
        preserveAspect: true,
        legendFontSize: 56,
        labelFontSize: 56,
        labelLineWidth: 5,
        padding: 128,
    };
    const SEG_BAR_PRINT_SIZE = {
        width: 425,
        height: 2200,
        paddingLeft: 0,
        paddingRight: 0,
        paddingY: 0,
        axisWidth: 5,
        labelFontSize: 86,
        categoryFontSize: 78,
        tickFontSize: 58,
        barWidth: 425,
    };

    // Thermal color ramps (match real-map page).
    const UTCI_COLORS = [
        { lim: -Infinity, color: '#2e9fbf' },
        { lim: 9,  color: '#7fcfe0' },
        { lim: 26, color: '#ffe97a' },
        { lim: 32, color: '#ffb45a' },
        { lim: 38, color: '#e8603a' },
        { lim: 46, color: '#b53423' },
    ];
    const PET_COLORS = [
        { lim: -Infinity, color: '#2e9fbf' },
        { lim: 18, color: '#7fcfe0' },
        { lim: 23, color: '#ffe97a' },
        { lim: 29, color: '#ffb45a' },
        { lim: 35, color: '#e8603a' },
        { lim: 41, color: '#b53423' },
    ];

    // ---------- Basemap state (mirrors realmap-view.js) ----------
    const DEFAULT_BASEMAP_URL =
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map' +
        '/MapServer/tile/17/66100/105116';
    const BASEMAP_STORAGE_KEY = 'playback.basemap.v1';
    const CHART_SIZE_KEY = 'playback.chart_size.v1';

    const defaultBasemap = {
        url: DEFAULT_BASEMAP_URL,
        offsetX: 0,
        offsetY: 0,
        scale: 2.5,
        rotation: 0,
        opacity: 0.65,
        visible: true,
    };
    let basemapState = loadBasemapState();
    let basemapLoaded = false;

    function loadBasemapState() {
        try {
            const raw = localStorage.getItem(BASEMAP_STORAGE_KEY);
            if (raw) return { ...defaultBasemap, ...JSON.parse(raw) };
        } catch { /* ignore */ }
        return { ...defaultBasemap };
    }
    function saveBasemapState() {
        localStorage.setItem(BASEMAP_STORAGE_KEY, JSON.stringify(basemapState));
    }
    // Quiet auto-save: swallow quota errors so dragging sliders never throws.
    // The explicit "Save" button still calls saveBasemapState() directly so it
    // can surface the failure (e.g. when a too-large image is in basemapState.url).
    function autoSaveBasemapState() {
        try { saveBasemapState(); } catch { /* ignore quota errors */ }
    }

    // ---------- Chart size state ----------
    const defaultChartSize = { widthPct: 100, heightPx: 110 };
    let chartSize = loadChartSize();

    function loadChartSize() {
        try {
            const raw = localStorage.getItem(CHART_SIZE_KEY);
            if (raw) return { ...defaultChartSize, ...JSON.parse(raw) };
        } catch { /* ignore */ }
        return { ...defaultChartSize };
    }
    function saveChartSize() {
        try { localStorage.setItem(CHART_SIZE_KEY, JSON.stringify(chartSize)); } catch {}
    }
    function applyChartSize() {
        envChartsStack.style.setProperty('--chart-width',  chartSize.widthPct + '%');
        envChartsStack.style.setProperty('--chart-height', chartSize.heightPx + 'px');
        valCw.textContent = chartSize.widthPct + '%';
        valCh.textContent = chartSize.heightPx;
    }

    ctlCw.value = chartSize.widthPct;
    ctlCh.value = chartSize.heightPx;
    applyChartSize();
    ctlCw.addEventListener('input', () => {
        chartSize.widthPct = +ctlCw.value;
        applyChartSize();
        saveChartSize();
    });
    ctlCh.addEventListener('input', () => {
        chartSize.heightPx = +ctlCh.value;
        applyChartSize();
        saveChartSize();
    });

    // ---------- Body chart size state ----------
    // Declared here (hoisted above usage) so applyBodyChartSize can safely
    // reference it before initBodyChart() creates the actual Chart instance.
    let bodyChart = null;
    const BODY_CHART_SIZE_KEY = 'playback.body_chart_size.v1';
    const defaultBodyChartSize = { widthPct: 100, heightPx: 180 };
    let bodyChartSize = loadBodyChartSize();

    function loadBodyChartSize() {
        try {
            const raw = localStorage.getItem(BODY_CHART_SIZE_KEY);
            if (raw) return { ...defaultBodyChartSize, ...JSON.parse(raw) };
        } catch { /* ignore */ }
        return { ...defaultBodyChartSize };
    }
    function saveBodyChartSize() {
        try { localStorage.setItem(BODY_CHART_SIZE_KEY, JSON.stringify(bodyChartSize)); } catch {}
    }
    function applyBodyChartSize() {
        if (bodyChartWrap) {
            bodyChartWrap.style.setProperty('--body-chart-width',  bodyChartSize.widthPct + '%');
            bodyChartWrap.style.setProperty('--body-chart-height', bodyChartSize.heightPx + 'px');
        }
        valBcw.textContent = bodyChartSize.widthPct + '%';
        valBch.textContent = bodyChartSize.heightPx;
        // Notify Chart.js of the wrapper size change
        if (bodyChart) { try { bodyChart.resize(); } catch {} }
    }

    ctlBcw.value = bodyChartSize.widthPct;
    ctlBch.value = bodyChartSize.heightPx;
    applyBodyChartSize();
    ctlBcw.addEventListener('input', () => {
        bodyChartSize.widthPct = +ctlBcw.value;
        applyBodyChartSize();
        saveBodyChartSize();
    });
    ctlBch.addEventListener('input', () => {
        bodyChartSize.heightPx = +ctlBch.value;
        applyBodyChartSize();
        saveBodyChartSize();
    });

    // ---------- Panel order ----------
    const PANEL_ORDER_KEY = 'playback.panel_order.v1';
    const defaultPanelOrder = ['routes', 'env'];
    function loadPanelOrder() {
        try {
            const raw = localStorage.getItem(PANEL_ORDER_KEY);
            if (raw) {
                const arr = JSON.parse(raw);
                if (Array.isArray(arr) && arr.length === defaultPanelOrder.length) {
                    // validate members
                    const ok = defaultPanelOrder.every(k => arr.includes(k));
                    if (ok) return arr;
                }
            }
        } catch { /* ignore */ }
        return [...defaultPanelOrder];
    }
    let panelOrder = loadPanelOrder();
    function savePanelOrder() {
        try { localStorage.setItem(PANEL_ORDER_KEY, JSON.stringify(panelOrder)); } catch {}
    }
    function applyPanelOrder() {
        panelOrder.forEach(key => {
            const el = playbackRight.querySelector(`[data-panel-key="${key}"]`);
            if (el) playbackRight.appendChild(el);
        });
        // Disable up/down on ends
        playbackRight.querySelectorAll('.panel-move-up, .panel-move-dn').forEach(btn => {
            const key = btn.dataset.panelKey;
            const idx = panelOrder.indexOf(key);
            if (btn.classList.contains('panel-move-up')) {
                btn.disabled = (idx <= 0);
            } else {
                btn.disabled = (idx === -1 || idx >= panelOrder.length - 1);
            }
        });
    }
    function movePanel(key, dir) {
        const idx = panelOrder.indexOf(key);
        if (idx === -1) return;
        const ni = idx + dir;
        if (ni < 0 || ni >= panelOrder.length) return;
        const tmp = panelOrder[idx];
        panelOrder[idx] = panelOrder[ni];
        panelOrder[ni] = tmp;
        savePanelOrder();
        applyPanelOrder();
    }
    applyPanelOrder();
    playbackRight.querySelectorAll('.panel-move-up').forEach(btn => {
        btn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            movePanel(btn.dataset.panelKey, -1);
        });
    });
    playbackRight.querySelectorAll('.panel-move-dn').forEach(btn => {
        btn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            movePanel(btn.dataset.panelKey, +1);
        });
    });

    // ---------- Custom Y-axis ranges/intervals per metric (persisted) ----------
    const AXIS_RANGES_KEY = 'playback.axis_ranges.v1';
    let axisRanges = loadAxisRanges();  // { "Sky exposure": {min: 0, max: 1, intervals: 4}, ... }

    function loadAxisRanges() {
        try {
            const raw = localStorage.getItem(AXIS_RANGES_KEY);
            if (raw) return JSON.parse(raw) || {};
        } catch { /* ignore */ }
        return {};
    }
    function saveAxisRanges() {
        try { localStorage.setItem(AXIS_RANGES_KEY, JSON.stringify(axisRanges)); } catch {}
    }

    // ---------- Per-metric color overrides for env charts (persisted) ----------
    const METRIC_COLORS_KEY = 'playback.metric_colors.v1';
    let metricColors = loadMetricColors();  // { "Sky exposure": "#1e88e5", ... }
    function loadMetricColors() {
        try {
            const raw = localStorage.getItem(METRIC_COLORS_KEY);
            if (raw) return JSON.parse(raw) || {};
        } catch { /* ignore */ }
        return {};
    }
    function saveMetricColors() {
        try { localStorage.setItem(METRIC_COLORS_KEY, JSON.stringify(metricColors)); } catch {}
    }

    // ---------- Body chart axis/color overrides (persisted) ----------
    const BODY_AXIS_KEY = 'playback.body_axis.v1';
    let bodyAxisSettings = loadBodyAxisSettings();
    function loadBodyAxisSettings() {
        try {
            const raw = localStorage.getItem(BODY_AXIS_KEY);
            if (raw) return JSON.parse(raw) || {};
        } catch { /* ignore */ }
        return {};
    }
    function saveBodyAxisSettings() {
        try { localStorage.setItem(BODY_AXIS_KEY, JSON.stringify(bodyAxisSettings)); } catch {}
    }
    function getBodyMetricSetting(metric) {
        return bodyAxisSettings[metric] || {};
    }
    function getBodyMetricColor(metric) {
        return getBodyMetricSetting(metric).color || DEFAULT_BODY_COLORS[metric] || '#0984e3';
    }
    function hexToRgba(hex, alpha) {
        const [r, g, b] = hex2rgb(hex);
        return `rgba(${r},${g},${b},${alpha})`;
    }
    function getBodyAxisConfig(fatigueData = [], heatData = []) {
        const all = [...fatigueData, ...heatData].filter(v => v != null && !Number.isNaN(v));
        const [autoLo, autoHi] = computeExtents(all);
        const customMins = [];
        const customMaxs = [];
        let lo = Math.min(0, autoLo);
        let hi = Math.max(1, autoHi);
        let intervalCount = 4;

        BODY_METRICS.forEach(metric => {
            const cur = getBodyMetricSetting(metric);
            if (cur.min != null && Number.isFinite(cur.min)) customMins.push(cur.min);
            if (cur.max != null && Number.isFinite(cur.max)) customMaxs.push(cur.max);
            const n = parseInt(cur.intervals, 10);
            if (Number.isFinite(n)) intervalCount = Math.max(intervalCount, Math.max(1, Math.min(12, n)));
        });
        if (customMins.length) lo = Math.min(...customMins);
        if (customMaxs.length) hi = Math.max(...customMaxs);
        if (hi <= lo) hi = lo + 1;
        return { lo, hi, intervalCount };
    }

    // ---------- Env chart type toggle (bar | line), persisted ----------
    const ENV_CHART_TYPE_KEY = 'playback.env_chart_type.v1';
    let envChartType = (() => {
        try { return localStorage.getItem(ENV_CHART_TYPE_KEY) || 'bar'; }
        catch { return 'bar'; }
    })();
    function saveEnvChartType() {
        try { localStorage.setItem(ENV_CHART_TYPE_KEY, envChartType); } catch {}
    }

    // ---------- Per-slice color overrides for segmentation pie (persisted) ----------
    const SEG_COLORS_KEY = 'playback.seg_colors.v1';
    let segColorOverrides = (() => {
        try { return JSON.parse(localStorage.getItem(SEG_COLORS_KEY) || '{}') || {}; }
        catch { return {}; }
    })();
    function saveSegColors() {
        try { localStorage.setItem(SEG_COLORS_KEY, JSON.stringify(segColorOverrides)); } catch {}
    }
    function effectiveSegColor(key) {
        return segColorOverrides[key] || SEG_COLORS[key];
    }
    function getAxisRange(metric, values) {
        const sourceValues = metric === BODY_COMBINED_METRIC
            ? [...(envSeries['Fatigue'] || []), ...(envSeries['Heat Load'] || [])]
            : values;
        const [autoLo, autoHi] = computeExtents(sourceValues);
        const autoBaseline = autoLo >= 0 ? 0 : autoLo;
        const custom = axisRanges[metric] || {};
        const lo = (custom.min != null && Number.isFinite(custom.min)) ? custom.min : autoBaseline;
        let hi = (custom.max != null && Number.isFinite(custom.max)) ? custom.max : autoHi;
        if (hi <= lo) hi = lo + 1;  // guard against bad user input
        return [lo, hi];
    }
    function getAxisIntervalCount(metric) {
        const custom = axisRanges[metric] || {};
        const n = parseInt(custom.intervals, 10);
        if (Number.isFinite(n)) return Math.max(1, Math.min(12, n));
        return 3;
    }
    function makeTickVals(lo, hi, intervalCount) {
        const n = Math.max(1, intervalCount || 3);
        const ticks = [];
        for (let i = 0; i <= n; i++) {
            ticks.push(lo + (hi - lo) * (i / n));
        }
        return ticks;
    }

    const envAxisRows = document.getElementById('env-axis-rows');
    // Fallback color used in the picker when the user hasn't set one yet.
    // (The chart still uses the gradient/thermal scheme until a color is picked.)
    const DEFAULT_PICKER_COLOR = {
        'Sky exposure': '#7fcfe0',
        'Windspeed':    '#00b894',
        'MRT':          '#e8603a',
        'UTCI':         '#d63031',
        'PET':          '#a55eea',
        [BODY_COMBINED_METRIC]: '#e17055',
    };
    function buildAxisConfigUI() {
        const hdr = `
            <div class="hdr label">Metric</div>
            <div class="hdr">Y min</div>
            <div class="hdr">Y max</div>
            <div class="hdr">Intervals</div>
            <div class="hdr">Color</div>
            <div class="hdr"></div>`;
        const rows = ENV_METRICS.map(m => {
            const cur = axisRanges[m] || {};
            const unit = ENV_UNITS[m] ? ` (${ENV_UNITS[m]})` : '';
            const minVal = (cur.min != null) ? cur.min : '';
            const maxVal = (cur.max != null) ? cur.max : '';
            const intervalVal = (cur.intervals != null) ? cur.intervals : '';
            const colorVal = metricColors[m] || DEFAULT_PICKER_COLOR[m] || '#0984e3';
            const colorSet = !!metricColors[m];
            return `
                <div class="label">${m}${unit}</div>
                <input type="number" step="0.1" class="axis-min" data-metric="${m}"
                       placeholder="auto" value="${minVal}">
                <input type="number" step="0.1" class="axis-max" data-metric="${m}"
                       placeholder="auto" value="${maxVal}">
                <input type="number" min="1" max="12" step="1" class="axis-interval"
                       data-metric="${m}" placeholder="3" value="${intervalVal}">
                <span class="metric-color-cell">
                    <input type="color" class="metric-color" data-metric="${m}"
                           value="${colorVal}" title="Override color (overrides default gradient)">
                    <span class="metric-color-status${colorSet ? ' on' : ''}"
                          data-metric="${m}" title="${colorSet ? 'Custom color set' : 'Using default'}">${colorSet ? 'custom' : 'auto'}</span>
                </span>
                <button class="reset-btn" data-metric="${m}" title="Reset to auto">reset</button>
            `;
        }).join('');
        envAxisRows.innerHTML = hdr + rows;

        envAxisRows.querySelectorAll('input.axis-min, input.axis-max, input.axis-interval').forEach(inp => {
            inp.addEventListener('change', () => {
                const m = inp.dataset.metric;
                const field = inp.classList.contains('axis-min')
                    ? 'min'
                    : inp.classList.contains('axis-max') ? 'max' : 'intervals';
                const val = inp.value.trim();
                axisRanges[m] = axisRanges[m] || {};
                if (val === '' || !Number.isFinite(+val)) {
                    delete axisRanges[m][field];
                } else if (field === 'intervals') {
                    axisRanges[m][field] = Math.max(1, Math.min(12, parseInt(val, 10)));
                    inp.value = axisRanges[m][field];
                } else {
                    axisRanges[m][field] = +val;
                }
                if (!Object.keys(axisRanges[m]).length) delete axisRanges[m];
                saveAxisRanges();
                refreshEnvCharts();
            });
        });
        envAxisRows.querySelectorAll('input.metric-color').forEach(inp => {
            inp.addEventListener('input', () => {
                const m = inp.dataset.metric;
                metricColors[m] = inp.value;
                saveMetricColors();
                const status = envAxisRows.querySelector(`.metric-color-status[data-metric="${m}"]`);
                if (status) { status.classList.add('on'); status.textContent = 'custom'; status.title = 'Custom color set'; }
                refreshEnvCharts();
            });
        });
        envAxisRows.querySelectorAll('button.reset-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const m = btn.dataset.metric;
                delete axisRanges[m];
                delete metricColors[m];
                saveAxisRanges();
                saveMetricColors();
                envAxisRows.querySelectorAll(`input.axis-min[data-metric="${m}"], input.axis-max[data-metric="${m}"], input.axis-interval[data-metric="${m}"]`)
                    .forEach(i => { i.value = ''; });
                const colorInp = envAxisRows.querySelector(`input.metric-color[data-metric="${m}"]`);
                if (colorInp) colorInp.value = DEFAULT_PICKER_COLOR[m] || '#0984e3';
                const status = envAxisRows.querySelector(`.metric-color-status[data-metric="${m}"]`);
                if (status) { status.classList.remove('on'); status.textContent = 'auto'; status.title = 'Using default'; }
                refreshEnvCharts();
            });
        });
    }
    buildAxisConfigUI();

    const bodyAxisRows = document.getElementById('body-axis-rows');
    function buildBodyAxisConfigUI() {
        if (!bodyAxisRows) return;
        const hdr = `
            <div class="hdr label">Metric</div>
            <div class="hdr">Y min</div>
            <div class="hdr">Y max</div>
            <div class="hdr">Intervals</div>
            <div class="hdr">Color</div>
            <div class="hdr"></div>`;
        const rows = BODY_METRICS.map(m => {
            const cur = getBodyMetricSetting(m);
            const minVal = (cur.min != null) ? cur.min : '';
            const maxVal = (cur.max != null) ? cur.max : '';
            const intervalVal = (cur.intervals != null) ? cur.intervals : '';
            const colorVal = cur.color || DEFAULT_BODY_COLORS[m] || '#0984e3';
            const colorSet = !!cur.color;
            return `
                <div class="label">${m}</div>
                <input type="number" step="0.05" class="body-axis-min" data-metric="${m}"
                       placeholder="auto" value="${minVal}">
                <input type="number" step="0.05" class="body-axis-max" data-metric="${m}"
                       placeholder="auto" value="${maxVal}">
                <input type="number" min="1" max="12" step="1" class="body-axis-interval"
                       data-metric="${m}" placeholder="4" value="${intervalVal}">
                <span class="metric-color-cell">
                    <input type="color" class="body-metric-color" data-metric="${m}"
                           value="${colorVal}" title="Override color">
                    <span class="metric-color-status${colorSet ? ' on' : ''}"
                          data-metric="${m}" title="${colorSet ? 'Custom color set' : 'Using default'}">${colorSet ? 'custom' : 'auto'}</span>
                </span>
                <button class="reset-btn" data-metric="${m}" title="Reset to auto">reset</button>
            `;
        }).join('');
        bodyAxisRows.innerHTML = hdr + rows;

        bodyAxisRows.querySelectorAll('input.body-axis-min, input.body-axis-max, input.body-axis-interval').forEach(inp => {
            inp.addEventListener('change', () => {
                const m = inp.dataset.metric;
                const field = inp.classList.contains('body-axis-min')
                    ? 'min'
                    : inp.classList.contains('body-axis-max') ? 'max' : 'intervals';
                const val = inp.value.trim();
                bodyAxisSettings[m] = bodyAxisSettings[m] || {};
                if (val === '' || !Number.isFinite(+val)) {
                    delete bodyAxisSettings[m][field];
                } else if (field === 'intervals') {
                    bodyAxisSettings[m][field] = Math.max(1, Math.min(12, parseInt(val, 10)));
                    inp.value = bodyAxisSettings[m][field];
                } else {
                    bodyAxisSettings[m][field] = +val;
                }
                if (!Object.keys(bodyAxisSettings[m]).length) delete bodyAxisSettings[m];
                saveBodyAxisSettings();
                applyBodyChartSettings();
            });
        });
        bodyAxisRows.querySelectorAll('input.body-metric-color').forEach(inp => {
            inp.addEventListener('input', () => {
                const m = inp.dataset.metric;
                bodyAxisSettings[m] = bodyAxisSettings[m] || {};
                bodyAxisSettings[m].color = inp.value;
                saveBodyAxisSettings();
                const status = bodyAxisRows.querySelector(`.metric-color-status[data-metric="${m}"]`);
                if (status) { status.classList.add('on'); status.textContent = 'custom'; status.title = 'Custom color set'; }
                applyBodyChartSettings();
            });
        });
        bodyAxisRows.querySelectorAll('button.reset-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const m = btn.dataset.metric;
                delete bodyAxisSettings[m];
                saveBodyAxisSettings();
                bodyAxisRows.querySelectorAll(`input.body-axis-min[data-metric="${m}"], input.body-axis-max[data-metric="${m}"], input.body-axis-interval[data-metric="${m}"]`)
                    .forEach(i => { i.value = ''; });
                const colorInp = bodyAxisRows.querySelector(`input.body-metric-color[data-metric="${m}"]`);
                if (colorInp) colorInp.value = DEFAULT_BODY_COLORS[m] || '#0984e3';
                const status = bodyAxisRows.querySelector(`.metric-color-status[data-metric="${m}"]`);
                if (status) { status.classList.remove('on'); status.textContent = 'auto'; status.title = 'Using default'; }
                applyBodyChartSettings();
            });
        });
    }
    buildBodyAxisConfigUI();

    // ---------- Env line-chart width (only used when chart type = line) ----------
    const ENV_LINE_WIDTH_KEY = 'playback.env_line_width.v1';
    const DEFAULT_ENV_LINE_WIDTH = 1.6;
    let envLineWidth = (() => {
        try {
            const v = parseFloat(localStorage.getItem(ENV_LINE_WIDTH_KEY));
            if (Number.isFinite(v) && v > 0) return v;
        } catch { /* ignore */ }
        return DEFAULT_ENV_LINE_WIDTH;
    })();
    function saveEnvLineWidth() {
        try { localStorage.setItem(ENV_LINE_WIDTH_KEY, String(envLineWidth)); } catch {}
    }
    const ctlLw = document.getElementById('ctl-lw');
    const valLw = document.getElementById('val-lw');
    const envLwControl = document.getElementById('env-lw-control');
    function syncLineWidthControl() {
        if (envLwControl) envLwControl.hidden = (envChartType !== 'line');
        if (ctlLw) ctlLw.value = envLineWidth;
        if (valLw) valLw.textContent = Number(envLineWidth).toFixed(1);
    }
    if (ctlLw) {
        ctlLw.addEventListener('input', () => {
            const v = parseFloat(ctlLw.value);
            if (!Number.isFinite(v) || v <= 0) return;
            envLineWidth = v;
            if (valLw) valLw.textContent = v.toFixed(1);
            saveEnvLineWidth();
            refreshEnvCharts();
        });
    }

    // ---------- Env chart-type (bar / line) toggle ----------
    const envChartTypeSwitch = document.getElementById('env-chart-type-switch');
    function syncChartTypeButtons() {
        if (!envChartTypeSwitch) return;
        envChartTypeSwitch.querySelectorAll('.env-ct-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.type === envChartType);
        });
    }
    syncChartTypeButtons();
    syncLineWidthControl();
    if (envChartTypeSwitch) {
        envChartTypeSwitch.querySelectorAll('.env-ct-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const t = btn.dataset.type;
                if (t !== 'bar' && t !== 'line') return;
                if (t === envChartType) return;
                envChartType = t;
                saveEnvChartType();
                syncChartTypeButtons();
                syncLineWidthControl();
                refreshEnvCharts();
            });
        });
    }

    // ---------- Segmentation pie: per-slice color pickers ----------
    const segColorPickers = document.getElementById('seg-color-pickers');
    function buildSegColorPickers() {
        if (!segColorPickers) return;
        segColorPickers.innerHTML = SEG_KEYS.map(k => {
            const cur = effectiveSegColor(k);
            const isCustom = !!segColorOverrides[k];
            return `
                <span class="seg-color-row" data-key="${k}">
                    <input type="color" class="seg-color-input" data-key="${k}" value="${cur}"
                           title="Color for ${k}">
                    <span class="seg-color-label">${k}</span>
                    <button type="button" class="seg-color-reset" data-key="${k}"
                            title="Reset to default"${isCustom ? '' : ' hidden'}>↺</button>
                </span>`;
        }).join('');
        segColorPickers.querySelectorAll('input.seg-color-input').forEach(inp => {
            inp.addEventListener('input', () => {
                const k = inp.dataset.key;
                segColorOverrides[k] = inp.value;
                saveSegColors();
                const reset = segColorPickers.querySelector(`.seg-color-reset[data-key="${k}"]`);
                if (reset) reset.hidden = false;
                renderSegRose();
            });
        });
        segColorPickers.querySelectorAll('button.seg-color-reset').forEach(btn => {
            btn.addEventListener('click', () => {
                const k = btn.dataset.key;
                delete segColorOverrides[k];
                saveSegColors();
                const inp = segColorPickers.querySelector(`input.seg-color-input[data-key="${k}"]`);
                if (inp) inp.value = SEG_COLORS[k];
                btn.hidden = true;
                renderSegRose();
            });
        });
    }
    buildSegColorPickers();

    // ---------- State ----------
    let graphData = null;
    let currentResult = null;
    let currentStep = 0;
    let isPlaying = false;
    let playTimer = null;
    // bodyChart declared earlier (needed by applyBodyChartSize before state block)
    let roseChart = null;
    let selectedEnvMetrics = new Set(ENV_METRICS);
    let envSeries = {};         // { metric: [per-step value] }
    let routeSteps = [];        // [{step, walkIdx, route, dir, source, target, seg}]

    // ---------- Init graph ----------
    try {
        graphData = await DataLoader.loadGraph();
        GraphRenderer.init('graph-container', graphData);
    } catch (e) {
        statusText.textContent = `Error: ${e.message}`;
        return;
    }

    // ---------- Basemap: paint under graph via beforeDrawing hook ----------
    basemapImg.addEventListener('load',  () => { basemapLoaded = true;  GraphRenderer.redraw(); });
    basemapImg.addEventListener('error', () => { basemapLoaded = false; GraphRenderer.redraw(); });

    GraphRenderer.onBeforeDraw((ctx) => {
        if (!basemapState.visible || !basemapLoaded) return;
        if (!basemapImg.naturalWidth || !basemapImg.naturalHeight) return;
        ctx.save();
        ctx.globalAlpha = basemapState.opacity;
        ctx.translate(basemapState.offsetX, basemapState.offsetY);
        if (basemapState.rotation) ctx.rotate(basemapState.rotation * Math.PI / 180);
        ctx.scale(basemapState.scale, basemapState.scale);
        const w = basemapImg.naturalWidth;
        const h = basemapImg.naturalHeight;
        ctx.drawImage(basemapImg, -w / 2, -h / 2);
        ctx.restore();
    });

    function applyBasemap() {
        const url = basemapState.url || '';
        if (url && basemapImg.src !== url) {
            basemapLoaded = false;
            basemapImg.src = url;
        } else if (!url) {
            basemapLoaded = false;
        }
        GraphRenderer.redraw();
    }

    function syncBasemapControls() {
        ctlOx.value = basemapState.offsetX;   valOx.textContent = basemapState.offsetX;
        ctlOy.value = basemapState.offsetY;   valOy.textContent = basemapState.offsetY;
        ctlSc.value = basemapState.scale;     valSc.textContent = Number(basemapState.scale).toFixed(2);
        ctlRt.value = basemapState.rotation;  valRt.textContent = basemapState.rotation;
        ctlOp.value = basemapState.opacity;   valOp.textContent = Number(basemapState.opacity).toFixed(2);
        ctlUrl.value = basemapState.url;
        chkBasemap.checked = basemapState.visible;
    }
    syncBasemapControls();
    applyBasemap();

    ctlOx.addEventListener('input', () => { basemapState.offsetX = +ctlOx.value; valOx.textContent = ctlOx.value; applyBasemap(); autoSaveBasemapState(); });
    ctlOy.addEventListener('input', () => { basemapState.offsetY = +ctlOy.value; valOy.textContent = ctlOy.value; applyBasemap(); autoSaveBasemapState(); });
    ctlSc.addEventListener('input', () => { basemapState.scale   = +ctlSc.value; valSc.textContent = Number(ctlSc.value).toFixed(2); applyBasemap(); autoSaveBasemapState(); });
    ctlRt.addEventListener('input', () => { basemapState.rotation= +ctlRt.value; valRt.textContent = ctlRt.value; applyBasemap(); autoSaveBasemapState(); });
    ctlOp.addEventListener('input', () => { basemapState.opacity = +ctlOp.value; valOp.textContent = Number(ctlOp.value).toFixed(2); applyBasemap(); autoSaveBasemapState(); });
    ctlUrl.addEventListener('change', () => {
        basemapState.url = ctlUrl.value.trim() || DEFAULT_BASEMAP_URL;
        applyBasemap();
        autoSaveBasemapState();
    });
    ctlFile.addEventListener('change', (ev) => {
        const file = ev.target.files && ev.target.files[0];
        if (!file) return;
        if (file.size > 8 * 1024 * 1024) {
            alert('Image is larger than 8 MB — localStorage may reject Save.');
        }
        const reader = new FileReader();
        reader.onload = () => {
            basemapState.url = reader.result;
            ctlUrl.value = `(uploaded: ${file.name})`;
            applyBasemap();
            autoSaveBasemapState();
        };
        reader.onerror = () => alert('Failed to read the file.');
        reader.readAsDataURL(file);
    });
    chkBasemap.addEventListener('change', () => {
        basemapState.visible = chkBasemap.checked;
        applyBasemap();
        autoSaveBasemapState();
    });
    btnBasemapPanel.addEventListener('click', () => basemapPanel.classList.add('visible'));
    btnBasemapClose.addEventListener('click', () => basemapPanel.classList.remove('visible'));
    btnBasemapReset.addEventListener('click', () => {
        basemapState = { ...defaultBasemap };
        syncBasemapControls();
        applyBasemap();
        autoSaveBasemapState();
    });
    btnBasemapClear.addEventListener('click', () => {
        try { localStorage.removeItem(BASEMAP_STORAGE_KEY); } catch {}
        basemapState = { ...defaultBasemap, url: '', visible: false };
        syncBasemapControls();
        applyBasemap();
    });
    btnBasemapSave.addEventListener('click', () => {
        try {
            saveBasemapState();
            btnBasemapSave.textContent = 'Saved ✓';
        } catch (e) {
            btnBasemapSave.textContent = 'Too big!';
            alert('Could not persist: the image is too large for localStorage.');
        }
        setTimeout(() => { btnBasemapSave.textContent = 'Save'; }, 1200);
    });

    // ---------- Load results list ----------
    try {
        const results = await DataLoader.loadResultsList();
        results.forEach(r => {
            const opt = document.createElement('option');
            opt.value = r.filename;
            opt.textContent = `${r.persona_id} / ${r.provider} (${r.outcome}, ${r.total_steps} steps)`;
            resultSelect.appendChild(opt);
        });
    } catch (e) {
        statusText.textContent = `Error: ${e.message}`;
    }

    resultSelect.addEventListener('change', async () => {
        stopPlayback();
        const filename = resultSelect.value;
        if (!filename) return;
        try {
            currentResult = await DataLoader.loadResult(filename);
            currentStep = 0;
            initPlayback();
        } catch (e) {
            statusText.textContent = `Error: ${e.message}`;
        }
    });

    // Honor ?file=<filename> in the URL: lets the home-page sim-result cards
    // deep-link straight into a specific persona's playback. Must run AFTER
    // the change listener is attached so dispatchEvent actually triggers load.
    {
        const params = new URLSearchParams(window.location.search);
        const fileParam = params.get('file');
        if (fileParam && Array.from(resultSelect.options).some(o => o.value === fileParam)) {
            resultSelect.value = fileParam;
            resultSelect.dispatchEvent(new Event('change'));
        }
    }

    // ---------- Env metric checkboxes ----------
    envCheckboxes.querySelectorAll('input[type=checkbox]').forEach(cb => {
        cb.addEventListener('change', () => {
            if (cb.checked) selectedEnvMetrics.add(cb.value);
            else selectedEnvMetrics.delete(cb.value);
            refreshEnvCharts();
        });
    });

    // ---------- Playback init ----------
    function initPlayback() {
        const steps = currentResult.per_step;
        stepSlider.max = steps.length;
        stepSlider.value = 0;
        updateStepIndicator();

        // Reset reasoning bubble dismissal & position when a new result loads.
        if (reasoningBubble) {
            delete reasoningBubble.dataset.dismissed;
            reasoningBubble.hidden = !reasoningVisible;
            reasoningBubble.style.left = '';
            reasoningBubble.style.top = '';
            reasoningBubble.style.right = '';
        }
        syncReasoningToggle();

        GraphRenderer.clearPaths();
        GraphRenderer.hideAgent();
        if (currentResult.path && currentResult.path.length >= 2) {
            GraphRenderer.highlightPath(currentResult.path, '#b2bec3', '6,4', 3);
        }
        GraphRenderer.showAgent(currentResult.start_node);

        buildEnvSeries();
        buildRouteSteps();
        initBodyChart();
        refreshEnvCharts();
        renderRoutesGallery();
        renderSegRose();
        renderPersonaCard();
        renderInfo(0);

        envSubtitle.textContent = `${currentResult.persona_id} · ${steps.length} steps`;
        routesGallerySubtitle.textContent =
            routeSteps.length
                ? `${routeSteps.length} walked edge${routeSteps.length === 1 ? '' : 's'}`
                : 'no walked edges';

        statusText.textContent =
            `${currentResult.persona_id} / ${currentResult.provider} | ` +
            `${currentResult.outcome} | ${steps.length} steps`;
    }

    // ---------- Controls ----------
    btnPlay.addEventListener('click', () => { isPlaying ? stopPlayback() : startPlayback(); });
    btnNext.addEventListener('click', () => { stopPlayback(); goToStep(currentStep + 1); });
    btnPrev.addEventListener('click', () => { stopPlayback(); goToStep(currentStep - 1); });
    stepSlider.addEventListener('input', () => { stopPlayback(); goToStep(parseInt(stepSlider.value)); });

    function startPlayback() {
        if (!currentResult) return;
        isPlaying = true;
        btnPlay.textContent = 'Pause';
        playNext();
    }
    function stopPlayback() {
        isPlaying = false;
        btnPlay.textContent = 'Play';
        if (playTimer) { clearTimeout(playTimer); playTimer = null; }
    }
    function playNext() {
        if (!isPlaying || !currentResult) return;
        if (currentStep >= currentResult.per_step.length) { stopPlayback(); return; }
        goToStep(currentStep + 1);
        playTimer = setTimeout(playNext, parseInt(speedSelect.value));
    }

    function goToStep(step) {
        if (!currentResult) return;
        step = Math.max(0, Math.min(step, currentResult.per_step.length));
        currentStep = step;
        stepSlider.value = step;
        updateStepIndicator();

        GraphRenderer.clearPaths();
        if (currentResult.path && currentResult.path.length >= 2) {
            GraphRenderer.highlightPath(currentResult.path, '#b2bec3', '6,4', 3);
        }
        if (step > 0) {
            const walked = buildWalkedPath(step);
            if (walked.length >= 2) GraphRenderer.highlightPath(walked, '#0984e3', null, 5);
        }
        GraphRenderer.showAgent(getNodeAtStep(step));

        renderInfo(step);
        refreshEnvCharts();
        highlightCurrentThumb();
        if (bodyChart) bodyChart.update('none');
    }

    function updateStepIndicator() {
        const max = currentResult ? currentResult.per_step.length : 0;
        stepIndicator.textContent = `Step ${currentStep}/${max}`;
    }

    // ---------- Persona card + state strip + reasoning bubble ----------
    function renderPersonaCard() {
        if (!currentResult) {
            personaCard.innerHTML = `<div class="persona-card-empty">Select a result to begin.</div>`;
            return;
        }
        const p = currentResult.persona_layers || {};
        const identity = p.layer_1 || '';
        const priorities = p.layer_3 || '';
        const np = currentResult.numeric_params || {};
        const paramEntries = [
            ['Base speed', np.base_speed_mps != null ? `${np.base_speed_mps.toFixed(2)} m/s` : null],
            ['Stamina',    np.stamina_reserve != null ? np.stamina_reserve.toFixed(2) : null],
            ['Heat tol.',  np.heat_tolerance != null ? np.heat_tolerance.toFixed(2) : null],
            ['Age factor', np.age_factor != null ? np.age_factor.toFixed(2) : null],
        ].filter(([, v]) => v != null);

        const paramsHtml = paramEntries.length
            ? `<div class="pc-params">` +
              paramEntries.map(([k, v]) =>
                  `<span class="k">${escapeHtml(k)}</span><span class="v">${escapeHtml(String(v))}</span>`
              ).join('') +
              `</div>`
            : '';

        personaCard.innerHTML =
            `<div class="pc-meta">${escapeHtml(currentResult.provider || '')}` +
            `${currentResult.outcome ? ` · ${escapeHtml(currentResult.outcome)}` : ''}</div>` +
            `<div class="pc-name">${escapeHtml(currentResult.persona_id || 'Persona')}</div>` +
            (identity ? `<div class="pc-identity">${escapeHtml(identity)}</div>` : '') +
            (priorities ? `<div class="pc-priorities">${escapeHtml(priorities)}</div>` : '') +
            paramsHtml;
    }

    function renderInfo(step) {
        if (!currentResult) return;

        if (step === 0) {
            const nodeId = currentResult.start_node;
            const nd = graphData.nodes.find(n => n.id === nodeId);
            stateLine.innerHTML = renderStateHud({
                stepLabel: '0',
                actionLabel: 'start',
                nodeLabel: nd ? (nd.name || nd.id) : nodeId,
                progress: 0,
                progressText: `0/${currentResult.per_step.length}`,
                fatigue: 0,
                fatigueLabel: 'fresh',
                heat: 0,
                heatLabel: 'comfortable',
                distance: 0,
                totalDistance: computePlannedDistance(),
            });
            renderReasoning(null);
            return;
        }

        const s = currentResult.per_step[step - 1];
        const fLabel = toLabel(s.fatigue_after, FATIGUE_BANDS, FATIGUE_LABELS);
        const hLabel = toLabel(s.heat_after, HEAT_BANDS, HEAT_LABELS);
        const nodeId = s.action === 'walk' ? s.next_node : s.node_before;
        const nd = graphData.nodes.find(n => n.id === nodeId);

        let distWalked = 0;
        for (let i = 0; i < step; i++) {
            const st = currentResult.per_step[i];
            if (st.action === 'walk' && st.next_node) {
                const edge = graphData.edges.find(e => e.source === st.node_before && e.target === st.next_node);
                if (edge) distWalked += edge.length;
            }
        }

        stateLine.innerHTML = renderStateHud({
            stepLabel: String(s.step),
            actionLabel: s.action,
            nodeLabel: nd ? (nd.name || nd.id) : nodeId,
            progress: currentResult.per_step.length ? step / currentResult.per_step.length : 0,
            progressText: `${step}/${currentResult.per_step.length}`,
            fatigue: s.fatigue_after,
            fatigueLabel: fLabel,
            heat: s.heat_after,
            heatLabel: hLabel,
            distance: distWalked,
            totalDistance: computePlannedDistance(),
            restText: s.rest_duration_s ? `${s.rest_duration_s.toFixed(0)}s rest` : '',
        });

        renderReasoning(s);
    }

    function renderReasoning(s) {
        if (!s) {
            reasoningPanelBody.innerHTML =
                `<div class="reasoning-empty">Advance to a step to see its reasoning.</div>`;
            // Keep bubble visible if user hasn't dismissed it; just show empty state.
            if (reasoningBubble && reasoningVisible) {
                reasoningBubble.hidden = false;
            }
            return;
        }
        const reasonText = s.reasoning || s.error || '';
        if (!reasonText) {
            reasoningPanelBody.innerHTML =
                `<div class="reasoning-empty">No reasoning recorded for step ${s.step}.</div>`;
        } else {
            const actionLabel = s.action === 'rest' ? 'Rest' : `Walk → ${s.next_node}`;
            reasoningPanelBody.innerHTML =
                `<div class="step-head">Step ${s.step} · ${actionLabel}</div>` +
                escapeHtml(reasonText);
        }
        if (reasoningBubble && reasoningVisible) {
            reasoningBubble.hidden = false;
        }
    }

    // Draggable reasoning bubble — position: fixed, bounded by the viewport so
    // it can float anywhere on the page (not just the render column).
    function syncReasoningToggle() {
        if (!btnToggleReasoning) return;
        btnToggleReasoning.title = reasoningVisible ? 'Hide reasoning' : 'Show reasoning';
        btnToggleReasoning.classList.toggle('active', reasoningVisible);
    }
    function setReasoningVisible(visible) {
        reasoningVisible = !!visible;
        if (reasoningBubble) {
            reasoningBubble.hidden = !reasoningVisible;
            if (reasoningVisible) delete reasoningBubble.dataset.dismissed;
            else reasoningBubble.dataset.dismissed = '1';
        }
        syncReasoningToggle();
    }
    btnToggleReasoning?.addEventListener('click', () => {
        setReasoningVisible(!reasoningVisible);
        if (reasoningVisible) renderInfo(currentStep);
    });
    syncReasoningToggle();

    (function wireReasoningBubble() {
        if (!reasoningBubble || !reasoningBubbleHead) return;

        reasoningBubbleClose?.addEventListener('click', () => {
            setReasoningVisible(false);
        });

        let drag = null;
        reasoningBubbleHead.addEventListener('mousedown', (ev) => {
            if (ev.target.closest('.reasoning-bubble-close')) return;
            const rect = reasoningBubble.getBoundingClientRect();
            drag = { dx: ev.clientX - rect.left, dy: ev.clientY - rect.top };
            ev.preventDefault();
        });
        window.addEventListener('mousemove', (ev) => {
            if (!drag) return;
            const vw = window.innerWidth, vh = window.innerHeight;
            const w = reasoningBubble.offsetWidth, h = reasoningBubble.offsetHeight;
            let left = ev.clientX - drag.dx;
            let top  = ev.clientY - drag.dy;
            left = Math.max(0, Math.min(left, vw - w));
            top  = Math.max(0, Math.min(top,  vh - h));
            reasoningBubble.style.left = left + 'px';
            reasoningBubble.style.top  = top  + 'px';
            reasoningBubble.style.right = 'auto';
            reasoningBubble.style.bottom = 'auto';
        });
        window.addEventListener('mouseup', () => { drag = null; });
    })();

    function kv(k, v) {
        return `<span class="kv"><span class="k">${k}</span><span class="v">${v}</span></span>`;
    }
    function renderStateHud(opts) {
        const total = Number(opts.totalDistance) || 0;
        const dist = Number(opts.distance) || 0;
        const distRatio = total > 0 ? dist / total : 0;
        const node = opts.nodeLabel != null ? String(opts.nodeLabel) : '-';
        const rest = opts.restText ? `<span class="state-hud-rest">${escapeHtml(opts.restText)}</span>` : '';
        return `
            <div class="state-hud-card">
                <div class="state-hud-top">
                    <span class="state-hud-step">Step ${escapeHtml(opts.stepLabel || '0')}</span>
                    <span class="state-hud-action">${escapeHtml(opts.actionLabel || '')}</span>
                    ${rest}
                    <span class="state-hud-node">${escapeHtml(node)}</span>
                </div>
                ${hudBar('FAT', opts.fatigue, `${fmtHudValue(opts.fatigue)} ${opts.fatigueLabel || ''}`, 'fatigue')}
                ${hudBar('HEAT', opts.heat, `${fmtHudValue(opts.heat)} ${opts.heatLabel || ''}`, 'heat')}
                ${hudBar('DIST', distRatio, total > 0 ? `${Math.round(dist)}/${Math.round(total)} m` : `${Math.round(dist)} m`, 'distance')}
            </div>`;
    }
    function hudBar(label, ratio, valueText, kind) {
        const segments = 10;
        const raw = Number(ratio);
        const clamped = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0;
        const active = clamped > 0 ? Math.max(1, Math.ceil(clamped * segments)) : 0;
        let cells = '';
        for (let i = 0; i < segments; i++) {
            cells += `<span class="state-hud-seg${i < active ? ' active' : ''}"></span>`;
        }
        return `
            <div class="state-hud-row state-hud-${kind}">
                <span class="state-hud-label">${label}</span>
                <span class="state-hud-track">${cells}</span>
                <span class="state-hud-value">${escapeHtml(String(valueText || ''))}</span>
            </div>`;
    }
    function fmtHudValue(v) {
        const n = Number(v);
        return Number.isFinite(n) ? n.toFixed(2) : '-';
    }
    function computePlannedDistance() {
        if (!currentResult || !currentResult.path || !graphData) return 0;
        let total = 0;
        for (let i = 0; i < currentResult.path.length - 1; i++) {
            const a = currentResult.path[i];
            const b = currentResult.path[i + 1];
            const edge = graphData.edges.find(e =>
                (e.source === a && e.target === b) || (e.source === b && e.target === a)
            );
            if (edge && Number.isFinite(Number(edge.length))) total += Number(edge.length);
        }
        return total;
    }
    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
        }[c]));
    }

    // ---------- Build per-step env + per-walk route records ----------
    function findEdge(nodeBefore, nextNode) {
        if (!nodeBefore || !nextNode) return null;
        // edges exist in both directions with `dir` field; prefer forward match.
        let fwd = null, rev = null;
        for (const e of graphData.edges) {
            if (e.source === nodeBefore && e.target === nextNode) { fwd = e; break; }
            if (e.source === nextNode && e.target === nodeBefore) rev = e;
        }
        return fwd || rev;
    }

    function buildEnvSeries() {
        envSeries = {};
        for (const m of ENV_METRICS) envSeries[m] = [];
        for (const m of BODY_METRICS) envSeries[m] = [];

        const steps = currentResult.per_step;
        const last = Object.fromEntries(ENVIRONMENT_METRICS.map(m => [m, null]));

        for (const s of steps) {
            if (s.action === 'walk' && s.next_node && s.node_before) {
                const edge = findEdge(s.node_before, s.next_node);
                if (edge) {
                    const src = edge.sim || edge;
                    for (const m of ENVIRONMENT_METRICS) {
                        const v = src[m];
                        if (v != null && !Number.isNaN(Number(v))) last[m] = Number(v);
                    }
                }
            }
            for (const m of ENVIRONMENT_METRICS) envSeries[m].push(last[m]);
            envSeries['Fatigue'].push(toFiniteNumberOrNull(s.fatigue_after));
            envSeries['Heat Load'].push(toFiniteNumberOrNull(s.heat_after));
        }
    }

    function toFiniteNumberOrNull(value) {
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
    }

    function buildRouteSteps() {
        routeSteps = [];
        let walkIdx = 0;
        currentResult.per_step.forEach((s) => {
            if (s.action !== 'walk' || !s.next_node || !s.node_before) return;
            const edge = findEdge(s.node_before, s.next_node);
            if (!edge) return;
            walkIdx += 1;
            routeSteps.push({
                step: s.step,
                walkIdx,
                route: edge.route,
                dir: edge.dir,
                source: edge.source,
                target: edge.target,
                seg: edge.segmentation || null,
            });
        });
    }

    // ---------- Routes gallery (single-image playback) ----------
    let currentRouteIdx = -1;  // index into routeSteps

    function renderRoutesGallery() {
        if (!routeSteps.length) {
            routeImageLayer.innerHTML =
                `<div class="env-empty">This persona has no walked edges.</div>`;
            routeCurrentCaption.textContent = '';
            routeImgIndex.textContent = '—';
            btnRoutePrev.disabled = true;
            btnRouteNext.disabled = true;
            btnDownloadRoutes.disabled = true;
            currentRouteIdx = -1;
            return;
        }
        btnDownloadRoutes.disabled = false;
        currentRouteIdx = 0;
        renderCurrentRouteImage();
    }

    function renderCurrentRouteImage() {
        if (!routeSteps.length) return;
        if (currentRouteIdx < 0) currentRouteIdx = 0;
        if (currentRouteIdx > routeSteps.length - 1) currentRouteIdx = routeSteps.length - 1;
        const r = routeSteps[currentRouteIdx];
        const src = `api/route_view/${r.dir}/${r.route}.png`;
        const title = `Step ${r.step} · Route ${r.route} · Dir ${r.dir}`;
        routeImageLayer.innerHTML =
            `<img src="${src}" alt="Route ${r.route}"
                  onerror="this.parentNode.innerHTML='<div class=&quot;thumb-missing&quot;>no image</div>';">`;
        routeCurrentCaption.textContent = title;
        routeImgIndex.textContent = `${currentRouteIdx + 1} / ${routeSteps.length}`;
        btnRoutePrev.disabled = (currentRouteIdx <= 0);
        btnRouteNext.disabled = (currentRouteIdx >= routeSteps.length - 1);
    }

    // Follow main playback step → advance to latest walked-edge image
    function highlightCurrentThumb() {
        if (!routeSteps.length) return;
        let idx = -1;
        for (let i = 0; i < routeSteps.length; i++) {
            if (routeSteps[i].step <= currentStep) idx = i; else break;
        }
        if (idx < 0) idx = 0;
        if (idx !== currentRouteIdx) {
            currentRouteIdx = idx;
            renderCurrentRouteImage();
        }
    }

    btnRoutePrev.addEventListener('click', () => {
        if (!routeSteps.length) return;
        stopPlayback();
        currentRouteIdx = Math.max(0, currentRouteIdx - 1);
        const targetStep = routeSteps[currentRouteIdx].step;
        goToStep(targetStep);
    });
    btnRouteNext.addEventListener('click', () => {
        if (!routeSteps.length) return;
        stopPlayback();
        currentRouteIdx = Math.min(routeSteps.length - 1, currentRouteIdx + 1);
        const targetStep = routeSteps[currentRouteIdx].step;
        goToStep(targetStep);
    });

    function renderSegRose() {
        const sums = { Sky: 0, Greenery: 0, Topo: 0, Building: 0, Pavement: 0 };
        let n = 0;
        for (const r of routeSteps) {
            if (!r.seg) continue;
            let ok = false;
            for (const k of SEG_KEYS) {
                const v = r.seg[k];
                if (v != null && !Number.isNaN(Number(v))) { sums[k] += Number(v); ok = true; }
            }
            if (ok) n++;
        }
        if (!n) {
            segRoseBlock.classList.add('empty');
            if (roseChart) { roseChart.destroy(); roseChart = null; }
            return;
        }
        segRoseBlock.classList.remove('empty');
        const values = SEG_KEYS.map(k => sums[k] / n);
        const colors = SEG_KEYS.map(k => effectiveSegColor(k));
        const maxVal = Math.max(0.05, ...values);

        segRoseTitle.textContent =
            `Average element composition · ${n} walked edge${n === 1 ? '' : 's'}`;

        if (roseChart) roseChart.destroy();
        const total = values.reduce((a, b) => a + b, 0) || 1;
        roseChart = new Chart(segRoseCanvas.getContext('2d'), {
            type: 'pie',
            data: {
                labels: SEG_KEYS,
                datasets: [{
                    data: values,
                    backgroundColor: colors.map(c => hexWithAlpha(c, 0.85)),
                    borderColor: '#ffffff',
                    borderWidth: 1.5,
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                layout: { padding: { top: 18, bottom: 18, left: 18, right: 18 } },
                plugins: {
                    legend: { position: 'right', labels: { font: { size: 11 }, boxWidth: 12 } },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => {
                                const pct = (Number(ctx.raw) / total) * 100;
                                return ` ${ctx.label}: ${pct.toFixed(1)}%`;
                            },
                        },
                    },
                },
                animation: { duration: 250 },
            },
            plugins: [piePercentLabelsPlugin],
        });
    }

    function getAverageSegComposition() {
        const sums = { Sky: 0, Greenery: 0, Topo: 0, Building: 0, Pavement: 0 };
        let n = 0;
        for (const r of routeSteps) {
            if (!r.seg) continue;
            let ok = false;
            for (const k of SEG_KEYS) {
                const v = r.seg[k];
                if (v != null && !Number.isNaN(Number(v))) {
                    sums[k] += Number(v);
                    ok = true;
                }
            }
            if (ok) n++;
        }
        return {
            count: n,
            values: SEG_KEYS.map(k => n ? sums[k] / n : 0),
        };
    }

    // Chart.js plugin: draw percentage labels outside each pie slice with leader lines.
    const piePercentLabelsPlugin = {
        id: 'piePercentLabels',
        afterDatasetsDraw(chart) {
            const { ctx } = chart;
            const meta = chart.getDatasetMeta(0);
            if (!meta || !meta.data || !meta.data.length) return;
            const ds = chart.data.datasets[0];
            const total = (ds.data || []).reduce((a, b) => a + (Number(b) || 0), 0);
            if (total <= 0) return;
            const pluginOpts = chart.options.plugins?.piePercentLabels || {};
            const fontSize = pluginOpts.fontSize || 11;
            const lineWidth = pluginOpts.lineWidth || 1;
            const radialGap = pluginOpts.radialGap || 8;
            const elbow = pluginOpts.elbow || 10;
            const textGap = pluginOpts.textGap || 3;

            ctx.save();
            ctx.font = `600 ${fontSize}px system-ui, -apple-system, sans-serif`;
            ctx.fillStyle = '#334155';
            ctx.strokeStyle = '#94a3b8';
            ctx.lineWidth = lineWidth;

            meta.data.forEach((arc, i) => {
                const val = Number(ds.data[i]) || 0;
                if (val <= 0) return;
                const pct = (val / total) * 100;
                if (pct < 1.5) return;          // skip tiny slices to avoid overlap

                const { x: cx, y: cy, outerRadius } = arc.getProps(
                    ['x', 'y', 'outerRadius'], true,
                );
                const midAngle = (arc.startAngle + arc.endAngle) / 2;
                const cos = Math.cos(midAngle);
                const sin = Math.sin(midAngle);

                const r1x = cx + cos * (outerRadius - 2);
                const r1y = cy + sin * (outerRadius - 2);
                const r2x = cx + cos * (outerRadius + radialGap);
                const r2y = cy + sin * (outerRadius + radialGap);
                const r3x = r2x + (cos >= 0 ? elbow : -elbow);
                const r3y = r2y;

                ctx.beginPath();
                ctx.moveTo(r1x, r1y);
                ctx.lineTo(r2x, r2y);
                ctx.lineTo(r3x, r3y);
                ctx.stroke();

                ctx.textAlign = cos >= 0 ? 'left' : 'right';
                ctx.textBaseline = 'middle';
                const tx = r3x + (cos >= 0 ? textGap : -textGap);
                ctx.fillText(`${pct.toFixed(1)}%`, tx, r3y);
            });
            ctx.restore();
        },
    };

    function hexWithAlpha(hex, alpha) {
        const [r, g, b] = hex2rgb(hex);
        return `rgba(${r},${g},${b},${alpha})`;
    }

    // ---------- Download combined route views as one horizontal PNG ----------
    btnDownloadRoutes.addEventListener('click', downloadCombinedRoutes);

    async function downloadCombinedRoutes() {
        if (!routeSteps.length) return;
        btnDownloadRoutes.disabled = true;
        const originalLabel = btnDownloadRoutes.textContent;
        btnDownloadRoutes.textContent = 'Preparing…';
        try {
            const THUMB_H = 160;  // output row height
            const GAP = 2;
            const images = await Promise.all(
                routeSteps.map(r => loadDownloadableImage(`api/route_view/${r.dir}/${r.route}.png`))
            );
            const scaled = images.map(img => {
                if (img._missing) {
                    return { img: null, w: Math.round(THUMB_H * 4 / 3), h: THUMB_H, missing: true };
                }
                const ratio = img.naturalWidth / Math.max(1, img.naturalHeight);
                return { img, w: Math.max(1, Math.round(THUMB_H * ratio)), h: THUMB_H };
            });
            const totalW = scaled.reduce((a, s) => a + s.w, 0) + GAP * Math.max(0, scaled.length - 1);
            const canvas = document.createElement('canvas');
            canvas.width  = Math.max(1, totalW);
            canvas.height = THUMB_H;
            const ctx = canvas.getContext('2d');
            // fill background so gap lines are visible
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            let x = 0;
            for (const s of scaled) {
                if (s.missing) {
                    ctx.fillStyle = '#eef1f5';
                    ctx.fillRect(x, 0, s.w, s.h);
                    ctx.fillStyle = '#95a5a6';
                    ctx.font = '12px system-ui, sans-serif';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText('(no image)', x + s.w / 2, s.h / 2);
                } else {
                    ctx.drawImage(s.img, x, 0, s.w, s.h);
                }
                x += s.w + GAP;
            }
            canvas.toBlob((blob) => {
                if (!blob) throw new Error('Canvas export failed');
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'persona_routes.png';
                document.body.appendChild(a);
                a.click();
                a.remove();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
            }, 'image/png');
        } catch (e) {
            alert('Failed to build combined image: ' + (e.message || e));
        } finally {
            btnDownloadRoutes.textContent = originalLabel;
            btnDownloadRoutes.disabled = false;
        }
    }

    function loadDownloadableImage(src) {
        return new Promise((resolve) => {
            const img = new Image();
            // Images come from our own /api endpoint so they are same-origin;
            // request crossOrigin anyway so the canvas doesn't taint if a proxy
            // ever serves them cross-origin with correct CORS headers.
            img.crossOrigin = 'anonymous';
            img.onload  = () => resolve(img);
            img.onerror = () => {
                // retry without crossOrigin (some servers don't send CORS headers);
                // if that also fails, mark as missing.
                const retry = new Image();
                retry.onload  = () => resolve(retry);
                retry.onerror = () => resolve({ _missing: true, naturalWidth: 0, naturalHeight: 0 });
                retry.src = src;
            };
            img.src = src;
        });
    }

    // ---------- Environment bar charts ----------
    function refreshEnvCharts() {
        if (!currentResult) {
            envChartsStack.innerHTML = `<div class="env-empty">Select a result to see environment bar charts.</div>`;
            return;
        }
        const metrics = ENV_METRICS.filter(m => selectedEnvMetrics.has(m));
        if (metrics.length === 0) {
            envChartsStack.innerHTML = `<div class="env-empty">Select at least one metric above.</div>`;
            return;
        }
        envChartsStack.innerHTML = metrics.map(m => renderEnvBarChart(m)).join('');
    }

    function renderEnvBarChart(metric) {
        if (metric === BODY_COMBINED_METRIC) {
            return renderBodyCombinedChart();
        }

        const values = envSeries[metric] || [];
        const clean = values.filter(v => v != null && !Number.isNaN(v));
        const avg = clean.length ? clean.reduce((a, b) => a + b, 0) / clean.length : null;

        // Custom-or-auto axis range. `lo` is the baseline for bar drawing.
        const [lo, hi] = getAxisRange(metric, values);
        const hasCustom = !!axisRanges[metric];

        // SVG viewBox = the plot area only (no inner padding). We use fixed
        // round numbers so every tick label position is a clean percentage.
        const VBW = 1000, VBH = 100;
        const n = values.length;
        const slotW = n > 0 ? VBW / n : VBW;
        const gapW = 0.12 * slotW;
        const barW = Math.max(0.5, slotW - gapW);

        const yFor = (v) => {
            if (hi === lo) return VBH;
            const t = (v - lo) / (hi - lo);
            return (1 - Math.max(0, Math.min(1, t))) * VBH;
        };

        const intervalCount = getAxisIntervalCount(metric);
        const tickVals = makeTickVals(lo, hi, intervalCount);
        const gridSvg = tickVals.map(v => {
            const y = yFor(v).toFixed(2);
            return `<line class="grid-line" x1="0" y1="${y}" x2="${VBW}" y2="${y}"></line>`;
        }).join('');
        const xGridSvg = values.map((_, i) => {
            const x = (((i + 0.5) / Math.max(1, n)) * VBW).toFixed(2);
            return `<line class="grid-line x-grid-line" x1="${x}" y1="0" x2="${x}" y2="${VBH}"></line>`;
        }).join('');

        // Y-tick labels live OUTSIDE the SVG so they stay at a constant font
        // size regardless of the chart-width / chart-height sliders.
        const yLabelsHtml = tickVals.map(v => {
            const topPct = (yFor(v) / VBH * 100).toFixed(2);
            return `<div class="ytick" style="top:${topPct}%">${fmtTick(v, metric)}</div>`;
        }).join('');

        // Resolve the line color when chart type is "line": user override → metric default.
        const lineColor = metricColors[metric] || DEFAULT_PICKER_COLOR[metric] || '#0984e3';

        // --- Shapes: bars (default) or polyline + dots (line mode).
        let shapes = '';
        if (envChartType === 'line') {
            // Polyline through all valid points; marker per step; title for hover.
            // A semi-transparent polygon fills the area between the line and
            // the bottom of the plot, using the same colour as the line.
            const pts = [];
            const dots = [];
            let firstX = null, lastX = null;
            values.forEach((v, i) => {
                if (v == null || Number.isNaN(v)) return;
                const vClamp = Math.min(Math.max(v, lo), hi);
                const x = (i + 0.5) / n * VBW;
                const y = yFor(vClamp);
                if (firstX === null) firstX = x;
                lastX = x;
                pts.push(`${x.toFixed(2)},${y.toFixed(2)}`);
                const cls = (i === currentStep - 1) ? 'env-dot current' : 'env-dot';
                const r = (i === currentStep - 1) ? 3.2 : 2.0;
                dots.push(
                    `<circle class="${cls}" cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${r}" ` +
                    `fill="${lineColor}"><title>step ${i + 1}  ${Number(v).toFixed(3)}</title></circle>`
                );
            });
            let fill = '';
            if (pts.length >= 2) {
                const base = VBH.toFixed(2);
                const fillPts = [`${firstX.toFixed(2)},${base}`, ...pts, `${lastX.toFixed(2)},${base}`];
                fill = `<polygon class="env-line-fill" points="${fillPts.join(' ')}" fill="${lineColor}" fill-opacity="0.18"></polygon>`;
            }
            const lwStr = Number(envLineWidth).toFixed(2);
            const poly = pts.length
                ? `<polyline class="env-line" points="${pts.join(' ')}" fill="none" stroke="${lineColor}" stroke-width="${lwStr}" vector-effect="non-scaling-stroke"></polyline>`
                : '';
            shapes = fill + poly + dots.join('');
        } else {
            shapes = values.map((v, i) => {
                if (v == null || Number.isNaN(v)) return '';
                const vClamp = Math.min(Math.max(v, lo), hi);
                const yTop = yFor(vClamp);
                const yBase = yFor(lo);
                const top = Math.min(yTop, yBase);
                const h = Math.abs(yBase - yTop);
                const x = (i / n) * VBW + gapW / 2;
                const color = colorForMetric(metric, v, lo, hi);
                const cls = (i === currentStep - 1) ? 'bar current' : 'bar';
                const title = `step ${i + 1}  ${Number(v).toFixed(3)}`;
                return `<rect class="${cls}" x="${x.toFixed(2)}" y="${top.toFixed(2)}" ` +
                       `width="${barW.toFixed(2)}" height="${Math.max(0, h).toFixed(2)}" ` +
                       `fill="${color}"><title>${title}</title></rect>`;
            }).join('');
        }

        // --- X-axis labels (HTML, positioned by left %)
        let xLabelsHtml = '';
        for (let i = 0; i < n; i++) {
            const step = i + 1;
            const leftPct = (((i + 0.5) / n) * 100).toFixed(2);
            xLabelsHtml += `<div class="xtick" style="left:${leftPct}%">${step}</div>`;
        }

        // --- Avg dashed line + side marker
        let avgLine = '';
        let avgMarkerHtml = '';
        if (avg != null) {
            const avgClamp = Math.min(Math.max(avg, lo), hi);
            const yAvg = yFor(avgClamp);
            avgLine = `<line class="avg-line" x1="0" y1="${yAvg.toFixed(2)}" x2="${VBW}" y2="${yAvg.toFixed(2)}"></line>`;
            const topPct = (yAvg / VBH * 100).toFixed(2);
            const unit = ENV_UNITS[metric] || '';
            const outOfRange = (avg < lo || avg > hi) ? ' *' : '';
            avgMarkerHtml = `
                <div class="avg-marker" style="top:${topPct}%;">
                    <span class="k">mean</span>${Number(avg).toFixed(2)}${unit ? ' ' + unit : ''}${outOfRange}
                </div>`;
        }

        // --- Base axis lines (left + bottom)
        const axis = `<line class="axis-line" x1="0" y1="${VBH}" x2="${VBW}" y2="${VBH}"></line>
                      <line class="axis-line" x1="0" y1="0" x2="0" y2="${VBH}"></line>`;

        const svg = `<svg class="env-bar-chart" viewBox="0 0 ${VBW} ${VBH}" preserveAspectRatio="none">
            ${gridSvg}
            ${xGridSvg}
            ${axis}
            ${shapes}
            ${avgLine}
        </svg>`;

        // --- Meta row always reports the ACTUAL data min/max (not the axis range)
        const [dataLo, dataHi] = computeExtents(values);
        const unit = ENV_UNITS[metric] ? ` ${ENV_UNITS[metric]}` : '';
        const metaCore = clean.length
            ? `${n} steps · min ${Number(dataLo).toFixed(2)}${unit} · max ${Number(dataHi).toFixed(2)}${unit}`
            : `${n} steps · no data`;
        const rangeTag = hasCustom
            ? `<span class="bar-meta" style="margin-left:8px;color:var(--accent);">Y [${Number(lo).toFixed(2)}, ${Number(hi).toFixed(2)}] Â· ${intervalCount} intervals</span>`
            : '';

        return `
            <div class="env-bar-row" data-metric="${metric}">
                <div class="bar-head">
                    <span class="bar-title">${metric}${unit ? ` <span style="font-weight:400;color:var(--text-muted);">(${ENV_UNITS[metric]})</span>` : ''}</span>
                    <span class="bar-meta">${metaCore}</span>
                    ${rangeTag}
                </div>
                <div class="env-bar-main">
                    <div class="env-bar-ylabels">${yLabelsHtml}</div>
                    <div class="env-bar-plot-col">
                        <div class="env-bar-plot-box">${svg}</div>
                        <div class="env-bar-xlabels">${xLabelsHtml}</div>
                        <div class="env-bar-xtitle">Step</div>
                    </div>
                    <div class="env-bar-avg-side">${avgMarkerHtml}</div>
                </div>
            </div>
        `;
    }

    function renderBodyCombinedChart() {
        const fatigueValues = envSeries['Fatigue'] || [];
        const heatValues = envSeries['Heat Load'] || [];
        const values = [...fatigueValues, ...heatValues];
        const cleanFatigue = fatigueValues.filter(v => v != null && !Number.isNaN(v));
        const cleanHeat = heatValues.filter(v => v != null && !Number.isNaN(v));
        const avgFatigue = cleanFatigue.length ? cleanFatigue.reduce((a, b) => a + b, 0) / cleanFatigue.length : null;
        const avgHeat = cleanHeat.length ? cleanHeat.reduce((a, b) => a + b, 0) / cleanHeat.length : null;
        const [lo, hi] = getAxisRange(BODY_COMBINED_METRIC, values);
        const hasCustom = !!axisRanges[BODY_COMBINED_METRIC];
        const intervalCount = getAxisIntervalCount(BODY_COMBINED_METRIC);

        const VBW = 1000, VBH = 100;
        const n = Math.max(fatigueValues.length, heatValues.length);
        const yFor = (v) => {
            if (hi === lo) return VBH;
            const t = (v - lo) / (hi - lo);
            return (1 - Math.max(0, Math.min(1, t))) * VBH;
        };
        const xFor = (i) => ((i + 0.5) / Math.max(1, n)) * VBW;

        const tickVals = makeTickVals(lo, hi, intervalCount);
        const gridSvg = tickVals.map(v => {
            const y = yFor(v).toFixed(2);
            return `<line class="grid-line" x1="0" y1="${y}" x2="${VBW}" y2="${y}"></line>`;
        }).join('');
        const xGridSvg = Array.from({ length: n }, (_, i) => {
            const x = xFor(i).toFixed(2);
            return `<line class="grid-line x-grid-line" x1="${x}" y1="0" x2="${x}" y2="${VBH}"></line>`;
        }).join('');
        const yLabelsHtml = tickVals.map(v => {
            const topPct = (yFor(v) / VBH * 100).toFixed(2);
            return `<div class="ytick" style="top:${topPct}%">${fmtTick(v, BODY_COMBINED_METRIC)}</div>`;
        }).join('');

        const lineWidth = Number(envLineWidth).toFixed(2);
        const fatigueColor = getBodyMetricColor('Fatigue');
        const heatColor = getBodyMetricColor('Heat Load');
        const seriesSvg = [
            bodySeriesSvg(fatigueValues, 'Fatigue', fatigueColor, xFor, yFor, lo, hi, lineWidth),
            bodySeriesSvg(heatValues, 'Heat Load', heatColor, xFor, yFor, lo, hi, lineWidth),
        ].join('');
        const avgSvg = [
            bodyAvgLineSvg(avgFatigue, fatigueColor, yFor, lo, hi, VBW),
            bodyAvgLineSvg(avgHeat, heatColor, yFor, lo, hi, VBW),
        ].join('');
        const axis = `<line class="axis-line" x1="0" y1="${VBH}" x2="${VBW}" y2="${VBH}"></line>
                      <line class="axis-line" x1="0" y1="0" x2="0" y2="${VBH}"></line>`;
        const svg = `<svg class="env-bar-chart" viewBox="0 0 ${VBW} ${VBH}" preserveAspectRatio="none">
            ${gridSvg}
            ${xGridSvg}
            ${axis}
            ${seriesSvg}
            ${avgSvg}
        </svg>`;

        let xLabelsHtml = '';
        for (let i = 0; i < n; i++) {
            const leftPct = (((i + 0.5) / Math.max(1, n)) * 100).toFixed(2);
            xLabelsHtml += `<div class="xtick" style="left:${leftPct}%">${i + 1}</div>`;
        }

        const avgMarkerHtml = [
            bodyAvgMarkerHtml('F avg', avgFatigue, fatigueColor, yFor, lo, hi),
            bodyAvgMarkerHtml('H avg', avgHeat, heatColor, yFor, lo, hi),
        ].join('');
        const metaCore = `${n} steps` +
            (avgFatigue != null ? ` · fatigue avg ${avgFatigue.toFixed(2)}` : '') +
            (avgHeat != null ? ` · heat avg ${avgHeat.toFixed(2)}` : '');
        const rangeTag = hasCustom
            ? `<span class="bar-meta" style="margin-left:8px;color:var(--accent);">Y [${Number(lo).toFixed(2)}, ${Number(hi).toFixed(2)}] · ${intervalCount} intervals</span>`
            : '';

        return `
            <div class="env-bar-row" data-metric="${BODY_COMBINED_METRIC}">
                <div class="bar-head">
                    <span class="bar-title">${BODY_COMBINED_METRIC}
                        <span style="font-weight:400;color:var(--text-muted);">(0-1)</span>
                    </span>
                    <span class="bar-meta">${metaCore}</span>
                    ${rangeTag}
                </div>
                <div class="env-bar-main">
                    <div class="env-bar-ylabels">${yLabelsHtml}</div>
                    <div class="env-bar-plot-col">
                        <div class="env-bar-plot-box">${svg}</div>
                        <div class="env-bar-xlabels">${xLabelsHtml}</div>
                        <div class="env-bar-xtitle">Step</div>
                    </div>
                    <div class="env-bar-avg-side">${avgMarkerHtml}</div>
                </div>
            </div>
        `;
    }

    function bodySeriesSvg(values, label, color, xFor, yFor, lo, hi, lineWidth) {
        const pts = [];
        const dots = [];
        let firstX = null;
        let lastX = null;
        values.forEach((v, i) => {
            if (v == null || Number.isNaN(v)) return;
            const vClamp = Math.min(Math.max(v, lo), hi);
            const x = xFor(i);
            const y = yFor(vClamp);
            if (firstX === null) firstX = x;
            lastX = x;
            pts.push(`${x.toFixed(2)},${y.toFixed(2)}`);
            const cls = (i === currentStep - 1) ? 'env-dot current' : 'env-dot';
            const r = (i === currentStep - 1) ? 3.2 : 2.0;
            dots.push(
                `<circle class="${cls}" cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${r}" ` +
                `fill="${color}"><title>${label} step ${i + 1}  ${Number(v).toFixed(3)}</title></circle>`
            );
        });
        let fill = '';
        if (pts.length >= 2) {
            const base = '100.00';
            const fillPts = [`${firstX.toFixed(2)},${base}`, ...pts, `${lastX.toFixed(2)},${base}`];
            fill = `<polygon class="env-line-fill" points="${fillPts.join(' ')}" fill="${color}" fill-opacity="0.10"></polygon>`;
        }
        const line = pts.length
            ? `<polyline class="env-line" points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="${lineWidth}" vector-effect="non-scaling-stroke"></polyline>`
            : '';
        return fill + line + dots.join('');
    }

    function bodyAvgLineSvg(avg, color, yFor, lo, hi, width) {
        if (avg == null) return '';
        const avgClamp = Math.min(Math.max(avg, lo), hi);
        const y = yFor(avgClamp).toFixed(2);
        return `<line class="avg-line" x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="${color}" style="stroke:${color};"></line>`;
    }

    function bodyAvgMarkerHtml(label, avg, color, yFor, lo, hi) {
        if (avg == null) return '';
        const avgClamp = Math.min(Math.max(avg, lo), hi);
        const topPct = (yFor(avgClamp) / 100 * 100).toFixed(2);
        const outOfRange = (avg < lo || avg > hi) ? ' *' : '';
        return `
            <div class="avg-marker" style="top:${topPct}%;color:${color};">
                <span class="k">${label}</span>${Number(avg).toFixed(2)}${outOfRange}
            </div>`;
    }

    function fmtTick(v, metric) {
        const abs = Math.abs(v);
        if (metric === 'Sky exposure' || metric === BODY_COMBINED_METRIC) return v.toFixed(2);
        if (abs < 1) return v.toFixed(2);
        if (abs < 10) return v.toFixed(1);
        return v.toFixed(0);
    }

    // ---------- Body chart (Fatigue + Heat) ----------
    function applyBodyChartSettings() {
        if (!bodyChart) return;
        const fatigueData = bodyChart.data.datasets[0]?.data || [];
        const heatData = bodyChart.data.datasets[1]?.data || [];
        const cfg = getBodyAxisConfig(fatigueData, heatData);
        const fatigueColor = getBodyMetricColor('Fatigue');
        const heatColor = getBodyMetricColor('Heat Load');

        bodyChart.data.datasets[0].borderColor = fatigueColor;
        bodyChart.data.datasets[0].backgroundColor = hexToRgba(fatigueColor, 0.10);
        bodyChart.data.datasets[0].pointBackgroundColor = fatigueColor;
        bodyChart.data.datasets[1].borderColor = heatColor;
        bodyChart.data.datasets[1].backgroundColor = hexToRgba(heatColor, 0.10);
        bodyChart.data.datasets[1].pointBackgroundColor = heatColor;
        bodyChart.options.scales.y.min = cfg.lo;
        bodyChart.options.scales.y.max = cfg.hi;
        bodyChart.options.scales.y.ticks.count = cfg.intervalCount + 1;
        bodyChart.options.scales.y.ticks.stepSize = (cfg.hi - cfg.lo) / cfg.intervalCount;
        bodyChart.update('none');
    }

    function initBodyChart() {
        const ctx = document.getElementById('body-chart').getContext('2d');
        if (bodyChart) bodyChart.destroy();

        const steps = currentResult.per_step;
        const labels = ['Start', ...steps.map((_, i) => `${i + 1}`)];
        const fatigueData = [0, ...steps.map(s => s.fatigue_after)];
        const heatData    = [0, ...steps.map(s => s.heat_after)];
        const bodyAxisCfg = getBodyAxisConfig(fatigueData, heatData);
        const fatigueColor = getBodyMetricColor('Fatigue');
        const heatColor = getBodyMetricColor('Heat Load');

        bodyChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Fatigue',
                        data: fatigueData,
                        borderColor: fatigueColor,
                        backgroundColor: hexToRgba(fatigueColor, 0.10),
                        pointBackgroundColor: fatigueColor,
                        fill: true, tension: 0.25,
                        pointRadius: 2, pointHoverRadius: 5,
                    },
                    {
                        label: 'Heat Load',
                        data: heatData,
                        borderColor: heatColor,
                        backgroundColor: hexToRgba(heatColor, 0.10),
                        pointBackgroundColor: heatColor,
                        fill: true, tension: 0.25,
                        pointRadius: 2, pointHoverRadius: 5,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: { min: bodyAxisCfg.lo, max: bodyAxisCfg.hi,
                        title: { display: true, text: 'Load (0–1)', font: { size: 10 } },
                        ticks: {
                            font: { size: 10 },
                            count: bodyAxisCfg.intervalCount + 1,
                            stepSize: (bodyAxisCfg.hi - bodyAxisCfg.lo) / bodyAxisCfg.intervalCount,
                        } },
                    x: {
                        title: { display: true, text: 'Step', font: { size: 10 } },
                        ticks: { font: { size: 9 }, maxTicksLimit: 20 },
                    },
                },
                plugins: {
                    legend: { position: 'top', labels: { font: { size: 11 }, boxWidth: 12 } },
                    tooltip: { mode: 'index', intersect: false },
                },
                animation: { duration: 150 },
            },
            plugins: [stepHighlightPlugin()],
        });
    }

    function stepHighlightPlugin() {
        return {
            id: 'stepHighlight',
            afterDraw(chartInstance) {
                const meta = chartInstance.getDatasetMeta(0);
                if (!meta.data[currentStep]) return;
                const x = meta.data[currentStep].x;
                const { top, bottom } = chartInstance.chartArea;
                const c = chartInstance.ctx;
                c.save();
                c.beginPath();
                c.moveTo(x, top); c.lineTo(x, bottom);
                c.lineWidth = 2;
                c.strokeStyle = 'rgba(9,132,227,0.6)';
                c.stroke();
                c.beginPath();
                c.arc(x, top, 4, 0, Math.PI * 2);
                c.fillStyle = '#0984e3';
                c.fill();
                c.restore();
            },
        };
    }

    // ---------- Color helpers ----------
    function thermalColor(value, table) {
        if (value == null || Number.isNaN(value)) return '#cbd5e1';
        let c = table[0].color;
        for (const t of table) { if (value >= t.lim) c = t.color; }
        return c;
    }
    function gradientColor(t) {
        if (t <= 0) return '#7fcfe0';
        if (t >= 1) return '#d63031';
        if (t < 0.33) return lerpHex('#7fcfe0', '#ffe97a', t / 0.33);
        if (t < 0.66) return lerpHex('#ffe97a', '#ffb45a', (t - 0.33) / 0.33);
        return lerpHex('#ffb45a', '#d63031', (t - 0.66) / 0.34);
    }
    function lerpHex(a, b, t) {
        const pa = hex2rgb(a), pb = hex2rgb(b);
        const r = Math.round(pa[0] + (pb[0] - pa[0]) * t);
        const g = Math.round(pa[1] + (pb[1] - pa[1]) * t);
        const bl= Math.round(pa[2] + (pb[2] - pa[2]) * t);
        return `rgb(${r},${g},${bl})`;
    }
    function hex2rgb(h) {
        h = h.replace('#', '');
        return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }
    function colorForMetric(metric, value, min, max) {
        if (value == null || Number.isNaN(value)) return '#cbd5e1';
        // User-picked color overrides the gradient/thermal scheme entirely.
        if (metricColors[metric]) return metricColors[metric];
        if (metric === 'UTCI') return thermalColor(value, UTCI_COLORS);
        if (metric === 'PET')  return thermalColor(value, PET_COLORS);
        if (BODY_METRICS.includes(metric)) return DEFAULT_PICKER_COLOR[metric] || '#0984e3';
        const t = (max === min) ? 0.5 : (value - min) / (max - min);
        return gradientColor(Math.max(0, Math.min(1, t)));
    }
    function computeExtents(arr) {
        let lo = Infinity, hi = -Infinity;
        for (const v of arr) {
            if (v == null || Number.isNaN(v)) continue;
            if (v < lo) lo = v;
            if (v > hi) hi = v;
        }
        if (!Number.isFinite(lo)) return [0, 1];
        if (lo === hi) hi = lo + 1;
        return [lo, hi];
    }

    // ---------- Path helpers ----------
    function toLabel(value, bands, labels) {
        for (let i = 0; i < bands.length; i++) {
            if (value < bands[i]) return labels[i];
        }
        return labels[labels.length - 1];
    }

    function buildWalkedPath(upToStep) {
        const path = [currentResult.start_node];
        for (let i = 0; i < upToStep && i < currentResult.per_step.length; i++) {
            const s = currentResult.per_step[i];
            if (s.action === 'walk' && s.next_node) path.push(s.next_node);
        }
        return path;
    }

    function getNodeAtStep(step) {
        if (step === 0) return currentResult.start_node;
        for (let i = Math.min(step, currentResult.per_step.length) - 1; i >= 0; i--) {
            const s = currentResult.per_step[i];
            if (s.action === 'walk' && s.next_node) return s.next_node;
            if (s.node_before) return s.node_before;
        }
        return currentResult.start_node;
    }

    // ---------- Print / download chart helpers ----------
    function escapeXml(s) {
        return String(s).replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
        }[c]));
    }

    function downloadDataUrlAsPng(dataUrl, filename) {
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
    }

    // Render a Chart.js chart instance to a white-backgrounded PNG and download.
    function downloadChartJsAsPng(chartInstance, filename, size = null) {
        if (!chartInstance) return;
        const src = chartInstance.canvas;
        const w = size?.width || src.width;
        const h = size?.height || src.height;
        const out = document.createElement('canvas');
        out.width = w; out.height = h;
        const ctx = out.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        if (size?.preserveAspect) {
            const scale = Math.min(w / src.width, h / src.height);
            const drawW = src.width * scale;
            const drawH = src.height * scale;
            const x = (w - drawW) / 2;
            const y = (h - drawH) / 2;
            ctx.drawImage(src, x, y, drawW, drawH);
        } else {
            ctx.drawImage(src, 0, 0, w, h);
        }
        downloadDataUrlAsPng(out.toDataURL('image/png'), filename);
    }

    function downloadSegRoseAsPng() {
        if (!roseChart) return;
        const canvas = document.createElement('canvas');
        canvas.width = SEG_PRINT_SIZE.width;
        canvas.height = SEG_PRINT_SIZE.height;
        canvas.style.width = `${SEG_PRINT_SIZE.width}px`;
        canvas.style.height = `${SEG_PRINT_SIZE.height}px`;
        const ctx = canvas.getContext('2d');

        const exportChart = new Chart(ctx, {
            type: 'pie',
            data: {
                labels: [...roseChart.data.labels],
                datasets: roseChart.data.datasets.map(ds => ({
                    ...ds,
                    data: [...ds.data],
                    backgroundColor: [...ds.backgroundColor],
                    borderColor: ds.borderColor || '#ffffff',
                    borderWidth: Math.max(3, Math.round(SEG_PRINT_SIZE.width / 800)),
                })),
            },
            options: {
                responsive: false,
                maintainAspectRatio: false,
                animation: false,
                layout: {
                    padding: {
                        top: SEG_PRINT_SIZE.padding,
                        right: SEG_PRINT_SIZE.padding,
                        bottom: SEG_PRINT_SIZE.padding,
                        left: SEG_PRINT_SIZE.padding,
                    },
                },
                plugins: {
                    legend: {
                        position: 'right',
                        labels: {
                            font: { size: SEG_PRINT_SIZE.legendFontSize },
                            boxWidth: Math.round(SEG_PRINT_SIZE.legendFontSize * 1.2),
                            padding: Math.round(SEG_PRINT_SIZE.legendFontSize * 0.9),
                        },
                    },
                    tooltip: { enabled: false },
                    piePercentLabels: {
                        fontSize: SEG_PRINT_SIZE.labelFontSize,
                        lineWidth: SEG_PRINT_SIZE.labelLineWidth,
                        radialGap: Math.round(SEG_PRINT_SIZE.labelFontSize * 0.75),
                        elbow: Math.round(SEG_PRINT_SIZE.labelFontSize * 0.9),
                        textGap: Math.round(SEG_PRINT_SIZE.labelFontSize * 0.3),
                    },
                },
            },
            plugins: [piePercentLabelsPlugin],
        });

        ctx.save();
        ctx.globalCompositeOperation = 'destination-over';
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.restore();
        downloadDataUrlAsPng(canvas.toDataURL('image/png'), 'element_composition.png');
        exportChart.destroy();
    }

    function downloadSegBarAsPng() {
        const composition = getAverageSegComposition();
        if (!composition.count) return;

        const canvas = document.createElement('canvas');
        canvas.width = SEG_BAR_PRINT_SIZE.width;
        canvas.height = SEG_BAR_PRINT_SIZE.height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const total = composition.values.reduce((a, b) => a + b, 0) || 1;
        const segments = SEG_KEYS.map((k, i) => ({
            key: k,
            pct: (composition.values[i] / total) * 100,
            color: effectiveSegColor(k),
        }));

        const plotLeft = SEG_BAR_PRINT_SIZE.paddingLeft;
        const plotRight = canvas.width - SEG_BAR_PRINT_SIZE.paddingRight;
        const plotTop = SEG_BAR_PRINT_SIZE.paddingY;
        const plotBottom = canvas.height - SEG_BAR_PRINT_SIZE.paddingY;
        const plotW = plotRight - plotLeft;
        const plotH = plotBottom - plotTop;
        const yFor = (pct) => plotBottom - (Math.max(0, Math.min(100, pct)) / 100) * plotH;

        ctx.save();
        const barW = Math.min(SEG_BAR_PRINT_SIZE.barWidth, plotW);
        const barX = plotLeft + (plotW - barW) / 2;
        const barRight = barX + barW;
        let yCursor = plotBottom;
        segments.forEach((seg) => {
            const h = plotH * (seg.pct / 100);
            const yTop = yCursor - h;
            ctx.fillStyle = hexWithAlpha(seg.color, 0.36);
            ctx.fillRect(barX, yTop, barW, h);
            ctx.lineWidth = Math.max(3, SEG_BAR_PRINT_SIZE.axisWidth);
            ctx.strokeStyle = seg.color;
            ctx.strokeRect(barX, yTop, barW, h);
            if (seg.pct > 0.05 && h > SEG_BAR_PRINT_SIZE.labelFontSize * 0.7) {
                ctx.fillStyle = seg.color;
                ctx.font = `700 ${SEG_BAR_PRINT_SIZE.labelFontSize}px system-ui, -apple-system, sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(`${seg.pct.toFixed(1)}%`, barX + barW / 2, yTop + h / 2);
            }
            yCursor = yTop;
        });
        ctx.restore();

        downloadDataUrlAsPng(canvas.toDataURL('image/png'), 'element_composition_bar.png');
    }

    // Build a self-contained printable SVG row for one env metric, positioned
    // at (x, y) inside a parent SVG with width `w` and height `h`.
    function buildEnvPrintRow(metric, x, y, w, h) {
        if (metric === BODY_COMBINED_METRIC) {
            return buildBodyCombinedPrintRow(x, y, w, h);
        }

        const PAD_L = 64, PAD_R = 96, PAD_T = 35, PAD_B = 36;
        const plotX = x + PAD_L;
        const plotY = y + PAD_T;
        const plotW = Math.max(50, w - PAD_L - PAD_R);
        const plotH = Math.max(40, h - PAD_T - PAD_B);

        const values = envSeries[metric] || [];
        const clean = values.filter(v => v != null && !Number.isNaN(v));
        const avg = clean.length ? clean.reduce((a, b) => a + b, 0) / clean.length : null;
        const [lo, hi] = getAxisRange(metric, values);
        const n = values.length;
        const yFor = (v) => {
            if (hi === lo) return plotY + plotH;
            const t = (v - lo) / (hi - lo);
            return plotY + (1 - Math.max(0, Math.min(1, t))) * plotH;
        };
        const xFor = (i, off = 0.5) =>
            plotX + ((i + off) / Math.max(1, n)) * plotW;

        let out = '';
        const unit = ENV_UNITS[metric] || '';
        const titleTxt = `${metric}${unit ? ' (' + unit + ')' : ''}`;
        out += `<text x="${(x + 8).toFixed(2)}" y="${(y + 16).toFixed(2)}" font-size="24" font-weight="700" fill="#7f8c8d" font-family="system-ui,-apple-system,sans-serif">${escapeXml(titleTxt)}</text>`;

        const tickVals = makeTickVals(lo, hi, getAxisIntervalCount(metric));
        for (const tv of tickVals) {
            const yp = yFor(tv);
            out += `<line x1="${plotX.toFixed(2)}" y1="${yp.toFixed(2)}" x2="${(plotX + plotW).toFixed(2)}" y2="${yp.toFixed(2)}" stroke="#eef1f5" stroke-width="1"/>`;
            out += `<text x="${(plotX - 6).toFixed(2)}" y="${yp.toFixed(2)}" font-size="20" fill="#7f8c8d" text-anchor="end" dominant-baseline="middle" font-family="system-ui,sans-serif">${escapeXml(fmtTick(tv, metric))}</text>`;
        }
        for (let i = 0; i < n; i++) {
            const xp = xFor(i);
            out += `<line x1="${xp.toFixed(2)}" y1="${plotY.toFixed(2)}" x2="${xp.toFixed(2)}" y2="${(plotY + plotH).toFixed(2)}" stroke="#eef1f5" stroke-width="1" opacity="0.55"/>`;
        }

        const lineColor = metricColors[metric] || DEFAULT_PICKER_COLOR[metric] || '#0984e3';
        if (envChartType === 'line') {
            const pts = [];
            const dots = [];
            let firstX = null, lastX = null;
            values.forEach((v, i) => {
                if (v == null || Number.isNaN(v)) return;
                const vClamp = Math.min(Math.max(v, lo), hi);
                const xp = xFor(i);
                const yp = yFor(vClamp);
                if (firstX === null) firstX = xp;
                lastX = xp;
                pts.push(`${xp.toFixed(2)},${yp.toFixed(2)}`);
                dots.push(`<circle cx="${xp.toFixed(2)}" cy="${yp.toFixed(2)}" r="2" fill="${lineColor}"/>`);
            });
            if (pts.length >= 2) {
                const baseY = (plotY + plotH).toFixed(2);
                const fillPts = [`${firstX.toFixed(2)},${baseY}`, ...pts, `${lastX.toFixed(2)},${baseY}`];
                out += `<polygon points="${fillPts.join(' ')}" fill="${lineColor}" fill-opacity="0.18" stroke="none"/>`;
            }
            if (pts.length) {
                out += `<polyline points="${pts.join(' ')}" fill="none" stroke="${lineColor}" stroke-width="${Number(envLineWidth).toFixed(2)}" stroke-linejoin="round" stroke-linecap="round"/>`;
            }
            out += dots.join('');
        } else {
            const slotW = n > 0 ? plotW / n : plotW;
            const gapW = 0.12 * slotW;
            const barW = Math.max(0.5, slotW - gapW);
            const baseY = yFor(lo);
            values.forEach((v, i) => {
                if (v == null || Number.isNaN(v)) return;
                const vClamp = Math.min(Math.max(v, lo), hi);
                const yTop = yFor(vClamp);
                const top = Math.min(yTop, baseY);
                const bh = Math.abs(baseY - yTop);
                const xp = plotX + (i / n) * plotW + gapW / 2;
                const color = colorForMetric(metric, v, lo, hi);
                out += `<rect x="${xp.toFixed(2)}" y="${top.toFixed(2)}" width="${barW.toFixed(2)}" height="${Math.max(0, bh).toFixed(2)}" fill="${color}"/>`;
            });
        }

        if (avg != null) {
            const avgClamp = Math.min(Math.max(avg, lo), hi);
            const yAvg = yFor(avgClamp);
            out += `<line x1="${plotX.toFixed(2)}" y1="${yAvg.toFixed(2)}" x2="${(plotX + plotW).toFixed(2)}" y2="${yAvg.toFixed(2)}" stroke="#7f8c8d" stroke-width="1.2" stroke-dasharray="4,3" opacity="0.85"/>`;
            const avgTxt = `mean ${avg.toFixed(2)}${unit ? ' ' + unit : ''}`;
            out += `<text x="${(plotX + plotW - 4).toFixed(2)}" y="${(yAvg - 10).toFixed(2)}" font-size="24" fill="#7f8c8d" text-anchor="end" font-family="monospace" dominant-baseline="auto">${escapeXml(avgTxt)}</text>`;
        }

        for (let i = 0; i < n; i++) {
            const xp = xFor(i);
            out += `<text x="${xp.toFixed(2)}" y="${(plotY + plotH + 14).toFixed(2)}" font-size="20" fill="#7f8c8d" text-anchor="middle" font-family="system-ui,sans-serif">${i + 1}</text>`;
        }

        return out;
    }

    function buildBodyCombinedPrintRow(x, y, w, h) {
        const PAD_L = 64, PAD_R = 96, PAD_T = 35, PAD_B = 36;
        const plotX = x + PAD_L;
        const plotY = y + PAD_T;
        const plotW = Math.max(50, w - PAD_L - PAD_R);
        const plotH = Math.max(40, h - PAD_T - PAD_B);
        const fatigueValues = envSeries['Fatigue'] || [];
        const heatValues = envSeries['Heat Load'] || [];
        const [lo, hi] = getAxisRange(BODY_COMBINED_METRIC, [...fatigueValues, ...heatValues]);
        const n = Math.max(fatigueValues.length, heatValues.length);
        const fatigueColor = getBodyMetricColor('Fatigue');
        const heatColor = getBodyMetricColor('Heat Load');
        const yFor = (v) => {
            if (hi === lo) return plotY + plotH;
            const t = (v - lo) / (hi - lo);
            return plotY + (1 - Math.max(0, Math.min(1, t))) * plotH;
        };
        const xFor = (i) => plotX + ((i + 0.5) / Math.max(1, n)) * plotW;

        let out = '';
        out += `<text x="${(x + 8).toFixed(2)}" y="${(y + 16).toFixed(2)}" font-size="24" font-weight="700" fill="#7f8c8d" font-family="system-ui,-apple-system,sans-serif">Fatigue &amp; Heat Load</text>`;

        const tickVals = makeTickVals(lo, hi, getAxisIntervalCount(BODY_COMBINED_METRIC));
        for (const tv of tickVals) {
            const yp = yFor(tv);
            out += `<line x1="${plotX.toFixed(2)}" y1="${yp.toFixed(2)}" x2="${(plotX + plotW).toFixed(2)}" y2="${yp.toFixed(2)}" stroke="#eef1f5" stroke-width="1"/>`;
            out += `<text x="${(plotX - 6).toFixed(2)}" y="${yp.toFixed(2)}" font-size="20" fill="#7f8c8d" text-anchor="end" dominant-baseline="middle" font-family="system-ui,sans-serif">${escapeXml(fmtTick(tv, BODY_COMBINED_METRIC))}</text>`;
        }
        for (let i = 0; i < n; i++) {
            const xp = xFor(i);
            out += `<line x1="${xp.toFixed(2)}" y1="${plotY.toFixed(2)}" x2="${xp.toFixed(2)}" y2="${(plotY + plotH).toFixed(2)}" stroke="#eef1f5" stroke-width="1" opacity="0.55"/>`;
        }

        out += printBodySeriesSvg(fatigueValues, fatigueColor, xFor, yFor, lo, hi);
        out += printBodySeriesSvg(heatValues, heatColor, xFor, yFor, lo, hi);

        const avgFatigue = averageOrNull(fatigueValues);
        const avgHeat = averageOrNull(heatValues);
        if (avgFatigue != null) {
            const yAvg = yFor(Math.min(Math.max(avgFatigue, lo), hi));
            out += `<line x1="${plotX.toFixed(2)}" y1="${yAvg.toFixed(2)}" x2="${(plotX + plotW).toFixed(2)}" y2="${yAvg.toFixed(2)}" stroke="#7f8c8d" stroke-width="1.2" stroke-dasharray="4,3" opacity="0.85"/>`;
            out += `<text x="${(plotX + plotW - 4).toFixed(2)}" y="${(yAvg - 6).toFixed(2)}" font-size="24" fill="#7f8c8d" text-anchor="end" font-family="monospace" dominant-baseline="auto">F avg ${avgFatigue.toFixed(2)}</text>`;
        }
        if (avgHeat != null) {
            const yAvg = yFor(Math.min(Math.max(avgHeat, lo), hi));
            out += `<line x1="${plotX.toFixed(2)}" y1="${yAvg.toFixed(2)}" x2="${(plotX + plotW).toFixed(2)}" y2="${yAvg.toFixed(2)}" stroke="#7f8c8d" stroke-width="1.2" stroke-dasharray="4,3" opacity="0.85"/>`;
            out += `<text x="${(plotX + plotW - 4).toFixed(2)}" y="${(yAvg - 4).toFixed(2)}" font-size="24" fill="#7f8c8d" text-anchor="end" font-family="monospace" dominant-baseline="auto">H avg ${avgHeat.toFixed(2)}</text>`;
        }

        for (let i = 0; i < n; i++) {
            const xp = xFor(i);
            out += `<text x="${xp.toFixed(2)}" y="${(plotY + plotH + 14).toFixed(2)}" font-size="20" fill="#7f8c8d" text-anchor="middle" font-family="system-ui,sans-serif">${i + 1}</text>`;
        }
        return out;
    }

    function printBodySeriesSvg(values, color, xFor, yFor, lo, hi) {
        const pts = [];
        values.forEach((v, i) => {
            if (v == null || Number.isNaN(v)) return;
            const vClamp = Math.min(Math.max(v, lo), hi);
            pts.push(`${xFor(i).toFixed(2)},${yFor(vClamp).toFixed(2)}`);
        });
        return pts.length
            ? `<polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="${Number(envLineWidth).toFixed(2)}" stroke-linejoin="round" stroke-linecap="round"/>`
            : '';
    }

    function averageOrNull(values) {
        const clean = values.filter(v => v != null && !Number.isNaN(v));
        return clean.length ? clean.reduce((a, b) => a + b, 0) / clean.length : null;
    }

    async function printEnvCharts() {
        if (!currentResult) return;
        const metrics = ENV_METRICS.filter(m => selectedEnvMetrics.has(m));
        if (!metrics.length) { alert('Select at least one metric to print.'); return; }

        const W = 1800, ROW_H = 140, GAP = 15, TOP_PAD = 20, BOTTOM_PAD = 10;
        const totalH = TOP_PAD + metrics.length * ROW_H + (metrics.length - 1) * GAP + BOTTOM_PAD;

        let inner = `<rect width="${W}" height="${totalH}" fill="#ffffff"/>`;
        metrics.forEach((m, i) => {
            const yOff = TOP_PAD + i * (ROW_H + GAP);
            inner += buildEnvPrintRow(m, 0, yOff, W, ROW_H);
        });
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${totalH}" viewBox="0 0 ${W} ${totalH}">${inner}</svg>`;

        const SCALE = 2;
        const dataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
        const img = new Image();
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = () => reject(new Error('SVG render failed'));
            img.src = dataUrl;
        });
        const canvas = document.createElement('canvas');
        canvas.width = W * SCALE;
        canvas.height = totalH * SCALE;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        downloadDataUrlAsPng(canvas.toDataURL('image/png'), 'env_timelines.png');
    }

    const btnPrintEnv  = document.getElementById('btn-print-env');
    const btnPrintBody = document.getElementById('btn-print-body');
    const btnPrintSeg  = document.getElementById('btn-print-seg');
    if (btnPrintEnv) {
        btnPrintEnv.addEventListener('click', async () => {
            btnPrintEnv.disabled = true;
            const orig = btnPrintEnv.textContent;
            btnPrintEnv.textContent = 'Preparing…';
            try { await printEnvCharts(); }
            catch (e) { alert('Failed to export: ' + (e.message || e)); }
            finally {
                btnPrintEnv.textContent = orig;
                btnPrintEnv.disabled = false;
            }
        });
    }
    if (btnPrintBody) {
        btnPrintBody.addEventListener('click', () => {
            if (!bodyChart) { alert('Load a result first.'); return; }
            downloadChartJsAsPng(bodyChart, 'fatigue_heat_timeline.png');
        });
    }
    if (btnPrintSeg) {
        btnPrintSeg.addEventListener('click', () => {
            if (!roseChart) { alert('Load a result first.'); return; }
            downloadSegRoseAsPng();
        });
    }
    if (btnPrintSegBar) {
        btnPrintSegBar.addEventListener('click', () => {
            if (!currentResult || !routeSteps.length) { alert('Load a result first.'); return; }
            downloadSegBarAsPng();
        });
    }

    // ---------- Map show / hide toggle (bottom-left circular button) ----------
    (function wireMapToggle() {
        const btnToggleMap = document.getElementById('btn-toggle-map');
        if (!btnToggleMap) return;
        function sync() {
            const hidden = document.body.classList.contains('map-hidden');
            btnToggleMap.classList.toggle('active', !hidden);
            btnToggleMap.title = hidden ? 'Show route map' : 'Hide route map';
        }
        btnToggleMap.addEventListener('click', () => {
            document.body.classList.toggle('map-hidden');
            sync();
        });
        sync();
    })();

    // ---------- Floating map: top-right corner resize handle ----------
    (function attachMapResizeHandle() {
        if (!mapPortrait || mapPortrait.querySelector('.map-resize-handle')) return;
        const handle = document.createElement('div');
        handle.className = 'map-resize-handle';
        handle.title = 'Drag to resize';
        mapPortrait.appendChild(handle);

        let startX = 0, startY = 0, startW = 0, startH = 0;
        function onMove(e) {
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            const newW = Math.max(240, startW + dx);
            const newH = Math.max(240, startH - dy);
            mapPortrait.style.width  = newW + 'px';
            mapPortrait.style.height = newH + 'px';
        }
        function onUp() {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        }
        handle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const rect = mapPortrait.getBoundingClientRect();
            startX = e.clientX; startY = e.clientY;
            startW = rect.width; startH = rect.height;
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    })();
})();
