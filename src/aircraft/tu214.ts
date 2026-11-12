// Ту-214 (раннее обозначение Ту-204-200): отдельное определение, без переноса геометрии Boeing.
// Статус: инженерный прогноз; графики РЛЭ для валидации миссии пока недоступны.
// Геометрия: чертёж пользователя + УИ ГА, 2024 (docs/TU214_MODEL.md).
// Ограничения/топливо: ОАК и КДСТ. Двигатель: Пермские моторы, ПС-90А.
import { type AircraftDefinition } from "../definition.ts";
import { DEFAULT_ASSUMPTIONS, type MissionAssumptions } from "../mission.ts";
import { A320CEO } from "./a320.ts";

export const TU214_REFERENCE = {
  lengthOverallM: 46.14,
  wingSpanM: 41.84,
  wingAreaGrossM2: 184.17,
  wingAreaDesignM2: 168.63,
  maxFuelKg: 35710,
  factoryMaxPayloadKg: 25200,
  operationalMaxPayloadKg: 22370,
  // Разные весовые комплектации, НЕ единая заводская взвешенная ведомость.
  factoryOewKg: 59000,
  operationalOewKg: 61830,
  mzfwKg: 84200,
  mtowKg: 110750,
  mlwKg: 93000,
  engineCruiseTsfcKgPerKgfHour: 0.595,
} as const;

// 0,78 кг/л — согласованная плотность для указанных пользователем 35 710 кг;
// у A320 остаётся собственная калибровочная плотность 0,785.
export const TU214_FUEL_DENSITY_KG_L = 0.78;
// Исходная OEW, вычисленная тем же оценщиком с калибровкой A320 до ввода весовых профилей.
// Версионированный диагностический якорь — НЕ заводская масса агрегатов. При изменении
// формул/калибровки тест покажет дрейф опорной OEW, вместо скрытой переподгонки.
export const TU214_UNADJUSTED_OEW_REFERENCE_KG = 58260.18802078101;
export const TU214_FACTORY_OEW_RECONCILIATION_KG =
  TU214_REFERENCE.factoryOewKg - TU214_UNADJUSTED_OEW_REFERENCE_KG;
export const TU214_ADDITIONAL_EQUIPMENT_KG =
  TU214_REFERENCE.operationalOewKg - TU214_REFERENCE.factoryOewKg;

