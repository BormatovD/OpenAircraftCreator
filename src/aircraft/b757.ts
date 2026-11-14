// Boeing 757-200 — ближайший открыто документированный аналог Ту-214: тот же класс (≈110 т, ≈200 мест), то же
// поколение (начало 1980-х), два двигателя на пилонах под низкопланом. Калибровка — от A320 без изменений.
// Источник размеров, масс, топлива и диаграмм — Boeing D6-58327 «757 Airplane Characteristics for Airport Planning»
// (ред. H, декабрь 2024): 2.1.1, 2.1.2, 2.2.1, 3.2.2, 3.2.3. «По чертежу» — снято с общего вида 2.2.1 по его масштабу.

import shapes from "../../data/ac/b757-shapes.json" with { type: "json" };
import { type AircraftDefinition, type EngineDef } from "../definition.ts";
import { type MissionAssumptions } from "../mission.ts";
import { A320CEO } from "./a320.ts";
import { B737_ASSUMPTIONS } from "./b737.ts";

const LB = 0.45359237;
const LBF = 4.44822;

/** Reference installation shared by the clearance check and the 3D scene. */
export function b757NacelleFor(engine: EngineDef) {
  return engine.name.startsWith("PW") ? shapes.nacelleByEngine.PW2000 : shapes.nacelleByEngine.RB211;
}

const base: AircraftDefinition = {
  id: "b757-200",
  label: "Boeing 757-200",
  shortName: "757-200",
  shapeSet: "b757",
  wing: {
    areaM2: 185.25, // 1 994 ft², Boeing (опорная площадь)
    spanM: 38.05, // 2.2.1
    tip: "none", // исходный 757-200 по 2.2.1, без добавочных законцовок
    sharkletSpanM: 38.05,
    taper: 0.24, // допущение
    sweepQuarterDeg: 25, // Boeing
    thicknessRootPct: 15, // допущение
    controlSurfaceAreaM2: 44, // допущение: ≈24% площади, как у A320
    movablesShareOfWing: 0.18, // допущение
    // Двухщелевые закрылки и предкрылки.
    highLift: { flapType: "double", flapChordFraction: 0.28, slats: true },
    // Крыло 757/767 (конец 1970-х): профили с нагруженной хвостовой частью — между обычными и суперкритическими. κ 0,91 — допущение.
    airfoil: { kind: "aft-loaded", kornKappa: 0.91 },
  },
  // ГО 50,35 м², ВО 34,37 м² — Jenkinson; размах ГО 15,21 м — 2.2.1; плечи — по чертежу; t/c и доли рулей — допущение.
  htail: { areaM2: 50.35, aspectRatio: 4.6, sweepDeg: 30, armM: 20.0, spanM: 15.21, thicknessPct: 10, controlFraction: 0.25 },
  vtail: { areaM2: 34.37, aspectRatio: 1.6, sweepDeg: 35, armM: 19.5, spanM: 7.4, thicknessPct: 10, controlFraction: 0.3 },
  // Фюзеляж 46,97 м, сечение как у 737 (3,76 × 4,01 м) — 2.2.1. Объём гермокабины — пересчёт по длине и сечению (допущение).
  fuselage: { lengthM: 46.97, widthM: 3.76, heightM: 4.01, pressurizedVolumeM3: 380, doorFactor: 1.06 },
  gear: {
    mainLengthM: 2.6, // допущение
    noseLengthM: 1.9, // допущение
    mainWheels: 8, // две тележки по 4 колеса
    noseWheels: 2,
    mainStruts: 2,
    stallSpeedMs: 60, // допущение: V_ref ≈ 140 уз при MLW
  },
  engine: undefined as unknown as EngineDef, // задаётся вариантом ниже
  systems: {
    ...A320CEO.systems,
    seats: 186, // две класса, для которых дан OEW (2.1.1)
    cabinCrew: 5,
    cargoMassKg: Math.round(51 * 160), // 51 м³ (2.1.1) × 160 кг/м³, как у A320
    fuelVolumeL: 42684, // 2.1.1
    electricalRoutingM: (A320CEO.systems.electricalRoutingM * 46.97) / 37.57,
  },
  weights: {
    mtowKg: 108862, // 240 000 lb (2.1.1)
    mlwKg: 89811, // 198 000 lb
    mzfwKg: 83461, // 184 000 lb
    ultimateLoadFactor: 3.75,
    landingLoadFactor: 4.5,
    operatorItemsKg: Math.round((A320CEO.weights.operatorItemsKg * 186) / 180), // ∝ местам, допущение
  },
};

