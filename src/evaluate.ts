// Единый конвейер: определение + рычаги → массы → аэродинамика → двигатель → миссия → показатели.
// Любой новый рычаг проходит через этот же путь, поэтому его эффект сразу виден во всех выходах.

import { type AeroConfig, aeroAtFl } from "./aero.ts";
import { G0 } from "./atmosphere.ts";
import { type AircraftDefinition, aeroSpanM } from "./definition.ts";
import { isCesA320Reference } from "./aircraft/missionProfiles.ts";
import { type Lever, applyDefinition, collectAero, collectMission, collectTsfcFactor } from "./levers.ts";
import { type Calibration, type MassBreakdown, computeMasses } from "./mass/massTree.ts";
import { DEFAULT_ASSUMPTIONS, type MissionAssumptions, type MissionResult, rangeForFuel, solveMissionFuel } from "./mission.ts";
import { aspectRatioOf, dragBuildup, dragDivergenceMach, oswaldObert, waveDrag, waveParams } from "./drag.ts";
import { clForWeight, inducedFactor } from "./aero.ts";
import { flightLevelToM, isa } from "./atmosphere.ts";
import { type EngineDef } from "./definition.ts";
import { tsfcFactor, tsfcMachFactor } from "./propulsion.ts";
import { type ConstraintReference, type ConstraintResult, checkConstraints } from "./constraints.ts";
import { type HighLiftPerf, highLiftPerf } from "./highlift.ts";
import { type OeiClimb, type ThrustCurve, TOC_MASS_FRACTION, oeiSecondSegment, takeoffThrustN, thrustCurve } from "./thrust.ts";

export interface BaselineAero {
  cd0: number;
  oswald: number;
  /** Множитель к CD0 по составляющим (привязка к поляре); без него CD0 берётся как есть. */
  cd0Factor?: number;
  /** Множитель к коэффициенту Освальда по Оберту. */
  oswaldFactor?: number;
}

export interface EvalContext {
  calibration: Calibration;
  /** Откалиброванный TSFC опорного двигателя. */
  tsfcCruise: number;
  /** Двигатель, для которого откалиброван tsfcCruise; TSFC других двигателей — через модель КПД. */
  engineRef: EngineDef;
  constraintsRef: ConstraintReference;
  aero: BaselineAero;
  fuelDensityKgL: number;
  assumptions?: MissionAssumptions;
  /** Множитель привязки CLmax механизации (highlift.ts). */
  highLiftAnchor: number;
}

export interface MissionSpec {
  /** Если не задано — все места самолёта. */
  seats?: number;
  massPerPaxKg: number;
  distanceNm: number;
  /** Дополнительный коммерческий груз сверх пассажиров с багажом, кг. Сначала размещаем пассажиров. */
  cargoKg?: number;
}

export const DEFAULT_MISSION: MissionSpec = { massPerPaxKg: 95, distanceNm: 810 }; // все места, 1 500 км

export interface Evaluation {
  definition: AircraftDefinition;
  masses: MassBreakdown;
  oewKg: number;
  maxPayloadKg: number;
  aero: AeroConfig;
  ldMaxApprox: number;
  tsfcCruise: number;
  /** Угол «MTOW + полные баки»: облегчение здесь превращается в нагрузку, а не в дальность. */
  rangeFullTankNm: number;
  /** Дальность с нагрузкой миссии (180 пасс.), топлива — сколько позволяют баки и MTOW. */
  rangeWithMissionPayloadNm: number;
  /** Взлётное топливо для запрошенной миссии; при недостижимости — всё доступное в пределах MTOW и баков. */
  missionFuelKg: number;
  /** Рейсовое топливо на миссию, без резервов. */
  tripFuelKg: number;
  /** Условия текущей миссии и её пофазный результат — те же, что использованы для расчёта показателей. */
  missionAssumptions: MissionAssumptions;
  missionResult: MissionResult;
  seats: number;
  /** Места, которые помещаются в MZFW при заданной массе пассажира. */
  seatsCarried: number;
  payloadKg: number;
  /** Фактически размещённый дополнительный коммерческий груз, кг (без пассажиров с багажом). */
  cargoCarriedKg: number;
  /** Заявленная суммарная коммерческая нагрузка, кг. */
  payloadRequestedKg: number;
  /** Запрошенная нагрузка не помещается в MZFW / типовой предел. */
  payloadLimitedByMzfw: boolean;
  /** NaN, если миссия не выполнена либо число перевезённых пассажиров равно нулю. Успех — missionResult.feasible. */
  fuelPerSeatPer100KmKg: number;
  constraints: ConstraintResult[];
  /** Углы диаграммы нагрузка–дальность: макс. нагрузка, MTOW + полные баки, перегон. */
  payloadRange: { rangeNm: number; payloadKg: number }[];
  /** Раскладка сопротивления в середине крейсера. */
  cruiseDrag: CruiseDrag;
  /** Располагаемая и потребная тяга по эшелонам на верху набора при MTOW. */
  thrust: ThrustCurve;
  /** Второй сегмент взлёта с отказавшим двигателем. */
  oei: OeiClimb;
  /** Механизация: CLmax по конфигурациям, V2, скорость захода. */
  highLift: HighLiftPerf;
}

