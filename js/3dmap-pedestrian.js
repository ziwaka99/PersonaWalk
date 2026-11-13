(() => {
    'use strict';

    const api = window.PersonaWalk3D;
    if (!api) return;

    const ENV_METRICS = ['Sky exposure', 'Windspeed', 'MRT', 'UTCI', 'PET'];
    const BODY_METRIC = 'Fatigue & Heat Load';
    const CHART_METRICS = [...ENV_METRICS, BODY_METRIC];
    const UNITS = { 'Sky exposure': '', Windspeed: 'm/s', MRT: '°C', UTCI: '°C', PET: '°C', [BODY_METRIC]: '0–1' };
    const COLORS = {
        'Sky exposure': '#ffd35c',
        Windspeed: '#45d9ff',
        MRT: '#ff826a',
        UTCI: '#b998ff',
        PET: '#65d58a',
        Fatigue: '#ffa95c',
        'Heat Load': '#ff5d73',
    };
    const SEG_KEYS = ['Sky', 'Greenery', 'Topo', 'Building', 'Pavement'];
    const SEG_COLORS = { Sky: '#45d9ff', Greenery: '#65d58a', Topo: '#ffd35c', Building: '#b998ff', Pavement: '#9da3a6' };
    const FATIGUE_LABELS = ['fresh', 'warming up', 'tired', 'exhausted'];
    const HEAT_LABELS = ['comfortable', 'warm', 'hot', 'overheating'];
    const METRICS_KEY = 'personaWalk.3dmap.pedMetrics.v1';
    const SV_SOURCE_KEY = 'personaWalk.3dmap.svSource.v1';
    const PED_LAYERS = ['ped-route-casing', 'ped-route-line', 'ped-walked-line', 'ped-endpoints', 'ped-agent-halo', 'ped-agent-dot'];

    const el = id => document.getElementById(id);
    const dom = {
        left: el('ped-left'),
        right: el('ped-right'),
        count: el('ped-count'),
        search: el('ped-search'),
        list: el('ped-list'),
        viewImg: el('ped-view-img'),
        pano: el('ped-pano'),
        model: el('ped-model'),
        viewBox: el('ped-view'),
        viewExpand: el('ped-view-expand'),
        overlay: el('street-overlay'),
        overlayBody: el('street-overlay-body'),
        overlayTitle: el('street-overlay-title'),
        overlayClose: el('street-overlay-close'),
        svModel: el('sv-model'),
        svRendered: el('sv-rendered'),
        svGoogle: el('sv-google'),
        viewEmpty: el('ped-view-empty'),
        viewPrev: el('ped-view-prev'),
        viewNext: el('ped-view-next'),
        viewIndex: el('ped-view-index'),
        viewCaption: el('ped-view-caption'),
        stepText: el('ped-step'),
        prev: el('ped-prev'),
        play: el('ped-play'),
        next: el('ped-next'),
        speed: el('ped-speed'),
        slider: el('ped-slider'),
        card: el('ped-card'),
        status: el('ped-status'),
        hud: el('ped-hud'),
        title: el('ped-title'),
        rightEmpty: el('ped-right-empty'),
        rightContent: el('ped-right-content'),
        segCount: el('ped-seg-count'),
        seg: el('ped-seg'),
        chips: el('ped-metric-chips'),
        charts: el('ped-charts'),
    };

    let ctx = null;
    let filterText = '';
    let currentFile = null;
    let current = null;
    let walks = [];
    let series = {};
    let plannedDistance = 0;
    let step = 0;
    let viewIdx = -1;
    let playing = false;
    let playTimer = null;
    let animFrame = null;
    let loadToken = 0;
    let selectedMetrics = loadSelectedMetrics();
    let svSource = (() => {
        try {
            const stored = localStorage.getItem(SV_SOURCE_KEY);
            return ['model', 'rendered', 'google'].includes(stored) ? stored : 'model';
        } catch { return 'model'; }
    })();
    const EYE_HEIGHT_M = 1.7;
    const EYE_PITCH = 82;
    let eyeMap = null;
    let eyeReady = false;
    let eyeBearing = null;
    let eyeLastFrame = 0;
    let eyePending = null;
    let svManifest = null;
    let panoViewer = null;
    let shownPano = null;
    let panoLoading = false;
    let queuedPano = null;

    function loadSelectedMetrics() {
        try {
            const stored = JSON.parse(localStorage.getItem(METRICS_KEY));
            if (Array.isArray(stored)) return new Set(stored.filter(m => CHART_METRICS.includes(m)));
        } catch { /* storage is optional */ }
        return new Set(['Sky exposure', 'UTCI', BODY_METRIC]);
    }

    function saveSelectedMetrics() {
        try { localStorage.setItem(METRICS_KEY, JSON.stringify([...selectedMetrics])); } catch { /* storage is optional */ }
    }

    function escapeHtml(value) {
        return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
    }

    function num(value) {
        const n = Number(value);
        return value != null && Number.isFinite(n) ? n : null;
    }

    function fmt(value, digits = 2) {
        const n = num(value);
        return n == null ? '–' : n.toFixed(digits);
    }

    function setStatus(message, isError = false) {
        dom.status.textContent = message;
        dom.status.classList.toggle('error', isError);
    }

    function emptyGeoJson() {
        return { type: 'FeatureCollection', features: [] };
    }

    // ---------- Graph helpers ----------
    function lngLat(nodeId) {
        const node = ctx.nodeById.get(String(nodeId));
        if (!node) return null;
        const lng = Number(node.lng);
        const lat = Number(node.lat);
        return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null;
    }

    function edgeFor(a, b) {
        return ctx.edgeByNodes.get(`${a}|${b}`) || ctx.edgeByNodes.get(`${b}|${a}`) || null;
    }

    function totalSteps() {
        return current ? current.per_step.length : 0;
    }

    function nodeAtStep(k) {
        if (k === 0) return current.start_node;
        for (let i = Math.min(k, totalSteps()) - 1; i >= 0; i -= 1) {
            const s = current.per_step[i];
            if (s.action === 'walk' && s.next_node) return s.next_node;
            if (s.node_before) return s.node_before;
        }
        return current.start_node;
    }

    function walkedNodes(k) {
        const nodes = [current.start_node];
        for (let i = 0; i < k && i < totalSteps(); i += 1) {
            const s = current.per_step[i];
            if (s.action === 'walk' && s.next_node) nodes.push(s.next_node);
        }
        return nodes;
    }

    function walkedDistance(k) {
        let total = 0;
        for (let i = 0; i < k && i < totalSteps(); i += 1) {
            const s = current.per_step[i];
            if (s.action !== 'walk' || !s.next_node) continue;
            const edge = edgeFor(s.node_before, s.next_node);
            if (edge && num(edge.length) != null) total += Number(edge.length);
        }
        return total;
    }

    function pathDistance(path) {
        let total = 0;
        for (let i = 0; i < (path || []).length - 1; i += 1) {
            const edge = edgeFor(path[i], path[i + 1]);
            if (edge && num(edge.length) != null) total += Number(edge.length);
        }
        return total;
    }

    function buildWalks() {
        walks = [];
        current.per_step.forEach(s => {
            if (s.action !== 'walk' || !s.node_before || !s.next_node) return;
            const edge = ctx.edgeByNodes.get(`${s.node_before}|${s.next_node}`) || edgeFor(s.node_before, s.next_node);
            if (!edge) return;
            walks.push({ step: s.step, route: edge.route, dir: edge.dir || 1, seg: edge.segmentation || null });
        });
    }

    function buildSeries() {
        series = { Fatigue: [], 'Heat Load': [] };
        ENV_METRICS.forEach(m => { series[m] = []; });
        const last = Object.fromEntries(ENV_METRICS.map(m => [m, null]));
        for (const s of current.per_step) {
            if (s.action === 'walk' && s.node_before && s.next_node) {
                const edge = ctx.edgeByNodes.get(`${s.node_before}|${s.next_node}`) || edgeFor(s.node_before, s.next_node);
                const source = edge ? (edge.sim || edge) : null;
                if (source) ENV_METRICS.forEach(m => { if (num(source[m]) != null) last[m] = Number(source[m]); });
            }
            ENV_METRICS.forEach(m => series[m].push(last[m]));
            series.Fatigue.push(num(s.fatigue_after));
            series['Heat Load'].push(num(s.heat_after));
        }
    }

    // ---------- Map layers ----------
    function addLayers() {
        const { map } = ctx;
        map.addSource('ped-route', { type: 'geojson', data: emptyGeoJson() });
        map.addSource('ped-walked', { type: 'geojson', data: emptyGeoJson() });
        map.addSource('ped-endpoints', { type: 'geojson', data: emptyGeoJson() });
        map.addSource('ped-agent', { type: 'geojson', data: emptyGeoJson() });

        const lineLayout = { 'line-cap': 'round', 'line-join': 'round' };
        map.addLayer({
            id: 'ped-route-casing', type: 'line', source: 'ped-route', layout: lineLayout,
            paint: { 'line-color': '#050607', 'line-opacity': 0.8, 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 5, 17, 11] },
        });
        map.addLayer({
            id: 'ped-route-line', type: 'line', source: 'ped-route', layout: lineLayout,
            paint: {
                'line-color': '#e9ecee',
                'line-opacity': 0.6,
                'line-width': ['interpolate', ['linear'], ['zoom'], 13, 1.6, 17, 3.4],
                'line-dasharray': [1.4, 1.6],
            },
        });
        map.addLayer({
            id: 'ped-walked-line', type: 'line', source: 'ped-walked', layout: lineLayout,
            paint: { 'line-color': '#ff826a', 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 3, 17, 7] },
        });
        map.addLayer({
            id: 'ped-endpoints', type: 'circle', source: 'ped-endpoints',
            paint: {
                'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 4, 17, 7],
                'circle-color': ['match', ['get', 'kind'], 'start', '#65d58a', '#ffd35c'],
                'circle-stroke-color': '#050607',
                'circle-stroke-width': 2,
            },
        });
        map.addLayer({
            id: 'ped-agent-halo', type: 'circle', source: 'ped-agent',
            paint: {
                'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 10, 17, 20],
                'circle-color': '#ff826a',
                'circle-opacity': 0.25,
                'circle-blur': 0.5,
            },
        });
        map.addLayer({
            id: 'ped-agent-dot', type: 'circle', source: 'ped-agent',
            paint: {
                'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 4.5, 17, 8],
                'circle-color': '#ffffff',
                'circle-stroke-color': '#ff826a',
                'circle-stroke-width': 3,
            },
        });
        applyModeLayers();
    }

    function applyModeLayers() {
        if (!ctx) return;
        const visibility = api.getMode() === 'pedestrian' ? 'visible' : 'none';
        PED_LAYERS.forEach(id => { if (ctx.map.getLayer(id)) ctx.map.setLayoutProperty(id, 'visibility', visibility); });
    }

    function setLine(sourceId, coordinates) {
        const data = coordinates.length >= 2
            ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } }] }
            : emptyGeoJson();
        ctx.map.getSource(sourceId).setData(data);
    }

    function setAgent(coord) {
        ctx.map.getSource('ped-agent').setData(coord
            ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: coord } }] }
            : emptyGeoJson());
    }

    function drawRoute() {
        const coords = (current.path || []).map(lngLat).filter(Boolean);
        setLine('ped-route', coords);
        const features = [];
        const start = lngLat(current.start_node);
        const goal = lngLat(current.goal_node);
        if (start) features.push({ type: 'Feature', properties: { kind: 'start' }, geometry: { type: 'Point', coordinates: start } });
        if (goal) features.push({ type: 'Feature', properties: { kind: 'goal' }, geometry: { type: 'Point', coordinates: goal } });
        ctx.map.getSource('ped-endpoints').setData({ type: 'FeatureCollection', features });
    }

    function fitRoute() {
        const coords = [...(current.path || []), current.goal_node].map(lngLat).filter(Boolean);
        if (!coords.length) return;
        const bounds = coords.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(coords[0], coords[0]));
        const narrow = window.matchMedia('(max-width: 760px)').matches;
        ctx.map.fitBounds(bounds, {
            padding: narrow
                ? 40
                : { top: 110, bottom: 70, left: dom.left.hidden ? 60 : dom.left.offsetWidth + 50, right: dom.right.hidden ? 60 : dom.right.offsetWidth + 50 },
            maxZoom: 17.4,
            duration: 900,
        });
    }

    function cancelAnimation() {
        if (animFrame) cancelAnimationFrame(animFrame);
        animFrame = null;
    }

    function placeAgentAt(k) {
        cancelAnimation();
        setAgent(lngLat(nodeAtStep(k)));
        setLine('ped-walked', walkedNodes(k).map(lngLat).filter(Boolean));
    }

    function animateAgent(fromStep, toStep, duration) {
        cancelAnimation();
        const from = lngLat(nodeAtStep(fromStep));
        const to = lngLat(nodeAtStep(toStep));
        const base = walkedNodes(fromStep).map(lngLat).filter(Boolean);
        if (!from || !to || (from[0] === to[0] && from[1] === to[1])) {
            placeAgentAt(toStep);
            return;
        }
        const started = performance.now();
        const frame = now => {
            const t = Math.min(1, (now - started) / duration);
            const pos = [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
            setAgent(pos);
            setLine('ped-walked', [...base, pos]);
            syncPano(toStep, t);
            syncEye(toStep, pos, now);
            if (t < 1) animFrame = requestAnimationFrame(frame);
            else animFrame = null;
        };
        animFrame = requestAnimationFrame(frame);
    }

    // ---------- Persona list ----------
    function renderList() {
        const personas = ctx.resultsIndex;
        dom.count.textContent = `${personas.length} simulated walks`;
        const query = filterText.trim().toLowerCase();
        const rows = personas.filter(meta => !query || `${meta.persona_id} ${meta.filename} ${meta.provider}`.toLowerCase().includes(query));
        if (!rows.length) {
            dom.list.innerHTML = `<div class="loading-row">${personas.length ? 'No matching persona.' : 'No simulation results.'}</div>`;
            return;
        }
        dom.list.innerHTML = rows.map(meta => {
            const reached = meta.outcome === 'reached_goal';
            const active = meta.filename === currentFile;
            return `<button type="button" class="persona-row${active ? ' active' : ''}" role="option" aria-selected="${active}" data-file="${escapeHtml(meta.filename)}" title="${escapeHtml(meta.filename)}">
                <span class="persona-row-name">${escapeHtml(meta.persona_id || meta.filename)}</span>
                <span class="persona-row-meta"><i class="outcome-dot${reached ? ' ok' : ''}"></i>${escapeHtml(reached ? 'reached' : (meta.outcome || 'unknown'))} · ${Number(meta.total_steps) || 0} steps</span>
            </button>`;
        }).join('');
    }

    // ---------- Selection ----------
    async function selectPersona(filename) {
        stopPlayback();
        const token = ++loadToken;
        currentFile = filename;
        renderList();
        setStatus(`Loading ${filename}...`);
        let result;
        try {
            result = await ctx.fetchResult(filename);
        } catch (error) {
            if (token === loadToken) setStatus(`Could not load ${filename}`, true);
            return;
        }
        if (token !== loadToken) return;

        current = result;
        current.per_step = current.per_step || [];
        step = 0;
        viewIdx = -1;
        buildWalks();
        buildSeries();
        plannedDistance = pathDistance(current.path);

        dom.title.textContent = current.persona_id || filename;
        dom.rightEmpty.hidden = true;
        dom.rightContent.hidden = false;
        dom.right.classList.add('has-selection');
        [dom.prev, dom.play, dom.next, dom.slider].forEach(control => { control.disabled = false; });
        dom.slider.max = String(totalSteps());

        renderCard();
        renderSegPie();
        drawRoute();
        eyeBearing = null;
        updateEyeRoute();
        fitRoute();
        goToStep(0);
        setStatus(`${current.persona_id} · ${current.outcome || 'no outcome'} · ${totalSteps()} steps`);
    }

    function goToStep(target, options = {}) {
        if (!current) return;
        const previous = step;
        step = Math.max(0, Math.min(target, totalSteps()));
        dom.slider.value = String(step);
        dom.stepText.textContent = `Step ${step}/${totalSteps()}`;
        if (options.animate && step === previous + 1) animateAgent(previous, step, options.duration || 600);
        else placeAgentAt(step);
        renderHud();
        syncStreetView();
        renderCharts();
    }

    // ---------- Playback ----------
    function startPlayback() {
        if (!current) return;
        if (step >= totalSteps()) goToStep(0);
        playing = true;
        dom.play.textContent = 'Pause';
        dom.play.classList.add('active');
        playNext();
    }

    function stopPlayback() {
        playing = false;
        dom.play.textContent = 'Play';
        dom.play.classList.remove('active');
        if (playTimer) clearTimeout(playTimer);
        playTimer = null;
    }

    function playNext() {
        if (!playing || !current) return;
        if (step >= totalSteps()) {
            stopPlayback();
            return;
        }
        const interval = Number(dom.speed.value) || 1000;
        goToStep(step + 1, { animate: true, duration: interval * 0.85 });
        playTimer = setTimeout(playNext, interval);
    }

    // ---------- Street view ----------
    function usingPano() {
        return svSource === 'google' && !!svManifest && !!window.pannellum;
    }

    function usingModel() {
        return svSource === 'model';
    }

    function syncSourceButtons() {
        dom.svModel.classList.toggle('active', usingModel());
        dom.svRendered.classList.toggle('active', !usingModel() && !usingPano());
        dom.svGoogle.classList.toggle('active', usingPano());
        dom.svGoogle.disabled = !svManifest || !window.pannellum;
        dom.svGoogle.title = dom.svGoogle.disabled
            ? 'No panoramas yet: run python scripts/fetch_streetview.py'
            : 'Continuous 360° Google Street View';
    }

    function setSvSource(source) {
        svSource = source;
        try { localStorage.setItem(SV_SOURCE_KEY, source); } catch { /* storage is optional */ }
        syncSourceButtons();
        viewIdx = -1;
        shownPano = null;
        if (current) syncStreetView();
    }

    function syncStreetView() {
        if (usingModel() && current) {
            let idx = -1;
            walks.forEach((walk, i) => { if (walk.step <= step) idx = i; });
            dom.viewPrev.disabled = idx <= 0;
            dom.viewNext.disabled = !walks.length || idx >= walks.length - 1;
            dom.viewIndex.textContent = walks.length ? `${Math.max(idx, 0) + 1}/${walks.length}` : '';
            dom.viewImg.hidden = true;
            dom.pano.hidden = true;
            dom.viewEmpty.hidden = true;
            const walk = walks[Math.max(idx, 0)];
            dom.viewCaption.textContent = `Eye level ${EYE_HEIGHT_M} m · Step ${step}${walk ? ` · Route ${walk.route}` : ''}`;
            if (dom.model.hidden) {
                dom.model.hidden = false;
                if (eyeMap) eyeMap.resize();
            }
            ensureEyeMap();
            if (!animFrame) syncEye(step, null, null);
            return;
        }
        dom.model.hidden = true;
        if (!walks.length) {
            viewIdx = -1;
            dom.viewImg.hidden = true;
            dom.pano.hidden = true;
            dom.viewEmpty.hidden = false;
            dom.viewEmpty.textContent = 'This persona has no walked edges.';
            dom.viewIndex.textContent = '';
            dom.viewCaption.textContent = '';
            dom.viewPrev.disabled = true;
            dom.viewNext.disabled = true;
            return;
        }
        let idx = 0;
        walks.forEach((walk, i) => { if (walk.step <= step) idx = i; });
        dom.viewPrev.disabled = idx <= 0;
        dom.viewNext.disabled = idx >= walks.length - 1;
        dom.viewIndex.textContent = `${idx + 1}/${walks.length}`;

        if (usingPano()) {
            viewIdx = idx;
            dom.viewImg.hidden = true;
            if (!animFrame) syncPano(step, null);
            return;
        }
        dom.pano.hidden = true;
        if (idx === viewIdx) return;
        viewIdx = idx;
        const walk = walks[idx];
        dom.viewEmpty.hidden = true;
        dom.viewImg.hidden = false;
        dom.viewImg.alt = `Street view of route ${walk.route}`;
        dom.viewImg.src = window.pwApi(`/api/route_view/${walk.dir}/${walk.route}`);
        dom.viewCaption.textContent = `Step ${walk.step} · Route ${walk.route} · Dir ${walk.dir}`;
    }

    function bearingDeg(a, b) {
        const [lng1, lat1, lng2, lat2] = [a[0], a[1], b[0], b[1]].map(v => (v * Math.PI) / 180);
        const y = Math.sin(lng2 - lng1) * Math.cos(lat2);
        const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lng2 - lng1);
        return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
    }

    function walkStepIndexAtOrBefore(k) {
        for (let i = Math.min(k, totalSteps()) - 1; i >= 0; i -= 1) {
            const s = current.per_step[i];
            if (s.action === 'walk' && s.node_before && s.next_node) return i;
        }
        return -1;
    }

    function firstWalkStepIndexAfter(k) {
        for (let i = Math.max(0, k); i < totalSteps(); i += 1) {
            const s = current.per_step[i];
            if (s.action === 'walk' && s.node_before && s.next_node) return i;
        }
        return -1;
    }

    // Picks the panorama for the agent's position: mid-edge while animating
    // (progress = 0..1 along step k), otherwise at the node reached after step k.
    function panoTarget(k, progress) {
        let index;
        let t;
        if (progress != null) {
            index = k - 1;
            t = progress;
        } else {
            index = walkStepIndexAtOrBefore(k);
            t = 1;
            if (index < 0) {
                index = firstWalkStepIndexAfter(0);
                t = 0;
            }
        }
        if (index < 0) return null;
        const s = current.per_step[index];
        if (s.action !== 'walk') return null;
        const edge = edgeFor(s.node_before, s.next_node);
        const rec = edge && svManifest.routes[String(edge.route)];
        if (!rec) return null;
        const along = rec.source === s.node_before ? t : 1 - t;
        let best = null;
        for (const sample of rec.samples) {
            if (!sample.pano || !svManifest.panos[sample.pano]) continue;
            if (!best || Math.abs(sample.t - along) < Math.abs(best.t - along)) best = sample;
        }
        if (!best) return null;

        let from = lngLat(s.node_before);
        let to = lngLat(s.next_node);
        if (progress == null && t === 1) {
            const nextIndex = firstWalkStepIndexAfter(index + 1);
            if (nextIndex >= 0) {
                from = lngLat(current.per_step[nextIndex].node_before);
                to = lngLat(current.per_step[nextIndex].next_node);
            }
        }
        const heading = from && to ? bearingDeg(from, to) : 0;
        const pano = svManifest.panos[best.pano];
        const yaw = ((heading - pano.heading_deg + 540) % 360) - 180;
        return { id: best.pano, yaw, route: edge.route, offset: best.d, date: pano.date, edgeSamples: rec.samples };
    }

    function syncPano(k, progress) {
        if (!usingPano() || !current) return;
        const target = panoTarget(k, progress);
        if (!target) {
            dom.pano.hidden = true;
            dom.viewEmpty.hidden = false;
            dom.viewEmpty.textContent = 'No street view panorama here.';
            dom.viewCaption.textContent = '';
            return;
        }
        dom.viewEmpty.hidden = true;
        if (dom.pano.hidden) {
            dom.pano.hidden = false;
            if (panoViewer && typeof panoViewer.resize === 'function') panoViewer.resize();
        }
        dom.viewCaption.textContent = `Route ${target.route} · captured ${target.date || 'n/a'} · ${fmt(target.offset, 0)} m from path`;
        if (progress == null) {
            preloadPanos(k);
            if (panoViewer && target.id === shownPano && !panoLoading) {
                panoViewer.lookAt(0, target.yaw, undefined, 500);
                return;
            }
        }
        showPano(target.id, target.yaw);
    }

    // ---------- Enlarged street view ----------
    // The left panel uses backdrop-filter, which traps position:fixed children,
    // so the view is re-parented into an overlay on the map instead.
    function setStreetExpanded(expanded) {
        if (expanded === !dom.overlay.hidden) return;
        if (expanded) {
            dom.overlayBody.appendChild(dom.viewBox);
            dom.overlayTitle.textContent = dom.viewCaption.textContent || 'Street view';
        } else {
            dom.viewCaption.parentNode.insertBefore(dom.viewBox, dom.viewCaption);
        }
        dom.overlay.hidden = !expanded;
        dom.viewBox.classList.toggle('expanded', expanded);
        requestAnimationFrame(() => {
            if (eyeMap) eyeMap.resize();
            if (panoViewer && typeof panoViewer.resize === 'function') panoViewer.resize();
            if (current && !animFrame) syncEye(step, null, null);
        });
    }

    // ---------- Eye-level 3D view ----------
    function eyeStyle() {
        const style = JSON.parse(JSON.stringify(ctx.style));
        for (const layer of style.layers) {
            if (layer.id === 'base-background') layer.paint = { 'background-color': '#3a3f42' };
            if (layer.id === 'base-park') layer.paint = { ...layer.paint, 'fill-color': '#3e5a44', 'fill-opacity': 0.9 };
            if (layer.id === 'base-streets') layer.paint = { ...layer.paint, 'line-color': '#5c6266', 'line-opacity': 1 };
            if (layer.id === ctx.buildingsLayer) {
                delete layer.minzoom;
                layer.layout = { visibility: 'visible' };
                layer.paint = {
                    ...layer.paint,
                    'fill-extrusion-color': '#a7adb1',
                    'fill-extrusion-height': ['min', 120, ['to-number', ['coalesce', ['get', 'render_height'], ['get', 'height'], 12]]],
                    'fill-extrusion-opacity': 1,
                };
            }
        }
        return style;
    }

    function eyeLayers() {
        eyeMap.addSource('eye-trees', { type: 'geojson', data: ctx.getTreeShapes() || emptyGeoJson() });
        eyeMap.addSource('eye-route', { type: 'geojson', data: emptyGeoJson() });
        eyeMap.addSource('eye-goal', { type: 'geojson', data: emptyGeoJson() });
        eyeMap.addLayer({
            id: 'eye-route', type: 'line', source: 'eye-route',
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': '#ff826a', 'line-width': 4, 'line-opacity': 0.9 },
        });
        eyeMap.addLayer({
            id: 'eye-trees', type: 'fill-extrusion', source: 'eye-trees',
            paint: {
                'fill-extrusion-color': ['get', 'color'],
                'fill-extrusion-height': ['get', 'top'],
                'fill-extrusion-base': ['get', 'base'],
            },
        });
        eyeMap.addLayer({
            id: 'eye-goal', type: 'fill-extrusion', source: 'eye-goal',
            paint: { 'fill-extrusion-color': '#ffd35c', 'fill-extrusion-height': 14, 'fill-extrusion-opacity': 0.9 },
        });
        eyeMap.setLight({ anchor: 'map', position: [1.3, 210, 40], color: '#ffffff', intensity: 0.55 });
        try {
            eyeMap.setSky({
                'sky-color': '#5f86ab',
                'horizon-color': '#c3d1dc',
                'fog-color': '#8f9aa2',
                'sky-horizon-blend': 0.8,
                'horizon-fog-blend': 0.7,
                'fog-ground-blend': 0.85,
            });
        } catch { /* sky is cosmetic */ }
    }

    function ensureEyeMap() {
        if (eyeMap || !ctx || !window.maplibregl) return;
        const start = current ? lngLat(current.start_node) : null;
        eyeMap = new maplibregl.Map({
            container: dom.model,
            style: eyeStyle(),
            center: start || ctx.map.getCenter(),
            zoom: 20,
            pitch: EYE_PITCH,
            maxPitch: 85,
            maxZoom: 24,
            interactive: false,
            attributionControl: false,
            fadeDuration: 0,
        });
        eyeMap.on('load', () => {
            eyeLayers();
            eyeReady = true;
            updateEyeRoute();
            if (eyePending) eyeMap.jumpTo(eyePending);
            eyePending = null;
        });
    }

    function updateEyeRoute() {
        if (!eyeReady || !current) return;
        const coords = (current.path || []).map(lngLat).filter(Boolean);
        eyeMap.getSource('eye-route').setData(coords.length >= 2
            ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } }
            : emptyGeoJson());
        const goal = lngLat(current.goal_node);
        const dLat = 0.7 / 111320;
        const dLng = 0.7 / (111320 * Math.cos(((goal ? goal[1] : 0) * Math.PI) / 180));
        eyeMap.getSource('eye-goal').setData(goal
            ? { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[goal[0] - dLng, goal[1] - dLat], [goal[0] + dLng, goal[1] - dLat], [goal[0] + dLng, goal[1] + dLat], [goal[0] - dLng, goal[1] + dLat], [goal[0] - dLng, goal[1] - dLat]]] } }
            : emptyGeoJson());
    }

    // Camera placed at eye height above `pos`, looking along `bearing`. MapLibre
    // positions the camera relative to the look-at centre, so we solve for the
    // zoom that yields EYE_HEIGHT_M and push the centre forward accordingly.
    function eyeCamera(pos, bearing) {
        const rad = Math.PI / 180;
        const height = dom.model.clientHeight || 180;
        const zoom = Math.log2((40075016.686 * Math.cos(pos[1] * rad) * 1.5 * height * Math.cos(EYE_PITCH * rad)) / (512 * EYE_HEIGHT_M));
        const ahead = EYE_HEIGHT_M * Math.tan(EYE_PITCH * rad);
        const dLat = (ahead * Math.cos(bearing * rad)) / 111320;
        const dLng = (ahead * Math.sin(bearing * rad)) / (111320 * Math.cos(pos[1] * rad));
        return { center: [pos[0] + dLng, pos[1] + dLat], zoom: Math.min(23.5, zoom), pitch: EYE_PITCH, bearing };
    }

    function stepBearing(index) {
        const s = index >= 0 ? current.per_step[index] : null;
        const from = s && lngLat(s.node_before);
        const to = s && lngLat(s.next_node);
        return from && to ? bearingDeg(from, to) : null;
    }

    function syncEye(k, pos, now) {
        if (!usingModel() || !current || !eyeMap) return;
        let target;
        if (pos) {
            target = stepBearing(k - 1);
        } else {
            pos = lngLat(nodeAtStep(k));
            target = stepBearing(firstWalkStepIndexAfter(k));
            if (target == null) target = stepBearing(walkStepIndexAtOrBefore(k));
        }
        if (!pos) return;
        if (target == null) target = eyeBearing ?? 0;

        if (now != null && eyeBearing != null) {
            const dt = Math.min(100, now - (eyeLastFrame || now));
            const delta = ((target - eyeBearing + 540) % 360) - 180;
            eyeBearing = (eyeBearing + delta * Math.min(1, dt / 160) + 360) % 360;
        } else {
            eyeBearing = target;
        }
        eyeLastFrame = now ?? 0;

        const camera = eyeCamera(pos, eyeBearing);
        if (!eyeReady) {
            eyePending = camera;
            return;
        }
        if (now != null) eyeMap.jumpTo(camera);
        else eyeMap.easeTo({ ...camera, duration: 600 });
    }

    function panoUrl(id) {
        return window.pwApi(`/api/streetview/pano/${encodeURIComponent(id)}.jpg`);
    }

    function preloadPanos(k) {
        const nextIndex = firstWalkStepIndexAfter(k);
        if (nextIndex < 0) return;
        const s = current.per_step[nextIndex];
        const edge = edgeFor(s.node_before, s.next_node);
        const rec = edge && svManifest.routes[String(edge.route)];
        if (!rec) return;
        new Set(rec.samples.map(sample => sample.pano).filter(Boolean)).forEach(id => { new Image().src = panoUrl(id); });
    }

    function showPano(id, yaw) {
        if (id === shownPano && !panoLoading) return;
        if (panoLoading) {
            queuedPano = { id, yaw };
            return;
        }
        shownPano = id;
        panoLoading = true;
        if (!panoViewer) {
            panoViewer = pannellum.viewer(dom.pano, {
                default: { firstScene: id, sceneFadeDuration: 250, autoLoad: true },
                scenes: { [id]: panoScene(id, yaw) },
            });
            panoViewer.on('load', onPanoLoaded);
            panoViewer.on('error', () => { panoLoading = false; });
            return;
        }
        if (!panoViewer.getConfig().scenes || !panoViewer.getConfig().scenes[id]) panoViewer.addScene(id, panoScene(id, yaw));
        panoViewer.loadScene(id, 0, yaw, 'same');
    }

    function panoScene(id, yaw) {
        return {
            type: 'equirectangular',
            panorama: panoUrl(id),
            yaw,
            pitch: 0,
            hfov: 100,
            minHfov: 40,
            showZoomCtrl: false,
            mouseZoom: 'fullscreenonly',
            keyboardZoom: false,
            compass: false,
        };
    }

    function onPanoLoaded() {
        panoLoading = false;
        if (queuedPano) {
            const next = queuedPano;
            queuedPano = null;
            if (next.id !== shownPano) showPano(next.id, next.yaw);
        }
    }

    // ---------- Persona card ----------
    function renderCard() {
        const layers = current.persona_layers || {};
        const params = current.numeric_params || {};
        const reached = current.outcome === 'reached_goal';
        const stats = [
            ['Steps', String(totalSteps())],
            ['Distance', num(current.total_distance_m) != null ? `${Math.round(current.total_distance_m)} m` : '–'],
            ['Time', num(current.total_time_s) != null ? `${(current.total_time_s / 60).toFixed(1)} min` : '–'],
            ['Final F / H', `${fmt(current.final_fatigue)} / ${fmt(current.final_heat)}`],
        ];
        const paramRows = [
            ['Base speed', num(params.base_speed_mps) != null ? `${fmt(params.base_speed_mps)} m/s` : null],
            ['Stamina', num(params.stamina_reserve) != null ? fmt(params.stamina_reserve) : null],
            ['Heat tolerance', num(params.heat_tolerance) != null ? fmt(params.heat_tolerance) : null],
            ['Age factor', num(params.age_factor) != null ? fmt(params.age_factor) : null],
        ].filter(([, value]) => value != null);
        const text = (label, value) => value ? `<div class="pc-text"><span>${label}</span><p>${escapeHtml(value)}</p></div>` : '';

        dom.card.innerHTML = `
            <div class="pc-head">
                <strong>${escapeHtml(current.persona_id || 'Persona')}</strong>
                <span class="pc-badge${reached ? ' ok' : ''}">${escapeHtml(reached ? 'reached goal' : (current.outcome || 'unknown'))}</span>
            </div>
            <div class="pc-meta">${escapeHtml(current.provider || '')}${current.provider ? ' · ' : ''}${escapeHtml(currentFile)}</div>
            <div class="summary-grid">${stats.map(([k, v]) => `<div class="summary-item"><span>${k}</span><strong>${escapeHtml(v)}</strong></div>`).join('')}</div>
            ${text('Identity', layers.layer_1)}
            ${text('Priorities', layers.layer_3)}
            ${paramRows.length ? `<div class="pc-params">${paramRows.map(([k, v]) => `<span>${k}</span><strong>${escapeHtml(v)}</strong>`).join('')}</div>` : ''}`;
    }

    // ---------- State HUD ----------
    function bandLabel(value, labels) {
        const v = num(value) || 0;
        return labels[Math.min(labels.length - 1, Math.floor(v / 0.25))];
    }

    function hudBar(label, ratio, valueText, kind) {
        const clamped = Math.max(0, Math.min(1, num(ratio) || 0));
        const active = clamped > 0 ? Math.max(1, Math.ceil(clamped * 10)) : 0;
        const cells = Array.from({ length: 10 }, (_, i) => `<i class="${i < active ? 'on' : ''}"></i>`).join('');
        return `<div class="hud-row hud-${kind}"><span class="hud-label">${label}</span><span class="hud-track">${cells}</span><span class="hud-value">${escapeHtml(valueText)}</span></div>`;
    }

    function renderHud() {
        dom.hud.hidden = false;
        const s = step > 0 ? current.per_step[step - 1] : null;
        const fatigue = s ? num(s.fatigue_after) : 0;
        const heat = s ? num(s.heat_after) : 0;
        const dist = walkedDistance(step);
        const action = s ? s.action : 'start';
        const rest = s && num(s.rest_duration_s) ? `<span class="hud-rest">${Math.round(s.rest_duration_s)}s rest</span>` : '';
        dom.hud.innerHTML = `
            <div class="hud-top">
                <strong>${escapeHtml(current.persona_id || '')}</strong>
                <span class="hud-step">Step ${step}/${totalSteps()}</span>
                <span class="hud-action hud-action-${escapeHtml(action)}">${escapeHtml(action)}</span>
                ${rest}
            </div>
            ${hudBar('FAT', fatigue, `${fmt(fatigue)} ${bandLabel(fatigue, FATIGUE_LABELS)}`, 'fatigue')}
            ${hudBar('HEAT', heat, `${fmt(heat)} ${bandLabel(heat, HEAT_LABELS)}`, 'heat')}
            ${hudBar('DIST', plannedDistance > 0 ? dist / plannedDistance : 0, plannedDistance > 0 ? `${Math.round(dist)}/${Math.round(plannedDistance)} m` : `${Math.round(dist)} m`, 'distance')}`;
    }

    // ---------- Element composition pie ----------
    function renderSegPie() {
        const sums = Object.fromEntries(SEG_KEYS.map(k => [k, 0]));
        let count = 0;
        for (const walk of walks) {
            if (!walk.seg) continue;
            let ok = false;
            SEG_KEYS.forEach(k => {
                const v = num(walk.seg[k]);
                if (v != null) { sums[k] += v; ok = true; }
            });
            if (ok) count += 1;
        }
        const values = SEG_KEYS.map(k => (count ? sums[k] / count : 0));
        const total = values.reduce((a, b) => a + b, 0);
        dom.segCount.textContent = count ? `avg of ${count} edge${count === 1 ? '' : 's'}` : '';
        if (!count || total <= 0) {
            dom.seg.innerHTML = '<div class="loading-row">No segmentation data.</div>';
            return;
        }

        let angle = -Math.PI / 2;
        const slices = values.map((value, i) => {
            const share = value / total;
            if (share <= 0) return '';
            const color = SEG_COLORS[SEG_KEYS[i]];
            if (share >= 0.9999) return `<circle cx="50" cy="50" r="46" fill="${color}"></circle>`;
            const end = angle + share * Math.PI * 2;
            const large = share > 0.5 ? 1 : 0;
            const [x1, y1] = [50 + 46 * Math.cos(angle), 50 + 46 * Math.sin(angle)];
            const [x2, y2] = [50 + 46 * Math.cos(end), 50 + 46 * Math.sin(end)];
            angle = end;
            return `<path d="M50 50 L${x1.toFixed(3)} ${y1.toFixed(3)} A46 46 0 ${large} 1 ${x2.toFixed(3)} ${y2.toFixed(3)} Z" fill="${color}"><title>${SEG_KEYS[i]} ${(share * 100).toFixed(1)}%</title></path>`;
        }).join('');

        const legend = SEG_KEYS.map((key, i) => `<div class="seg-legend-row"><i style="background:${SEG_COLORS[key]}"></i><span>${key}</span><output>${((values[i] / total) * 100).toFixed(1)}%</output></div>`).join('');
        dom.seg.innerHTML = `<svg viewBox="0 0 100 100" role="img" aria-label="Average element composition">${slices}<circle cx="50" cy="50" r="22" class="seg-hole"></circle></svg><div class="seg-legend">${legend}</div>`;
    }

    // ---------- Line charts ----------
    function renderChips() {
        dom.chips.innerHTML = CHART_METRICS.map(metric => {
            const color = metric === BODY_METRIC ? COLORS['Heat Load'] : COLORS[metric];
            return `<label class="metric-chip"><input type="checkbox" value="${escapeHtml(metric)}" ${selectedMetrics.has(metric) ? 'checked' : ''}><span><i style="background:${color}"></i>${escapeHtml(metric)}</span></label>`;
        }).join('');
    }

    function renderCharts() {
        if (!current) return;
        const metrics = CHART_METRICS.filter(m => selectedMetrics.has(m));
        dom.charts.innerHTML = metrics.length
            ? metrics.map(chartHtml).join('')
            : '<div class="loading-row">Select at least one metric above.</div>';
    }

    function chartHtml(metric) {
        const isBody = metric === BODY_METRIC;
        const lines = isBody
            ? [{ label: 'Fatigue', color: COLORS.Fatigue, values: series.Fatigue }, { label: 'Heat Load', color: COLORS['Heat Load'], values: series['Heat Load'] }]
            : [{ label: metric, color: COLORS[metric], values: series[metric] }];
        const n = totalSteps();
        const all = lines.flatMap(line => line.values).filter(v => v != null);
        const unit = UNITS[metric];
        const head = extra => `<div class="walk-chart-head"><strong>${escapeHtml(metric)}${unit ? ` <small>(${unit})</small>` : ''}</strong>${extra}</div>`;
        if (!n || !all.length) return `<div class="walk-chart">${head('<span>no data</span>')}</div>`;

        let lo = Math.min(...all);
        let hi = Math.max(...all);
        if (isBody) {
            lo = Math.min(0, lo);
            hi = Math.max(1, hi);
        } else {
            const pad = (hi - lo) * 0.15 || Math.abs(hi) * 0.1 || 1;
            lo -= pad;
            hi += pad;
            if (metric === 'Sky exposure' || metric === 'Windspeed') lo = Math.max(0, lo);
        }
        const xPct = i => (n <= 1 ? 50 : (i / (n - 1)) * 100);
        const yPct = v => (1 - (v - lo) / (hi - lo || 1)) * 100;
        const cur = step - 1;

        const svgParts = [];
        const dots = [];
        [0.25, 0.5, 0.75].forEach(t => svgParts.push(`<line class="wc-grid" x1="0" x2="100" y1="${t * 100}" y2="${t * 100}"></line>`));
        lines.forEach(line => {
            const pts = [];
            line.values.forEach((v, i) => { if (v != null) pts.push([xPct(i), yPct(v)]); });
            if (!pts.length) return;
            if (!isBody && pts.length >= 2) {
                const area = [[pts[0][0], 100], ...pts, [pts[pts.length - 1][0], 100]];
                svgParts.push(`<polygon class="wc-area" points="${area.map(p => p.map(c => c.toFixed(2)).join(',')).join(' ')}" fill="${line.color}"></polygon>`);
            }
            svgParts.push(`<polyline class="wc-line" points="${pts.map(p => p.map(c => c.toFixed(2)).join(',')).join(' ')}" stroke="${line.color}"></polyline>`);
            const clean = line.values.filter(v => v != null);
            const mean = clean.reduce((a, b) => a + b, 0) / clean.length;
            svgParts.push(`<line class="wc-mean" x1="0" x2="100" y1="${yPct(mean).toFixed(2)}" y2="${yPct(mean).toFixed(2)}" stroke="${line.color}"></line>`);
            if (n <= 40) {
                line.values.forEach((v, i) => {
                    if (v == null || i === cur) return;
                    dots.push(`<span class="wc-dot" style="left:${xPct(i)}%;top:${yPct(v)}%;--c:${line.color}"></span>`);
                });
            }
            if (cur >= 0 && line.values[cur] != null) {
                dots.push(`<span class="wc-dot current" style="left:${xPct(cur)}%;top:${yPct(line.values[cur])}%;--c:${line.color}"></span>`);
            }
        });
        const marker = cur >= 0 ? `<span class="wc-cursor" style="left:${xPct(cur)}%"></span>` : '';

        const valueAt = (line, digits) => {
            const v = cur >= 0 ? line.values[cur] : null;
            return v == null ? '–' : v.toFixed(digits);
        };
        const meanOf = line => {
            const clean = line.values.filter(v => v != null);
            return clean.length ? clean.reduce((a, b) => a + b, 0) / clean.length : null;
        };
        const digits = isBody || metric === 'Sky exposure' ? 2 : 1;
        const readout = isBody
            ? lines.map(line => `<span class="wc-key"><i style="background:${line.color}"></i>${line.label === 'Heat Load' ? 'Heat' : line.label} ${valueAt(line, 2)}</span>`).join('')
            : `<span>now <b>${valueAt(lines[0], digits)}</b> · avg ${fmt(meanOf(lines[0]), digits)}</span>`;

        const xTicks = n <= 1 ? [0] : [...new Set([0, Math.round((n - 1) / 2), n - 1])];
        return `<div class="walk-chart" data-steps="${n}">
            ${head(readout)}
            <div class="wc-body">
                <div class="wc-y"><span style="top:0%">${fmt(hi, digits)}</span><span style="top:50%">${fmt((hi + lo) / 2, digits)}</span><span style="top:100%">${fmt(lo, digits)}</span></div>
                <div class="wc-plot">
                    <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${svgParts.join('')}</svg>
                    ${marker}${dots.join('')}
                </div>
            </div>
            <div class="wc-x">${xTicks.map(i => `<span style="left:${xPct(i)}%">${i + 1}</span>`).join('')}</div>
        </div>`;
    }

    // ---------- Panels ----------
    function wireCollapse(panel, collapseId, restoreId) {
        const restore = el(restoreId);
        el(collapseId).addEventListener('click', () => {
            panel.hidden = true;
            restore.hidden = false;
            document.body.classList.toggle('ped-left-collapsed', dom.left.hidden);
        });
        restore.addEventListener('click', () => {
            panel.hidden = false;
            restore.hidden = true;
            document.body.classList.toggle('ped-left-collapsed', dom.left.hidden);
        });
    }

    function wireControls() {
        dom.search.addEventListener('input', () => {
            filterText = dom.search.value;
            if (ctx) renderList();
        });
        dom.list.addEventListener('click', event => {
            const row = event.target.closest('[data-file]');
            if (row && ctx) selectPersona(row.dataset.file);
        });
        dom.play.addEventListener('click', () => (playing ? stopPlayback() : startPlayback()));
        dom.prev.addEventListener('click', () => { stopPlayback(); goToStep(step - 1); });
        dom.next.addEventListener('click', () => { stopPlayback(); goToStep(step + 1, { animate: true, duration: 450 }); });
        dom.slider.addEventListener('input', () => { stopPlayback(); goToStep(Number(dom.slider.value)); });
        dom.viewPrev.addEventListener('click', () => {
            if (viewIdx <= 0) return;
            stopPlayback();
            goToStep(walks[viewIdx - 1].step);
        });
        dom.viewNext.addEventListener('click', () => {
            if (viewIdx < 0 || viewIdx >= walks.length - 1) return;
            stopPlayback();
            goToStep(walks[viewIdx + 1].step);
        });
        dom.viewExpand.addEventListener('click', () => setStreetExpanded(true));
        dom.overlayClose.addEventListener('click', () => setStreetExpanded(false));
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && !dom.overlay.hidden) setStreetExpanded(false);
        });
        new MutationObserver(() => {
            if (!dom.overlay.hidden) dom.overlayTitle.textContent = dom.viewCaption.textContent || 'Street view';
        }).observe(dom.viewCaption, { childList: true, characterData: true, subtree: true });
        dom.svModel.addEventListener('click', () => setSvSource('model'));
        dom.svRendered.addEventListener('click', () => setSvSource('rendered'));
        dom.svGoogle.addEventListener('click', () => setSvSource('google'));
        dom.viewImg.addEventListener('error', () => {
            dom.viewImg.hidden = true;
            dom.viewEmpty.hidden = false;
            dom.viewEmpty.textContent = 'No street view image for this edge.';
        });
        dom.chips.addEventListener('change', event => {
            const input = event.target;
            if (input.checked) selectedMetrics.add(input.value);
            else selectedMetrics.delete(input.value);
            saveSelectedMetrics();
            renderCharts();
        });
        dom.charts.addEventListener('click', event => {
            const plot = event.target.closest('.wc-plot');
            if (!plot || !current) return;
            const n = totalSteps();
            const rect = plot.getBoundingClientRect();
            const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
            stopPlayback();
            goToStep(Math.round(ratio * (n - 1)) + 1);
        });
        document.addEventListener('pw:trees', event => {
            if (eyeReady) eyeMap.getSource('eye-trees').setData(event.detail);
        });
        document.addEventListener('pw:modechange', event => {
            if (event.detail.mode !== 'pedestrian') stopPlayback();
            applyModeLayers();
            if (event.detail.mode === 'pedestrian' && current) fitRoute();
            if (event.detail.mode === 'pedestrian' && eyeMap) setTimeout(() => eyeMap.resize(), 0);
        });
        wireCollapse(dom.left, 'collapse-ped-left', 'restore-ped-left');
        wireCollapse(dom.right, 'collapse-ped-right', 'restore-ped-right');
    }

    renderChips();
    wireControls();
    syncSourceButtons();
    fetch(window.pwApi('/api/streetview/manifest'))
        .then(response => (response.ok ? response.json() : null))
        .catch(() => null)
        .then(manifest => {
            svManifest = manifest;
            syncSourceButtons();
            if (current) setSvSource(svSource);
        });
    api.ready.then(context => {
        ctx = context;
        addLayers();
        renderList();
    });
})();
