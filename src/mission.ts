// Сегментная миссия: взлёт → набор (энергетический метод) → крейсер (Бреге, пошагово) → снижение,
// плюс резервы: 5% на непредвиденное, запасной аэродром, 30 минут финального резерва.
// Все допущения собраны в MissionAssumptions и подписаны: они не калибруются, калибруется только TSFC.

import { type AeroConfig, aeroAtFl, clForWeight, liftToDrag, maxLiftToDrag } from "./aero.ts";
import { G0, NM, flightLevelToM, isa } from "./atmosphere.ts";
import { requiredThrustN } from "./thrust.ts";
import { type LrcTable, interpolateLrcMach } from "./cruise.ts";
import { tsfcMachFactor } from "./propulsion.ts";
import { type PhaseTableDataset, lookupClimb, lookupDescent, lookupHolding } from "./phaseTables.ts";

export const LHV_JET_A = 43.2e6; // Дж/кг, теплотворная способность керосина

export interface EngineState {
  /** Крейсерский удельный расход, кг/(Н·с). Калибруемая величина. */
  tsfcCruise: number;
  /** Суммарная взлётная тяга, Н. Если задана, эшелон ограничен ещё и тягой (300 фут/мин остаточной скороподъёмности). */
  takeoffThrustN?: number;
  /** Точка, в которой задан tsfcCruise. Нужна при переменной скорости; без неё TSFC постоянен. */
  referenceMach?: number;
  bypassRatio?: number;
}

export type CruiseAltitudeMode = "fixed" | "stepClimb";

export interface MissionAssumptions {
  cruiseMach: number;
  /** В LRC скорость интерполируется по массе и высоте; cruiseMach остаётся явно помеченным резервным допущением вне таблицы. */
  cruiseSpeedMode?: "fixedMach" | "lrc";
  /** Только опорный A320ceo / CFM56-5B4/P / fence, ISA0, 250/300 kt / M0.78.
   * В остальных случаях эта позиция не назначается. Нет экстраполяции за границы FCOM. */
  fcomClimb?: PhaseTableDataset;
  fcomClimbIsaDeviationC?: number;
  /** Descent table is only for the original A320-214, ISA0, NORMAL A/C and anti-ice OFF. */
  fcomDescent?: PhaseTableDataset;
  /** FCOM fuel after pure descent (FL15 to landing), not a second descent allocation. */
  fcomApproachFuelKg?: number;
  /** FCOM time of the IFR approach. */
  fcomApproachDurationMin?: number;
  /** Explicit engineering assumption: approach ground speed, NOT printed in the FCOM table. */
  fcomApproachGroundspeedKt?: number;
  /** CES holding at Green Dot, racetrack, sea-level alternate (FL15). */
  fcomHolding?: PhaseTableDataset;
  fcomHoldingFL?: number;
  /** Таблица скорости базового типа. Расход FF из неё в миссию не подставляется. */
  lrcTable?: LrcTable;
  /** Эшелон для режима "fixed". */
  cruiseFL: number;
  /** "fixed" — весь крейсер на cruiseFL; "stepClimb" — ступенчатый набор по мере выработки топлива. */
  cruiseAltitudeMode: CruiseAltitudeMode;
  /** Доступные крейсерские эшелоны для ступенчатого набора. */
  stepFLs: number[];
  /** Предельный крейсерский CL: самолёт занимает самый высокий эшелон, где CL не выше этого значения. */
  cruiseClMax: number;
  alternateFL: number;
  alternateDistanceNm: number;
  contingencyFraction: number;
  finalReserveMin: number;
  /** "hold" — финальный резерв как ожидание на максимальном качестве (ICAO/EASA); "cruise" — 45 мин на крейсерском режиме (ATA domestic, FAR 121.639). */
  finalReserveMode?: "hold" | "cruise";
  /** Отношение TSFC в зоне ожидания к крейсерскому (низкая скорость и высота). */
  holdTsfcRatio: number;
  /** Отношение КПД силовой установки на наборе к крейсерскому. */
  climbEfficiencyRatio: number;
  /** Отношение L/D на наборе к крейсерскому. */
  climbLdRatio: number;
  takeoffFuelKg: number;
  climbDistanceKm: number;
  descentFuelKg: number;
  descentDistanceKm: number;
  taxiFuelKg: number;
  cruiseSteps: number;
}

