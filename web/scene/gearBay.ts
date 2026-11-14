import * as THREE from "three";
import { panel, panelShell, type Surface, type DoorDrive, type DoorMotion, type WingWellSkin } from "./gearDoors.ts";
import { mainWellLiner, wellLiner } from "./gearOpenings.ts";
import { airbusMainDoors, airbusNoseDoors } from "./airbusGear.ts";
import { applyBoeing737GearPose, boeing737MainDoors, boeing737NoseDoors } from "./boeing737Gear.ts";
import type { ShapeSet } from "./shapeSet.ts";

export type GearProfile = ShapeSet["id"];
type Gear = ShapeSet["gear"];
type Side = -1 | 1;
const zAxis = new THREE.Vector3(0, 0, 1);
const rad = THREE.MathUtils.degToRad;
const tandemLegAft = 1.20;
// The old Tu-214 sketch stopped short of the enclosed well; rotate to horizontal
// to clear the closed panel without changing the parked footprint or leg length.
export const mainTravelAngle = (profile: GearProfile | undefined, gear: Gear) =>
  rad(profile === "tu214" ? 90 : gear.retractDeg);
const smooth = (x: number, from: number, to: number) => THREE.MathUtils.smoothstep(x, from, to);
// Fractions of a review stroke, not elapsed time or rigging settings.
export function gearLegTravel(profile: string | undefined, up: number): number {
  if (!profile || profile === "b737") return up;
  return smooth(up, .17, .83);
}
function doorFraction(drive: DoorDrive, profile: GearProfile, up: number) {
  const travel = gearLegTravel(profile, up);
  switch (drive) {
    case "sequence":
      // Hydraulic door is open before either the 757 or Tu main leg can move.
      return smooth(up, 0, .17) * (1 - smooth(up, .83, 1));
    case "nose-link-front":
      // The Tu forward pair opens and shuts during leg travel via a linkage.
      return smooth(travel, 0, .28) * (1 - smooth(travel, .90, 1));
    case "nose-link-aft":
      return 1 - smooth(travel, .40, 1);
    case "nose-link-737":
      // Classic ATA 32-30: the pair stays open until the last part of retraction.
      return 1 - smooth(travel, .80, 1);
    case "wing-link": {
      if (profile === "b757" || profile === "tu214") {
        // A linked upper door closes ahead of the last strut movement so the
        // two finite-thickness rims can pass without cutting through each other.
        return Math.pow(1 - travel, 1.3) * (1 - smooth(travel, .75, .95));
      }
      return 1 - travel;
    }
  }
}

const tiltQ = new THREE.Quaternion(), delta = new THREE.Vector3();

/** Called after restoring the assembly position and the basic retraction quaternion. */
export function applyGearBayPose(mesh: THREE.Mesh, up: number, unloaded: number): void {
  const { gearDoor, gearBogie, gearProfile } = mesh.geometry.userData;
  if (mesh.geometry.userData.inner737) {
    applyBoeing737GearPose(mesh, gearLegTravel(gearProfile, up));
  } else if (gearDoor) {
    const d = gearDoor as DoorMotion;
    mesh.quaternion.setFromAxisAngle(d.axis, d.angle * doorFraction(d.drive, gearProfile, up));
  } else if (gearBogie) {
    // +x is aft: a negative local Z rotation raises the front axle.
    // Boeing specifies 9.6°; the Tu direction is photographic and its magnitude illustrative.
    const angle = rad(gearProfile === "b757" ? -9.6 : 8)
      * Math.max(THREE.MathUtils.clamp(unloaded, 0, 1), smooth(up, 0, .17));
    tiltQ.setFromAxisAngle(zAxis, angle);
    delta.copy(gearBogie).applyQuaternion(tiltQ).sub(gearBogie).negate().applyQuaternion(mesh.quaternion);
    mesh.position.add(delta);
    mesh.quaternion.multiply(tiltQ);
  }
}

export function noseDoors(profile: GearProfile, g: Gear, pivot: THREE.Vector3, lower: Surface) {
  if (profile === "a320") return airbusNoseDoors(g, pivot, lower);
  if (profile === "b737") return boeing737NoseDoors(g, pivot, lower);
  const aperture = (g.noseWheelGap ?? .3) + (g.noseTireW ?? .22) / 2 + .13;
  const split = pivot.x - .27;
  const fore = pivot.x - (pivot.y - lower(pivot.x, 0) + g.noseLegM) - g.noseR - .16;
  const doors = ([-1, 1] as const).flatMap(s => [
    panel("nose-forward-door", profile, s, fore, split - .012, aperture, .012, lower,
      profile === "b757" ? "sequence" : "nose-link-front", 94),
    panel("nose-aft-door", profile, s, split + .012, pivot.x + .46, aperture, .012, lower, "nose-link-aft", 87),
  ]);
  doors.push(wellLiner("nose-wheel-well", fore - .02, pivot.x + .48, aperture + .02, () => pivot.y + g.noseR + .65, lower, 0));
  return doors;
}

