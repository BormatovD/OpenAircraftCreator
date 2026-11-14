import { CLASSIC_COWL } from "../../src/aircraft/b737.ts";
import * as THREE from "three";
import type { EnginePiece, NacelleSegment } from "./shapes.ts";
import { annularBurner, cascadeReverser, nacellePart, nacelleShell, type FleetEnginePackage, type Profile } from "./fleetEngine.ts";

// Separate-flow nacelles, in metres from the installed inlet. Axial stations,
// door travel/angles and local cowl contours are schematic, not AMM dimensions.
const five = {
  lip: [[.75, .865], [.34, .84], [.10, .845], [0, .88], [.02, .98], [.12, 1.07], [.30, 1.13]],
  inlet: [[.30, 1.13], [.60, 1.17], [.93, 1.185]],
  fanCowl: [[.93, 1.185], [1.40, 1.182], [1.90, 1.15], [2.23, 1.12]],
  reverser: [[2.23, 1.12], [2.80, 1.06], [3.25, .99]],
  coreCowl: [[2.75, .62], [3.08, .59], [3.42, .55], [3.75, .50]],
  nozzle: [[3.75, .50], [4.08, .425], [4.44, .34], [4.44, .315], [4.08, .395], [3.75, .465]],
  plug: [[3.85, .30], [4.10, .21], [4.28, .075], [4.32, 0]],
} satisfies Record<string, Profile>;
const three = {
  lip: [[.64, .76], [.32, .755], [.10, .77], [0, .82], [.025, .91], [.14, 1.04], [.34, 1.16]],
  inlet: [[.34, 1.16], [.58, 1.21], [.90, 1.22]],
  fanCowl: [[.90, 1.22], [1.28, 1.21], [1.66, 1.17], [2.00, 1.13]],
  reverser: [[2.00, 1.13], [2.35, 1.105], [2.70, 1.06], [3.10, 1.02]],
  coreCowl: [[2.65, .64], [2.92, .62], [3.20, .58], [3.45, .55]],
  nozzle: [[3.45, .55], [3.72, .47], [4.00, .40], [4.00, .372], [3.72, .44], [3.45, .52]],
  plug: [[3.50, .30], [3.85, .285], [4.18, .23], [4.56, .12], [4.80, 0]],
} satisfies Record<string, Profile>;

function fixedParts(profiles: typeof five | typeof three, kx: number, kr: number) {
  return Object.entries(profiles).filter(([id]) => id !== "reverser").map(([id, profile]) =>
    nacellePart(id as NacelleSegment["id"], nacelleShell(profile, kx, kr), "nacelle-" + id,
      id === "lip" || id === "coreCowl" ? "detailSteel" : id === "nozzle" || id === "plug" ? "detailDark" : undefined));
}

/** Four external pivoting doors. Their upstream ends rise outside the nacelle
 * while their downstream ends enter the bypass duct. No translating sleeve or
 * hidden complete cylinder is retained across a pivot-door opening. */
function pivotingDoors(kx: number, kr: number): NacelleSegment[] {
  const parts: NacelleSegment[] = [];
  const outer = five.reverser;
  const skin: Profile = [...outer, ...outer.map(([x, r]) => [x, r - .035] as const).reverse(), outer[0]];
  const span = Math.PI / 2 - .44;
  for (let i = 0; i < 4; i++) {
    const theta = (i + .5) * Math.PI / 2;
    const g = nacelleShell(skin, kx, kr, theta - span / 2, span);
    g.userData.reverserMotion = {
      style: "cfm5b", role: "blocker", pivot: [2.80 * kx, 1.06 * kr * Math.cos(theta), 1.06 * kr * Math.sin(theta)],
      axis: [0, -Math.sin(theta), Math.cos(theta)], angleRad: -55 * Math.PI / 180, slide: [0, 0, 0],
    };
    parts.push(nacellePart("reverser", g, "nacelle-reverser-pivot-door-" + i));
    const frame = nacelleShell(skin, kx, kr, i * Math.PI / 2 - .22, .44);
    frame.userData.reverserMotion = { style: "cfm5b", role: "frame", pivot: [0, 0, 0],
      axis: [1, 0, 0], angleRad: 0, slide: [0, 0, 0] };
    parts.push(nacellePart("reverser", frame, "nacelle-reverser-fixed-frame-" + i));
  }
  return parts;
}

/** Classic's flattened lower nacelle is local to fan/inlet/reverser; the fan
 * rotor, shafts and primary exhaust remain circular about the engine datum. */
function flattenLower(g: THREE.BufferGeometry, kr: number): void {
  const position = g.getAttribute("position");
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i), z = position.getZ(i), r = Math.hypot(y, z);
    // Keep the 60-inch fan passage circular. The extra nacelle thickness below
    // it is flattened; flattening the complete lip would cut through the fan.
    const weight = THREE.MathUtils.clamp((r / kr - .76) / .46, 0, 1);
    if (r > 0) position.setY(i, y < 0
      ? y + Math.max(0, r - CLASSIC_COWL.lowerRadiusM * kr) * (y / r) ** 2
      : y - .12 * weight * r * (y / r) ** 3);
  }
  const motion = g.userData.reverserMotion;
  if (motion) {
    const [, y, z] = motion.pivot, r = Math.hypot(y, z);
    if (r > 0) {
      const weight = THREE.MathUtils.clamp((r / kr - .76) / .46, 0, 1);
      const lowerDepth = Math.max(0, r - CLASSIC_COWL.lowerRadiusM * kr);
      motion.pivot[1] = y < 0 ? y + lowerDepth * (y / r) ** 2 : y - .12 * weight * r * (y / r) ** 3;
      const axis = new THREE.Vector3(...motion.axis as [number, number, number]);
      axis.y *= y < 0 ? 1 + 2 * lowerDepth * y / (r * r) : 1 - .36 * weight * (y / r) ** 2;
      motion.axis = axis.normalize().toArray();
    }
  }
  g.computeVertexNormals();
  g.computeBoundingBox();
}

