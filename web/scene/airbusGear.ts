import * as THREE from "three";
import { panel, panelShell, type Surface, type WingWellSkin } from "./gearDoors.ts";
import { mainWellLiner, wellLiner } from "./gearOpenings.ts";
import type { ShapeSet } from "./shapeSet.ts";

type Gear = ShapeSet["gear"];
type Side = -1 | 1;
const seam = .012;

/** Bonded shoulders around the stepped wheel/leg cut-out. Each end of a
 * shoulder follows a moving door rim or the unchanged airframe, leaving only
 * a narrow clearance seam when all doors are closed. */
function bayShoulders(side: Side, x: number, forwardReach: number, reach: number, legForward: number, fixedStart: number, outer: number,
  lower: Surface, wheelSkin: Surface, skin: WingWellSkin) {
  const vertices: number[] = [];
  type Point = [number, number, number];
  // The fixed apron ends at the actual wing edge. In particular, the aft
  // jamb must not extend the clamped airfoil sample into a floating shelf.
  const append = (triangle: Point[]) => {
    const clipped: Point[] = [];
    const distance = (p: Point) => p[0] - skin.trailingEdge(Math.abs(p[2])) + .012;
    for (let i = 0; i < triangle.length; i++) {
      const a = triangle[i], b = triangle[(i + 1) % triangle.length];
      const da = distance(a), db = distance(b);
      if (da <= 0) clipped.push(a);
      if (da * db >= 0) continue;
      let lo = 0, hi = 1;
      for (let j = 0; j < 24; j++) {
        const t = (lo + hi) / 2;
        const p = a.map((v, k) => THREE.MathUtils.lerp(v, b[k], t)) as Point;
        if ((distance(p) <= 0) === (da <= 0)) lo = t; else hi = t;
      }
      clipped.push(a.map((v, k) => THREE.MathUtils.lerp(v, b[k], (lo + hi) / 2)) as Point);
    }
    for (let i = 1; i + 1 < clipped.length; i++) vertices.push(...clipped[0], ...clipped[i], ...clipped[i + 1]);
  };
  const perimeter = [[x - forwardReach, .035], [x + reach, .035], [x + reach, fixedStart], [x + .45, fixedStart],
  [x + .45, outer], [x - legForward, outer], [x - legForward, fixedStart], [x - forwardReach, fixedStart]] as const;
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
    const point = (along: number, t: number): Point => {
      const x0 = THREE.MathUtils.lerp(a[0], b[0], along), z0 = THREE.MathUtils.lerp(a[1], b[1], along);
      const expansion = seam + apron * t;
      const px = x0 + expansion * THREE.MathUtils.lerp(miter[i][0], miter[j][0], along);
      const pz = Math.max(.035, z0 + expansion * THREE.MathUtils.lerp(miter[i][1], miter[j][1], along));
      const blend = THREE.MathUtils.smoothstep(t, 0, 1);
      const installed = lower(px, pz) - .004;
      return [px, Math.min(THREE.MathUtils.lerp(wheelSkin(x0, z0) + .008, installed, blend), installed), side * pz];
    };
    for (let k = 0; k < 10; k++) {
      for (let strip = 0; strip < 3; strip++) {
        const a = point(k / 10, strip / 3), b = point((k + 1) / 10, strip / 3);
        const c = point((k + 1) / 10, (strip + 1) / 3), d = point(k / 10, (strip + 1) / 3);
        append([a, b, c]); append([a, c, d]);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  g.computeVertexNormals();
  g.name = "main-well-sill";
  Object.assign(g.userData, { side, fixedWingBody: true, bellyPaint: true, basePos: new THREE.Vector3() });
  return g;
}

/** Airbus AC §2-9-0 figures 010 and 014. Model the twin-wheel installation
 * fitted to the six catalogue aircraft. Door outline dimensions are illustrative. */
export function airbusMainDoors(g: Gear, side: Side, pivot: THREE.Vector3, lower: Surface, groundY: number, skin: WingWellSkin) {
  const x = pivot.x;
  const reach = g.mainR + .21;
  // The folding side-stay sweeps ahead of the strut centreline. Include its
  // complete stroke, and keep the body-to-leg step outside that forward jamb.
  const legForward = .98, forwardReach = Math.max(reach, legForward + .06);
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
    // Keep the complete tyre slab flat through the last inboard grid station.
    // Starting the blend at the tyre shoulder lets a coarse shell triangle
    // bridge to the skin too early after widening the forward stay clearance.
    const roundOff = THREE.MathUtils.smoothstep(Math.abs(station - x), reach + .025, forwardReach + .25);
    const wheelBottom = tyreFaceY + (z - tyreFaceZ) * cos / sin;
    const tyrePanel = THREE.MathUtils.lerp(Math.min(wheelBottom - .065, skin), skin, Math.max(roundOff, across));
    // On the two outer fairings the cylinder slopes up at the retraction angle.
    // Include the collar and pivot bearing under the central part of the door.
    const gauge = g.mainR / .584;
    const barrel = pivot.y + (z - g.mainZ) * cos / sin - .18 * gauge / sin - .035;
    const edge = THREE.MathUtils.smoothstep(Math.abs(station - x), .26 * gauge, .43);
    return THREE.MathUtils.lerp(Math.min(tyrePanel, barrel), tyrePanel, edge);
  };
  const main = panel("main-body-door", "a320", side, x - forwardReach, x + reach, .035,
    fixedStart - seam, wheelSkin, "sequence", 96);

  // Body door spans the wheel; the narrower fixed fairing runs along the
  // exposed leg, then the wing fairing bridges the last span to the hinge.
  const fixed = panelShell("main-strut-door", side, x - legForward, x + .45,
    fixedStart - seam, fixedEnd + seam, wheelSkin);
  fixed.translate(-pivot.x, -pivot.y, -pivot.z).rotateX(-angle);
  Object.assign(fixed.userData, { basePos: pivot, side, gearProfile: "a320", retract: { axis: "x", angle } });
  const hinged = panel("main-wing-door", "a320", side, x - legForward, x + .45, outerHinge,
    fixedEnd + seam, wheelSkin, "wing-link", 84);

  // The wheel and leg apertures open into one chamber. A vertical wall at the
  // width step would cut the tyre's oblique path even though the closed doors
  // and the final retracted tyre both clear it. The wider internal pocket sits
  // behind the intact skin surrounding the narrow exterior leg aperture.
  // Its roof follows the real body/wing upper envelope, including the higher
  // central pocket where the two canted tyres finish their inward stroke.
  const roof: Surface = (x, z) => skin.roof(x, Math.abs(z));
  const wheelWell = mainWellLiner(side, x - forwardReach - .02, x + reach + .02, outerHinge + .02, roof, lower, 16, 48, true);
  const sill = bayShoulders(side, x, forwardReach, reach, legForward, fixedStart, outerHinge, lower, wheelSkin, skin);
  return [main, fixed, hinged, wheelWell, sill];
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