export function mainDoors(profile: GearProfile, g: Gear, side: Side, pivot: THREE.Vector3, lower: Surface, groundY: number, wellSkin: WingWellSkin) {
  if (profile === "a320") return airbusMainDoors(g, side, pivot, lower, groundY, wellSkin);
  if (profile === "b737") return boeing737MainDoors(g, side, pivot, lower, groundY, wellSkin);
  const reach = (g.axleSpacingM ?? 1) / 2 + g.mainR + .22;
  const innerEdge = profile === "b757" ? 1.65 : 1.73;
  // Sources in docs/aggregates/gear-doors-bogies.md constrain the panel roles
  // and sequence. These contours, hinge offsets and intermediate linkage
  // angles remain clearance-constrained illustrations, not rigging dimensions.
  const angle = side * mainTravelAngle(profile, g);
  const slope = Math.cos(Math.abs(angle)) / Math.sin(Math.abs(angle));
  const intercepts = new Map<number, number>();
  // A straight generator parallel to the stowed strut stays straight when
  // deployed. Copying the compound belly onto it flared the upper fairing
  // through the separate wing door and the folding side-stay.
  const strutSkin: Surface = (station, z) => {
    let intercept = intercepts.get(station);
    if (intercept === undefined) {
      intercept = pivot.y - .22;
      for (let i = 0; i <= 36; i++) {
        const span = THREE.MathUtils.lerp(innerEdge, g.mainZ - .64, i / 36);
        intercept = Math.min(intercept, lower(station, span) - slope * (span - g.mainZ));
      }
      intercepts.set(station, intercept);
    }
    return intercept + slope * (z - g.mainZ);
  };
  const bodySkin: Surface = (station, z) => THREE.MathUtils.lerp(lower(station, z), strutSkin(station, z),
    smooth(z, innerEdge - .40, innerEdge - .012));
  const inner = panel("main-body-door", profile, side, pivot.x - reach, pivot.x + reach, .032,
    innerEdge - .012, bodySkin, "sequence", 90, [24, 40]);
  // Place the schematic straight hinge just below its curved closed rim.
  // The old axis followed the outer skin and sent the curved door through
  // its opposite-side partner. The contour itself is unchanged when shut.
  const bodyPositions = inner.getAttribute("position"), bodyAxis = inner.userData.gearDoor.axis as THREE.Vector3;
  let hingeDrop = 0;
  for (let i = 0; i < bodyPositions.count; i++) hingeDrop = Math.max(hingeDrop,
    bodyPositions.getX(i) * bodyAxis.y / bodyAxis.x - bodyPositions.getY(i));
  hingeDrop += .010;
  inner.translate(0, hingeDrop, 0);
  inner.userData.basePos.y -= hingeDrop;
  const wingJoint = g.mainZ - .64, outerHinge = g.mainZ + .48;
  // This running seam includes both shell returns and their oblique last
  // movement; a 24 mm total seam let the two solid rims overlap.
  const shield = panelShell("main-strut-door", side, pivot.x - .67, pivot.x + tandemLegAft,
    innerEdge + .012, wingJoint - .028, strutSkin, [24, 48]);
  shield.translate(-pivot.x, -pivot.y, -pivot.z).rotateX(-angle);
  Object.assign(shield.userData, { basePos: pivot, side, gearProfile: profile, retract: { axis: "x", angle } });
  const wingSkin: Surface = (station, z) => {
    const width = outerHinge - wingJoint, t = THREE.MathUtils.clamp((z - wingJoint) / width, 0, 1);
    const a = strutSkin(station, wingJoint), b = lower(station, outerHinge);
    const outgoing = (lower(station, outerHinge + .001) - lower(station, outerHinge - .001)) / .002;
    return THREE.MathUtils.lerp(a, b, t * t * (3 - 2 * t))
      + width * (slope * t * (1 - t) ** 2 + outgoing * t * t * (t - 1));
  };
  const wingDoor = panel("main-wing-door", profile, side, pivot.x - .67, pivot.x + tandemLegAft,
    outerHinge, wingJoint + .028, wingSkin, "wing-link", 45, [24, 24]);
  const parts = [inner, shield, wingDoor];
  const closedSkin: Surface = (station, z) => z < innerEdge ? bodySkin(station, z)
    : z < wingJoint ? strutSkin(station, z) : wingSkin(station, z);
  // One communicating cavity contains the truck, strut and folding side-stay.
  // A partition at the edge of the body door would cross the retracting tyres;
  // a narrow rectangular leg branch would also cut through the folded stay.
  parts.push(tandemWell(g, side, pivot, reach, lower, wellSkin), tandemBayShoulders(side, pivot.x, reach, innerEdge,
    outerHinge, lower, wellSkin, closedSkin));
  return parts;
}

