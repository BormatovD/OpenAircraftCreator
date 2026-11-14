import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { EnginePiece, NacelleSegment } from "./shapes.ts";
import { cascadeReverser, nacellePart, nacelleShell, type FleetEnginePackage, type Profile } from "./fleetEngine.ts";

// Tu-204-200 side-view proxy stations, metres aft of inlet. Do not interpret as
// measured Tu-214 production nacelle dimensions; see docs/engines/PS-90A.md.
const inlet: Profile = [[1.15,.96],[.55,.91],[.18,.85],[.05,.84],[0,.87],[0,.90],[.05,.96],[.20,1.04],[.50,1.12],[.90,1.16],[1.30,1.18]];
const fanCowl: Profile = [[1.30,1.18],[1.55,1.18],[2,1.15],[2.55,1.08]];
const reverserOuter: Profile = [[2.55,1.08],[3.20,.99],[4.10,.84]];
const aftCowl: Profile = [[4.10,.84],[4.62,.75],[5.20,.60]];
const commonNozzle: Profile = [[5.20,.60],[5.68,.59],[6.15,.57],[6.15,.54],[5.83,.55],[5.20,.60]];

function shellPart(id: NacelleSegment["id"], profile: Profile, kx: number, kr: number, name: string, tone?: string) {
  return nacellePart(id, nacelleShell(profile, kx, kr), name, tone);
}

function ringAt(x: number, radius: number, thickness: number, segments = 48) {
  const g = new THREE.CylinderGeometry(radius, radius, thickness, segments, 1, true);
  return g.rotateZ(Math.PI / 2).translate(x, 0, 0);
}

function axialCan(x: number, length: number, centerRadius: number, canRadius: number, segments = 12) {
  const g = new THREE.CylinderGeometry(canRadius, canRadius, length, segments, 1, true);
  return g.rotateZ(Math.PI / 2).translate(x, centerRadius, 0);
}

function piece(geometry: THREE.BufferGeometry, tone: EnginePiece["tone"], label: string): EnginePiece {
  geometry.name = label;
  return { geometry, tone, spin: null, offset: new THREE.Vector3(.25,0,0), label };
}

const combustor = (L: number, rc: number): EnginePiece[] => {
  // Tubular-annular PS-90A layout: 12 individual flame tubes around an annular
  // collector, not one smooth annular liner. Tube count/nozzle count from 2007
  // designer-authored book, printed pp.76–78, figs 5.3–5.7.
  const parts: EnginePiece[] = [];
  const cans: THREE.BufferGeometry[] = [];
  const fuel: THREE.BufferGeometry[] = [];
  const count = 12;
  const circle = .51 * rc, canR = .115 * rc;
  for (let i = 0; i < count; i++) {
    const a = 2 * Math.PI * i / count;
    const can = axialCan(.56 * L, .058 * L, circle, canR);
    can.rotateX(a);
    cans.push(can);
    const nozzle = new THREE.CylinderGeometry(.018 * rc,.018 * rc,.05 * L,8);
    nozzle.rotateZ(Math.PI / 2).translate(.529 * L, circle * Math.cos(a), circle * Math.sin(a));
    fuel.push(nozzle);
  }
  const collector = ringAt(.591 * L,.63 * rc,.012 * L);
  const front = ringAt(.526 * L,.61 * rc,.012 * L);
  const igniters = [2, 9].map(i => {
    const a = 2 * Math.PI * i / count;
    return new THREE.CylinderGeometry(.016 * rc,.016 * rc,.055 * L,8)
      .rotateZ(Math.PI / 2).translate(.548 * L,circle * Math.cos(a),circle * Math.sin(a));
  });
  const cansGeometry = merge(cans);
  cansGeometry.userData.componentCount = count;
  parts.push(piece(cansGeometry, "hot", "PS-90A-tubular-annular-flame-tubes"));
  parts.push(piece(front, "casing", "PS-90A-combustor-front-ring"));
  parts.push(piece(collector, "hot", "PS-90A-annular-gas-collector"));
  // Keep injectors independently selectable and preserve the supported count.
  const injectorGeometry = merge(fuel);
  injectorGeometry.userData.componentCount = count;
  parts.push(piece(injectorGeometry, "detailFuel", "PS-90A-12-fuel-injectors"));
  const ignitionGeometry = merge(igniters);
  ignitionGeometry.userData.componentCount = 2;
  parts.push(piece(ignitionGeometry, "detailSteel", "PS-90A-two-igniters"));
  return parts;
};

function merge(geometries: THREE.BufferGeometry[]) {
  const result = mergeGeometries(geometries)!;
  geometries.forEach(geometry => geometry.dispose());
  return result;
}

