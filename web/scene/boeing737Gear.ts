import * as THREE from "three";
import { panel, panelShell, type Surface } from "./gearDoors.ts";
import { wellLiner } from "./gearOpenings.ts";
import type { ShapeSet } from "./shapeSet.ts";

type Gear = ShapeSet["gear"];
type Side = -1 | 1;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const X = V(1, 0, 0), rad = THREE.MathUtils.degToRad;

function capPoint(g: Gear, y: number, x: number, ground: number, a: number) {
  const h = y - ground - g.mainR, axle = g.mainWheelGap + .44 * g.mainTireW;
  return V(x, y - h * Math.cos(a) - axle * Math.sin(a),
    g.mainZ - h * Math.sin(a) + axle * Math.cos(a));
}

/** Visual stop set from the installed shell and the outboard wheel face, not a rigging angle. */
export function boeing737StowAngle(g: Gear, pivotY: number, x: number, ground: number, lower: Surface) {
  let low = rad(48), high = rad(89.5);
  for (let j = 0; j < 28; j++) {
    const a = (low + high) / 2, face = capPoint(g, pivotY, x, ground, a);
    if (face.y < lower(x, face.z) + .015) low = a; else high = a;
  }
  // A narrow-track Classic also needs a positive gap between both *inboard* tyres.
  // A circumscribed cylinder is conservative with respect to their rounded shoulders.
  const length = pivotY - ground - g.mainR;
  const centrelineGap = (a: number) => g.mainZ - (length + g.mainR) * Math.sin(a)
    - (g.mainWheelGap + .5 * g.mainTireW) * Math.cos(a);
  const seated = (low + high) / 2;
  if (centrelineGap(seated) > .012) return THREE.MathUtils.radToDeg(seated);
  low = rad(45); high = seated;
  for (let j = 0; j < 28; j++) {
    const a = (low + high) / 2;
    if (centrelineGap(a) < .012) high = a; else low = a;
  }
  return THREE.MathUtils.radToDeg((low + high) / 2);
}

function mesh(name: string, positions: number[], indices: number[], tone: string, side: Side) {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  geom.name = name;
  Object.assign(geom.userData, { side, basePos: V(), tone, gearProfile: "b737" });
  return geom;
}
function roundWell(g: Gear, side: Side, pivot: THREE.Vector3, lower: Surface, ground: number) {
  const a = rad(g.retractDeg), cap = capPoint(g, pivot.y, pivot.x, ground, a);
  const n = 48, ca = Math.cos(a), sa = Math.sin(a), r = g.mainR + .045;
  const oval = (i: number, radius: number) => {
    const t = i / n * Math.PI * 2;
    return { x: cap.x + radius * Math.cos(t), z: side * (cap.z + radius * Math.sin(t) * sa) };
  };
  const classic = g.boeing737Series === "classic";
  const shoulder = classic ? .88 : .95;
  // Axial offset from capPoint's 44%-width reference to this point on the tyre profile.
  const lipOffset = (classic ? -.038 : .043) * g.mainTireW;
  const polygon = Array.from({ length: n }, (_, i) => oval(i, r));
  const pos: number[] = [], ix: number[] = [], walls: number[] = [], iw: number[] = [];
  const idx = (out: number[], a: number, b: number, c: number) =>
    side > 0 ? out.push(a, b, c) : out.push(c, b, a);
  const depth = 2 * g.mainWheelGap + g.mainTireW + .28;
  const top = V(cap.x, cap.y + depth / sa, side * (cap.z - depth * ca));
  for (let i = 0; i < n; i++) {
    const { x, z } = polygon[i], outer = oval(i, r + .040);
    // The flexible seal bears near the shoulder, not the maximum radius of the tyre.
    // It masks the sight-line to the strut through the annulus around the hub.
    const t = i / n * Math.PI * 2;
    const lip = oval(i, shoulder * g.mainR);
    const lipY = cap.y + shoulder * g.mainR * ca * Math.sin(t) + (g.mainR < .53 ? -.038 : .043) * g.mainTireW * sa - .006;
    lip.z -= side * (g.mainR < .53 ? -.038 : .043) * g.mainTireW * ca;
    const y = lower(x, Math.abs(z));
    pos.push(outer.x, lower(outer.x, Math.abs(outer.z)) - .002, outer.z,
      x, y - .008, z, lip.x, lipY, lip.z);
    const j = (i + 1) % n;
    for (let row = 0; row < 2; row++) {
      idx(ix, i * 3 + row, j * 3 + row, j * 3 + row + 1);
      idx(ix, i * 3 + row, j * 3 + row + 1, i * 3 + row + 1);
    }
    // The two tyres sit one behind the other along the axle. Widen the chamber above
    // the lip; the shared centre bay is open inboard and at the leg aperture.
    const above = .14;
    walls.push(x, y + .020, z, top.x + (r + above) * Math.cos(t),
      top.y, top.z + side * (r + above) * Math.sin(t));
    if (Math.abs(Math.sin((i + .5) / n * Math.PI * 2)) < .84) {
      idx(iw, i * 2, i * 2 + 1, j * 2 + 1); idx(iw, i * 2, j * 2 + 1, j * 2);
    }
  }
  walls.push(...top.toArray());
  for (let i = 0; i < n; i++) idx(iw, 2 * n, 2 * i + 1, 2 * ((i + 1) % n) + 1);
  const seal = mesh("main-wheel-port-seal", pos, ix, "gearRubber", side);
  seal.userData.bayOpening = {
    x0: cap.x - r, x1: cap.x + r,
    z0: side * cap.z - r * sa, z1: side * cap.z + r * sa, polygon
  };
  const well = mesh("main-wheel-well", walls, iw, "detailDark", side); well.userData.gearWell = true;
  return { seal, well, cap, r };
}

