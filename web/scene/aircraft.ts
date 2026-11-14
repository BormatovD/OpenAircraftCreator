// Сборка 3D-модели из определения самолёта. Каждый узел дерева масс получает свою группу мешей,
// направление разлёта и якорь для выноски. Геометрия строится только из размеров определения,
// поэтому рычаги (размах, диаметр вентилятора, длина фюзеляжа) сразу меняют модель.

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { B757_PW2037, B757_RB211, b757NacelleFor } from "../../src/aircraft/b757.ts";
import { TU214_PS90A } from "../../src/aircraft/tu214.ts";
import { type ShapeSet, useShapes } from "./shapeSet.ts";
import { B737_300 } from "../../src/aircraft/b737.ts";
import { A320CEO, A320NEO } from "../../src/aircraft/a320.ts";
import { B737_8 } from "../../src/aircraft/b737max.ts";
import { leadingEdge737 } from "./leadingEdge737.ts";
import { B737_800_NACELLE } from "../../src/aircraft/b737ng.ts";
import { pylonFor } from "./pylonPackages.ts";
import { cowlDoors, installationGeometry, isSuspensionHardware } from "./pylonGeometry.ts";
import { fleetMountTravel } from "./fleetClearance.ts";
import { fleetPackages, isFleetStyle } from "./fleetPackages.ts";
import { cutBayOpenings, type BayOpening } from "./gearOpenings.ts";
import { wingRootFairing } from "./wingRootFairing.ts";
import { DOOR_RIM_INSET } from "./gearDoors.ts";
import { mainDoors, noseDoors } from "./gearBay.ts";
import { boeing737StowAngle } from "./boeing737Gear.ts";
import { mainLandingGear, noseLandingGear } from "./landingGear.ts";
import { cockpitGlazing } from "./cockpit.ts";
import { cabinOpenings } from "./features.ts";
import { fuselageFittings, wingtipLights } from "./fittings.ts";
import { avionicsRack, instrumentPanel, electricalBay, hydraulicBay, airConditioningPacks, fuelDetails, engineAccessories } from "./systemDetails.ts";
import { type AircraftDefinition, aeroSpanM } from "../../src/definition.ts";
import { cabinRowsFor } from "../../src/integration/flightcost.ts";
import {
  type FuselageShape,
  type NacelleSegment,
  type SurfaceShape,
  applyReverserMotion,
  engineCutaway,
  clearance757,
  coreRadiusFor,
  fuselageGeometry,
  fuselageHalfWidthAt,
  fuselageSection,
  leadingEdgeSweep,
  modelX,
  nacaHalfThickness,
  nacelleScale,
  nacelleFanFace,
  nacelleSegments,
  nacelleStyleFor,
  surfaceGeometry,
  surfacePoint,
  tubeGeometry,
} from "./shapes.ts";

export type Family = "structure" | "propulsion" | "systems" | "cabin";

export interface Part {
  id: string;
  family: Family;
  group: THREE.Group;
  /** Смещение при полном разлёте, м. */
  explode: THREE.Vector3;
  /** Направление выноски от центра части. */
  labelOffset: THREE.Vector3;
  /** Полупрозрачная часть (баки) — рисуется поверх остальных. */
  ghost?: boolean;
  /** Разлёт левой и правой половин по размаху при полном разборе, м. */
  sideSpread: number;
}

export interface AircraftModel {
  root: THREE.Group;
  /** Передняя кромка крыла у борта — для аварийных выходов на текстуре. */
  wingLeX: number;
  /** Развёртка киля (u, v) → точка вида сбоку AC (x, y) — для логотипа окраски. */
  finXY: (u: number, v: number) => [number, number];
  parts: Map<string, Part>;
  groundY: number;
  lengthM: number;
}

/** Ground distance of the assembled installation in an inspection pose. Use
 * model coordinates so selection offsets and exploded views cannot change it. */
export function installedGroundClearance(model: AircraftModel, travel: number): number {
  let bottom = Infinity;
  const vertex = new THREE.Vector3();
  for (const mesh of model.parts.get("nacelles")!.group.children) {
    if (!(mesh instanceof THREE.Mesh) || mesh.userData.side !== 1) continue;
    const geometry = mesh.geometry;
    if (isSuspensionHardware(geometry.userData.installationRole)) continue;
    const origin = geometry.userData.reverserOrigin as THREE.Vector3 | undefined;
    if (!origin || travel === 0) {
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      bottom = Math.min(bottom, geometry.boundingBox!.min.y);
      continue;
    }
    const moving = new THREE.Mesh(geometry, mesh.material);
    applyReverserMotion(moving, travel, origin);
    moving.updateMatrix();
    const points = geometry.getAttribute("position");
    for (let i = 0; i < points.count; i++) {
      bottom = Math.min(bottom, vertex.fromBufferAttribute(points, i).applyMatrix4(moving.matrix).y);
    }
  }
  return bottom - model.groundY;
}

export const FAMILY: Record<string, Family> = {
  "wing.box": "structure",
  "wing.highLift": "structure",
  wingtips: "structure",
  fuselage: "structure",
  htail: "structure",
  vtail: "structure",
  "gear.main": "structure",
  "gear.nose": "structure",
  nacelles: "structure",
  engines: "propulsion",
  fuel: "propulsion",
  flightControls: "systems",
  hydraulics: "systems",
  "electrical.generation": "systems",
  "electrical.harness": "systems",
  avionics: "systems",
  instruments: "systems",
  airConditioning: "systems",
  antiIce: "systems",
  apu: "systems",
  furnishings: "cabin",
  operatorItems: "cabin",
  // Учётные весовые позиции не изображаются фиктивными кубами; видны в дереве масс.
  oewReconciliation: "cabin",
  additionalEquipment: "cabin",
  // Без собственной геометрии, но с массой.
  "engine.controls": "propulsion",
  handling: "systems",
};

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function boxAt(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return g;
}

export interface BuildOptions {
  /** Масса кабельной сети относительно базового A320ceo — задаёт число проводов в пучках. */
  harnessShare?: number;
}

function wingGeometry(def: AircraftDefinition, SH: ShapeSet) {
  // Форма в плане — по виду сверху Airbus AC 2-2-0 (векторный контур): передняя кромка прямая,
  // задняя — прямая до излома над основными стойками, дальше к законцовке. Площадь по этой форме
  // (с центропланом) ≈122 м² — совпадает с 122,4 м² Jenkinson, независимая проверка извлечения.
  // Рычаги масштабируют форму: хорды — по средней хорде S/b, внешняя часть — по полуразмаху.
  const w = def.wing;
  const semi = w.spanM / 2;
  const engZ = Math.min(SH.nacelle.axisZ, 0.6 * semi);
  const sideZ = def.fuselage.widthM / 2;
  const P = SH.wing;
  const chordK = w.areaM2 / w.spanM / (P.refAreaM2 / P.refSpanM);
  const exposed = semi - sideZ;
  // Передняя кромка — прямая (у 737 — две: наплыв у корня и основная), задняя — две прямые с изломом.
  const acLe = (z: number) => Math.min(P.le.slope * z + P.le.x0, P.leInner ? P.leInner.slope * z + P.leInner.x0 : Infinity);
  const acTe = (z: number) => Math.max(P.teInner.slope * z + P.teInner.x0, P.teOuter.slope * z + P.teOuter.x0);
  const acSide = P.sideZ;
  const acTipZ = P.tipZ;
  const tanLe = P.le.slope;
  const cSide = (acTe(acSide) - acLe(acSide)) * chordK;
  const cTip = (acTe(acTipZ) - acLe(acTipZ)) * chordK;
  // Доля открытой части консоли η одинакова на чертеже и в модели: кромки чертежа переносятся по η, хорды — по chordK,
  // смещение передней кромки — по отношению длин консолей.
  const spanK = exposed / (acTipZ - acSide);
  const planform = (u: number) => {
    const z = u * semi;
    if (z <= sideZ) return { le: 0, chord: cSide };
    const za = acSide + ((z - sideZ) / exposed) * (acTipZ - acSide);
    return { le: (acLe(za) - acLe(acSide)) * spanK, chord: (acTe(za) - acLe(za)) * chordK };
  };
  // Корень передней кромки сдвигается вместе с передней вставкой фюзеляжа.
  // Высота корня — по виду спереди: средняя линия крыла у борта ниже оси фюзеляжа (A320 — AC, 737 — сетка).
  const wingRoot = v3(modelX(def.fuselage.lengthM, acLe(acSide)), P.rootY, 0);
  const wingWidth = semi * Math.cos(THREE.MathUtils.degToRad(P.dihedralDeg));
  const g = SH.gear;
  const mainX = modelX(def.fuselage.lengthM, g.noseX + g.wheelbaseM - (g.wheelbaseForwardPlugM ?? 0));
  // The Classic pivot lies aft of the clean-wing trailing edge. Retain enough
  // fixed root chord over the installed trunnion, fading into the original planform
  // before the first moving flap. The other stock types already clear the station.
  const aftJamb = mainX + (SH.id === "b737" ? .76 * g.mainR : .67);
  const atLeg = planform(g.mainZ / wingWidth);
  const extraChord = Math.max(0, aftJamb + .16 - (wingRoot.x + atLeg.le + atLeg.chord));
  const flapStart = (g.mainZ + .40 + Math.min(.70, extraChord)) / wingWidth;
  const wingPlanform = (u: number) => {
    const section = planform(u);
    if (extraChord > 0 && u < flapStart) {
      const blend = 1 - THREE.MathUtils.smoothstep(u * wingWidth, g.mainZ + .20, flapStart * wingWidth);
      section.chord += extraChord * blend;
    }
    return section;
  };
  const wingShape = (side: 1 | -1, extra: Partial<SurfaceShape> = {}): SurfaceShape => ({
    root: wingRoot,
    rootChordM: cSide,
    tipChordM: cTip,
    semiSpanM: semi,
    leadingEdgeSweepDeg: (Math.atan(tanLe) * 180) / Math.PI,
    dihedralDeg: P.dihedralDeg,
    // Видимая толщина у борта (A320 по виду спереди AC ≈0,65 м, ≈11% хорды); массовая модель берёт t/c корня из определения.
    thicknessRoot: P.thicknessRoot,
    thicknessTip: P.thicknessTip,
    side,
    planform: wingPlanform,
    ...extra,
  });
  return { wingShape, semi, engZ, sideZ, wingPlanform, wingRoot, cTip, flapStart, wingWidth, mainX };
}