/**
 * RB211-535E4-37: трёхвальный, установленная тяга 39 610 lbf, B ≈4,4, Π ≈28, вентилятор 1,88 м, 3 295 кг (справочные данные Rolls-Royce,
 * вторичные источники). Первый в гражданской эксплуатации широкохордный полый титановый вентилятор без полок — КПД
 * вентилятора выше, чем у ровесников. Длинная гондола со смешением потоков — в модели (раздельные сопла) не учтено.
 */
const RB211: EngineDef = {
  name: "RB211-535E4",
  nacelleProfile: "rb211",
  count: 2,
  dryMassKg: 3295,
  fanDiameterM: 1.88,
  bypassRatio: 4.4,
  overallPressureRatio: 28,
  cycle: { t4K: 1450, coolingFrac: 0.18, fanEff: 0.885, compEff: 0.87, hptEff: 0.87, lptEff: 0.88, gearbox: false },
  nacelleLengthM: 5.4, // допущение: длинная гондола
  nacelleWidthM: shapes.nacelleByEngine.RB211.width_m,
  installation: "pylon",
  nacelleRaiseM: 0,
  // Installed static rating, RB211-535E4-37: FAA A2NM / EASA E.061 §6.
  // 40,100 lbf was the bare-engine equivalent, not the installed rating.
  takeoffThrustKn: (39610 * LBF) / 1000,
  thrustScale: 1,
  thrustReverser: true,
  // EASA E.061 §III.2. The single-stage LP fan has no booster.
  architecture: {
    fanBlades: 22, boosterStages: 0, ipcStages: 6, hpcStages: 6, hptStages: 1, iptStages: 1, lptStages: 3, spools: 3,
    combustor: "rb211-phase2",
    exhaust: "annularMixer",
    turbineBlading: { hp: [{ rotor: 102 }], ip: [{ rotor: 112 }], lp: [{ rotor: 78 }, { rotor: 64 }, { rotor: 64 }] },
  },
};

/**
 * PW2037: двухвальный, установленная тяга 37 530 lbf, B ≈6,0, Π ≈27,6, вентилятор 1,99 м, 3 311 кг (справочные данные P&W, вторичные источники).
 * Первые в гражданской эксплуатации монокристаллические лопатки турбины — температура выше и охлаждения меньше, чем у ровесников.
 */
const PW2037: EngineDef = {
  ...RB211,
  name: "PW2037",
  nacelleProfile: "pw2037",
  dryMassKg: 3311,
  fanDiameterM: 1.99,
  bypassRatio: 6.0,
  overallPressureRatio: 27.6,
  cycle: { t4K: 1500, coolingFrac: 0.16, fanEff: 0.87, compEff: 0.875, hptEff: 0.875, lptEff: 0.885, gearbox: false },
  nacelleLengthM: 5.6,
  nacelleWidthM: shapes.nacelleByEngine.PW2000.width_m,
  // FAA A2NM §I, installed PW2037: 37,530 lbf, SL ISA, five minutes.
  takeoffThrustKn: (37530 * LBF) / 1000,
  // Pratt & Whitney, NASA CR-191066 §3.1 and Fig. 3-1.
  architecture: {
    fanBlades: 36, boosterStages: 4, hpcStages: 12, hptStages: 2, lptStages: 5, spools: 2,
    combustor: "pw2037-rolled-ring",
    exhaust: "separateNozzles",
    turbineBlading: {
      hp: [{ rotor: 48, vanes: 36 }, { rotor: 64, vanes: 40 }],
      lp: [{ rotor: 158 }, { rotor: 138 }, { rotor: 102 }, { rotor: 90 }, { rotor: 94 }],
    },
  },
};

export const B757_RB211: AircraftDefinition = { ...base, id: "b757-200-rb", label: "Boeing 757-200, RB211-535E4", engine: RB211 };
export const B757_PW2037: AircraftDefinition = { ...base, id: "b757-200-pw", label: "Boeing 757-200, PW2037", engine: PW2037 };

/** OEW 757-200 при MTOW 240 000 lb (2.1.1, «spec»). */
export const B757_OEW_KG = { rb211: Math.round(132280 * LB), pw2037: Math.round(130860 * LB) };

/** Миссия графиков 3.2.2–3.2.3: M 0,80 на FL350 и FL390, резервы ATA для внутренних рейсов. */
export const B757_ASSUMPTIONS: MissionAssumptions = {
  ...B737_ASSUMPTIONS,
  cruiseMach: 0.8,
  cruiseSpeedMode: "fixedMach",
  lrcTable: undefined,
  stepFLs: [350, 390],
};