function fixedToLeg(geom: THREE.BufferGeometry, pivot: THREE.Vector3, side: Side, angle: number) {
  geom.translate(-pivot.x, -pivot.y, -pivot.z).rotateX(-angle);
  Object.assign(geom.userData, { side, basePos: pivot, gearProfile: "b737", retract: { axis: "x", angle } });
  return geom;
}

export function boeing737MainDoors(g: Gear, side: Side, pivot: THREE.Vector3, lower: Surface, ground: number) {
  const { seal, well, cap, r } = roundWell(g, side, pivot, lower, ground);
  const a = rad(g.retractDeg), angle = side * a, x = pivot.x;
  // The wing skin in this mesh ends at the spar on the Classic. The actual
  // shock strut pivots on the trunnion support beam aft of that spar (AMM 32-11).
  const doorSkin: Surface = (xx, z) => {
    const axisY = pivot.y + Math.min(0, z - g.mainZ) / Math.tan(a);
    const needed = axisY - .186 * g.mainR / .584 / Math.sin(a) - .014;
    return Math.min(lower(xx, z), needed);
  };
  const width = g.mainR * .76; // strut slot, not a door over the wheel
  // Butt the curved inner edge against the circular opening, leaving the tyre face exposed.
  const tireEnd = (xx: number) => cap.z + Math.sqrt(Math.max(0, r * r - (xx - x) ** 2)) * Math.sin(a) - .015;
  const boundary = tireEnd(x), wingHinge = g.mainZ + .18;
  const lowerHinge = THREE.MathUtils.lerp(boundary, wingHinge, .34);
  const upperHinge = THREE.MathUtils.lerp(boundary, wingHinge, .76);
  const x0 = x - width, x1 = x + width;
  const wing = panel("main-wing-door", "b737", side, x0, x1, wingHinge, upperHinge + .003, doorSkin, "wing-link", 79);
  const centre = fixedToLeg(panelShell("main-strut-door", side, x0, x1, lowerHinge + .003,
    upperHinge - .003, doorSkin), pivot, side, angle);
  const inner = panelShell("main-inner-door", side, x0, x1, boundary, lowerHinge - .003, doorSkin);
  // Cut to the port arc at each chordwise station; the common panel helper builds a regular grid.
  const p = inner.getAttribute("position");
  for (let i = 0; i < p.count; i++) {
    const xx = p.getX(i), z = side * p.getZ(i), t = (z - boundary) / (lowerHinge - .003 - boundary);
    const zz = THREE.MathUtils.lerp(tireEnd(xx), lowerHinge - .003, t);
    p.setXYZ(i, xx, p.getY(i) + doorSkin(xx, zz) - doorSkin(xx, z), side * zz);
  }
  inner.computeVertexNormals();
  // One cut against the round port, rather than leaving fixed skin between three moving doors.
  const arc: { x: number; z: number }[] = [];
  for (let i = 0; i <= 12; i++) {
    const xx = THREE.MathUtils.lerp(x0 + .018, x1 - .018, i / 12);
    arc.push({ x: xx, z: side * (tireEnd(xx) - .022) });
  }
  // A rectangle slightly overlapping the port gives the concave arc as a union of convex openings.
  const slot = {
    x0: x0 + .018, x1: x1 - .018, z0: Math.min(side * wingHinge, ...arc.map(p => p.z)),
    z1: Math.max(side * wingHinge, ...arc.map(p => p.z))
  };
  inner.userData.bayOpening = slot;
  delete wing.userData.bayOpening; delete centre.userData.bayOpening;
  fixedToLeg(inner, pivot, side, angle);
  const localClosedPin = V(x, doorSkin(x, lowerHinge - .003), side * (lowerHinge - .003)).sub(pivot);
  inner.userData.inner737 = { localClosedPin, angle, side };
  const legWell = wellLiner("main-leg-well", x0 - .01, x1 + .01, wingHinge + .008,
    (xx, z) => Math.max(lower(xx, Math.abs(z)) + .30, pivot.y + .26), lower, side, Math.min(...arc.map(pt => Math.abs(pt.z))));
  // Stationary beam fairing around the strut slot: between the rear spar / flap end
  // and aft trunnion. Fair the shell into the wing; taper the aft end to avoid
  // adding a rectangular plate behind the Classic trailing edge.
  const forwardReach = g.boeing737Series === "classic" ? 1.20 : .65;
  const frameAt = (xx: number, z: number) => {
    const chordT = THREE.MathUtils.clamp((xx - x0) / (x1 - x0), 0, 1);
    const z0 = upperHinge - .14 + .10 * chordT, z1 = wingHinge + .07 + .11 * (1 - chordT);
    return { z0, z1, y: doorSkin(xx, z) };
  };
  const outside: number[] = [], fi: number[] = [];
  const patch = (nx: number, nz: number, f: (u: number, v: number) => THREE.Vector3) => {
    const start = outside.length / 3;
    for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) outside.push(...f(i / nx, j / nz).toArray());
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const a = start + i * (nz + 1) + j, b = a + nz + 1;
      if (side === 1) fi.push(a, b, b + 1, a, b + 1, a + 1); else fi.push(a, b + 1, b, a, a + 1, b + 1);
    }
  };
  const face = (xx: number, z: number, depth: number) => V(xx, doorSkin(xx, z) + depth, side * z);
  // Leading bridge: from the trailing-edge structure to the door jamb.
  patch(8, 8, (u, v) => {
    const xx = THREE.MathUtils.lerp(x - forwardReach, x0, u), { z0, z1 } = frameAt(xx, wingHinge);
    const z = THREE.MathUtils.lerp(z0 - .09 * (1 - u), z1 + .09 * (1 - u), v);
    return face(xx, z, (1 - u) * (lower(xx, z) - doorSkin(xx, z)) + .007);
  });
  // A tapered aft lip returns to a closed section instead of a floating trailing edge.
  patch(4, 8, (u, v) => {
    const xx = x1 + u * .10 * (1 - .65 * v), { z0, z1 } = frameAt(xx, wingHinge);
    return face(xx, THREE.MathUtils.lerp(z0 + .04 * u, z1 - .04 * u, v), u * .095 + .006);
  });
  patch(8, 3, (u, v) => {
    const xx = THREE.MathUtils.lerp(x0, x1, u), { z1 } = frameAt(xx, wingHinge);
    return face(xx, THREE.MathUtils.lerp(wingHinge - .002, z1, v), .005 + .060 * v * v);
  });
  // Upper halves / returns enclose the trunnion and give the fixed beam depth.
  patch(12, 6, (u, v) => {
    const xx = THREE.MathUtils.lerp(x - forwardReach, x1 + .032, u), { z0, z1 } = frameAt(xx, wingHinge);
    const z = THREE.MathUtils.lerp(z1, z0, v);
    return face(xx, z, .12 + .07 * Math.sin(Math.PI * v));
  });
  for (const k of [0, 1]) patch(12, 2, (u, v) => {
    const xx = THREE.MathUtils.lerp(x - forwardReach, x1 + .032, u), { z0, z1 } = frameAt(xx, wingHinge);
    const z = k ? z1 : z0;
    // The inboard sidewall stops at the actual door opening.
    const lip = k ? .065 : xx >= x0 && xx <= x1 ? .117 : .011;
    return face(xx, z, THREE.MathUtils.lerp(lip, .125, v));
  });
  const frame = mesh("main-trunnion-support-fairing", outside, fi, "detailPanel", side);
  // Only an OUTBOARD hubcap, moving with its wheel; never a panel closing the tyre port.
  const cover = new THREE.LatheGeometry([[0, .47], [.20, .47], [.45, .445], [.53, .41], [.535, .38]]
    .map(([rr, zz]) => new THREE.Vector2(g.mainR * rr, g.mainTireW * zz)), 40);
  cover.rotateX(side * Math.PI / 2);
  cover.translate(0, ground + g.mainR - pivot.y, side * g.mainWheelGap);
  cover.name = "outboard-wheel-hubcap";
  Object.assign(cover.userData, { side, tone: "detailPanel", basePos: pivot, gearProfile: "b737", retract: { axis: "x", angle } });
  const parts = [wing, centre, inner, seal, well, legWell, frame, cover];
  if (g.boeing737Series === "max") {
    // The MAX inner fairing has two metal pieces joined along the strut, not two
    // independently actuated doors. The narrow lap follows the same hinge as the skin.
    const xx = x + .08;
    const lap = panelShell("main-inner-fairing-lap", side, xx - .008, xx + .008,
      tireEnd(xx) + .005, lowerHinge - .014, (x, z) => doorSkin(x, z) - .004);
    delete lap.userData.bayOpening;
    fixedToLeg(lap, pivot, side, angle);
    lap.userData.inner737 = inner.userData.inner737;
    lap.userData.tone = "detailSteel";
    parts.push(lap);
  }
  return parts;
}

