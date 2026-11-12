// Сборка 3D-модели из определения самолёта. Каждый узел дерева масс получает свою группу мешей,
// направление разлёта и якорь для выноски. Геометрия строится только из размеров определения,
// поэтому рычаги (размах, диаметр вентилятора, длина фюзеляжа) сразу меняют модель.

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { useShapes } from "./shapeSet.ts";
import { cockpitGlazing } from "./cockpit.ts";
import { cabinOpenings } from "./features.ts";
import { fuselageFittings, wingtipLights } from "./fittings.ts";
import { type AircraftDefinition, aeroSpanM } from "../../src/definition.ts";
import {
  type FuselageShape,
  type SurfaceShape,
  engineCutaway,
  fuselageGeometry,
  fuselageHalfWidthAt,
  fuselageSection,
  leadingEdgeSweep,
  modelX,
  nacaHalfThickness,
  nacelleBaseRadius,
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
  // Обтекатель центроплана («брюхо» под крылом) — по контуру на виде сбоку AC: от 11,4 до 21,2 м,
  // низ на 2,22 м под осью; шире фюзеляжа у корня крыла.
  const fairing = new THREE.SphereGeometry(1, 40, 20);
  fairing.scale(SH.fairing.sx, SH.fairing.sy, SH.fairing.sz);
  fairing.translate(modelX(L, SH.fairing.x), SH.fairing.y, 0);
  const glazing = cockpitGlazing(f);
  for (const g of glazing) g.userData.tone = "glass";
  const fittings = fuselageFittings(f).map((ft) => {
    ft.geometry.userData.tone = ft.tone;
    return ft.geometry;
  });
  add("fuselage", [fuselageGeometry(f), fairing, ...glazing, ...fittings], v3(0, 0, 0), v3(7, 2.6, 3));

  // ——— Крыло ———
  // Форма в плане — по виду сверху Airbus AC 2-2-0 (векторный контур): передняя кромка прямая,
  // задняя — прямая до излома над основными стойками, дальше к законцовке. Площадь по этой форме
  // (с центропланом) ≈122 м² — совпадает с 122,4 м² Jenkinson, независимая проверка извлечения.
  // Рычаги масштабируют форму: хорды — по средней хорде S/b, внешняя часть — по полуразмаху.
  const w = def.wing;
  const semi = w.spanM / 2;
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
  const ct = cTip;
  // Доля открытой части консоли η одинакова на чертеже и в модели: кромки чертежа переносятся по η, хорды — по chordK,
  // смещение передней кромки — по отношению длин консолей.
  const spanK = exposed / (acTipZ - acSide);
  const wingPlanform = (u: number) => {
    const z = u * semi;
    if (z <= sideZ) return { le: 0, chord: cSide };
    const za = acSide + ((z - sideZ) / exposed) * (acTipZ - acSide);
    return { le: (acLe(za) - acLe(acSide)) * spanK, chord: (acTe(za) - acLe(za)) * chordK };
  };
  // Корень передней кромки сдвигается вместе с передней вставкой фюзеляжа.
  // Высота корня — по виду спереди: средняя линия крыла у борта ниже оси фюзеляжа (A320 — AC, 737 — сетка).
  const wingRoot = v3(modelX(L, acLe(acSide)), P.rootY, 0);
  const wingShape = (side: 1 | -1, extra: Partial<SurfaceShape> = {}): SurfaceShape => ({
    root: wingRoot,
    rootChordM: cSide,
    tipChordM: ct,
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
  const wingDown = v3(0, -6.5, 0);
  const both = (fn: (side: 1 | -1) => THREE.BufferGeometry) => [sided(fn(1), 1), sided(fn(-1), -1)];
  // Кессон и панели: всё, кроме подвижных частей. Предкрылки идут от борта до законцовки,
  // закрылки — от борта до 77% полуразмаха, элероны — 77–97% (по чертежу A320).
  const uSide = sideZ / semi;
  const hl = w.highLift;
  // Без предкрылков передняя кромка — часть кессона.
  const SLAT = hl.slats ? 0.11 : 0;
  const FLAP = 1 - hl.flapChordFraction;
  // Элероны — своя хорда (26%), рычаг хорды закрылков их не трогает.
  const AIL = 0.74;
  const uFlapEnd = 0.77;
  const uTipDevices = 0.97;
  const wingSeg = (u0: number, u1: number) => Math.max(4, Math.round((u1 - u0) * 48));
  const boxPieces = (s: 1 | -1) => [
    surfaceGeometry(wingShape(s, { chordFrom: SLAT, chordTo: FLAP }), 48),
    ...(hl.slats
      ? [surfaceGeometry(wingShape(s, { chordTo: SLAT, spanTo: uSide }), 3, 8), surfaceGeometry(wingShape(s, { chordTo: SLAT, spanFrom: uTipDevices }), 2, 8)]
      : []),
    surfaceGeometry(wingShape(s, { chordFrom: FLAP, spanTo: uSide }), 3, 8),
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
          hinged(surfaceGeometry(wingShape(s, { chordFrom: FLAP, chordTo: VANE, spanFrom: uSide, spanTo: uFlapEnd }), wingSeg(uSide, uFlapEnd), 6), s, v3(2.3, -0.6, 0), "flap", uSide, uFlapEnd, FLAP, 25, flapSlide.clone().multiplyScalar(0.8)),
          hinged(surfaceGeometry(wingShape(s, { chordFrom: VANE + 0.01, spanFrom: uSide, spanTo: uFlapEnd }), wingSeg(uSide, uFlapEnd), 8), s, v3(2.9, -0.8, 0), "flap", uSide, uFlapEnd, VANE, 45, flapSlide.clone().multiplyScalar(1.35)),
        ]
      : [hinged(surfaceGeometry(wingShape(s, { chordFrom: FLAP, spanFrom: uSide, spanTo: uFlapEnd }), wingSeg(uSide, uFlapEnd), 8), s, v3(2.6, -0.7, 0), "flap", uSide, uFlapEnd, FLAP, 40, flapSlide)];
  const highLift = (s: 1 | -1) => [
    ...(hl.slats ? [hinged(surfaceGeometry(wingShape(s, { chordTo: SLAT, spanFrom: uSide, spanTo: uTipDevices }), wingSeg(uSide, uTipDevices), 8), s, v3(-2.2, -0.3, 0), "slat", uSide, uTipDevices, SLAT, 27, slatSlide)] : []),
    ...flaps(s),
    moved(surfaceGeometry(wingShape(s, { chordFrom: AIL, spanFrom: uFlapEnd + 0.005, spanTo: uTipDevices }), 6, 8), s, v3(2.0, 0.3, 0)),
  ];
  // Обтекатели кареток закрылков — «лодочки» под нижней поверхностью: начинаются под кессоном,
  // выходят за заднюю кромку примерно на четверть хорды; при выпуске хвостовая часть идёт вместе с закрылком.
  const trackFairing = (side: 1 | -1, u: number) => {
    const c = wingPlanform(u).chord;
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
    const p0 = surfacePoint(wingShape(side), u, 0.5, false);
    // Верх «лодочки» утоплен в нижнюю поверхность крыла.
    g.translate(p0.x, p0.y - r * 0.55, p0.z);
    const piv = surfacePoint(wingShape(side), u, FLAP, false);
    g.userData.offset = v3(2.6, -0.7, 0);
    g.userData.hinge = { kind: "flap", pivot: piv, axis: new THREE.Vector3(0, 0, side), angle: (-side * 18 * Math.PI) / 180, slide: flapSlide.clone().multiplyScalar(0.35) };
    return sided(g, side);
  };
  const fairings = [1, -1].flatMap((sd) => [0.3, 0.45, 0.6, 0.74].map((u) => trackFairing(sd as 1 | -1, u)));
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
      rootChordM: ct,
      tipChordM: ct * 0.4,
      semiSpanM: 2.43,
      leadingEdgeSweepDeg: 38,
      dihedralDeg: 78,
      thicknessRoot: 0.09,
      thicknessTip: 0.08,
      side,
    });
    add("wingtips", both((s) => surfaceGeometry(sharklet(s), 8, 14)), v3(0, -6.5, 0), v3(0, 1.8, 2), false, 4.5);
  } else if (w.tip === "fence") {
    const tipLe = surfacePoint(wingShape(1), 1, 0, true);
    // Законцовка-«забор» A320ceo: наконечник стрелы, выступающий над и под крылом.
    const fence = (side: 1 | -1) => {
      const sh = new THREE.Shape();
      const c = ct;
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
  add("fuel", tankGeoms, v3(0, -6.5 + 3.2, 0), v3(0, 1.2, 7), true, 3);

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
  const engZ = Math.min(SH.nacelle.axisZ, 0.6 * semi);
  const lePoint = surfacePoint(wingShape(1), engZ / semi, 0, false);
  const R = e.nacelleWidthM / 2;
  const nacX = modelX(L, SH.nacelle.inletX) - (e.nacelleLengthM - SH.nacelle.refLengthM) * 0.6;
  const wingLow = surfacePoint(wingShape(1), engZ / semi, 0.2, false).y;
  // Земля — низ шин на виде сбоку AC (3,87 м под осью фюзеляжа). Ось двигателя — из клиренса 0,57 м
  // базовой гондолы CEO: при большем вентиляторе ось на месте, низ гондолы опускается (как в слое ограничений).
  const groundY = SH.groundY;
  // 737: ось — по сетке (гондола поджата к крылу), рычаг подъёма двигает её так же.
  const axisY = (SH.nacelle.axisY ?? groundY + SH.nacelle.clearanceM + 2.37 / 2) + e.nacelleRaiseM;
  // Гондола по AC 2-12-0: тип по двухконтурности (длинный канал CFM56 или раздельные потоки LEAP),
  // длина и радиус — от базовой гондолы этого типа, масштабированной по определению.
  const style = nacelleStyleFor(e.bypassRatio);
  const baseNacLen = style === "longDuct" ? 4.44 : 4.44 * (1.98 / 1.73);
  const baseNacW = style === "longDuct" ? 2.37 : 2.37 * (1.98 / 1.73);
  const lengthK = e.nacelleLengthM / baseNacLen;
  const radiusK = ((e.nacelleWidthM / baseNacW) * (style === "longDuct" ? 1.185 : 1.355)) / nacelleBaseRadius(style);
  const nacelleParts: THREE.BufferGeometry[] = [];
  for (const side of [1, -1] as const) {
    for (const seg of nacelleSegments(style, lengthK, radiusK)) {
      seg.geometry.translate(nacX, axisY, side * engZ);
      // При разборе сегменты расходятся вдоль оси — видно, из чего состоит гондола.
      const spread: Record<string, number> = { inlet: -1.2, fanCowl: -0.4, reverser: 0.4, nozzle: 1.2, coreCowl: 1.2, plug: 1.8 };
      seg.geometry.userData.offset = v3(spread[seg.id] ?? 0, 0, 0);
      nacelleParts.push(sided(seg.geometry, side));
    }
    // Пилон: от верха гондолы к нижней поверхности крыла, передняя кромка скошена.
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
    const pg = new THREE.ExtrudeGeometry(pyl, { depth: 0.32, bevelEnabled: false });
    pg.translate(0, 0, side * engZ - 0.16);
    nacelleParts.push(sided(pg, side));
  }
  add("nacelles", nacelleParts, v3(0, -10.5, 0), v3(-1.5, -1.6, 3), false, 3);
  // Двигатель — разрез: детали построены вокруг своей оси, чтобы роторы могли вращаться.
  // Положение оси хранится в basePos, разлёт деталей вдоль оси — в offset.
  const engineGeoms: THREE.BufferGeometry[] = [];
  const pieces = engineCutaway({
    fanDiameterM: e.fanDiameterM,
    bypassRatio: e.bypassRatio,
    // Длина «голого» двигателя по AC: CFM56-5B 2,94 м (1,70 диаметра вентилятора), LEAP-1A 3,55 м (1,79).
    lengthM: e.fanDiameterM * (1.7 + (0.09 * Math.max(0, e.bypassRatio - 5.7)) / 5.3),
    ...e.architecture,
    gearbox: e.cycle.gearbox,
  });
  for (const side of [1, -1] as const)
    for (const p of pieces) {
      const g = p.geometry.clone();
      g.userData = { side, tone: p.tone, spin: p.spin, offset: p.offset, basePos: v3(nacX + nacelleFanFace(style, lengthK) - 0.1, axisY, side * engZ) };
      engineGeoms.push(g);
    }
  add("engines", engineGeoms, v3(-6.5, -10.5, 0), v3(-2.5, -2.4, 2), false, 3);

  // ——— Шасси ———
  // Земля задаётся клиренсом базовой гондолы CEO (0,57 м при MRW): стойки не меняются рычагами.
  // База шасси 12,64 м и колея 7,59 м — по AC 2-3-0.

  const G = SH.gear;
  const mainX = modelX(L, G.noseX + G.wheelbaseM);
  // Стойки — по AC 2-9-0. Основная: от оси шарнира до оси колёс 2,869 м выпущенная, ход амортизатора 0,47 м,
  // шарнир на 3,795 м от оси самолёта, уборка внутрь на 80°30′. Передняя: 1,957 м, ход 0,43 м, наклон 9°,
  // уборка вперёд на 92°. Колёса: основные 46×17R20 (Ø1,17 м), передние 30×8,8R15 (Ø0,76 м).
  // Геометрия строится вокруг шарнира (basePos), чтобы уборка была поворотом.
  const tire = (r: number, width: number) => {
    const rin = r * 0.55;
    const pts: THREE.Vector2[] = [];
    const n = 10;
    for (let k = 0; k <= n; k++) {
      const a = -Math.PI / 2 + (k / n) * Math.PI;
      pts.push(new THREE.Vector2(r - width * 0.28 + Math.cos(a) * width * 0.28, Math.sin(a) * width * 0.5));
    }
    pts.unshift(new THREE.Vector2(rin, -width * 0.5));
    pts.push(new THREE.Vector2(rin, width * 0.5));
    const g = new THREE.LatheGeometry(pts, 32);
    g.rotateX(Math.PI / 2);
    const hub = new THREE.CylinderGeometry(rin, rin, width * 0.7, 24);
    hub.rotateX(Math.PI / 2);
    return mergeGeometries([g.toNonIndexed(), hub.toNonIndexed()])!;
  };
  const cyl = (r: number, y0: number, y1: number, x = 0, z = 0) => {
    const g = new THREE.CylinderGeometry(r, r, Math.abs(y1 - y0), 14);
    g.translate(x, (y0 + y1) / 2, z);
    return g;
  };
  const bar = (a: THREE.Vector3, b: THREE.Vector3, r: number) => {
    const len = a.distanceTo(b);
    const g = new THREE.CylinderGeometry(r, r, len, 10);
    g.translate(0, len / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(v3(0, 1, 0), b.clone().sub(a).normalize()));
    g.translate(a.x, a.y, a.z);
    return g;
  };
  const plate = (pts: [number, number][], hole: [number, number][] | null, depth: number, plane: "xy" | "zy") => {
    const sh = new THREE.Shape(pts.map(([a, b]) => new THREE.Vector2(a, b)));
    if (hole) sh.holes.push(new THREE.Path(hole.map(([a, b]) => new THREE.Vector2(a, b))));
    const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false });
    g.translate(0, 0, -depth / 2);
    if (plane === "zy") g.rotateY(Math.PI / 2);
    return g;
  };
  const merge = (gs: THREE.BufferGeometry[]) => mergeGeometries(gs.map((g) => (g.index ? g.toNonIndexed() : g)))!;

  const mainR = G.mainR;
  const mainWheelY = groundY + mainR;
  // Шарнир — внутри крыла (на средней плоскости у заднего лонжерона); длина стойки — от шарнира до оси колёс
  // на стоянке (у AC — 2,869 м в выпущенном положении минус обжатие), так что колёса стоят на земле.
  const wingMidAt = (z: number) => {
    const u = z / semi;
    return (surfacePoint(wingShape(1), u, 0.75, true).y + surfacePoint(wingShape(1), u, 0.75, false).y) / 2;
  };
  const pivotY = wingMidAt(G.mainZ);
  const mainLeg = pivotY - mainWheelY;
  const mainPivot = (side: 1 | -1) => v3(mainX, pivotY, side * G.mainZ);
  // Детали стойки размечены по стойке A320 (2,32 м от шарнира до оси колёс) — у других типов растягиваются по высоте.
  const km = mainLeg / 2.32;
  const mainGear = (side: 1 | -1) => {
    const inb = -side; // к оси самолёта
    const parts: THREE.BufferGeometry[] = [
      // Основная стойка: треугольная траверса с вырезом, цилиндр амортизатора и шток.
      plate([[-0.42, 0.08], [0.3, 0.08], [0.1, -1.05 * km], [-0.08, -1.05 * km]], [[-0.22, -0.08], [0.16, -0.08], [0.04, -0.62 * km]], 0.16, "xy"),
      cyl(0.15, -0.95 * km, -1.75 * km),
      cyl(0.1, -1.75 * km, -mainLeg + 0.1),
      // Шлиц-шарнир спереди.
      bar(v3(-0.12, -1.55 * km, 0), v3(-0.32, -1.95 * km, 0), 0.035),
      bar(v3(-0.32, -1.95 * km, 0), v3(-0.1, -mainLeg + 0.25, 0), 0.035),
    ];
    const wheelsPerStrut = def.gear.mainWheels / def.gear.mainStruts;
    const axleXs = wheelsPerStrut === 4 && G.axleSpacingM ? [-G.axleSpacingM / 2, G.axleSpacingM / 2] : [0];
    if (axleXs.length === 2) parts.push(bar(v3(axleXs[0], -mainLeg, 0), v3(axleXs[1], -mainLeg, 0), 0.13));
    for (const axleX of axleXs) {
      // По два колеса на ось; у 757 две оси с базой 45 in (D6-58327 §7.2).
      parts.push((() => {
        const a = new THREE.CylinderGeometry(0.07, 0.07, 2 * G.mainWheelGap + 0.13, 12);
        a.rotateX(Math.PI / 2);
        a.translate(axleX, -mainLeg, 0);
        return a;
      })());
      for (const k of [1, -1]) {
        const t = tire(mainR, G.mainTireW);
        t.translate(axleX, -mainLeg, k * G.mainWheelGap);
        parts.push(t);
      }
    }
    const leg = merge(parts);
    leg.userData = { side, basePos: mainPivot(side), retract: { axis: "x", angle: (side * G.retractDeg * Math.PI) / 180 } };
    // Боковой подкос (складывающийся) и цилиндр уборки — к узлам на конструкции крыла; при уборке складываются.
    // Узел подкоса — на конструкции у корня крыла (внутри, на средней плоскости крыла).
    const braceTop = wingMidAt(G.mainZ - 1.35 * (G.mainZ / 3.795)) - pivotY;
    const brace = merge([
      bar(v3(0, -1.15 * km, 0), v3(0.05, (braceTop - 1.15 * km) / 2, inb * 0.7), 0.05),
      bar(v3(0.05, (braceTop - 1.15 * km) / 2, inb * 0.7), v3(0.08, braceTop, inb * 1.35), 0.05),
      bar(v3(0.05, -0.2, 0), v3(0.05, braceTop * 0.6 - 0.05, inb * 0.9), 0.06),
    ]);
    brace.userData = { side, basePos: mainPivot(side), hideRetracted: true };
    return [leg, brace];
  };
  add("gear.main", [...mainGear(1), ...mainGear(-1)], v3(0, -9, 0), v3(9, -2.5, -4));

  const noseR = G.noseR;
  const noseWheelY = groundY + noseR;
  const noseLegLen = G.noseLegM;
  const rake = (G.rakeDeg * Math.PI) / 180;
  const nosePivot = v3(G.noseX + noseLegLen * Math.sin(rake), noseWheelY + noseLegLen * Math.cos(rake), 0);
  // Детали передней стойки размечены по A320 (1,72 м) — у других типов растягиваются по высоте.
  const kn = noseLegLen / 1.72;
  const noseParts: THREE.BufferGeometry[] = [
    // Траверса передней стойки (вид спереди — «вилка» с вырезами), цилиндр, шток, рулевой узел.
    plate([[-0.5, 0.05], [0.5, 0.05], [0.09, -0.75 * kn], [-0.09, -0.75 * kn]], [[-0.3, -0.05], [-0.06, -0.05], [-0.07, -0.45 * kn]], 0.12, "zy"),
    cyl(0.11, -0.7 * kn, -1.15 * kn),
    cyl(0.075, -1.15 * kn, -noseLegLen + 0.08),
    (() => {
      const b = new THREE.BoxGeometry(0.16, 0.12, 0.85);
      b.translate(0, -0.85 * kn, 0);
      return b;
    })(),
    bar(v3(-0.08, -1.2 * kn, 0), v3(-0.25, -1.45 * kn, 0), 0.03),
    bar(v3(-0.25, -1.45 * kn, 0), v3(-0.06, -noseLegLen + 0.18, 0), 0.03),
    (() => {
      const a = new THREE.CylinderGeometry(0.05, 0.05, 0.7, 10);
      a.rotateX(Math.PI / 2);
      a.translate(0, -noseLegLen, 0);
      return a;
    })(),
    // Подкос — вперёд-вверх к узлу на конструкции ниши.
    bar(v3(0, -0.55 * kn, 0), v3(-0.95, 0.05, 0), 0.045),
  ];
  for (const k of [1, -1]) {
    const t = tire(noseR, G.noseTireW ?? 0.22);
    t.translate(0, -noseLegLen, k * (G.noseWheelGap ?? 0.3));
    noseParts.push(t);
  }
  const noseLeg = merge(noseParts);
  // Наклон стойки 9°: низ вперёд.
  noseLeg.rotateZ(-rake);
  noseLeg.userData = { basePos: nosePivot, retract: { axis: "z", angle: (-92 * Math.PI) / 180 } };
  add("gear.nose", [noseLeg], v3(-2.5, -8, 0), v3(-1.5, -1.4, -1.5));

  // ——— Бортовые системы (внутри фюзеляжа, при разлёте поднимаются над ним ярусами) ———
  add("avionics", [hullBox(f, 2.9, 4.6, -1.5, -0.75, -0.8, 0.8)], v3(0, 6.5, 0), v3(-1, 1, -1.5));
  add("instruments", [boxAt(2.9, 3.4, -0.1, 0.45, -0.75, 0.75)], v3(-1.5, 8.2, 0), v3(-1.2, 1, 1.5));
  add("electrical.generation", [hullBox(f, 5.4, 6.8, -1.6, -1.0, -0.7, 0.7)], v3(0, 6.5, 0), v3(0, 1, 1.8));
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
    harness.push(bundle([pyl, v3(pyl.x - 0.6, axisY + R * 0.9, side * engZ), v3(pyl.x - 1.6, axisY + R * 0.55, side * engZ)], false));
  }
  // В киль — к рулю направления и огням; в нос — к локатору.
  // В киле — вдоль заднего лонжерона (≈60% хорды основного киля).
  const finPt = (y: number) => v3(leLin(y) + 0.6 * (teLin(y) - leLin(y)) + shiftX, y, 0);
  harness.push(bundle([v3(aftEnd - 2.5, 1.4, 0.3), v3(aftEnd - 1.5, 1.85, 0.05), finPt(2.6), finPt(4.5), finPt(7.0)], false));
  harness.push(bundle([v3(4.0, 0.8, 0), v3(2.5, 0.2, 0), v3(1.0, -0.4, 0)]));
  add("electrical.harness", harness, v3(0, 10.5, 0), v3(2, 1.2, -2));
  add("hydraulics", [hullBox(f, mainX - 2.2, mainX - 0.8, -1.75, -1.25, -0.9, 0.9)], v3(0, 6.5, 0), v3(0.5, 1, 1.8));
  add(
    "airConditioning",
    [hullBox(f, wingRoot.x + 0.8, wingRoot.x + 3.0, -1.9, -1.4, 0.4, 1.5), hullBox(f, wingRoot.x + 0.8, wingRoot.x + 3.0, -1.9, -1.4, -1.5, -0.4)],
    v3(0, 6.5, 0),
    v3(-0.5, 1, -2),
  );
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
  const pitch = def.systems.seatPitchM;
  const rows = Math.ceil(def.systems.seats / def.systems.seatsAbreast);
  const openings = cabinOpenings(def).sort((a, b) => a.x0 - b.x0);
  const ownCabin = def.id === "a321ceo" || def.id === "a321neo";
  const fwdDoorEnd = ownCabin ? openings[0].x1 + 0.25 : SH.cabin.fwdDoorEnd;
  const aftDoorStart = ownCabin ? openings.at(-1)!.x0 : modelX(L, SH.cabin.aftDoorX);
  const firstRow = fwdDoorEnd + 0.45;
  const seatTriple = (x: number, side: 1 | -1): THREE.BufferGeometry => {
    const zIn = 0.32;
    const zOut = Math.min(1.82, ...[x, x + 0.6].map((xx) => fuselageHalfWidthAt(f, xx, floorY + 0.62) - 0.06));
    const w = (zOut - zIn) / 3;
    const parts: THREE.BufferGeometry[] = [];
    const zs = (a: number, b: number): [number, number] => (side === 1 ? [a, b] : [-b, -a]);
    for (let k = 0; k < 3; k++) {
      const z0 = zIn + k * w + 0.015;
      const z1 = zIn + (k + 1) * w - 0.015;
      const [a, b] = zs(z0, z1);
      parts.push(boxAt(x + 0.04, x + 0.48, floorY + 0.34, floorY + 0.45, a, b));
      // Спинка: 0,72 м, наклон назад 12°, поворот вокруг нижней кромки.
      const back = new THREE.BoxGeometry(0.09, 0.74, b - a);
      back.translate(0.045, 0.37, 0);
      back.rotateZ((-12 * Math.PI) / 180);
      back.translate(x + 0.44, floorY + 0.42, (a + b) / 2);
      parts.push(back);
    }
    for (let k = 0; k <= 3; k++) {
      const z = zIn + k * w;
      const [a, b] = zs(z - 0.025, z + 0.025);
      parts.push(boxAt(x + 0.1, x + 0.5, floorY + 0.56, floorY + 0.61, a, b));
    }
    for (const z of [zIn + 0.12, zOut - 0.12]) {
      const [a, b] = zs(z - 0.02, z + 0.02);
      parts.push(boxAt(x + 0.08, x + 0.12, floorY, floorY + 0.34, a, b));
      parts.push(boxAt(x + 0.38, x + 0.42, floorY, floorY + 0.34, a, b));
      parts.push(boxAt(x + 0.08, x + 0.42, floorY + 0.02, floorY + 0.05, a, b));
    }
    const [a, b] = zs(zIn + 0.05, zOut - 0.05);
    parts.push(boxAt(x + 0.05, x + 0.07, floorY + 0.1, floorY + 0.13, a, b));
    return mergeGeometries(parts.map((g) => g.toNonIndexed()))!;
  };
  const seatsGroup: THREE.BufferGeometry[] = [];
  for (let r = 0; r < rows; r++) for (const side of [1, -1] as const) seatsGroup.push(seatTriple(firstRow + r * pitch, side));
  const lastRow = firstRow + rows * pitch;
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
