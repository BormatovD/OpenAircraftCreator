// A319 и A321 — проверка модели на других членах семейства. Строятся из A320 заменой того, что известно
// из Airbus AC A319/A321 (2-1-1, 2-2-0, 2-4-1): длина и объём фюзеляжа, места, топливо, массы, тяга, механизация.
// Всё остальное — как у A320: то же крыло, оперение, шасси, двигатель CFM56-5B того же размера.
// Проверка честная: калибровка (массы, TSFC, поляра) берётся с A320 без изменений.

import { type AircraftDefinition } from "../definition.ts";
import { highLiftAnchor, highLiftPerf } from "../highlift.ts";
import { A320CEO, a320neoFrom } from "./a320.ts";

const KT = 0.514444;
const LBF = 4.44822;
/** Шаг шпангоутов A320, м (21 in). */
const FRAME = 0.5334;
const A320_CARGO_M3 = 38.76;

interface Variant {
  id: string;
  label: string;
  lengthM: number;
  pressurizedVolumeM3: number;
  /** Вставка (−: укорочение) перед крылом и за ним, м. Плечи оперения меняются на заднюю. */
  plugFwdM: number;
  plugAftM: number;
  seats: number;
  cabinCrew: number;
  cargoM3: number;
  fuelL: number;
  mtowKg: number;
  mlwKg: number;
  mzfwKg: number;
  thrustLbf: number;
  /** Двухконтурность и степень сжатия модификации CFM56-5B (справочная таблица CFM56, вторичный источник). */
  bpr: number;
  opr: number;
  flapType: "single" | "double";
}

function variantOf(v: Variant): AircraftDefinition {
  const a = A320CEO;
  const d: AircraftDefinition = {
    ...structuredClone(a),
    id: v.id,
    label: v.label,
    shortName: v.id.slice(0, 4).toUpperCase(),
    wing: { ...a.wing, highLift: { ...a.wing.highLift, flapType: v.flapType } },
    htail: { ...a.htail, armM: a.htail.armM + v.plugAftM },
    vtail: { ...a.vtail, armM: a.vtail.armM + v.plugAftM },
    fuselage: {
      ...a.fuselage, lengthM: v.lengthM, pressurizedVolumeM3: v.pressurizedVolumeM3,
      shapeStretch: { referenceLengthM: v.lengthM, forwardM: v.plugFwdM },
    },
    engine: { ...a.engine, takeoffThrustKn: (v.thrustLbf * LBF) / 1000, bypassRatio: v.bpr, overallPressureRatio: v.opr },
    systems: {
      ...a.systems,
      seats: v.seats,
      cabinCrew: v.cabinCrew,
      // Груз — тот же удельный вес, что у A320 (160 кг/м³), по объёму трюмов из AC 2-1-1.
      cargoMassKg: Math.round(a.systems.cargoMassKg * (v.cargoM3 / A320_CARGO_M3)),
      fuelVolumeL: v.fuelL,
      electricalRoutingM: a.systems.electricalRoutingM * (v.lengthM / a.fuselage.lengthM),
    },
    weights: {
      ...a.weights,
      mtowKg: v.mtowKg,
      mlwKg: v.mlwKg,
      mzfwKg: v.mzfwKg,
      // Оборудование эксплуатанта (экипаж, питание, вода, документы) — пропорционально местам. Допущение.
      operatorItemsKg: Math.round((a.weights.operatorItemsKg * v.seats) / a.systems.seats),
    },
  };
  // Скорость сваливания для оценки массы шасси — из модели механизации при MLW (у A320 — из V_app).
  const vs = highLiftPerf(d, highLiftAnchor(a)).vStallKt * KT;
  return { ...d, gear: { ...d.gear, stallSpeedMs: vs } };
}

/**
 * A319ceo: −3,73 м (AC 2-2-0: 33,84 м), 4 шпангоута перед крылом и 3 за ним — по описанию программы, не из AC.
 * 156 мест в один класс (AC 2-4-1), 4 бортпроводника; CFM56-5B6 23 500 lbf (Aircraft Commerce); WV002.
 */
export const A319CEO = variantOf({
  id: "a319ceo",
  label: "A319ceo, «заборчики», CFM56-5B",
  lengthM: 33.84,
  pressurizedVolumeM3: 285,
  plugFwdM: -4 * FRAME,
  plugAftM: -3 * FRAME,
  seats: 156,
  cabinCrew: 4,
  cargoM3: 8.52 + 11.92 + 7.22,
  fuelL: 24209,
  mtowKg: 75500,
  mlwKg: 62500,
  mzfwKg: 58500,
  thrustLbf: 23500,
  bpr: 5.9, // CFM56-5B6
  opr: 32.6,
  flapType: "single",
});

/**
 * A321ceo: +6,94 м (AC: 44,51 м) — вставки 4,27 м перед крылом и 2,67 м за ним (по описанию программы, не из AC).
 * 220 мест в один класс (AC 2-4-1), 5 бортпроводников; двухщелевые закрылки; CFM56-5B3 32 000 lbf
 * (Aircraft Commerce); WV011 (93,5 т).
 */
export const A321CEO = variantOf({
  id: "a321ceo",
  label: "A321ceo, «заборчики», CFM56-5B",
  lengthM: 44.51,
  pressurizedVolumeM3: 418,
  plugFwdM: 4.27,
  plugAftM: 2.67,
  seats: 220,
  cabinCrew: 5,
  cargoM3: 22.81 + 23.03 + 5.88,
  fuelL: 24050,
  mtowKg: 93500,
  mlwKg: 77800,
  mzfwKg: 73800,
  thrustLbf: 32000,
  bpr: 5.4, // CFM56-5B3
  opr: 35.5,
  flapType: "double",
});

/** NEO — та же замена двигателя, что A320 → A320neo; топливо и массы — из AC 2-1-1 (A319neo WV054, A321neo WV052). */
function neoOf(ceo: AircraftDefinition, id: string, label: string, fuelL: number, thrustLbf: number, mlwKg: number, mzfwKg: number): AircraftDefinition {
  const n = a320neoFrom(ceo);
  return {
    ...n,
    id,
    label,
    shortName: `${ceo.shortName}neo`,
    engine: { ...n.engine, takeoffThrustKn: (thrustLbf * LBF) / 1000 },
    systems: { ...n.systems, fuelVolumeL: fuelL },
    weights: { ...n.weights, mtowKg: ceo.weights.mtowKg, mlwKg, mzfwKg },
  };
}

export const A319NEO = neoOf(A319CEO, "a319neo", "A319neo, LEAP-1A", 23740, 24500, 62800, 58800);
export const A321NEO = neoOf(A321CEO, "a321neo", "A321neo, LEAP-1A", 23490, 32160, 77300, 73300);