// Источники допущений: расход на взлёте — Poll & Schumann (2,15 кг/с × 0,7 мин ≈ 90 кг);
// остальное — типовые значения для узкофюзеляжника, помечены в документе как допущения.
export const DEFAULT_ASSUMPTIONS: MissionAssumptions = {
  cruiseMach: 0.78,
  cruiseSpeedMode: "fixedMach",
  cruiseFL: 350,
  cruiseAltitudeMode: "stepClimb",
  // A320: потолок FL398; ступени по 2 000 ft.
  stepFLs: [290, 310, 330, 350, 370, 390],
  // Poll & Schumann: расчётный оптимальный CL A320 = 0,59. Наша поляра не учитывает волновое
  // сопротивление, поэтому без этого ограничения оптимизатор ушёл бы к CL ≈ 0,7 — нереально высоко.
  cruiseClMax: 0.59,
  alternateFL: 250,
  alternateDistanceNm: 200,
  contingencyFraction: 0.05,
  finalReserveMin: 30,
  holdTsfcRatio: 0.8,
  climbEfficiencyRatio: 0.9,
  climbLdRatio: 0.9,
  takeoffFuelKg: 90,
  climbDistanceKm: 190,
  descentFuelKg: 300,
  descentDistanceKm: 180,
  taxiFuelKg: 200,
  cruiseSteps: 200,
};

export interface TripResult {
  distanceM: number;
  takeoffFuelKg: number;
  climbFuelKg: number;
  /** Источник набора: таблица FCOM либо прежняя физическая оценка. */
  climbSource?: "fcom" | "energy" | "energy-short-route" | "energy-uncovered";
  /** Накопленная дистанция набора, в отличие от общего результата миссии. */
  climbDistanceNm?: number;
  /** Накопленное время набора, если подтверждено таблицей. */
  climbTimeMin?: number;
  /** Время горизонтальных шагов по фактической скорости каждого шага. */
  cruiseTimeMin: number;
  descentDistanceNm: number;
  /** Только горизонтальный крейсер; топливо ступеней показано отдельно. */
  cruiseFuelKg: number;
  stepClimbFuelKg: number;
  descentFuelKg: number;
  /** Pure FCOM descent to 1,500 ft and the terminal IFR phase are separated when applicable. */
  pureDescentFuelKg?: number;
  approachFuelKg?: number;
  descentSource?: "fcom" | "energy" | "energy-uncovered" | "energy-short-route" | "energy-unstable";
  pureDescentDistanceNm?: number;
  pureDescentTimeMin?: number;
  approachDistanceNm?: number;
  /** The source does not define whether WEIGHT is descent start or end mass. */
  descentMassBasis?: "estimated-mass-at-1500ft";
  landingMassKg: number;
  initialFL: number;
  finalFL: number;
  initialMach: number;
  finalMach: number;
  minMach: number;
  maxMach: number;
  /** Хотя бы одна расчётная точка вне таблицы LRC: использовано явное допущение cruiseMach. */
  lrcFallback: boolean;
  /** Нет доступного эшелона из заданного списка по CL / тяге. Нижний используется только как оценка. */
  flightLevelLimited: boolean;
  /** Реальная точка интегрирования около середины крейсерского топлива, для панели аэродинамики. */
  cruiseSample?: { massKg: number; fl: number; mach: number };
}

// Кешируем только атмосферу по эшелону. Кеш (FL, Mach) при непрерывном LRC рос бы без ограничения.
const atmosphereCache = new Map<number, ReturnType<typeof isa>>();
function atmosphereAt(fl: number): ReturnType<typeof isa> {
  let atm = atmosphereCache.get(fl);
  if (!atm) {
    atm = isa(flightLevelToM(fl));
    atmosphereCache.set(fl, atm);
  }
  return atm;
}
function cruiseSpeed(fl: number, mach: number): { speedMs: number; densityKgM3: number } {
  const atm = atmosphereAt(fl);
  return { speedMs: mach * atm.speedOfSoundMs, densityKgM3: atm.densityKgM3 };
}

function lapseAt(fl: number, mach: number): number {
  // Та же формула thrustLapse; атмосферное давление уже в кеше, Мах может быть любым.
  return (atmosphereAt(fl).pressurePa / 101325) * (1 + 0.2 * mach * mach) ** 3.5 * (1 - 0.49 * Math.sqrt(mach));
}

