// Boeing 737-8 (MAX 8) — проверка на самолёте другого производителя того же поколения, что A320neo.
// Источник — Boeing D6-38A004 «737 MAX Airplane Characteristics for Airport Planning» (ред. K, июль 2025): 2.1.2, 2.2.2, 3.2.3.
// OEW в документе не приводится — проверяется только дальность. «По чертежу» — снято с общего вида 2.2.2 по его масштабу.

import { type AircraftDefinition } from "../definition.ts";
import { type MissionAssumptions } from "../mission.ts";
import { A320CEO, A320NEO } from "./a320.ts";
import { B737_ASSUMPTIONS } from "./b737.ts";

const LBF = 4.44822;

export const B737_8: AircraftDefinition = {
  id: "b737-8",
  label: "Boeing 737-8, LEAP-1B",
  shortName: "737-8",
  shapeSet: "b737",
  wing: {
    areaM2: 127, // Boeing, 737 MAX (с законцовками)
    spanM: 34.3, // крыло 737NG без законцовок (Boeing)
    tip: "sharklet", // законцовки Advanced Technology Winglet: аэродинамический размах 35,92 м (2.2.2)
    sharkletSpanM: 35.92,
    taper: 0.24, // допущение
    sweepQuarterDeg: 25,
    thicknessRootPct: 15, // допущение
    controlSurfaceAreaM2: 30, // допущение
    movablesShareOfWing: 0.18,
    highLift: { flapType: "double", flapChordFraction: 0.28, slats: true },
    // Крыло 737NG (1997) спроектировано заново с профилями современного поколения — суперкритическое, как у A320.
    airfoil: { kind: "supercritical", kornKappa: 0.935 },
  },
  // ГО 32,8 м², ВО 26,4 м² — данные 737NG (Jenkinson/Boeing); размах ГО 14,35 м — 2.2.2; плечи — по чертежу.
  htail: { areaM2: 32.8, aspectRatio: 6.3, sweepDeg: 30, armM: 17.6, spanM: 14.35, thicknessPct: 10, controlFraction: 0.25 },
  vtail: { areaM2: 26.4, aspectRatio: 1.9, sweepDeg: 35, armM: 17.1, spanM: 7.1, thicknessPct: 10, controlFraction: 0.3 },
  // Фюзеляж 39,12 м, сечение 3,76 × 4,01 м (2.2.2). Объём гермокабины — пересчёт по длине и сечению (допущение).
  fuselage: { lengthM: 39.12, widthM: 3.76, heightM: 4.01, pressurizedVolumeM3: 317, doorFactor: 1.06 },
  gear: { mainLengthM: 2.2, noseLengthM: 1.7, mainWheels: 4, noseWheels: 2, mainStruts: 2, stallSpeedMs: 58 }, // допущение
  engine: {
    ...A320NEO.engine,
    name: "LEAP-1B",
    // LEAP-1B: вентилятор 1,76 м (69,4 in), B ≈9, Π ≈41, ≈2 780 кг, 28 000 lbf (CFM, вторичные источники). Технологии ядра — как у LEAP-1A.
    dryMassKg: 2780,
    fanDiameterM: 1.76,
    bypassRatio: 9,
    overallPressureRatio: 41,
    nacelleLengthM: A320NEO.engine.nacelleLengthM * (1.76 / 1.98),
    nacelleWidthM: A320NEO.engine.nacelleWidthM * (1.76 / 1.98),
    // Под низким крылом 737 LEAP-1B вынесен вперёд и поднят вплотную к крылу — как у всех 737 с CFM56.
    installation: "close-coupled",
    nacelleRaiseM: 0,
    takeoffThrustKn: (28000 * LBF) / 1000,
    architecture: { fanBlades: 18, boosterStages: 3, hpcStages: 10, hptStages: 2 },
  },
  systems: {
    ...A320CEO.systems,
    seats: 178, // две класса (2.1.2)
    cabinCrew: 4,
    cargoMassKg: Math.round(42.9 * 160), // 42,9 м³ (2.1.2) × 160 кг/м³
    fuelVolumeL: 25816, // 2.1.2
    electricalRoutingM: (A320CEO.systems.electricalRoutingM * 39.12) / 37.57,
  },
  weights: {
    mtowKg: 82644, // 182 200 lb (2.1.2)
    mlwKg: 69308,
    mzfwKg: 65952,
    ultimateLoadFactor: 3.75,
    landingLoadFactor: 4.5,
    operatorItemsKg: Math.round((A320CEO.weights.operatorItemsKg * 178) / 180),
  },
};

/**
 * Миссия графика 3.2.3: режим максимальной дальности, «typical mission rules» (не расписаны) — приняты те же резервы ATA,
 * что у 737-300 и 757. Число Маха LRC ≈0,78 — допущение.
 */
export const B737_8_ASSUMPTIONS: MissionAssumptions = { ...B737_ASSUMPTIONS, cruiseMach: 0.78, stepFLs: [310, 330, 350, 370, 390] };
