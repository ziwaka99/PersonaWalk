(() => {
    'use strict';

    const intro = document.getElementById('intro');
    if (!intro) return;
    const crowd = document.getElementById('intro-crowd');
    const title = document.getElementById('intro-title');
    // Loop mode (intro/preview.html): replay forever with new figures instead of revealing the map.
    const loop = intro.hasAttribute('data-loop');
    let partsReady = null;

    const BODIES = ['body_poster_cloud_01', 'body_poster_diamond_01', 'body_poster_capsule_01', 'body_poster_pentagon_01', 'body_poster_pebble_01', 'body_poster_tall_01'];
    const FACES = [
        { eye: 'eye_dot_01', mouth: 'mouth_none' },
        { eye: 'eye_dot_01', mouth: 'mouth_smile_01' },
        { eye: 'eye_sleepy_01', mouth: 'mouth_smile_01' },
        { eye: 'eye_oval_01', mouth: 'mouth_open_01' },
    ];
    const COLORS = ['#F2F0E6', '#68A8DE', '#EFEA75', '#8E7CC3', '#E88CBA', '#F49386', '#C73732', '#2A9D8F'];
    const LEGS = ['leg_thin_01', 'leg_thick_01'];

    const WALK_MS = 2600;
    const STAGGER_MS = 150;
    const HOLD_MS = 1500;
    const FADE_MS = 800;

    let finished = false;
    let finishTimer = null;

    const shuffle = list => {
        const copy = [...list];
        for (let i = copy.length - 1; i > 0; i -= 1) {
            const j = Math.floor(Math.random() * (i + 1));
            [copy[i], copy[j]] = [copy[j], copy[i]];
        }
        return copy;
    };
    const pick = list => list[Math.floor(Math.random() * list.length)];

    function finish() {
        if (finished) return;
        finished = true;
        clearTimeout(finishTimer);
        intro.classList.add('is-leaving');
        setTimeout(() => intro.remove(), FADE_MS);
    }

    function randomRecipes() {
        const colors = shuffle(COLORS);
        return shuffle(BODIES).map((body, i) => ({
            body,
            arm: null,
            leg: pick(LEGS),
            ...pick(FACES),
            color: colors[i],
        }));
    }

    function loadParts() {
        if (!partsReady) {
            // Part paths in the registry are relative to the intro folder.
            const prefix = loop ? '' : 'intro/';
            for (const part of Object.values(window.PARTS)) {
                if (part.svgFile) part.svgFile = `${prefix}${part.svgFile}`;
                if (part.shadowSvgFile) part.shadowSvgFile = `${prefix}${part.shadowSvgFile}`;
            }
            partsReady = window.loadPartsLibrary();
        }
        return partsReady;
    }

    function replay() {
        intro.classList.add('is-resetting');
        setTimeout(() => {
            crowd.replaceChildren();
            title.getAnimations().forEach(animation => animation.cancel());
            intro.classList.remove('is-resetting');
            play().catch(error => console.warn('Intro animation unavailable:', error));
        }, FADE_MS);
    }

    async function play() {
        await loadParts();
        if (finished) return;

        const walkerWidth = window.matchMedia('(max-width: 760px)').matches ? 100 : 150;
        const spacing = walkerWidth * 0.86;
        const startX = -(window.innerWidth / 2 + walkerWidth);
        const recipes = randomRecipes();

        // The walker heading for the right-most slot leads the line.
        recipes.forEach((recipe, i) => {
            const slot = recipes.length - 1 - i;
            const endX = (slot - (recipes.length - 1) / 2) * spacing;
            const walker = document.createElement('div');
            walker.className = 'intro-walker';
            walker.innerHTML = window.buildCharacter(recipe);
            crowd.appendChild(walker);
            const motion = walker.animate(
                [{ transform: `translateX(${startX}px)` }, { transform: `translateX(${endX}px)` }],
                { duration: WALK_MS, delay: i * STAGGER_MS, easing: 'cubic-bezier(0.25, 0.55, 0.35, 1)', fill: 'forwards' },
            );
            motion.finished.then(() => walker.classList.add('is-stopped')).catch(() => {});
        });

        title.animate(
            [{ opacity: 0, transform: 'translateX(-90px)' }, { opacity: 1, transform: 'translateX(0)' }],
            { duration: WALK_MS, delay: 300, easing: 'cubic-bezier(0.25, 0.55, 0.35, 1)', fill: 'forwards' },
        );

        const arrival = WALK_MS + (recipes.length - 1) * STAGGER_MS;
        finishTimer = setTimeout(loop ? replay : finish, arrival + HOLD_MS);
    }

    if (!loop) {
        document.getElementById('intro-skip').addEventListener('click', finish);
        intro.addEventListener('click', finish);
        document.addEventListener('keydown', function onKey() {
            document.removeEventListener('keydown', onKey);
            finish();
        });
    }

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        title.style.opacity = '1';
        if (!loop) finishTimer = setTimeout(finish, HOLD_MS);
        return;
    }

    play().catch(error => {
        console.warn('Intro animation unavailable:', error);
        finish();
    });
})();