export function cruiseMachAt(as: MissionAssumptions, massKg: number, fl: number): { mach: number; fallback: boolean } {
  if (as.cruiseSpeedMode !== "lrc") return { mach: as.cruiseMach, fallback: false };
  const mach = as.lrcTable ? interpolateLrcMach(as.lrcTable, massKg, fl) : undefined;
  return mach === undefined ? { mach: as.cruiseMach, fallback: true } : { mach, fallback: false };
}

/** Поправка на текущий Мах — согласованно с точкой, в которой передан TSFC (Howe пока выключена). */
export function tsfcAtMach(engine: EngineState, mach: number): number {
  if (engine.referenceMach === undefined || engine.bypassRatio === undefined) return engine.tsfcCruise;
  return engine.tsfcCruise * tsfcMachFactor(engine.bypassRatio, mach) / tsfcMachFactor(engine.bypassRatio, engine.referenceMach);
}

function flightLevelAllowed(aero: AeroConfig, as: MissionAssumptions, massKg: number, fl: number, mach: number, engine?: EngineState): boolean {
  const { speedMs, densityKgM3 } = cruiseSpeed(fl, mach);
  return clForWeight(aero, massKg * G0, densityKgM3, speedMs) <= as.cruiseClMax &&
    (engine?.takeoffThrustN === undefined || engine.takeoffThrustN * lapseAt(fl, mach) >= requiredThrustN(aero, massKg, fl, mach));
}

/** Выбор эшелона проверяет также нижнюю ступень и не заполняет отсутствующие ячейки LRC. */
export function selectFlightLevel(aero: AeroConfig, as: MissionAssumptions, massKg: number, engine?: EngineState): { fl: number; limited: boolean } {
  if (!as.stepFLs.length) throw new RangeError("Для ступенчатого набора нужен хотя бы один эшелон");
  let lowest = as.stepFLs[0];
  let best: number | undefined;
  for (const fl of as.stepFLs) {
    if (fl < lowest) lowest = fl;
    if (best !== undefined && fl <= best) continue;
    const speed = cruiseMachAt(as, massKg, fl);
    if (speed.fallback || !flightLevelAllowed(aero, as, massKg, fl, speed.mach, engine)) continue;
    best = fl;
  }
  if (best !== undefined) return { fl: best, limited: false };
  // Вне таблицы даём оценку на нижнем эшелоне, но не объявляем её подтверждённым LRC / допустимым профилем.
  const speed = cruiseMachAt(as, massKg, lowest);
  return { fl: lowest, limited: !flightLevelAllowed(aero, as, massKg, lowest, speed.mach, engine) };
}

/** Совместимый краткий API; диагностика доступности — selectFlightLevel / TripResult. */
export function bestFlightLevel(aero: AeroConfig, as: MissionAssumptions, massKg: number, engine?: EngineState): number {
  return selectFlightLevel(aero, as, massKg, engine).fl;
}

/**
 * Полёт с заданным расходом топлива на рейс; возвращает пройденную дистанцию.
 * Если cruiseFL передан явно (запасной аэродром), ступенчатый набор не используется.
 */
