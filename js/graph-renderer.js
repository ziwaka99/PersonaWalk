/**
 * graph-renderer.js — 用 vis-network 绘制 graph 拓扑。
 * 被 map-view.js 和 playback-view.js 共用。
 *
 * 节点固定位置，physics 关闭，支持拖拽、缩放、hover tooltip。
 * 保持与旧版相同的公开 API，两个页面 JS 无需改动。
 */

const GraphRenderer = (() => {

    // node function → 颜色
    const FUNC_COLORS = {
        park_entrance: { bg: '#00b894', border: '#00a381' },
        park_path:     { bg: '#00cec9', border: '#00b3ad' },
        commercial:    { bg: '#e17055', border: '#c0392b' },
        residential:   { bg: '#636e72', border: '#4a5459' },
        plaza:         { bg: '#fdcb6e', border: '#e0b34e' },
        heritage:      { bg: '#6c5ce7', border: '#5a4bd1' },
        transit:       { bg: '#0984e3', border: '#076fc0' },
        destination:   { bg: '#d63031', border: '#b71c1c' },
        open_field:    { bg: '#ffeaa7', border: '#e0cc85' },
    };
    const DEFAULT_NODE_COLOR = { bg: '#94a3b8', border: '#64748b' };

    // 路径颜色调色板（多 persona 叠加）
    const PATH_PALETTE = [
        '#0984e3', '#d63031', '#00b894', '#6c5ce7',
        '#e17055', '#00cec9', '#fdcb6e', '#e84393',
    ];
    // 路径线型（区分 provider）：false = 实线, [dash, gap]
    const DASH_PATTERNS = [
        false,
        [10, 6],
        [4, 4],
        [14, 6, 4, 6],
    ];

    // ---------- 手动布局坐标 ----------
    // 根据拓扑关系设计，后续替换真实 Rhino 坐标时改这里即可
    const NODE_POSITIONS = {
        NodeA: { x: -200, y: -220 },
        NodeB: { x:   50, y: -230 },
        NodeC: { x:  260, y: -150 },
        NodeD: { x:  220, y:   -5 },
        NodeE: { x: -220, y:  -20 },
        NodeF: { x:  350, y:  120 },
        NodeG: { x:  -60, y:  100 },
        NodeH: { x:  280, y:  230 },
        NodeI: { x:  -80, y:  260 },
        NodeJ: { x: -230, y:  200 },
        NodeK: { x:  160, y:  350 },
        NodeL: { x:  400, y:   -5 },
    };

    let network = null;
    let visNodes = null;
    let visEdges = null;
    let graphDataCache = null;  // 原始 graphData
    let overlayCounter = 0;
    let overlayEdges = {};      // overlayId → [edgeId, ...]
    let agentNodeId = null;
    const AGENT_NODE_ID = '__agent__';

    /**
     * 初始化 graph 渲染。
     * @param {string} containerId - 容器 DOM ID
     * @param {object} graphData   - graph.json 的内容
     */
    function init(containerId, graphData) {
        const container = document.getElementById(containerId);
        container.innerHTML = '';
        graphDataCache = graphData;

        // Detect the new route-graph schema (nodes carry x/y directly, no `function`).
        // In that case we use the embedded coordinates and default styling.
        const isNewSchema = graphData.nodes.length > 0
            && graphData.nodes[0].x !== undefined
            && graphData.nodes[0].function === undefined;

        // --- 构建 vis-network nodes ---
        const nodes = graphData.nodes.map(n => {
            const colors = FUNC_COLORS[n.function] || DEFAULT_NODE_COLOR;
            let pos;
            if (isNewSchema) {
                // route_graph.json coordinates: flip y for screen space (like realmap-view)
                pos = { x: n.x, y: -n.y };
            } else {
                pos = NODE_POSITIONS[n.id] || { x: 0, y: 0 };
            }
            const isGoal = n.function === 'destination';
            // New-schema ids are long coord strings; keep them off the node by default.
            const labelText = isNewSchema
                ? ''
                : n.id.replace('Node', '') + '\n' + (n.name || '');

            return {
                id: n.id,
                label: labelText,
                x: pos.x,
                y: pos.y,
                fixed: true,
                shape: 'dot',
                size: isGoal ? 18 : (isNewSchema ? 7 : 12),
                color: {
                    background: colors.bg,
                    border: colors.border,
                    highlight: { background: colors.bg, border: '#fff' },
                    hover: { background: colors.bg, border: '#fff' },
                },
                font: {
                    color: '#2d3436',
                    size: 11,
                    face: 'system-ui, sans-serif',
                    multi: true,
                },
                borderWidth: isNewSchema ? 1.5 : 2,
                // 把原始数据存进来给 tooltip 用
                _raw: n,
            };
        });
        visNodes = new vis.DataSet(nodes);

        // --- 构建 vis-network edges（合并双向为一条显示） ---
        const edgeSet = new Set();
        const edges = [];
        graphData.edges.forEach(e => {
            const key = [e.source, e.target].sort().join('--');
            if (edgeSet.has(key)) return;
            edgeSet.add(key);

            edges.push({
                id: key,
                from: e.source,
                to: e.target,
                color: { color: '#b2bec3', hover: '#74b9ff', highlight: '#0984e3' },
                width: 2,
                smooth: false,
                _raw: e,
            });
        });
        visEdges = new vis.DataSet(edges);

        // --- 创建 network ---
        network = new vis.Network(container, { nodes: visNodes, edges: visEdges }, {
            physics: false,
            interaction: {
                hover: true,
                dragNodes: true,
                zoomView: true,
                dragView: true,
                tooltipDelay: 100,
            },
            nodes: {
                borderWidth: 2,
                shadow: { enabled: true, color: 'rgba(0,0,0,0.12)', size: 6, x: 2, y: 2 },
            },
            edges: {
                smooth: false,
                selectionWidth: 2,
                hoverWidth: 1,
            },
        });

        // --- Hover tooltip ---
        network.on('hoverNode', params => {
            const nodeData = visNodes.get(params.node);
            if (!nodeData || !nodeData._raw) return;
            const d = nodeData._raw;
            if (isNewSchema) {
                showTooltip(params.event,
                    `<strong>Node</strong> ${d.id}<br>` +
                    `x: ${d.x}<br>y: ${d.y}`
                );
                return;
            }
            const amenities = [
                d.has_bench && 'Bench', d.has_water && 'Water', d.has_toilet && 'Toilet'
            ].filter(Boolean).join(', ') || 'None';
            showTooltip(params.event,
                `<strong>${d.id}</strong> — ${d.name}<br>` +
                `Function: ${d.function}<br>` +
                `UTCI: ${d.UTCI}<br>` +
                `Shade: ${(d.shade_ratio * 100).toFixed(0)}%<br>` +
                `Amenities: ${amenities}`
            );
        });
        network.on('blurNode', hideTooltip);

        network.on('hoverEdge', params => {
            const edgeData = visEdges.get(params.edge);
            if (!edgeData || !edgeData._raw) return;
            const d = edgeData._raw;
            if (isNewSchema) {
                const sim = d.sim || {};
                const utci = sim.UTCI !== undefined && sim.UTCI !== null
                    ? Number(sim.UTCI).toFixed(1) : '—';
                const sky = sim['Sky exposure'];
                const shadePct = (sky !== undefined && sky !== null)
                    ? ((1 - sky) * 100).toFixed(0) + '%' : '—';
                const wind = sim.Windspeed !== undefined && sim.Windspeed !== null
                    ? Number(sim.Windspeed).toFixed(2) + ' m/s' : '—';
                showTooltip(params.event,
                    `<strong>Route ${d.route}</strong> (Dir ${d.dir})<br>` +
                    `Length: ${Number(d.length).toFixed(1)} m<br>` +
                    `UTCI: ${utci}<br>` +
                    `Shade: ${shadePct}<br>` +
                    `Wind: ${wind}`
                );
                return;
            }
            showTooltip(params.event,
                `<strong>${d.source} — ${d.target}</strong><br>` +
                `Length: ${d.length}m<br>` +
                `UTCI: ${d.UTCI}<br>` +
                `Shade: ${(d.shade * 100).toFixed(0)}%<br>` +
                `Wind: ${d.windspeed} m/s<br>` +
                `Thermal: ${d.visual_thermal_perception}`
            );
        });
        network.on('blurEdge', hideTooltip);

        // Fit 视图
        setTimeout(() => network.fit({ animation: false }), 100);
    }

    // ---------- Tooltip ----------

    let tooltipEl = null;
    function ensureTooltip() {
        if (!tooltipEl) {
            tooltipEl = document.createElement('div');
            tooltipEl.className = 'tooltip';
            document.body.appendChild(tooltipEl);
        }
        return tooltipEl;
    }

    function showTooltip(event, html) {
        const el = ensureTooltip();
        el.innerHTML = html;
        // vis-network 的 event 结构：event.center 是 DOM 坐标
        const domEvent = event.center ? event : (event.event || event);
        const x = domEvent.clientX || (domEvent.center && domEvent.center.x) || 0;
        const y = domEvent.clientY || (domEvent.center && domEvent.center.y) || 0;
        el.style.left = (x + 14) + 'px';
        el.style.top = (y - 8) + 'px';
        el.classList.add('visible');
    }

    function hideTooltip() {
        if (tooltipEl) tooltipEl.classList.remove('visible');
    }

    // ---------- 路径高亮 ----------

    /**
     * 高亮一条路径（在现有 edge 上叠加新 edge）。
     * @param {string[]} path  - node ID 序列
     * @param {string} color   - 线条颜色
     * @param {Array|false|null|string} dash - dash pattern（vis 格式 [10,6] 或 false）
     * @param {number} strokeWidth - 线宽
     * @returns {string} overlayId
     */
    function highlightPath(path, color = '#0984e3', dash = null, strokeWidth = 5) {
        const overlayId = 'ov-' + (++overlayCounter);
        const newEdges = [];

        // 兼容旧的字符串 dash 格式（如 '6,4'）→ 转为 vis 的 [6,4]
        let visDashes = false;
        if (dash) {
            if (typeof dash === 'string') {
                visDashes = dash.split(',').map(Number);
            } else if (Array.isArray(dash)) {
                visDashes = dash;
            }
        }

        for (let i = 0; i < path.length - 1; i++) {
            const src = path[i], tgt = path[i + 1];
            const edgeId = `${overlayId}_${i}`;
            newEdges.push({
                id: edgeId,
                from: src,
                to: tgt,
                color: { color: color, hover: color, highlight: color },
                width: strokeWidth,
                smooth: false,
                dashes: visDashes,
                arrows: { to: false },
                selectionWidth: 0,
                hoverWidth: 0,
                _isOverlay: true,
            });
        }

        visEdges.add(newEdges);
        overlayEdges[overlayId] = newEdges.map(e => e.id);
        return overlayId;
    }

    /** 清除所有路径 overlay */
    function clearPaths() {
        Object.keys(overlayEdges).forEach(oid => clearPath(oid));
        overlayEdges = {};
    }

    /** 清除指定 overlay */
    function clearPath(overlayId) {
        const ids = overlayEdges[overlayId];
        if (ids) {
            visEdges.remove(ids);
            delete overlayEdges[overlayId];
        }
    }

    // ---------- Agent marker ----------

    /**
     * 在指定节点显示 agent marker（一个额外的大亮红 node）。
     * @param {string} nodeId
     */
    function showAgent(nodeId) {
        hideAgent();
        agentNodeId = nodeId;

        const pos = network.getPosition(nodeId);
        if (!pos) return;

        visNodes.add({
            id: AGENT_NODE_ID,
            x: pos.x,
            y: pos.y,
            fixed: true,
            shape: 'dot',
            size: 10,
            color: {
                background: '#d63031',
                border: '#ffffff',
                highlight: { background: '#d63031', border: '#fff' },
                hover: { background: '#d63031', border: '#fff' },
            },
            borderWidth: 3,
            label: '',
            level: 999,        // 置顶
            shadow: { enabled: true, color: 'rgba(214,48,49,0.4)', size: 10 },
        });
    }

    /** 隐藏 agent marker */
    function hideAgent() {
        try { visNodes.remove(AGENT_NODE_ID); } catch (_) { /* ignore */ }
        agentNodeId = null;
    }

    /**
     * 动画：agent 移动到 toNode。
     * vis-network 没有内置 node 动画，直接跳转。
     */
    function animateAgent(fromNode, toNode, duration = 600) {
        return new Promise(resolve => {
            showAgent(toNode);
            setTimeout(resolve, 80);
        });
    }

    /** 获取节点的 graph 坐标 */
    function getNodePos(nodeId) {
        if (!network) return null;
        return network.getPosition(nodeId);
    }

    /**
     * 获取节点在 canvas DOM 容器中的像素坐标。
     * 用于在 graph 上定位浮动 DOM 元素（如 reasoning bubble）。
     * @param {string} nodeId
     * @returns {{x: number, y: number}|null}
     */
    function getNodeDomPos(nodeId) {
        if (!network) return null;
        const canvasPos = network.getPosition(nodeId);
        if (!canvasPos) return null;
        return network.canvasToDOM(canvasPos);
    }

    /** Register a canvas-draw hook that runs before nodes/edges are painted.
     *  Useful for rendering a basemap underneath the graph. The callback
     *  receives the canvas 2D context with vis-network's view transform
     *  already applied, so drawing uses graph coordinates. */
    function onBeforeDraw(fn) {
        if (!network) return;
        network.on('beforeDrawing', fn);
    }

    /** Force a redraw of the graph canvas (e.g. after basemap state changes). */
    function redraw() {
        if (network) network.redraw();
    }

    return {
        init,
        highlightPath,
        clearPaths,
        clearPath,
        showAgent,
        hideAgent,
        animateAgent,
        getNodePos,
        getNodeDomPos,
        onBeforeDraw,
        redraw,
        PATH_PALETTE,
        DASH_PATTERNS,
    };
})();
