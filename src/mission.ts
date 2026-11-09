// Сегментная миссия: взлёт → набор (энергетический метод) → крейсер (Бреге, пошагово) → снижение,
// плюс резервы: 5% на непредвиденное, запасной аэродром, 30 минут финального резерва.
// Все допущения собраны в MissionAssumptions и подписаны: они не калибруются, калибруется только TSFC.

import { type AeroConfig, clForWeight, liftToDrag, maxLiftToDrag } from "./aero.ts";
import { G0, NM, flightLevelToM, isa } from "./atmosphere.ts";
import { requiredThrustN, thrustLapse } from "./thrust.ts";

export const LHV_JET_A = 43.2e6; // Дж/кг, теплотворная способность керосина

export interface EngineState {
  /** Крейсерский удельный расход, кг/(Н·с). Калибруемая величина. */
  tsfcCruise: number;
  /** Суммарная взлётная тяга, Н. Если задана, эшелон ограничен ещё и тягой (300 фут/мин остаточной скороподъёмности). */
  takeoffThrustN?: number;
}

export type CruiseAltitudeMode = "fixed" | "stepClimb";

export interface MissionAssumptions {
  cruiseMach: number;
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
  climbFuelKg: number;
  cruiseFuelKg: number;
  landingMassKg: number;
  initialFL: number;
  finalFL: number;
}

// Атмосфера на эшелоне не меняется — кешируем: миссия вызывается тысячи раз при перепроектировании.
const speedCache = new Map<string, { speedMs: number; densityKgM3: number }>();
function cruiseSpeed(fl: number, mach: number): { speedMs: number; densityKgM3: number } {
  const key = `${fl}|${mach}`;
  let v = speedCache.get(key);
  if (!v) {
    const atm = isa(flightLevelToM(fl));
    v = { speedMs: mach * atm.speedOfSoundMs, densityKgM3: atm.densityKgM3 };
    speedCache.set(key, v);
  }
  return v;
}

const lapseCache = new Map<string, number>();
function lapseAt(fl: number, mach: number): number {
  const key = `${fl}|${mach}`;
  let v = lapseCache.get(key);
  if (v === undefined) {
    v = thrustLapse(flightLevelToM(fl), mach);
    lapseCache.set(key, v);
  }
  return v;
}

