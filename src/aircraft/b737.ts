// Boeing 737-300 — проверка модели на самолёте другого производителя. Калибровка — от A320 без изменений.
// Источник размеров, масс и топлива — Boeing D6-58325-6 «737 Airplane Characteristics for Airport Planning»
// (ред. E, ноябрь 2023): 2.1.6, 2.2.3. Значения с пометкой «допущение» — без открытого источника,
// «по чертежу» — сняты с общего вида 2.2.3 по его масштабу.

import { type AircraftDefinition } from "../definition.ts";
import { DEFAULT_ASSUMPTIONS, type MissionAssumptions } from "../mission.ts";
import { A320CEO } from "./a320.ts";

const LB = 0.45359237;
const LBF = 4.44822;

export const B737_300: AircraftDefinition = {
  id: "b737-300",
  label: "Boeing 737-300, CFM56-3",
  wing: {
    areaM2: 91.04, // 980 ft², Boeing (опорная площадь)
    spanM: 28.88, // D6-58325-6, 2.2.3
    tip: "fence", // законцовок нет; «заборчик» в модели = без прироста размаха
    sharkletSpanM: 28.88,
    taper: 0.24, // допущение, как у A320
    sweepQuarterDeg: 25, // Boeing
    thicknessRootPct: 15, // допущение
    controlSurfaceAreaM2: 22, // допущение: ≈24% площади, как у A320
    movablesShareOfWing: 0.18, // допущение, как у A320 (у 737 трёхщелевые закрылки — скорее больше)
    // Трёхщелевые закрылки и предкрылки (Крюгеры у корня). Модель знает только одно- и двухщелевые — берём двухщелевые.
    highLift: { flapType: "double", flapChordFraction: 0.3, slats: true },
    // Крыло 1960-х с профилями до эпохи суперкритических (у -300 доработана только передняя кромка) — обычный профиль, κ 0,87 (Raymer).
    airfoil: { kind: "conventional", kornKappa: 0.87 },
  },
  // ГО: 31,3 м², ВО: 23,1 м² — Jenkinson; плечи — по чертежу 2.2.3; t/c и доли рулей — допущение.
  htail: { areaM2: 31.3, aspectRatio: 5.15, sweepDeg: 30, armM: 15.0, spanM: 12.7, thicknessPct: 10, controlFraction: 0.25 },
  vtail: { areaM2: 23.1, aspectRatio: 1.6, sweepDeg: 35, armM: 14.8, spanM: 6.1, thicknessPct: 10, controlFraction: 0.3 },
  // Длина фюзеляжа 32,18 м, ширина 3,76 м, высота 4,01 м (2.2.3). Объём гермокабины — пересчёт A320 по длине и сечению (допущение).
  fuselage: { lengthM: 32.18, widthM: 3.76, heightM: 4.01, pressurizedVolumeM3: 261, doorFactor: 1.06 },
  gear: {
    mainLengthM: 2.0, // допущение: короткие стойки 737
    noseLengthM: 1.5, // допущение
    mainWheels: 4,
    noseWheels: 2,
    mainStruts: 2,
    stallSpeedMs: 55, // допущение: V_ref ≈ 135 уз при MLW
  },
  engine: {
    name: "CFM56-3B2",
    count: 2,
    dryMassKg: 1940, // CFM56-3B1: 4 276 lb (справочная таблица CFM56, вторичный источник)
    fanDiameterM: 1.52, // 60 in
    bypassRatio: 6.0, // CFM56-3B1 (там же)
    overallPressureRatio: 27.5, // CFM56-3B1 (там же)
    // CFM56-3 (1984): узкохордный вентилятор с полками, КВД 9 ст. от F101, ТВД 1 ст. — холоднее и больше охлаждения,
    // чем у CFM56-5B. Числа — допущения в диапазонах литературы для двигателя начала 1980-х (Mattingly, табл. 4.4).
    cycle: { t4K: 1450, coolingFrac: 0.18, fanEff: 0.86, compEff: 0.87, hptEff: 0.87, lptEff: 0.88, gearbox: false },
    nacelleLengthM: 3.6, // допущение
    nacelleWidthM: 2.05, // допущение («сплюснутый» воздухозаборник)
    // CFM56-3 под низким крылом: гондола придвинута вплотную к нижней поверхности и вынесена вперёд, вход «сплюснут» (2.2.3).
    installation: "close-coupled",
    nacelleRaiseM: 0,
    takeoffThrustKn: (22000 * LBF) / 1000, // CFM56-3B2, 22 000 lbf (2.1.6)
    thrustScale: 1,
    thrustReverser: true,
    architecture: { fanBlades: 38, boosterStages: 3, hpcStages: 9, hptStages: 1 },
  },
  systems: {
    ...A320CEO.systems,
    seats: 128, // смешанная компоновка, для которой дан OEW (2.1.6)
    cabinCrew: 3,
    cargoMassKg: Math.round(30.2 * 160), // 30,2 м³ (2.1.6) × 160 кг/м³, как у A320
    fuelVolumeL: 20102, // 2.1.6
    generatorsKva: 50, // допущение
    electricalRoutingM: (A320CEO.systems.electricalRoutingM * 32.18) / 37.57,
    avionicsUninstalledKg: 600, // допущение
  },
  weights: {
    mtowKg: 61235, // 135 000 lb (2.1.6)
    mlwKg: 51710, // 114 000 lb
    mzfwKg: 48308, // 106 500 lb
    ultimateLoadFactor: 3.75,
    landingLoadFactor: 4.5,
    operatorItemsKg: Math.round((A320CEO.weights.operatorItemsKg * 128) / 180), // ∝ местам, допущение
  },
};

/** OEW 737-300 при этих массах — 72 540 lb (2.1.6, смешанная компоновка). */
export const B737_300_OEW_KG = Math.round(72540 * LB);

/**
 * Миссия графиков Boeing: «domestic reserves», крейсер на режиме максимальной дальности на FL310/350.
 * Правила резервов в документе не расписаны — принято: без 5% на непредвиденное, запасной 200 nm, 45 мин ожидания.
 * Число Маха LRC ≈0,745 для 737-300 — допущение.
 */
export const B737_ASSUMPTIONS: MissionAssumptions = {
  ...DEFAULT_ASSUMPTIONS,
  cruiseMach: 0.745,
  stepFLs: [290, 310, 330, 350, 370],
  contingencyFraction: 0,
  alternateDistanceNm: 200,
  finalReserveMin: 45,
  // «Domestic reserves» в графиках Boeing — правила ATA для внутренних рейсов США: 45 мин продолжения крейсера.
  finalReserveMode: "cruise",
};

/** Плотность топлива в графиках Boeing: 6,7 lb/US gal. */
export const BOEING_FUEL_KG_PER_L = (6.7 * LB) / 3.785411784;
