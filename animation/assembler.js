// Assembler: turns a "recipe" into an SVG string for a single character.
//
// Recipe shape:
//   {
//     body:  "body_poster_cloud_01",
//     arm:   "arm_thin_01",     // both arms use the same part
//     leg:   "leg_thin_01",     // both legs use the same part
//     eye:   "eye_dot_01",      // both eyes use the same part
//     mouth: "mouth_none",
//     color: "#D32F2F",         // optional; sets --body-color
//   }
//
// Z-order: shadows (back) -> arms -> legs -> body -> eyes / mouth (front).
// Each animated limb is wrapped in `<g transform="translate(...)"><g class="...">PART</g></g>`
// so its local origin (the shoulder/hip) is the rotation center.

(function () {
  const CANVAS = { width: 200, height: 220 };
  const BODY_CENTER = [100, 105]; // where body's local (0,0) sits on the canvas

  function lookup(id, expectedType) {
    const part = window.PARTS[id];
    if (!part) throw new Error(`Unknown part: ${id}`);
    if (part.type !== expectedType) {
      throw new Error(`Part ${id} is type "${part.type}", expected "${expectedType}"`);
    }
    return part;
  }

  // Place a part at (BODY_CENTER + offset) on the canvas.
  // The outer <g> handles position; the inner <g> is what gets animated
  // (so rotation pivots around the part's own 0,0 = shoulder/hip).
  function place(part, offset, animClass) {
    const [ox, oy] = offset;
    const [bx, by] = BODY_CENTER;
    const cls = animClass ? ` class="${animClass}"` : '';
    return `<g transform="translate(${bx + ox}, ${by + oy})"><g${cls}>${part.svg}</g></g>`;
  }

  // Articulated leg: nested groups for hip / knee rotations.
  //
  //   <g translate(hip)>
  //     <g class="leg leg-L">       <-- hip rotation
  //       <line> ... thigh ...
  //       <g translate(0, thigh.length)>
  //         <g class="knee">         <-- knee rotation
  //           <line> ... shank ...
  //         </g>
  //       </g>
  //     </g>
  //   </g>
  function buildLeg(part, shadow = false) {
    const { thigh, shank } = part;
    const c = shadow ? 'var(--part-shadow-color, #232323)' : 'var(--body-color, #D32F2F)';
    return `
      <line x1="0" y1="0" x2="0" y2="${thigh.length}"
            stroke="${c}" stroke-width="${thigh.width}" stroke-linecap="round"/>
      <g transform="translate(0, ${thigh.length})">
        <g class="knee">
          <line x1="0" y1="0" x2="0" y2="${shank.length}"
                stroke="${c}" stroke-width="${shank.width}" stroke-linecap="round"/>
        </g>
      </g>`;
  }

  function placeLeg(part, offset, sideClass, shadow = false) {
    const [ox, oy] = offset;
    const [bx, by] = BODY_CENTER;
    const dx = shadow ? 4 : 0;
    const dy = shadow ? 5 : 0;
    return `<g transform="translate(${bx + ox + dx}, ${by + oy + dy})">
              <g class="leg ${sideClass}">${buildLeg(part, shadow)}</g>
            </g>`;
  }

  function buildCharacter(recipe) {
    const body  = lookup(recipe.body,  'body');
    const leg   = lookup(recipe.leg,   'leg');
    const eye   = lookup(recipe.eye,   'eye');
    const mouth = lookup(recipe.mouth, 'mouth');
    // Arms are optional — set `arm: null` (or omit) to hide them.
    const arm   = recipe.arm ? lookup(recipe.arm, 'arm') : null;

    const color = recipe.color || '#D32F2F';
    const anchors = body.anchors;
    const [bx, by] = BODY_CENTER;

    // Two nested groups around the character content:
    //   .character     — animates `transform: translate(...)` (bob/sway)
    //   .lean          — applies a STATIC forward-lean rotation, pivoting
    //                    near the leg tips. Because .lean is INSIDE .character,
    //                    the bob translate is applied AFTER the lean rotate
    //                    in screen coords, so the body bobs straight up/down
    //                    instead of along the tilted body axis.
    const arms = arm
      ? `${place(arm, anchors.shoulder_L, 'arm arm-L')}
         ${place(arm, anchors.shoulder_R, 'arm arm-R')}`
      : '';
    const bodyShadow = body.shadowSvg
      ? `<g transform="translate(${bx}, ${by})">${body.shadowSvg}</g>`
      : '';

    return `
<svg class="character-svg" viewBox="0 0 ${CANVAS.width} ${CANVAS.height}"
     xmlns="http://www.w3.org/2000/svg"
     style="--body-color: ${color};">
  <ellipse class="ground-shadow" cx="${bx}" cy="${CANVAS.height - 12}" rx="50" ry="5"
           fill="var(--part-shadow-color, #232323)"/>
  <g class="character">
    <g class="lean">
      <g class="part-shadows">
        ${bodyShadow}
        ${placeLeg(leg, anchors.hip_L, 'leg-L', true)}
        ${placeLeg(leg, anchors.hip_R, 'leg-R', true)}
      </g>
      ${arms}
      ${placeLeg(leg, anchors.hip_L, 'leg-L')}
      ${placeLeg(leg, anchors.hip_R, 'leg-R')}
      <g transform="translate(${bx}, ${by})">${body.svg}</g>
      ${place(eye,   anchors.eye_L)}
      ${place(eye,   anchors.eye_R)}
      ${place(mouth, anchors.mouth)}
    </g>
  </g>
</svg>`;
  }

  // Convenience: render directly into a DOM container.
  function renderInto(container, recipe) {
    container.innerHTML = buildCharacter(recipe);
  }

  window.buildCharacter = buildCharacter;
  window.renderInto = renderInto;
})();
