import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { EnginePiece, NacelleSegment } from "./shapes.ts";

export type Profile = ReadonlyArray<readonly [number, number]>;
export interface FleetEnginePackage {
  referenceLength: number;
  radius: number;
  fanFaceX: number;
  combustorLabel: string;
  injectorCount?: number;
  reverserLabel: string;
  nacelle(lengthK: number, radiusK: number): NacelleSegment[];
  combustor(length: number, coreRadius: number): EnginePiece[];
  exhaust(length: number, coreRadius: number, mount: { spinnerX: number; lengthK: number; radiusK: number }): EnginePiece[];
}

// Stations are metres aft of the inlet, azimuth starts at the top of the nacelle.
export function nacelleShell(profile: Profile, kx: number, kr: number, fromAngle = 0, span = 2 * Math.PI) {
  return new THREE.LatheGeometry(profile.map(([x,r]) => new THREE.Vector2(r * kr, x * kx)),
    Math.max(4, Math.ceil(64 * span / (2 * Math.PI))), fromAngle - Math.PI / 2, span).rotateZ(-Math.PI / 2);
}

export function nacellePart(id: NacelleSegment["id"], geometry: THREE.BufferGeometry, name: string, tone?: string): NacelleSegment {
  geometry.name = name;
  if (tone) geometry.userData.tone = tone;
  return { id, geometry };
}

function atStation(profile: Profile, x: number) {
  for (let i = 1; i < profile.length; i++) {
    const [a, ra] = profile[i - 1], [b, rb] = profile[i];
    if (x <= b && b > a) return THREE.MathUtils.lerp(ra, rb, THREE.MathUtils.clamp((x - a) / (b - a), 0, 1));
  }
  return profile[profile.length - 1][1];
}

export function cascadeReverser(style: string, outer: Profile, kx: number, kr: number,
  options: { travel: number; doorDepth: number; doors?: number; banks?: number; topGap?: number; splitBanks?: boolean; splitBlockers?: boolean }): NacelleSegment[] {
  const { travel, doorDepth, topGap = .42, doors = 12, banks = 12, splitBanks = false, splitBlockers = false } = options;
  const front = outer[0][0], hingeRadius = outer[0][1] - .09;
  const inner: [number, number][] = outer.map(([x, r]) => [x, r - .042]);
  const skin: Profile = [...outer, ...inner.reverse(), outer[0]];
  const sectors = [[topGap, Math.PI - .055], [Math.PI + .055, 2 * Math.PI - topGap]];
  const result: NacelleSegment[] = [];
  const vanes: THREE.BufferGeometry[] = [];
  const bankMeshes: THREE.BufferGeometry[] = [];
  const deploy = (geom: THREE.BufferGeometry, role: string, index: number, slide = 0,
    pivot = [0, 0, 0], axis = [1, 0, 0], angleRad = 0) => {
    geom.userData.reverserMotion = { style, role, pivot, axis, angleRad, slide: [slide, 0, 0] };
    const tone = role === "cascade" ? "detailSteel" : role === "blocker" ? "detailDark" : undefined;
    result.push(nacellePart("reverser", geom, style + "-reverser-" + role + "-" + index, tone));
  };
  for (const [i, [start, end]] of sectors.entries()) {
    deploy(nacelleShell(skin, kx, kr, start, end - start), "sleeve", i, travel * kx);
    const count = Math.floor(doors / 2) + (i ? doors % 2 : 0);
    const pitch = (end - start) / count;
    for (let j = 0; j < count; j++) {
      const angle = start + pitch * (j + .5);
      const aft = front + doorDepth * kr / kx;
      const index = j + (i ? Math.floor(doors/2) : 0);
      const thetaStart = start + j*pitch + .014;
      const thetaSpan = pitch - .028;
      const pivot = [front*kx, hingeRadius*kr*Math.cos(angle), hingeRadius*kr*Math.sin(angle)];
      const axis = [0, -Math.sin(angle), Math.cos(angle)];
      const addLeaf = (x0: number, x1: number, leaf: "large" | "small") => {
        const door = nacelleShell([[x0,hingeRadius],[x1,hingeRadius],[x1,hingeRadius+.014],
          [x0,hingeRadius+.014],[x0,hingeRadius]], kx, kr, thetaStart, thetaSpan);
        deploy(door, "blocker", index, travel*kx, pivot, axis, -Math.PI/2);
        if (splitBlockers) {
          door.userData.linkIndex = index;
          door.userData.leaf = leaf;
          door.userData.leafPair = `link-${index}`;
        }
      };
      if (splitBlockers) {
        // A tiny axial gap marks the two source-described linked leaves; it is
        // a rendering seam only and adds no separate motion or linkage claim.
        const seam = .008;
        const join = front + doorDepth * .68;
        addLeaf(front, join - seam / 2, "large");
        addLeaf(join + seam / 2, aft, "small");
      } else addLeaf(front, aft, "large");
    }
    const sectorsPerSide = Math.floor(banks / 2) + (i ? banks % 2 : 0);
    const bankWidth = (end - start) / sectorsPerSide;
    for (let j = 0; j < sectorsPerSide; j++) {
      const bankVanes: THREE.BufferGeometry[] = [];
      for (let row = 0; row < 5; row++) {
        const x = front + travel * (.10 + .19 * row);
        const r = atStation(outer, x) - .048;
        const dx = travel * .054;
        bankVanes.push(nacelleShell([[x-dx,r],[x+dx,r-.064],[x+dx+.009,r-.064],[x-dx+.009,r],[x-dx,r]],
          kx, kr, start + bankWidth*j + .012, bankWidth - .024));
      }
      if (splitBanks) {
        bankMeshes.push(mergeGeometries(bankVanes)!);
        bankVanes.forEach(geometry => geometry.dispose());
      }
      else vanes.push(...bankVanes);
    }
  }
  deploy(nacelleShell(skin, kx, kr, -topGap, 2*topGap), "frame", 0);
  deploy(nacelleShell(skin, kx, kr, Math.PI-.055, .11), "frame", 1);
  if (splitBanks) bankMeshes.forEach((geometry,index) => deploy(geometry,"cascade",index));
  else deploy(mergeGeometries(vanes)!, "cascade", 0);
  vanes.forEach(g => g.dispose());
  return result;
}

