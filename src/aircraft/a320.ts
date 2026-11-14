// Определения A320ceo и A320neo. Источники: Airbus AC A320 (ред. 44), Jenkinson «Civil Jet Aircraft Design»
// (оперение, гондолы), данные двигателей. Значения с пометкой «допущение» — без открытого источника.

import { type AircraftDefinition } from "../definition.ts";

export const A320CEO: AircraftDefinition = {
  id: "a320ceo",
  label: "A320ceo, законцовки-«заборчики», CFM56-5B",
  shortName: "A320",
  wing: {
    areaM2: 122.4, // Jenkinson; Airbus — 122,6
    spanM: 34.1, // AC 2-2-0
    tip: "fence",
    sharkletSpanM: 35.8, // AC 2-2-0
    taper: 0.24, // Jenkinson
    sweepQuarterDeg: 25, // Airbus
    thicknessRootPct: 15, // допущение
    controlSurfaceAreaM2: 28, // закрылки 21,1 м² (Jenkinson) + элероны и интерцепторы — допущение
    // Torenbeek, ур. C-10 для однощелевых закрылков Фаулера (21,1 м², 215 уз, 40°): ≈0,78 т, ×1,2 на
    // каретки и обтекатели ≈0,94 т; интерцепторы 1,5% крыла; предкрылки и элероны ≈0,3 т — допущение.
    // Итого ≈1,3 т из ≈7,3 т крыла → 18%.
    movablesShareOfWing: 0.18,
    // Однощелевые закрылки Фаулера на 74–100% хорды и предкрылки по всему размаху (AC 2-2-0, вид сверху).
    highLift: { flapType: "single", flapChordFraction: 0.26, slats: true },
    // Суперкритический профиль (A320 — первый узкофюзеляжник с ним). κ подобрано так, чтобы M_dd ≈ MMO 0,82.
    airfoil: { kind: "supercritical", kornKappa: 0.935 },
  },
  htail: { areaM2: 31.0, aspectRatio: 5.0, sweepDeg: 29, armM: 13.53, spanM: 12.45, thicknessPct: 10, controlFraction: 0.25 }, // Jenkinson; t/c и доля рулей — допущение
  vtail: { areaM2: 21.5, aspectRatio: 1.82, sweepDeg: 34, armM: 12.53, spanM: 6.26, thicknessPct: 10, controlFraction: 0.3 }, // Jenkinson; t/c и доля руля — допущение
  fuselage: { lengthM: 37.57, widthM: 3.95, heightM: 4.14, pressurizedVolumeM3: 330, doorFactor: 1.06 }, // AC 2-1-1, 2-2-0
  gear: {
    mainLengthM: 2.87, // AC 2-9-0, по чертежу
    noseLengthM: 1.96, // AC 2-9-0, по чертежу
    mainWheels: 4,
    noseWheels: 2,
    mainStruts: 2,
    stallSpeedMs: 56, // V_app 134 kt / 1,23 (Jenkinson)
  },
  engine: {
    name: "CFM56-5B",
    nacelleProfile: "cfm5b",
    count: 2,
    dryMassKg: 2380, // Purdue AAE (5 250 lb)
    fanDiameterM: 1.73, // 68,3 in, Aircraft Commerce
    bypassRatio: 5.7,
    overallPressureRatio: 32.6, // справочник planefyi; другие источники дают 27–35,5 — см. README
    // Цикл в крейсере. Конструкция — по CFM: вентилятор из 36 титановых лопаток с антивибрационными полками,
    // КВД 9 ст., ТВД 1 ст. Числа — допущения в диапазонах учебной литературы для двигателя середины 1990-х
    // (Mattingly, табл. 4.4): уровень привязан к A320 калибровкой TSFC, на разницу между двигателями работают отличия.
    cycle: { t4K: 1550, coolingFrac: 0.16, fanEff: 0.87, compEff: 0.88, hptEff: 0.88, lptEff: 0.89, gearbox: false },
    nacelleLengthM: 4.44, // Jenkinson
    nacelleWidthM: 2.37, // Jenkinson
    installation: "pylon", // гондола на пилоне впереди крыла (AC 2-2-0)
    nacelleRaiseM: 0,
    takeoffThrustKn: 120.1, // CFM56-5B4: 27 000 lbf, плоский режим до 45 °C (Aircraft Commerce)
    thrustScale: 1,
    thrustReverser: true,
    // CFM56-5B: 36 титановых лопаток, подпорный компрессор 4 ст., КВД 9 ст., ТВД 1 ст. (ТНД 4 ст.)
    architecture: {
      fanBlades: 36, boosterStages: 4, hpcStages: 9, hptStages: 1, lptStages: 4, exhaust: "separateNozzles",
      compressorBlading: { lp: [64, 70, 70, 68], hp: [38, 53, 60, 68, 75, 82, 82, 80, 76] },
      turbineBlading: { hp: [{ rotor: 80 }], lp: [162, 150, 150, 134].map(rotor => ({ rotor })) },
    },
  },
  systems: {
    crew: 2,
    seats: 180, // AC 2-4-1, один класс
    cabinCrew: 4,
    seatPitchM: 0.737, // 29 in, AC 2-4-1
    seatsAbreast: 6,
    cargoMassKg: 6200, // 38,76 м³ × 160 кг/м³ — допущение
    fuelVolumeL: 24209, // AC 2-1-1
    fuelTanks: 3,
    flightControlFunctions: 7,
    generatorsKva: 90,
    generators: 3, // 2 IDG + генератор ВСУ
    electricalRoutingM: 30, // допущение
    avionicsUninstalledKg: 700, // допущение
    apuUninstalledKg: 140, // допущение
    harnessShareOfElectrical: 0.6, // допущение: жгуты и распределение в ATA 24
    // Доли проводки в массах систем — допущения; сумма ≈1,85 т (оценка для узкофюзеляжника — ≈2 т, MDPI 2025).
    ewisShares: {
      avionics: 0.45,
      instruments: 0.4,
      flightControls: 0.15,
      furnishings: 0.08,
      "engine.controls": 0.35,
      airConditioning: 0.06,
      fuel: 0.15,
      antiIce: 0.2,
      apu: 0.05,
      hydraulics: 0.05,
      "gear.main": 0.02,
    },
  },
  weights: {
    mtowKg: 73500,
    mlwKg: 64500,
    mzfwKg: 60500, // AC 2-1-1, WV000
    ultimateLoadFactor: 3.75,
    landingLoadFactor: 4.5,
    operatorItemsKg: 4060, // 9,84% от OEW по аналогу 737-200 (NASA TM 20190000431) × 41 244 кг
  },
};

