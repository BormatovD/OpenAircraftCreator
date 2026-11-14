// Определение самолёта — чистые данные. Рычаги меняют определение (геометрию, двигатель),
// а оценщики масс и аэродинамика читают только его. Новый рычаг = новое поле или новая правка
// определения, без переписывания расчёта.

export interface WingDef {
  areaM2: number;
  /** Конструктивный размах без законцовок. */
  spanM: number;
  /** Законцовки: blended = штатная загнутая законцовка. sharkletSpanM задаёт полный размах и для blended. */
  tip: "none" | "fence" | "sharklet" | "blended";
  sharkletSpanM: number;
  taper: number;
  sweepQuarterDeg: number;
  thicknessRootPct: number;
  /** Площадь механизации и элеронов на крыле, м². */
  controlSurfaceAreaM2: number;
  /**
   * Доля подвижных частей (предкрылки, закрылки с кареткам и обтекателями, элероны, интерцепторы)
   * в массе крыла. Делит оценку Raymer на кессон и механизацию.
   */
  movablesShareOfWing: number;
  /** Механизация: тип закрылков, их хорда (доля хорды крыла) и наличие предкрылков. */
  highLift: HighLiftDef;
  /**
   * Профиль крыла — константа Корна κ в формуле числа Маха расходимости: обычный профиль (NACA 6-й серии) 0,87,
   * суперкритический 0,95 (Raymer, Korn). Чем выше, тем позже начинается волновое сопротивление.
   */
  airfoil: { kind: "conventional" | "aft-loaded" | "supercritical"; kornKappa: number };
}

export interface HighLiftDef {
  /** "single" — однощелевые Фаулера (A320), "double" — двухщелевые (A321). */
  flapType: "single" | "double";
  flapChordFraction: number;
  slats: boolean;
}

export interface TailDef {
  areaM2: number;
  aspectRatio: number;
  sweepDeg: number;
  armM: number;
  spanM: number;
  thicknessPct: number;
  controlFraction: number;
}

export interface FuselageDef {
  lengthM: number;
  widthM: number;
  heightM: number;
  pressurizedVolumeM3: number;
  /** Raymer K_door: 1,06 — один боковой грузовой люк. */
  doorFactor: number;
  /** Продольное положение крыла при переносе базового чертежа: длина варианта и передняя вставка.
   * Дополнительное удлинение рычагом делится поровну; на расчёт масс/сопротивления это поле не влияет. */
  shapeStretch?: { referenceLengthM: number; forwardM: number };
}

export interface GearDef {
  mainLengthM: number;
  noseLengthM: number;
  mainWheels: number;
  noseWheels: number;
  mainStruts: number;
  stallSpeedMs: number;
}

export interface EngineDef {
  name: string;
  count: number;
  dryMassKg: number;
  fanDiameterM: number;
  bypassRatio: number;
  /** Суммарная степень сжатия (вентилятор × компрессоры). */
  overallPressureRatio: number;
  /** Параметры цикла в крейсере — каждое — следствие конкретных инженерных решений (см. cycle.ts). */
  cycle: EngineCycleDef;
  nacelleLengthM: number;
  nacelleWidthM: number;
  /** Взлётная тяга одного двигателя (статика, МСА, уровень моря), кН. */
  takeoffThrustKn: number;
  /** Масштаб тяги относительно базового двигателя (режим перепроектирования, рычаг тяги). */
  thrustScale: number;
  /**
   * Установка двигателя: на пилоне впереди крыла (интерференция Q = 1,3) или вплотную под крылом (Q = 1,5) —
   * Raymer, табл. 12.6: гондола ближе одного диаметра — 1,3, прямо на крыле — 1,5.
   */
  installation: "pylon" | "close-coupled";
  /** Подъём гондолы относительно базовой установки (пилон, стойки), м. */
  nacelleRaiseM: number;
  thrustReverser: boolean;
  /** Схема двигателя для визуализации: число лопаток вентилятора и ступеней. Ступени ТНД — от двухконтурности. */
  architecture: { fanBlades: number; boosterStages: number; hpcStages: number; hptStages: number; spools?: 2 | 3 };
}

export interface EngineCycleDef {
  /** Температура газа перед турбиной в крейсере, К. */
  t4K: number;
  /** Доля воздуха ядра на охлаждение турбины. */
  coolingFrac: number;
  /** Политропные КПД: вентилятор, компрессоры (подпорный + ВД), турбины ВД и НД. */
  fanEff: number;
  compEff: number;
  hptEff: number;
  lptEff: number;
  /** Редуктор между вентилятором и ТНД. */
  gearbox: boolean;
}

export interface SystemsDef {
  crew: number;
  /** Пассажирские места. */
  seats: number;
  cabinCrew: number;
  /** Шаг кресел, м (A320 в один класс — 28–29 in, AC 2-4-1). */
  seatPitchM: number;
  seatsAbreast: number;
  cargoMassKg: number;
  fuelVolumeL: number;
  fuelTanks: number;
  flightControlFunctions: number;
  generatorsKva: number;
  generators: number;
  electricalRoutingM: number;
  avionicsUninstalledKg: number;
  apuUninstalledKg: number;
  /** Доля электрожгутов и распределения в массе ATA 24. Допущение, публичных данных нет. */
  harnessShareOfElectrical: number;
  /**
   * Бортовая кабельная сеть (EWIS) — сквозной узел: провода есть в каждой системе. Доли масс систем,
   * которые на самом деле приходятся на жгуты, переносятся в узел «электрожгуты». Допущение; итог сверяется
   * с оценкой ≈2 т проводки на узкофюзеляжный самолёт.
   */
  ewisShares: Record<string, number>;
}

export interface WeightsDef {
  mtowKg: number;
  mlwKg: number;
  mzfwKg: number;
  /** Предельная коммерческая нагрузка текущей весовой комплектации, не больше MZFW − OEW. */
  maxPayloadKg?: number;
  /** Неатрибутированное расхождение OEW с выбранной базовой комплектацией (отдельная видимая статья массы, кг). */
  oewReconciliationKg?: number;
  /** Дополнительное снаряжение эксплуатационной комплектации сверх заводской, кг. */
  additionalEquipmentKg?: number;
  /** Ультимативная перегрузка: 1,5 × 2,5. */
  ultimateLoadFactor: number;
  landingLoadFactor: number;
  /** Оборудование эксплуатанта (экипаж, кейтеринг, вода, невырабатываемое топливо). Допущение. */
  operatorItemsKg: number;
}

export interface AircraftDefinition {
  /** Выбранная плановая схема салона; синхронизируется с FlightCost (не сертифицированная LOPA). */
  cabinLayout?: import("./integration/flightcost.ts").CabinLayout;
  id: string;
  label: string;
  /** Название типа для надписи на борту («A320», «737-8»). */
  shortName?: string;
  /** Набор контуров для 3D-модели (вид сбоку, сверху, сечение); по умолчанию — A320. */
  shapeSet?: "a320" | "b737" | "b757" | "tu214";
  wing: WingDef;
  htail: TailDef;
  vtail: TailDef;
  fuselage: FuselageDef;
  gear: GearDef;
  engine: EngineDef;
  systems: SystemsDef;
  weights: WeightsDef;
}

/** Размах, который «видит» аэродинамика: с шарклетами — их размах. */
export function aeroSpanM(def: AircraftDefinition): number {
  return def.wing.tip === "sharklet" || def.wing.tip === "blended" ? def.wing.sharkletSpanM : def.wing.spanM;
}