const exhaust = (_L: number, rc: number, mount: { spinnerX:number; lengthK:number; radiusK:number }): EnginePiece[] => {
  const { spinnerX, lengthK, radiusK } = mount;
  // The outlet datum is 1.10 engine lengths aft of spinner. Convert it to an
  // inlet-based station and back through spinnerX so the cutaway fits its
  // 4.964 m scene datum; detailed internal contours remain schematic.
  const station = (u: number) => (spinnerX + u * _L) / lengthK;
  const x = (u: number) => station(u) * lengthK - spinnerX;
  const nozzleStart = x(.94);
  const lptExit = .86 * _L;
  const engineProfile: Profile = [[x(.94),.60*radiusK],[x(.99),.60*radiusK],[x(1.04),.59*radiusK],
    [x(1.10),.575*radiusK],[x(1.10),.54*radiusK],[x(1.05),.55*radiusK],[x(.94),.60*radiusK]];
  const g = nacelleShell(engineProfile,1,1);
  g.name = "PS-90A-common-mixed-flow-nozzle";
  const plug = nacelleShell([[x(.97),.29*radiusK],[x(1.04),.24*radiusK],
    [x(1.085),.08*radiusK],[x(1.10),.015*radiusK]],1,1);
  plug.name = "PS-90A-exhaust-plug-schematic";
  // A short mixer section suggests the mixed-flow interface; its
  // exact lobe count and dimensions are not established by cited sources.
  const mixer = nacelleShell([[x(.90),.48*radiusK],[x(.97),.53*radiusK],
    [x(.99),.49*radiusK],[x(.95),.45*radiusK]],1,1);
  mixer.name = "PS-90A-mixer-liner-schematic";
  const neck = nacelleShell([[lptExit,rc*.98],[nozzleStart,.565*radiusK],
    [nozzleStart,.535*radiusK],[lptExit,rc*.92]],1,1);
  neck.name = "PS-90A-mixing-duct-from-lpt";
  return [piece(neck,"hot","PS-90A-mixing-duct"),piece(g,"detailSteel","PS-90A-common-nozzle"),
    piece(plug,"casing","PS-90A-exhaust-plug"),piece(mixer,"hot","PS-90A-mixer")];
};

// Fig. 7.5 shows the translating outer fairing as two forward skins, two aft
// skins and a lower cover. They travel together over the stationary cascades.
function ps90Reverser(kx: number, kr: number) {
  const parts = cascadeReverser("ps90a",reverserOuter,kx,kr,
    {travel:.42,doorDepth:.46,doors:18,banks:6,topGap:.42,splitBanks:true,splitBlockers:true});
  const motion = parts.find(p => p.geometry.userData.reverserMotion.role === "sleeve")!.geometry.userData.reverserMotion;
  const panels = parts.filter(p => {
    if (p.geometry.userData.reverserMotion.role !== "sleeve" && !p.geometry.name.endsWith("frame-1")) return true;
    p.geometry.dispose();
    return false;
  });
  function cover(profile: Profile, a: number, b: number, name: string) {
    const inner = [...profile].reverse().map(([x,r]) => [x,r-.042] as const);
    const g = nacelleShell([...profile,...inner,profile[0]],kx,kr,a,b-a);
    g.userData.reverserMotion = motion;
    panels.push(nacellePart("reverser",g,"ps90a-moving-fairing-"+name));
  }
  for (const [i,[a,b]] of [[.42,Math.PI-.055],[Math.PI+.055,2*Math.PI-.42]].entries()) {
    cover([reverserOuter[0],[3.194,.991]],a,b,"forward-"+i);
    cover([[3.206,.989],reverserOuter[2]],a,b,"aft-"+i);
  }
  cover(reverserOuter,Math.PI-.054,Math.PI+.054,"lower");
  return panels;
}

export const ps90a: FleetEnginePackage = {
  referenceLength: 6.15,
  radius: 1.18,
  fanFaceX: 1.15,
  combustorLabel: "Трубчато-кольцевая камера · 12 жаровых труб и форсунок; 2 свечи",
  injectorCount: 12,
  reverserLabel: "Решетчатый реверс наружного контура · подвижный обтекатель и створки; кинематика эскизная",
  nacelle(lengthK, radiusK) {
    const out: NacelleSegment[] = [
      shellPart("inlet",inlet,lengthK,radiusK,"ps90a-inlet"),
      shellPart("fanCowl",fanCowl,lengthK,radiusK,"ps90a-fan-cowl"),
      // The RTO specifies 18 linked flap units, each with a large and a small
      // leaf. The .42 m travel, the thin seam between leaf meshes, and the six
      // drawn cascade zones remain schematic; the two leaves share one pose.
      ...ps90Reverser(lengthK,radiusK),
      shellPart("reverser",aftCowl,lengthK,radiusK,"ps90a-fixed-aft-reverser-fairing"),
      shellPart("nozzle",commonNozzle,lengthK,radiusK,"ps90a-common-nozzle","detailSteel"),
    ];
    return out;
  },
  combustor,
  exhaust,
};
