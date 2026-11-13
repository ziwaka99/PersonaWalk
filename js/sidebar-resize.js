(() => {
    'use strict';

    const STORAGE_KEY = 'personaWalk.3dmap.sidebarWidths.v1';
    const MIN_WIDTH = 240;
    const root = document.documentElement;

    function maxWidth() {
        return Math.max(MIN_WIDTH, Math.min(720, window.innerWidth * 0.45));
    }

    function clamp(width) {
        return Math.round(Math.max(MIN_WIDTH, Math.min(maxWidth(), width)));
    }

    function load() {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch { return {}; }
    }

    function save(widths) {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(widths)); } catch { /* storage is optional */ }
    }

    const widths = load();

    function apply(side) {
        const prop = side === 'left' ? '--left-w' : '--right-w';
        if (widths[side]) root.style.setProperty(prop, `${clamp(widths[side])}px`);
        else root.style.removeProperty(prop);
    }

    // Content inside the panels (charts, street view canvases) listens for window resizes.
    let resizeFrame = null;
    function notifyResize() {
        if (resizeFrame) return;
        resizeFrame = requestAnimationFrame(() => {
            resizeFrame = null;
            window.dispatchEvent(new Event('resize'));
        });
    }

    apply('left');
    apply('right');

    document.querySelectorAll('.panel-resizer').forEach(handle => {
        const side = handle.dataset.side;

        handle.addEventListener('pointerdown', event => {
            if (event.button !== 0) return;
            event.preventDefault();
            handle.setPointerCapture(event.pointerId);
            handle.classList.add('dragging');
            document.body.classList.add('is-resizing');

            const onMove = moveEvent => {
                widths[side] = clamp(side === 'left' ? moveEvent.clientX : window.innerWidth - moveEvent.clientX);
                apply(side);
                notifyResize();
            };
            const onUp = () => {
                handle.removeEventListener('pointermove', onMove);
                handle.removeEventListener('pointerup', onUp);
                handle.removeEventListener('pointercancel', onUp);
                handle.classList.remove('dragging');
                document.body.classList.remove('is-resizing');
                save(widths);
                notifyResize();
            };
            handle.addEventListener('pointermove', onMove);
            handle.addEventListener('pointerup', onUp);
            handle.addEventListener('pointercancel', onUp);
        });

        handle.addEventListener('dblclick', () => {
            delete widths[side];
            apply(side);
            save(widths);
            notifyResize();
        });
    });

    window.addEventListener('resize', () => {
        if (widths.left) apply('left');
        if (widths.right) apply('right');
    });
})();
