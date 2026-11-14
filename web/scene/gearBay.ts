import * as THREE from "three";
import { wellLiner } from "./gearOpenings.ts";
import type { ShapeSet } from "./shapeSet.ts";

export type GearProfile = "b757" | "tu214";
export function bayProfile(id: string): GearProfile | undefined {
  return id === "b757" || id === "tu214" ? id : undefined;
}
type Gear = ShapeSet["gear"];
type Side = -1 | 1;
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const zAxis = v(0, 0, 1);
const rad = THREE.MathUtils.degToRad;
// The old Tu-214 sketch stopped short of the enclosed well; rotate to horizontal
// to clear the closed panel without changing the parked footprint or leg length.
export const mainTravelAngle = (profile: GearProfile | undefined, gear: Gear) =>
  rad(profile === "tu214" ? 90 : gear.retractDeg);
const smooth = (x: number, from: number, to: number) => THREE.MathUtils.smoothstep(x, from, to);
// Fractions of a review stroke, not elapsed time or rigging settings.
export function gearLegTravel(profile: string | undefined, up: number): number {
  return profile && bayProfile(profile) ? smooth(up, .17, .83) : up;
}
type DoorDrive = "sequence" | "nose-link-front" | "nose-link-aft" | "wing-link";
type DoorMotion = { axis: THREE.Vector3; angle: number; drive: DoorDrive };
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
    case "wing-link":
      return 1 - travel;
  }
}

const tiltQ = new THREE.Quaternion(), delta = new THREE.Vector3();

/** Called after restoring the assembly position and the basic retraction quaternion. */
export function applyGearBayPose(mesh: THREE.Mesh, up: number, unloaded: number): void {
  const { gearDoor, gearBogie, gearProfile } = mesh.geometry.userData;
  if (gearDoor) {
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

type Surface = (x: number, absZ: number) => number;
// A rigid two-sided shell follows the closed skin, with a narrow return around its perimeter.
// The shell has thickness; both the interior and the outside remain visible with back-face culling.
function panel(name: string, profile: GearProfile, side: Side,
  x0: number, x1: number, hingeZ: number, edgeZ: number, lower: Surface,
  drive: DoorDrive, degrees: number) {
  const origin = v(x0, lower(x0, hingeZ), side * hingeZ);
  const axis = v(x1 - x0, lower(x1, hingeZ) - origin.y, 0).normalize();
  const g = panelShell(name, side, x0, x1, hingeZ, edgeZ, lower);
  g.translate(-origin.x, -origin.y, -origin.z);
  Object.assign(g.userData, {
    basePos: origin, side, gearProfile: profile, gearDoor: {
      axis, drive, angle: rad(degrees) * side * Math.sign(edgeZ - hingeZ)
    } satisfies DoorMotion
  });
  return g;
}
function panelShell(name: string, side: Side, x0: number, x1: number, z0: number, z1: number, lower: Surface) {
  const pos: number[] = [], idx: number[] = [];
  const nx = 6, nz = 8, span = (nx + 1) * (nz + 1), row = nz + 1;
  for (let face = 0; face < 2; face++) {
    for (let ix = 0; ix <= nx; ix++) {
      for (let iz = 0; iz <= nz; iz++) {
        const x = THREE.MathUtils.lerp(x0, x1, ix / nx), z = THREE.MathUtils.lerp(z0, z1, iz / nz);
        pos.push(x, lower(x, z) + face * .026, side * z);
      }
    }
  }
  const quad = (a: number, b: number, c: number, d: number) => { idx.push(a, b, c, a, c, d); };
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const a = i * row + j, b = a + row;
      quad(a, b, b + 1, a + 1);
      quad(a + span, a + 1 + span, b + 1 + span, b + span);
    }
  }
  for (let i = 0; i < nx; i++) {
    const a = i * row, b = a + row;
    quad(a, a + span, b + span, b);
    quad(a + nz, b + nz, b + nz + span, a + nz + span);
  }
  for (let j = 0; j < nz; j++) {
    const a = nx * row + j;
    quad(j, j + 1, j + 1 + span, j + span);
    quad(a, a + span, a + 1 + span, a + 1);
  }
  if (side * (z1 - z0) < 0) for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Static rim is slightly inset under the door; the hinge side and centre seam stay supported.
  const margin = .024;
  g.userData.bayOpening = {
    x0: x0 + margin, x1: x1 - margin,
    z0: Math.min(side * z0, side * z1) + margin, z1: Math.max(side * z0, side * z1) - margin
  };
  g.name = name;
  g.userData.tone = "detailPanel";
  return g;
}

export function noseDoors(profile: GearProfile, g: Gear, pivot: THREE.Vector3, lower: Surface) {
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

export function mainDoors(profile: GearProfile, g: Gear, side: Side, pivot: THREE.Vector3, lower: Surface) {
  const reach = (g.axleSpacingM ?? 1) / 2 + g.mainR + .22;
  const innerEdge = profile === "b757" ? 1.65 : 1.73;
  const inner = panel("main-body-door", profile, side, pivot.x - reach, pivot.x + reach, .032, innerEdge - .012, lower, "sequence", 97);
  // The fairing bolted to the strut is built in its stowed contour and unrotated into the parked position.
  const wingJoint = profile === "b757" ? g.mainZ + .16 : g.mainZ - .64;
  const shield = panelShell("main-strut-door", side, pivot.x - .67, pivot.x + .63, innerEdge + .012, wingJoint - .012, lower);
  const angle = side * mainTravelAngle(profile, g);
  shield.translate(-pivot.x, -pivot.y, -pivot.z).rotateX(-angle);
  Object.assign(shield.userData, { basePos: pivot, side, gearProfile: profile, retract: { axis: "x", angle } });
  const parts = [inner, shield];
  if (profile === "tu214") parts.push(panel("main-wing-door", profile, side, pivot.x - .67, pivot.x + .63,
    g.mainZ + .18, wingJoint + .012, lower, "wing-link", 83));
  // The centre-section recess contains the truck. Its outer branch runs under the fixed wing.
  const well = wellLiner("main-wheel-well", pivot.x - reach - .02, pivot.x + reach + .02,
    innerEdge + .10, (x, z) => lower(x, Math.abs(z)) + THREE.MathUtils.lerp(2.05, .48, smooth(Math.abs(z), 1.2, innerEdge + .10)), lower, side);
  const wingWell = wellLiner("main-leg-well", pivot.x - .70, pivot.x + .66, g.mainZ + .2,
    (x, z) => lower(x, Math.abs(z)) + .18, lower, side, innerEdge + .09);
  parts.push(well, wingWell);
  return parts;
}