/** Аэродинамика с учётом рычагов. Общий множитель сопротивления действует через эквивалентные CD0 и e. */
export function aeroFor(def: AircraftDefinition, base: BaselineAero, levers: Lever[]): AeroConfig {
  const m = collectAero(levers);
  const built = base.cd0Factor !== undefined;
  const cd0 = built ? dragBuildup(def).cd0 * base.cd0Factor! : base.cd0;
  const oswald = base.oswaldFactor !== undefined ? oswaldObert(aspectRatioOf(def)) * base.oswaldFactor : base.oswald;
  return {
    wingAreaM2: def.wing.areaM2,
    spanM: aeroSpanM(def),
    cd0: (cd0 * m.cd0Factor + m.cd0Delta) * m.dragFactor,
    oswald: (oswald + m.oswaldDelta) / m.dragFactor,
    wave: built ? waveParams(def) : undefined,
    cd0Scale: built ? reynoldsScale(def) : undefined,
  };
}

/** Множители CD0 по эшелонам от изменения числа Рейнольдса (трение по составляющим, M 0,78). Кешируется по геометрии. */
const reCache = new Map<string, { fl: number[]; k: number[] }>();
function reynoldsScale(def: AircraftDefinition): { fl: number[]; k: number[] } {
  const key = JSON.stringify([def.wing, def.fuselage, def.htail, def.vtail, def.engine.nacelleLengthM, def.engine.nacelleWidthM]);
  let t = reCache.get(key);
  if (!t) {
    const ref = dragBuildup(def).cd0;
    const fl = [0, 100, 150, 200, 250, 290, 310, 330, 350, 370, 390, 410, 430];
    t = { fl, k: fl.map((x) => dragBuildup(def, 0.78, x).cd0 / ref) };
    reCache.set(key, t);
  }
  return t;
}

/** Двигатель в миссии: крейсерский TSFC через модель КПД и взлётная тяга для ограничения эшелона. */
export function engineStateFor(def: AircraftDefinition, ctx: EvalContext, levers: Lever[], as: MissionAssumptions) {
  return {
    tsfcCruise: ctx.tsfcCruise * tsfcFactor(ctx.engineRef, def.engine) * collectTsfcFactor(levers) * tsfcMachFactor(def.engine.bypassRatio, as.cruiseMach),
    takeoffThrustN: takeoffThrustN(def),
    referenceMach: as.cruiseMach,
    bypassRatio: def.engine.bypassRatio,
  };
}

/** Допущения миссии с учётом рычагов (крейсерское число Маха). */
export function assumptionsFor(ctx: EvalContext, levers: Lever[]): MissionAssumptions {
  return { ...(ctx.assumptions ?? DEFAULT_ASSUMPTIONS), ...collectMission(levers) };
}

export interface CruiseDrag {
  cl: number;
  mach: number;
  fl: number;
  /** Вклады в CD, в «каунтах» (×10⁴): агрегаты, прочее, индуктивное, волновое. */
  parts: { id: string; label: string; counts: number }[];
  total: number;
  ld: number;
  mdd: number;
}

