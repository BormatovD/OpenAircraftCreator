import * as THREE from "three";
import { panel, panelShell, type Surface, type WingWellSkin } from "./gearDoors.ts";
import { mainWellLiner, wellLiner } from "./gearOpenings.ts";
import type { ShapeSet } from "./shapeSet.ts";

type Gear = ShapeSet["gear"];
type Side = -1 | 1;
const seam = .012;

/** Round the door itself; the fixed apron uses this same outline. */
function roundBodyDoor(door: THREE.BufferGeometry, side: Side, x0: number, x1: number,
  z0: number, z1: number, surface: Surface) {
  const origin = door.userData.basePos as THREE.Vector3;
  const positions = door.getAttribute("position"), faceSize = positions.count / 2;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i) + origin.x, z = side * (positions.getZ(i) + origin.z);
    const u = (x - x0) / (x1 - x0), shapedX = x + bodyShoulderInset(z, z1) * (1 - 2 * u);
    const depth = i >= faceSize ? THREE.MathUtils.lerp(.004, .026, THREE.MathUtils.smoothstep(z, z0, z0 + .09)) : 0;
    positions.setXYZ(i, shapedX - origin.x, surface(shapedX, z) + depth - origin.y,
      side * z - origin.z);
  }
  door.computeVertexNormals();
  door.userData.roundedBodyDoor = true;
}

const bodyShoulderInset = (z: number, end: number) => .10 * THREE.MathUtils.smoothstep(z, end - .32, end);

/** One surface field joins the body-door infill and the leg-aperture apron.
 * Distance contours round the actual feathered surface around the corners,
 * rather than joining rectangular strips with raised miter fans. */
