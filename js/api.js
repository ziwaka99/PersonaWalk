// Maps backend endpoints to static files when the page is published without
// the Flask server (scripts/build_static_site.py sets window.PW_STATIC).
window.pwApi = path => {
    if (!window.PW_STATIC) return path;
    const rules = [
        [/^\/api\/realmap$/, 'api/realmap.json'],
        [/^\/api\/results$/, 'api/results/index.json'],
        [/^\/api\/results\/(.+)$/, 'api/results/$1'],
        [/^\/api\/route_points\/(\d+)$/, 'api/route_points/$1.json'],
        [/^\/api\/route_view\/(\d+)\/(\d+)$/, 'api/route_view/$1/$2.png'],
        [/^\/api\/trees$/, 'api/trees.geojson'],
        [/^\/api\/streetview\/manifest$/, 'api/streetview/manifest.json'],
        [/^\/api\/streetview\/pano\/(.+)$/, 'api/streetview/pano/$1'],
    ];
    for (const [pattern, target] of rules) {
        if (pattern.test(path)) return path.replace(pattern, target);
    }
    return path.replace(/^\//, '');
};