/** Раскладка в выбранной точке. evaluate передаёт реальную массу / FL / Mach из интегрирования миссии. */
export function cruiseDrag(def: AircraftDefinition, aero: AeroConfig, as: MissionAssumptions, massKg: number, base: BaselineAero, fl = 350, mach = as.cruiseMach): CruiseDrag {
  const atm = isa(flightLevelToM(fl));
  const v = mach * atm.speedOfSoundMs;
  const aFl = aeroAtFl(aero, fl);
  const cl = clForWeight(aFl, massKg * G0, atm.densityKgM3, v);
  // Та же поправка Re, что в миссии: разбиение компонентов нормируется к её CD0 на данном эшелоне.
  const b = dragBuildup(def, 0.78, fl);
  const k = base.cd0Factor ?? aero.cd0 / b.cd0;
  const scale = aFl.cd0 / (b.cd0 * k || 1);
  const parts: CruiseDrag["parts"] = b.components.map((c) => ({ id: c.id as string, label: c.label, counts: c.cd0 * k * scale * 1e4 }));
  parts.push({ id: "misc", label: "Прочее", counts: b.misc * k * scale * 1e4 });
  const induced = inducedFactor(aero) * cl * cl;
  const wave = aero.wave ? waveDrag(aero.wave, cl, mach) : 0;
  parts.push({ id: "induced", label: "Индуктивное", counts: induced * 1e4 });
  parts.push({ id: "wave", label: "Волновое", counts: wave * 1e4 });
  const total = aFl.cd0 + induced + wave;
  return { cl, mach, fl, parts, total: total * 1e4, ld: cl / total, mdd: aero.wave ? dragDivergenceMach(aero.wave, cl).mdd : 0 };
}

