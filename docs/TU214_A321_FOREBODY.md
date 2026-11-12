# Tu-214 nose — A321 forebody visual reference

## Scope

**Visual geometry only.** Following the owner's review, the previous 757-derived and later hand-smoothed Tu-214 nose was replaced with the established **A321-family forward fuselage and cockpit outline** already used by Aircraft Designer (`data/ac/a320-shapes.json`, `web/scene/shapeSet.ts`: `A320_SET`). The A321 uses the same forward family contour as A320; extra fuselage length is inserted aft of the nose.

This is a **design visual donor**, not a manufacturer CAD contour for Tu-214. The Tu-214's independent wing, tail, gear, doors beyond the cockpit, mass model, and flight physics are unchanged.

## Construction

- Forebody stations x=0…6.5 m: `top`, `bottom`, `half_width` from the A321/A320 family nose, rescaled to the Tu-214's 3.80 × 4.10 m main section.
- Station x=0: matching top/bottom at y=-0.7 m, closed tip.
- x=6.5 m: exact `top=+2.05`, `bottom=-2.05`, `half_width=1.90` m; the unchanged cylindrical Tu-214 fuselage continues aft.
- The A320 source contains an *underbody fairing digitization* near x=4.8–4.95 m (not part of the radome) and an ~6 mm overshoot in half-width near x≈5.5. Both are excluded before the cylinder join; otherwise there is a visible ring in the renderer.
- Cockpit glazing: the A321 five-vertex windscreen and two lateral side windows (5 and 6 vertices), scaled to the Tu-214 section. Its existing Three.js projection, glass surfaces, and rim materials continue to be used.
- Deterministic source: `python3 tools/tu214_shapes.py` regenerates the JSON. No Python dependencies beyond the standard library.

## Engineering caveat

The source photos of the real Tu-214 remain the target for later independent modeling; the A321 contour is an explicitly requested fallback to achieve a visually continuous and familiar nose. It must **not** be used to derive Tu-214 drag coefficients or airworthiness dimensions.

## Acceptance tests and preview

- The donor curve matches at sampled x stations; the body join is continuous and nearly tangent; no underbody fairing spur or width overshoot appears.
- The windows remain inside the forebody surface; dimensions, masses, and mission computations are unchanged.
- Preview image is rendered offscreen from these geometry arrays. It is **not** a browser screenshot of the production Three.js scene, which still requires a local `npm ci`, `npm test`, `npm run build`, and visual check.