export function simulateTrip(
  aero: AeroConfig,
  engine: EngineState,
  as: MissionAssumptions,
  takeoffMassKg: number,
  tripFuelKg: number,
  cruiseFL?: number,
): TripResult {
  if (!Number.isFinite(takeoffMassKg) || takeoffMassKg <= 0 || !Number.isFinite(tripFuelKg) || tripFuelKg < 0 || tripFuelKg >= takeoffMassKg)
    throw new RangeError("Масса должна быть положительной, топливо — неотрицательным и меньше массы самолёта");
  const stepping = cruiseFL === undefined && as.cruiseAltitudeMode === "stepClimb";
  let m = takeoffMassKg - as.takeoffFuelKg;
  const selected = stepping ? selectFlightLevel(aero, as, m, engine) : { fl: cruiseFL ?? as.cruiseFL, limited: false };
  let fl = selected.fl;
  let speed = cruiseMachAt(as, m, fl);
  let mach = speed.mach;
  let lrcFallback = speed.fallback;
  let flightLevelLimited = selected.limited || !flightLevelAllowed(aero, as, m, fl, mach, engine);
  const { speedMs, densityKgM3 } = cruiseSpeed(fl, mach);
  const h = flightLevelToM(fl);

  // Набор высоты: энергия = потенциальная + кинетическая + работа против сопротивления на дистанции набора.
  // Поляра на текущем эшелоне — с поправкой трения на число Рейнольдса.
  const aFl = aeroAtFl(aero, fl);
  const clClimb = clForWeight(aFl, m * G0, densityKgM3, speedMs);
  const ldClimb = liftToDrag(aFl, clClimb, mach) * as.climbLdRatio;
  const etaCruise = speedMs / (tsfcAtMach(engine, mach) * LHV_JET_A);
  const etaClimb = etaCruise * as.climbEfficiencyRatio;
  const climbDist = as.climbDistanceKm * 1000;
  const climbEnergy = m * (G0 * h + 0.5 * speedMs * speedMs + (G0 * climbDist) / ldClimb);
  const climbFuel = climbEnergy / (etaClimb * LHV_JET_A);

  const fcomEligible = cruiseFL === undefined && as.fcomClimb !== undefined &&
    as.cruiseSpeedMode !== "lrc" && Math.abs(as.cruiseMach - 0.78) < 1e-9 &&
    (as.fcomClimbIsaDeviationC ?? 0) === 0;
  const fullClimb = fcomEligible
    ? lookupClimb(as.fcomClimb!, takeoffMassKg, fl, 0) : undefined;
  const initialClimb = fullClimb
    ? lookupClimb(as.fcomClimb!, takeoffMassKg, 15, 0) : undefined;
  const tableValid = fullClimb && initialClimb &&
    fullClimb.fuelKg >= initialClimb.fuelKg &&
    fullClimb.distanceNm >= initialClimb.distanceNm &&
    fullClimb.timeMin >= initialClimb.timeMin;
  const initialFuel = tableValid ? initialClimb.fuelKg : as.takeoffFuelKg;
  const climbBurn = tableValid ? fullClimb.fuelKg - initialClimb.fuelKg : climbFuel;
  const climbDistance = tableValid ? fullClimb.distanceNm * NM : climbDist;
  const climbSource: TripResult["climbSource"] = tableValid ? "fcom"
    : fcomEligible ? "energy-uncovered" : "energy";
  const initialFL = fl;
  const initialMassAfterClimbKg = takeoffMassKg - initialFuel - climbBurn;
  // A320 CES 3.05.30: pure descent ends at FL15. The table's WEIGHT timing is
  // not defined; use estimated mass at FL15 as an explicit *model assumption*.
  // FCOM terminal IFR fuel/time are separate. Approach groundspeed is NOT sourced
  // from the FCOM and must remain an explicit engineering estimate.
  const descentEligible = cruiseFL === undefined && as.fcomDescent !== undefined &&
    as.cruiseSpeedMode !== "lrc" && Math.abs(as.cruiseMach - 0.78) < 1e-9 &&
    (as.fcomClimbIsaDeviationC ?? 0) === 0;
  type DescentAllocation = {
    fuelKg: number; distanceM: number;
    source: NonNullable<TripResult["descentSource"]>;
    pureFuelKg?: number; approachFuelKg?: number;
    pureDistanceNm?: number; pureTimeMin?: number; approachDistanceNm?: number;
    massBasis?: TripResult["descentMassBasis"];
  };
  const descentAtFl = (fromFl: number): DescentAllocation => {
    const fallback = (): DescentAllocation => ({
      fuelKg: as.descentFuelKg, distanceM: as.descentDistanceKm * 1000,
      source: descentEligible ? "energy-uncovered" : "energy",
    });
    if (!descentEligible) return fallback();
    const approachFuel = as.fcomApproachFuelKg;
    const approachMinutes = as.fcomApproachDurationMin;
    const groundspeedKt = as.fcomApproachGroundspeedKt;
    if (approachFuel === undefined || approachFuel < 0 ||
      approachMinutes === undefined || approachMinutes < 0 ||
      groundspeedKt === undefined || groundspeedKt < 0) return fallback();
    const massAt1500Ft = takeoffMassKg - tripFuelKg + approachFuel;
    const row = lookupDescent(as.fcomDescent!, massAt1500Ft, fromFl);
    if (!row) return fallback();
    const approachDistanceNm = groundspeedKt * approachMinutes / 60;
    return {
      fuelKg: row.fuelKg + approachFuel,
      distanceM: (row.distanceNm + approachDistanceNm) * NM,
      source: "fcom", pureFuelKg: row.fuelKg, approachFuelKg: approachFuel,
      pureDistanceNm: row.distanceNm, pureTimeMin: row.timeMin, approachDistanceNm,
      massBasis: "estimated-mass-at-1500ft",
    };
  };

  // The final cruise FL can rise after step-climb; descent starts at the FINAL FL,
  // not necessarily the initial FL. Re-evaluate the cruise if the descent row
  // changes. Only the descent allocation changes; engine TSFC is not retuned.
  function integrateCruise(allocation: DescentAllocation) {
    const fixedFuel = initialFuel + climbBurn + allocation.fuelKg;
    if (tripFuelKg <= fixedFuel) return undefined;
    let massKg = initialMassAfterClimbKg;
    let activeFL = initialFL;
    let aFlCruise = aeroAtFl(aero, activeFL);
    let travelledM = climbDistance;
    let cruiseSeconds = 0;
    const availableCruiseFuel = tripFuelKg - fixedFuel;
    let remaining = availableCruiseFuel;
    const dm = availableCruiseFuel / as.cruiseSteps;
    let stepClimbFuelKg = 0;
    let initialCruiseMach = mach;
    let minMach = Infinity;
    let maxMach = -Infinity;
    let cruiseSample: TripResult["cruiseSample"];
    let sampleDelta = Infinity;
    const sampleMass = massKg - availableCruiseFuel / 2;
    let localFallback = lrcFallback;
    let localFlLimited = flightLevelLimited;
    let activeMach = mach;
    while (remaining > 1e-6) {
      const current = cruiseMachAt(as, massKg, activeFL);
      activeMach = current.mach;
      localFallback ||= current.fallback;
      let currentSpeed = cruiseSpeed(activeFL, activeMach).speedMs;
      if (stepping) {
        const target = selectFlightLevel(aero, as, massKg, engine);
        localFlLimited ||= target.limited;
        if (target.fl > activeFL) {
          const targetMach = cruiseMachAt(as, massKg, target.fl).mach;
          const targetSpeed = cruiseSpeed(target.fl, targetMach).speedMs;
          const dh = flightLevelToM(target.fl) - flightLevelToM(activeFL);
          const kinetic = Math.max(0, (targetSpeed * targetSpeed - currentSpeed * currentSpeed) / 2);
          const etaStep = currentSpeed / (tsfcAtMach(engine, activeMach) * LHV_JET_A) * as.climbEfficiencyRatio;
          const stepFuel = massKg * (G0 * dh + kinetic) / (etaStep * LHV_JET_A);
          if (stepFuel < remaining) {
            massKg -= stepFuel;
            remaining -= stepFuel;
            stepClimbFuelKg += stepFuel;
            activeFL = target.fl;
            aFlCruise = aeroAtFl(aero, activeFL);
          }
        }
      }
      const step = Math.min(dm, remaining);
      const mMid = massKg - step / 2;
      const selectedMach = cruiseMachAt(as, mMid, activeFL);
      activeMach = selectedMach.mach;
      localFallback ||= selectedMach.fallback;
      const { speedMs: stepSpeedMs, densityKgM3: stepRho } = cruiseSpeed(activeFL, activeMach);
      if (minMach === Infinity) initialCruiseMach = activeMach;
      minMach = Math.min(minMach, activeMach);
      maxMach = Math.max(maxMach, activeMach);
      if (Math.abs(mMid - sampleMass) < sampleDelta) {
        sampleDelta = Math.abs(mMid - sampleMass);
        cruiseSample = { massKg: mMid, fl: activeFL, mach: activeMach };
      }
      const cl = clForWeight(aFlCruise, mMid * G0, stepRho, stepSpeedMs);
      const ld = liftToDrag(aFlCruise, cl, activeMach);
      const stepDistanceM = (stepSpeedMs * ld) / (G0 * tsfcAtMach(engine, activeMach)) * Math.log(massKg / (massKg - step));
      travelledM += stepDistanceM;
      cruiseSeconds += stepDistanceM / stepSpeedMs;
      massKg -= step;
      remaining -= step;
    }
    return {
      distanceM: travelledM + allocation.distanceM,
      cruiseTimeMin: cruiseSeconds / 60,
      descentDistanceNm: allocation.distanceM / NM,
      landingMassKg: massKg - allocation.fuelKg,
      finalFL: activeFL,
      initialMach: initialCruiseMach,
      finalMach: activeMach,
      minMach: Number.isFinite(minMach) ? minMach : activeMach,
      maxMach: Number.isFinite(maxMach) ? maxMach : activeMach,
      lrcFallback: localFallback,
      flightLevelLimited: localFlLimited,
      cruiseSample,
      cruiseFuelKg: availableCruiseFuel - stepClimbFuelKg,
      stepClimbFuelKg,
    };
  }

  let allocation = descentAtFl(initialFL);
  if (tripFuelKg <= initialFuel + climbBurn + allocation.fuelKg) {
    // A complete table is not a partial-climb/partial-descent model.
    if (tableValid || allocation.source === "fcom") {
      const fallback = simulateTrip(aero, engine,
        { ...as, fcomClimb: undefined, fcomDescent: undefined },
        takeoffMassKg, tripFuelKg, cruiseFL);
      return { ...fallback,
        climbSource: tableValid ? "energy-short-route" : fallback.climbSource,
        descentSource: "energy-short-route",
      };
    }
    const share = Math.max(0, tripFuelKg / (initialFuel + climbBurn + allocation.fuelKg));
    return {
      distanceM: share * (climbDistance + allocation.distanceM),
      takeoffFuelKg: initialFuel * share,
      climbFuelKg: climbBurn * share,
      climbSource,
      climbDistanceNm: share * climbDistance / NM,
      climbTimeMin: undefined,
      cruiseTimeMin: 0,
      descentDistanceNm: share * allocation.distanceM / NM,
      cruiseFuelKg: 0,
      stepClimbFuelKg: 0,
      descentFuelKg: allocation.fuelKg * share,
      descentSource: allocation.source,
      landingMassKg: takeoffMassKg - tripFuelKg,
      initialFL,
      finalFL: initialFL,
      initialMach: mach,
      finalMach: mach,
      minMach: mach,
      maxMach: mach,
      lrcFallback,
      flightLevelLimited,
    };
  }
  let integrated: ReturnType<typeof integrateCruise>;
  let settled = false;
  const maxTries = Math.max(3, as.stepFLs.length + 2);
  for (let i = 0; i < maxTries; i++) {
    integrated = integrateCruise(allocation);
    if (!integrated) break;
    const next = descentAtFl(integrated.finalFL);
    if (next.source === allocation.source &&
        Math.abs(next.fuelKg - allocation.fuelKg) < 1e-8 &&
        Math.abs(next.distanceM - allocation.distanceM) < 1e-5) {
      settled = true;
      break;
    }
    allocation = next;
  }
  if (!settled) {
    // A descent table is meaningful only for a completed descent and a stable
    // top-of-descent FL. Revert to energy if the short route or iterative choice
    // cannot satisfy that requirement. Never extrapolate an unavailable cell.
    const fallback = simulateTrip(aero, engine,
      { ...as, fcomClimb: undefined, fcomDescent: undefined }, takeoffMassKg, tripFuelKg, cruiseFL);
    return { ...fallback,
      climbSource: tableValid ? "energy-short-route" : fallback.climbSource,
      descentSource: tripFuelKg <= initialFuel + climbBurn + allocation.fuelKg
        ? "energy-short-route" : "energy-unstable",
    };
  }
  if (!integrated) throw new Error("Unexpected missing cruise integration");
  return {
    ...integrated,
    takeoffFuelKg: initialFuel,
    climbFuelKg: climbBurn,
    climbSource,
    climbDistanceNm: climbDistance / NM,
    climbTimeMin: tableValid ? fullClimb.timeMin : undefined,
    descentFuelKg: allocation.fuelKg,
    pureDescentFuelKg: allocation.pureFuelKg,
    approachFuelKg: allocation.approachFuelKg,
    descentSource: allocation.source,
    pureDescentDistanceNm: allocation.pureDistanceNm,
    pureDescentTimeMin: allocation.pureTimeMin,
    approachDistanceNm: allocation.approachDistanceNm,
    descentMassBasis: allocation.massBasis,
    initialFL,
  };
}

