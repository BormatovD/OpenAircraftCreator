// Единый конвейер: определение + рычаги → массы → аэродинамика → двигатель → миссия → показатели.
// Любой новый рычаг проходит через этот же путь, поэтому его эффект сразу виден во всех выходах.

import { type AeroConfig } from "./aero.ts";
import { G0 } from "./atmosphere.ts";
import { type AircraftDefinition, aeroSpanM } from "./definition.ts";
import { type Lever, applyDefinition, collectAero, collectMission, collectTsfcFactor } from "./levers.ts";
import { type Calibration, type MassBreakdown, computeMasses } from "./mass/massTree.ts";
import { DEFAULT_ASSUMPTIONS, type MissionAssumptions, rangeForFuel } from "./mission.ts";
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
  missionFuelKg: number;
  /** Рейсовое топливо на миссию, без резервов. */
  tripFuelKg: number;
  seats: number;
  /** Места, которые помещаются в MZFW при заданной массе пассажира. */
  seatsCarried: number;
  payloadKg: number;
  /** Все места не помещаются в MZFW — нагрузка урезана, расход на место считается по помещающимся местам. */
  payloadLimitedByMzfw: boolean;
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
  };
}

/** Двигатель в миссии: крейсерский TSFC через модель КПД и взлётная тяга для ограничения эшелона. */
export function engineStateFor(def: AircraftDefinition, ctx: EvalContext, levers: Lever[], as: MissionAssumptions) {
  return {
    tsfcCruise: ctx.tsfcCruise * tsfcFactor(ctx.engineRef, def.engine) * collectTsfcFactor(levers) * tsfcMachFactor(def.engine.bypassRatio, as.cruiseMach),
    takeoffThrustN: takeoffThrustN(def),
  };
}

/** Допущения миссии с учётом рычагов (крейсерское число Маха). */
export function assumptionsFor(ctx: EvalContext, levers: Lever[]): MissionAssumptions {
  return { ...(ctx.assumptions ?? DEFAULT_ASSUMPTIONS), ...collectMission(levers) };
}

export interface CruiseDrag {
  cl: number;
  mach: number;
  /** Вклады в CD, в «каунтах» (×10⁴): агрегаты, прочее, индуктивное, волновое. */
  parts: { id: string; label: string; counts: number }[];
  total: number;
  ld: number;
  mdd: number;
}

