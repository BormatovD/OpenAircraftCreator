import * as THREE from "three";
import type { EnginePiece, NacelleSegment } from "./shapes.ts";
import { annularBurner, cascadeReverser, nacellePart, nacelleShell, type FleetEnginePackage, type Profile } from "./fleetEngine.ts";

// Independent installed profiles, in metres aft of the inlet. Public sources
// establish the 1A nacelle envelope; detailed stations and the 1B nacelle
// profile are schematic (see docs/engines/LEAP-1A.md and LEAP-1B.md).
const oneA = {
  inlet: [[.78,1.01],[.43,.95],[.13,.93],[.035,.95],[0,.99],[.035,1.08],[.18,1.23],[.48,1.32],[.85,1.35],[1.10,1.35]],
  fanCowl: [[1.10,1.35],[1.48,1.35],[2.05,1.32],[2.32,1.28]],
  reverser: [[2.32,1.28],[2.94,1.20],[3.58,1.08]],
  coreCowl: [[3.42,.68],[3.72,.63],[4.12,.55],[4.48,.47]],
  nozzle: [[4.48,.465],[4.72,.45],[5.10,.43],[5.10,.39],[4.72,.41],[4.48,.425]],
  plug: [[4.48,.26],[4.72,.20],[4.96,.08],[5.10,0]],
} satisfies Record<string, Profile>;

const oneB = {
  inlet: [[.67,.90],[.36,.86],[.12,.85],[.03,.88],[0,.92],[.04,1.00],[.19,1.12],[.46,1.20],[.78,1.22],[1.00,1.21]],
  fanCowl: [[1.00,1.21],[1.34,1.21],[1.82,1.18],[2.06,1.14]],
  reverser: [[2.06,1.14],[2.58,1.08],[3.14,.98]],
  coreCowl: [[3.00,.61],[3.30,.57],[3.64,.50],[3.90,.43]],
  nozzle: [[3.90,.425],[4.14,.41],[4.42,.39],[4.42,.35],[4.14,.37],[3.90,.385]],
  plug: [[3.90,.24],[4.10,.18],[4.34,.07],[4.42,.015]],
} satisfies Record<string, Profile>;

function stationary(profiles: typeof oneA | typeof oneB, kx: number, kr: number): NacelleSegment[] {
  const out: NacelleSegment[] = [];
  for (const id of ["inlet", "fanCowl", "coreCowl"] as const) {
    const tone = undefined;
    out.push(nacellePart(id, nacelleShell(profiles[id], kx, kr), "leap-" + id, tone));
  }
  return out;
}

function coreExhaust(style: string, profiles: typeof oneA | typeof oneB, L: number, rc: number,
  mount: { spinnerX: number; lengthK: number; radiusK: number }): EnginePiece[] {
  const { spinnerX, lengthK: kx, radiusK: kr } = mount;
  // Engine pieces use the spinner datum; nacelle station x is inlet-based.
  const toLocal = (profile: Profile): Profile => profile.map(([x,r])=>[x*kx-spinnerX,r*kr]);
  const exit = .86*L;
  // Continue the LPT annulus, with its outer wall outside the final blade tips
  // and its centrebody attached to the turbine hub. Preserve both existing aft
  // silhouettes; neither primary exhaust wall begins inside the turbine row.
  const local: Profile = [[exit,1.05*rc],[.90*L,1.05*rc],...toLocal(profiles.nozzle.slice(0,3))];
  const plugProfile: Profile = [[exit,.48*rc],[.90*L,.48*rc],...toLocal(profiles.plug)];
  const core = toLocal(profiles.coreCowl);
  const joinX = Math.max(core[0][0],exit+.012*L);
  let joinRadius = core[core.length-1][1];
  for(let i=1;i<core.length;i++)if(joinX<=core[i][0]){
    const [a,ra]=core[i-1],[b,rb]=core[i];
    joinRadius=THREE.MathUtils.lerp(ra,rb,THREE.MathUtils.clamp((joinX-a)/(b-a),0,1));break;
  }
  const piece = (profile: Profile, name: string, tone: EnginePiece["tone"], cutaway = false): EnginePiece => {
    const geometry = nacelleShell(profile, 1, 1, cutaway ? Math.PI/2 : 0, cutaway ? 3*Math.PI/2 : 2*Math.PI);
    geometry.name = style + "-" + name + "-schematic";
    return { geometry, tone, spin: null, offset: new THREE.Vector3(.25,0,0) };
  };
  return [piece(local,"separate-core-nozzle","detailSteel"),piece(plugProfile,"centerbody-plug","detailDark"),
    piece([[exit,1.06*rc],[joinX,joinRadius]],"bypass-inner-wall","casing",true)];
}

/** The chevrons are the actual aft boundary of each moving C-section, including
 * its inner skin and edge thickness. There is no complete smooth lip beneath
 * them and no separate annulus passing through the fixed top/keel bridges.
 * Seven notches per half and their depth are visual proxies, not OEM counts. */