/** Longitudinal inspection cut through a single annular liner. Premix cups show
 * separate pilot and main passages at the same station on the same injector. */
export function annularBurner(L: number, rc: number, options: { style:string; injectors?:number; premix?:boolean;
  separateHeads?:boolean; fuelInlets?:boolean; injectorClockwise?:boolean; injectorOffsetRad?:number }): EnginePiece[] {
  const wall = (profile: Profile, span = Math.PI * 2) => nacelleShell(profile, L, rc, Math.PI/2, span);
  const hotWall = wall([[.532,.74],[.539,.80],[.559,.82],[.584,.73],[.597,.64]], 1.5*Math.PI);
  const innerWall = wall([[.597,.44],[.572,.43],[.545,.46],[.532,.52]]);
  const pieces: EnginePiece[] = [];
  const add = (geometry: THREE.BufferGeometry, name: string, tone: EnginePiece["tone"]) => {
    geometry.name = "combustor-" + options.style + "-" + name;
    pieces.push({ geometry, spin:null, tone, offset:new THREE.Vector3(.25,0,0) });
  };
  // The front plate joins the two liners and has an opening at every cup.
  // ShapeGeometry's XY plane becomes the engine's ZY plane after rotation.
  const dome = new THREE.Shape();
  const tau = 2 * Math.PI;
  dome.absarc(0, 0, .74 * rc, 0, tau, false);
  function opening(y: number, z: number, radius: number) {
    const hole = new THREE.Path();
    hole.absarc(-z, y, radius, 0, tau, true);
    dome.holes.push(hole);
  }
  opening(0, 0, .52 * rc);
  if (options.injectors) {
    const cups: THREE.BufferGeometry[] = [];
    const pitch = Math.PI*2/options.injectors;
    const r = .63*rc, size = .66*r*Math.sin(pitch/2);
    for (let i=0; i<options.injectors; i++) {
      const a = (options.injectorOffsetRad ?? 0) + (options.injectorClockwise ? -1 : 1)*pitch*i;
      opening(r * Math.cos(a), r * Math.sin(a), size * .79);
      const buildCup = (scale:number) => nacelleShell([[0,.72],[.032,1],[.04,.96],[.008,.61]],L,size*scale)
        .translate(.524*L,r,0);
      const head: THREE.BufferGeometry[] = [buildCup(1)];
      if (options.premix) head.push(buildCup(.45));
      if (options.fuelInlets) for (const z of [-.040*rc,.040*rc]) {
        head.push(new THREE.CylinderGeometry(.015*rc,.015*rc,.28*rc,10).translate(.540*L,.80*rc,z));
        head.push(new THREE.CylinderGeometry(.025*rc,.025*rc,.035*rc,12).translate(.540*L,.94*rc,z));
      }
      const geometry = mergeGeometries(head)!.rotateX(a);
      head.forEach(g=>g.dispose());
      if (options.separateHeads) {
        add(geometry,"injector-head-"+(i+1),"detailFuel");
        geometry.userData.injectorNumber = i+1;
        pieces[pieces.length-1].label = "TAPS II injector "+(i+1);
      } else cups.push(geometry);
    }
    if (cups.length) add(mergeGeometries(cups)!, "injectors", "detailFuel");
    cups.forEach(g=>g.dispose());
  }
  const plate = new THREE.ShapeGeometry(dome, 20).rotateY(Math.PI/2).translate(.532*L,0,0);
  add(mergeGeometries([hotWall,innerWall,plate])!, "liner", "hot");
  for (const section of [hotWall,innerWall,plate]) section.dispose();
  return pieces;
}
