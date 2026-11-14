import * as THREE from "three";
import { panel, panelShell, type Surface, type DoorDrive, type DoorMotion } from "./gearDoors.ts";
import { wellLiner } from "./gearOpenings.ts";
import { airbusMainDoors, airbusNoseDoors } from "./airbusGear.ts";
import { applyBoeing737GearPose, boeing737MainDoors, boeing737NoseDoors } from "./boeing737Gear.ts";
import type { ShapeSet } from "./shapeSet.ts";

export type GearProfile = ShapeSet["id"];
type Gear = ShapeSet["gear"];
type Side = -1 | 1;
const zAxis = new THREE.Vector3(0, 0, 1);
const rad = THREE.MathUtils.degToRad;
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
    case "wing-link":
      return 1 - travel;
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

export function mainDoors(profile: GearProfile, g: Gear, side: Side, pivot: THREE.Vector3, lower: Surface, groundY: number) {
  if (profile === "a320") return airbusMainDoors(g, side, pivot, lower, groundY);
  if (profile === "b737") return boeing737MainDoors(g, side, pivot, lower, groundY);
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
