// Parts registry.
//
// Visual parts live as standalone SVG files under ./parts so they can be
// opened and edited directly in vector tools. This registry keeps metadata:
// ids, part types, tags, anchor positions, and file paths.

(function () {
  const svgCache = new Map();

  async function loadSvgFragment(path) {
    if (svgCache.has(path)) return svgCache.get(path);

    const res = await fetch(path);
    if (!res.ok) {
      throw new Error(`Could not load SVG part: ${path}`);
    }

    const text = await res.text();
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const parseError = doc.querySelector('parsererror');
    if (parseError) {
      throw new Error(`Invalid SVG part: ${path}`);
    }

    const svg = doc.documentElement;
    const fragment = Array.from(svg.childNodes)
      .map(node => new XMLSerializer().serializeToString(node))
      .join('\n');

    svgCache.set(path, fragment);
    return fragment;
  }

  window.PARTS = {

    // ---------- BODIES ----------
    body_poster_cloud_01: {
      id: 'body_poster_cloud_01', type: 'body',
      tags: ['poster', 'wide', 'soft', 'cloud'],
      svgFile: 'parts/bodies/body_poster_cloud_01.svg',
      shadowSvgFile: 'parts/body-shadows/body_poster_cloud_01.svg',
      anchors: {
        eye_L:      [-15, -12],
        eye_R:      [ 15, -12],
        mouth:      [  0,   4],
        shoulder_L: [-36,   8],
        shoulder_R: [ 36,   8],
        hip_L:      [-17,  25],
        hip_R:      [ 17,  25],
      },
    },

    body_poster_pebble_01: {
      id: 'body_poster_pebble_01', type: 'body',
      tags: ['poster', 'round', 'pebble'],
      svgFile: 'parts/bodies/body_poster_pebble_01.svg',
      shadowSvgFile: 'parts/body-shadows/body_poster_pebble_01.svg',
      anchors: {
        eye_L:      [-13, -13],
        eye_R:      [ 13, -13],
        mouth:      [  0,   4],
        shoulder_L: [-28,   8],
        shoulder_R: [ 28,   8],
        hip_L:      [-14,  31],
        hip_R:      [ 14,  31],
      },
    },

    body_poster_tall_01: {
      id: 'body_poster_tall_01', type: 'body',
      tags: ['poster', 'tall', 'rounded'],
      svgFile: 'parts/bodies/body_poster_tall_01.svg',
      shadowSvgFile: 'parts/body-shadows/body_poster_tall_01.svg',
      anchors: {
        eye_L:      [-10, -28],
        eye_R:      [ 10, -28],
        mouth:      [  0, -10],
        shoulder_L: [-24,  10],
        shoulder_R: [ 24,  10],
        hip_L:      [-13,  45],
        hip_R:      [ 13,  45],
      },
    },

    body_poster_diamond_01: {
      id: 'body_poster_diamond_01', type: 'body',
      tags: ['poster', 'diamond', 'gem'],
      svgFile: 'parts/bodies/body_poster_diamond_01.svg',
      shadowSvgFile: 'parts/body-shadows/body_poster_diamond_01.svg',
      anchors: {
        eye_L:      [-12, -15],
        eye_R:      [ 12, -15],
        mouth:      [  0,   1],
        shoulder_L: [-30,  12],
        shoulder_R: [ 30,  12],
        hip_L:      [-14,  33],
        hip_R:      [ 14,  33],
      },
    },

    body_poster_pentagon_01: {
      id: 'body_poster_pentagon_01', type: 'body',
      tags: ['poster', 'pentagon', 'house'],
      svgFile: 'parts/bodies/body_poster_pentagon_01.svg',
      shadowSvgFile: 'parts/body-shadows/body_poster_pentagon_01.svg',
      anchors: {
        eye_L:      [-12, -10],
        eye_R:      [ 12, -10],
        mouth:      [  0,   8],
        shoulder_L: [-27,  17],
        shoulder_R: [ 27,  17],
        hip_L:      [-13,  39],
        hip_R:      [ 13,  39],
      },
    },

    body_poster_capsule_01: {
      id: 'body_poster_capsule_01', type: 'body',
      tags: ['poster', 'capsule', 'pill'],
      svgFile: 'parts/bodies/body_poster_capsule_01.svg',
      shadowSvgFile: 'parts/body-shadows/body_poster_capsule_01.svg',
      anchors: {
        eye_L:      [-13, -10],
        eye_R:      [ 13, -10],
        mouth:      [  0,   6],
        shoulder_L: [-42,   7],
        shoulder_R: [ 42,   7],
        hip_L:      [-18,  24],
        hip_R:      [ 18,  24],
      },
    },

    // ---------- ARMS ----------
    arm_thin_01: {
      id: 'arm_thin_01', type: 'arm',
      tags: ['thin', 'simple', 'straight'],
      svgFile: 'parts/arms/arm_thin_01.svg',
    },

    arm_thick_01: {
      id: 'arm_thick_01', type: 'arm',
      tags: ['thick', 'chunky'],
      svgFile: 'parts/arms/arm_thick_01.svg',
    },

    // ---------- LEGS ----------
    // Legs remain parametric because the assembler builds separate thigh and
    // shank segments so CSS can animate hip / knee independently.
    leg_thin_01: {
      id: 'leg_thin_01', type: 'leg',
      tags: ['thin', 'long'],
      thigh: { length: 22, width: 11 },
      shank: { length: 23, width: 11 },
    },

    leg_thick_01: {
      id: 'leg_thick_01', type: 'leg',
      tags: ['thick', 'short'],
      thigh: { length: 18, width: 16 },
      shank: { length: 20, width: 16 },
    },

    // ---------- EYES ----------
    eye_dot_01: {
      id: 'eye_dot_01', type: 'eye',
      tags: ['dot', 'small', 'simple'],
      svgFile: 'parts/eyes/eye_dot_01.svg',
    },

    eye_oval_01: {
      id: 'eye_oval_01', type: 'eye',
      tags: ['oval', 'tall'],
      svgFile: 'parts/eyes/eye_oval_01.svg',
    },

    eye_sleepy_01: {
      id: 'eye_sleepy_01', type: 'eye',
      tags: ['sleepy', 'closed', 'line'],
      svgFile: 'parts/eyes/eye_sleepy_01.svg',
    },

    // ---------- MOUTHS ----------
    mouth_none: {
      id: 'mouth_none', type: 'mouth',
      tags: ['none', 'blank', 'neutral'],
      svgFile: 'parts/mouths/mouth_none.svg',
    },

    mouth_smile_01: {
      id: 'mouth_smile_01', type: 'mouth',
      tags: ['smile', 'happy'],
      svgFile: 'parts/mouths/mouth_smile_01.svg',
    },

    mouth_open_01: {
      id: 'mouth_open_01', type: 'mouth',
      tags: ['open', 'surprised'],
      svgFile: 'parts/mouths/mouth_open_01.svg',
    },
  };

  window.loadPartsLibrary = async function loadPartsLibrary() {
    const parts = Object.values(window.PARTS);
    await Promise.all(parts.map(async part => {
      if (part.svgFile) {
        part.svg = await loadSvgFragment(part.svgFile);
      }
      if (part.shadowSvgFile) {
        part.shadowSvg = await loadSvgFragment(part.shadowSvgFile);
      }
    }));
  };
})();