export function bisect(f: (x: number) => number, lo: number, hi: number, target: number, iters = 34): number {
  for (let i = 0; i < iters; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function evaluate(
  baseDef: AircraftDefinition,
  levers: Lever[],
  ctx: EvalContext,
  mission: MissionSpec = DEFAULT_MISSION,
): Evaluation {
  return evaluateResolved(applyDefinition(baseDef, levers), levers, ctx, mission);
}

/**
 * То же, но определение уже содержит правки рычагов (их definition-эффекты повторно не применяются).
 * Нужен режиму перепроектирования, который сам меняет геометрию.
 */
export function evaluateResolved(
  def: AircraftDefinition,
  levers: Lever[],
  ctx: EvalContext,
  mission: MissionSpec = DEFAULT_MISSION,
): Evaluation {
  const rawAssumptions = assumptionsFor(ctx, levers);
  // После конструкторских изменений FCOM-таблица исходного A320 больше не применима.
  // Проверки заводских графиков идут через отдельный A320_CONTEXT без этой таблицы.
  const as = (rawAssumptions.fcomClimb || rawAssumptions.fcomDescent || rawAssumptions.fcomHolding) &&
    (!isCesA320Reference(def) || levers.length > 0)
    ? { ...rawAssumptions, fcomClimb: undefined, fcomDescent: undefined, fcomHolding: undefined }
    : rawAssumptions;
  const masses = computeMasses(def, ctx.calibration, levers);
  const aero = aeroFor(def, ctx.aero, levers);
  const engine = engineStateFor(def, ctx, levers, as);
  const oew = masses.oewKg;
  const w = def.weights;

  if (!Number.isFinite(mission.distanceNm) || mission.distanceNm <= 0 ||
    !Number.isFinite(mission.massPerPaxKg) || mission.massPerPaxKg <= 0 ||
    !Number.isInteger(mission.seats ?? def.systems.seats) || (mission.seats ?? def.systems.seats) < 0 ||
    !Number.isFinite(mission.cargoKg ?? 0) || (mission.cargoKg ?? 0) < 0) {
    throw new RangeError("Дальность и масса пассажира должны быть положительными, число мест — целым неотрицательным");
  }
  const fuelCapKg = Math.max(0, def.systems.fuelVolumeL * ctx.fuelDensityKgL - as.taxiFuelKg);
  const fullTankFuel = Math.max(0, Math.min(fuelCapKg, w.mtowKg - oew));
  const rangeFullTankNm = rangeForFuel(aero, engine, as, w.mtowKg, fullTankFuel).rangeNm;

  const seats = mission.seats ?? def.systems.seats;
  const maxPayload = Math.max(0, Math.min(w.mzfwKg - oew, w.maxPayloadKg ?? Infinity));
  const paxPayloadKg = Math.min(seats * mission.massPerPaxKg, maxPayload);
  const cargoCarriedKg = Math.min(mission.cargoKg ?? 0, Math.max(0, maxPayload - paxPayloadKg));
  const payload = paxPayloadKg + cargoCarriedKg;
  const payloadRequestedKg = seats * mission.massPerPaxKg + (mission.cargoKg ?? 0);
  const fuelWithPayload = Math.max(0, Math.min(fuelCapKg, w.mtowKg - oew - payload));
  const rangeWithMissionPayloadNm = rangeForFuel(aero, engine, as, oew + payload + fuelWithPayload, fuelWithPayload).rangeNm;
  const solved = solveMissionFuel(aero, engine, as, oew + payload, fuelWithPayload, mission.distanceNm);
  const missionFuelKg = solved.takeoffFuelKg;
  // Расход на место доступен только для выполненной миссии, а не для обрезанного рейса.
  const missionResult = solved.result;
  const trip = missionResult.tripFuelKg;
  const cruiseSample = missionResult.trip.cruiseSample;
  const km = mission.distanceNm * 1.852;

  const payloadLimitedByMzfw = payloadRequestedKg > maxPayload + 1e-6;
  const seatsCarried = Math.min(seats, Math.floor((paxPayloadKg + 1e-6) / mission.massPerPaxKg));
  // Диаграмма нагрузка–дальность.
  const fuelA = Math.min(fuelCapKg, w.mtowKg - oew - maxPayload);
  const payloadB = Math.max(0, Math.min(maxPayload, w.mtowKg - oew - fuelCapKg));
  const fuelB = Math.max(0, Math.min(fuelCapKg, w.mtowKg - oew - payloadB));
  const payloadRange = [
    { rangeNm: 0, payloadKg: maxPayload },
    { rangeNm: rangeForFuel(aero, engine, as, oew + maxPayload + fuelA, fuelA).rangeNm, payloadKg: maxPayload },
    { rangeNm: rangeForFuel(aero, engine, as, oew + payloadB + fuelB, fuelB).rangeNm, payloadKg: payloadB },
    { rangeNm: rangeForFuel(aero, engine, as, oew + fullTankFuel, fullTankFuel).rangeNm, payloadKg: 0 },
  ];
  const thrust = thrustCurve(def, aero, w.mtowKg * TOC_MASS_FRACTION, as.cruiseMach);
  const highLift = highLiftPerf(def, ctx.highLiftAnchor);
  const oei = oeiSecondSegment(def, aero, highLift.clMaxTakeoff);
  const k = 1 / (Math.PI * ((aero.spanM * aero.spanM) / aero.wingAreaM2) * aero.oswald);
  const constraints = checkConstraints(def, ctx.constraintsRef, { payloadLimitedByMzfw, ceilingFl: thrust.ceilingFl, oeiGradient: oei.gradient, highLift });
  if (!missionResult.feasible) constraints.push({
    id: "mission-distance",
    label: "Достижение заданной дальности с резервами",
    status: "violation",
    value: `${missionResult.rangeNm.toFixed(1)} / ${mission.distanceNm.toFixed(1)} nm`,
    limit: `≥ ${mission.distanceNm.toFixed(1)} nm`,
    message: `Рейс недостижим: нехватка ${missionResult.distanceShortfallNm?.toFixed(1)} nm либо недостаточны резервы. ` +
      `Доступное взлётное топливо ${fuelWithPayload.toFixed(0)} кг (MTOW и баки); расход на место не рассчитывается.`,
  });
  if (seatsCarried === 0) constraints.push({
    id: "mission-no-passengers",
    label: "Пассажиры для расчёта расхода на место",
    status: "warning",
    value: "0 мест",
    limit: "≥ 1 перевезённое место",
    message: "Нет пассажиров: расход на пассажира математически не определён.",
  });
  return {
    definition: def,
    masses,
    oewKg: oew,
    maxPayloadKg: maxPayload,
    aero,
    ldMaxApprox: 0.5 / Math.sqrt(aero.cd0 * k),
    tsfcCruise: engine.tsfcCruise,
    rangeFullTankNm,
    rangeWithMissionPayloadNm,
    missionFuelKg,
    tripFuelKg: trip,
    missionAssumptions: as,
    missionResult,
    seats,
    payloadKg: payload,
    cargoCarriedKg,
    payloadRequestedKg,
    payloadLimitedByMzfw,
    constraints,
    // Расход на место — по местам, которые реально помещаются в MZFW.
    seatsCarried,
    fuelPerSeatPer100KmKg: missionResult.feasible && seatsCarried > 0 ? (trip / seatsCarried / km) * 100 : Number.NaN,
    payloadRange,
    cruiseDrag: cruiseDrag(def, aero, as, cruiseSample?.massKg ?? oew + payload + missionFuelKg / 2,
      ctx.aero, cruiseSample?.fl ?? as.cruiseFL, cruiseSample?.mach ?? as.cruiseMach),
    thrust,
    oei,
    highLift,
  };
}

/** TSFC в lb/(lbf·h) → кг/(Н·с). */
export function tsfcFromImperial(lbPerLbfH: number): number {
  return lbPerLbfH / (3600 * G0);
}
