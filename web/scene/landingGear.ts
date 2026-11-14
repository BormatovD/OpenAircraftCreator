import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { ShapeSet } from "./shapeSet.ts";

type Gear = ShapeSet["gear"];
type Side = -1 | 1;
type Retraction = { axis: "x" | "z"; angle: number };
type Brace = { pin: THREE.Vector3; anchor: THREE.Vector3; downElbow: THREE.Vector3; retraction: Retraction; upper: boolean };

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const yAxis = v(0, 1, 0);
const hingeAxes = { x: v(1, 0, 0), z: v(0, 0, 1) };

function join(role: string, tone: string, parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const geometry = parts.length === 1 ? parts[0] : mergeGeometries(parts.map(p => p.index ? p.toNonIndexed() : p))!;
  geometry.name = role;
  geometry.userData.tone = tone;
  return geometry;
}

function rod(a: THREE.Vector3, b: THREE.Vector3, radius: number, segments = 12) {
  const axis = b.clone().sub(a);
  const geometry = new THREE.CylinderGeometry(radius, radius, axis.length(), segments);
  geometry.translate(0, axis.length() / 2, 0);
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(yAxis, axis.normalize()));
  return geometry.translate(a.x, a.y, a.z);
}

// Wheel sections are normal to the axle. The crown sets the exact nominal tyre radius.
// Tread grooves, brake stack and hub flanges are illustrative at this scale.
function wheel(radius: number, width: number, center: THREE.Vector3, face: Side, braked: boolean) {
  const ring = (profile: [number, number][]) => {
    const geometry = new THREE.LatheGeometry(profile.map(([r, z]) => new THREE.Vector2(r * radius, z * width)), 40);
    geometry.rotateX(Math.PI / 2);
    return geometry.translate(center.x, center.y, center.z);
  };
  const halfTread: [number, number][] = [
    [.52, -.42], [.64, -.50], [.84, -.49], [.94, -.41], [.98, -.32],
    [.988, -.24], [.974, -.225], [.974, -.205], [.993, -.19], [.997, -.085],
    [.979, -.072], [.979, -.052], [.998, -.039], [1, 0],
  ];
  const secondHalf = halfTread.slice(0, -1).reverse().map(([r, z]): [number, number] => [r, -z]);
  const casing = ring([...halfTread, ...secondHalf, halfTread[0]]);
  const rim = ring([[.26, -.30], [.50, -.37], [.54, -.42], [.55, -.40], [.53, -.34],
  [.53, .34], [.55, .40], [.54, .42], [.50, .37], [.26, .30], [.26, -.30]]);
  const faceZ = center.z + face * .30 * width;
  const hub = rod(v(center.x, center.y, faceZ - face * .22 * width), v(center.x, center.y, faceZ + face * .11 * width), radius * .25, 32);
  const spokes: THREE.BufferGeometry[] = [rim, hub];
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    const spoke = (r: number, z: number) => v(center.x + r * radius * Math.cos(a), center.y + r * radius * Math.sin(a), center.z + z * face * width);
    spokes.push(rod(spoke(.21, .31), spoke(.50, .35), radius * .045, 8));
  }
  const pieces = [join("tyre", "gearRubber", [casing]), join("wheel-hub", "detailSteel", spokes)];
  if (braked) {
    const inner = center.z - face * .36 * width;
    const rotors = [-.06, .02, .10].map(offset => {
      const z = inner - face * offset * width;
      return rod(v(center.x, center.y, z - .027 * width), v(center.x, center.y, z + .027 * width), radius * .46, 32);
    });
    pieces.push(join("wheel-brake", "detailDark", rotors));
  }
  return pieces;
}

function bearing(pin: THREE.Vector3, r: number, halfWidth: number) {
  return rod(v(pin.x, pin.y, pin.z - halfWidth), v(pin.x, pin.y, pin.z + halfWidth), r, 16);
}