function smoothBayShoulders(side: Side, x: number, forwardReach: number, reach: number, legForward: number,
  fixedStart: number, outer: number, lower: Surface, closedSkin: Surface, skin: WingWellSkin) {
  type Point = [number, number];
  const feather = .34, x0 = x - forwardReach, x1 = x + reach;
  const boxDistance = (dx: number, dz: number) => Math.hypot(Math.max(dx, 0), Math.max(dz, 0)) + Math.min(Math.max(dx, dz), 0);
  const distance = (px: number, z: number) => {
    const inset = bodyShoulderInset(z, fixedStart - seam);
    const body = boxDistance(Math.max(x0 + inset - seam - px, px - x1 + inset - seam), z - fixedStart);
    const leg = boxDistance(Math.max(x - legForward - seam - px, px - x - .45 - seam),
      Math.max(fixedStart - seam - z, z - outer - seam));
    // A smooth union only enlarges the aperture at its two re-entrant corners.
    // Every point in the original moving-door footprint remains clear.
    const blend = Math.max(.12 - Math.abs(body - leg), 0) / .12;
    return Math.min(body, leg) - blend * blend * .12 / 4;
  };
  const height = (px: number, z: number) => {
    const installed = lower(px, z) - .004;
    const blend = THREE.MathUtils.smoothstep(distance(px, z), 0, feather);
    return Math.min(THREE.MathUtils.lerp(closedSkin(px, z) + .008, installed, blend), installed);
  };
  const positions: number[] = [], normals: number[] = [], indices: number[] = [], shared = new Map<string, number>();
  const vertex = ([x, span]: Point) => {
    const px = Math.fround(x), z = Math.fround(span);
    const key = `${px},${z}`;
    let i = shared.get(key);
    if (i !== undefined) return i;
    i = positions.length / 3;
    positions.push(px, height(px, z), side * z);
    // Interpolated surface derivatives make lighting agree across every cell,
    // including clipped aperture edges and the outer tangent to the airframe.
    const h = .001, dx = (height(px + h, z) - height(px - h, z)) / (2 * h);
    const dz = (height(px, z + h) - height(px, z - h)) / (2 * h);
    const n = new THREE.Vector3(dx, -1, side * dz).normalize();
    normals.push(n.x, n.y, n.z);
    shared.set(key, i);
    return i;
  };
  const clip = (points: Point[], inside: (p: Point) => number) => {
    const clipped: Point[] = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length], da = inside(a), db = inside(b);
      if (da >= 0) clipped.push(a);
      if ((da >= 0) === (db >= 0)) continue;
      let lo = 0, hi = 1;
      for (let j = 0; j < 18; j++) {
        const t = (lo + hi) / 2, p: Point = [THREE.MathUtils.lerp(a[0], b[0], t), THREE.MathUtils.lerp(a[1], b[1], t)];
        if ((inside(p) >= 0) === (da >= 0)) lo = t; else hi = t;
      }
      const t = (lo + hi) / 2;
      clipped.push([THREE.MathUtils.lerp(a[0], b[0], t), THREE.MathUtils.lerp(a[1], b[1], t)]);
    }
    return clipped;
  };
  const append = (points: Point[]) => {
    let polygon = clip(points, p => distance(...p));
    polygon = clip(polygon, p => feather - distance(...p));
    polygon = clip(polygon, p => skin.trailingEdge(p[1]) - .012 - p[0]);
    for (let i = 1; i + 1 < polygon.length; i++) {
      const [a, b, c] = [polygon[0], polygon[i], polygon[i + 1]];
      const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (Math.abs(area) < 1e-8) continue;
      const ids = [vertex(a), vertex(b), vertex(c)];
      if (new Set(ids).size < 3) continue;
      if (side < 0) ids.reverse();
      indices.push(...ids);
    }
  };
  const minX = x0 - seam - feather, maxX = x1 + seam + feather, minZ = .035, maxZ = outer + seam + feather;
  const nx = Math.ceil((maxX - minX) / .035), nz = Math.ceil((maxZ - minZ) / .035);
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const a: Point = [THREE.MathUtils.lerp(minX, maxX, i / nx), THREE.MathUtils.lerp(minZ, maxZ, j / nz)];
    const b: Point = [THREE.MathUtils.lerp(minX, maxX, (i + 1) / nx), a[1]];
    const c: Point = [b[0], THREE.MathUtils.lerp(minZ, maxZ, (j + 1) / nz)], d: Point = [a[0], c[1]];
    append([a, b, c]); append([a, c, d]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  g.setIndex(indices);
  g.name = "main-well-sill";
  Object.assign(g.userData, { side, fixedWingBody: true, bellyPaint: true, smoothApron: true, basePos: new THREE.Vector3() });
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
  const fixedStart = maxZ + .50, fixedEnd = g.mainZ - .30, outerHinge = g.mainZ + .38;

  // The outboard tyre lies lower than its partner in the retracted canted pair.
  // Shape the wheel blister around its axial slab. The lip feathers out beyond
  // the tyre, into the leg fairing, on both sides of the closed panel.
  const wheelSkin: Surface = (station, z) => {
    const skin = lower(station, z);
    const across = THREE.MathUtils.smoothstep(z, maxZ + .025, fixedStart - .050);
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
  // The bolted fairing is straight along the deployed leg. Build each
  // chordwise station as a generator parallel to the retracted strut,
  // instead of copying the wheel blister's compound curvature onto it.
  const slope = cos / sin;
  // The apron and its normals repeatedly sample the same chordwise section.
  // For a straight generator only the intercept depends on that section.
  const strutIntercepts = new Map<number, number>();
  const straightSkin: Surface = (station, z) => {
    let intercept = strutIntercepts.get(station);
    if (intercept === undefined) {
      intercept = pivot.y - .18 * (g.mainR / .584) / sin - .035;
      for (let i = 0; i <= 24; i++) {
        const span = THREE.MathUtils.lerp(fixedStart - seam, fixedEnd + seam, i / 24);
        intercept = Math.min(intercept, lower(station, span) - slope * (span - g.mainZ));
      }
      strutIntercepts.set(station, intercept);
    }
    return intercept + slope * (z - g.mainZ);
  };
  const hingeZ = .035;
  const bodySkin: Surface = (station, z) => {
    const start = maxZ + .025, end = fixedStart - .050;
    if (z <= start) {
      // From the centre hinge outwards the panel initially follows the
      // centre-section skin with a level tangent at the symmetry plane. The
      // wheel envelope takes over before even the inboard sidewall can enter.
      const blend = THREE.MathUtils.smoothstep(z, .10, Math.max(.16, axleZ - g.mainR - .08));
      return THREE.MathUtils.lerp(lower(station, z), wheelSkin(station, z), blend);
    }
    // Beyond the complete tyre envelope there is room for a tangent cubic,
    // rather than an abrupt minimum-envelope corner at the leg fairing.
    const tangent = wheelSkin(station, start) + slope * (z - start);
    return THREE.MathUtils.lerp(tangent, straightSkin(station, z), THREE.MathUtils.smoothstep(z, start, end));
  };
  const hingeLine = (station: number) => THREE.MathUtils.lerp(wheelSkin(x - legForward, outerHinge),
    wheelSkin(x + .45, outerHinge), (station - (x - legForward)) / (legForward + .45));
  let hingeDrop = .03;
  for (let i = 0; i <= 36; i++) {
    const station = THREE.MathUtils.lerp(x - legForward, x + .45, i / 36);
    hingeDrop = Math.max(hingeDrop, hingeLine(station) - wheelSkin(station, outerHinge) + .03);
  }
  const hingeSkin: Surface = station => hingeLine(station) - hingeDrop;
  const wingSkin: Surface = (station, z) => {
    const blend = THREE.MathUtils.clamp((z - fixedEnd - seam) / (outerHinge - fixedEnd - seam), 0, 1);
    return THREE.MathUtils.lerp(straightSkin(station, fixedEnd + seam), hingeSkin(station, z), blend);
  };
  const main = panel("main-body-door", "a320", side, x - forwardReach, x + reach, hingeZ,
    fixedStart - seam, bodySkin, "sequence", 90, [18, 64]);

  // Body door spans the wheel; the narrower fixed fairing runs along the
  // exposed leg, then the wing fairing bridges the last span to the hinge.
  const fixed = panelShell("main-strut-door", side, x - legForward, x + .45,
    fixedStart + seam, fixedEnd - seam, straightSkin, [18, 16]);
  fixed.translate(-pivot.x, -pivot.y, -pivot.z).rotateX(-angle);
  Object.assign(fixed.userData, { basePos: pivot, side, gearProfile: "a320", retract: { axis: "x", angle } });
  const hinged = panel("main-wing-door", "a320", side, x - legForward, x + .45, outerHinge,
    fixedEnd + seam, wingSkin, "wing-link", 84, [18, 16]);
  // The hinge rim is a thin metal return, not the full-depth shell. Keeping
  // it on its straight hinge axis prevents its inner face sweeping through
  // the fixed apron immediately outboard of the pin.
  const hingePositions = hinged.getAttribute("position"), faceSize = hingePositions.count / 2;
  for (let i = faceSize; i < hingePositions.count; i++) {
    const span = Math.abs(hingePositions.getZ(i));
    hingePositions.setY(i, hingePositions.getY(i) - .022 * (1 - THREE.MathUtils.smoothstep(span, 0, .10)));
  }
  hinged.computeVertexNormals();

  // The wheel and leg apertures open into one chamber. A vertical wall at the
  // width step would cut the tyre's oblique path even though the closed doors
  // and the final retracted tyre both clear it. The wider internal pocket sits
  // behind the intact skin surrounding the narrow exterior leg aperture.
  // Its roof follows the real body/wing upper envelope, including the higher
  // central pocket where the two canted tyres finish their inward stroke.
  const roof: Surface = (x, z) => skin.roof(x, Math.abs(z));
  const wheelWell = mainWellLiner(side, x - forwardReach - .02, x + reach + .02, outerHinge + .02, roof, lower, 16, 48, true);
  const closedSkin: Surface = (station, z) => {
    if (z < fixedStart) return bodySkin(station, z);
    const a = fixedEnd - seam, b = fixedEnd + seam;
    if (z <= a) return straightSkin(station, z);
    if (z >= b) return wingSkin(station, z);
    // The moving rims stop on either side of this running seam. Continue
    // the fixed skin between their actual heights and outgoing tangents;
    // switching at fixedEnd would introduce a one-seam vertical ledge.
    const t = (z - a) / (b - a), ya = straightSkin(station, a), yb = wingSkin(station, b);
    const outgoing = (wingSkin(station, b + .001) - yb) / .001;
    return THREE.MathUtils.lerp(ya, yb, t * t * (3 - 2 * t))
      + (b - a) * (slope * t * (1 - t) ** 2 + outgoing * t * t * (t - 1));
  };
  const sill = smoothBayShoulders(side, x, forwardReach, reach, legForward, fixedStart, outerHinge, lower, closedSkin, skin);
  roundBodyDoor(main, side, x - forwardReach, x + reach, hingeZ, fixedStart - seam, bodySkin);
  // Keep the skin flush along the curved keel. The straight axis through
  // its two brackets sits just outside that curve, so the hinge rim swings
  // away from the fixed centre strip as the door opens.
  const axisStart = main.userData.basePos as THREE.Vector3;
  const axisEndY = lower(x + reach, hingeZ);
  let offset = 0;
  for (let i = 0; i <= 18; i++) {
    const t = i / 18, station = THREE.MathUtils.lerp(axisStart.x, x + reach, t);
    offset = Math.max(offset, THREE.MathUtils.lerp(axisStart.y, axisEndY, t) - lower(station, hingeZ));
  }
  offset += .003;
  main.translate(0, offset, 0);
  axisStart.y -= offset;
  // Limit the two centre-hinged doors by their actual camber. For a point
  // rotated about a pin in the xy plane, z = hingeZ + a*cos(t) + b*sin(t).
  // Both ends of the stroke clear the centreline if the maximum angle is
  // below its first crossing; a is nonnegative over the full door.
  const motion = main.userData.gearDoor;
  const positions = main.getAttribute("position"), clearZ = hingeZ - .005;
  let limit = Math.PI / 2;
  for (let i = 0; i < positions.count; i++) {
    const a = side * positions.getZ(i);
    const b = motion.axis.x * positions.getY(i) - motion.axis.y * positions.getX(i);
    if (b < -clearZ) limit = Math.min(limit,
      Math.atan2(b, a) + Math.acos(-clearZ / Math.hypot(a, b)));
  }
  motion.angle = side * limit;
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
