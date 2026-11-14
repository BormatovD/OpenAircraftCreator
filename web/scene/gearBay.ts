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

export function mainDoors(profile: GearProfile, g: Gear, side: Side, pivot: THREE.Vector3, lower: Surface, groundY: number, wellSkin: WingWellSkin) {
  if (profile === "a320") return airbusMainDoors(g, side, pivot, lower, groundY, wellSkin);
  if (profile === "b737") return boeing737MainDoors(g, side, pivot, lower, groundY, wellSkin);
  const reach = (g.axleSpacingM ?? 1) / 2 + g.mainR + .22;
  const innerEdge = profile === "b757" ? 1.65 : 1.73;
  const inner = panel("main-body-door", profile, side, pivot.x - reach, pivot.x + reach, .032, innerEdge - .012, lower, "sequence", 97);
  // The fairing bolted to the strut is built in its stowed contour and unrotated into the parked position.
  // On the 757 this upper piece represents the separate trunnion fairing door
  // (AMM D633N132 ATA 32, distinct from the main gear strut door, 32-12-04).
  // The outline and wing-linked motion remain an illustrative linkage on both
  // types. Letting this complete contour follow the leg would drive its upper
  // corner into the fixed skin in the parked pose.
  const wingJoint = g.mainZ - .64;
  const shield = panelShell("main-strut-door", side, pivot.x - .67, pivot.x + tandemLegAft, innerEdge + .012, wingJoint - .012, lower);
  const angle = side * mainTravelAngle(profile, g);
  shield.translate(-pivot.x, -pivot.y, -pivot.z).rotateX(-angle);
  Object.assign(shield.userData, { basePos: pivot, side, gearProfile: profile, retract: { axis: "x", angle } });
  const parts = [inner, shield];
  parts.push(panel("main-wing-door", profile, side, pivot.x - .67, pivot.x + tandemLegAft,
    g.mainZ + .18, wingJoint + .012, lower, "wing-link", 83));
  // One communicating cavity contains the truck, strut and folding side-stay.
  // A partition at the edge of the body door would cross the retracting tyres;
  // a narrow rectangular leg branch would also cut through the folded stay.
  parts.push(tandemWell(g, side, pivot, reach, lower, wellSkin), tandemBayShoulders(side, pivot.x, reach, innerEdge,
    g.mainZ + .18, lower, wellSkin));
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

/** Fixed shoulders join the broad truck opening to the narrower strut opening.
 * They belong to the wing/body skin, rather than to the retracting assembly.
 * Shared corner mitres leave no triangular gaps at the stepped jambs. */
function tandemBayShoulders(side: Side, x: number, reach: number, innerEdge: number,
  outer: number, lower: Surface, skin: WingWellSkin) {
  const perimeter = [[x - reach, .032], [x + reach, .032], [x + reach, innerEdge],
    [x + tandemLegAft, innerEdge], [x + tandemLegAft, outer], [x - .67, outer],
    [x - .67, innerEdge], [x - reach, innerEdge]];
  const normals = perimeter.map(([xx, z], i) => {
    const [nx, nz] = perimeter[(i + 1) % perimeter.length], length = Math.hypot(nx - xx, nz - z);
    return [(nz - z) / length, (xx - nx) / length];
  });
  const mitres = normals.map(([nx, nz], i) => {
    const previous = normals[(i + normals.length - 1) % normals.length];
    return [nx + previous[0], nz + previous[1]];
  });
  const positions: number[] = [], indices: number[] = [];
  for (let i = 1; i < perimeter.length; i++) {
    const next = (i + 1) % perimeter.length;
    const point = (u: number, v: number) => {
      const xx = THREE.MathUtils.lerp(perimeter[i][0], perimeter[next][0], u);
      const z = THREE.MathUtils.lerp(perimeter[i][1], perimeter[next][1], u);
      const width = .012 + .28 * v;
      let px = xx + width * THREE.MathUtils.lerp(mitres[i][0], mitres[next][0], u);
      const pz = Math.max(.032, z + width * THREE.MathUtils.lerp(mitres[i][1], mitres[next][1], u));
      if (pz > 1.9) px = Math.min(px, skin.trailingEdge(pz) - .014);
      // Only the outboard lip returns to the wing. The inboard shoulders stay
      // on the belly/fairing contour instead of rising through the fuselage.
      const wingBlend = smooth(pz, innerEdge, innerEdge + .35);
      const shell = THREE.MathUtils.lerp(lower(px, pz), skin.lower(px, pz), wingBlend);
      return [px, THREE.MathUtils.lerp(lower(xx, z), shell, smooth(v, 0, 1)) + .006, side * pz];
    };
    const start = positions.length / 3, rows = 5;
    for (let u = 0; u <= 12; u++) for (let v = 0; v <= rows; v++) positions.push(...point(u / 12, v / rows));
    for (let u = 0; u < 12; u++) for (let v = 0; v < rows; v++) {
      const a = start + u * (rows + 1) + v, b = a + rows + 1;
      if (side === 1) indices.push(a, b, b + 1, a, b + 1, a + 1);
      else indices.push(a, b + 1, b, a, a + 1, b + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.name = "main-well-sill";
  Object.assign(geometry.userData, { side, basePos: new THREE.Vector3(), fixedWingBody: true, bellyPaint: true });
  return geometry;
}
