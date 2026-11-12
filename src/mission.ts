// Сегментная миссия: взлёт → набор (энергетический метод) → крейсер (Бреге, пошагово) → снижение,
// плюс резервы: 5% на непредвиденное, запасной аэродром, 30 минут финального резерва.
// Все допущения собраны в MissionAssumptions и подписаны: они не калибруются, калибруется только TSFC.

import { type AeroConfig, aeroAtFl, clForWeight, liftToDrag, maxLiftToDrag } from "./aero.ts";
import { G0, NM, flightLevelToM, isa } from "./atmosphere.ts";
import { requiredThrustN } from "./thrust.ts";
import { type LrcTable, interpolateLrcMach } from "./cruise.ts";
import { tsfcMachFactor } from "./propulsion.ts";
import { type PhaseTableDataset, lookupClimb } from "./phaseTables.ts";

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
  /** Только горизонтальный крейсер; топливо ступеней показано отдельно. */
  cruiseFuelKg: number;
  stepClimbFuelKg: number;
  descentFuelKg: number;
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
  let { speedMs, densityKgM3 } = cruiseSpeed(fl, mach);
  const h = flightLevelToM(fl);
  let distance = 0;

  // Набор высоты: энергия = потенциальная + кинетическая + работа против сопротивления на дистанции набора.
  // Поляра на текущем эшелоне — с поправкой трения на число Рейнольдса.
  let aFl = aeroAtFl(aero, fl);
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
  const fixedFuel = initialFuel + climbBurn + as.descentFuelKg;
  // Фаза FCOM — ПОЛНЫЙ набор от brake release. На очень коротком рейсе нельзя пропорционально
  // использовать её без физической модели частичного набора; сохраняем прежнюю оценку.
  if (tableValid && tripFuelKg <= fixedFuel) {
    const fallback = simulateTrip(aero, engine, { ...as, fcomClimb: undefined }, takeoffMassKg, tripFuelKg, cruiseFL);
    return { ...fallback, climbSource: "energy-short-route" };
  }
  if (tripFuelKg <= fixedFuel) {
    // Очень короткий рейс: дистанцию считаем пропорционально, без крейсерского участка.
    const share = Math.max(0, tripFuelKg / fixedFuel);
    return {
      distanceM: share * (climbDistance + as.descentDistanceKm * 1000),
      takeoffFuelKg: initialFuel * share,
      climbFuelKg: climbBurn * share,
      climbSource,
      climbDistanceNm: (share * climbDistance) / NM,
      climbTimeMin: tableValid ? (share * fullClimb.timeMin) : undefined,
      cruiseFuelKg: 0,
      stepClimbFuelKg: 0,
      descentFuelKg: as.descentFuelKg * share,
      landingMassKg: takeoffMassKg - tripFuelKg,
      initialFL: fl,
      finalFL: fl,
      initialMach: mach,
      finalMach: mach,
      minMach: mach,
      maxMach: mach,
      lrcFallback,
      flightLevelLimited,
    };
  }

  // m после взлёта изначально уменьшено на старые 90 кг; для табличного режима
  // восстанавливаем точный баланс от brake release, без двойного счёта взлёта.
  m = takeoffMassKg - initialFuel - climbBurn;
  distance += climbDistance;
  const initialFL = fl;

  // Крейсер: Бреге пошагово по массе; скорость LRC пересчитывается на каждом шаге и на каждом эшелоне.
  // При ступенчатом наборе подъём на следующий эшелон стоит энергии m·g·Δh, оплачиваемой из крейсерского топлива.
  const cruiseFuel = tripFuelKg - fixedFuel;
  let remaining = cruiseFuel;
  const dm = cruiseFuel / as.cruiseSteps;
  let stepClimbFuelKg = 0;
  let initialMach = mach;
  let minMach = Infinity;
  let maxMach = -Infinity;
  let cruiseSample: TripResult["cruiseSample"];
  let sampleDelta = Infinity;
  const sampleMass = m - cruiseFuel / 2;
  while (remaining > 1e-6) {
    speed = cruiseMachAt(as, m, fl);
    mach = speed.mach;
    lrcFallback ||= speed.fallback;
    ({ speedMs, densityKgM3 } = cruiseSpeed(fl, mach));
    if (stepping) {
      const target = selectFlightLevel(aero, as, m, engine);
      flightLevelLimited ||= target.limited;
      if (target.fl > fl) {
        const targetMach = cruiseMachAt(as, m, target.fl).mach;
        const targetSpeed = cruiseSpeed(target.fl, targetMach).speedMs;
        const dh = flightLevelToM(target.fl) - flightLevelToM(fl);
        const kinetic = Math.max(0, (targetSpeed * targetSpeed - speedMs * speedMs) / 2);
        const etaStep = speedMs / (tsfcAtMach(engine, mach) * LHV_JET_A) * as.climbEfficiencyRatio;
        const stepFuel = m * (G0 * dh + kinetic) / (etaStep * LHV_JET_A);
        // Нельзя занять верхний эшелон, оплатив лишь часть его энергетической цены.
        if (stepFuel < remaining) {
          m -= stepFuel;
          remaining -= stepFuel;
          stepClimbFuelKg += stepFuel;
          fl = target.fl;
          aFl = aeroAtFl(aero, fl);
        }
      }
    }
    const step = Math.min(dm, remaining);
    const mMid = m - step / 2;
    speed = cruiseMachAt(as, mMid, fl);
    mach = speed.mach;
    lrcFallback ||= speed.fallback;
    ({ speedMs, densityKgM3 } = cruiseSpeed(fl, mach));
    if (minMach === Infinity) initialMach = mach;
    minMach = Math.min(minMach, mach);
    maxMach = Math.max(maxMach, mach);
    if (Math.abs(mMid - sampleMass) < sampleDelta) {
      sampleDelta = Math.abs(mMid - sampleMass);
      cruiseSample = { massKg: mMid, fl, mach };
    }
    const cl = clForWeight(aFl, mMid * G0, densityKgM3, speedMs);
    const ld = liftToDrag(aFl, cl, mach);
    distance += ((speedMs * ld) / (G0 * tsfcAtMach(engine, mach))) * Math.log(m / (m - step));
    m -= step;
    remaining -= step;
  }

  m -= as.descentFuelKg;
  distance += as.descentDistanceKm * 1000;

  return {
    distanceM: distance,
    takeoffFuelKg: initialFuel,
    climbFuelKg: climbBurn,
    climbSource,
    climbDistanceNm: climbDistance / NM,
    climbTimeMin: tableValid ? fullClimb.timeMin : undefined,
    cruiseFuelKg: cruiseFuel - stepClimbFuelKg,
    stepClimbFuelKg,
    descentFuelKg: as.descentFuelKg,
    landingMassKg: m,
    initialFL,
    finalFL: fl,
    initialMach,
    finalMach: mach,
    minMach: Number.isFinite(minMach) ? minMach : mach,
    maxMach: Number.isFinite(maxMach) ? maxMach : mach,
    lrcFallback,
    flightLevelLimited,
    cruiseSample,
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
    return { contingencyKg, alternateKg, finalKg, totalKg: contingencyKg + alternateKg + finalKg, lrcFallback, flightLevelLimited };
  }
  const tsfcHold = engine.tsfcCruise * as.holdTsfcRatio;
  const finalKg = massAfterAlt * (1 - Math.exp((-t * G0 * tsfcHold) / maxLiftToDrag(aero)));
  return {
    contingencyKg, alternateKg, finalKg, totalKg: contingencyKg + alternateKg + finalKg,
    lrcFallback: alternate.lrcFallback, flightLevelLimited: alternate.flightLevelLimited,
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
