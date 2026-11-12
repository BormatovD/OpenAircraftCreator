# Tu-214 nose v2 and system details v2

## Input and scope

The Tu-214 cockpit/radome is an **engineering visual reconstruction**, not factory CAD. Forward fuselage stations 0–6.5 m in `data/ac/tu214-shapes.json` have been redrawn with fuller rounded sections based on the user's photos; aft of station 6.5 m the previous geometry is unchanged. The mirrored windscreen is shifted **0.11 m downward**; the side windows remain at their earlier positions. Both port and starboard frame meshes use the same `glassFrame` material and a bright, matte finish independent of surface-normal direction.

The existing v1 model used a blended B757-derived shape; v2 replaces that forward contour with a fuller Tu-214-specific, visually estimated radome.

## Detailed aggregates

`web/scene/systemDetails.ts` adds medium-scale parametric geometry:
- engine: fuel manifold, injector connections, gearbox accessories, case mounts;
- fuel: pump flanges, braces, valve, pressure sensor and pipes;
- hydraulics: pumps, accumulators, manifolds, covers, hoses and flange hardware;
- electrical: busbar, connectors and contactors;
- avionics: removable LRUs, open rack frames, guides and fasteners;
- ECS: heat-exchanger terminations, support brackets and finned core.

The existing `Part`/massTree identifiers are retained. Visual details have **no additional mass accounting**; neither OEW nor thrust, TSFC, drag, or fuel calculations are modified. Details are grouped by tone/side using `compactDetails` to limit draw calls.

## Preview and limitations

`PREVIEW_*` images in delivery are offscreen review renders built using the **same shape arrays and component placement dimensions**, not browser screenshots of Three.js: final colours, transparency, selectable parts and animations must be reviewed after `npm ci && npm test && npm run typecheck && npm run build` on a fully provisioned machine. In the current environment the npm registry is inaccessible. Computational tests independent of Three.js passed; mesh tests are included but could not be run here.

## Baking plan (separate future step)

True AO/normal baking requires a high-poly/low-poly pair and stable UV islands. It can represent cast texture, seams and small hardware, but cannot fix silhouettes and component placement. Next: create UVs per housing, bake AO and tangent-space normals into a shared texture atlas, and introduce LOD. Do not paint false structural features onto system surfaces.