function flapTrackFairing(wing: SurfaceShape, u: number, flap: number, flapSlide: THREE.Vector3) {
  const side = wing.side!;
  const c = wing.planform!(u).chord;
  const len = c * 0.72;
  const r = Math.min(0.26, 0.07 * c);
  const prof: THREE.Vector2[] = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const rr = t < 0.3 ? r * Math.sqrt(Math.max(0, 1 - ((0.3 - t) / 0.3) ** 2)) : r * (1 - Math.pow((t - 0.3) / 0.7, 1.8)) + 0.012;
    prof.push(new THREE.Vector2(Math.max(0.004, rr), t * len));
  }
  const g = new THREE.LatheGeometry(prof, 18);
  g.rotateZ(-Math.PI / 2);
  g.scale(1, 1.15, 0.6);
  const p0 = surfacePoint(wing, u, 0.5, false);
  // Верх «лодочки» утоплен в нижнюю поверхность крыла.
  g.translate(p0.x, p0.y - r * 0.55, p0.z);
  const piv = surfacePoint(wing, u, flap, false);
  g.userData.offset = v3(2.6, -0.7, 0);
  g.userData.hinge = { kind: "flap", pivot: piv, axis: new THREE.Vector3(0, 0, side), angle: (-side * 18 * Math.PI) / 180, slide: flapSlide.clone().multiplyScalar(0.35) };
  g.userData.side = side;
  return g;
}

const installationReferences = {
  cfm5b: A320CEO, cfm3b2: B737_300, leap1a: A320NEO, leap1b: B737_8,
  ps90a: TU214_PS90A, rb211: B757_RB211, pw2037: B757_PW2037,
} satisfies Partial<Record<ReturnType<typeof nacelleStyleFor>, AircraftDefinition>>;

function installedNacelle(def: AircraftDefinition, sh: ShapeSet, style: ReturnType<typeof nacelleStyleFor>) {
  const e = def.engine;
  const reference = style === "longDuct" || style === "separateFlow" || style === "cfm56-7b" ? undefined : installationReferences[style];
  const visualLength = isFleetStyle(style) ? fleetPackages[style].referenceLength : sh.nacelle.refLengthM;
  const shellLength = reference ? visualLength * e.nacelleLengthM / reference.engine.nacelleLengthM : e.nacelleLengthM;
  const width = isFleetStyle(style) ? 2 * fleetPackages[style].radius * e.nacelleWidthM / installationReferences[style].engine.nacelleWidthM : e.nacelleWidthM;
  const scale = nacelleScale(style, shellLength, width);
  // The Classic's 11.00 m nose-to-inlet dimension belongs to the base 32.18 m
  // fuselage. Apply only subsequent changes made with the fuselage-length lever.
  const inlet = style === "cfm3b2"
    ? 11 + modelX(def.fuselage.lengthM, sh.nacelle.inletX) - modelX(B737_300.fuselage.lengthM, sh.nacelle.inletX)
    : modelX(def.fuselage.lengthM, sh.nacelle.inletX);
  // Preserve the neo installation's forward offset relative to the ceo drawing.
  // Increasing the diameter must not slide the engine along the aircraft.
  const nacX = style === "leap1a" ? inlet - (A320NEO.engine.nacelleLengthM - sh.nacelle.refLengthM)*.6
    : reference ? inlet : inlet - (shellLength - sh.nacelle.refLengthM)*.6;
  const axis = sh.nacelle.axisY ?? sh.groundY + sh.nacelle.clearanceM + 2.37/2;
  return { nacX, axisY: axis + e.nacelleRaiseM, shellLength, ...scale };
}

/** Installed geometric limits in metres and percent of reverser travel. */
const fleetClearanceCache = new Map<string,number[]>();
export function installationLimits(def: AircraftDefinition) {
  const style = nacelleStyleFor(def.engine);
  if (!isFleetStyle(style)) return { raise: max757Raise(def), reverse: max757ReversePercent(def) };
  const key = JSON.stringify([style,def.shapeSet,def.fuselage.lengthM,def.fuselage.widthM,def.fuselage.shapeStretch,def.wing,def.engine.nacelleLengthM,def.engine.nacelleWidthM]);
  let gaps = fleetClearanceCache.get(key);
  if (!gaps) {
    const sh = useShapes(def);
    const mount = installedNacelle(def,sh,style);
    const { wingShape, engZ, sideZ, semi, wingPlanform } = wingGeometry(def,sh);
    const frac = def.wing.highLift.flapChordFraction;
    const flapChord = frac * wingPlanform((sideZ/semi + .77)/2).chord;
    const slide = v3(.55*flapChord,-.08*flapChord,0);
    const tracks = [.3,.45,.6,.74].map(u=>flapTrackFairing(wingShape(1),u,1-frac,slide));
    const parts = nacelleSegments(style,mount.lengthK,mount.radiusK);
    gaps = fleetMountTravel(parts,wingShape(1),mount.nacX,mount.axisY-def.engine.nacelleRaiseM,engZ,tracks);
    tracks.forEach(g=>g.dispose());
    parts.forEach(p=>p.geometry.dispose());
    if (fleetClearanceCache.size >= 48) fleetClearanceCache.delete(fleetClearanceCache.keys().next().value!);
    fleetClearanceCache.set(key,gaps);
  }
  const firstBlocked = gaps.findIndex(gap=>gap < def.engine.nacelleRaiseM);
  return { raise:gaps[0], reverse:firstBlocked < 0 ? 100 : Math.max(0,firstBlocked-1)*5 };
}

/** Vertical travel available above the reference axis at the drawing's inlet station, in metres. */
export function max757Raise(def: AircraftDefinition, reverserTravel?: number): number {
  if (def.shapeSet !== "b757") return Infinity;
  const SH = useShapes(def);
  const { wingShape, engZ } = wingGeometry(def, SH);
  const style = nacelleStyleFor(def.engine);
  if (style !== "pw2037" && style !== "rb211") return Infinity;
  const stock = style === "pw2037" ? B757_PW2037 : B757_RB211;
  const length = SH.nacelle.refLengthM * def.engine.nacelleLengthM / stock.engine.nacelleLengthM;
  const { lengthK, radiusK } = nacelleScale(style, length, def.engine.nacelleWidthM);
  return clearance757(style, modelX(def.fuselage.lengthM, SH.nacelle.inletX), SH.nacelle.axisY!, engZ,
    lengthK, radiusK, wingShape(1), reverserTravel);
}

/** Maximum whole percentage of inspection travel for the accepted installation. */
export function max757ReversePercent(def: AircraftDefinition): number {
  const raise = def.engine.nacelleRaiseM;
  if (max757Raise(def, 1) >= raise) return 100;
  let low = 0, high = 100;
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (max757Raise(def, mid / 100) >= raise) low = mid;
    else high = mid;
  }
  return low;
}

