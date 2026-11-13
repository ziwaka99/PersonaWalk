/**
 * realmap-view.js — 2-column layout:
 *   LEFT : square map — static basemap PNG (adjustable) + vis-network graph
 *          Floating rendered-view panel (single image, direction toggle)
 *          draws a marker on the map at the corresponding route endpoint
 *          (Dir1 → Start node, Dir2 → End node).
 *   RIGHT: 5 stacked bar charts of per-point metrics loaded from
 *          /api/route_points/{route_id} (backed by Route_simulation/*.xlsx).
 *          Each step is a fixed 20 px wide; long routes scroll horizontally.
 *
 * Basemap state (offset, scale, rotation, opacity, url) is persisted to
 * localStorage so adjustments survive reloads.
 */

(async () => {
    // ---- DOM ----
    const container     = document.getElementById('graph-container');
    const mapSquare     = document.getElementById('map-square');
    const mapPrintFrame = document.getElementById('map-print-frame');
    const mapSidebar    = document.getElementById('map-sidebar');
    const statusEl      = document.getElementById('status-text');
    const infoNodes     = document.getElementById('info-nodes');
    const infoEdges     = document.getElementById('info-edges');
    const infoRoute     = document.getElementById('info-route');
    const btnFit        = document.getElementById('btn-fit');
    const btnExportPng  = document.getElementById('btn-export-png');
    const ctlExportScale = document.getElementById('ctl-export-scale');
    const valExportScale = document.getElementById('val-export-scale');
    const btnSidebarHide = document.getElementById('btn-sidebar-hide');
    const btnSidebarShow = document.getElementById('btn-sidebar-show');
    const sidebarShowStack = document.getElementById('sidebar-show-stack');
    const chkBasemap    = document.getElementById('chk-basemap');
    const btnBasemapReset = document.getElementById('btn-basemap-reset');
    const basemapImg    = document.getElementById('basemap-img');
    const basemapUploadStatus = document.getElementById('basemap-upload-status');
    const viewPanel     = document.getElementById('view-panel');
    const viewPanelHead = document.getElementById('view-panel-head');
    const viewPanelBody = document.getElementById('view-panel-body');
    const viewPanelTitle= document.getElementById('view-panel-title');
    const viewDirSwitch = document.getElementById('view-dir-switch');
    const barsBody      = document.getElementById('bars-body');
    const barsHeader    = document.getElementById('bars-header');
    const barsMetricPicker = document.getElementById('bars-metric-picker');
    const mapSquareEl   = document.getElementById('map-square');
    const routesList    = document.getElementById('routes-list');

    const btnGraphStyleReset = document.getElementById('btn-graphstyle-reset');
    if (basemapImg) basemapImg.crossOrigin = 'anonymous';

    // ---- Constants ----
    const SIM_METRICS = ['Sky exposure', 'Windspeed', 'MRT', 'UTCI', 'PET'];
    const SIM_UNITS = {
        'Sky exposure': '',
        'Windspeed': 'm/s',
        'MRT': '°C',
        'UTCI': '°C',
        'PET': '°C',
    };
    // Kampong Glam, Singapore — default static tile URL.
    // Esri World Street Map tile server works without an API key and is
    // generally more reliable than staticmap.openstreetmap.de. Tile (zoom,x,y)
    // ≈ (17, 105116, 66100) frames the Kampong Glam core; swap to another
    // tile via the Tile URL field if you want a larger or tighter extent.
    const HIT_COLOR = 'rgba(0,0,0,0.001)';
    const DEFAULT_BASEMAP_URL =
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map' +
        '/MapServer/tile/17/66100/105116';
    // Storage-key version bumps: v1 → v2 dropped stale staticmap URLs;
    // v2 → v3 switched offset/scale from screen-pixels to graph-coordinates
    // (basemap now pans/zooms with the network view).
    const BASEMAP_STORAGE_KEY = 'realmap.basemap.v3';
    const GRAPHSTYLE_STORAGE_KEY = 'realmap.graphstyle.v1';

    // ---- Graph-style state (global node/edge/marker appearance) ----
    const defaultGraphStyle = {
        showNodes: true,
        showEdges: true,
        nodeSize: 7,
        nodeFill: '#74b9ff',
        nodeBorder: '#0984e3',
        edgeWidth: 2,
        edgeColor: '#b2bec3',
        markerSize: 14,
        markerFill: '#ffde59',
        markerBorder: '#d63031',
        markerEdgeWidth: 8,
        markerEdgeColor: '#d63031',
    };
    function loadGraphStyle() {
        try {
            const raw = localStorage.getItem(GRAPHSTYLE_STORAGE_KEY);
            if (raw) return { ...defaultGraphStyle, ...JSON.parse(raw) };
        } catch { /* ignore */ }
        return { ...defaultGraphStyle };
    }
    let graphStyle = loadGraphStyle();

    statusEl.textContent = 'Loading…';

    // ---- Fetch graph ----
    let data;
    try {
        const res = await fetch('api/realmap.json');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        data = await res.json();
    } catch (e) {
        statusEl.style.color = 'var(--danger)';
        statusEl.textContent = 'Failed to load: ' + e.message;
        return;
    }
    statusEl.textContent = '';

    const edgeByRoute = new Map();
    for (const e of data.edges) {
        if (!edgeByRoute.has(e.route)) edgeByRoute.set(e.route, {});
        edgeByRoute.get(e.route)[e.dir] = e;
    }
    infoNodes.textContent = data.nodes.length;
    infoEdges.textContent = edgeByRoute.size;

    // ---- vis-network ----
    const visNodes = new vis.DataSet(
        data.nodes.map(n => ({
            id: n.id,
            x: n.x,
            y: -n.y,
            fixed: true,
            shape: 'dot',
            size: graphStyle.nodeSize,
            label: '',
            color: {
                background: HIT_COLOR,
                border: HIT_COLOR,
                highlight: { background: HIT_COLOR, border: HIT_COLOR },
                hover: { background: HIT_COLOR, border: HIT_COLOR },
            },
            borderWidth: 0,
            _raw: n,
        }))
    );
    const visEdges = new vis.DataSet(
        Array.from(edgeByRoute.entries()).map(([route, pair]) => {
            const primary = pair[1] || pair[2];
            return {
                id: `route-${route}`,
                from: primary.source,
                to: primary.target,
                color: { color: HIT_COLOR, hover: HIT_COLOR, highlight: HIT_COLOR },
                width: Math.max(8, graphStyle.edgeWidth),
                smooth: false,
                _route: route,
            };
        })
    );

    const network = new vis.Network(
        container,
        { nodes: visNodes, edges: visEdges },
        {
            physics: false,
            interaction: {
                hover: true,
                dragNodes: false,
                zoomView: true,
                dragView: true,
                tooltipDelay: 80,
                selectConnectedEdges: false,
            },
            nodes: { borderWidth: 1.5 },
            edges: { smooth: false, hoverWidth: 2, selectionWidth: 3 },
        }
    );

    // make canvas background transparent so basemap shows through
    network.on('afterDrawing', () => {
        const canv = container.querySelector('canvas');
        if (canv) canv.style.background = 'transparent';
    });

    function fitToContainer() {
        const tryFit = () => {
            if (container.clientWidth > 0 && container.clientHeight > 0) {
                network.fit({ animation: false });
            } else {
                requestAnimationFrame(tryFit);
            }
        };
        requestAnimationFrame(tryFit);
    }
    fitToContainer();
    btnFit.addEventListener('click', () => network.fit({ animation: { duration: 400 } }));

    const SIDEBAR_STORAGE_KEY = 'realmap.sidebar.v1';
    function loadSidebarHidden() {
        try { return localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'hidden'; } catch { return false; }
    }
    function setSidebarHidden(hidden) {
        if (!mapSidebar || !sidebarShowStack) return;
        mapSidebar.classList.toggle('is-hidden', hidden);
        sidebarShowStack.hidden = !hidden;
        try { localStorage.setItem(SIDEBAR_STORAGE_KEY, hidden ? 'hidden' : 'visible'); } catch {}
        setTimeout(() => network.redraw(), 0);
    }
    setSidebarHidden(loadSidebarHidden());
    if (btnSidebarHide) btnSidebarHide.addEventListener('click', () => setSidebarHidden(true));
    if (btnSidebarShow) btnSidebarShow.addEventListener('click', () => setSidebarHidden(false));

    const EXPORT_STORAGE_KEY = 'realmap.export.v1';
    let exportScale = 3;
    try {
        const savedExport = JSON.parse(localStorage.getItem(EXPORT_STORAGE_KEY) || '{}');
        if (Number.isFinite(savedExport.scale)) exportScale = Math.max(1, Math.min(6, Math.round(savedExport.scale)));
    } catch { /* ignore */ }
    function syncExportControls() {
        if (ctlExportScale) ctlExportScale.value = exportScale;
        if (valExportScale) valExportScale.textContent = `${exportScale}x`;
    }
    syncExportControls();
    if (ctlExportScale) {
        ctlExportScale.addEventListener('input', () => {
            exportScale = Math.max(1, Math.min(6, Number(ctlExportScale.value) || 3));
            syncExportControls();
            try { localStorage.setItem(EXPORT_STORAGE_KEY, JSON.stringify({ scale: exportScale })); } catch {}
        });
    }

    async function exportMapPng() {
        const canvas = container.querySelector('canvas');
        if (!canvas) {
            alert('Map canvas is not ready yet.');
            return;
        }
        const scale = exportScale;
        const canvasRect = canvas.getBoundingClientRect();
        const frameRect = mapPrintFrame ? mapPrintFrame.getBoundingClientRect() : canvasRect;
        const relX = Math.max(0, frameRect.left - canvasRect.left);
        const relY = Math.max(0, frameRect.top - canvasRect.top);
        const relW = Math.min(frameRect.width, canvasRect.width - relX);
        const relH = Math.min(frameRect.height, canvasRect.height - relY);
        const relSide = Math.max(1, Math.min(relW, relH));
        const pxScaleX = canvas.width / Math.max(1, canvasRect.width);
        const pxScaleY = canvas.height / Math.max(1, canvasRect.height);
        const srcX = Math.round(relX * pxScaleX);
        const srcY = Math.round(relY * pxScaleY);
        const srcW = Math.round(relSide * pxScaleX);
        const srcH = Math.round(relSide * pxScaleY);
        const out = document.createElement('canvas');
        out.width = Math.max(1, Math.round(srcW * scale));
        out.height = Math.max(1, Math.round(srcH * scale));
        const outCtx = out.getContext('2d');
        outCtx.fillStyle = '#eef1f5';
        outCtx.fillRect(0, 0, out.width, out.height);
        outCtx.imageSmoothingEnabled = true;
        outCtx.imageSmoothingQuality = 'high';
        outCtx.drawImage(canvas, srcX, srcY, srcW, srcH, 0, 0, out.width, out.height);

        const blob = await new Promise((resolve, reject) => {
            try {
                out.toBlob(b => b ? resolve(b) : reject(new Error('PNG export failed.')), 'image/png');
            } catch (err) {
                reject(err);
            }
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        a.href = url;
        a.download = `realmap-${stamp}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    if (btnExportPng) {
        btnExportPng.addEventListener('click', async () => {
            const original = btnExportPng.textContent;
            btnExportPng.disabled = true;
            btnExportPng.textContent = 'Exporting...';
            try {
                network.redraw();
                await new Promise(resolve => requestAnimationFrame(resolve));
                await exportMapPng();
            } catch (e) {
                alert('Export failed. If you are using a remote basemap, the image server may block canvas export. Try uploading a local basemap image, then export again.');
            } finally {
                btnExportPng.textContent = original;
                btnExportPng.disabled = false;
            }
        });
    }

    // ---- Tooltip ----
    let tooltipEl = null;
    function getTooltip() {
        if (!tooltipEl) {
            tooltipEl = document.createElement('div');
            tooltipEl.className = 'tooltip';
            document.body.appendChild(tooltipEl);
        }
        return tooltipEl;
    }
    function showTip(event, html) {
        const el = getTooltip();
        el.innerHTML = html;
        const x = event.clientX || (event.center && event.center.x) || 0;
        const y = event.clientY || (event.center && event.center.y) || 0;
        el.style.left = (x + 14) + 'px';
        el.style.top  = (y - 8)  + 'px';
        el.classList.add('visible');
    }
    function hideTip() { if (tooltipEl) tooltipEl.classList.remove('visible'); }
    network.on('hoverEdge', p => {
        const e = visEdges.get(p.edge);
        if (e) showTip(p.event, `<strong>Route ${e._route}</strong>`);
    });
    network.on('blurEdge', hideTip);

    // ---- Basemap transform state ----
    const defaultBasemap = {
        url: DEFAULT_BASEMAP_URL,
        offsetX: 0,
        offsetY: 0,
        scale: 2.5,     // 256×256 tile scaled to fill most of the map square
        rotation: 0,
        opacity: 0.65,
        visible: true,
    };
    let basemapState = loadBasemapState();

    function loadBasemapState() {
        try {
            const raw = localStorage.getItem(BASEMAP_STORAGE_KEY);
            if (raw) return { ...defaultBasemap, ...JSON.parse(raw) };
        } catch { /* ignore */ }
        return { ...defaultBasemap };
    }
    function saveBasemapState() {
        try {
            localStorage.setItem(BASEMAP_STORAGE_KEY, JSON.stringify(basemapState));
            return true;
        } catch {
            return false;
        }
    }

    // We only use basemapImg as an off-screen loader; actual rendering happens
    // inside vis-network's canvas (beforeDrawing hook) so the basemap pans
    // and zooms together with the graph.
    let basemapLoaded = false;
    function applyBasemap() {
        const url = basemapState.url || '';
        if (url && basemapImg.src !== url) {
            basemapLoaded = false;
            basemapImg.src = url;
        } else if (!url) {
            basemapLoaded = false;
        }
        network.redraw();
    }
    basemapImg.addEventListener('load',  () => { basemapLoaded = true; network.redraw(); });
    basemapImg.addEventListener('error', () => { basemapLoaded = false; network.redraw(); });

    // Draw the basemap on the graph canvas *before* nodes/edges, so it sits
    // underneath them. vis-network has already applied its view transform at
    // this point, so drawing in graph coordinates makes the image follow the
    // zoom / pan of the graph automatically.
    network.on('beforeDrawing', (ctx) => {
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

    // Wire basemap controls
    const ctlOx = document.getElementById('ctl-ox');
    const ctlOy = document.getElementById('ctl-oy');
    const ctlSc = document.getElementById('ctl-sc');
    const ctlRt = document.getElementById('ctl-rt');
    const ctlOp = document.getElementById('ctl-op');
    const ctlUrl = document.getElementById('ctl-url');
    const ctlFile = document.getElementById('ctl-file');
    const btnBasemapClear = document.getElementById('btn-basemap-clear');
    const valOx = document.getElementById('val-ox');
    const valOy = document.getElementById('val-oy');
    const valSc = document.getElementById('val-sc');
    const valRt = document.getElementById('val-rt');
    const valOp = document.getElementById('val-op');

    function syncControlsFromState() {
        ctlOx.value = basemapState.offsetX;  valOx.textContent = basemapState.offsetX;
        ctlOy.value = basemapState.offsetY;  valOy.textContent = basemapState.offsetY;
        ctlSc.value = basemapState.scale;    valSc.textContent = Number(basemapState.scale).toFixed(2);
        ctlRt.value = basemapState.rotation; valRt.textContent = basemapState.rotation;
        ctlOp.value = basemapState.opacity;  valOp.textContent = Number(basemapState.opacity).toFixed(2);
        // Don't dump gigantic data URLs into the text input — show filename instead.
        const isUploaded = typeof basemapState.url === 'string' && basemapState.url.startsWith('data:');
        if (isUploaded) {
            ctlUrl.value = '';
            basemapUploadStatus.textContent = basemapState.uploadName
                ? `Uploaded: ${basemapState.uploadName}`
                : 'Uploaded image in use';
            basemapUploadStatus.hidden = false;
        } else {
            ctlUrl.value = basemapState.url || '';
            basemapUploadStatus.hidden = true;
            basemapUploadStatus.textContent = '';
        }
        chkBasemap.checked = basemapState.visible;
    }
    syncControlsFromState();
    applyBasemap();

    // All basemap controls auto-persist — user never has to hit "Save".
    ctlOx.addEventListener('input', () => { basemapState.offsetX = +ctlOx.value; valOx.textContent = ctlOx.value; applyBasemap(); saveBasemapState(); });
    ctlOy.addEventListener('input', () => { basemapState.offsetY = +ctlOy.value; valOy.textContent = ctlOy.value; applyBasemap(); saveBasemapState(); });
    ctlSc.addEventListener('input', () => { basemapState.scale   = +ctlSc.value; valSc.textContent = Number(ctlSc.value).toFixed(2); applyBasemap(); saveBasemapState(); });
    ctlRt.addEventListener('input', () => { basemapState.rotation= +ctlRt.value; valRt.textContent = ctlRt.value; applyBasemap(); saveBasemapState(); });
    ctlOp.addEventListener('input', () => { basemapState.opacity = +ctlOp.value; valOp.textContent = Number(ctlOp.value).toFixed(2); applyBasemap(); saveBasemapState(); });
    ctlUrl.addEventListener('change', () => {
        const v = ctlUrl.value.trim();
        basemapState.url = v || DEFAULT_BASEMAP_URL;
        delete basemapState.uploadName;
        basemapUploadStatus.hidden = true;
        basemapUploadStatus.textContent = '';
        applyBasemap();
        saveBasemapState();
    });

    // ---- Local file upload → data URL ----
    ctlFile.addEventListener('change', (ev) => {
        const file = ev.target.files && ev.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            basemapState.url = reader.result;
            basemapState.uploadName = file.name;
            ctlUrl.value = '';
            basemapUploadStatus.textContent = `Uploaded: ${file.name}`;
            basemapUploadStatus.hidden = false;
            applyBasemap();
            if (!saveBasemapState()) {
                // localStorage has a ~5 MB quota; big images get rejected silently.
                alert('Image is too large for localStorage — it works this session ' +
                      'but will not survive a reload.');
            }
        };
        reader.onerror = () => alert('Failed to read the file.');
        reader.readAsDataURL(file);
    });

    chkBasemap.addEventListener('change', () => {
        basemapState.visible = chkBasemap.checked;
        applyBasemap();
        saveBasemapState();
    });
    btnBasemapReset.addEventListener('click', () => {
        basemapState = { ...defaultBasemap };
        syncControlsFromState();
        applyBasemap();
        saveBasemapState();
    });
    btnBasemapClear.addEventListener('click', () => {
        // Remove saved state + unload any uploaded image, return to blank map.
        try { localStorage.removeItem(BASEMAP_STORAGE_KEY); } catch {}
        basemapState = { ...defaultBasemap, url: '', visible: false };
        syncControlsFromState();
        applyBasemap();
        saveBasemapState();
    });

    // ---- Graph-style panel wiring ----
    const chkGraphNodes = document.getElementById('chk-graph-nodes');
    const chkGraphEdges = document.getElementById('chk-graph-edges');
    const ctlNs = document.getElementById('ctl-ns');
    const ctlNf = document.getElementById('ctl-nf');
    const ctlNb = document.getElementById('ctl-nb');
    const ctlEw = document.getElementById('ctl-ew');
    const ctlEc = document.getElementById('ctl-ec');
    const ctlMs  = document.getElementById('ctl-ms');
    const ctlMf  = document.getElementById('ctl-mf');
    const ctlMb  = document.getElementById('ctl-mb');
    const ctlMew = document.getElementById('ctl-mew');
    const ctlMec = document.getElementById('ctl-mec');
    const valNs = document.getElementById('val-ns');
    const valNf = document.getElementById('val-nf');
    const valNb = document.getElementById('val-nb');
    const valEw = document.getElementById('val-ew');
    const valEc = document.getElementById('val-ec');
    const valMs  = document.getElementById('val-ms');
    const valMf  = document.getElementById('val-mf');
    const valMb  = document.getElementById('val-mb');
    const valMew = document.getElementById('val-mew');
    const valMec = document.getElementById('val-mec');

    function syncGraphStyleControls() {
        if (chkGraphNodes) chkGraphNodes.checked = graphStyle.showNodes !== false;
        if (chkGraphEdges) chkGraphEdges.checked = graphStyle.showEdges !== false;
        ctlNs.value = graphStyle.nodeSize;   valNs.textContent = graphStyle.nodeSize;
        ctlNf.value = graphStyle.nodeFill;   valNf.textContent = graphStyle.nodeFill;
        ctlNb.value = graphStyle.nodeBorder; valNb.textContent = graphStyle.nodeBorder;
        ctlEw.value = graphStyle.edgeWidth;  valEw.textContent = graphStyle.edgeWidth;
        ctlEc.value = graphStyle.edgeColor;  valEc.textContent = graphStyle.edgeColor;
        ctlMs.value = graphStyle.markerSize; valMs.textContent = graphStyle.markerSize;
        ctlMf.value = graphStyle.markerFill; valMf.textContent = graphStyle.markerFill;
        ctlMb.value = graphStyle.markerBorder; valMb.textContent = graphStyle.markerBorder;
        if (ctlMew) { ctlMew.value = graphStyle.markerEdgeWidth; valMew.textContent = graphStyle.markerEdgeWidth; }
        if (ctlMec) { ctlMec.value = graphStyle.markerEdgeColor; valMec.textContent = graphStyle.markerEdgeColor; }
    }
    syncGraphStyleControls();

    function applyGraphStyle() {
        // Update all base nodes; skip overlay markers (_isOverlayNode).
        const nodeUpdates = [];
        const markerUpdates = [];
        visNodes.forEach(n => {
            if (n._isOverlayNode) {
                markerUpdates.push({
                    id: n.id,
                    size: graphStyle.markerSize,
                    color: {
                        background: graphStyle.markerFill,
                        border: graphStyle.markerBorder,
                        highlight: { background: graphStyle.markerFill, border: graphStyle.markerBorder },
                        hover:     { background: graphStyle.markerFill, border: graphStyle.markerBorder },
                    },
                });
                return;
            }
            nodeUpdates.push({
                id: n.id,
                size: graphStyle.nodeSize,
                color: {
                    background: HIT_COLOR,
                    border: HIT_COLOR,
                    highlight: { background: HIT_COLOR, border: HIT_COLOR },
                    hover: { background: HIT_COLOR, border: HIT_COLOR },
                },
                borderWidth: 0,
            });
        });
        try { visNodes.update(nodeUpdates); } catch {}
        try { if (markerUpdates.length) visNodes.update(markerUpdates); } catch {}

        // Update only the base route edges (skip persona overlays which carry _personaOverlay).
        const edgeUpdates = [];
        visEdges.forEach(e => {
            if (e._personaOverlay) return;
            edgeUpdates.push({
                id: e.id,
                width: Math.max(8, graphStyle.edgeWidth),
                color: { color: HIT_COLOR, hover: HIT_COLOR, highlight: HIT_COLOR },
            });
        });
        try { visEdges.update(edgeUpdates); } catch {}
        // Re-apply highlight on the active route's edge (was overwritten above).
        if (typeof applyEdgeHighlight === 'function') applyEdgeHighlight();
        network.redraw();
    }

    function saveGraphStyle() {
        try { localStorage.setItem(GRAPHSTYLE_STORAGE_KEY, JSON.stringify(graphStyle)); } catch { /* ignore */ }
    }

    if (chkGraphNodes) chkGraphNodes.addEventListener('change', () => { graphStyle.showNodes = chkGraphNodes.checked; applyGraphStyle(); saveGraphStyle(); });
    if (chkGraphEdges) chkGraphEdges.addEventListener('change', () => { graphStyle.showEdges = chkGraphEdges.checked; applyGraphStyle(); saveGraphStyle(); });
    ctlNs.addEventListener('input', () => { graphStyle.nodeSize = +ctlNs.value; valNs.textContent = ctlNs.value; applyGraphStyle(); saveGraphStyle(); });
    ctlNf.addEventListener('input', () => { graphStyle.nodeFill = ctlNf.value;   valNf.textContent = ctlNf.value; applyGraphStyle(); saveGraphStyle(); });
    ctlNb.addEventListener('input', () => { graphStyle.nodeBorder = ctlNb.value; valNb.textContent = ctlNb.value; applyGraphStyle(); saveGraphStyle(); });
    ctlEw.addEventListener('input', () => { graphStyle.edgeWidth = +ctlEw.value; valEw.textContent = ctlEw.value; applyGraphStyle(); saveGraphStyle(); });
    ctlEc.addEventListener('input', () => { graphStyle.edgeColor = ctlEc.value;  valEc.textContent = ctlEc.value; applyGraphStyle(); saveGraphStyle(); });
    ctlMs.addEventListener('input', () => { graphStyle.markerSize = +ctlMs.value; valMs.textContent = ctlMs.value; applyGraphStyle(); saveGraphStyle(); });
    ctlMf.addEventListener('input', () => { graphStyle.markerFill = ctlMf.value;  valMf.textContent = ctlMf.value; applyGraphStyle(); saveGraphStyle(); });
    ctlMb.addEventListener('input', () => { graphStyle.markerBorder = ctlMb.value; valMb.textContent = ctlMb.value; applyGraphStyle(); saveGraphStyle(); });
    ctlMew?.addEventListener('input', () => {
        graphStyle.markerEdgeWidth = +ctlMew.value;
        valMew.textContent = ctlMew.value;
        applyEdgeHighlight();
        saveGraphStyle();
    });
    ctlMec?.addEventListener('input', () => {
        graphStyle.markerEdgeColor = ctlMec.value;
        valMec.textContent = ctlMec.value;
        applyEdgeHighlight();
        saveGraphStyle();
    });
    btnGraphStyleReset.addEventListener('click', () => {
        graphStyle = { ...defaultGraphStyle };
        syncGraphStyleControls();
        applyGraphStyle();
        saveGraphStyle();
    });

    // ---- Metric-selection state (which bar charts are visible) ----
    const METRIC_SEL_KEY = 'realmap.metric_selection.v1';
    function loadMetricSelection() {
        try {
            const raw = localStorage.getItem(METRIC_SEL_KEY);
            if (raw) {
                const obj = JSON.parse(raw);
                if (obj && typeof obj === 'object') return obj;
            }
        } catch { /* ignore */ }
        // Default: all visible
        const d = {};
        for (const m of SIM_METRICS) d[m] = true;
        return d;
    }
    let metricSelection = loadMetricSelection();
    function saveMetricSelection() {
        try { localStorage.setItem(METRIC_SEL_KEY, JSON.stringify(metricSelection)); } catch {}
    }
    // Wire metric checkboxes
    barsMetricPicker.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        const m = cb.dataset.metric;
        if (metricSelection[m] === false) cb.checked = false;
        else cb.checked = true;
        cb.addEventListener('change', () => {
            metricSelection[m] = cb.checked;
            saveMetricSelection();
            if (activeRoute != null) renderRight();
        });
    });

    // ---- Selection + per-route state ----
    let activeRoute = null;
    let activeDir = 1;
    let highlightedEdgeIds = [];   // visEdge ids currently styled as the picked edge

    // Revert previously-highlighted edges back to the base edge style.
    function clearEdgeHighlight() {
        if (!highlightedEdgeIds.length) return;
        const updates = highlightedEdgeIds
            .map(id => visEdges.get(id))
            .filter(e => e && !e._personaOverlay)
            .map(e => ({
                id: e.id,
                width: Math.max(8, graphStyle.edgeWidth),
                color: { color: HIT_COLOR, hover: HIT_COLOR, highlight: HIT_COLOR },
            }));
        if (updates.length) {
            try { visEdges.update(updates); } catch {}
        }
        highlightedEdgeIds = [];
    }

    // Re-apply the active route's edge highlight (used both on edge-click and
    // when the highlight style controls change).
    function applyEdgeHighlight() {
        if (activeRoute == null) return;
        const w = graphStyle.markerEdgeWidth;
        const c = graphStyle.markerEdgeColor;
        const matches = [];
        visEdges.forEach(e => {
            if (!e._personaOverlay && e._route === activeRoute) matches.push(e.id);
        });
        if (!matches.length) return;
        const updates = matches.map(id => ({
            id,
            width: w,
            color: { color: c, hover: c, highlight: c },
        }));
        try { visEdges.update(updates); } catch {}
        highlightedEdgeIds = matches;
    }

    network.on('click', async params => {
        if (params.edges.length > 0 && params.nodes.length === 0) {
            const edge = visEdges.get(params.edges[0]);
            if (!edge || edge._personaOverlay) return;
            clearEdgeHighlight();
            activeRoute = edge._route;
            applyEdgeHighlight();
            infoRoute.textContent = `Route: ${activeRoute}`;
            renderView();
            await renderRight();
        }
    });

    // In-panel direction buttons (live on the floating view panel)
    viewDirSwitch.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
            viewDirSwitch.querySelectorAll('button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeDir = Number(btn.dataset.dir);
            renderView();
        });
    });

    // Overlay node id used to mark "which end" the image is looking from.
    const VIEW_MARKER_ID = '__view_marker__';
    function clearViewMarker() {
        try { visNodes.remove(VIEW_MARKER_ID); } catch { /* not present */ }
    }
    function setViewMarker(node, label) {
        if (!node) return;
        clearViewMarker();
        try {
            visNodes.add({
                id: VIEW_MARKER_ID,
                x: node.x,
                y: -node.y,
                fixed: true,
                shape: 'dot',
                size: graphStyle.markerSize,
                label: label,
                font: { size: 13, color: graphStyle.markerBorder, face: 'system-ui', strokeWidth: 3, strokeColor: '#ffffff' },
                color: {
                    background: graphStyle.markerFill,
                    border: graphStyle.markerBorder,
                    highlight: { background: graphStyle.markerFill, border: graphStyle.markerBorder },
                    hover:     { background: graphStyle.markerFill, border: graphStyle.markerBorder },
                },
                borderWidth: 2.5,
                _isOverlayNode: true,
            });
        } catch { /* ignore */ }
    }

    function renderView() {
        if (activeRoute == null) {
            viewPanelTitle.textContent = 'Rendered view';
            viewPanelBody.innerHTML =
                `<div class="view-empty">Click any route on the map to load its rendered view.</div>`;
            clearViewMarker();
            return;
        }
        const pair = edgeByRoute.get(activeRoute) || {};
        const edgeActive = pair[activeDir];

        // Dir 1 is "looking from Start toward End" → marker at Start.
        // Dir 2 is the reverse → marker at End.
        // source on a directional edge is the end the photographer is standing at.
        if (edgeActive) {
            const markerNode = data.nodes.find(n => n.id === edgeActive.source);
            const endLabel = activeDir === 1 ? 'Start' : 'End';
            if (viewPanel.classList.contains('is-hidden')) clearViewMarker();
            else setViewMarker(markerNode, `R${activeRoute} · ${endLabel}`);
            viewPanelTitle.textContent =
                `Route ${activeRoute} · Dir ${activeDir} · from ${endLabel}`;
            const url = `api/route_view/${activeDir}/${activeRoute}.png`;
            viewPanelBody.innerHTML = `
                <img src="${url}" alt="Route ${activeRoute} dir ${activeDir}">
                <div class="view-cap">
                    Looking from <strong>${endLabel}</strong> of Route ${activeRoute}
                    (Dir ${activeDir})
                </div>`;
        } else {
            clearViewMarker();
            viewPanelTitle.textContent =
                `Route ${activeRoute} · Dir ${activeDir} unavailable`;
            viewPanelBody.innerHTML =
                `<div class="view-missing">No image for Dir ${activeDir} of this route.</div>`;
        }
    }

    // (Hide Rendered View button removed — the render view always lives in the
    // bottom row of the dual-pane layout, so there is nothing to toggle here.)

    // ---- Bar charts (right panel) ----
    // Thermal UTCI/PET color scale (°C). Colors inspired by the reference image.
    const UTCI_COLORS = [
        { lim: -Infinity, color: '#2e9fbf' },   // extreme cold
        { lim: 9,  color: '#7fcfe0' },           // cold
        { lim: 26, color: '#ffe97a' },           // no thermal stress → moderate
        { lim: 32, color: '#ffb45a' },           // moderate heat stress
        { lim: 38, color: '#e8603a' },           // strong heat stress
        { lim: 46, color: '#b53423' },           // very strong / extreme
    ];
    const PET_COLORS = [
        { lim: -Infinity, color: '#2e9fbf' },
        { lim: 18, color: '#7fcfe0' },
        { lim: 23, color: '#ffe97a' },
        { lim: 29, color: '#ffb45a' },
        { lim: 35, color: '#e8603a' },
        { lim: 41, color: '#b53423' },
    ];

    function thermalColor(value, table) {
        if (value == null || Number.isNaN(value)) return '#cbd5e1';
        let c = table[0].color;
        for (const t of table) { if (value >= t.lim) c = t.color; }
        return c;
    }

    // Gradient (cool→hot) for non-thermal metrics, scaled by value range.
    function gradientColor(t) {
        // t ∈ [0,1] → cyan → yellow → orange → red
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
    function colorWithAlpha(color, alpha) {
        const a = Math.max(0, Math.min(1, alpha));
        const rgbMatch = String(color).match(/rgba?\(([^)]+)\)/);
        if (rgbMatch) {
            const parts = rgbMatch[1].split(',').map(s => parseFloat(s.trim()));
            return `rgba(${parts[0] || 0},${parts[1] || 0},${parts[2] || 0},${a})`;
        }
        const [r, g, b] = hex2rgb(color);
        return `rgba(${r},${g},${b},${a})`;
    }
    function redContourRgba(t, opacity) {
        const q = Math.max(0, Math.min(1, t));
        const r = Math.round(255 + (233 - 255) * q);
        const g = Math.round(232 + (38 - 232) * q);
        const b = Math.round(232 + (37 - 232) * q);
        const a = Math.max(0, Math.min(1, opacity * (0.18 + 0.58 * Math.pow(q, 0.8))));
        return [r, g, b, Math.round(a * 255)];
    }

    function colorForMetric(metric, value, min, max) {
        if (value == null || Number.isNaN(value)) return '#cbd5e1';
        if (metric === 'PET')  return thermalColor(value, PET_COLORS);
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

    // Fixed Y-axis ranges for right-panel charts.
    // Delete a metric or set it to null to fall back to per-route auto scaling.
    const SIM_Y_RANGES = {
        'Sky exposure': [0, 0.8],
        'Windspeed':    [0, 1.5],
        'MRT':          [40, 55],
        'UTCI':         [30, 40],
        'PET':          [30, 55],
    };

    // Per-metric axis titles (Y) shown inside the chart.
    const SIM_Y_AXIS_LABEL = {
        'Sky exposure': 'Sky exposure',
        'Windspeed':    'Wind speed (m/s)',
        'MRT':          'MRT (°C)',
        'UTCI':         'UTCI (°C)',
        'PET':          'PET (°C)',
    };
    const STEP_PX = 20;   // fixed pixel width per per-point step

    function fmtTickSim(v, metric) {
        const abs = Math.abs(v);
        if (metric === 'Sky exposure') return v.toFixed(2);
        if (abs < 1) return v.toFixed(2);
        if (abs < 10) return v.toFixed(1);
        return v.toFixed(0);
    }

    function getMetricAxisRange(metric, values) {
        const [dataLo, dataHi] = computeExtents(values);
        const preset = SIM_Y_RANGES[metric];
        if (Array.isArray(preset) && preset.length === 2) {
            const [axisLo, axisHi] = preset;
            if (Number.isFinite(axisLo) && Number.isFinite(axisHi) && axisHi > axisLo) {
                return { dataLo, dataHi, axisLo, axisHi };
            }
        }
        return {
            dataLo,
            dataHi,
            axisLo: dataLo >= 0 ? 0 : dataLo,
            axisHi: dataHi,
        };
    }

    function renderBarChart(metric, values) {
        const { dataLo, dataHi, axisLo, axisHi } = getMetricAxisRange(metric, values);
        const baseline = axisLo;
        const top = axisHi;

        const n = values.length;
        // Layout (pixel space): padL for y-axis labels, padBot for x-axis ticks+title.
        // Right side now reserves room for the mean-value label outside the plot area.
        const padL = 44;
        const padR = 10;
        const meanLabelGutter = 68;   // extra space to the right of the plot for μ label
        const padTop = 8;
        const padBot = 30;
        const chartH = 72;
        const chartW = Math.max(STEP_PX, n * STEP_PX);
        const plotRight = padL + chartW + padR;
        const W = plotRight + meanLabelGutter;
        const H = padTop + chartH + padBot;

        const yFor = (v) => {
            if (top === baseline) return padTop + chartH;
            const clamped = Math.max(baseline, Math.min(top, v));
            return padTop + (1 - (clamped - baseline) / (top - baseline)) * chartH;
        };

        // Plot inner bounds — x = [padL, plotR]. padR sits between plotR and the mean-label gutter.
        const plotR = padL + chartW;

        // --- Y-axis ticks (4 gridlines: baseline, 33%, 66%, top)
        const tickVals = [baseline,
                          baseline + (top - baseline) * 0.33,
                          baseline + (top - baseline) * 0.66,
                          top];
        const yTicks = tickVals.map(v => {
            const y = yFor(v);
            return `
                <line class="grid-line" x1="${padL}" y1="${y.toFixed(1)}" x2="${plotR}" y2="${y.toFixed(1)}"></line>
                <line class="axis-tick" x1="${padL - 3}" y1="${y.toFixed(1)}" x2="${padL}" y2="${y.toFixed(1)}"></line>
                <text class="axis-label" x="${padL - 5}" y="${(y + 3).toFixed(1)}" text-anchor="end">${fmtTickSim(v, metric)}</text>
            `;
        }).join('');

        // --- Bars (one per step, fixed 20 px)
        const bars = values.map((v, i) => {
            if (v == null || Number.isNaN(v)) return '';
            const yTop = yFor(v);
            const h = (padTop + chartH) - yTop;
            const x = padL + i * STEP_PX;
            const color = colorForMetric(metric, v, baseline, top);
            const unit = SIM_UNITS[metric] ? ` ${SIM_UNITS[metric]}` : '';
            const title = `step ${i + 1}  ${Number(v).toFixed(3)}${unit}`;
            return `<rect class="bar" x="${x.toFixed(1)}" y="${yTop.toFixed(1)}" ` +
                   `width="${(STEP_PX - 2).toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" ` +
                   `fill="${color}"><title>${title}</title></rect>`;
        }).join('');

        // --- X-axis ticks (every step up to ~15 labels; else stride)
        const stride = n <= 15 ? 1 : Math.ceil(n / 15);
        let xTicks = '';
        for (let i = 0; i < n; i++) {
            if (i !== 0 && i !== n - 1 && (i % stride) !== 0) continue;
            const step = i + 1;
            const x = padL + i * STEP_PX + STEP_PX / 2;
            const y = padTop + chartH;
            xTicks += `
                <line class="axis-tick" x1="${x.toFixed(1)}" y1="${y}" x2="${x.toFixed(1)}" y2="${y + 3}"></line>
                <text class="axis-label" x="${x.toFixed(1)}" y="${y + 14}" text-anchor="middle">${step}</text>
            `;
        }

        // --- Axis lines
        const axis = `
            <line class="axis-line" x1="${padL}" y1="${padTop + chartH}" x2="${plotR}" y2="${padTop + chartH}"></line>
            <line class="axis-line" x1="${padL}" y1="${padTop}" x2="${padL}" y2="${padTop + chartH}"></line>
        `;

        // --- Mean value dashed line + label (skips NaN / null).
        //     Line stays inside the plot; label sits in the right-hand gutter so it
        //     never overlaps bars or the chart area.
        const numeric = values.filter(v => v != null && !Number.isNaN(Number(v))).map(Number);
        let meanLine = '';
        if (numeric.length > 0) {
            const mean = numeric.reduce((a, b) => a + b, 0) / numeric.length;
            const yMean = yFor(mean);
            const meanClamped = mean >= baseline && mean <= top;
            const unitStr = SIM_UNITS[metric] ? ` ${SIM_UNITS[metric]}` : '';
            const meanText = `avg ${Number(mean).toFixed(2)}${unitStr}`;
            const labelX = plotR + padR + 2;
            const labelY = yMean + 3;
            const meanColor = '#475569';
            meanLine = meanClamped ? `
                <line class="mean-line" x1="${padL}" y1="${yMean.toFixed(1)}" x2="${plotR}" y2="${yMean.toFixed(1)}"
                      stroke="${meanColor}" stroke-width="1.2" stroke-dasharray="4,3"></line>
                <text class="mean-label" x="${labelX.toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="start"
                      fill="${meanColor}" font-size="10" font-weight="700">${meanText}</text>
            ` : '';
        }

        // --- Axis titles (Y-axis title removed; chart row already shows the metric name)
        const xTitle = `<text class="axis-title" x="${padL + chartW / 2}" y="${H - 4}" text-anchor="middle">Step</text>`;

        const svg = `<svg class="bar-chart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
            ${yTicks}
            ${axis}
            ${bars}
            ${meanLine}
            ${xTicks}
            ${xTitle}
        </svg>`;

        const unit = SIM_UNITS[metric] ? ` ${SIM_UNITS[metric]}` : '';
        const metaText = `${n} pts · min ${Number(dataLo).toFixed(2)}${unit} · max ${Number(dataHi).toFixed(2)}${unit}`;
        return `
            <div class="bar-row" data-metric="${metric}">
                <div class="bar-row-header">
                    <span class="bar-row-title">${metric}</span>
                    <span class="bar-row-meta">${metaText}</span>
                </div>
                <div class="bar-chart-wrap">${svg}</div>
            </div>
        `;
    }

    // ==========================================================
    //   Persona route overlay (multi-select with color picker)
    // ==========================================================

    // Build a lookup: "source|target" → edge id (both directions), so we can
    // match a result's walked path (consecutive node pairs) to realmap edges.
    const edgeKeyToId = new Map();
    for (const e of data.edges) {
        edgeKeyToId.set(`${e.source}|${e.target}`, `route-${e.route}`);
        edgeKeyToId.set(`${e.target}|${e.source}`, `route-${e.route}`);
    }

    const ROUTE_PALETTE = [
        '#d63031', '#0984e3', '#00b894', '#6c5ce7',
        '#e17055', '#fdcb6e', '#e84393', '#00cec9',
    ];
    let paletteIdx = 0;
    const btnRoutesShowAll = document.getElementById('btn-routes-show-all');
    const btnRoutesClearAll = document.getElementById('btn-routes-clear-all');

    // filename → { color, checkbox, colorInput, result, overlayEdgeIds[] }
    const ROUTE_OVERLAY_STORAGE_KEY = 'realmap.route_overlay.v1';
    const defaultRouteOverlayStyle = {
        separateOverlaps: true,
        laneSpacing: 7,
        lineWidth: 5,
        opacity: 0.92,
        smoothCurves: true,
        curveRadius: 18,
    };
    function loadRouteOverlayStyle() {
        try {
            const raw = localStorage.getItem(ROUTE_OVERLAY_STORAGE_KEY);
            if (raw) return { ...defaultRouteOverlayStyle, ...JSON.parse(raw) };
        } catch { /* ignore */ }
        return { ...defaultRouteOverlayStyle };
    }
    function saveRouteOverlayStyle() {
        try { localStorage.setItem(ROUTE_OVERLAY_STORAGE_KEY, JSON.stringify(routeOverlayStyle)); } catch {}
    }
    let routeOverlayStyle = loadRouteOverlayStyle();
    const chkRouteSeparate = document.getElementById('chk-route-separate');
    const ctlRouteSpacing = document.getElementById('ctl-route-spacing');
    const valRouteSpacing = document.getElementById('val-route-spacing');
    const ctlRouteWidth = document.getElementById('ctl-route-width');
    const valRouteWidth = document.getElementById('val-route-width');
    const ctlRouteOpacity = document.getElementById('ctl-route-opacity');
    const valRouteOpacity = document.getElementById('val-route-opacity');
    const chkRouteSmooth = document.getElementById('chk-route-smooth');
    const ctlRouteRadius = document.getElementById('ctl-route-radius');
    const valRouteRadius = document.getElementById('val-route-radius');
    function syncRouteOverlayControls() {
        if (chkRouteSeparate) chkRouteSeparate.checked = !!routeOverlayStyle.separateOverlaps;
        if (ctlRouteSpacing) ctlRouteSpacing.value = routeOverlayStyle.laneSpacing;
        if (valRouteSpacing) valRouteSpacing.textContent = routeOverlayStyle.laneSpacing;
        if (ctlRouteWidth) ctlRouteWidth.value = routeOverlayStyle.lineWidth;
        if (valRouteWidth) valRouteWidth.textContent = routeOverlayStyle.lineWidth;
        if (ctlRouteOpacity) ctlRouteOpacity.value = routeOverlayStyle.opacity;
        if (valRouteOpacity) valRouteOpacity.textContent = Number(routeOverlayStyle.opacity).toFixed(2);
        if (chkRouteSmooth) chkRouteSmooth.checked = !!routeOverlayStyle.smoothCurves;
        if (ctlRouteRadius) ctlRouteRadius.value = routeOverlayStyle.curveRadius;
        if (valRouteRadius) valRouteRadius.textContent = routeOverlayStyle.curveRadius;
    }
    syncRouteOverlayControls();
    if (chkRouteSeparate) {
        chkRouteSeparate.addEventListener('change', () => {
            routeOverlayStyle.separateOverlaps = chkRouteSeparate.checked;
            saveRouteOverlayStyle();
            network.redraw();
        });
    }
    if (ctlRouteSpacing) {
        ctlRouteSpacing.addEventListener('input', () => {
            routeOverlayStyle.laneSpacing = +ctlRouteSpacing.value;
            valRouteSpacing.textContent = ctlRouteSpacing.value;
            saveRouteOverlayStyle();
            network.redraw();
        });
    }
    if (ctlRouteWidth) {
        ctlRouteWidth.addEventListener('input', () => {
            routeOverlayStyle.lineWidth = +ctlRouteWidth.value;
            valRouteWidth.textContent = ctlRouteWidth.value;
            saveRouteOverlayStyle();
            network.redraw();
        });
    }
    if (ctlRouteOpacity) {
        ctlRouteOpacity.addEventListener('input', () => {
            routeOverlayStyle.opacity = +ctlRouteOpacity.value;
            valRouteOpacity.textContent = Number(routeOverlayStyle.opacity).toFixed(2);
            saveRouteOverlayStyle();
            network.redraw();
        });
    }
    if (chkRouteSmooth) {
        chkRouteSmooth.addEventListener('change', () => {
            routeOverlayStyle.smoothCurves = chkRouteSmooth.checked;
            saveRouteOverlayStyle();
            network.redraw();
        });
    }
    if (ctlRouteRadius) {
        ctlRouteRadius.addEventListener('input', () => {
            routeOverlayStyle.curveRadius = +ctlRouteRadius.value;
            valRouteRadius.textContent = ctlRouteRadius.value;
            saveRouteOverlayStyle();
            network.redraw();
        });
    }

    // filename -> { color, result, segments[] }
    const personaOverlays = new Map();
    const routeControls = new Map();

    async function loadResultsForRoutes() {
        try {
            const res = await fetch('api/results/index.json');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const results = await res.json();
            if (!results.length) {
                routesList.innerHTML = `<div class="sidebar-empty">No simulation results found.</div>`;
                return;
            }
            routesList.innerHTML = '';
            routeControls.clear();
            results.forEach((r, idx) => {
                const row = document.createElement('label');
                row.className = 'route-row';
                const initialColor = ROUTE_PALETTE[idx % ROUTE_PALETTE.length];
                row.innerHTML = `
                    <input type="checkbox" data-file="${r.filename}">
                    <input type="color" value="${initialColor}">
                    <span class="route-label">
                        <span class="title">${escapeHtml(r.persona_id)} / ${escapeHtml(r.provider)}</span>
                        <span class="sub">${escapeHtml(r.outcome || '')} · ${r.total_steps} steps</span>
                    </span>`;
                const chk  = row.querySelector('input[type="checkbox"]');
                const col  = row.querySelector('input[type="color"]');
                chk.addEventListener('change', () => togglePersona(r.filename, chk, col, row));
                col.addEventListener('input', () => recolorPersona(r.filename, col.value));
                routeControls.set(r.filename, { chk, col, row, meta: r });
                routesList.appendChild(row);
            });
        } catch (e) {
            routesList.innerHTML = `<div class="sidebar-empty">Failed to load results: ${escapeHtml(e.message)}</div>`;
        }
    }

    async function togglePersona(filename, chk, col, row) {
        if (chk.checked) {
            row.classList.add('loading');
            let result;
            try {
                const res = await fetch(`api/results/${encodeURIComponent(filename)}`);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                result = await res.json();
            } catch (e) {
                alert(`Failed to load ${filename}: ${e.message}`);
                chk.checked = false;
                row.classList.remove('loading');
                return;
            }
            row.classList.remove('loading');

            const color = col.value || ROUTE_PALETTE[paletteIdx++ % ROUTE_PALETTE.length];
            const segments = collectOverlaySegments(result);
            const subpaths = collectOverlaySubpaths(result);
            personaOverlays.set(filename, { color, segments, subpaths, result });
            network.redraw();
        } else {
            removeOverlay(filename);
        }
    }

    async function showAllPersonaRoutes() {
        if (!routeControls.size) return;
        if (btnRoutesShowAll) {
            btnRoutesShowAll.disabled = true;
            btnRoutesShowAll.textContent = 'Loading...';
        }
        if (btnRoutesClearAll) btnRoutesClearAll.disabled = true;
        try {
            for (const [filename, ctrl] of routeControls) {
                if (ctrl.chk.checked || personaOverlays.has(filename)) continue;
                ctrl.chk.checked = true;
                await togglePersona(filename, ctrl.chk, ctrl.col, ctrl.row);
            }
        } finally {
            if (btnRoutesShowAll) {
                btnRoutesShowAll.disabled = false;
                btnRoutesShowAll.textContent = 'Show all routes';
            }
            if (btnRoutesClearAll) btnRoutesClearAll.disabled = false;
        }
    }

    function clearAllPersonaRoutes() {
        for (const [filename, ctrl] of routeControls) {
            ctrl.chk.checked = false;
            removeOverlay(filename);
        }
        network.redraw();
    }

    if (btnRoutesShowAll) btnRoutesShowAll.addEventListener('click', showAllPersonaRoutes);
    if (btnRoutesClearAll) btnRoutesClearAll.addEventListener('click', clearAllPersonaRoutes);

    function addOverlayForResult(result, color, filename) {
        const path = result.path || [];
        const addedIds = [];
        const seen = new Set();
        for (let i = 0; i < path.length - 1; i++) {
            const id = edgeKeyToId.get(`${path[i]}|${path[i + 1]}`);
            if (!id) continue;
            // De-duplicate overlay ids per persona to avoid collisions when the
            // persona walks the same edge multiple times.
            const overlayId = `persona-${sanitize(filename)}-${id}`;
            if (seen.has(overlayId)) continue;
            seen.add(overlayId);
            try {
                visEdges.add({
                    id: overlayId,
                    from: path[i],
                    to: path[i + 1],
                    color: { color: color, highlight: color, hover: color },
                    width: 5,
                    smooth: false,
                    arrows: { to: false },
                    selectionWidth: 0,
                    hoverWidth: 0,
                    _personaOverlay: filename,
                });
                addedIds.push(overlayId);
            } catch (err) {
                // already exists — fall through
            }
        }
        return addedIds;
    }

    function collectOverlaySegments(result) {
        const path = result.path || [];
        const segments = [];
        const seen = new Set();
        for (let i = 0; i < path.length - 1; i++) {
            const id = edgeKeyToId.get(`${path[i]}|${path[i + 1]}`);
            if (!id || seen.has(id)) continue;
            seen.add(id);
            segments.push({
                route: id.replace(/^route-/, ''),
                from: path[i],
                to: path[i + 1],
            });
        }
        return segments;
    }

    function collectOverlaySubpaths(result) {
        const path = result.path || [];
        const subpaths = [];
        let current = [];

        for (let i = 0; i < path.length - 1; i++) {
            const from = path[i];
            const to = path[i + 1];
            if (!from || !to || from === to) continue;
            const id = edgeKeyToId.get(`${from}|${to}`);
            if (!id) {
                if (current.length > 1) subpaths.push(current);
                current = [];
                continue;
            }
            if (!current.length) current.push(from);
            const last = current[current.length - 1];
            if (last !== from) {
                if (current.length > 1) subpaths.push(current);
                current = [from];
            }
            current.push(to);
        }
        if (current.length > 1) subpaths.push(current);
        return subpaths;
    }

    function removeOverlay(filename) {
        const entry = personaOverlays.get(filename);
        if (!entry) return;
        personaOverlays.delete(filename);
        network.redraw();
    }

    function recolorPersona(filename, color) {
        const entry = personaOverlays.get(filename);
        if (!entry) return;
        entry.color = color;
        network.redraw();
    }

    function sanitize(s) {
        return String(s).replace(/[^a-zA-Z0-9_-]/g, '_');
    }
    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
        }[c]));
    }

    loadResultsForRoutes();

    async function renderRight() {
        if (activeRoute == null) return;
        barsHeader.textContent = `Per-point metrics · Route ${activeRoute}`;
        barsBody.innerHTML =
            `<div class="sidebar-empty">Loading Route_${activeRoute}.xlsx…</div>`;
        let payload;
        try {
            const res = await fetch(`api/route_points/${activeRoute}.json`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            payload = await res.json();
        } catch (e) {
            barsBody.innerHTML =
                `<div class="sidebar-empty">Failed to load: ${e.message}</div>`;
            return;
        }

        const pair = edgeByRoute.get(activeRoute) || {};
        const anyEdge = pair[1] || pair[2] || {};

        const summary = `
            <div class="bars-route-summary">
                <div><strong>Route ${activeRoute}</strong> · ${payload.n_points} points</div>
                <div>length ${(anyEdge.length ?? 0).toFixed(1)} m · POI ${anyEdge.poi_count ?? 0}</div>
            </div>`;

        const selected = SIM_METRICS.filter(m => metricSelection[m] !== false);
        const rowsHtml = selected.length
            ? selected.map(m => renderBarChart(m, payload.metrics[m] || [])).join('')
            : `<div class="sidebar-empty">No metrics selected. Tick one above.</div>`;
        barsBody.innerHTML = summary + rowsHtml;
    }

    // ==========================================================
    //   Map layers: edge-frequency / rest heatmap / per-point metric
    // ==========================================================
    const LAYERS_STORAGE_KEY = 'realmap.layers.v4';
    const DEFAULT_LAYER_ORDER = ['personaRoutes', 'metricOverlay', 'restHeatmap', 'roadGraph'];
    const defaultLayers = {
        edgeFreqEnabled: false,
        edgeFreqWidth: 12,
        restEnabled: false,
        restOpacity: 0.85,
        restBandwidth: 55,
        metricEnabled: false,
        metric: 'UTCI',
        metricOpacity: 0.85,
        metricDotSize: 6,
        layerOrder: DEFAULT_LAYER_ORDER.slice(),
    };
    function loadLayersState() {
        try {
            const raw = localStorage.getItem(LAYERS_STORAGE_KEY);
            if (raw) return { ...defaultLayers, ...JSON.parse(raw) };
        } catch { /* ignore */ }
        try {
            const rawV2 = localStorage.getItem('realmap.layers.v2');
            if (rawV2) {
                const prev = JSON.parse(rawV2);
                return { ...defaultLayers, ...prev, restBandwidth: defaultLayers.restBandwidth, layerOrder: DEFAULT_LAYER_ORDER.slice() };
            }
        } catch { /* ignore */ }
        try {
            const rawV3 = localStorage.getItem('realmap.layers.v3');
            if (rawV3) {
                const prev = JSON.parse(rawV3);
                return { ...defaultLayers, ...prev, layerOrder: DEFAULT_LAYER_ORDER.slice() };
            }
        } catch { /* ignore */ }
        return { ...defaultLayers };
    }
    function saveLayersState() {
        try { localStorage.setItem(LAYERS_STORAGE_KEY, JSON.stringify(layersState)); } catch {}
    }
    let layersState = loadLayersState();
    layersState.layerOrder = normalizeLayerOrder(layersState.layerOrder);

    // ---- Layers DOM ----
    const btnLayersRefresh = document.getElementById('btn-layers-refresh');
    const btnLayersClear = document.getElementById('btn-layers-clear');
    const chkLayerEdgeFreq = document.getElementById('chk-layer-edgefreq');
    const ctlEdgeFreqWidth = document.getElementById('ctl-edgefreq-width');
    const chkLayerRest = document.getElementById('chk-layer-rest');
    const chkLayerMetric = document.getElementById('chk-layer-metric');
    const ctlLayerMetric = document.getElementById('ctl-layer-metric');
    const ctlRestOp = document.getElementById('ctl-rest-op');
    const ctlRestSize = document.getElementById('ctl-rest-size');
    const ctlMetricOp = document.getElementById('ctl-metric-op');
    const ctlMetricSize = document.getElementById('ctl-metric-size');
    const metricSizeLabel = document.getElementById('metric-size-label');
    const valRestOp = document.getElementById('val-rest-op');
    const valEdgeFreqWidth = document.getElementById('val-edgefreq-width');
    const valRestSize = document.getElementById('val-rest-size');
    const valMetricOp = document.getElementById('val-metric-op');
    const valMetricSize = document.getElementById('val-metric-size');
    const edgeFreqLegendEl = document.getElementById('legend-edgefreq');
    const restLegendEl = document.getElementById('legend-rest');
    const metricLegendEl = document.getElementById('legend-metric');
    const layerOrderList = document.getElementById('layer-order-list');

    const LAYER_LABELS = {
        roadGraph: 'Road Graph',
        restHeatmap: 'Rest Heatmap',
        metricOverlay: 'Per-point Metric',
        personaRoutes: 'Persona Routes',
    };

    function normalizeLayerOrder(order) {
        const input = Array.isArray(order) ? order : [];
        const out = input.filter(id => DEFAULT_LAYER_ORDER.includes(id));
        for (const id of DEFAULT_LAYER_ORDER) {
            if (!out.includes(id)) out.push(id);
        }
        return out;
    }

    // Node lookup (x/y in graph coordinates; vis draws at -y)
    const nodeById = new Map(data.nodes.map(n => [n.id, n]));

    // Caches - populated lazily on activation
    let allResultsCache = null;
    const routePointsCache = new Map();

    // Aggregated overlays
    let edgeFreqByRoute = new Map();
    let edgeFreqMax = 0;
    let restCountByNode = new Map();
    let restCountMax = 0;

    function syncMetricSizeControl() {
        const isPoiLine = layersState.metric === 'POI_count';
        if (metricSizeLabel) metricSizeLabel.textContent = isPoiLine ? 'Line width' : 'Dot size';
        if (ctlMetricSize) {
            ctlMetricSize.min = isPoiLine ? '1' : '1';
            ctlMetricSize.max = isPoiLine ? '24' : '24';
            ctlMetricSize.step = isPoiLine ? '0.5' : '0.5';
        }
        if (valMetricSize) valMetricSize.textContent = Number(layersState.metricDotSize).toFixed(1);
    }

    function syncLayerControls() {
        chkLayerEdgeFreq.checked = !!layersState.edgeFreqEnabled;
        if (ctlEdgeFreqWidth) ctlEdgeFreqWidth.value = layersState.edgeFreqWidth;
        chkLayerRest.checked = !!layersState.restEnabled;
        chkLayerMetric.checked = !!layersState.metricEnabled;
        ctlLayerMetric.value = layersState.metric;
        ctlRestOp.value = layersState.restOpacity;
        ctlRestSize.value = layersState.restBandwidth;
        ctlMetricOp.value = layersState.metricOpacity;
        ctlMetricSize.value = layersState.metricDotSize;
        valRestOp.textContent = Number(layersState.restOpacity).toFixed(2);
        if (valEdgeFreqWidth) valEdgeFreqWidth.textContent = Number(layersState.edgeFreqWidth).toFixed(0);
        valRestSize.textContent = layersState.restBandwidth;
        valMetricOp.textContent = Number(layersState.metricOpacity).toFixed(2);
        syncMetricSizeControl();
    }
    syncLayerControls();

    function renderLayerOrderControls() {
        if (!layerOrderList) return;
        layersState.layerOrder = normalizeLayerOrder(layersState.layerOrder);
        layerOrderList.innerHTML = '';
        layersState.layerOrder.forEach((id, idx) => {
            const row = document.createElement('div');
            row.className = 'layer-order-row';
            row.innerHTML = `
                <span class="layer-order-name">${escapeHtml(LAYER_LABELS[id] || id)}</span>
                <button type="button" data-dir="up" title="Move layer up" ${idx === 0 ? 'disabled' : ''}>^</button>
                <button type="button" data-dir="down" title="Move layer down" ${idx === layersState.layerOrder.length - 1 ? 'disabled' : ''}>v</button>
            `;
            row.querySelectorAll('button').forEach(btn => {
                btn.addEventListener('click', () => {
                    const dir = btn.dataset.dir;
                    const j = dir === 'up' ? idx - 1 : idx + 1;
                    if (j < 0 || j >= layersState.layerOrder.length) return;
                    const next = layersState.layerOrder.slice();
                    [next[idx], next[j]] = [next[j], next[idx]];
                    layersState.layerOrder = next;
                    saveLayersState();
                    renderLayerOrderControls();
                    network.redraw();
                });
            });
            layerOrderList.appendChild(row);
        });
    }
    renderLayerOrderControls();

    function setLegendMessage(target, message, isError = false) {
        target.innerHTML = '<span class="lg-label"' + (isError ? ' style="color:var(--danger);"' : '') + '>' + escapeHtml(message) + '</span>';
    }

    async function ensureAllResults(statusTarget = null) {
        if (allResultsCache) return allResultsCache;
        if (statusTarget) setLegendMessage(statusTarget, 'Loading results...');
        const listRes = await fetch('api/results/index.json');
        if (!listRes.ok) throw new Error('HTTP ' + listRes.status);
        const list = await listRes.json();
        const out = [];
        const BATCH = 4;
        for (let i = 0; i < list.length; i += BATCH) {
            const slice = list.slice(i, i + BATCH);
            const payloads = await Promise.all(slice.map(r =>
                fetch('api/results/' + encodeURIComponent(r.filename))
                    .then(res => res.ok ? res.json() : null)
                    .catch(() => null)
            ));
            for (const p of payloads) if (p) out.push(p);
        }
        allResultsCache = out;
        return out;
    }

    async function ensureAllRoutePoints(statusTarget = null) {
        const missing = [];
        for (const [route] of edgeByRoute) {
            if (!routePointsCache.has(route)) missing.push(route);
        }
        if (missing.length === 0) return;
        if (statusTarget) setLegendMessage(statusTarget, 'Fetching route points (' + missing.length + ')...');
        const BATCH = 6;
        for (let i = 0; i < missing.length; i += BATCH) {
            const slice = missing.slice(i, i + BATCH);
            const payloads = await Promise.all(slice.map(r =>
                fetch('api/route_points/' + r + '.json')
                    .then(res => res.ok ? res.json() : null)
                    .catch(() => null)
            ));
            slice.forEach((r, idx) => {
                if (payloads[idx]) routePointsCache.set(r, payloads[idx]);
            });
        }
    }

    function computeEdgeFrequency(results) {
        edgeFreqByRoute = new Map();
        for (const res of results) {
            const path = res.path || [];
            const seen = new Set();
            for (let i = 0; i < path.length - 1; i++) {
                const id = edgeKeyToId.get(path[i] + '|' + path[i + 1]);
                if (!id) continue;
                const route = id.replace(/^route-/, '');
                const key = (res.filename || '') + '|' + route;
                if (seen.has(key)) continue;
                seen.add(key);
                edgeFreqByRoute.set(route, (edgeFreqByRoute.get(route) || 0) + 1);
            }
        }
        edgeFreqMax = 0;
        for (const v of edgeFreqByRoute.values()) if (v > edgeFreqMax) edgeFreqMax = v;
    }

    function computeRestCounts(results) {
        restCountByNode = new Map();
        for (const res of results) {
            const steps = res.per_step || [];
            for (const s of steps) {
                if (s && s.action === 'rest' && s.node_before) {
                    restCountByNode.set(s.node_before, (restCountByNode.get(s.node_before) || 0) + 1);
                }
            }
        }
        restCountMax = 0;
        for (const v of restCountByNode.values()) if (v > restCountMax) restCountMax = v;
    }

    function applyEdgeFrequencyStyles() {
        const updates = [];
        visEdges.forEach(e => {
            if (e._personaOverlay) return;
            updates.push({
                id: e.id,
                width: Math.max(8, graphStyle.edgeWidth),
                color: { color: HIT_COLOR, hover: HIT_COLOR, highlight: HIT_COLOR },
            });
        });
        try { visEdges.update(updates); } catch {}
        network.redraw();
    }

    function restoreBaseEdgeStyles() {
        const updates = [];
        visEdges.forEach(e => {
            if (e._personaOverlay) return;
            updates.push({
                id: e.id,
                width: Math.max(8, graphStyle.edgeWidth),
                color: { color: HIT_COLOR, hover: HIT_COLOR, highlight: HIT_COLOR },
            });
        });
        try { visEdges.update(updates); } catch {}
        network.redraw();
    }

    function renderEdgeFreqLegend(target) {
        target.innerHTML = `
            <span class="lg-label">0</span>
            <span class="lg-gradient" style="background:linear-gradient(to right,#7fcfe0,#ffe97a,#ffb45a,#d63031);"></span>
            <span class="lg-label">${edgeFreqMax} walks · +${Number(layersState.edgeFreqWidth || 0).toFixed(0)} width</span>
        `;
    }
    function renderRestLegend(target) {
        const totalRest = Array.from(restCountByNode.values()).reduce((a, b) => a + b, 0);
        target.innerHTML = `
            <span class="lg-label">KDE rest events: ${totalRest}</span>
            <span class="lg-gradient" style="background:linear-gradient(to right,rgba(127,207,224,0.15),#ffe97a,#ffb45a,#d63031);"></span>
            <span class="lg-label">bandwidth ${layersState.restBandwidth}</span>
        `;
    }
    function renderMetricLegend(target, metric, lo, hi) {
        const unit = (SIM_UNITS[metric] || '');
        const gradCss = (metric === 'PET')
            ? 'linear-gradient(to right,#2e9fbf,#7fcfe0,#ffe97a,#ffb45a,#e8603a,#b53423)'
            : 'linear-gradient(to right,#7fcfe0,#ffe97a,#ffb45a,#d63031)';
        target.innerHTML = `
            <span class="lg-label">${metric}</span>
            <span class="lg-gradient" style="background:${gradCss};"></span>
            <span class="lg-label">${Number(lo).toFixed(2)}-${Number(hi).toFixed(2)}${unit ? ' ' + unit : ''}</span>
        `;
    }

    function getMetricOverlayExtents(metric) {
        if (metric === 'POI_count') {
            let lo = Infinity, hi = -Infinity;
            for (const e of data.edges) {
                const v = e.poi_count;
                if (v == null) continue;
                if (v < lo) lo = v;
                if (v > hi) hi = v;
            }
            if (!Number.isFinite(lo)) return [0, 1];
            if (lo === hi) hi = lo + 1;
            return [lo, hi];
        }

        let lo = Infinity, hi = -Infinity;
        for (const payload of routePointsCache.values()) {
            const arr = (payload.metrics || {})[metric] || [];
            for (const v of arr) {
                if (v == null || Number.isNaN(v)) continue;
                if (v < lo) lo = v;
                if (v > hi) hi = v;
            }
        }
        if (!Number.isFinite(lo)) return [0, 1];
        if (lo === hi) hi = lo + 1;
        return [lo, hi];
    }

    async function applyLayerState() {
        try {
            let sharedResults = null;

            if (layersState.edgeFreqEnabled || layersState.restEnabled) {
                sharedResults = await ensureAllResults(layersState.edgeFreqEnabled ? edgeFreqLegendEl : restLegendEl);
            }

            if (layersState.edgeFreqEnabled) {
                computeEdgeFrequency(sharedResults || []);
                applyEdgeFrequencyStyles();
                renderEdgeFreqLegend(edgeFreqLegendEl);
            } else {
                restoreBaseEdgeStyles();
                edgeFreqLegendEl.innerHTML = '';
            }

            if (layersState.restEnabled) {
                computeRestCounts(sharedResults || []);
                renderRestLegend(restLegendEl);
            } else {
                restLegendEl.innerHTML = '';
            }

            if (layersState.metricEnabled) {
                if (layersState.metric !== 'POI_count') {
                    await ensureAllRoutePoints(metricLegendEl);
                }
                const [lo, hi] = getMetricOverlayExtents(layersState.metric);
                renderMetricLegend(metricLegendEl, layersState.metric, lo, hi);
            } else {
                metricLegendEl.innerHTML = '';
            }

            network.redraw();
        } catch (e) {
            const message = 'Failed: ' + e.message;
            if (layersState.edgeFreqEnabled) setLegendMessage(edgeFreqLegendEl, message, true);
            if (layersState.restEnabled) setLegendMessage(restLegendEl, message, true);
            if (layersState.metricEnabled) setLegendMessage(metricLegendEl, message, true);
        }
    }

    // Clicks on the enable-toggle label in each subcard summary must not
    // bubble up — otherwise they would also flip the <details> open state.
    document.querySelectorAll('.layer-subcard > summary .subcard-toggle').forEach(lbl => {
        lbl.addEventListener('click', e => e.stopPropagation());
    });

    chkLayerEdgeFreq.addEventListener('change', async () => {
        layersState.edgeFreqEnabled = chkLayerEdgeFreq.checked;
        saveLayersState();
        await applyLayerState();
    });
    if (ctlEdgeFreqWidth) {
        ctlEdgeFreqWidth.addEventListener('input', () => {
            layersState.edgeFreqWidth = +ctlEdgeFreqWidth.value;
            if (valEdgeFreqWidth) valEdgeFreqWidth.textContent = ctlEdgeFreqWidth.value;
            saveLayersState();
            if (layersState.edgeFreqEnabled) {
                renderEdgeFreqLegend(edgeFreqLegendEl);
                network.redraw();
            }
        });
    }
    chkLayerRest.addEventListener('change', async () => {
        layersState.restEnabled = chkLayerRest.checked;
        saveLayersState();
        await applyLayerState();
    });
    chkLayerMetric.addEventListener('change', async () => {
        layersState.metricEnabled = chkLayerMetric.checked;
        saveLayersState();
        await applyLayerState();
    });
    ctlLayerMetric.addEventListener('change', async () => {
        layersState.metric = ctlLayerMetric.value;
        syncMetricSizeControl();
        saveLayersState();
        if (layersState.metricEnabled) await applyLayerState();
    });
    ctlRestOp.addEventListener('input', () => {
        layersState.restOpacity = +ctlRestOp.value;
        valRestOp.textContent = Number(ctlRestOp.value).toFixed(2);
        saveLayersState();
        if (layersState.restEnabled) network.redraw();
    });
    ctlRestSize.addEventListener('input', () => {
        layersState.restBandwidth = +ctlRestSize.value;
        valRestSize.textContent = ctlRestSize.value;
        saveLayersState();
        if (layersState.restEnabled) network.redraw();
    });
    ctlMetricOp.addEventListener('input', () => {
        layersState.metricOpacity = +ctlMetricOp.value;
        valMetricOp.textContent = Number(ctlMetricOp.value).toFixed(2);
        saveLayersState();
        if (layersState.metricEnabled) network.redraw();
    });
    ctlMetricSize.addEventListener('input', () => {
        layersState.metricDotSize = +ctlMetricSize.value;
        syncMetricSizeControl();
        saveLayersState();
        if (layersState.metricEnabled) network.redraw();
    });
    btnLayersRefresh.addEventListener('click', async () => {
        allResultsCache = null;
        routePointsCache.clear();
        await applyLayerState();
    });
    btnLayersClear.addEventListener('click', async () => {
        layersState.edgeFreqEnabled = false;
        layersState.restEnabled = false;
        layersState.metricEnabled = false;
        syncLayerControls();
        saveLayersState();
        await applyLayerState();
    });

    function graphPointForNode(nodeId) {
        const n = nodeById.get(nodeId);
        return n ? { x: n.x, y: -n.y } : null;
    }

    const mapBounds = (() => {
        const pts = data.nodes.map(n => ({ x: n.x, y: -n.y }));
        return pts.reduce((acc, p) => ({
            minX: Math.min(acc.minX, p.x),
            maxX: Math.max(acc.maxX, p.x),
            minY: Math.min(acc.minY, p.y),
            maxY: Math.max(acc.maxY, p.y),
        }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
    })();

    function drawRestKde(ctx) {
        if (!restCountByNode.size) return;
        const bandwidth = Math.max(8, Number(layersState.restBandwidth) || 55);
        const points = [];
        for (const [nodeId, count] of restCountByNode) {
            const p = graphPointForNode(nodeId);
            if (p) points.push({ ...p, weight: count });
        }
        if (!points.length) return;

        const canvas = ctx.canvas;
        const transform = ctx.getTransform();
        const pxPerGraphUnit = Math.max(0.1, Math.hypot(transform.a, transform.b));
        const renderScale = 0.62;
        const W = Math.max(1, Math.round(canvas.width * renderScale));
        const H = Math.max(1, Math.round(canvas.height * renderScale));
        const densityCanvas = document.createElement('canvas');
        densityCanvas.width = W;
        densityCanvas.height = H;
        const dctx = densityCanvas.getContext('2d', { willReadFrequently: true });
        dctx.clearRect(0, 0, W, H);
        dctx.globalCompositeOperation = 'lighter';

        const maxWeight = Math.max(1, ...points.map(p => Number(p.weight) || 0));
        const radiusPx = Math.max(24, bandwidth * pxPerGraphUnit * 2.45 * renderScale);
        for (const p of points) {
            const sx = (transform.a * p.x + transform.c * p.y + transform.e) * renderScale;
            const sy = (transform.b * p.x + transform.d * p.y + transform.f) * renderScale;
            const weight = Math.max(0, Number(p.weight) || 0);
            const strength = 0.26 + 0.42 * Math.sqrt(weight / maxWeight);
            const grad = dctx.createRadialGradient(sx, sy, 0, sx, sy, radiusPx);
            grad.addColorStop(0, `rgba(0,0,0,${strength})`);
            grad.addColorStop(0.42, `rgba(0,0,0,${strength * 0.55})`);
            grad.addColorStop(0.72, `rgba(0,0,0,${strength * 0.18})`);
            grad.addColorStop(1, 'rgba(0,0,0,0)');
            dctx.fillStyle = grad;
            dctx.beginPath();
            dctx.arc(sx, sy, radiusPx, 0, Math.PI * 2);
            dctx.fill();
        }

        const img = dctx.getImageData(0, 0, W, H);
        const dataPx = img.data;
        let maxA = 0;
        for (let i = 3; i < dataPx.length; i += 4) {
            if (dataPx[i] > maxA) maxA = dataPx[i];
        }
        if (maxA <= 0) return;

        const bands = 8;
        for (let i = 0; i < dataPx.length; i += 4) {
            const tRaw = dataPx[i + 3] / maxA;
            if (tRaw < 0.045) {
                dataPx[i + 3] = 0;
                continue;
            }
            const band = Math.ceil(Math.pow(tRaw, 0.86) * bands) / bands;
            const [r, g, b, a] = redContourRgba(band, layersState.restOpacity);
            dataPx[i] = r;
            dataPx[i + 1] = g;
            dataPx[i + 2] = b;
            dataPx[i + 3] = a;
        }
        dctx.globalCompositeOperation = 'source-over';
        dctx.putImageData(img, 0, 0);

        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(densityCanvas, 0, 0, canvas.width, canvas.height);
        ctx.restore();
    }

    function drawPoiEdgeMetricOverlay(ctx, lo, hi) {
        const scale = Math.max(0.1, network.getScale ? network.getScale() : 1);
        const seen = new Set();
        ctx.save();
        ctx.globalAlpha = layersState.metricOpacity;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = Math.max(1, Number(layersState.metricDotSize) || 6) / scale;
        for (const e of data.edges) {
            if (seen.has(e.route)) continue;
            seen.add(e.route);
            const a = graphPointForNode(e.source);
            const b = graphPointForNode(e.target);
            if (!a || !b || e.poi_count == null) continue;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.strokeStyle = colorForMetric('POI_count', e.poi_count, lo, hi);
            ctx.stroke();
        }
        ctx.restore();
    }

    function drawRoadGraphLayer(ctx) {
        const scale = Math.max(0.1, network.getScale ? network.getScale() : 1);
        const seen = new Set();
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        if (graphStyle.showEdges !== false) {
            for (const e of data.edges) {
                if (seen.has(e.route)) continue;
                seen.add(e.route);
                const a = graphPointForNode(e.source);
                const b = graphPointForNode(e.target);
                if (!a || !b) continue;
                const count = layersState.edgeFreqEnabled ? (edgeFreqByRoute.get(String(e.route)) || 0) : 0;
                const t = edgeFreqMax > 0 ? count / edgeFreqMax : 0;
                const widthBoost = Math.max(0, Number(layersState.edgeFreqWidth) || 0);
                const freqWidth = count > 0 ? Math.pow(t, 0.72) * widthBoost : 0;
                ctx.beginPath();
                ctx.moveTo(a.x, a.y);
                ctx.lineTo(b.x, b.y);
                ctx.lineWidth = (graphStyle.edgeWidth + freqWidth) / scale;
                ctx.strokeStyle = count > 0 ? gradientColor(t) : graphStyle.edgeColor;
                ctx.stroke();
            }
        }

        if (graphStyle.showNodes !== false) {
            ctx.lineWidth = 1.5 / scale;
            for (const n of data.nodes) {
                ctx.beginPath();
                ctx.arc(n.x, -n.y, graphStyle.nodeSize / scale, 0, Math.PI * 2);
                ctx.fillStyle = graphStyle.nodeFill;
                ctx.fill();
                ctx.strokeStyle = graphStyle.nodeBorder;
                ctx.stroke();
            }
        }
        ctx.restore();
    }

    function buildPersonaLaneMap() {
        const grouped = new Map();
        for (const [filename, entry] of personaOverlays) {
            for (const seg of entry.segments || []) {
                if (!grouped.has(seg.route)) grouped.set(seg.route, []);
                grouped.get(seg.route).push({ filename, entry, seg });
            }
        }
        const lanes = new Map();
        for (const [route, list] of grouped) {
            const names = Array.from(new Set(list.map(item => item.filename))).sort();
            const count = names.length;
            names.forEach((filename, idx) => {
                const lane = routeOverlayStyle.separateOverlaps ? idx - (count - 1) / 2 : 0;
                lanes.set(`${filename}|${route}`, lane);
            });
        }
        return lanes;
    }

    function dist(a, b) {
        return Math.hypot(a.x - b.x, a.y - b.y);
    }

    function pointToward(a, b, d) {
        const len = dist(a, b) || 1;
        const t = Math.min(1, Math.max(0, d / len));
        return {
            x: a.x + (b.x - a.x) * t,
            y: a.y + (b.y - a.y) * t,
        };
    }

    function makeRouteDrawSegments(filename, nodeIds, laneMap, spacing) {
        const out = [];
        for (let i = 0; i < nodeIds.length - 1; i++) {
            const from = nodeIds[i];
            const to = nodeIds[i + 1];
            const edgeId = edgeKeyToId.get(`${from}|${to}`);
            if (!edgeId) continue;
            const route = edgeId.replace(/^route-/, '');
            const a0 = graphPointForNode(from);
            const b0 = graphPointForNode(to);
            if (!a0 || !b0) continue;
            const dx = b0.x - a0.x;
            const dy = b0.y - a0.y;
            const len = Math.hypot(dx, dy) || 1;
            const lane = laneMap.get(`${filename}|${route}`) || 0;
            const ox = (-dy / len) * lane * spacing;
            const oy = ( dx / len) * lane * spacing;
            out.push({
                a: { x: a0.x + ox, y: a0.y + oy },
                b: { x: b0.x + ox, y: b0.y + oy },
                joint: b0,
            });
        }
        return out;
    }

    function strokeRouteSubpath(ctx, filename, nodeIds, laneMap, spacing, radius, smooth) {
        const segs = makeRouteDrawSegments(filename, nodeIds, laneMap, spacing);
        if (!segs.length) return;

        ctx.beginPath();
        ctx.moveTo(segs[0].a.x, segs[0].a.y);
        for (let i = 1; i < segs.length; i++) {
            const prev = segs[i - 1];
            const curr = segs[i];
            if (!smooth || radius <= 0) {
                ctx.lineTo(prev.b.x, prev.b.y);
                ctx.lineTo(curr.a.x, curr.a.y);
                continue;
            }

            const r = Math.min(radius, dist(prev.a, prev.b) * 0.42, dist(curr.a, curr.b) * 0.42);
            if (r < 1) {
                ctx.lineTo(prev.b.x, prev.b.y);
                ctx.lineTo(curr.a.x, curr.a.y);
                continue;
            }
            const p1 = pointToward(prev.b, prev.a, r);
            const p2 = pointToward(curr.a, curr.b, r);
            ctx.lineTo(p1.x, p1.y);
            ctx.quadraticCurveTo(prev.joint.x, prev.joint.y, p2.x, p2.y);
        }
        const last = segs[segs.length - 1];
        ctx.lineTo(last.b.x, last.b.y);
        ctx.stroke();
    }

    function drawPersonaRouteOverlays(ctx) {
        if (!personaOverlays.size) return;

        const scale = Math.max(0.1, network.getScale ? network.getScale() : 1);
        const spacing = (routeOverlayStyle.separateOverlaps ? routeOverlayStyle.laneSpacing : 0) / scale;
        const lineWidth = routeOverlayStyle.lineWidth / scale;
        const radius = (routeOverlayStyle.smoothCurves ? routeOverlayStyle.curveRadius : 0) / scale;
        const laneMap = buildPersonaLaneMap();
        const entries = Array.from(personaOverlays.entries()).sort((a, b) => a[0].localeCompare(b[0]));

        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.globalAlpha = Math.min(1, routeOverlayStyle.opacity + 0.08);
        ctx.lineWidth = lineWidth + (2.5 / scale);
        ctx.strokeStyle = 'rgba(255,255,255,0.42)';
        for (const [filename, entry] of entries) {
            for (const subpath of entry.subpaths || []) {
                strokeRouteSubpath(ctx, filename, subpath, laneMap, spacing, radius, routeOverlayStyle.smoothCurves);
            }
        }

        ctx.globalAlpha = routeOverlayStyle.opacity;
        ctx.lineWidth = lineWidth;
        for (const [filename, entry] of entries) {
            ctx.strokeStyle = entry.color;
            for (const subpath of entry.subpaths || []) {
                strokeRouteSubpath(ctx, filename, subpath, laneMap, spacing, radius, routeOverlayStyle.smoothCurves);
            }
        }
        ctx.restore();
    }

    function drawMetricOverlay(ctx) {
        if (!layersState.metricEnabled) return;
        const metric = layersState.metric;
        const [lo, hi] = getMetricOverlayExtents(metric);
        if (metric === 'POI_count') {
            drawPoiEdgeMetricOverlay(ctx, lo, hi);
            return;
        }

        ctx.save();
        ctx.globalAlpha = layersState.metricOpacity;
        const r = layersState.metricDotSize;
        for (const payload of routePointsCache.values()) {
            const arr = (payload.metrics || {})[metric] || [];
            const pos = payload.positions || [];
            const n = Math.min(arr.length, pos.length);
            for (let i = 0; i < n; i++) {
                const v = arr[i];
                if (v == null || Number.isNaN(v)) continue;
                const p = pos[i];
                if (!p) continue;
                ctx.beginPath();
                ctx.arc(p[0], -p[1], r, 0, Math.PI * 2);
                ctx.fillStyle = colorForMetric(metric, v, lo, hi);
                ctx.fill();
            }
        }
        ctx.restore();
    }

    function drawOrderedLayer(ctx, id) {
        if (id === 'roadGraph') drawRoadGraphLayer(ctx);
        else if (id === 'restHeatmap' && layersState.restEnabled) drawRestKde(ctx);
        else if (id === 'metricOverlay') drawMetricOverlay(ctx);
        else if (id === 'personaRoutes') drawPersonaRouteOverlays(ctx);
    }

    // Draw map layers in user-controlled order. Basemap is drawn earlier in
    // beforeDrawing, so it remains the fixed bottom layer.
    network.on('afterDrawing', (ctx) => {
        const orderedTopToBottom = normalizeLayerOrder(layersState.layerOrder);
        for (const id of orderedTopToBottom.slice().reverse()) {
            drawOrderedLayer(ctx, id);
        }
    });

    if (layersState.edgeFreqEnabled || layersState.restEnabled || layersState.metricEnabled) {
        applyLayerState();
    }
    // ==========================================================
    //   Draggable / resizable rendered-view panel
    // ==========================================================
    (function wireViewPanelDrag() {
        let drag = null;
        // Drag anywhere on the panel except the direction buttons.
        viewPanel.addEventListener('mousedown', (ev) => {
            if (ev.target.closest('.view-dir-switch')) return;
            if (ev.target.closest('button')) return;
            const rect = viewPanel.getBoundingClientRect();
            const parent = mapSquareEl.getBoundingClientRect();
            drag = {
                dx: ev.clientX - rect.left,
                dy: ev.clientY - rect.top,
                parent,
            };
            ev.preventDefault();
        });
        window.addEventListener('mousemove', (ev) => {
            if (!drag) return;
            const parent = mapSquareEl.getBoundingClientRect();
            let left = ev.clientX - drag.dx - parent.left;
            let top  = ev.clientY - drag.dy - parent.top;
            const maxLeft = parent.width  - viewPanel.offsetWidth;
            const maxTop  = parent.height - viewPanel.offsetHeight;
            left = Math.max(0, Math.min(left, Math.max(0, maxLeft)));
            top  = Math.max(0, Math.min(top,  Math.max(0, maxTop)));
            viewPanel.style.left = left + 'px';
            viewPanel.style.top  = top  + 'px';
            viewPanel.style.right = 'auto';
            viewPanel.style.bottom = 'auto';
        });
        window.addEventListener('mouseup', () => { drag = null; });
    })();
})();
