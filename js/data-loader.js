/**
 * data-loader.js — 加载 graph 和 simulation results 的 JSON。
 * 提供缓存，避免重复请求。
 */

const DataLoader = (() => {
    const cache = {};

    async function fetchJSON(url) {
        if (cache[url]) return cache[url];
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`Failed to fetch ${url}: ${resp.status}`);
        const data = await resp.json();
        cache[url] = data;
        return data;
    }

    return {
        /** 加载 graph.json */
        async loadGraph() {
            return fetchJSON('api/graph.json');
        },

        /** 列出所有结果文件 */
        async loadResultsList() {
            // 不缓存列表，每次刷新
            const resp = await fetch('api/results/index.json');
            if (!resp.ok) throw new Error('Failed to fetch results list');
            return resp.json();
        },

        /** 加载单个结果 JSON */
        async loadResult(filename) {
            return fetchJSON(`api/results/${filename}`);
        },

        /** 清除缓存 */
        clearCache() {
            Object.keys(cache).forEach(k => delete cache[k]);
        },
    };
})();