/** Раскладка сопротивления в середине крейсера (FL350, масса — взлётная минус половина топлива рейса). */
export function cruiseDrag(def: AircraftDefinition, aero: AeroConfig, as: MissionAssumptions, massKg: number, base: BaselineAero): CruiseDrag {
  const atm = isa(flightLevelToM(350));
  const v = as.cruiseMach * atm.speedOfSoundMs;
  const cl = clForWeight(aero, massKg * G0, atm.densityKgM3, v);
  const b = dragBuildup(def);
  const k = base.cd0Factor ?? aero.cd0 / b.cd0;
  const scale = aero.cd0 / (b.cd0 * k || 1);
  const parts: CruiseDrag["parts"] = b.components.map((c) => ({ id: c.id as string, label: c.label, counts: c.cd0 * k * scale * 1e4 }));
  parts.push({ id: "misc", label: "Прочее", counts: b.misc * k * scale * 1e4 });
  const induced = inducedFactor(aero) * cl * cl;
  const wave = aero.wave ? waveDrag(aero.wave, cl, as.cruiseMach) : 0;
  parts.push({ id: "induced", label: "Индуктивное", counts: induced * 1e4 });
  parts.push({ id: "wave", label: "Волновое", counts: wave * 1e4 });
  const total = aero.cd0 + induced + wave;
  return { cl, mach: as.cruiseMach, parts, total: total * 1e4, ld: cl / total, mdd: aero.wave ? dragDivergenceMach(aero.wave, cl).mdd : 0 };
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
  const as = assumptionsFor(ctx, levers);
  const masses = computeMasses(def, ctx.calibration, levers);
  const aero = aeroFor(def, ctx.aero, levers);
  const engine = engineStateFor(def, ctx, levers, as);
  const oew = masses.oewKg;
  const w = def.weights;

  const fuelCapKg = def.systems.fuelVolumeL * ctx.fuelDensityKgL - as.taxiFuelKg;
  const fullTankFuel = Math.min(fuelCapKg, w.mtowKg - oew);
  const rangeFullTankNm = rangeForFuel(aero, engine, as, w.mtowKg, fullTankFuel).rangeNm;

  const seats = mission.seats ?? def.systems.seats;
  const payload = Math.min(seats * mission.massPerPaxKg, w.mzfwKg - oew);
  const fuelWithPayload = Math.min(fuelCapKg, w.mtowKg - oew - payload);
  const rangeWithMissionPayloadNm = rangeForFuel(aero, engine, as, oew + payload + fuelWithPayload, fuelWithPayload).rangeNm;
  const missionFuelKg = bisect(
    (fuel) => rangeForFuel(aero, engine, as, oew + payload + fuel, fuel).rangeNm,
    1000,
    fuelCapKg,
    mission.distanceNm,
  );
  // Расход на место — только рейсовое топливо, без резервов.
  const trip = rangeForFuel(aero, engine, as, oew + payload + missionFuelKg, missionFuelKg).tripFuelKg;
  const km = mission.distanceNm * 1.852;

  const payloadLimitedByMzfw = seats * mission.massPerPaxKg > w.mzfwKg - oew;
  const seatsCarried = Math.min(seats, Math.floor(payload / mission.massPerPaxKg));
  // Диаграмма нагрузка–дальность.
  const maxPayload = Math.max(0, w.mzfwKg - oew);
  const fuelA = Math.min(fuelCapKg, w.mtowKg - oew - maxPayload);
  const payloadB = Math.max(0, Math.min(maxPayload, w.mtowKg - oew - fuelCapKg));
  const fuelB = Math.min(fuelCapKg, w.mtowKg - oew - payloadB);
  const payloadRange = [
    { rangeNm: 0, payloadKg: maxPayload },
    { rangeNm: rangeForFuel(aero, engine, as, oew + maxPayload + fuelA, fuelA).rangeNm, payloadKg: maxPayload },
    { rangeNm: rangeForFuel(aero, engine, as, oew + payloadB + fuelB, fuelB).rangeNm, payloadKg: payloadB },
    { rangeNm: rangeForFuel(aero, engine, as, oew + fuelCapKg, fuelCapKg).rangeNm, payloadKg: 0 },
  ];
  const thrust = thrustCurve(def, aero, w.mtowKg * TOC_MASS_FRACTION, as.cruiseMach);
  const highLift = highLiftPerf(def, ctx.highLiftAnchor);
  const oei = oeiSecondSegment(def, aero, highLift.clMaxTakeoff);
  const k = 1 / (Math.PI * ((aero.spanM * aero.spanM) / aero.wingAreaM2) * aero.oswald);
  return {
    definition: def,
    masses,
    oewKg: oew,
    maxPayloadKg: w.mzfwKg - oew,
    aero,
    ldMaxApprox: 0.5 / Math.sqrt(aero.cd0 * k),
    tsfcCruise: engine.tsfcCruise,
    rangeFullTankNm,
    rangeWithMissionPayloadNm,
    missionFuelKg,
    tripFuelKg: trip,
    seats,
    payloadKg: payload,
    payloadLimitedByMzfw,
    constraints: checkConstraints(def, ctx.constraintsRef, { payloadLimitedByMzfw, ceilingFl: thrust.ceilingFl, oeiGradient: oei.gradient, highLift }),
    // Расход на место — по местам, которые реально помещаются в MZFW.
    seatsCarried,
    fuelPerSeatPer100KmKg: (trip / seatsCarried / km) * 100,
    payloadRange,
    cruiseDrag: cruiseDrag(def, aero, as, oew + payload + missionFuelKg / 2, ctx.aero),
    thrust,
    oei,
    highLift,
  };
}

/** TSFC в lb/(lbf·h) → кг/(Н·с). */
export function tsfcFromImperial(lbPerLbfH: number): number {
  return lbPerLbfH / (3600 * G0);
}
