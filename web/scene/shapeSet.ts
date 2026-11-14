// Наборы контуров для 3D-модели: всё, что снято с чертежей конкретного типа (вид сбоку и сверху, сечение,
// оперение, положение двигателей и стоек). Координаты одинаковые для всех наборов: x — от носа назад, y — вверх
// от оси цилиндрической части фюзеляжа, z — по размаху. Рычаги масштабируют форму от этих опорных размеров.
//  • a320 — Airbus AC A320 (2-2-0, 2-3-0, 2-5-0, 2-9-0, 2-12-0), векторный PDF → tools/ac_shapes.py;
//  • b737 — сетка Collada 737-800 → tools/mesh_shapes.py, плюс размеры Boeing D6-38A004 2.2.2 (база и колея шасси).
//  • b757 — Boeing D6-58327 Rev H, векторный общий вид 2.2.1 и размеры тележек 7.2 → tools/b757_extract.py.
//  • tu214 — пользовательский Ту-204-200 трёхвид + УИ ГА 2024 → tools/tu214_shapes.py.

import { CLASSIC_COWL } from "../../src/aircraft/b737.ts";
import A320 from "../../data/ac/a320-shapes.json" with { type: "json" };
import { B737_800, B737_800_NACELLE } from "../../src/aircraft/b737ng.ts";
import B737 from "../../data/ac/b737-8-shapes.json" with { type: "json" };
import B757 from "../../data/ac/b757-shapes.json" with { type: "json" };
import PHOTO_FOREBODIES from "../../data/ac/photo-forebodies.json" with { type: "json" };
import TU214 from "../../data/ac/tu214-shapes.json" with { type: "json" };
import { type AircraftDefinition } from "../../src/definition.ts";
import { b757NacelleFor } from "../../src/aircraft/b757.ts";

