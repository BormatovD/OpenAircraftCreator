# Aircraft Designer — first public release

## Scope

Static browser application at **https://aircraft-designer.app/**. The VPS does
not execute simulations: geometry, physics, UI and Three.js run in the visitor's
browser. One `dist/index.html` bundle, built by Vite.

Included: A319/A320/A321 ceo/neo, 737-300/737-8, 757-200 (RB211/PW2037),
Tu-214 (PS-90A factory/operational weight presets); aircraft disassembly,
mission/payload-range/constraints and engineering methodology.

### What is and is not validated

- The A320 original phase values can use applicable CES FCOM tables, others
  use the predictive physics model. Different configurations must not inherit
  tables for another engine/wing.
- Tu-214 remains a **provisional engineering prediction**. Its fuel/range
  discrepancy and actual approved OEI profile need further validation.
- Boeing short-distance outliers remain known, especially 737-8 and 757.
- This app is for research and education. **Do not use** it for flight planning,
  dispatch, certification or aircraft maintenance instructions.
- New ATA detail is visualization; it does **not** add mass, resistance,
  auxiliary electric loads or change geometry of the aircraft definition.

## Technical detail v3

Updated cabinets and hydraulic manifolds use round-edged physical housing,
valves, gauges, electrical terminations, removable LRUs, fuel plumbing,
heat-exchanger fins and engine accessory housings. Equipment lives inside
existing ATA aggregate IDs (not additional mass nodes). Geometries are batched
by material. Three small shared 128×128 procedural bump patterns are only
**surface relief**. They are *not* a genuine UV-unwrapped AO/normal bake.

Do actual AO baking later only if specific validated CAD assemblies become
available (Blender UV → AO/normal maps → reviewed GLB/texture atlas).

## Release gates

1. On a clean branch: `npm ci && npm test && npm run typecheck && npm run build`.
2. Browser/manual: A320 and Tu-214, 757 both engine variants, dark/light mode,
   top/side/3/4, scene exploded at 0%/50%/100%, choose engine/ATA fuel/ATA 29/
   avionics/ECS; ensure no intersections, UI clipping or unresponsive controls.
3. Check mobile Safari and Chrome plus Chrome/Firefox desktop; WebGL context
   fallback/unsupported devices should not be claimed tested without a run.
4. In browser devtools record `renderer.info.render.calls` and triangle count
   before/after the v3 detail. If slow, reduce details and bump sampling.
5. Verify all controls and formulas. `How calculated` must retain known
   assumptions and no red raw LaTeX.
6. DNS A/AAAA, TLS, Caddy service, release ID and rollback test on VPS.

Do not declare the site live until HTTPS and end-to-end browser checks succeed.