/** Shorter doors are required below the Classic core, where flattening leaves
 * a shallower bypass annulus. Size the illustrative panel to that local depth,
 * instead of rotating the original circular-nacelle panel through the core. */
function fitClassicBlocker(g: THREE.BufferGeometry, kr: number): void {
  const motion = g.userData.reverserMotion;
  if (motion?.role !== "blocker") return;
  const position = g.getAttribute("position"), pivot = new THREE.Vector3(...motion.pivot as [number, number, number]);
  const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...motion.axis as [number, number, number]), motion.angleRad);
  const v = new THREE.Vector3();
  const clearanceAt = (factor: number) => {
    let minimum = Infinity;
    for (let i = 0; i < position.count; i++) {
      v.fromBufferAttribute(position, i);
      v.x = pivot.x + (v.x - pivot.x) * factor;
      v.sub(pivot).applyQuaternion(rotation).add(pivot);
      minimum = Math.min(minimum, Math.hypot(v.y, v.z));
    }
    return minimum - .66 * kr;
  };
  if (clearanceAt(1) >= 0) return;
  let lo = 0, hi = 1;
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2;
    if (clearanceAt(mid) >= 0) lo = mid; else hi = mid;
  }
  for (let i = 0; i < position.count; i++) position.setX(i, pivot.x + (position.getX(i) - pivot.x) * lo);
  g.computeVertexNormals();
  g.computeBoundingBox();
}

function cfmExhaust(classic: boolean, L: number, rc: number,
  mount: { spinnerX: number; lengthK: number; radiusK: number }): EnginePiece[] {
  const kx = mount.lengthK, kr = mount.radiusK;
  const x = (station: number) => station * kx - mount.spinnerX;
  const r = (radius: number) => radius * kr;
  const exit = .86 * L;
  const primary: Profile = classic
    ? [[exit, 1.06 * rc], [x(2.80), r(.56)], [x(3.20), r(.54)], [x(3.45), r(.52)]]
    : [[exit, 1.06 * rc], [x(3.20), r(.51)], [x(3.50), r(.49)], [x(3.75), r(.465)]];
  const centrebody: Profile = classic
    ? [[exit, .48 * rc], [x(3.20), r(.29)], [x(3.50), r(.30)]]
    : [[exit, .48 * rc], [x(3.35), r(.29)], [x(3.65), r(.305)], [x(3.85), r(.30)]];
  // Fixed outer wall of the core forms the bypass inner boundary. Leave a
  // quarter open to expose the two shafts and the actual stage rows in cutaway.
  const splitter: Profile = classic
    ? [[.25 * L, 1.18 * rc], [x(2.00), r(.56)], [x(2.65), r(.64)]]
    : [[.25 * L, 1.18 * rc], [x(2.10), r(.60)], [x(2.75), r(.62)]];
  const piece = (name: string, profile: Profile, tone: EnginePiece["tone"], cutaway = false): EnginePiece => {
    const geometry = nacelleShell(profile, 1, 1, cutaway ? Math.PI / 2 : 0, cutaway ? 3 * Math.PI / 2 : Math.PI * 2);
    geometry.name = (classic ? "cfm3b2-" : "cfm5b-") + name;
    return { geometry, tone, spin: null, offset: new THREE.Vector3(1.5, 0, 0) };
  };
  return [piece("primary-exhaust-duct", primary, "detailSteel"), piece("exhaust-centrebody", centrebody, "detailDark"),
    piece("bypass-inner-wall", splitter, "casing", true)];
}

export const cfm5b: FleetEnginePackage = {
  referenceLength: 4.44, radius: 1.185, fanFaceX: .75,
  combustorLabel: "CFM56-5B: кольцевая SAC, 20 топливных форсунок",
  injectorCount: 20,
  reverserLabel: "CFM56-5B / A320ceo: четыре поворотные створки, без перевода кожуха",
  nacelle(kx, kr) { return [...fixedParts(five, kx, kr), ...pivotingDoors(kx, kr)]; },
  combustor(L, rc) { return annularBurner(L, rc, { style: "cfm5b", injectors: 20 }); },
  exhaust(L, rc, mount) { return cfmExhaust(false, L, rc, mount); },
};

export const cfm3b2: FleetEnginePackage = {
  referenceLength: 4.80, radius: 1.22, fanFaceX: .64,
  combustorLabel: "CFM56-3B2: кольцевая камера, 20 топливных форсунок",
  injectorCount: 20,
  reverserLabel: "CFM56-3B2 / 737-300: две переводные секции, неподвижные каскады",
  nacelle(kx, kr) {
    const fixed = fixedParts(three, kx, kr);
    // Ten doors follow LTT Classic fig.96 (ATA78-30, p193); bank count is only
    // a visual subdivision until current Boeing IPC effectivity is available.
    const reverser = cascadeReverser("cfm3b2", three.reverser, kx, kr,
      { travel: .43, doorDepth: .42, doors: 10, banks: 12, topGap: .38 });
    for (const p of [...fixed, ...reverser])
      if (["lip", "inlet", "fanCowl", "reverser"].includes(p.id)) flattenLower(p.geometry, kr);
    reverser.forEach(p => fitClassicBlocker(p.geometry, kr));
    return [...fixed, ...reverser];
  },
  combustor(L, rc) { return annularBurner(L, rc, { style: "cfm3b2", injectors: 20 }); },
  exhaust(L, rc, mount) { return cfmExhaust(true, L, rc, mount); },
};