/** The inner panel hinges to the middle (strut-mounted) panel. Its pushrod produces
 * a small additional fold as the side stay comes out of the bay, rather than another body-fixed hinge. */
export function applyBoeing737GearPose(mesh: THREE.Mesh, legTravel: number) {
  const m = mesh.geometry.userData.inner737;
  if (!m) return;
  const fold = m.side * rad(-12) * (1 - legTravel), turn = m.angle * legTravel;
  const pin = (m.localClosedPin as THREE.Vector3).clone().applyAxisAngle(X, -m.angle);
  const shift = pin.clone().sub(pin.clone().applyAxisAngle(X, fold)).applyAxisAngle(X, turn);
  mesh.position.add(shift);
  mesh.rotation.x = turn + fold;
}

export function boeing737NoseDoors(g: Gear, pivot: THREE.Vector3, lower: Surface) {
  const half = (g.noseWheelGap ?? .2032) + (g.noseTireW ?? .197) / 2 + .11;
  const length = g.noseLegM + g.noseR + .13;
  const front = pivot.x - length - g.noseR - .12, back = pivot.x + .23;
  const doors = ([-1, 1] as const).map(side => panel("nose-linked-door", "b737", side,
    front, back, half, .008, lower, "nose-link-737", 87));
  const well = wellLiner("nose-wheel-well", front - .02, back + .02, half + .02,
    () => pivot.y + g.noseR + .50, lower, 0);
  return [...doors, well];
}
