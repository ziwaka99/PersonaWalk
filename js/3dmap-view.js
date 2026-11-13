(() => {
    'use strict';

    const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
    const STORAGE_KEY = 'personaWalk.3dmap.v1';
    const METRICS = ['Windspeed', 'Sky exposure', 'MRT', 'UTCI', 'PET'];
    const METRIC_COLORS = {
        Windspeed: '#45d9ff',
        'Sky exposure': '#ffd35c',
        MRT: '#ff826a',
        UTCI: '#b998ff',
        PET: '#65d58a',
    };
    const METRIC_UNITS = {
        Windspeed: 'm/s',
        'Sky exposure': '',
        MRT: '°C',
        UTCI: '°C',
        PET: '°C',
    };
    const SEGMENT_COLORS = {
        Sky: '#45d9ff',
        Greenery: '#65d58a',
        Topo: '#ffd35c',
        Building: '#b998ff',
        Pavement: '#9da3a6',
    };
    const ROUTE_COLORS = ['#45d9ff', '#ff826a', '#ffd35c', '#65d58a', '#b998ff', '#f582c2', '#7ca8ff'];

    const el = id => document.getElementById(id);
    const dom = {
        status: el('map-status'),
        layersPanel: el('control-panel'),
        metricsPanel: el('metrics-panel'),
        edgeEmpty: el('edge-empty'),
        edgeContent: el('edge-content'),
        edgeTitle: el('edge-title'),
        edgeRoute: el('edge-route'),
        edgeSummary: el('edge-summary'),
        simMetrics: el('simulation-metrics'),
        segmentation: el('segmentation-metrics'),
        pointMetrics: el('point-metrics'),
        sampleCount: el('sample-count'),
        routeList: el('route-list'),
        legend: el('map-legend'),
        legendLow: el('legend-low'),
        legendHigh: el('legend-high'),
    };

    const defaultState = {
        mode: 'map',
        view: '3d',
        basemap: true,
        buildings: true,
        trees: true,
        roads: true,
        nodes: false,
        routes: true,
        frequency: false,
        rest: false,
        metric: false,
        metricName: 'Windspeed',
        roadColor: '#45d9ff',
        roadWidth: 3,
        roadOpacity: 0.9,
        center: [103.8599, 1.3024],
        zoom: 15.4,
        pitch: 58,
        bearing: -28,
    };

    let state = loadState();
    let map = null;
    let graph = null;
    let resultsIndex = [];
    let networkFeatures = [];
    let selectedRoute = null;
    let selectedDirection = 1;
    let styleInfo = { basemapLayers: [], buildingsLayer: null };
    const nodeById = new Map();
    const edgeByRouteDir = new Map();
    const canonicalEdgeByRoute = new Map();
    const edgeKeyToRoute = new Map();
    const edgeByNodes = new Map();
    const resultCache = new Map();
    const pointCache = new Map();
    const personaRouteState = new Map();
    let allResultsPromise = null;

    let resolveReady;
    window.PersonaWalk3D = {
        ready: new Promise(resolve => { resolveReady = resolve; }),
        getMode: () => state.mode,
        setMode: mode => setMode(mode),
    };

    function loadState() {
        try {
            const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
            return { ...defaultState, ...(stored || {}) };
        } catch {
            return { ...defaultState };
        }
    }

    function saveState() {
        if (map && map.loaded()) {
            const center = map.getCenter();
            state.center = [center.lng, center.lat];
            state.zoom = map.getZoom();
            state.pitch = map.getPitch();
            state.bearing = map.getBearing();
        }
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* storage is optional */ }
    }

    function setStatus(message, isError = false) {
        dom.status.textContent = message;
        dom.status.classList.toggle('error', isError);
    }

    async function fetchJson(url) {
        const response = await fetch(window.pwApi(url));
        if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
        return response.json();
    }

    function normalizeSource(source) {
        const copy = JSON.parse(JSON.stringify(source));
        if (copy.url) copy.url = new URL(copy.url, STYLE_URL).href;
        if (Array.isArray(copy.tiles)) copy.tiles = copy.tiles.map(url => new URL(url, STYLE_URL).href);
        return copy;
    }

    function vectorLayer(rawStyle, sourceLayer, type) {
        return (rawStyle.layers || []).find(layer => layer.type === type && layer['source-layer'] === sourceLayer && layer.source);
    }

    function createMinimalStyle(rawStyle) {
        const sources = {};
        const layers = [{ id: 'base-background', type: 'background', paint: { 'background-color': '#050607' } }];
        const basemapLayers = [];

        const addSource = layer => {
            if (!layer || !rawStyle.sources || !rawStyle.sources[layer.source]) return false;
            if (!sources[layer.source]) sources[layer.source] = normalizeSource(rawStyle.sources[layer.source]);
            return true;
        };

        const addFill = (id, sourceLayer, color, opacity) => {
            const template = vectorLayer(rawStyle, sourceLayer, 'fill');
            if (!template || !addSource(template)) return;
            const layer = {
                id,
                type: 'fill',
                source: template.source,
                'source-layer': sourceLayer,
                paint: { 'fill-color': color, 'fill-opacity': opacity },
            };
            if (Number.isFinite(template.minzoom)) layer.minzoom = template.minzoom;
            if (Number.isFinite(template.maxzoom)) layer.maxzoom = template.maxzoom;
            layers.push(layer);
            basemapLayers.push(id);
        };

        addFill('base-landcover', 'landcover', '#101412', 0.46);
        addFill('base-park', 'park', '#111a14', 0.72);
        addFill('base-water', 'water', '#081316', 0.94);

        const transport = vectorLayer(rawStyle, 'transportation', 'line');
        if (transport && addSource(transport)) {
            layers.push({
                id: 'base-streets',
                type: 'line',
                source: transport.source,
                'source-layer': 'transportation',
                minzoom: 11,
                layout: { 'line-cap': 'round', 'line-join': 'round' },
                paint: {
                    'line-color': '#373b3d',
                    'line-opacity': 0.48,
                    'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.3, 14, 0.8, 17, 2.2],
                },
            });
            basemapLayers.push('base-streets');
        }

        let buildingsLayer = null;
        const building = vectorLayer(rawStyle, 'building', 'fill');
        if (building && addSource(building)) {
            buildingsLayer = 'base-buildings';
            layers.push({
                id: buildingsLayer,
                type: 'fill-extrusion',
                source: building.source,
                'source-layer': 'building',
                minzoom: 15.35,
                layout: { visibility: state.buildings ? 'visible' : 'none' },
                paint: {
                    'fill-extrusion-color': '#2c3032',
                    'fill-extrusion-height': [
                        'interpolate', ['linear'], ['zoom'],
                        15.35, 0,
                        16.15, ['min', 68, ['to-number', ['coalesce', ['get', 'render_height'], ['get', 'height'], 12]]],
                    ],
                    'fill-extrusion-base': ['to-number', ['coalesce', ['get', 'render_min_height'], ['get', 'min_height'], 0]],
                    'fill-extrusion-opacity': 0.5,
                },
            });
        }

        return {
            style: { version: 8, sources, layers },
            basemapLayers,
            buildingsLayer,
        };
    }

    function createRasterFallbackStyle() {
        return {
            style: {
                version: 8,
                sources: {
                    carto: {
                        type: 'raster',
                        tiles: ['https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png'],
                        tileSize: 256,
                        attribution: '© OpenStreetMap © CARTO',
                    },
                },
                layers: [
                    { id: 'base-background', type: 'background', paint: { 'background-color': '#050607' } },
                    { id: 'base-raster', type: 'raster', source: 'carto', paint: { 'raster-opacity': 0.82 } },
                ],
            },
            basemapLayers: ['base-raster'],
            buildingsLayer: null,
        };
    }

    async function loadMapStyle() {
        try {
            const raw = await fetchJson(STYLE_URL);
            return createMinimalStyle(raw);
        } catch (error) {
            console.warn('Using raster map fallback:', error);
            return createRasterFallbackStyle();
        }
    }

    function prepareGraph(raw) {
        graph = raw;
        for (const node of graph.nodes || []) nodeById.set(String(node.id), node);

        for (const edge of graph.edges || []) {
            const route = Number(edge.route);
            const dir = Number(edge.dir) || 1;
            edgeByRouteDir.set(`${route}|${dir}`, edge);
            if (!canonicalEdgeByRoute.has(route) || dir === 1) canonicalEdgeByRoute.set(route, edge);
            edgeKeyToRoute.set(edgeKey(edge.source, edge.target), route);
            edgeByNodes.set(`${edge.source}|${edge.target}`, edge);
        }

        networkFeatures = Array.from(canonicalEdgeByRoute.entries()).map(([route, edge]) => ({
            type: 'Feature',
            id: route,
            properties: {
                route,
                frequency: 0,
                metricValue: metricValueForEdge(edge, state.metricName),
            },
            geometry: {
                type: 'LineString',
                coordinates: [edge.source_lnglat, edge.target_lnglat],
            },
        })).filter(feature => feature.geometry.coordinates.every(validLngLat));
    }

    function validLngLat(value) {
        return Array.isArray(value) && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]));
    }

    function edgeKey(a, b) {
        return [String(a), String(b)].sort().join('|');
    }

    function networkGeoJson() {
        return { type: 'FeatureCollection', features: networkFeatures };
    }

    function nodeGeoJson() {
        const features = Array.from(nodeById.values()).filter(node => Number.isFinite(+node.lng) && Number.isFinite(+node.lat)).map(node => ({
            type: 'Feature',
            properties: { id: node.id },
            geometry: { type: 'Point', coordinates: [+node.lng, +node.lat] },
        }));
        return { type: 'FeatureCollection', features };
    }

    function emptyGeoJson() {
        return { type: 'FeatureCollection', features: [] };
    }

    function addDataLayers() {
        map.addSource('network', { type: 'geojson', data: networkGeoJson(), promoteId: 'route' });
        map.addSource('nodes', { type: 'geojson', data: nodeGeoJson() });
        map.addSource('selected-edge', { type: 'geojson', data: emptyGeoJson() });
        map.addSource('persona-routes', { type: 'geojson', data: emptyGeoJson() });
        map.addSource('rests', { type: 'geojson', data: emptyGeoJson() });

        map.addLayer({
            id: 'network-casing', type: 'line', source: 'network',
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
                'line-color': '#050607',
                'line-opacity': 0.94,
                'line-width': roadWidthExpression(2.8),
            },
        });
        map.addLayer({
            id: 'network-roads', type: 'line', source: 'network',
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
                'line-color': state.roadColor,
                'line-opacity': state.roadOpacity,
                'line-width': roadWidthExpression(0),
            },
        });
        map.addLayer({
            id: 'network-frequency', type: 'line', source: 'network',
            layout: { visibility: state.frequency ? 'visible' : 'none', 'line-cap': 'round', 'line-join': 'round' },
            paint: {
                'line-color': ['interpolate', ['linear'], ['get', 'frequency'], 0, '#373b3d', 1, '#45d9ff', 10, '#ffd35c', 30, '#ff826a'],
                'line-width': ['interpolate', ['linear'], ['get', 'frequency'], 0, 1, 10, 4, 30, 8],
                'line-opacity': 0.9,
            },
        });
        map.addLayer({
            id: 'network-metric', type: 'line', source: 'network',
            layout: { visibility: state.metric ? 'visible' : 'none', 'line-cap': 'round', 'line-join': 'round' },
            paint: {
                'line-color': '#b998ff',
                'line-width': roadWidthExpression(2),
                'line-opacity': 0.88,
            },
        });
        map.addSource('trees', { type: 'geojson', data: emptyGeoJson(), attribution: 'Trees © NParks Trees.sg' });
        map.addSource('trees-shapes', { type: 'geojson', data: emptyGeoJson(), attribution: 'Trees © NParks Trees.sg' });
        map.addLayer({
            id: 'trees-dots', type: 'circle', source: 'trees', maxzoom: 15.2,
            layout: { visibility: state.trees ? 'visible' : 'none' },
            paint: {
                'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 1, 15, 2.6],
                'circle-color': '#4fb36d',
                'circle-opacity': 0.8,
            },
        });
        map.addLayer({
            id: 'trees-3d', type: 'fill-extrusion', source: 'trees-shapes', minzoom: 15,
            layout: { visibility: state.trees ? 'visible' : 'none' },
            paint: {
                'fill-extrusion-color': ['get', 'color'],
                'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 15, 0, 15.8, ['get', 'top']],
                'fill-extrusion-base': ['interpolate', ['linear'], ['zoom'], 15, 0, 15.8, ['get', 'base']],
                'fill-extrusion-opacity': 0.94,
            },
        });
        map.addLayer({
            id: 'rest-heatmap', type: 'heatmap', source: 'rests', maxzoom: 18,
            layout: { visibility: state.rest ? 'visible' : 'none' },
            paint: {
                'heatmap-weight': ['interpolate', ['linear'], ['get', 'count'], 0, 0, 5, 1],
                'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 13, 0.7, 17, 1.4],
                'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 13, 18, 17, 46],
                'heatmap-opacity': 0.78,
                'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(0,0,0,0)', 0.25, '#45d9ff', 0.55, '#65d58a', 0.78, '#ffd35c', 1, '#ff826a'],
            },
        });
        map.addLayer({
            id: 'persona-routes-layer', type: 'line', source: 'persona-routes',
            layout: { visibility: state.routes ? 'visible' : 'none', 'line-cap': 'round', 'line-join': 'round' },
            paint: {
                'line-color': ['get', 'color'],
                'line-width': ['interpolate', ['linear'], ['zoom'], 13, 2.2, 17, 5.2],
                'line-opacity': 0.9,
            },
        });
        map.addLayer({
            id: 'selected-edge-layer', type: 'line', source: 'selected-edge',
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
                'line-color': '#ffffff',
                'line-width': roadWidthExpression(5.5),
                'line-opacity': 1,
            },
        });
        map.addLayer({
            id: 'network-nodes', type: 'circle', source: 'nodes',
            layout: { visibility: state.nodes ? 'visible' : 'none' },
            paint: {
                'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 2, 17, 5],
                'circle-color': '#ffd35c',
                'circle-stroke-color': '#151617',
                'circle-stroke-width': 1.4,
            },
        });
        map.addLayer({
            id: 'network-hit', type: 'line', source: 'network',
            layout: { visibility: state.roads ? 'visible' : 'none' },
            paint: { 'line-color': '#000000', 'line-opacity': 0, 'line-width': 18 },
        });

        updateMetricLayer();
        applyLayerVisibility();
        wireMapSelection();
        loadTrees();
    }

    // ---------- 3D trees ----------
    const TREE_GREENS = ['#3f9e5f', '#4fb36d', '#2f8a55', '#5cbf7a', '#3a9a73', '#6ac46b', '#478f4f'];
    const GIRTH_M = { XS: 0.35, S: 0.8, M: 1.3, L: 1.9 };
    const CROWN_EXTRA_M = { XS: 0.3, S: 0.8, M: 1.2, L: 1.8 };
    let treeProps = [];
    let treeShapesData = null;

    function shadeHex(hex, factor) {
        const n = parseInt(hex.slice(1), 16);
        const channel = shift => Math.max(0, Math.min(255, Math.round(((n >> shift) & 255) * factor)));
        return `#${[channel(16), channel(8), channel(0)].map(v => v.toString(16).padStart(2, '0')).join('')}`;
    }

    function ringAround([lng, lat], radiusM, sides = 10) {
        const dLat = radiusM / 111320;
        const dLng = radiusM / (111320 * Math.cos((lat * Math.PI) / 180));
        const ring = [];
        for (let i = 0; i <= sides; i += 1) {
            const a = ((i % sides) / sides) * Math.PI * 2;
            ring.push([lng + Math.cos(a) * dLng, lat + Math.sin(a) * dLat]);
        }
        return [ring];
    }

    function treeShapes(feature, idx) {
        const p = feature.properties;
        const center = feature.geometry.coordinates;
        const height = Math.max(3, Number(p.height_est) || 6);
        const girth = GIRTH_M[p.girth_size] || 0.5;
        const trunkRadius = Math.min(0.7, Math.max(0.18, (girth / (2 * Math.PI)) * 1.6));
        const crownRadius = Math.min(7.5, Math.max(1.2, 0.28 * height + (CROWN_EXTRA_M[p.girth_size] || 0.5)));
        let hash = 0;
        for (const char of String(p.family || p.species_id || '')) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
        const green = TREE_GREENS[Math.abs(hash) % TREE_GREENS.length];
        const part = (radius, base, top, color) => ({
            type: 'Feature',
            properties: { idx, base, top, color },
            geometry: { type: 'Polygon', coordinates: ringAround(center, radius) },
        });
        return [
            part(trunkRadius, 0, height * 0.45, '#6b4f3a'),
            part(crownRadius * 0.82, height * 0.38, height * 0.62, shadeHex(green, 0.82)),
            part(crownRadius, height * 0.55, height * 0.85, green),
            part(crownRadius * 0.62, height * 0.8, height, shadeHex(green, 1.15)),
        ];
    }

    async function loadTrees() {
        try {
            const data = await fetchJson('/api/trees');
            const features = (data.features || []).filter(f => f.geometry && validLngLat(f.geometry.coordinates));
            treeProps = features.map(f => f.properties);
            map.getSource('trees').setData({
                type: 'FeatureCollection',
                features: features.map((f, idx) => ({ type: 'Feature', properties: { idx }, geometry: f.geometry })),
            });
            treeShapesData = { type: 'FeatureCollection', features: features.flatMap(treeShapes) };
            map.getSource('trees-shapes').setData(treeShapesData);
            document.dispatchEvent(new CustomEvent('pw:trees', { detail: treeShapesData }));
            el('trees-count').textContent = features.length.toLocaleString();
            map.on('click', 'trees-3d', showTreePopup);
            map.on('click', 'trees-dots', showTreePopup);
        } catch (error) {
            console.warn('Trees unavailable:', error);
            el('layer-trees').disabled = true;
            el('trees-count').textContent = 'unavailable';
        }
    }

    function showTreePopup(event) {
        const feature = event.features && event.features[0];
        const p = feature && treeProps[feature.properties.idx];
        if (!p) return;
        const name = String(p.common_name || p.species || 'Tree').split(',')[0];
        const rows = [
            ['Species', p.species],
            ['Family', p.family],
            ['Height', p.height ? `${p.height} m` : null],
            ['Girth', p.girth ? `${p.girth} m` : null],
            ['Age', p.age != null ? `${p.age} yrs` : null],
            ['Tree ID', p.tree_id],
        ].filter(([, value]) => value != null && value !== '');
        new maplibregl.Popup({ className: 'tree-popup', closeButton: true, maxWidth: '260px' })
            .setLngLat(event.lngLat)
            .setHTML(`<strong>${escapeHtml(name)}</strong>${p.heritage ? '<span class="tree-heritage">Heritage tree</span>' : ''}<dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(String(v))}</dd>`).join('')}</dl>`)
            .addTo(map);
    }

    function roadWidthExpression(extra) {
        const width = Math.max(1, Number(state.roadWidth) || 3) + extra;
        return ['interpolate', ['linear'], ['zoom'], 12, width * 0.55, 15.4, width, 18, width * 1.65];
    }

    function setLayerVisibility(id, visible) {
        if (map && map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
    }

    function applyLayerVisibility() {
        if (!map || !map.getLayer('network-roads')) return;
        for (const id of styleInfo.basemapLayers) setLayerVisibility(id, state.basemap);
        if (styleInfo.buildingsLayer) setLayerVisibility(styleInfo.buildingsLayer, state.buildings && state.view === '3d');
        setLayerVisibility('network-casing', state.roads);
        setLayerVisibility('network-roads', state.roads);
        setLayerVisibility('network-hit', state.roads);
        setLayerVisibility('network-nodes', state.nodes);
        setLayerVisibility('trees-3d', state.trees);
        setLayerVisibility('trees-dots', state.trees);
        const analysis = state.mode !== 'pedestrian';
        setLayerVisibility('persona-routes-layer', analysis && state.routes);
        setLayerVisibility('network-frequency', analysis && state.frequency);
        setLayerVisibility('rest-heatmap', analysis && state.rest);
        setLayerVisibility('network-metric', analysis && state.metric);
        setLayerVisibility('selected-edge-layer', analysis);
        if (map.getLayer('network-roads')) map.setPaintProperty('network-roads', 'line-opacity', analysis ? state.roadOpacity : Math.min(state.roadOpacity, 0.22));
        dom.legend.hidden = !state.metric;
    }

    function setMode(mode) {
        if (mode !== 'map' && mode !== 'pedestrian') return;
        state.mode = mode;
        syncControls();
        applyLayerVisibility();
        saveState();
        document.dispatchEvent(new CustomEvent('pw:modechange', { detail: { mode } }));
    }

    function syncControls() {
        el('layer-basemap').checked = state.basemap;
        el('layer-buildings').checked = state.buildings;
        el('layer-trees').checked = state.trees;
        el('layer-roads').checked = state.roads;
        el('layer-nodes').checked = state.nodes;
        el('layer-routes').checked = state.routes;
        el('layer-frequency').checked = state.frequency;
        el('layer-rest').checked = state.rest;
        el('layer-metric').checked = state.metric;
        el('metric-select').value = state.metricName;
        el('road-color').value = state.roadColor;
        el('road-width').value = state.roadWidth;
        el('road-opacity').value = state.roadOpacity;
        el('road-width-value').textContent = Number(state.roadWidth).toFixed(1).replace('.0', '');
        el('road-opacity-value').textContent = `${Math.round(state.roadOpacity * 100)}%`;
        el('road-swatch').style.background = state.roadColor;
        el('view-top').classList.toggle('active', state.view === 'top');
        el('view-3d').classList.toggle('active', state.view === '3d');
        document.body.dataset.mode = state.mode;
        document.querySelectorAll('.mode-switch [data-mode]').forEach(button => {
            const active = button.dataset.mode === state.mode;
            button.classList.toggle('active', active);
            button.setAttribute('aria-selected', String(active));
        });
    }

    function wireControls() {
        const layerBindings = {
            'layer-basemap': 'basemap',
            'layer-buildings': 'buildings',
            'layer-trees': 'trees',
            'layer-roads': 'roads',
            'layer-nodes': 'nodes',
            'layer-routes': 'routes',
            'layer-frequency': 'frequency',
            'layer-rest': 'rest',
            'layer-metric': 'metric',
        };

        for (const [id, key] of Object.entries(layerBindings)) {
            el(id).addEventListener('change', async event => {
                state[key] = event.target.checked;
                if (key === 'frequency' && state.frequency) await updateEdgeFrequency();
                if (key === 'rest' && state.rest) await updateRestHeatmap();
                applyLayerVisibility();
                saveState();
            });
        }

        el('metric-select').addEventListener('change', event => {
            state.metricName = event.target.value;
            updateMetricLayer();
            saveState();
        });

        el('road-color').addEventListener('input', event => {
            state.roadColor = event.target.value;
            el('road-swatch').style.background = state.roadColor;
            if (map && map.getLayer('network-roads')) map.setPaintProperty('network-roads', 'line-color', state.roadColor);
            saveState();
        });

        el('road-width').addEventListener('input', event => {
            state.roadWidth = +event.target.value;
            el('road-width-value').textContent = state.roadWidth.toFixed(1).replace('.0', '');
            if (map && map.getLayer('network-roads')) {
                map.setPaintProperty('network-roads', 'line-width', roadWidthExpression(0));
                map.setPaintProperty('network-casing', 'line-width', roadWidthExpression(2.8));
            }
            saveState();
        });

        el('road-opacity').addEventListener('input', event => {
            state.roadOpacity = +event.target.value;
            el('road-opacity-value').textContent = `${Math.round(state.roadOpacity * 100)}%`;
            applyLayerVisibility();
            saveState();
        });

        el('view-top').addEventListener('click', () => setView('top'));
        el('view-3d').addEventListener('click', () => setView('3d'));
        el('dir-1').addEventListener('click', () => setDirection(1));
        el('dir-2').addEventListener('click', () => setDirection(2));
        el('routes-show-all').addEventListener('click', showAllPersonaRoutes);
        el('routes-clear').addEventListener('click', clearPersonaRoutes);
        document.querySelectorAll('.mode-switch [data-mode]').forEach(button => {
            button.addEventListener('click', () => setMode(button.dataset.mode));
        });

        wirePanelCollapse('collapse-layers', 'restore-layers', dom.layersPanel);
        wirePanelCollapse('collapse-metrics', 'restore-metrics', dom.metricsPanel);
    }

    function wirePanelCollapse(collapseId, restoreId, panel) {
        const restore = el(restoreId);
        el(collapseId).addEventListener('click', () => {
            panel.hidden = true;
            restore.hidden = false;
            window.setTimeout(() => map && map.resize(), 0);
        });
        restore.addEventListener('click', () => {
            if (window.matchMedia('(max-width: 560px)').matches) {
                const otherPanel = panel === dom.layersPanel ? dom.metricsPanel : dom.layersPanel;
                const otherRestore = panel === dom.layersPanel ? el('restore-metrics') : el('restore-layers');
                if (!otherPanel.hidden) {
                    otherPanel.hidden = true;
                    otherRestore.hidden = false;
                }
            }
            panel.hidden = false;
            restore.hidden = true;
            window.setTimeout(() => map && map.resize(), 0);
        });
    }

    function setView(view) {
        state.view = view;
        if (view === 'top') {
            map.dragRotate.disable();
            map.easeTo({ pitch: 0, bearing: 0, duration: 480 });
        } else {
            map.dragRotate.enable();
            map.easeTo({ pitch: 58, bearing: -28, duration: 620 });
        }
        syncControls();
        applyLayerVisibility();
        saveState();
    }

    function wireMapSelection() {
        map.on('click', 'network-hit', event => {
            if (state.mode === 'pedestrian') return;
            const feature = event.features && event.features[0];
            if (!feature) return;
            selectEdge(Number(feature.properties.route));
        });
    }

    async function selectEdge(route) {
        if (!canonicalEdgeByRoute.has(route)) return;
        selectedRoute = route;
        selectedDirection = edgeByRouteDir.has(`${route}|1`) ? 1 : 2;
        const feature = networkFeatures.find(item => Number(item.properties.route) === route);
        map.getSource('selected-edge').setData({ type: 'FeatureCollection', features: feature ? [feature] : [] });
        dom.metricsPanel.classList.add('has-selection');
        if (window.matchMedia('(max-width: 560px)').matches && !dom.layersPanel.hidden) {
            dom.layersPanel.hidden = true;
            el('restore-layers').hidden = false;
        }
        dom.edgeEmpty.hidden = true;
        dom.edgeContent.hidden = false;
        renderSelectedEdge();
        await renderPointMetrics(route);
    }

    function setDirection(direction) {
        if (selectedRoute == null || !edgeByRouteDir.has(`${selectedRoute}|${direction}`)) return;
        selectedDirection = direction;
        renderSelectedEdge();
    }

    function activeEdge() {
        return selectedRoute == null ? null : edgeByRouteDir.get(`${selectedRoute}|${selectedDirection}`) || canonicalEdgeByRoute.get(selectedRoute);
    }

    function renderSelectedEdge() {
        const edge = activeEdge();
        if (!edge) return;
        dom.edgeTitle.textContent = `Route ${edge.route}`;
        dom.edgeRoute.textContent = edge.route;
        el('dir-1').classList.toggle('active', selectedDirection === 1);
        el('dir-2').classList.toggle('active', selectedDirection === 2);
        el('dir-1').disabled = !edgeByRouteDir.has(`${selectedRoute}|1`);
        el('dir-2').disabled = !edgeByRouteDir.has(`${selectedRoute}|2`);

        dom.edgeSummary.innerHTML = [
            summaryItem('Direction', `Dir ${selectedDirection}`),
            summaryItem('Length', `${formatNumber(edge.length, 1)} m`),
            summaryItem('POI count', formatNumber(edge.poi_count, 0)),
            summaryItem('Nodes', `${shortNode(edge.source)} → ${shortNode(edge.target)}`),
        ].join('');

        dom.simMetrics.innerHTML = METRICS.map(metric => {
            const value = edge.sim && edge.sim[metric];
            return `<div class="metric-item" style="--metric-color:${METRIC_COLORS[metric]}"><span>${metric}</span><strong>${formatMetric(metric, value)}</strong></div>`;
        }).join('');

        dom.segmentation.innerHTML = Object.entries(edge.segmentation || {}).map(([name, value]) => {
            const ratio = Math.max(0, Math.min(1, Number(value) || 0));
            return `<div class="segmentation-row"><span>${escapeHtml(name)}</span><div class="segmentation-track"><div class="segmentation-fill" style="width:${ratio * 100}%;--seg-color:${SEGMENT_COLORS[name] || '#9da3a6'}"></div></div><output>${(ratio * 100).toFixed(1)}%</output></div>`;
        }).join('');
    }

    async function renderPointMetrics(route) {
        dom.pointMetrics.innerHTML = '<div class="loading-row">Loading samples...</div>';
        dom.sampleCount.textContent = '';
        try {
            let payload = pointCache.get(route);
            if (!payload) {
                payload = await fetchJson(`/api/route_points/${route}`);
                pointCache.set(route, payload);
            }
            if (selectedRoute !== route) return;
            dom.sampleCount.textContent = `${payload.n_points || 0} points`;
            dom.pointMetrics.innerHTML = METRICS.map(metric => renderTrendCard(metric, (payload.metrics || {})[metric] || [])).join('');
        } catch (error) {
            dom.pointMetrics.innerHTML = '<div class="loading-row">Point metrics unavailable.</div>';
            console.warn(error);
        }
    }

    function renderTrendCard(metric, rawValues) {
        const values = rawValues.map(Number).filter(Number.isFinite);
        if (!values.length) return '';
        const min = Math.min(...values);
        const max = Math.max(...values);
        const average = values.reduce((sum, value) => sum + value, 0) / values.length;
        const span = max - min || 1;
        const points = values.map((value, index) => {
            const x = values.length === 1 ? 50 : (index / (values.length - 1)) * 100;
            const y = 37 - ((value - min) / span) * 32;
            return `${x.toFixed(2)},${y.toFixed(2)}`;
        }).join(' ');
        const unit = METRIC_UNITS[metric] || '';
        return `<div class="trend-card" style="--trend-color:${METRIC_COLORS[metric]}"><div class="trend-meta"><strong>${metric}</strong><span>avg ${formatNumber(average, 2)}${unit ? ` ${unit}` : ''}</span></div><svg viewBox="0 0 100 42" preserveAspectRatio="none" aria-label="${metric} trend"><line class="trend-grid" x1="0" y1="37" x2="100" y2="37"></line><polyline class="trend-line" points="${points}"></polyline></svg></div>`;
    }

    function summaryItem(label, value) {
        return `<div class="summary-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></div>`;
    }

    function shortNode(id) {
        const value = String(id || '');
        return value.length > 12 ? `${value.slice(0, 10)}…` : value;
    }

    function formatMetric(metric, value) {
        if (!Number.isFinite(Number(value))) return '–';
        const unit = METRIC_UNITS[metric];
        return `${formatNumber(value, 2)}${unit ? ` ${unit}` : ''}`;
    }

    function formatNumber(value, digits) {
        const number = Number(value);
        return Number.isFinite(number) ? number.toFixed(digits) : '–';
    }

    function escapeHtml(value) {
        return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
    }

    function metricValueForEdge(edge, metric) {
        if (!edge) return null;
        if (metric === 'POI count') return Number(edge.poi_count) || 0;
        return edge.sim && Number(edge.sim[metric]);
    }

    function updateMetricLayer() {
        if (!map || !map.getSource('network')) return;
        for (const feature of networkFeatures) {
            const edge = canonicalEdgeByRoute.get(Number(feature.properties.route));
            feature.properties.metricValue = metricValueForEdge(edge, state.metricName);
        }
        map.getSource('network').setData(networkGeoJson());
        const values = networkFeatures.map(feature => Number(feature.properties.metricValue)).filter(Number.isFinite);
        const min = values.length ? Math.min(...values) : 0;
        const max = values.length ? Math.max(...values) : 1;
        const mid = min + (max - min) * 0.5;
        if (map.getLayer('network-metric')) {
            map.setPaintProperty('network-metric', 'line-color', ['interpolate', ['linear'], ['get', 'metricValue'], min, '#45d9ff', mid, '#ffd35c', max || 1, '#ff826a']);
        }
        dom.legendLow.textContent = formatNumber(min, state.metricName === 'POI count' ? 0 : 2);
        dom.legendHigh.textContent = formatNumber(max, state.metricName === 'POI count' ? 0 : 2);
    }

    async function loadAllResults() {
        if (allResultsPromise) return allResultsPromise;
        allResultsPromise = (async () => {
            setStatus(`Loading ${resultsIndex.length} simulation routes...`);
            let cursor = 0;
            let completed = 0;
            const workers = Array.from({ length: Math.min(6, resultsIndex.length || 1) }, async () => {
                while (cursor < resultsIndex.length) {
                    const index = cursor++;
                    const meta = resultsIndex[index];
                    try {
                        const result = await fetchJson(`/api/results/${encodeURIComponent(meta.filename)}`);
                        resultCache.set(meta.filename, result);
                    } catch (error) {
                        console.warn('Result load failed:', meta.filename, error);
                    }
                    completed += 1;
                    if (completed % 10 === 0 || completed === resultsIndex.length) setStatus(`Loaded ${completed}/${resultsIndex.length} simulation routes`);
                }
            });
            await Promise.all(workers);
            setStatus(`${graph.nodes.length} nodes · ${canonicalEdgeByRoute.size} edges`);
            return Array.from(resultCache.values());
        })();
        return allResultsPromise;
    }

    async function updateEdgeFrequency() {
        const results = await loadAllResults();
        const counts = new Map();
        for (const result of results) {
            const path = result.path || [];
            for (let index = 0; index < path.length - 1; index += 1) {
                const route = edgeKeyToRoute.get(edgeKey(path[index], path[index + 1]));
                if (route != null) counts.set(route, (counts.get(route) || 0) + 1);
            }
        }
        for (const feature of networkFeatures) feature.properties.frequency = counts.get(Number(feature.properties.route)) || 0;
        map.getSource('network').setData(networkGeoJson());
    }

    async function updateRestHeatmap() {
        const results = await loadAllResults();
        const counts = new Map();
        for (const result of results) {
            for (const step of result.per_step || []) {
                if (step.action !== 'rest') continue;
                const nodeId = String(step.node_before || step.next_node || '');
                counts.set(nodeId, (counts.get(nodeId) || 0) + 1);
            }
        }
        const features = Array.from(counts.entries()).map(([nodeId, count]) => {
            const node = nodeById.get(nodeId);
            if (!node || !Number.isFinite(+node.lng) || !Number.isFinite(+node.lat)) return null;
            return { type: 'Feature', properties: { count }, geometry: { type: 'Point', coordinates: [+node.lng, +node.lat] } };
        }).filter(Boolean);
        map.getSource('rests').setData({ type: 'FeatureCollection', features });
    }

    function colorForResult(meta, index) {
        const key = String(meta.persona_id || meta.filename || '');
        let hash = 0;
        for (const char of key) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
        return ROUTE_COLORS[Math.abs(hash + index) % ROUTE_COLORS.length];
    }

    function renderRouteList() {
        if (!resultsIndex.length) {
            dom.routeList.innerHTML = '<div class="loading-row">No simulation routes.</div>';
            return;
        }
        dom.routeList.innerHTML = resultsIndex.map((meta, index) => {
            const entry = personaRouteState.get(meta.filename);
            const label = `${meta.persona_id || 'persona'} · ${meta.filename}`;
            return `<label class="route-row" title="${escapeHtml(label)}"><input type="checkbox" data-route-file="${escapeHtml(meta.filename)}" ${entry && entry.visible ? 'checked' : ''}><input type="color" data-route-color="${escapeHtml(meta.filename)}" value="${entry ? entry.color : colorForResult(meta, index)}" title="Route color"><span>${escapeHtml(label)}</span></label>`;
        }).join('');

        dom.routeList.querySelectorAll('[data-route-file]').forEach(input => {
            input.addEventListener('change', async event => togglePersonaRoute(event.target.dataset.routeFile, event.target.checked));
        });
        dom.routeList.querySelectorAll('[data-route-color]').forEach(input => {
            input.addEventListener('input', event => {
                const filename = event.target.dataset.routeColor;
                const entry = personaRouteState.get(filename) || { visible: false, color: event.target.value, result: null };
                entry.color = event.target.value;
                personaRouteState.set(filename, entry);
                updatePersonaRouteLayer();
            });
        });
    }

    async function togglePersonaRoute(filename, visible) {
        const metaIndex = resultsIndex.findIndex(item => item.filename === filename);
        const entry = personaRouteState.get(filename) || {
            visible: false,
            color: colorForResult(resultsIndex[metaIndex] || { filename }, Math.max(0, metaIndex)),
            result: null,
        };
        entry.visible = visible;
        personaRouteState.set(filename, entry);
        if (visible && !entry.result) {
            setStatus(`Loading ${filename}...`);
            try {
                entry.result = resultCache.get(filename) || await fetchJson(`/api/results/${encodeURIComponent(filename)}`);
                resultCache.set(filename, entry.result);
            } catch (error) {
                entry.visible = false;
                setStatus(`Could not load ${filename}`, true);
                renderRouteList();
                return;
            }
        }
        updatePersonaRouteLayer();
        setStatus(`${graph.nodes.length} nodes · ${canonicalEdgeByRoute.size} edges`);
    }

    function updatePersonaRouteLayer() {
        if (!map || !map.getSource('persona-routes')) return;
        const features = [];
        for (const [filename, entry] of personaRouteState) {
            if (!entry.visible || !entry.result) continue;
            const coordinates = (entry.result.path || []).map(nodeId => nodeById.get(String(nodeId))).filter(Boolean).map(node => [+node.lng, +node.lat]).filter(validLngLat);
            if (coordinates.length < 2) continue;
            features.push({
                type: 'Feature',
                properties: { filename, color: entry.color },
                geometry: { type: 'LineString', coordinates },
            });
        }
        map.getSource('persona-routes').setData({ type: 'FeatureCollection', features });
    }

    async function showAllPersonaRoutes() {
        state.routes = true;
        el('layer-routes').checked = true;
        await loadAllResults();
        resultsIndex.forEach((meta, index) => {
            const filename = meta.filename;
            const result = resultCache.get(filename);
            if (!result) return;
            const entry = personaRouteState.get(filename) || { color: colorForResult(meta, index) };
            entry.visible = true;
            entry.result = result;
            personaRouteState.set(filename, entry);
        });
        renderRouteList();
        updatePersonaRouteLayer();
        applyLayerVisibility();
        saveState();
    }

    function clearPersonaRoutes() {
        for (const entry of personaRouteState.values()) entry.visible = false;
        renderRouteList();
        updatePersonaRouteLayer();
    }

    async function initialize() {
        if (!window.maplibregl) {
            setStatus('MapLibre failed to load.', true);
            return;
        }
        syncControls();
        wireControls();

        try {
            const [graphData, indexData, loadedStyle] = await Promise.all([
                fetchJson('/api/realmap'),
                fetchJson('/api/results'),
                loadMapStyle(),
            ]);
            prepareGraph(graphData);
            resultsIndex = indexData.filter(item => item && item.filename && !item.filename.startsWith('_'));
            styleInfo = loadedStyle;
            renderRouteList();

            map = new maplibregl.Map({
                container: 'map',
                style: styleInfo.style,
                center: state.center,
                zoom: state.zoom,
                pitch: state.view === '3d' ? Math.max(35, state.pitch || 58) : 0,
                bearing: state.view === '3d' ? state.bearing : 0,
                maxPitch: 76,
                minZoom: 12,
                maxZoom: 19,
                antialias: false,
                fadeDuration: 0,
                refreshExpiredTiles: false,
                attributionControl: true,
            });
            map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), 'bottom-right');
            map.scrollZoom.enable();
            map.dragPan.enable();
            if (state.view === '3d') map.dragRotate.enable();
            else map.dragRotate.disable();

            map.on('load', () => {
                addDataLayers();
                if (!styleInfo.buildingsLayer) {
                    el('layer-buildings').disabled = true;
                    el('layer-buildings').checked = false;
                }
                setStatus(`${graph.nodes.length} nodes · ${canonicalEdgeByRoute.size} edges`);
                resolveReady({
                    map,
                    style: styleInfo.style,
                    buildingsLayer: styleInfo.buildingsLayer,
                    getTreeShapes: () => treeShapesData,
                    treesVisible: () => state.trees,
                    nodeById,
                    edgeByNodes,
                    resultsIndex,
                    fetchResult: async filename => {
                        if (!resultCache.has(filename)) resultCache.set(filename, await fetchJson(`/api/results/${encodeURIComponent(filename)}`));
                        return resultCache.get(filename);
                    },
                });
            });
            map.on('moveend', saveState);
            map.on('error', event => {
                if (event && event.error) console.warn('MapLibre:', event.error.message || event.error);
            });
        } catch (error) {
            console.error(error);
            setStatus(`Map initialization failed: ${error.message}`, true);
        }
    }

    initialize();
})();
