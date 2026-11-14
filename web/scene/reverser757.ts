import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { FleetStyle } from "./fleetPackages.ts";

type Profile = ReadonlyArray<readonly [number, number]>;
export type Reverser757Style = "rb211" | "pw2037";
/** Metres in the scaled nacelle datum: inlet x=0, centreline y=z=0.
 * Stations, travel and linkage angles are illustrative, not maintenance data. */
export interface ReverserMotion {
  style: Reverser757Style | FleetStyle;
  role: "sleeve" | "cascade" | "blocker" | "frame";
  pivot: [number, number, number];
  axis: [number, number, number];
  angleRad: number;
  slide: [number, number, number];
}

/** Unscaled schematic installation parameters, shared with clearance checks. */
export function reverser757Layout(style: Reverser757Style) {
  return { travel: style === "rb211" ? .72 : .60, topBridge: .36,
    front: style === "rb211" ? 2.55 : 2.18, sleeveEnd: style === "rb211" ? 3.65 : 3.78 };
}

const pivot = new THREE.Vector3(), axis = new THREE.Vector3();
/** Absolute pose for geometry already translated to the installed inlet/axis.
 * Call before adding exploded-view offsets. Does not alter geometry or its datum. */
export function applyReverserMotion(mesh: THREE.Mesh, fraction: number, origin: THREE.Vector3): void {
  const motion = mesh.geometry.userData.reverserMotion as ReverserMotion | undefined;
  if (!motion) return;
  const f = THREE.MathUtils.clamp(fraction, 0, 1);
  mesh.position.set(0, 0, 0);
  mesh.quaternion.identity();
  if (f === 0) return;
  if (motion.angleRad !== 0) {
    axis.fromArray(motion.axis);
    mesh.quaternion.setFromAxisAngle(axis, motion.angleRad * f);
    pivot.fromArray(motion.pivot).add(origin);
    mesh.position.copy(pivot).applyQuaternion(mesh.quaternion).negate().add(pivot);
  }
  mesh.position.x += motion.slide[0] * f;
  mesh.position.y += motion.slide[1] * f;
  mesh.position.z += motion.slide[2] * f;
}

function radiusAt(profile: Profile, x: number): number {
  for (let i = 1; i < profile.length; i++) {
    const [a, ra] = profile[i - 1], [b, rb] = profile[i];
    if (a !== b && x >= Math.min(a, b) - 1e-8 && x <= Math.max(a, b) + 1e-8)
      return ra + (rb - ra) * (x - a) / (b - a);
  }
  return profile.reduce((a, b) => Math.abs(a[0] - x) < Math.abs(b[0] - x) ? a : b)[1];
}

/** Slice a monotone (forward or reverse) section without smoothing the verified contour. */
function section(profile: Profile, start: number, end: number): [number, number][] {
  const middle = profile.filter(p => p[0] > Math.min(start, end) && p[0] < Math.max(start, end));
  return [[start, radiusAt(profile, start)], ...middle.map(p => [...p] as [number, number]), [end, radiusAt(profile, end)]];
}

function shell(profile: Profile, kx: number, kr: number, start = 0, span = Math.PI * 2): THREE.BufferGeometry {
  // theta=0 at top; theta=pi/2 at the right side, matching the blocker hinges.
  const g = new THREE.LatheGeometry(profile.map(([x, r]) => new THREE.Vector2(r * kr, x * kx)),
    Math.max(4, Math.ceil(64 * span / (Math.PI * 2))), start - Math.PI / 2, span);
  return g.rotateZ(-Math.PI / 2);
}