function tandemWell(g: Gear, side: Side, pivot: THREE.Vector3, reach: number, lower: Surface, skin: WingWellSkin) {
  // The leg fairing's parked contour sits farther outboard than its closed
  // hinge. Keep the internal end wall outside that complete swept contour.
  const outer = g.mainZ + 1.04;
  const x0 = pivot.x - reach - .045, x1 = Math.min(pivot.x + reach + .045, skin.trailingEdge(outer) - .014);
  const roof: Surface = (x, z) => {
    // The truck sits in the fuselage beneath the cabin floor. Its ceiling is
    // allowed above the internal wing surface, then returns to the real wing
    // roof before reaching the pressure-shell side at 1.9 m half-width.
    const bodyRoof = pivot.y + g.mainWheelGap + g.mainTireW / 2 + .12;
    const wingRoof = skin.roof(x, z);
    return THREE.MathUtils.lerp(Math.max(bodyRoof, wingRoof), wingRoof, smooth(z, 1.65, 1.87));
  };
  const geometry = mainWellLiner(side, x0, x1, outer, roof, lower, 32, 64, false);
  geometry.userData.wingPocket = { x0, x1, z0: side === 1 ? 0 : -outer, z1: side === 1 ? outer : 0 };
  return geometry;
}

/** A continuous distance field supplies a rounded physical feather around the
 * broad truck aperture and the narrower strut aperture. The installed lower
 * surface already contains the wing/body transition; sampling it here keeps
 * the apron flush with all three closed panels instead of raising a miter. */
function tandemBayShoulders(side: Side, x: number, reach: number, innerEdge: number,
  outer: number, lower: Surface, skin: WingWellSkin, closedSkin: Surface) {
  type Point = [number, number];
  const seam = .012, feather = .30;
  const boxDistance = (dx: number, dz: number) => Math.hypot(Math.max(dx, 0), Math.max(dz, 0))
    + Math.min(Math.max(dx, dz), 0);
  const distance = (px: number, z: number) => {
    const body = boxDistance(Math.max(x - reach - seam - px, px - x - reach - seam), z - innerEdge - seam);
    const leg = boxDistance(Math.max(x - .67 - seam - px, px - x - tandemLegAft - seam),
      Math.max(innerEdge - seam - z, z - outer - seam));
    // Smoothing the union only opens the two inside corners. It never moves
    // fixed material into any part of a moving door's rectangular footprint.
    const blend = Math.max(.10 - Math.abs(body - leg), 0) / .10;
    return Math.min(body, leg) - blend * blend * .10 / 4;
  };
  const height = (px: number, z: number) => {
    const installed = lower(px, z) - .004;
    return Math.min(THREE.MathUtils.lerp(closedSkin(px, z) + .008, installed,
      smooth(distance(px, z), 0, feather)), installed);
  };
  const positions: number[] = [], normals: number[] = [], indices: number[] = [], shared = new Map<string, number>();
  const vertex = ([xx, span]: Point) => {
    const px = Math.fround(xx), z = Math.fround(span), key = `${px},${z}`;
    let i = shared.get(key);
    if (i !== undefined) return i;
    i = positions.length / 3;
    positions.push(px, height(px, z), side * z);
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
    polygon = clip(polygon, p => skin.trailingEdge(p[1]) - .014 - p[0]);
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
  const minX = x - reach - seam - feather, maxX = x + reach + seam + feather;
  const minZ = .032, maxZ = outer + seam + feather;
  const nx = Math.ceil((maxX - minX) / .035), nz = Math.ceil((maxZ - minZ) / .035);
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const a: Point = [THREE.MathUtils.lerp(minX, maxX, i / nx), THREE.MathUtils.lerp(minZ, maxZ, j / nz)];
    const b: Point = [THREE.MathUtils.lerp(minX, maxX, (i + 1) / nx), a[1]];
    const c: Point = [b[0], THREE.MathUtils.lerp(minZ, maxZ, (j + 1) / nz)], d: Point = [a[0], c[1]];
    append([a, b, c]); append([a, c, d]);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  geometry.name = "main-well-sill";
  Object.assign(geometry.userData, { side, basePos: new THREE.Vector3(), fixedWingBody: true, bellyPaint: true, smoothApron: true });
  return geometry;
}