function leap1bChevronSleeve(kx: number, kr: number, start: number, end: number): THREE.BufferGeometry {
  const [frontX,frontR]=oneB.reverser[0], [middleX,middleR]=oneB.reverser[1], [tipX,tipR]=oneB.reverser[2];
  const rootX = 2.98, valleyX = 3.055, thickness = .042;
  const teeth = 7, angularSlices = teeth * 4;
  const slope = (tipR-middleR)/(tipX-middleX);
  const radiusAt = (x: number) => tipR + slope * (x - tipX);
  const positions: number[] = [], indices: number[] = [];
  const rows = 9, columns = angularSlices + 1;
  for (let row = 0; row < rows; row++) for (let j = 0; j <= angularSlices; j++) {
    const theta = start + (end - start) * j / angularSlices;
    const phase = j / 4 % 1;
    const edgeX = tipX - (tipX - valleyX) * (1 - Math.abs(2 * phase - 1));
    const profile: Profile = [[frontX,frontR],[middleX,middleR],[rootX,radiusAt(rootX)],[edgeX,radiusAt(edgeX)],
      [edgeX,radiusAt(edgeX)-thickness],[rootX,radiusAt(rootX)-thickness],
      [middleX,middleR-thickness],[frontX,frontR-thickness],[frontX,frontR]];
    const [x, r] = profile[row];
    positions.push(x*kx, r*kr*Math.cos(theta), r*kr*Math.sin(theta));
  }
  for (let row = 0; row < rows - 1; row++) for (let j = 0; j < angularSlices; j++) {
    const a = row * columns + j, b = a + columns;
    indices.push(a,a+1,b,a+1,b+1,b);
  }
  // Close each physical split-line edge without joining either moving half
  // to a fixed bridge. The same section is used by the original smooth sleeve.
  const cap = [[frontX,frontR],[middleX,middleR],[rootX,radiusAt(rootX)],[tipX,tipR],
    [tipX,tipR-thickness],[rootX,radiusAt(rootX)-thickness],[middleX,middleR-thickness],[frontX,frontR-thickness]];
  const triangles = THREE.ShapeUtils.triangulateShape(cap.map(([x,r]) => new THREE.Vector2(x,r)), []);
  for (const [a,b,c] of triangles) {
    indices.push(a*columns,c*columns,b*columns,
      a*columns+angularSlices,b*columns+angularSlices,c*columns+angularSlices);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function leap1bReverser(kx: number, kr: number): NacelleSegment[] {
  const gap = .46;
  const parts = cascadeReverser("leap1b",oneB.reverser,kx,kr,
    {travel:.48,doorDepth:.34,doors:14,banks:10,topGap:gap});
  const sectors = [[gap,Math.PI-.055],[Math.PI+.055,2*Math.PI-gap]];
  let half = 0;
  for (const part of parts) if (part.geometry.userData.reverserMotion?.role === "sleeve") {
    const original = part.geometry;
    part.geometry = leap1bChevronSleeve(kx,kr,sectors[half][0],sectors[half][1]);
    part.geometry.name = original.name;
    part.geometry.userData = original.userData;
    original.dispose();
    half++;
  }
  return parts;
}

/** One annular liner, with individually separated TAPS injector heads. Counts
 * follow CFM's 1A familiarization/CTC-613 and the NTSB LEAP-1B report. Clocking
 * is documented separately by 1A familiarization and NTSB's 1B28 Figure 2.
 * Cup, stem and inlet shapes remain illustrative. Two inlets
 * represent primary/main and secondary fuel feeds, not two separate chambers. */
function leapCombustor(style: "leap1a" | "leap1b", L: number, rc: number): EnginePiece[] {
  const count = style === "leap1a" ? 19 : 18;
  // Unlike the 1A top injector, NTSB ENG23LA031 p8 Figure 2 places 1B #1
  // half a pitch clockwise from the top (#5 and #14 sit on the horizontal).
  const injectorOffsetRad = style === "leap1b" ? -Math.PI/count : 0;
  return annularBurner(L,rc,{style:style+"-taps-ii",injectors:count,premix:true,
    separateHeads:true,fuelInlets:true,injectorClockwise:true,injectorOffsetRad});
}

export const leap1a: FleetEnginePackage = {
  referenceLength: 5.1, radius: 1.35, fanFaceX: .78,
  combustorLabel: "LEAP-1A · кольцевая TAPS II, 19 форсунок с пилотным и основным контурами",
  injectorCount: 19,
  reverserLabel: "LEAP-1A · каскадный реверс с переводным обтекателем; ход и деталировка эскизные",
  nacelle(kx, kr) {
    return [...stationary(oneA,kx,kr), ...cascadeReverser("leap1a",oneA.reverser,kx,kr,
      {travel:.62,doorDepth:.44,doors:16,banks:12,topGap:.40})];
  },
  combustor(L, rc) { return leapCombustor("leap1a",L,rc); },
  exhaust(L, rc, mount) { return coreExhaust("leap1a",oneA,L,rc,mount); },
};

export const leap1b: FleetEnginePackage = {
  referenceLength: 4.42, radius: 1.22, fanFaceX: .67,
  combustorLabel: "LEAP-1B · кольцевая TAPS II, 18 форсунок с пилотным и основным контурами",
  injectorCount: 18,
  reverserLabel: "LEAP-1B / 737 MAX · каскадный реверс; компоновка и ход эскизные",
  nacelle(kx, kr) {
    return [...stationary(oneB,kx,kr), ...leap1bReverser(kx,kr)];
  },
  combustor(L, rc) { return leapCombustor("leap1b",L,rc); },
  exhaust(L, rc, mount) { return coreExhaust("leap1b",oneB,L,rc,mount); },
};