type Line = { slope: number; x0: number };
type P2 = [number, number];
export interface Feature {
  kind: string;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface ShapeSet {
  id: "a320" | "b737" | "b757" | "tu214";
  fuselage: {
    x: number[]; top: number[]; bottom: number[]; half_width: number[];
    /** Small radome apex blend; dense sampling keeps close-up silhouettes smooth. */
    tipBlendM?: number; noseSegments?: number;
  };
  /** Радиус сечения по углу; fullTurn — таблица на полный оборот, иначе верхняя половина зеркалится вниз. */
  section: { deg: number[]; r: number[]; fullTurn: boolean };
  /** Полувысота и полуширина цилиндрической части на чертеже, м. */
  halfH: number;
  halfW: number;
  /** Длина фюзеляжа на чертеже и места вставок удлинения (в цилиндре перед крылом и за ним). */
  baseLengthM: number;
  plugFwd: number;
  plugAft: number;
  stretchReference?: { referenceLengthM: number; forwardM: number };
  features: Feature[];
  featuresBySide?: { left: Feature[]; right: Feature[] };
  cockpit: {
    windscreen: P2[]; side: P2[][];
    /** Shared A-pillar from the side drawing; front-pane outer z is resolved on the hull. */
    sideJunction?: { top: P2; bottom: P2 };
    glassInsetM?: number;
    /** Photo-guided flat panes and their common mounting surfaces. */
    planarGlazing?: boolean;
    sideSlopeX?: number[];
    sillBlendM?: number;
  };
  wing: {
    le: Line;
    /** Внутренняя часть передней кромки (наплыв у корня): кромка — ближняя к носу из двух прямых. */
    leInner?: Line;
    teInner: Line;
    teOuter: Line;
    kinkZ: number;
    tipZ: number;
    sideZ: number;
    rootY: number;
    dihedralDeg: number;
    thicknessRoot: number;
    thicknessTip: number;
    lines: number[][][];
    /** Размах и площадь, при которых форма чертежа совпадает с моделью (масштаб хорд). */
    refSpanM: number;
    refAreaM2: number;
  };
  htail: { le: Line; te: Line; tipZ: number; dihedralDeg: number; lines: number[][][] };
  vtail: {
    le: Line;
    te: Line;
    tipY: number;
    lines: number[][][];
    table: { y: number[]; le: number[]; te: number[] };
    filletX: number;
    leY0: number;
    refSpanM: number;
    refAreaM2: number;
  };
  /** Обтекатель центроплана — эллипсоид: центр по x, y и полуоси. */
  fairing: { x: number; y: number; sx: number; sy: number; sz: number };
  /** Срез воздухозаборника при опорной длине гондолы; ось — от оси самолёта; axisY: null — по клиренсу. */
  nacelle: { inletX: number; refLengthM: number; axisZ: number; axisY: number | null; clearanceM: number };
  groundY: number;
  gear: {
    noseX: number;
    wheelbaseM: number;
    /** Forward insert already included in this variant's published wheelbase. */
    wheelbaseForwardPlugM?: number;
    mainZ: number;
    mainR: number;
    mainWheelGap: number;
    mainTireW: number;
    boeing737Series?: "classic" | "ng" | "max";
    /** Расстояние между передней и задней осями четырёхколёсной тележки. */
    axleSpacingM?: number;
    retractDeg: number;
    noseR: number;
    noseTireW?: number;
    noseWheelGap?: number;
    noseLegM: number;
    rakeDeg: number;
  };
  cabin: { floorY: number; fwdDoorEnd: number; aftDoorX: number };
  /** Где на борту крупное название типа (по длине чертежа). */
  titleX: [number, number];
  /** Грузовые люки правого борта: [x0, ширина, y0, y1]. */
  cargo: [number, number, number, number][];
  fin: { box: { x0: number; x1: number; y0: number; y1: number }; logo: { cx: number; cy: number; r: number } };
}

const A = A320.ceo;
// Низ фюзеляжа на виде сбоку AC включает обтекатель центроплана (11,8–21 м); обтекатель в сцене — отдельная деталь,
// поэтому труба фюзеляжа идёт по низу цилиндра — иначе всё нижнее сечение «проседает» и на борту появляется излом.
const A320_FUS = {
  ...A.fuselage,
  bottom: A.fuselage.x.map((x, i) => (x > 11.5 && x < 21.0 ? Math.max(A.fuselage.bottom[i], -2.073) : A.fuselage.bottom[i])),
};
const A320_SET: ShapeSet = {
  id: "a320",
  fuselage: A320_FUS,
  section: { deg: A320.section.deg, r: A320.section.r, fullTurn: false },
  halfH: 2.07,
  halfW: 1.975,
  baseLengthM: 37.57,
  plugFwd: 8.0,
  // Задняя вставка — в цилиндре за крылом (21–24 м): с 24 м низ фюзеляжа уже поднимается к хвосту.
  plugAft: 23.0,
  features: A.features.filter((f) => f.kind !== "cockpit"),
  cockpit: {
    windscreen: [
      [0.07, 0.872],
      [0.719, 0.932],
      [0.84, 0.488],
      [0.147, 0.439],
      [0.06, 0.488],
    ],
    side: [
      [
        [1.88, 0.419],
        [2.229, 0.865],
        [2.654, 0.868],
        [2.654, 0.308],
        [2.551, 0.308],
      ],
      [
        [2.654, 0.308],
        [2.654, 0.868],
        [3.13, 0.868],
        [3.267, 0.735],
        [3.265, 0.35],
        [3.225, 0.31],
      ],
    ],
  },
  wing: {
    le: A.wing.le,
    teInner: A.wing.te_inner,
    teOuter: A.wing.te_outer,
    kinkZ: A.wing.kink_z ?? 6.64,
    tipZ: 34.1 / 2,
    sideZ: 1.975,
    rootY: -1.12,
    dihedralDeg: 5.1,
    thicknessRoot: 0.115,
    thicknessTip: 0.1,
    lines: A.wing.lines,
    refSpanM: 34.1,
    refAreaM2: 122.4,
  },
  htail: { le: A.htail.le, te: A.htail.te, tipZ: A.htail.tip_z, dihedralDeg: 6, lines: A.htail.lines },
  vtail: {
    le: A.vtail.le,
    te: A.vtail.te,
    tipY: A.vtail.tip_y,
    lines: A.vtail.lines,
    table: A.vtail.table,
    filletX: 28.75,
    leY0: 2.15,
    refSpanM: 6.26,
    refAreaM2: 21.5,
  },
  fairing: { x: 16.3, y: -1.4, sx: 4.9, sy: 0.82, sz: 2.12 },
  nacelle: { inletX: 11.764, refLengthM: 4.44, axisZ: 5.75, axisY: null, clearanceM: 0.57 },
  groundY: -3.867,
  gear: {
    noseX: 5.07,
    wheelbaseM: 12.64,
    mainZ: 3.795,
    mainR: 46 * .0254 / 2,
    mainWheelGap: 0.927 / 2,
    mainTireW: 17 * .0254,
    retractDeg: 80.5,
    noseR: 0.381,
    noseTireW: 8.8 * .0254,
    noseWheelGap: .25,
    noseLegM: 1.957 - 0.43 * 0.55,
    rakeDeg: 9,
  },
  cabin: { floorY: -0.52, fwdDoorEnd: 5.55, aftDoorX: 29.11 },
  titleX: [6.7, 13.8],
  cargo: [
    [8.35, 1.81, -1.95, -0.7],
    [24.55, 1.81, -1.95, -0.7],
    [28.75, 0.86, -1.7, -0.95],
  ],
  fin: { box: { x0: 27.5, x1: 37.5, y0: 1.4, y1: 8.2 }, logo: { cx: 33.2, cy: 4.45, r: 1.45 } },
};

// 737-8: фюзеляж, крыло (без законцовки), оперение и место двигателя — с сетки 737-800 (у -8 они те же, гондола LEAP-1B
// строится параметрически по определению). База шасси 15,60 м (51 ft 2 in), колея 5,72 м (18 ft 9 in), передняя стойка
// в 4,09 м от носа (13 ft 5 in) — D6-38A004 2.2.2. Колёса: основные H44,5×16,5-21 (Ø1,13 м), передние 27×7,75R15.
const B = B737;
const vtB = B.vtail;
const finLe = (y: number) => vtB.le.slope * y + vtB.le.x0;
const finTe = (y: number) => vtB.te.slope * y + vtB.te.x0;
const finCy = 1.9 + 0.41 * (vtB.tip_y - 1.9);
const B737_SET: ShapeSet = {
  id: "b737",
  fuselage: B.fuselage,
  section: { deg: B.section.deg, r: B.section.r, fullTurn: true },
  halfH: B.halfHeight,
  halfW: B.halfWidth,
  baseLengthM: 39.12,
  plugFwd: 9.5,
  plugAft: 26.0,
  features: B.features,
  cockpit: { windscreen: B.cockpit.windscreen as P2[], side: B.cockpit.side as P2[][] },
  wing: {
    le: B.wing.le,
    leInner: B.wing.le_inner,
    teInner: B.wing.te_inner,
    teOuter: B.wing.te_outer,
    kinkZ: B.wing.kink_z,
    tipZ: B.wing.tip_z,
    sideZ: B.wing.side_z,
    rootY: B.wing.root_y,
    dihedralDeg: B.wing.dihedral_deg,
    thicknessRoot: 0.14,
    thicknessTip: B.wing.thickness_tip,
    lines: B.wing.lines,
    refSpanM: 34.3,
    refAreaM2: 127,
  },
  htail: { le: B.htail.le, te: B.htail.te, tipZ: B.htail.tip_z, dihedralDeg: 7, lines: B.htail.lines },
  vtail: {
    le: vtB.le,
    te: vtB.te,
    tipY: vtB.tip_y,
    lines: vtB.lines,
    table: vtB.table,
    filletX: vtB.fillet_x,
    leY0: vtB.table.y[0] + 0.1,
    refSpanM: 7.1,
    refAreaM2: 26.4,
  },
  fairing: { x: 18.3, y: -1.45, sx: 4.3, sy: 0.72, sz: 2.05 },
  nacelle: { inletX: B.nacelle.inlet_x, refLengthM: 4.517, axisZ: B.nacelle.axis_z, axisY: B.nacelle.axis_y, clearanceM: 0.45 },
  groundY: B.groundY,
  gear: {
    noseX: 4.09,
    wheelbaseM: 15.6,
    mainZ: 2.86,
    mainR: 44.5 * .0254 / 2,
    boeing737Series: "ng",
    mainWheelGap: 34 * .0254 / 2,
    mainTireW: 16.5 * .0254,
    retractDeg: 88,
    noseR: 27 * .0254 / 2,
    noseTireW: 7.75 * .0254,
    noseWheelGap: 16 * .0254 / 2,
    noseLegM: 1.28,
    rakeDeg: 4,
  },
  cabin: { floorY: -0.5, fwdDoorEnd: B.features[0].x1 + 0.6, aftDoorX: B.features[3].x0 },
  titleX: [5.6, 15.6],
  // Люки 737: 48 × 35 in, передний — перед крылом, задний — за ним (положение по общему виду, ±0,3 м).
  cargo: [
    [7.9, 1.22, -1.85, -0.95],
    [25.4, 1.22, -1.8, -0.9],
  ],
  fin: {
    box: { x0: vtB.fillet_x - 0.4, x1: finTe(vtB.tip_y) + 0.8, y0: 1.3, y1: vtB.tip_y + 0.3 },
    logo: { cx: finLe(finCy) + 0.4 * (finTe(finCy) - finLe(finCy)), cy: finCy, r: 1.3 },
  },
};

// Photo corrections belong to the visual shape set. Preserve the original
// traced data and every aircraft definition used by the performance model.
function photoForebody(base: ShapeSet["fuselage"], photo: typeof PHOTO_FOREBODIES.tu214): ShapeSet["fuselage"] {
  const rows = photo.stations.concat(base.x.flatMap((x, i) => x > photo.joinM
    ? [[x, base.top[i], base.bottom[i], base.half_width[i]]] : []));
  return {
    x: rows.map(r => r[0]), top: rows.map(r => r[1]),
    bottom: rows.map(r => r[2]), half_width: rows.map(r => r[3]),
    tipBlendM: photo.tipBlendM, noseSegments: 128,
  };
}
function photoCockpit(photo: typeof PHOTO_FOREBODIES.tu214): ShapeSet["cockpit"] {
  return {
    windscreen: photo.cockpit.windscreen as P2[], side: photo.cockpit.side as P2[][],
    sideJunction: { top: photo.cockpit.sideJunction.top as P2, bottom: photo.cockpit.sideJunction.bottom as P2 },
    glassInsetM: photo.cockpit.glassInsetM,
    planarGlazing: photo.cockpit.planarGlazing,
    sideSlopeX: photo.cockpit.sideSlopeX,
  };
}

const C = B757;
const nacelle757 = (n: typeof C.nacelle): ShapeSet["nacelle"] => ({
  inletX: n.inlet_x, refLengthM: n.ref_length_m, axisZ: n.axis_z, axisY: n.axis_y, clearanceM: n.clearance_m,
});
const B757_SET: ShapeSet = {
  id: "b757",
  fuselage: photoForebody(C.fuselage, PHOTO_FOREBODIES.b757),
  section: { deg: C.section.deg, r: C.section.r, fullTurn: true },
  halfH: C.halfHeight,
  halfW: C.halfWidth,
  baseLengthM: C.baseLengthM,
  // Места гипотетических вставок рычагом — в цилиндре перед крылом и за ним; не конструкторские стыки Boeing.
  plugFwd: 10,
  plugAft: 32,
  features: C.features,
  featuresBySide: C.featuresBySide,
  cockpit: photoCockpit(PHOTO_FOREBODIES.b757),
  wing: {
    le: C.wing.le,
    teInner: C.wing.te_inner,
    teOuter: C.wing.te_outer,
    kinkZ: C.wing.kink_z,
    tipZ: C.wing.tip_z,
    sideZ: C.wing.side_z,
    rootY: C.wing.root_y,
    dihedralDeg: C.wing.dihedral_deg,
    thicknessRoot: C.wing.thickness_root,
    thicknessTip: C.wing.thickness_tip,
    lines: C.wing.lines,
    refSpanM: C.wing.ref_span_m,
    refAreaM2: C.wing.ref_area_m2,
  },
  htail: { le: C.htail.le, te: C.htail.te, tipZ: C.htail.tip_z, dihedralDeg: C.htail.dihedral_deg, lines: C.htail.lines },
  vtail: {
    le: C.vtail.le,
    te: C.vtail.te,
    tipY: C.vtail.tip_y,
    lines: C.vtail.lines,
    table: C.vtail.table,
    filletX: C.vtail.fillet_x,
    leY0: C.vtail.table.y[0] + 0.1,
    refSpanM: C.vtail.ref_span_m,
    refAreaM2: C.vtail.ref_area_m2,
  },
  fairing: C.fairing,
  nacelle: nacelle757(C.nacelle),
  groundY: C.groundY,
  gear: C.gear,
  cabin: C.cabin,
  cargo: C.cargo as [number, number, number, number][],
  titleX: C.titleX as [number, number],
  fin: C.fin,
};

/** Ту-214 — отдельные контуры, без масштабирования 757. Двери/сечение/пилоны ещё оценочные. */
const TU214_SET: ShapeSet = {
  id: "tu214",
  fuselage: photoForebody(TU214.fuselage, PHOTO_FOREBODIES.tu214),
  section: { deg: TU214.section.deg, r: TU214.section.r, fullTurn: true },
  halfH: TU214.halfHeight,
  halfW: 1.9,
  baseLengthM: TU214.baseLengthM,
  plugFwd: 10.0,
  plugAft: 32.0,
  features: TU214.features,
  featuresBySide: { left: TU214.features, right: TU214.starboardFeatures },
  cockpit: { ...photoCockpit(PHOTO_FOREBODIES.tu214), sillBlendM: 0.24 },
  wing: {
    le: TU214.wing.le,
    teInner: TU214.wing.te_inner,
    teOuter: TU214.wing.te_outer,
    kinkZ: TU214.wing.kink_z,
    tipZ: TU214.wing.tip_z,
    sideZ: TU214.wing.side_z,
    rootY: TU214.wing.root_y,
    dihedralDeg: TU214.wing.dihedral_deg,
    thicknessRoot: TU214.wing.thickness_root,
    thicknessTip: TU214.wing.thickness_tip,
    lines: TU214.wing.lines,
    refSpanM: TU214.wing.ref_span_m,
    refAreaM2: TU214.wing.ref_area_m2,
  },
  htail: {
    le: TU214.htail.le, te: TU214.htail.te, tipZ: TU214.htail.tip_z,
    dihedralDeg: TU214.htail.dihedral_deg, lines: TU214.htail.lines,
  },
  vtail: {
    le: TU214.vtail.le, te: TU214.vtail.te, tipY: TU214.vtail.tip_y,
    lines: TU214.vtail.lines, table: TU214.vtail.table,
    filletX: TU214.vtail.fillet_x, leY0: TU214.vtail.table.y[0] + 0.1,
    refSpanM: TU214.vtail.ref_span_m, refAreaM2: TU214.vtail.ref_area_m2,
  },
  fairing: TU214.fairing,
  nacelle: {
    inletX: TU214.nacelle.inlet_x, refLengthM: TU214.nacelle.ref_length_m,
    axisZ: TU214.nacelle.axis_z, axisY: TU214.nacelle.axis_y,
    clearanceM: TU214.nacelle.clearance_m,
  },
  groundY: TU214.groundY,
  gear: TU214.gear,
  cabin: TU214.cabin,
  cargo: TU214.cargo as [number, number, number, number][],
  titleX: TU214.titleX as [number, number],
  fin: TU214.fin,
};

const SETS = { a320: A320_SET, b737: B737_SET, b757: B757_SET, tu214: TU214_SET };
let current: ShapeSet = A320_SET;

/** Текущий набор контуров — тот, для которого строится сцена. */
export const S = (): ShapeSet => current;

/** Выбрать набор контуров по определению; вызывается перед сборкой модели и текстур. */
export function useShapes(def: AircraftDefinition): ShapeSet {
  const base = SETS[def.shapeSet ?? "a320"];
  // Boeing D6-58325-6, figs. 2.2.3 and 2.3.2, 737 Classic installation.
  const classic = def.engine.nacelleProfile === "cfm3b2" || def.engine.name.startsWith("CFM56-3");
  const nacelle = classic ? { ...base.nacelle, axisZ: 4.83, axisY: base.groundY + CLASSIC_COWL.clearanceM + CLASSIC_COWL.lowerRadiusM, clearanceM: CLASSIC_COWL.clearanceM }
    : base.id === "b757"
    ? nacelle757(b757NacelleFor(def.engine))
    : def.id === B737_800.id ? {
      ...base.nacelle,
      refLengthM: B737_800_NACELLE.lengthM,
      clearanceM: B737_800_NACELLE.clearanceM,
      axisY: base.groundY + B737_800_NACELLE.clearanceM + B737_800_NACELLE.widthM * B737_800_NACELLE.lowerRadiusPerWidth,
    }
    : base.nacelle;
  // AC pavement footprints describe axle centres on the assembled aeroplane.
  // Subtract the built-in barrel insert at the scene station, so another
  // fuselage-length adjustment still moves the gear together with the wing.
  let gear = base.gear;
  if (def.id.startsWith("a319")) {
    gear = { ...gear, wheelbaseM: 11.039, wheelbaseForwardPlugM: def.fuselage.shapeStretch?.forwardM };
  } else if (def.id.startsWith("a321")) {
    gear = { ...gear, wheelbaseM: 16.906, wheelbaseForwardPlugM: def.fuselage.shapeStretch?.forwardM,
      mainR: 1.270 / 2, mainTireW: .455 };
  } else if (def.id === "b737-300") {
    gear = { ...gear, boeing737Series: "classic", wheelbaseM: 12.45, wheelbaseForwardPlugM: (32.18 - base.baseLengthM) / 2,
      mainZ: 5.23 / 2, mainR: 40 * .0254 / 2, mainTireW: 14.5 * .0254, mainWheelGap: 30.5 * .0254 / 2 };
  } else if (def.id === "b737-8") {
    // The 737-8 nose strut is eight inches longer than the 737-800 reference mesh.
    gear = { ...gear, boeing737Series: "max", noseLegM: gear.noseLegM + 8 * .0254 };
  }
  current = { ...base, gear, nacelle, stretchReference: def.fuselage.shapeStretch };
  return current;
}