/** Самый высокий эшелон из списка, где CL при данной массе не превышает предел и хватает тяги. */
export function bestFlightLevel(aero: AeroConfig, as: MissionAssumptions, massKg: number, engine?: EngineState): number {
  // Самый высокий эшелон, где CL не выше предела (без сортировки и копирования массива — горячий путь).
  let best = as.stepFLs[0];
  for (const fl of as.stepFLs) if (fl < best) best = fl;
  for (const fl of as.stepFLs) {
    if (fl <= best) continue;
    const { speedMs, densityKgM3 } = cruiseSpeed(fl, as.cruiseMach);
    if (clForWeight(aero, massKg * G0, densityKgM3, speedMs) > as.cruiseClMax) continue;
    if (engine?.takeoffThrustN && engine.takeoffThrustN * lapseAt(fl, as.cruiseMach) < requiredThrustN(aero, massKg, fl, as.cruiseMach)) continue;
    best = fl;
  }
  return best;
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
  const stepping = cruiseFL === undefined && as.cruiseAltitudeMode === "stepClimb";
  let m = takeoffMassKg - as.takeoffFuelKg;
  let fl = cruiseFL ?? (stepping ? bestFlightLevel(aero, as, m, engine) : as.cruiseFL);
  let { speedMs, densityKgM3 } = cruiseSpeed(fl, as.cruiseMach);
  const h = flightLevelToM(fl);
  let distance = 0;

  // Набор высоты: энергия = потенциальная + кинетическая + работа против сопротивления на дистанции набора.
  const clClimb = clForWeight(aero, m * G0, densityKgM3, speedMs);
  const ldClimb = liftToDrag(aero, clClimb, as.cruiseMach) * as.climbLdRatio;
  const etaCruise = speedMs / (engine.tsfcCruise * LHV_JET_A);
  const etaClimb = etaCruise * as.climbEfficiencyRatio;
  const climbDist = as.climbDistanceKm * 1000;
  const climbEnergy = m * (G0 * h + 0.5 * speedMs * speedMs + (G0 * climbDist) / ldClimb);
  const climbFuel = climbEnergy / (etaClimb * LHV_JET_A);

  const fixedFuel = as.takeoffFuelKg + climbFuel + as.descentFuelKg;
  if (tripFuelKg <= fixedFuel) {
    // Очень короткий рейс: дистанцию считаем пропорционально, без крейсерского участка.
    const share = Math.max(0, tripFuelKg / fixedFuel);
    return {
      distanceM: share * (climbDist + as.descentDistanceKm * 1000),
      climbFuelKg: climbFuel * share,
      cruiseFuelKg: 0,
      landingMassKg: takeoffMassKg - tripFuelKg,
      initialFL: fl,
      finalFL: fl,
    };
  }

  m -= climbFuel;
  distance += climbDist;
  const initialFL = fl;

  // Крейсер: Бреге пошагово по массе, Мах постоянен, CL меняется.
  // При ступенчатом наборе подъём на следующий эшелон стоит энергии m·g·Δh, оплачиваемой из крейсерского топлива.
  const cruiseFuel = tripFuelKg - fixedFuel;
  let remaining = cruiseFuel;
  const dm = cruiseFuel / as.cruiseSteps;
  while (remaining > 1e-6) {
    if (stepping) {
      const target = bestFlightLevel(aero, as, m, engine);
      if (target > fl) {
        const dh = flightLevelToM(target) - flightLevelToM(fl);
        const stepFuel = Math.min(remaining, (m * G0 * dh) / (etaClimb * LHV_JET_A));
        m -= stepFuel;
        remaining -= stepFuel;
        fl = target;
        ({ speedMs, densityKgM3 } = cruiseSpeed(fl, as.cruiseMach));
        if (remaining <= 1e-6) break;
      }
    }
    const step = Math.min(dm, remaining);
    const mMid = m - step / 2;
    const cl = clForWeight(aero, mMid * G0, densityKgM3, speedMs);
    const ld = liftToDrag(aero, cl, as.cruiseMach);
    distance += ((speedMs * ld) / (G0 * engine.tsfcCruise)) * Math.log(m / (m - step));
    m -= step;
    remaining -= step;
  }

  m -= as.descentFuelKg;
  distance += as.descentDistanceKm * 1000;

  return { distanceM: distance, climbFuelKg: climbFuel, cruiseFuelKg: cruiseFuel, landingMassKg: m, initialFL, finalFL: fl };
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
  // Финальный резерв: ожидание на максимальном L/D.
  const massAfterAlt = landingMassKg - alternateKg;
  const t = as.finalReserveMin * 60;
  const tsfcHold = engine.tsfcCruise * as.holdTsfcRatio;
  const finalKg = massAfterAlt * (1 - Math.exp((-t * G0 * tsfcHold) / maxLiftToDrag(aero)));
  return { contingencyKg, alternateKg, finalKg, totalKg: contingencyKg + alternateKg + finalKg };
}

export interface MissionResult {
  rangeNm: number;
  tripFuelKg: number;
  reserves: Reserves;
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
  let reserveKg = 0.1 * takeoffFuelKg;
  let trip = simulateTrip(aero, engine, as, takeoffMassKg, takeoffFuelKg - reserveKg);
  let res = reserves(aero, engine, as, takeoffFuelKg - reserveKg, trip.landingMassKg);
  for (let i = 0; i < 20; i++) {
    const next = res.totalKg;
    if (Math.abs(next - reserveKg) < 0.5) break;
    reserveKg = next;
    trip = simulateTrip(aero, engine, as, takeoffMassKg, takeoffFuelKg - reserveKg);
    res = reserves(aero, engine, as, takeoffFuelKg - reserveKg, trip.landingMassKg);
  }
  return { rangeNm: trip.distanceM / NM, tripFuelKg: takeoffFuelKg - reserveKg, reserves: res };
}
