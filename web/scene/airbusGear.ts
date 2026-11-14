import * as THREE from "three";
import { panel, panelShell, type Surface } from "./gearDoors.ts";
import { wellLiner } from "./gearOpenings.ts";
import type { ShapeSet } from "./shapeSet.ts";

type Gear = ShapeSet["gear"];
type Side = -1 | 1;
const seam = .012;

/** Bonded shoulders around the stepped wheel/leg cut-out. Each end of a
 * shoulder follows a moving door rim or the unchanged airframe, leaving only
 * a narrow clearance seam when all doors are closed. */
function bayShoulders(side: Side, x: number, reach: number, fixedStart: number, outer: number,
  lower: Surface, wheelSkin: Surface) {
  const vertices: number[] = [];
  const perimeter = [[x - reach, .035], [x + reach, .035], [x + reach, fixedStart], [x + .45, fixedStart],
  [x + .45, outer], [x - .43, outer], [x - .43, fixedStart], [x - reach, fixedStart]] as const;
  const apron = .24;
  const normal = perimeter.map(([x0, z0], i) => {
    const [x1, z1] = perimeter[(i + 1) % perimeter.length];
    const length = Math.hypot(x1 - x0, z1 - z0);
    return [(z1 - z0) / length, (x0 - x1) / length];
  });
  // A shared miter at each corner joins the strips without a missing wedge.
  const miter = normal.map(([nx, nz], i) => {
    const [px, pz] = normal[(i + normal.length - 1) % normal.length];
    return [nx + px, nz + pz];
  });
  for (let i = 0; i < perimeter.length; i++) {
    const j = (i + 1) % perimeter.length;
    const a = perimeter[i], b = perimeter[j];
    if (normal[i][1] < 0 && a[1] < .04) continue;
    const point = (along: number, t: number) => {
      const x0 = THREE.MathUtils.lerp(a[0], b[0], along), z0 = THREE.MathUtils.lerp(a[1], b[1], along);
      const expansion = seam + apron * t;
      const px = x0 + expansion * THREE.MathUtils.lerp(miter[i][0], miter[j][0], along);
      const pz = Math.max(.035, z0 + expansion * THREE.MathUtils.lerp(miter[i][1], miter[j][1], along));
      const blend = THREE.MathUtils.smoothstep(t, 0, 1);
      return [px, THREE.MathUtils.lerp(wheelSkin(x0, z0), lower(px, pz), blend) + .008, side * pz];
    };
    for (let k = 0; k < 10; k++) {
      for (let strip = 0; strip < 3; strip++) {
        const a = point(k / 10, strip / 3), b = point((k + 1) / 10, strip / 3);
        const c = point((k + 1) / 10, (strip + 1) / 3), d = point(k / 10, (strip + 1) / 3);
        vertices.push(...a, ...b, ...c, ...a, ...c, ...d);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  g.computeVertexNormals();
  g.name = "main-well-sill";
  Object.assign(g.userData, { side, tone: "detailPanel", basePos: new THREE.Vector3() });
  return g;
}

/** Airbus AC §2-9-0 figures 010 and 014. Model the twin-wheel installation
 * fitted to the six catalogue aircraft. Door outline dimensions are illustrative. */
export function airbusMainDoors(g: Gear, side: Side, pivot: THREE.Vector3, lower: Surface, groundY: number) {
  const x = pivot.x;
  const reach = g.mainR + .21;
  const angle = side * THREE.MathUtils.degToRad(g.retractDeg);
  const sin = Math.sin(Math.abs(angle)), cos = Math.cos(angle);
  const length = pivot.y - groundY - g.mainR;
  const axleZ = g.mainZ - length * sin;
  const tyreOuterFace = g.mainWheelGap + g.mainTireW / 2;
  const tyreFaceZ = axleZ + tyreOuterFace * cos;
  const tyreFaceY = pivot.y - length * cos - tyreOuterFace * sin;
  const maxZ = tyreFaceZ + g.mainR * sin;
  const fixedStart = maxZ + .09, fixedEnd = g.mainZ - .45, outerHinge = g.mainZ + .17;

  // The outboard tyre lies lower than its partner in the retracted canted pair.
  // Shape the wheel blister around its axial slab. The lip feathers out beyond
  // the tyre, into the leg fairing, on both sides of the closed panel.
  const wheelSkin: Surface = (station, z) => {
    const skin = lower(station, z);
    const across = THREE.MathUtils.smoothstep(z, fixedStart, fixedStart + .36);
    const roundOff = THREE.MathUtils.smoothstep(Math.abs(station - x), g.mainR + .05, reach + .25);
    const wheelBottom = tyreFaceY + (z - tyreFaceZ) * cos / sin;
    const tyrePanel = THREE.MathUtils.lerp(Math.min(wheelBottom - .065, skin), skin, Math.max(roundOff, across));
    // On the two outer fairings the cylinder slopes up at the retraction angle.
    // Include the collar and pivot bearing under the central part of the door.
    const gauge = g.mainR / .584;
    const barrel = pivot.y + (z - g.mainZ) * cos / sin - .18 * gauge / sin - .035;
    const edge = THREE.MathUtils.smoothstep(Math.abs(station - x), .26 * gauge, .43);
    return THREE.MathUtils.lerp(Math.min(tyrePanel, barrel), tyrePanel, edge);
  };
  const main = panel("main-body-door", "a320", side, x - reach, x + reach, .035,
    fixedStart - seam, wheelSkin, "sequence", 96);

  // Body door spans the wheel; the narrower fixed fairing runs along the
  // exposed leg, then the wing fairing bridges the last span to the hinge.
  const fixed = panelShell("main-strut-door", side, x - .43, x + .45,
    fixedStart - seam, fixedEnd + seam, wheelSkin);
  fixed.translate(-pivot.x, -pivot.y, -pivot.z).rotateX(-angle);
  Object.assign(fixed.userData, { basePos: pivot, side, gearProfile: "a320", retract: { axis: "x", angle } });
  const hinged = panel("main-wing-door", "a320", side, x - .43, x + .45, outerHinge,
    fixedEnd + seam, wheelSkin, "wing-link", 84);

  const wheelWell = wellLiner("main-wheel-well", x - reach - .02, x + reach + .02,
    fixedStart + .05, (x, z) => lower(x, Math.abs(z)) + THREE.MathUtils.lerp(1.95, .49,
      THREE.MathUtils.smoothstep(Math.abs(z), 1.35, fixedStart + .05)), lower, side);
  const legWell = wellLiner("main-leg-well", x - .45, x + .47, outerHinge + .02,
    (x, z) => lower(x, Math.abs(z)) + .21, lower, side, fixedStart + .04);
  const sill = bayShoulders(side, x, reach, fixedStart, outerHinge, lower, wheelSkin);
  return [main, fixed, hinged, wheelWell, legWell, sill];
}

export function airbusNoseDoors(g: Gear, pivot: THREE.Vector3, lower: Surface) {
  const width = (g.noseWheelGap ?? .25) + (g.noseTireW ?? .224) / 2 + .13;
  // The central leg door fills the strip between the two aft panels only.
  const central = .142;
  const split = pivot.x - .72, aft = pivot.x + .22;
  const front = pivot.x - (g.noseLegM + g.noseR + .13) - g.noseR - .13;
  const panels = ([-1, 1] as const).flatMap(side => [
    panel("nose-forward-door", "a320", side, front, split - seam, width, seam,
      lower, "sequence", 93),
    panel("nose-aft-door", "a320", side, split + seam, aft, width, central + seam,
      lower, "nose-link-aft", 86),
  ]);
  const fixed = panelShell("nose-leg-door", 1, split + seam, aft, -central + seam, central - seam,
    (x, z) => lower(x, Math.abs(z)));
  const angle = -THREE.MathUtils.degToRad(92);
  fixed.translate(-pivot.x, -pivot.y, -pivot.z).rotateZ(-angle);
  Object.assign(fixed.userData, { basePos: pivot, side: 0, gearProfile: "a320", retract: { axis: "z", angle } });
  const well = wellLiner("nose-wheel-well", front - .025, aft + .025, width + .02,
    () => pivot.y + g.noseR + .70, lower, 0);
  return [...panels, fixed, well];
}