/** Топливо, нужное на заданную дистанцию (бисекция по simulateTrip). */
export function fuelForDistance(
  aero: AeroConfig,
  engine: EngineState,
  as: MissionAssumptions,
  takeoffMassKg: number,
  distanceM: number,
  cruiseFL: number,
): number {
  let lo = 0;
  let hi = takeoffMassKg * 0.5;
  // 34 шага бисекции — точность ~1 г топлива; больше не нужно и заметно замедляет перепроектирование.
  for (let i = 0; i < 34; i++) {
    const mid = (lo + hi) / 2;
    const d = simulateTrip(aero, engine, as, takeoffMassKg, mid, cruiseFL).distanceM;
    if (d < distanceM) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export interface Reserves {
  /** FCOM holding or low-speed physical fallback; cruise reserve uses its own integration. */
  finalReserveSource?: "fcom" | "physical" | "physical-uncovered" | "cruise";
  holdingFuelFlowKgH?: number;
  holdingReferenceMassKg?: number;
  contingencyKg: number;
  alternateKg: number;
  finalKg: number;
  totalKg: number;
  lrcFallback: boolean;
  flightLevelLimited: boolean;
}

export function reserves(
  aero: AeroConfig,
  engine: EngineState,
  as: MissionAssumptions,
  tripFuelKg: number,
  landingMassKg: number,
): Reserves {
  const contingencyKg = as.contingencyFraction * tripFuelKg;
  const alternateKg = fuelForDistance(
    aero,
    engine,
    as,
    landingMassKg,
    as.alternateDistanceNm * NM,
    as.alternateFL,
  );
  const alternate = simulateTrip(aero, engine, as, landingMassKg, alternateKg, as.alternateFL);
  // Финальный резерв: ожидание на максимальном L/D.
  const massAfterAlt = landingMassKg - alternateKg;
  const t = as.finalReserveMin * 60;
  if (as.finalReserveMode === "cruise") {
    // Продолжение крейсера на заданном cruiseFL. Масса, CL и скорость LRC меняются с выработкой топлива;
    // прежний постоянный CL=0,5 не соответствовал фактической массе / скорости.
    let m = massAfterAlt;
    let lrcFallback = alternate.lrcFallback;
    let flightLevelLimited = alternate.flightLevelLimited;
    const fl = as.cruiseFL;
    const aFl = aeroAtFl(aero, fl);
    const n = 24;
    for (let i = 0; i < n; i++) {
      const speed = cruiseMachAt(as, m, fl);
      lrcFallback ||= speed.fallback;
      flightLevelLimited ||= !flightLevelAllowed(aero, as, m, fl, speed.mach, engine);
      const { speedMs, densityKgM3 } = cruiseSpeed(fl, speed.mach);
      const cl = clForWeight(aFl, m * G0, densityKgM3, speedMs);
      const ld = liftToDrag(aFl, cl, speed.mach);
      m *= Math.exp(-(t / n) * G0 * tsfcAtMach(engine, speed.mach) / ld);
    }
    const finalKg = massAfterAlt - m;
    return { contingencyKg, alternateKg, finalKg, totalKg: contingencyKg + alternateKg + finalKg, lrcFallback, flightLevelLimited, finalReserveSource: "cruise" };
  }
  // FCOM CES 3.05.20: FF in KG/H/ENG, GREEN DOT, CLEAN, racetrack pattern.
  // Planning mass is the alternate landing mass BEFORE holding; do not integrate
  // the published table through decreasing mass (the planning basis is explicit).
  const h = as.fcomHolding && as.fcomHoldingFL !== undefined &&
    lookupHolding(as.fcomHolding, massAfterAlt, as.fcomHoldingFL);
  const holdingFuelFlowKgH = h && as.fcomHolding
    ? h.fuelFlowPerEngineKgH * as.fcomHolding.holding.engineCount : undefined;
  const tsfcHold = engine.tsfcCruise * as.holdTsfcRatio;
  const finalKg = holdingFuelFlowKgH === undefined
    ? massAfterAlt * (1 - Math.exp((-t * G0 * tsfcHold) / maxLiftToDrag(aero)))
    : holdingFuelFlowKgH * t / 3600;
  return {
    contingencyKg, alternateKg, finalKg, totalKg: contingencyKg + alternateKg + finalKg,
    lrcFallback: alternate.lrcFallback, flightLevelLimited: alternate.flightLevelLimited,
    finalReserveSource: holdingFuelFlowKgH === undefined
      ? (as.fcomHolding ? "physical-uncovered" : "physical") : "fcom",
    holdingFuelFlowKgH, holdingReferenceMassKg: holdingFuelFlowKgH === undefined ? undefined : massAfterAlt,
  };
}

export interface MissionResult {
  rangeNm: number;
  tripFuelKg: number;
  reserves: Reserves;
  trip: TripResult;
  /** Достаточно топлива на резервы. Для проверки конкретной дистанции используйте solveMissionFuel. */
  feasible: boolean;
  reserveShortfallKg: number;
  /** Запрошенная дальность (только при расчёте конкретного рейса). */
  requestedRangeNm?: number;
  /** Дефицит дальности по доступному топливу, неотрицательный. */
  distanceShortfallNm?: number;
}

/**
 * Дальность при заданной взлётной массе и взлётном топливе (уже без руления).
 * Резервы зависят от рейса, поэтому решаем итерацией: рейс = топливо − резервы.
 */
export function rangeForFuel(
  aero: AeroConfig,
  engine: EngineState,
  as: MissionAssumptions,
  takeoffMassKg: number,
  takeoffFuelKg: number,
): MissionResult {
  if (!Number.isFinite(takeoffFuelKg) || takeoffFuelKg < 0 || takeoffFuelKg >= takeoffMassKg)
    throw new RangeError("Взлётное топливо должно быть неотрицательным и меньше массы самолёта");
  let reserveKg = 0.1 * takeoffFuelKg;
  let trip = simulateTrip(aero, engine, as, takeoffMassKg, takeoffFuelKg - reserveKg);
  let res = reserves(aero, engine, as, takeoffFuelKg - reserveKg, trip.landingMassKg);
  for (let i = 0; i < 20; i++) {
    const next = res.totalKg;
    if (Math.abs(next - reserveKg) < 0.5) break;
    reserveKg = Math.min(takeoffFuelKg, next);
    trip = simulateTrip(aero, engine, as, takeoffMassKg, takeoffFuelKg - reserveKg);
    res = reserves(aero, engine, as, takeoffFuelKg - reserveKg, trip.landingMassKg);
  }
  const reserveShortfallKg = Math.max(0, res.totalKg - takeoffFuelKg);
  return {
    rangeNm: trip.distanceM / NM,
    tripFuelKg: takeoffFuelKg - reserveKg,
    reserves: res,
    trip,
    feasible: reserveShortfallKg <= 0.5,
    reserveShortfallKg,
  };
}

/**
 * Наименьшее взлётное топливо для ЗАДАННОЙ миссии, либо предел топлива, если
 * миссия недостижима. Верхняя граница уже должна учитывать ёмкость баков и MTOW.
 *
 * В отличие от rangeForFuel, feasible означает одновременно: выполнена
 * запрошенная дистанция И сохранены резервы. Не изменяет сравнительные
 * payload/range-кривые, в которых запрошенной дистанции нет.
 */
export function solveMissionFuel(
  aero: AeroConfig,
  engine: EngineState,
  as: MissionAssumptions,
  zeroFuelMassKg: number,
  maxTakeoffFuelKg: number,
  requestedRangeNm: number,
): { takeoffFuelKg: number; result: MissionResult } {
  if (!Number.isFinite(zeroFuelMassKg) || zeroFuelMassKg <= 0 ||
    !Number.isFinite(maxTakeoffFuelKg) || maxTakeoffFuelKg < 0 ||
    !Number.isFinite(requestedRangeNm) || requestedRangeNm <= 0) {
    throw new RangeError("Некорректны масса без топлива, доступное топливо или дальность рейса");
  }
  const evaluateFuel = (fuelKg: number) =>
    rangeForFuel(aero, engine, as, zeroFuelMassKg + fuelKg, fuelKg);
  // Допуск 0,0001 nm (~0,2 м): только округление бисекции, не эксплуатационный запас.
  const toleranceNm = 0.0001;
  const annotate = (r: MissionResult): MissionResult => {
    const distanceShortfallNm = Math.max(0, requestedRangeNm - r.rangeNm);
    return {
      ...r,
      requestedRangeNm,
      distanceShortfallNm,
      feasible: r.feasible && distanceShortfallNm <= toleranceNm,
    };
  };

  const maxResult = evaluateFuel(maxTakeoffFuelKg);
  if (!maxResult.feasible || maxResult.rangeNm + toleranceNm < requestedRangeNm) {
    // Не выдавать «подобранное» топливо за достаточное, если достигнут предел.
    return { takeoffFuelKg: maxTakeoffFuelKg, result: annotate(maxResult) };
  }

  let lo = 0;
  let hi = maxTakeoffFuelKg;
  for (let i = 0; i < 34; i++) {
    const mid = (lo + hi) / 2;
    const r = evaluateFuel(mid);
    if (r.feasible && r.rangeNm >= requestedRangeNm) hi = mid;
    else lo = mid;
  }
  return { takeoffFuelKg: hi, result: annotate(evaluateFuel(hi)) };
}