export const TU214_PS90A: AircraftDefinition = {
  id: "tu214-ps90a",
  label: "Ту-214 / ПС-90А · эксплуатационная комплектация",
  shortName: "Ту-214",
  shapeSet: "tu214",
  wing: {
    areaM2: TU214_REFERENCE.wingAreaGrossM2, // площадь полной геометрии; расчетная 168.63 хранится отдельно
    spanM: TU214_REFERENCE.wingSpanM,
    tip: "blended", // собственные загнутые законцовки Ту-214; не A320 fences/sharklets, пока без отдельной аэродинамической поправки
    sharkletSpanM: TU214_REFERENCE.wingSpanM,
    taper: 1 / 3.93,
    sweepQuarterDeg: 28,
    thicknessRootPct: 14.5,
    controlSurfaceAreaM2: 44, // оценка до получения точных площадей механизации
    movablesShareOfWing: 0.18, // перенос калибровки A320: проверить отдельно
    highLift: { flapType: "double", flapChordFraction: 0.28, slats: true }, // предварительное описание
    airfoil: { kind: "supercritical", kornKappa: 0.92 }, // κ — допущение, не параметр РЛЭ
  },
  htail: {
    areaM2: 43.875, // сопоставимый вариант Ту-204, требует сверки применимости Ту-214
    aspectRatio: 5.13, sweepDeg: 32.8,
    armM: 21.0, spanM: 15.018, thicknessPct: 11, controlFraction: 0.3,
  },
  vtail: {
    areaM2: 34.295, // инженерный ориентир семейства Ту-204
    aspectRatio: 1.6, sweepDeg: 40.2,
    armM: 20.8, spanM: 7.775, thicknessPct: 10, controlFraction: 0.32,
  },
  fuselage: {
    lengthM: 45.22, widthM: 3.8, heightM: 4.1,
    pressurizedVolumeM3: 405, // упрощённая оценка по цилиндрической части, не объём из паспорта
    doorFactor: 1.06,
  },
  gear: {
    mainLengthM: 2.5, noseLengthM: 2.0,
    mainWheels: 8, noseWheels: 2, mainStruts: 2,
    stallSpeedMs: 60, // предварительный порядок скорости сваливания
  },
  engine: {
    name: "ПС-90А", count: 2,
    dryMassKg: 2950, // производитель: сухая, а не поставочная масса 4300 кг
    fanDiameterM: 1.9,
    bypassRatio: 4.4,
    overallPressureRatio: 35.5, // внешний тех. источник, условия не сопоставлены с точкой крейсера
    cycle: {
      // ВАЖНО: 1640 K у производителя — предельный режим, не температура в крейсере.
      // Ниже — диапазонно правдоподобные, НО НЕ заводские параметры крейсерского цикла.
      t4K: 1510, coolingFrac: 0.17, fanEff: 0.87, compEff: 0.87,
      hptEff: 0.87, lptEff: 0.88, gearbox: false,
    },
    nacelleLengthM: 5.7, // внешний габарит по чертежу пока не идентифицирован точно
    nacelleWidthM: 2.36, // приближение; диаметр вентилятора 1.9 м — отдельный заводской факт
    installation: "pylon", nacelleRaiseM: 0,
    takeoffThrustKn: 16000 * 9.80665 / 1000,
    thrustScale: 1,
    thrustReverser: true,
    // ПС-90А — двухвальный, со смешением потоков; сейчас в 3D разделённые сопла.
    architecture: { fanBlades: 33, boosterStages: 2, hpcStages: 13, hptStages: 2, spools: 2 },
  },
  systems: {
    ...A320CEO.systems,
    crew: 3,
    seats: 210, // предел компоновки по ОАК; не универсальное число пассажиров для OEW
    cabinCrew: 5, // предварительно
    seatPitchM: 0.79, seatsAbreast: 6,
    cargoMassKg: 8000, // параметр оценщика массы, без подтверждённого объёма багажа
    fuelVolumeL: Math.round(TU214_REFERENCE.maxFuelKg / TU214_FUEL_DENSITY_KG_L),
    fuelTanks: 5, // условная группировка системы, не буквальное число баков по РЛЭ
    generatorsKva: 90, generators: 3, // предварительная электрическая конфигурация
    electricalRoutingM: A320CEO.systems.electricalRoutingM * (45.22 / 37.57),
    avionicsUninstalledKg: 850, apuUninstalledKg: 170, // оценки, без ведомости массы
  },
  weights: {
    mtowKg: TU214_REFERENCE.mtowKg,
    mlwKg: TU214_REFERENCE.mlwKg,
    mzfwKg: TU214_REFERENCE.mzfwKg,
    maxPayloadKg: TU214_REFERENCE.operationalMaxPayloadKg,
    // Разница заводской OEW от физического оценщика отдельно, без подгонки крыла/двигателя.
    oewReconciliationKg: TU214_FACTORY_OEW_RECONCILIATION_KG,
    // Временная оценка дополнительного оснащения конкретной эксплуатационной комплектации.
    additionalEquipmentKg: TU214_ADDITIONAL_EQUIPMENT_KG,
    ultimateLoadFactor: 3.75,
    landingLoadFactor: 4.5,
    operatorItemsKg: 4650, // ориентир относительно A320, не опубликованная спецификация
  },
};

/** Заводская базовая комплектация (иллюстративная OEW 59,0 т). Те же геометрия и двигатель. */
export const TU214_FACTORY: AircraftDefinition = {
  ...TU214_PS90A,
  id: "tu214-ps90a-factory",
  label: "Ту-214 / ПС-90А · заводская комплектация",
  weights: {
    ...TU214_PS90A.weights,
    maxPayloadKg: TU214_REFERENCE.factoryMaxPayloadKg,
    additionalEquipmentKg: 0,
  },
};

/** Общие резервы сравнения, не нормативный полётный план Ту-214. Скорость предварительная. */
export const TU214_ASSUMPTIONS: MissionAssumptions = {
  ...DEFAULT_ASSUMPTIONS,
  cruiseMach: 0.78,
  cruiseSpeedMode: "fixedMach",
  lrcTable: undefined,
  cruiseAltitudeMode: "stepClimb",
  stepFLs: [290, 310, 330, 350, 370, 390],
};