export function buildAircraft(def: AircraftDefinition, opts: BuildOptions = {}): AircraftModel {
  // Контуры типа (чертежи A320/757 или сетка 737): все «по чертежу» ниже берутся отсюда.
  const SH = useShapes(def);
  /** Коробка агрегата внутри фюзеляжа: ширина ограничена обшивкой на всех четырёх углах (иначе углы торчат наружу). */
  const hullBox = (f: FuselageShape, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) => {
    const lim = Math.min(...[x0, x1].flatMap((x) => [y0, y1].map((y) => fuselageHalfWidthAt(f, x, y) - 0.06)));
    const zz0 = Math.max(z0, -lim);
    const zz1 = Math.min(z1, lim);
    return boxAt(x0, x1, y0, y1, Math.min(zz0, zz1 - 0.05), zz1);
  };
  const root = new THREE.Group();
  const parts = new Map<string, Part>();
  const add = (
    id: string,
    geoms: THREE.BufferGeometry[],
    explode: THREE.Vector3,
    labelOffset: THREE.Vector3,
    ghost = false,
    sideSpread = 0,
  ) => {
    const group = new THREE.Group();
    group.name = id;
    for (const g of geoms) {
      const m = new THREE.Mesh(g);
      if (id === "nacelles" && isSuspensionHardware(g.userData.installationRole)) m.visible = false;
      m.userData.partId = id;
      m.userData.side = g.userData.side ?? 0;
      m.userData.offset = g.userData.offset ?? null;
      m.userData.tone = g.userData.tone ?? null;
      m.userData.spin = g.userData.spin ?? null;
      m.userData.basePos = g.userData.basePos ?? null;
      m.userData.retract = g.userData.retract ?? null;
      m.userData.deploy = g.userData.deploy ?? null;
      m.userData.hinge = g.userData.hinge ?? null;
      m.userData.hideRetracted = g.userData.hideRetracted ?? false;
      if (m.userData.basePos) m.position.copy(m.userData.basePos);
      group.add(m);
    }
    root.add(group);
    parts.set(id, { id, family: FAMILY[id] ?? "systems", group, explode, labelOffset, ghost, sideSpread });
  };
  /** Помечает геометрию стороной (+1 правая, −1 левая), чтобы половины разлетались по размаху. */
  const sided = (g: THREE.BufferGeometry, side: 1 | -1) => {
    g.userData.side = side;
    return g;
  };

  // ——— Фюзеляж ———
  const f: FuselageShape = {
    lengthM: def.fuselage.lengthM,
    widthM: def.fuselage.widthM,
    heightM: def.fuselage.heightM,
  };
  const L = f.lengthM;
  const { wingShape, semi, engZ, sideZ, wingPlanform, wingRoot, cTip, flapStart, wingWidth, mainX } = wingGeometry(def, SH);
  // Обтекатель центроплана («брюхо» под крылом) — по контуру на виде сбоку AC: от 11,4 до 21,2 м,
  // низ на 2,22 м под осью; шире фюзеляжа у корня крыла.
  const fairing = new THREE.SphereGeometry(1, 112, 64);
  fairing.userData.bellyPaint = true;
  fairing.scale(SH.fairing.sx, SH.fairing.sy, SH.fairing.sz);
  fairing.translate(modelX(L, SH.fairing.x), SH.fairing.y, 0);
  const glazing = cockpitGlazing(f);
  for (const g of glazing) if (!g.userData.tone) g.userData.tone = "glass";
  const hull = fuselageGeometry(f);
  const fixedBody: THREE.BufferGeometry[] = [hull, fairing];

  // ——— Крыло ———
  const w = def.wing;
  const tandem = def.gear.mainWheels / def.gear.mainStruts === 4;
  const fillet = wingRootFairing(wingShape(1), wingWidth, sideZ, SH.gear.mainZ, tandem,
    (x, y) => fuselageHalfWidthAt(f, x, y));
  for (const side of [1, -1] as const) {
    fixedBody.push(fillet.geometry(side));
  }
  const wingDown = v3(0, -6.5, 0);
  const both = (fn: (side: 1 | -1) => THREE.BufferGeometry) => [sided(fn(1), 1), sided(fn(-1), -1)];
  // Кессон и панели: всё, кроме подвижных частей. Предкрылки идут от борта до законцовки,
  // закрылки — от неподвижной панели над нишей до 77% полуразмаха, элероны — 77–97% (по чертежу A320).
  const uSide = sideZ / semi;
  const hl = w.highLift;
  // Без предкрылков передняя кромка — часть кессона.
  const SLAT = hl.slats ? 0.11 : 0;
  const FLAP = 1 - hl.flapChordFraction;
  // Элероны — своя хорда (26%), рычаг хорды закрылков их не трогает.
  const AIL = 0.74;
  const uFlapEnd = 0.77;
  const uTipDevices = 0.97;
  // The inboard and outboard high-lift panels terminate at the installation.
  // The fixed centre strip is schematic; keep it attached while slats translate.
  const mountStyle = nacelleStyleFor(def.engine);
  const mount = installedNacelle(def, SH, mountStyle);
  const slatBreak = SH.id === "b757" ? b757NacelleFor(def.engine).width_m / 2 + .15
    : mountStyle === "cfm56-7b" ? B737_800_NACELLE.widthM / 2 + .15
    : isFleetStyle(mountStyle) ? fleetPackages[mountStyle].radius + (mountStyle === "cfm5b" ? .35 : .15) : 0;
  const fixedLE = slatBreak > 0 ? {
    spanFrom: Math.max(uSide, (engZ - slatBreak) / wingWidth),
    spanTo: Math.min(uTipDevices, (engZ + slatBreak) / wingWidth),
  } : null;
  const slatSpans = fixedLE ? [[uSide, fixedLE.spanFrom], [fixedLE.spanTo, uTipDevices]] : [[uSide, uTipDevices]];
  const wingSeg = (u0: number, u1: number) => Math.max(4, Math.round((u1 - u0) * 48));
  const edge737 = new Map<number, ReturnType<typeof leadingEdge737>>();
  if (hl.slats && SH.id === "b737" && fixedLE) {
    for (const side of [1, -1] as const) {
      edge737.set(side, leadingEdge737(wingShape(side), uSide, fixedLE.spanFrom, fixedLE.spanTo,
        uTipDevices, def.id === "b737-300" ? 3 : 4));
    }
  }
  const boxPieces = (s: 1 | -1) => [
    ...(edge737.get(s)?.fixed ?? []),
    surfaceGeometry(wingShape(s, { chordFrom: SLAT, chordTo: FLAP, spanTo: flapStart }), 30, 32),
    surfaceGeometry(wingShape(s, { chordFrom: SLAT, chordTo: FLAP, spanFrom: flapStart }), wingSeg(flapStart, 1)),
    ...(hl.slats && fixedLE ? [surfaceGeometry(wingShape(s, { chordTo: SLAT, ...fixedLE }), wingSeg(fixedLE.spanFrom, fixedLE.spanTo), 8)] : []),
    ...(hl.slats
      ? [surfaceGeometry(wingShape(s, { chordTo: SLAT, spanTo: uSide }), 3, 8), surfaceGeometry(wingShape(s, { chordTo: SLAT, spanFrom: uTipDevices }), 2, 8)]
      : []),
    surfaceGeometry(wingShape(s, { chordFrom: FLAP, spanTo: flapStart }), 30, 24),
    surfaceGeometry(wingShape(s, { chordFrom: AIL, spanFrom: uTipDevices }), 2, 8),
    // Закрылки шире элеронов — перед элеронами остаётся полоса кессона.
    ...(FLAP < AIL - 0.005 ? [surfaceGeometry(wingShape(s, { chordFrom: FLAP, chordTo: AIL, spanFrom: uFlapEnd, spanTo: uTipDevices }), 8, 4)] : []),
  ].map((g) => sided(g, s));
  // Огни на законцовках и посадочные фары под корнем крыла.
  const tipLePt = surfacePoint(wingShape(1), 1, 0, true);
  const lights = wingtipLights(tipLePt, cTip).map(({ side, fit }) => {
    fit.geometry.userData.tone = fit.tone;
    return sided(fit.geometry, side);
  });
  for (const side of [1, -1] as const) {
    const p = surfacePoint(wingShape(side), 0.15, 0.15, false);
    const lamp = new THREE.SphereGeometry(0.1, 12, 8);
    lamp.translate(p.x, p.y - 0.03, p.z);
    lamp.userData.tone = "landing";
    lights.push(sided(lamp, side));
  }
  add("wing.box", [...boxPieces(1), ...boxPieces(-1), ...lights], wingDown, v3(-5, 2.5, -15), false, 3);

  // Механизация: при разборе предкрылки выдвигаются вперёд, закрылки и элероны — назад и вниз,
  // как при выпуске, чтобы было видно, что это отдельные агрегаты.
  const moved = (g: THREE.BufferGeometry, side: 1 | -1, offset: THREE.Vector3, deploy?: THREE.Vector3) => {
    g.userData.offset = offset;
    if (deploy) g.userData.deploy = deploy;
    return sided(g, side);
  };
  // Выпуск механизации — поворот вокруг шарнира плюс выдвижение (как на каретках):
  //   закрылки Фаулера уходят назад и отклоняются вниз до 40° (CONF FULL), предкрылки — вперёд и носком вниз до 27°.
  // hinge.pivot — точка на оси шарнира, hinge.axis — ось от корня к концу консоли, angle — угол при полном выпуске,
  // slide — выдвижение при полном выпуске. Как это зависит от доли выпуска — в pose() (main.ts).
  const hinged = (g: THREE.BufferGeometry, side: 1 | -1, offset: THREE.Vector3, kind: "flap" | "slat", u0: number, u1: number, chordAt: number, angleDeg: number, slide: THREE.Vector3) => {
    const a = surfacePoint(wingShape(side), u0, chordAt, false);
    const b = surfacePoint(wingShape(side), u1, chordAt, false);
    const axis = b.clone().sub(a).normalize();
    // Закрылок: задняя кромка вниз; предкрылок: носок вниз — повороты в разные стороны.
    const sign = kind === "flap" ? -side : side;
    g.userData.hinge = { kind, pivot: a, axis, angle: (sign * angleDeg * Math.PI) / 180, slide };
    return moved(g, side, offset);
  };
  const flapChordM = (u: number) => wingPlanform(u).chord * (1 - FLAP);
  const slatChordM = (u: number) => wingPlanform(u).chord * 0.11;
  const uMidFlap = (uSide + uFlapEnd) / 2;
  const uMidSlat = (uSide + uTipDevices) / 2;
  const flapSlide = v3(0.55 * flapChordM(uMidFlap), -0.08 * flapChordM(uMidFlap), 0);
  const slatSlide = v3(-0.45 * slatChordM(uMidSlat), -0.3 * slatChordM(uMidSlat), 0);
  // Двухщелевой закрылок: дефлектор (передние 30% хорды закрылка) и основное звено; основное звено уходит дальше и круче.
  const VANE = FLAP + 0.3 * (1 - FLAP);
  const flaps = (s: 1 | -1) =>
    hl.flapType === "double"
      ? [
          hinged(surfaceGeometry(wingShape(s, { chordFrom: FLAP, chordTo: VANE, spanFrom: flapStart, spanTo: uFlapEnd }), wingSeg(flapStart, uFlapEnd), 6), s, v3(2.3, -0.6, 0), "flap", flapStart, uFlapEnd, FLAP, 25, flapSlide.clone().multiplyScalar(0.8)),
          hinged(surfaceGeometry(wingShape(s, { chordFrom: VANE + 0.01, spanFrom: flapStart, spanTo: uFlapEnd }), wingSeg(flapStart, uFlapEnd), 8), s, v3(2.9, -0.8, 0), "flap", flapStart, uFlapEnd, VANE, 45, flapSlide.clone().multiplyScalar(1.35)),
        ]
      : [hinged(surfaceGeometry(wingShape(s, { chordFrom: FLAP, spanFrom: flapStart, spanTo: uFlapEnd }), wingSeg(flapStart, uFlapEnd), 8), s, v3(2.6, -0.7, 0), "flap", flapStart, uFlapEnd, FLAP, 40, flapSlide)];
  const highLift = (s: 1 | -1) => [
    ...(edge737.get(s)?.moving ?? (hl.slats ? slatSpans.map(([u0, u1]) => hinged(surfaceGeometry(wingShape(s, { chordTo: SLAT, spanFrom: u0, spanTo: u1 }),
      wingSeg(u0, u1), 8), s, v3(-2.2, -0.3, 0), "slat", u0, u1, SLAT, 27, slatSlide)) : [])),
    ...flaps(s),
    moved(surfaceGeometry(wingShape(s, { chordFrom: AIL, spanFrom: uFlapEnd + 0.005, spanTo: uTipDevices }), 6, 8), s, v3(2.0, 0.3, 0)),
  ];
  // Обтекатели кареток закрылков — «лодочки» под нижней поверхностью: начинаются под кессоном,
  // выходят за заднюю кромку примерно на четверть хорды; при выпуске хвостовая часть идёт вместе с закрылком.
  const fairings = [1, -1].flatMap((sd) => [0.3, 0.45, 0.6, 0.74].map((u) => flapTrackFairing(wingShape(sd as 1 | -1), u, FLAP, flapSlide)));
  add("wing.highLift", [...highLift(1), ...highLift(-1), ...fairings], wingDown, v3(7, -0.4, 13), false, 3);

  // Система управления (ATA 27): приводы механизации и рулей — показываем силовыми цилиндрами.
  const flightControlGeoms: THREE.BufferGeometry[] = [];
  const actuator = (p: THREE.Vector3, side: 1 | -1) => {
    // Привод — внутри профиля у заднего лонжерона (в собранном виде не виден, в разборе — виден).
    const g = new THREE.CylinderGeometry(0.035, 0.035, 0.5, 10);
    g.rotateZ(Math.PI / 2);
    g.translate(p.x, p.y, p.z);
    return sided(g, side);
  };
  for (const s of [1, -1] as const)
    for (const u of [0.3, 0.45, 0.6, 0.74, 0.86]) flightControlGeoms.push(actuator(surfacePoint(wingShape(s), u, 0.62, false).add(surfacePoint(wingShape(s), u, 0.62, true)).multiplyScalar(0.5), s));

  // Законцовки.
  if (w.tip === "sharklet") {
    const tipLe = surfacePoint(wingShape(1), 1, 0, true);
    const sharklet = (side: 1 | -1): SurfaceShape => ({
      root: v3(tipLe.x, tipLe.y, side * tipLe.z),
      rootChordM: cTip,
      tipChordM: cTip * 0.4,
      semiSpanM: 2.43,
      leadingEdgeSweepDeg: 38,
      dihedralDeg: 78,
      thicknessRoot: 0.09,
      thicknessTip: 0.08,
      side,
    });
    add("wingtips", both((s) => surfaceGeometry(sharklet(s), 8, 14)), v3(0, -6.5, 0), v3(0, 1.8, 2), false, 4.5);
  } else if (w.tip === "blended" && SH.id === "b737") {
    // Rounded single NG winglet. Overall span follows Boeing; height and taper
    // follow the winglet sections of the same -800 template as the wing.
    const winglet = (side: 1 | -1) => {
      const root = surfacePoint(wingShape(side), 1, 0, true);
      const run = aeroSpanM(def) / 2 - Math.abs(root.z);
      const height = 2.74;
      return surfaceGeometry({
        root, side, rootChordM: cTip, tipChordM: 0.31, semiSpanM: height,
        leadingEdgeSweepDeg: 37, dihedralDeg: 0, thicknessRoot: 0.09, thicknessTip: 0.07,
        spanPath: u => ({
          rise: height * u * u, run: run * u * (1.55 - 0.55 * u),
          angle: Math.atan2(2 * height * u, run * (1.55 - 1.10 * u)),
        }),
      }, 22, 18);
    };
    add("wingtips", both(winglet), v3(0, -6.5, 0), v3(0, 1.8, 2), false, 4.5);
  } else if (w.tip === "blended" && SH.id === "tu214") {
    // Ту-214: загнутые кверху законцовки без нижней пластины A320. Взят внешний силуэт
    // с фотографии пользователя; точный радиус сопряжения и площадь пока оценочные.
    // Почти вертикальная консоль не увеличивает расчётный размах и не меняет OEW.
    const blended = (side: 1 | -1): SurfaceShape => {
      const tip = surfacePoint(wingShape(side), 1, 0, true);
      return {
        root: tip,
        rootChordM: cTip,
        tipChordM: cTip * 0.34,
        semiSpanM: 1.8,
        leadingEdgeSweepDeg: 34,
        dihedralDeg: 88,
        thicknessRoot: 0.11,
        thicknessTip: 0.065,
        side,
      };
    };
    add("wingtips", both((s) => surfaceGeometry(blended(s), 16, 18)), v3(0, -6.5, 0), v3(0, 1.8, 2), false, 4.5);
  } else if (w.tip === "fence") {
    const tipLe = surfacePoint(wingShape(1), 1, 0, true);
    // Законцовка-«забор» A320ceo: наконечник стрелы, выступающий над и под крылом.
    const fence = (side: 1 | -1) => {
      const sh = new THREE.Shape();
      const c = cTip;
      sh.moveTo(-0.5, 0);
      sh.lineTo(0.45 * c, 0.82);
      sh.lineTo(0.95 * c, 0.82);
      sh.lineTo(1.05 * c, 0.1);
      sh.lineTo(0.95 * c, -0.55);
      sh.lineTo(0.45 * c, -0.55);
      sh.closePath();
      const g = new THREE.ExtrudeGeometry(sh, { depth: 0.06, bevelEnabled: false });
      g.translate(tipLe.x, tipLe.y, side * tipLe.z - 0.03);
      return g;
    };
    add("wingtips", both(fence), v3(0, -6.5, 0), v3(0, 1.8, 2), false, 4.5);
  }

  // Баки: кессон крыла между лонжеронами + центроплан.
  const tankGeoms = [
    ...both((s) => surfaceGeometry(wingShape(s, { chordFrom: 0.15, chordTo: 0.6, spanFrom: 0.09, spanTo: 0.82, thicknessRoot: 0.07, thicknessTip: 0.05 }), 16, 10)),
    hullBox(f, wingRoot.x + 0.9, wingRoot.x + 3.6, -1.85, -1.1, -1.6, 1.6),
  ];
  // Насосы, перегородки и линии внутри прозрачных баков — визуальное развитие той же ATA 28.
  add("fuel", [...tankGeoms, ...fuelDetails((sd) => wingShape(sd), wingRoot.x)], v3(0, -6.5 + 3.2, 0), v3(0, 1.2, 7), true, 3);

  // Противообледенение: передняя кромка внешних секций.
  add("antiIce", both((s) => surfaceGeometry(wingShape(s, { chordTo: 0.06, spanFrom: 0.3, spanTo: 0.95 }), 14, 6)), v3(-2.6, -6.5, 0), v3(-1, 0.6, 11), false, 3);

  // ——— Оперение ———
  // Привязано к концу фюзеляжа по чертежу: корень ПК стабилизатора (на оси) за 6,4 м до конца,
  // сужение 0,30, стреловидность ПК ≈ 34°; киль — корень ПК за 7,67 м до конца, хорды 5,27/1,92 м
  // (сужение 0,364), стреловидность ПК 39,6°, руль ≈ 32 % хорды, форкиль от 28,7 м.
  const ht = def.htail;
  const htSemi = ht.spanM / 2;
  // По виду сверху AC: сужение 0,315, стреловидность ПК ≈33°, корень ПК на оси за 6,07 м до конца фюзеляжа.
  const H_ = SH.htail;
  const htTaper = (H_.te.slope * H_.tipZ + H_.te.x0 - (H_.le.slope * H_.tipZ + H_.le.x0)) / (H_.te.x0 - H_.le.x0);
  const htCr = (2 * ht.areaM2) / (ht.spanM * (1 + htTaper));
  const htLe = (Math.atan(H_.le.slope) * 180) / Math.PI;
  const htX = L - (SH.baseLengthM - H_.le.x0);
  const htSec = fuselageSection(f, htX + htCr * 0.5);
  const htShape = (side: 1 | -1, extra: Partial<SurfaceShape> = {}): SurfaceShape => ({
    root: v3(htX, htSec.cy + 0.1, 0),
    rootChordM: htCr,
    tipChordM: htCr * htTaper,
    semiSpanM: htSemi,
    leadingEdgeSweepDeg: htLe,
    dihedralDeg: H_.dihedralDeg,
    thicknessRoot: ht.thicknessPct / 100,
    thicknessTip: 0.09,
    side,
    ...extra,
  });
  // Рули высоты и направления входят в массу оперения (Raymer), поэтому принадлежат ему.
  add(
    "htail",
    [
      ...both((s) => surfaceGeometry(htShape(s, { chordTo: 0.66 }))),
      ...both((s) => moved(surfaceGeometry(htShape(s, { chordFrom: 0.66, spanFrom: 0.12 }), 12, 6), s, v3(0.8, 0, 0))),
    ],
    v3(6, 1.2, 0),
    v3(1.5, 1.8, 4),
    false,
    1.5,
  );
  for (const s of [1, -1] as const) flightControlGeoms.push(actuator(surfacePoint(htShape(s), 0.35, 0.55, false).add(surfacePoint(htShape(s), 0.35, 0.55, true)).multiplyScalar(0.5), s));

  const vt = def.vtail;
  // По виду сбоку AC: корень ПК на уровне верха фюзеляжа за 7,67 м до конца, стреловидность ПК ≈41°,
  // задней кромки ≈12,5°, высота над верхом фюзеляжа 5,83 м, сужение 0,33. Хорды масштабируются по площади.
  // Киль — по таблице кромок с вида сбоку AC (с форкилем), без аппроксимации прямыми. Корень опущен ниже
  // обшивки по всей хорде (верх хвостового конуса снижается к задней кромке), чтобы не было щели на стыке.
  const A_VT = SH.vtail;
  const T = A_VT.table;
  const tabAt = (arr: number[], y: number) => {
    const ys = T.y;
    if (y <= ys[0]) return arr[0];
    if (y >= ys[ys.length - 1]) return arr[arr.length - 1];
    let i = 0;
    while (ys[i + 1] < y) i++;
    return arr[i] + ((arr[i + 1] - arr[i]) * (y - ys[i])) / (ys[i + 1] - ys[i]);
  };
  const FILLET_START_X = A_VT.filletX;
  // Ниже начала таблицы передняя кромка форкиля продолжает свою кривую вниз (уходит внутрь фюзеляжа) —
  // иначе на высоте верха фюзеляжа появляется горизонтальное «ребро» по всей хорде.
  const LE_Y0 = A_VT.leY0;
  const leSlope0 = (tabAt(T.le, LE_Y0 + 0.1) - tabAt(T.le, LE_Y0)) / 0.1;
  const leAc = (y: number) => (y < LE_Y0 ? tabAt(T.le, LE_Y0) - (LE_Y0 - y) * leSlope0 : tabAt(T.le, y));
  void FILLET_START_X;
  const teAc = (y: number) => (y < T.y[0] ? tabAt(T.te, T.y[0]) + A_VT.te.slope * (y - T.y[0]) : tabAt(T.te, y));
  const leLin = (y: number) => A_VT.le.slope * y + A_VT.le.x0;
  const teLin = (y: number) => A_VT.te.slope * y + A_VT.te.x0;
  const shiftX = L - SH.baseLengthM;
  const kH = vt.spanM / A_VT.refSpanM;
  const vtScale = Math.sqrt(vt.areaM2 / A_VT.refAreaM2);
  // Корень: на 5 см ниже самой низкой точки верха фюзеляжа под хордой.
  let yLow = 3;
  for (let x = FILLET_START_X + 0.5; x <= teAc(1.7); x += 0.25) {
    const sec = fuselageSection(f, x + shiftX);
    yLow = Math.min(yLow, sec.cy + sec.hh - 0.05);
  }
  const yTip = A_VT.tipY;
  const vtSpanAc = yTip - yLow;
  const yOf = (u: number) => yLow + u * vtSpanAc;
  const vtPlanform = (u: number) => {
    const y = yOf(u);
    const le = leAc(y);
    const chord = (teAc(y) - le) * vtScale;
    const lin = teLin(y) - leLin(y);
    // У форкиля хорда длиннее — относительная толщина уменьшается, абсолютная остаётся как у киля.
    return { le: (le - leAc(yLow)) * kH, chord, thickness: (vt.thicknessPct / 100) * Math.min(1, lin / (teAc(y) - le)) * (1 - 0.1 * u) };
  };
  const vtX = leAc(yLow) + shiftX;
  const vtCr = (teAc(yLow) - leAc(yLow)) * vtScale;
  const vtRootY = yLow;
  const vtShape = (extra: Partial<SurfaceShape> = {}): SurfaceShape => ({
    root: v3(vtX, yLow, 0),
    rootChordM: vtCr,
    tipChordM: (teAc(yTip) - leAc(yTip)) * vtScale,
    semiSpanM: vtSpanAc * kH,
    leadingEdgeSweepDeg: 0,
    dihedralDeg: 90,
    thicknessRoot: vt.thicknessPct / 100,
    thicknessTip: 0.09,
    side: 1,
    planform: vtPlanform,
    uvSides: true,
    // Профиль основного киля сохраняется до корня (место максимальной толщины — на 30% его хорды),
    // а наплыв форкиля впереди — плавно утончающаяся вытянутая носовая часть.
    halfThickness: (u: number, v: number) => {
      const y = yOf(u);
      const le = leAc(y);
      const te = teAc(y);
      const lin = (teLin(y) - leLin(y)) * vtScale;
      const xMax = Math.max(le + 0.05, leLin(y) + 0.3 * (teLin(y) - leLin(y)));
      const x = le + v * (te - le);
      const vv = x <= xMax ? (0.3 * (x - le)) / (xMax - le) : 0.3 + (0.7 * (x - xMax)) / (te - xMax);
      return nacaHalfThickness(Math.max(1e-4, vv), (vt.thicknessPct / 100) * (1 - 0.1 * u)) * lin;
    },
    ...extra,
  });
  // Руль направления: ось — прямая на 68% хорды основного киля (не наплыва), низ руля чуть выше обшивки.
  const hinge = (u: number) => {
    const y = yOf(u);
    const le = leAc(y);
    const xh = leLin(y) + 0.68 * (teLin(y) - leLin(y));
    return Math.min(0.95, (xh - le) / (teAc(y) - le));
  };
  const uRudder = Math.max(0.02, (fuselageSection(f, teAc(2.0) + shiftX).cy + fuselageSection(f, teAc(2.0) + shiftX).hh + 0.12 - yLow) / vtSpanAc);
  const rudder = surfaceGeometry(vtShape({ spanFrom: uRudder, spanTo: 0.94, hingeAt: hinge, hingeSide: "control" }), 18, 8);
  rudder.userData.offset = v3(0.8, 0, 0);
  add(
    "vtail",
    [
      surfaceGeometry(vtShape({ spanTo: uRudder }), 4, 28),
      surfaceGeometry(vtShape({ spanFrom: uRudder, spanTo: 0.94, hingeAt: hinge, hingeSide: "fixed" }), 36, 28),
      surfaceGeometry(vtShape({ spanFrom: 0.94 }), 3, 28),
      rudder,
    ],
    v3(2.5, 5.5, 0),
    v3(1.5, 2.2, 1.5),
  );
  const rudderAct = new THREE.CylinderGeometry(0.07, 0.07, 0.8, 10);
  rudderAct.rotateZ(Math.PI / 2);
  rudderAct.translate(vtX + vtCr * 0.75, vtRootY + 1.6, 0);
  flightControlGeoms.push(rudderAct);
  add("flightControls", flightControlGeoms, v3(0, -9.5, 0), v3(-4, -2.5, -13), false, 4);

  // ——— Двигатели и гондолы ———
  // По чертежу и AC: срез воздухозаборника на 11,2 м от носа, ось на 5,65 м от оси самолёта.
  // Положение двигателя не зависит от размаха: его диктуют клиренс и стойки шасси.
  const e = def.engine;
  // По AC 2-2-0: ось двигателя на 5,75 м от оси самолёта; срез воздухозаборника CFM56 — 11,76 м от носа,
  // у более длинной гондолы LEAP — 11,38 м (гондола растёт вперёд, сопло остаётся на месте).
  const lePoint = surfacePoint(wingShape(1), engZ / semi, 0, false);
  const R = e.nacelleWidthM / 2;
  const style = nacelleStyleFor(e);
  const ps90a = style === "ps90a";
  const rb211 = style === "rb211";
  const pw2037 = style === "pw2037";
  const { nacX, axisY, shellLength, lengthK, radiusK } = mount;
  const wingLow = surfacePoint(wingShape(1), engZ / semi, 0.2, false).y;
  const groundY = SH.groundY;
  const nacelleParts: THREE.BufferGeometry[] = [];
  const pylonSpec = pylonFor(style);
  for (const side of [1, -1] as const) {
    const reverserOrigin = v3(nacX, axisY, side * engZ);
    const segments = nacelleSegments(style, lengthK, radiusK);
    const wingAt = (u: number) => surfacePoint(wingShape(side), engZ / semi, u, false).sub(reverserOrigin);
    // Пилон: от верха гондолы к нижней поверхности крыла, передняя кромка скошена.
    let pg: THREE.BufferGeometry | undefined;
    if (rb211 || pw2037) {
      // Rounded strut fairing in the common Boeing side view. Carry the aft
      // end inside the wing and the lower edge inside the reverser housing.
      const strut = new THREE.Shape();
      const x = (station: number) => nacX + station * lengthK;
      const low = axisY + R * 0.64;
      const front = axisY + R;
      // Seat the beveled nose in the thickness of the intake wall. The deeper
      // attachment starts aft of the fan, where the reverser meets the strut.
      const inletFoot = axisY + R * 0.91;
      const forwardMount = surfacePoint(wingShape(side), engZ / semi, 0.08, false);
      const aft = surfacePoint(wingShape(side), engZ / semi, rb211 ? 0.18 : 0.31, false);
      strut.moveTo(x(0.65), inletFoot);
      strut.bezierCurveTo(x(0.73), front + 0.10, x(1.00), front + 0.24, x(1.40), front + 0.25);
      strut.bezierCurveTo(x(2.15), front + 0.27, lePoint.x - 0.48, forwardMount.y - 0.12, forwardMount.x, forwardMount.y + 0.04);
      strut.lineTo(aft.x, aft.y + 0.13);
      if (pw2037) {
        // The PW strut follows the narrower exposed core aft of the fan nozzle.
        strut.quadraticCurveTo(aft.x - 0.10, aft.y - 0.18, x(5.85), axisY + 0.38 * R);
        strut.lineTo(x(3.55), low);
      } else {
        // The common exhaust is open. Terminate the foot on the reverser and
        // take the aft fairing up to the wing above the exhaust exterior.
        const shoulderY = axisY + 1.08 * radiusK;
        strut.quadraticCurveTo(aft.x - 0.12, Math.max(shoulderY, aft.y - 0.12), x(4.32), shoulderY);
        strut.lineTo(x(4.05), axisY + 1.02 * radiusK);
        strut.lineTo(x(3.65), axisY + 1.08 * radiusK);
        strut.lineTo(x(2.55), axisY + 1.18 * radiusK);
      }
      strut.lineTo(x(2.0), inletFoot);
      strut.closePath();
      pg = new THREE.ExtrudeGeometry(strut, { depth: 0.28 * radiusK, bevelThickness: 0.06 * radiusK,
        bevelSize: 0.055 * radiusK, bevelSegments: 4, curveSegments: 20 });
      pg.translate(0, 0, side * engZ - 0.14 * radiusK);
      if (pw2037) pg.userData.tone = "detailPanel";
    } else if (ps90a) {
      // The plan view shows a narrow rounded fairing from behind the intake
      // to the wing underside. Both attachment rings intersect their hosts.
      const upper = surfacePoint(wingShape(side), engZ / semi, 0.18, false);
      const lowerX = nacX + 1.12 * lengthK;
      const lowerY = axisY + 0.86 * R;
      const rootChordM = 3.70 * lengthK;
      const tipChordM = upper.x - lePoint.x + 1.07 * lengthK;
      const heightM = upper.y + 0.12 - lowerY;
      pg = surfaceGeometry({
        root: v3(lowerX, lowerY, side * engZ),
        rootChordM, tipChordM, semiSpanM: heightM,
        leadingEdgeSweepDeg: THREE.MathUtils.radToDeg(Math.atan2(lePoint.x - 1.05 * lengthK - lowerX, heightM)),
        dihedralDeg: 90, thicknessRoot: 0.12, thicknessTip: 0.13,
      }, 14, 32);
      // Follow the narrowing cowl instead of leaving a gap below the aft pylon.
      const points = pg.getAttribute("position");
      for (let i = 0; i < points.count; i++) {
        const u = (points.getY(i) - lowerY) / heightM;
        const chordM = THREE.MathUtils.lerp(rootChordM, tipChordM, u);
        const leadingX = THREE.MathUtils.lerp(lowerX, lePoint.x - 1.05 * lengthK, u);
        const v = (points.getX(i) - leadingX) / chordM;
        points.setY(i, points.getY(i) - 0.38 * R * v * (1 - u));
      }
      pg.computeVertexNormals();
    } else if (!pylonSpec) {
      const pyl = new THREE.Shape();
      const x0 = nacX + 0.9 * lengthK;
      const x1 = lePoint.x + 2.4;
      const yb = axisY + R * 0.75;
      const yt = wingLow + 0.15;
      pyl.moveTo(x0, yb);
      pyl.lineTo(x1 + 0.6, yb + 0.25);
      pyl.lineTo(x1, yt);
      pyl.lineTo(x0 + 1.2, yt);
      pyl.closePath();
      pg = new THREE.ExtrudeGeometry(pyl, { depth: 0.32, bevelEnabled: false });
      pg.translate(0, 0, side * engZ - 0.16);
    }
    if (pylonSpec && pg) {
      // Keep the drawing-registered 757 and Tu-214 side silhouettes. Round
      // their fairings in plan while retaining the existing intake/nozzle clearance.
      const vertices = pg.getAttribute("position");
      pg.computeBoundingBox();
      const bounds = pg.boundingBox!;
      for (let i=0; i<vertices.count; i++) {
        const x=vertices.getX(i), z=vertices.getZ(i) - side*engZ;
        const t=THREE.MathUtils.inverseLerp(bounds.min.x,bounds.max.x,x);
        const scale = rb211 || pw2037 ? (1-.66*THREE.MathUtils.smoothstep(t,.56,1)) : (.86+.14*Math.sin(t*Math.PI));
        vertices.setZ(i, side*engZ + z*scale);
      }
      pg.boundingBox = null;
      pg.computeVertexNormals();
    }
    const localPylon = pg && pylonSpec ? pg.translate(-nacX, -axisY, -side * engZ) : undefined;
    const installation = pylonSpec && installationGeometry(pylonSpec, segments, lengthK, radiusK, wingAt, localPylon);
    if (installation) pg = installation.fairing.translate(nacX, axisY, side * engZ);
    const shells = segments.flatMap(seg => {
      if (pylonSpec && (seg.id === "fanCowl" && pylonSpec.cowlPanels !== "undivided" ||
          seg.id === "coreCowl" && pylonSpec.coreHingeStations)) {
        const doors = cowlDoors(seg.geometry, pylonSpec.cowlPanels === "quarters");
        seg.geometry.dispose();
        return doors.map(geometry => ({ id: seg.id, geometry }));
      }
      return [seg];
    });
    for (const seg of shells) {
      seg.geometry.userData.installationRole ??= "skin";
      seg.geometry.translate(nacX, axisY, side * engZ);
      const motion = seg.geometry.userData.reverserMotion;
      if (motion && (motion.role === "sleeve" || motion.role === "blocker")) {
        seg.geometry.userData.reverserOrigin = reverserOrigin;
      }
      if (((ps90a || rb211 || style === "cfm56-7b") && seg.id === "nozzle") || seg.id === "lip") seg.geometry.userData.tone = "detailSteel";
      if (pw2037 && seg.id === "coreCowl") seg.geometry.userData.tone = "detailSteel";
      if (pw2037 && (seg.id === "nozzle" || seg.id === "plug")) seg.geometry.userData.tone = "detailDark";
      if (seg.id === "bypassLiner") seg.geometry.userData.tone = "detailDark";
      // При разборе сегменты расходятся вдоль оси — видно, из чего состоит гондола.
      const spread: Record<NacelleSegment["id"], number> = { lip: -1.2, inlet: -1.2, fanCowl: -0.4, reverser: 0.4, bypassLiner: 0.4, nozzle: 1.2, coreCowl: 1.2, plug: 1.8 };
      seg.geometry.userData.offset = v3(spread[seg.id], 0, 0);
      nacelleParts.push(sided(seg.geometry, side));
    }
    nacelleParts.push(sided(pg!, side));
    for (const detail of installation?.hardware ?? []) {
      if (detail.userData.installationRole.startsWith("door")) {
        detail.userData.panelOffset = detail.userData.panelSection === "core" ? 1.2 : -.4;
      }
      detail.translate(nacX, axisY, side * engZ);
      nacelleParts.push(sided(detail, side));
    }
  }
  add("nacelles", nacelleParts, v3(0, -10.5, 0), v3(-1.5, -1.6, 3), false, 3);
  // Двигатель — разрез: детали построены вокруг своей оси, чтобы роторы могли вращаться.
  // Положение оси хранится в basePos, разлёт деталей вдоль оси — в offset.
  const engineGeoms: THREE.BufferGeometry[] = [];
  const engineBareLength = ps90a ? (4.964 / 1.1) * lengthK : e.fanDiameterM * (1.7 + (0.09 * Math.max(0, e.bypassRatio - 5.7)) / 5.3);
  const fanOffset = isFleetStyle(style) ? .14 * engineBareLength : pw2037 ? .10 * engineBareLength : .1;
  // EASA E.061 §III.4 measures the -535E4 from spinner nose to common nozzle.
  const spinnerX = rb211 ? shellLength - 5.0359 * lengthK : nacelleFanFace(style, lengthK) - fanOffset;
  const pieces = engineCutaway({
    fanDiameterM: e.fanDiameterM,
    fanStyle: rb211 || pw2037 || isFleetStyle(style) ? style : undefined,
    bypassRatio: e.bypassRatio,
    // Длина «голого» двигателя по AC: CFM56-5B 2,94 м (1,70 диаметра вентилятора), LEAP-1A 3,55 м (1,79).
    lengthM: engineBareLength,
    ...e.architecture,
    gearbox: e.cycle.gearbox,
  }, { spinnerX, lengthK, radiusK });
  for (const side of [1, -1] as const) {
    const basePos = v3(nacX + spinnerX, axisY, side * engZ);
    for (const p of pieces) {
      const g = p.geometry.clone();
      g.userData = { ...p.geometry.userData, side, tone: p.tone, spin: p.spin, offset: p.offset, basePos };
      engineGeoms.push(g);
    }
    // Внешние кольца ядра, коллектор подачи и коробка приводов — неподвижные детали.
    for (const accessory of engineAccessories(engineBareLength, coreRadiusFor(e.fanDiameterM / 2, e.bypassRatio), !e.architecture.combustor && !isFleetStyle(style))) {
      accessory.userData = { side, tone: accessory.userData.tone, spin: null, offset: v3(0, 0, 0), basePos };
      engineGeoms.push(accessory);
    }
  }
  add("engines", engineGeoms, v3(-6.5, -10.5, 0), v3(-2.5, -2.4, 2), false, 3);

  // Ground contact fixes the parked axle height. Each hinge is anchored at the
  // existing wing or body station and also serves as the pivot of the detailed parts.
  const G = SH.gear;
  const wingMidAt = (z: number) => {
    return wingRoot.y + z * Math.sin(THREE.MathUtils.degToRad(SH.wing.dihedralDeg));
  };
  const wingSkinY = (x: number, z: number, upper: boolean) => {
    const u = z / wingWidth, { le, chord } = wingPlanform(u);
    const chordPos = Math.max(0, Math.min(1, (x - wingRoot.x - le) / chord));
    return surfacePoint(wingShape(1), u, chordPos, upper).y;
  };
  // The aft end of the trunnion lies under a thinner part of the root than its centre.
  // Seat the whole bearing under the fixed roof, retaining the axle/ground datum.
  const gauge = G.mainR / .584;
  const bearingLimit = wingSkinY(mainX + .25 * gauge, G.mainZ - .125 * gauge, true) - .125 * gauge - .045;
  const pivotY = Math.min(wingMidAt(G.mainZ), bearingLimit);
  const anchorY = wingMidAt(G.mainZ - 1.35 * (G.mainZ / 3.795));
  const profile = SH.id;
  const airbusDoors = profile === "a320";
  // Close the panels against the installed surfaces (including the centre-section fairing),
  // not against a flat datum. Keep small seams and clearance to prevent coincident faces.
  const belly = (x: number, z: number) => {
    const { hw, hh, cy } = fuselageSection(f, x);
    if (z > hw) return Infinity;
    let low = cy - hh, high = cy;
    for (let i = 0; i < 12; i++) {
      const mid = (low + high) / 2;
      if (fuselageHalfWidthAt(f, x, mid) < z) low = mid; else high = mid;
    }
    return low;
  };
  const mainSkin = (x: number, z: number) => {
    const B = SH.fairing;
    const section = Math.max(0, 1 - ((x - modelX(L, B.x)) / B.sx) ** 2);
    const wy = wingSkinY(x, z, false);
    const shell = Math.min(wy, belly(x, z));
    // The coarse centre-section ellipsoid ends in a vertical rim above the wing.
    // Fair the moving panel around that rim with a tangent cubic instead of
    // jumping across the open edge from the bottom of the fairing to the wing.
    const edge = B.sz * Math.sqrt(section), mix = .75;
    const start = edge * mix, end = edge + .45;
    let fairingY = Infinity;
    if (edge > 0 && z <= start) {
      fairingY = B.y - B.sy * Math.sqrt(section - (z / B.sz) ** 2);
    } else if (edge > 0 && z < end) {
      const root = Math.sqrt(section * (1 - mix ** 2));
      const y0 = B.y - B.sy * root;
      const slope = B.sy * start / (B.sz ** 2 * root);
      const t = (z - start) / (end - start);
      fairingY = THREE.MathUtils.lerp(y0, wy, t * t * (3 - 2 * t))
        + slope * (end - start) * t * (1 - t) ** 2;
    }
    return Math.min(shell, fairingY) - (airbusDoors ? 0 : .014);
  };
  const mainGear = profile === "b737" ? { ...G, retractDeg: boeing737StowAngle(G, pivotY, mainX, groundY, mainSkin) } : G;
  // The folded wheel is in the belly, inboard of the visible root junction.
  // From the sidewall outwards the well roof stays inside the fillet and wing.
  const retractAngle = THREE.MathUtils.degToRad(G.retractDeg);
  const legLength = pivotY - groundY - G.mainR;
  const stowedTyreTop = pivotY - (legLength - G.mainR) * Math.cos(retractAngle)
    + (G.mainWheelGap + G.mainTireW / 2) * Math.sin(retractAngle);
  const bayTop = (x: number, z: number) => {
    const wing = wingSkinY(x, z, true);
    const outside = wing + fillet.rise(x, z);
    // Under the cabin, seat the roof just above the stowed tyre. Start the
    // transition well inside the barrel so the liner cannot pierce the lap.
    const inboard = 1 - THREE.MathUtils.smoothstep(z, sideZ - .38, sideZ - .17);
    return THREE.MathUtils.lerp(outside, Math.max(SH.cabin.floorY, stowedTyreTop + .07), inboard);
  };
  const wellSkin = {
    roof: (x: number, z: number) => bayTop(x, z) - .035,
    lower: (x: number, z: number) => wingSkinY(x, z, false),
    trailingEdge: (z: number) => {
      const { le, chord } = wingPlanform(z / wingWidth);
      return wingRoot.x + le + chord;
    },
  };
  const legs = ([1, -1] as const).flatMap(side => {
    const pivot = v3(mainX, pivotY, side * G.mainZ);
    return [...mainLandingGear(mainGear, side, pivot, groundY, anchorY, tandem, profile),
      ...mainDoors(profile, mainGear, side, pivot, mainSkin, groundY, wellSkin)];
  });
  // The cheek is fixed to the wing/body, including when the gear is selected or exploded.
  const gearParts: THREE.BufferGeometry[] = [];
  for (const g of legs) {
    if (g.userData.fixedWingBody) {
      fixedBody.push(g);
    } else gearParts.push(g);
  }
  add("gear.main", gearParts, v3(0, -9, 0), v3(9, -2.5, -4));
  const nose = noseLandingGear(G, groundY, profile);
  nose.push(...noseDoors(profile, G, nose[0].userData.basePos, (x, z) => belly(x, z) - .014));
  const bayOpenings = (geometries: THREE.BufferGeometry[]) => geometries.flatMap(g =>
    g.userData.bayOpening ? [g.userData.bayOpening as BayOpening] : []);
  // Adjacent doors close one stepped bay. Keep the outer jambs, but do not
  // leave strips of fixed wing or belly skin between the moving panels.
  const mainOpenings = profile === "b737" ? bayOpenings(legs) : ([1, -1] as const).flatMap(side => {
    const panels = legs.filter(g => g.userData.side === side && g.userData.bayOpening);
    const wheel = panels.find(g => g.name === "main-body-door")!.userData.bayOpening as BayOpening;
    const leg = panels.filter(g => g.name !== "main-body-door");
    // The inner return of the tandem wing door sweeps past the nominal pin.
    const hingeRelief = tandem ? .030 : 0;
    const outer = Math.max(...leg.map(g => Math.max(Math.abs(g.userData.bayOpening.z0), Math.abs(g.userData.bayOpening.z1)))) + DOOR_RIM_INSET + hingeRelief;
    // Door skins have a swept thickness at the fore and aft jambs.
    // The fixed apron supplies the return around the resulting relief.
    const jamb = DOOR_RIM_INSET + .013;
    // Keep the fixed strip between the body-door hinges continuous at the
    // skin datum. A narrow running seam lets the inner return rotate past it.
    const hingeCut = DOOR_RIM_INSET + .007;
    const wheelCut = { ...wheel, x0: wheel.x0 - jamb, x1: wheel.x1 + jamb,
      z0: wheel.z0 - (side === 1 ? hingeCut : jamb), z1: wheel.z1 + (side === 1 ? jamb : hingeCut) };
    return [wheelCut, {
      x0: Math.max(...leg.map(g => g.userData.bayOpening.x0)) - jamb,
      x1: Math.min(...leg.map(g => g.userData.bayOpening.x1)) + jamb,
      z0: side === 1 ? wheel.z1 : -outer,
      z1: side === 1 ? outer : wheel.z0,
    }];
  });
  // The outer fuselage wall inside the fixed fillet is shared with the well.
  // Clip against the fillet at each station rather than cutting a flat notch
  // above the wing. Keep a small overlap between the two exterior skins.
  const buriedCut = (x: number, y: number, z: number) =>
    bayTop(x, Math.abs(z)) - .045 - y;
  const sideCuts = mainOpenings.map(o => ({ ...o, ceiling: buriedCut }));
  // Inside the barrel the tyre chamber is wider than its exterior door.
  // Remove hidden shell only below its roof. The permanent wheel-well liner
  // becomes the inside wall and the wing/body fillet remains intact above it.
  const innerPockets = legs.flatMap(g => {
    const p = g.userData.wingPocket as BayOpening | undefined;
    if (!p) return [];
    const z0 = Math.max(p.z0, -sideZ), z1 = Math.min(p.z1, sideZ);
    if (z0 >= z1) return [];
    return [{ ...p, z0, z1, ceiling: (x: number, y: number, z: number) => Math.min(
      p.ceiling?.(x, y, z) ?? Infinity,
      wellSkin.roof(x, Math.abs(z)) - .025 - y,
      y - mainSkin(x, Math.abs(z)) - .025,
    ) }];
  });
  cutBayOpenings(hull, [...bayOpenings(nose), ...sideCuts, ...innerPockets], true);
  cutBayOpenings(fairing, [...sideCuts, ...innerPockets], false);
  for (const mesh of parts.get("wing.box")!.group.children as THREE.Mesh[]) {
    if (!mesh.geometry.getAttribute("uv")) continue;
    cutBayOpenings(mesh.geometry, mainOpenings, true);
    // The wheel bay also passes through the buried upper wing inside the barrel.
    cutBayOpenings(mesh.geometry, sideCuts, false);
    if (innerPockets.length) cutBayOpenings(mesh.geometry, innerPockets, false);
  }
  // The lamp seats on the final fixed exterior, including the lip at the
  // front of the wheel bay. The moving doors are never mounting surfaces.
  const fittings = fuselageFittings(f, { aircraftId: def.id, lowerBeaconSkins: fixedBody }).map(({ geometry, tone }) => {
    geometry.userData.tone = tone;
    return geometry;
  });
  add("fuselage", [hull, fairing, ...glazing, ...fittings, ...fixedBody.slice(2)], v3(0, 0, 0), v3(7, 2.6, 3));
  add("gear.nose", nose, v3(-2.5, -8, 0), v3(-1.5, -1.4, -1.5));

  // ——— Бортовые системы (внутри фюзеляжа, при разлёте поднимаются над ним ярусами) ———
  add("avionics", avionicsRack(2.95), v3(0, 6.5, 0), v3(-1, 1, -1.5));
  add("instruments", instrumentPanel(3.0), v3(-1.5, 8.2, 0), v3(-1.2, 1, 1.5));
  add("electrical.generation", electricalBay(5.4), v3(0, 6.5, 0), v3(0, 1, 1.8));
  // Бортовая кабельная сеть: трассы жгутов (над потолком салона, под полом, в крыло к двигателю, в киль, в нос),
  // каждый жгут — пучок отдельных проводов с хомутами. Число проводов в пучке ∝ массе сети: облегчение убирает
  // дублирующие провода. Все точки трасс вписаны внутрь обшивки.
  const inHull = (p: THREE.Vector3, margin = 0.18) => {
    const x = Math.min(L - 1, Math.max(0.5, p.x));
    const sec = fuselageSection(f, x);
    const y = Math.min(sec.cy + sec.hh - margin, Math.max(sec.cy - sec.hh + margin, p.y));
    const zMax = Math.max(0, fuselageHalfWidthAt(f, x, y) - margin);
    return v3(x, y, Math.sign(p.z) * Math.min(Math.abs(p.z), zMax));
  };
  const strands = Math.max(2, Math.round(12 * (opts.harnessShare ?? 1)));
  const bundle = (pts: THREE.Vector3[], fit = true): THREE.BufferGeometry => {
    // Поле внутри обшивки: опорные точки и каждая точка сглаженной трассы — с запасом на радиус пучка.
    const keep = (p: THREE.Vector3) => (fit ? inHull(p, 0.32) : p);
    const curve = new THREE.CatmullRomCurve3(pts.map(keep), false, "centripetal");
    const len = curve.getLength();
    const n = Math.max(8, Math.round(len / 0.25));
    const frames = curve.computeFrenetFrames(n, false);
    const rb = 0.02 + 0.011 * Math.sqrt(strands);
    const out: THREE.BufferGeometry[] = [];
    for (let k = 0; k < strands; k++) {
      const ring = k === 0 ? 0 : k <= 6 ? rb * 0.6 : rb;
      const a0 = (k * 2.399) % (Math.PI * 2);
      const pts2: THREE.Vector3[] = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        // Лёгкая скрутка пучка — провода видны как отдельные жилы.
        const a = a0 + t * len * 0.8;
        pts2.push(
          keep(curve.getPointAt(t))
            .addScaledVector(frames.normals[i], Math.cos(a) * ring)
            .addScaledVector(frames.binormals[i], Math.sin(a) * ring),
        );
      }
      out.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts2), n, 0.013, 5, false).toNonIndexed());
    }
    // Хомуты через ~1,2 м.
    for (let d = 0.6; d < len; d += 1.2) {
      const t = d / len;
      const c = new THREE.TorusGeometry(rb + 0.01, 0.006, 4, 12);
      const tan = curve.getTangentAt(t);
      c.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(v3(0, 0, 1), tan));
      const p = keep(curve.getPointAt(t));
      c.translate(p.x, p.y, p.z);
      out.push(c.toNonIndexed());
    }
    return mergeGeometries(out)!;
  };
  const harness: THREE.BufferGeometry[] = [];
  const aftEnd = L - 4;
  for (const side of [1, -1] as const) {
    const z = side * 1.15;
    // Над потолком салона: от кабины до хвоста, с ответвлением вверх в киль.
    harness.push(bundle([v3(2.6, 0.9, side * 0.5), v3(4.5, 1.3, z * 0.85), v3(12, 1.4, z * 0.9), v3(24, 1.4, z * 0.9), v3(aftEnd, 1.2, z * 0.5)]));
    // Под полом: от отсека авионики до хвостового отсека.
    harness.push(bundle([v3(3.2, -0.9, side * 0.4), v3(6, -0.85, z), v3(16, -0.85, z), v3(26, -0.85, z), v3(L - 6.5, -0.7, side * 0.5)]));
    // В крыло: из-под пола вдоль переднего лонжерона к пилону двигателя и дальше к законцовке.
    const mid = (u: number) => surfacePoint(wingShape(side), u, 0.18, true).add(surfacePoint(wingShape(side), u, 0.18, false)).multiplyScalar(0.5);
    harness.push(bundle([inHull(v3(wingRoot.x + 1.5, -0.85, z)), mid(0.12), mid(0.25), mid(engZ / semi), mid(0.6), mid(0.95)], false));
    // Ответвление к двигателю — вниз по пилону.
    const pyl = mid(engZ / semi);
    if (rb211 || pw2037) {
      const mountU = engZ / semi;
      const entryV = rb211 ? 0.10 : 0.18;
      const wingEntry = surfacePoint(wingShape(side), mountU, entryV, false);
      wingEntry.z = side * engZ;
      // Route the RB branch through the middle of the strut and into the
      // fan cowl, ahead of the exposed shoulder of the common nozzle.
      const engineEntry = v3(nacX + (rb211 ? 2.95 : 4.05) * lengthK, axisY + R * (rb211 ? 0.95 : 0.66), side * engZ);
      const upperEntry = surfacePoint(wingShape(side), mountU, entryV, true).lerp(wingEntry, 0.5);
      const middle = wingEntry.clone().lerp(engineEntry, 0.5);
      if (rb211) middle.y += 0.08 * radiusK;
      const route = rb211 ? [pyl, upperEntry, wingEntry, middle, engineEntry] : [pyl, wingEntry, middle, engineEntry];
      harness.push(bundle(route, false));
    } else if (ps90a) {
      const insideWing = mid(engZ / semi);
      insideWing.x -= 0.60 * lengthK;
      harness.push(bundle([pyl, insideWing, v3(nacX + 3.30 * lengthK, axisY + R * 0.77, side * engZ),
        v3(nacX + 2.80 * lengthK, axisY + R * 0.52, side * engZ)], false));
    } else {
      harness.push(bundle([pyl, v3(pyl.x - 0.6, axisY + R * 0.9, side * engZ), v3(pyl.x - 1.6, axisY + R * 0.55, side * engZ)], false));
    }
  }
  // В киль — к рулю направления и огням; в нос — к локатору.
  // В киле — вдоль заднего лонжерона (≈60% хорды основного киля).
  const finPt = (y: number) => v3(leLin(y) + 0.6 * (teLin(y) - leLin(y)) + shiftX, y, 0);
  harness.push(bundle([v3(aftEnd - 2.5, 1.4, 0.3), v3(aftEnd - 1.5, 1.85, 0.05), finPt(2.6), finPt(4.5), finPt(7.0)], false));
  harness.push(bundle([v3(4.0, 0.8, 0), v3(2.5, 0.2, 0), v3(1.0, -0.4, 0)]));
  add("electrical.harness", harness, v3(0, 10.5, 0), v3(2, 1.2, -2));
  add("hydraulics", hydraulicBay(mainX - 2.2), v3(0, 6.5, 0), v3(0.5, 1, 1.8));
  add("airConditioning", airConditioningPacks(wingRoot.x + 0.8), v3(0, 6.5, 0), v3(-0.5, 1, -2));
  // ВСУ (AC 2-12-0, отсек между шпангоутами 80 и 84 хвостового конуса): корпус с генератором, воздухозаборный
  // канал вверх к створке на правом борту, глушитель выхлопа — к срезу на кончике хвоста.
  const apuX = L - 3.4;
  const apuSec = fuselageSection(f, apuX);
  const apuBody = new THREE.CylinderGeometry(0.3, 0.33, 1.0, 20);
  apuBody.rotateZ(Math.PI / 2);
  apuBody.translate(apuX, apuSec.cy - 0.05, 0);
  const apuGen = boxAt(apuX - 0.85, apuX - 0.5, apuSec.cy - 0.3, apuSec.cy + 0.15, -0.22, 0.22);
  const tipSec = fuselageSection(f, L - 0.05);
  const muffler = new THREE.CylinderGeometry(Math.min(0.22, tipSec.hw * 0.8), 0.27, L - 0.05 - (apuX + 0.5), 16, 1, true);
  muffler.rotateZ(Math.PI / 2);
  muffler.translate((L - 0.05 + apuX + 0.5) / 2, (apuSec.cy + tipSec.cy) / 2 - 0.03, 0);
  const intakeTop = fuselageSection(f, apuX - 0.6);
  const intake = tubeGeometry([v3(apuX - 0.3, apuSec.cy + 0.2, 0.1), v3(apuX - 0.55, intakeTop.cy + intakeTop.hh * 0.55, 0.35), v3(apuX - 0.75, intakeTop.cy + intakeTop.hh * 0.8, intakeTop.hw * 0.45)], 0.12);
  add("apu", [apuBody, apuGen, muffler, intake], v3(4, 4.5, 0), v3(1.5, 1, 1.2));

  // ——— Салон ———
  // По AC 2-5-0 и 2-4-1: пол на 0,52 м ниже оси фюзеляжа, ряд из трёх кресел 1,50 м, проход 0,64 м
  // («широкий проход»), высота подушки 0,43 м; передняя кухня и туалет — перед дверью 1, задние туалеты — перед
  // задними дверями, задняя кухня — за ними. Кресло: подушка, наклонённая спинка, подлокотники, ножки и
  // открытое пространство под креслом для сумок с ограничительной планкой.
  const floorY = SH.cabin.floorY;
  const cabinRows = cabinRowsFor(def);
  const openings = cabinOpenings(def).sort((a, b) => a.x0 - b.x0);
  const ownCabin = def.id === "a321ceo" || def.id === "a321neo";
  const fwdDoorEnd = ownCabin ? openings[0].x1 + 0.25 : SH.cabin.fwdDoorEnd;
  const aftDoorStart = ownCabin ? openings.at(-1)!.x0 : modelX(L, SH.cabin.aftDoorX);
  const firstRow = fwdDoorEnd + 0.45;
  // Unlike the old 3+3/ceil implementation, draw the exact seat count — including
  // 194/225/239-seat layouts and wider 2+2 business class rows.
  const seatBank = (x: number, side: 1 | -1, count: number, seatsPerBank: number): THREE.BufferGeometry => {
    const zIn = 0.32;
    const zOut = Math.min(1.82, ...[x, x + 0.6].map((xx) => fuselageHalfWidthAt(f, xx, floorY + 0.62) - 0.06));
    const w = (zOut - zIn) / seatsPerBank;
    const parts: THREE.BufferGeometry[] = [];
    const zs = (a: number, b: number): [number, number] => (side === 1 ? [a, b] : [-b, -a]);
    for (let k = 0; k < count; k++) {
      const z0 = zIn + k * w + 0.015;
      const z1 = zIn + (k + 1) * w - 0.015;
      const [a, b] = zs(z0, z1);
      parts.push(boxAt(x + 0.04, x + 0.48, floorY + 0.34, floorY + 0.45, a, b));
      const back = new THREE.BoxGeometry(0.09, 0.74, b - a);
      back.translate(0.045, 0.37, 0);
      back.rotateZ((-12 * Math.PI) / 180);
      back.translate(x + 0.44, floorY + 0.42, (a + b) / 2);
      parts.push(back);
    }
    for (let k = 0; k <= count; k++) {
      const z = zIn + k * w;
      const [a, b] = zs(z - 0.025, z + 0.025);
      parts.push(boxAt(x + 0.1, x + 0.5, floorY + 0.56, floorY + 0.61, a, b));
    }
    for (const z of [zIn + 0.12, zIn + count * w - 0.12]) {
      const [a, b] = zs(z - 0.02, z + 0.02);
      parts.push(boxAt(x + 0.08, x + 0.12, floorY, floorY + 0.34, a, b));
      parts.push(boxAt(x + 0.38, x + 0.42, floorY, floorY + 0.34, a, b));
      parts.push(boxAt(x + 0.08, x + 0.42, floorY + 0.02, floorY + 0.05, a, b));
    }
    const [a, b] = zs(zIn + 0.05, zIn + count * w - 0.05);
    parts.push(boxAt(x + 0.05, x + 0.07, floorY + 0.1, floorY + 0.13, a, b));
    return mergeGeometries(parts.map((g) => g.toNonIndexed()))!;
  };
  const seatsGroup: THREE.BufferGeometry[] = [];
  let nextRowX = firstRow;
  for (const row of cabinRows) {
    const seatsPerBank = Math.ceil(row.seatsPerRow / 2);
    const nLeft = Math.min(seatsPerBank, Math.ceil(row.seats / 2));
    const nRight = row.seats - nLeft;
    if (nLeft > 0) seatsGroup.push(seatBank(nextRowX, 1, nLeft, seatsPerBank));
    if (nRight > 0) seatsGroup.push(seatBank(nextRowX, -1, nRight, seatsPerBank));
    nextRowX += row.pitchM;
  }
  const lastRow = nextRowX;
  // Туалеты: перед дверью 1 справа и перед задними дверями с обеих сторон.
  const lavs = [
    hullBox(f, 3.5, 4.45, floorY, floorY + 2.0, 0.2, 1.6),
    hullBox(f, Math.max(lastRow + 0.05, aftDoorStart - 1.0), aftDoorStart - 0.05, floorY, floorY + 2.0, 0.55, 1.7),
    hullBox(f, Math.max(lastRow + 0.05, aftDoorStart - 1.0), aftDoorStart - 0.05, floorY, floorY + 2.0, -1.7, -0.55),
  ];
  // Пол салона — панель на высоте пола по AC, шириной по обшивке.
  const floorSegs: THREE.BufferGeometry[] = [];
  for (let x = 3.3; x < aftDoorStart + 2.0; x += 0.5) floorSegs.push(hullBox(f, x, x + 0.5, floorY - 0.04, floorY, -2, 2).toNonIndexed());
  const floor = mergeGeometries(floorSegs)!;
  add("furnishings", [...seatsGroup, ...lavs, floor], v3(0, 13.5, 0), v3(-4, 2.2, -2.5));
  // Кухни (оборудование эксплуатанта: тележки, кейтеринг): передняя — слева перед дверью 1, задняя — за задними дверями.
  const aftGalleyX0 = aftDoorStart + 1.1;
  add(
    "operatorItems",
    [hullBox(f, 3.4, 4.45, floorY, floorY + 1.05, -1.6, -0.2), hullBox(f, aftGalleyX0, aftGalleyX0 + 0.8, floorY, floorY + 1.05, -1.5, 1.5)],
    v3(0, 13.5, 0),
    v3(9, 3.4, 2.5),
  );

  const finXY = (u: number, v: number): [number, number] => {
    const y = yOf(u);
    const le = leAc(y);
    return [le + v * (teAc(y) - le), y];
  };
  return { root, parts, groundY, lengthM: L, wingLeX: wingRoot.x, finXY };
}

/** Центр части в её локальных координатах (до разлёта). */
export function partCenter(p: Part): THREE.Vector3 {
  const box = new THREE.Box3().setFromObject(p.group);
  return box.getCenter(new THREE.Vector3()).sub(p.group.position);
}

export { aeroSpanM };