function forkLinks(length: number, gauge: number) {
  const pin = (a: number, b: number) => v(a * gauge, b * length, 0);
  const pins = [pin(-.095, -.60), pin(-.32, -.79), pin(-.075, -.94)];
  const links: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    const z = side * gauge * .085;
    const [a, b, c] = pins.map(p => v(p.x, p.y, z));
    links.push(rod(a, b, gauge * .034), rod(b, c, gauge * .034));
  }
  links.push(...pins.map(p => bearing(p, .048 * gauge, .115 * gauge)));
  return join("torque-links", "detailSteel", links);
}

function bracePair(anchor: THREE.Vector3, pin: THREE.Vector3, elbow: THREE.Vector3, gauge: number, retraction: Retraction) {
  return [true, false].map(upper => {
    const a = upper ? anchor : elbow, b = upper ? elbow : pin;
    const g = join(upper ? "upper-stay" : "lower-stay", "detailPanel", [
      rod(a, b, gauge * (upper ? .048 : .040)), bearing(a, gauge * .064, gauge * .083),
      ...(upper ? [] : [bearing(b, gauge * .064, gauge * .082)]),
    ]);
    g.userData.gearBrace = { pin, anchor, downElbow: elbow, retraction, upper } satisfies Brace;
    return g;
  });
}

const pinNow = new THREE.Vector3(), line = new THREE.Vector3(), bend = new THREE.Vector3();
const elbowNow = new THREE.Vector3(), oldDir = new THREE.Vector3(), newDir = new THREE.Vector3(), shift = new THREE.Vector3();

/** Two fixed-length links stay attached to the airframe and the retracting strut.
 * The middle joint follows the chosen folding side of the two-sphere intersection.
 * Called after the normal exploded-view translation has been applied to the mesh. */
export function applyGearBracePose(mesh: THREE.Mesh, gearUp: number): void {
  const { pin, anchor, downElbow, retraction, upper } = mesh.geometry.userData.gearBrace as Brace;
  mesh.quaternion.identity();
  pinNow.copy(pin).applyAxisAngle(hingeAxes[retraction.axis], gearUp * retraction.angle);
  line.subVectors(pinNow, anchor);
  const distance = line.length();
  if (distance < 1e-8) return;
  line.divideScalar(distance);
  const a = anchor.distanceTo(downElbow), b = pin.distanceTo(downElbow);
  const along = (a * a - b * b + distance * distance) / (2 * distance);
  bend.subVectors(downElbow, anchor).addScaledVector(line, -bend.dot(line));
  const height = Math.sqrt(Math.max(0, a * a - along * along));
  elbowNow.copy(anchor).addScaledVector(line, along).addScaledVector(bend.normalize(), height);
  const start = upper ? anchor : downElbow, target = upper ? anchor : elbowNow;
  oldDir.subVectors(upper ? downElbow : pin, start).normalize();
  newDir.subVectors(upper ? elbowNow : pinNow, target).normalize();
  mesh.quaternion.setFromUnitVectors(oldDir, newDir);
  shift.copy(start).applyQuaternion(mesh.quaternion);
  mesh.position.add(target).sub(shift);
  if (retraction.axis === "z") mesh.visible = gearUp < .97;
}