export function reverser757Segments(style: Reverser757Style, profile: Profile, liner: Profile, kx: number, kr: number):
  { id: "reverser" | "bypassLiner"; geometry: THREE.BufferGeometry }[] {
  const rb = style === "rb211";
  const { front, travel, topBridge, sleeveEnd } = reverser757Layout(style);
  const hingeX = front + travel;
  const outer = profile.slice(0, 5);
  const out: { id: "reverser" | "bypassLiner"; geometry: THREE.BufferGeometry }[] = [];
  const add = (g: THREE.BufferGeometry, role: ReverserMotion["role"], name: string,
    slide: ReverserMotion["slide"] = [0, 0, 0], p: ReverserMotion["pivot"] = [0, 0, 0],
    a: ReverserMotion["axis"] = [1, 0, 0], angleRad = 0) => {
    g.name = "nacelle-reverser-" + name;
    g.userData.reverserMotion = { style, role, pivot: p, axis: a, angleRad, slide } satisfies ReverserMotion;
    if (role === "cascade") g.userData.tone = "detailSteel";
    if (role === "blocker") g.userData.tone = "detailDark";
    out.push({ id: "reverser", geometry: g });
  };

  // Two translating C-duct halves; fixed top/keel bridges remain with the pylon.
  // RB's common mixed exhaust remains aft of the translating cold-stream cowl.
  const sleeveProfile: Profile = rb
    ? (() => { const p = section(outer, front, sleeveEnd); return [...p,
      ...p.map(([x, r]) => [x, r - .008] as [number, number]).reverse(), p[0]]; })()
    : [...profile, [front, radiusAt(liner, front)], profile[0]];
  // The complete angular strip above these edges stays fixed: besides the
  // visible strut width, this allows room for its rounded lower attachment.
  const keelBridge = .045;
  const sectors = [[topBridge, Math.PI - keelBridge], [Math.PI + keelBridge, Math.PI * 2 - topBridge]] as const;
  for (const [i, [start, end]] of sectors.entries())
    add(shell(sleeveProfile, kx, kr, start, end - start), "sleeve", "sleeve-" + i, [travel * kx, 0, 0]);
  for (const [i, start, span] of [[0, -topBridge, 2 * topBridge], [1, Math.PI - keelBridge, 2 * keelBridge]])
    add(shell(sleeveProfile, kx, kr, start, span), "frame", "bridge-" + i);
  if (rb) {
    // A thin stationary telescoping insert under the sleeve. The 8 mm model
    // clearance is a seam allowance, not a published RB211 dimension. Return
    // to the original contour before the fixed common nozzle at x=4.50.
    const overlapEnd = sleeveEnd + travel;
    const inset = section(outer, sleeveEnd, overlapEnd).map(([x, r]) => [x, r - .008] as [number, number]);
    inset.push([4.50, 1.00], [4.50, .94]);
    for (const [i, [start, end]] of sectors.entries())
      add(shell(inset, kx, kr, start, end - start), "frame", "aft-transition-" + i);
    const fixed = section(outer, sleeveEnd, 4.50);
    fixed.push([4.50, .94]);
    for (const [i, start, span] of [[0, -topBridge, 2 * topBridge], [1, Math.PI - keelBridge, 2 * keelBridge]])
      add(shell(fixed, kx, kr, start, span), "frame", "aft-bridge-" + i);
  }

  // Cascade modules contain open spaces between individual forward-turning vanes.
  // No complete underlying cylinder is left across the discharge window. The
  // 16 banks / six visible vanes per bank are an illustrative subdivision for
  // both engines: AeroEd's "16 stationary cascade vanes" does not establish
  // this bank/airfoil subdivision or the metric dimensions.
  const modules = 16;
  const vanes: THREE.BufferGeometry[] = [];
  for (let bank = 0; bank < modules; bank++) {
    const [sectorStart, sectorEnd] = sectors[bank < modules / 2 ? 0 : 1];
    const pitch = (sectorEnd - sectorStart) / (modules / 2);
    const start = sectorStart + (bank % (modules / 2) + .05) * pitch;
    const span = .90 * pitch;
    for (let row = 0; row < 6; row++) {
      const x = front + .055 + (travel - .11) * row / 5;
      const ri = radiusAt(liner, x) + .012;
      const ro = radiusAt(outer, x) - .012;
      // A short inclined vane, rather than a wall covering the whole window.
      const turn = .050;
      vanes.push(shell([[x + turn, ri], [x - turn, ro], [x - turn + .010, ro],
        [x + turn + .010, ri], [x + turn, ri]], kx, kr, start, span));
    }
    // Circumferential module side rails, narrow enough to leave radial flow open.
    const rail: Profile = [[front + .025, radiusAt(liner, front) + .008],
      [front + .025, radiusAt(outer, front) - .012],
      [hingeX - .025, radiusAt(outer, hingeX) - .012],
      [hingeX - .025, radiusAt(liner, hingeX) + .008]];
    vanes.push(shell([...rail, rail[0]], kx, kr, start, .012));
  }
  const cascade = mergeGeometries(vanes)!;
  vanes.forEach(g => g.dispose());
  add(cascade, "cascade", "cascade");

  // Twelve PW blocker doors are documented in ATA 78. PW theoretical training
  // ATA 71 and the NTSB Powerplant Factual Report describe drag links between
  // the stationary structure and doors mounted on the translating sleeve.
  // Thus the hinge travels with that sleeve, while the aft free edge turns
  // inward. We use the same explicit schematic linkage assumption for the RB;
  // its count and all metric linkage dimensions remain illustrative.
  const doors = 12;
  const hingeRadius = radiusAt(liner, hingeX);
  // These doors cover the *radial depth of the bypass*, not the full sleeve
  // travel. In particular the PW bypass inner wall flares out to r≈0.96 m.
  const hingeStowed = hingeX - travel;
  const doorEnd = hingeStowed + (rb ? .50 : .25) * kr / kx;
  for (let i = 0; i < doors; i++) {
    const [sectorStart, sectorEnd] = sectors[i < doors / 2 ? 0 : 1];
    const pitch = (sectorEnd - sectorStart) / (doors / 2);
    const theta = sectorStart + (i % (doors / 2) + .5) * pitch;
    const halfWidth = pitch / 2 - .012;
    const doorProfile: Profile = [[hingeStowed, hingeRadius], [doorEnd, hingeRadius],
      [doorEnd, hingeRadius + .012], [hingeStowed, hingeRadius + .012], [hingeStowed, hingeRadius]];
    add(shell(doorProfile, kx, kr, theta - halfWidth, 2 * halfWidth), "blocker", "blocker-" + i,
      [travel * kx, 0, 0], [hingeStowed * kx, hingeRadius * kr * Math.cos(theta), hingeRadius * kr * Math.sin(theta)],
      [0, -Math.sin(theta), Math.cos(theta)], -Math.PI / 2);
  }

  // Preserve the original duct on both sides of the door row, but remove the
  // original unbroken liner where it would seal the exposed cascades shut.
  const fixedLiners: Profile[] = [section(liner, front, liner[liner.length - 1][0])];
  if (rb) fixedLiners.push(section(liner, liner[0][0], hingeX));
  for (const [i, pts] of fixedLiners.entries()) {
    const g = shell(pts, kx, kr);
    g.name = i === 0 ? "nacelle-bypassLiner" : "nacelle-bypassLiner-aft";
    out.push({ id: "bypassLiner", geometry: g });
  }
  return out;
}