/** NEO = CEO + шарклеты + новые двигатели с гондолами, масштабированными по диаметру вентилятора. */
export function a320neoFrom(ceo: AircraftDefinition): AircraftDefinition {
  const fanRatio = 1.98 / ceo.engine.fanDiameterM;
  return {
    ...structuredClone(ceo),
    id: "a320neo",
    label: "A320neo, шарклеты, LEAP-1A",
    shortName: "A320neo",
    wing: { ...ceo.wing, tip: "sharklet" },
    engine: {
      ...ceo.engine,
      name: "LEAP-1A",
      nacelleProfile: "leap1a",
      dryMassKg: 2990, // справочник planefyi, вторичный источник
      fanDiameterM: 1.98, // 78 in, Aircraft Commerce
      bypassRatio: 11,
      takeoffThrustKn: 120.6, // LEAP-1A26: 27 120 lbf (CFM)
      overallPressureRatio: 40, // CFM, на взлёте; 50 на верху набора
      // Отличия от CFM56-5B — конкретные решения LEAP (CFM): 18 широкохордных лопаток из 3D-плетёного углепластика без полок
      // (КПД вентилятора ↑), КВД 10 ст. с 3D-аэродинамикой (↑), ТВД 2 ст. с керамическими (CMC) бандажами и монокристаллом
      // 2-го поколения — горячее и меньше охлаждения. Числа — допущения в диапазонах литературы.
      cycle: { t4K: 1700, coolingFrac: 0.13, fanEff: 0.9, compEff: 0.9, hptEff: 0.89, lptEff: 0.9, gearbox: false },
      nacelleLengthM: ceo.engine.nacelleLengthM * fanRatio,
      nacelleWidthM: ceo.engine.nacelleWidthM * fanRatio,
      // Клиренс NEO по AC 2-3-0 ≈0,46 м, а чистая геометрия (та же установка) даёт ≈0,40 м:
      // Airbus поднял двигатель примерно на 6 см (пилон/установка). Значение выведено, а не взято из источника.
      nacelleRaiseM: 0.06,
      // LEAP-1A: 18 углепластиковых лопаток (3D-плетение), подпорный 3 ст., КВД 10 ст., ТВД 2 ст. (ТНД 7 ст.)
      architecture: { fanBlades: 18, boosterStages: 3, hpcStages: 10, hptStages: 2, lptStages: 7, exhaust: "separateNozzles" },
    },
    systems: { ...ceo.systems, fuelVolumeL: 23740 },
    weights: { ...ceo.weights, mlwKg: 66300, mzfwKg: 62800 }, // AC 2-1-1, WV050
  };
}

export const A320NEO = a320neoFrom(A320CEO);

/** OEW из Airbus AC: CEO — 2-3-0, NEO — 2-14-0. */
export const AC_OEW_KG = { a320ceo: 41244, a320neo: 43144 } as const;