export function mainLandingGear(g: Gear, side: Side, pivot: THREE.Vector3, ground: number, anchorY: number, tandem: boolean) {
  const length = pivot.y - ground - g.mainR;
  const gauge = g.mainR / .584;
  const retract: Retraction = { axis: "x", angle: side * THREE.MathUtils.degToRad(g.retractDeg) };
  const p = (h: number) => v(0, -length * h, 0);
  const axleXs = tandem && g.axleSpacingM ? [-g.axleSpacingM / 2, g.axleSpacingM / 2] : [0];
  const leg = [
    join("main-strut", "detailPanel", [rod(p(0), p(.66), .142 * gauge, 24), rod(p(.62), p(.68), .165 * gauge, 24),
    rod(v(-.25 * gauge, 0, 0), v(.25 * gauge, 0, 0), .125 * gauge, 18)]),
    join("oleo-piston", "detailSteel", [rod(p(.67), p(.98), .10 * gauge, 24)]),
    forkLinks(length, gauge),
  ];
  if (axleXs.length === 2) {
    const [front, rear] = axleXs;
    const y = -length + .11 * gauge;
    leg.push(join("bogie-beam", "detailPanel", [rod(v(front, y, 0), v(rear, y, 0), .115 * gauge, 16),
    bearing(v(0, y, 0), .145 * gauge, .15 * gauge)]));
  }
  for (const x of axleXs) {
    const axle = v(x, -length, 0);
    leg.push(join("axle", "detailSteel", [bearing(axle, .082 * gauge, g.mainWheelGap)]));
    for (const k of [-1, 1] as const) leg.push(...wheel(g.mainR, g.mainTireW, v(x, -length, k * g.mainWheelGap), k, true));
  }
  for (const part of leg) Object.assign(part.userData, { basePos: pivot, side, retract });
  const anchor = v(.09 * gauge, anchorY - pivot.y, -side * 1.35 * (g.mainZ / 3.795));
  const pin = v(0, -.53 * length, 0);
  const elbow = anchor.clone().lerp(pin, .5).add(v(.18 * gauge, -.07 * gauge, 0));
  const stays = bracePair(anchor, pin, elbow, gauge, retract);
  for (const part of stays) Object.assign(part.userData, { side, basePos: pivot });
  return [...leg, ...stays];
}

export function noseLandingGear(g: Gear, ground: number) {
  const length = g.noseLegM, rake = THREE.MathUtils.degToRad(g.rakeDeg);
  const gauge = g.noseR / .381;
  const gap = g.noseWheelGap ?? .3, width = g.noseTireW ?? .22;
  const pivot = v(g.noseX + length * Math.sin(rake), ground + g.noseR + length * Math.cos(rake), 0);
  const retract: Retraction = { axis: "z", angle: -THREE.MathUtils.degToRad(92) };
  const p = (h: number) => v(0, -length * h, 0);
  const forkSpread = Math.min(.14 * gauge, gap - width * .5 - .015);
  const strut = join("nose-strut", "detailPanel", [rod(p(0), p(.57), .107 * gauge, 24),
  rod(p(.49), p(.57), .133 * gauge, 24), bearing(p(0), .09 * gauge, .18 * gauge)]);
  const fork: THREE.BufferGeometry[] = [bearing(p(1), .06 * gauge, gap)];
  for (const k of [-1, 1]) {
    fork.push(rod(p(.77), v(0, -length * .86, k * forkSpread), .055 * gauge),
      rod(v(0, -length * .86, k * forkSpread), v(0, -length, k * forkSpread), .055 * gauge));
  }
  const leg = [strut, join("oleo-piston", "detailSteel", [rod(p(.55), p(.83), .073 * gauge, 24)]),
    join("axle-fork", "detailPanel", fork), forkLinks(length, .70 * gauge)];
  for (const part of leg) part.rotateZ(-rake);
  // Position the wheels after strut rake so the discretised tyre crown still contacts the ground.
  const axle = p(1).applyAxisAngle(hingeAxes.z, -rake);
  for (const k of [-1, 1] as const) leg.push(...wheel(g.noseR, width, v(axle.x, axle.y, k * gap), k, false));
  for (const part of leg) Object.assign(part.userData, { basePos: pivot, retract });
  const pin = p(.52).applyAxisAngle(hingeAxes.z, -rake);
  const anchor = v(-length * .66, .04 * length, 0);
  const elbow = anchor.clone().lerp(pin, .5).add(v(0, 0, .12 * gauge));
  const stays = bracePair(anchor, pin, elbow, gauge * .75, retract);
  for (const part of stays) part.userData.basePos = pivot;
  return [...leg, ...stays];
}
