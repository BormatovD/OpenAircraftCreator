import { engineStateFor, type Evaluation, type EvalContext } from "../evaluate.ts";
import { solveMissionFuel } from "../mission.ts";
import type { Lever } from "../levers.ts";

export interface RouteInput {
  distanceNm: number;
  pax: number;
  alternateNm?: number;
  contingency?: number;
  finalMin?: number;
}

// Published review sector, effective distance including the FlightCost ICAO correction.
// The embedded calculator supplies the distance from its own airport database.
export const FRA_BCN_NM = 643.9210126092604;

// Use still-air mean groundspeeds for energy-based terminal phases. Taxi time covers departure and arrival together.
// FlightCost review scenario includes the passenger and baggage.
const PAX_KG = 100;
const CLIMB_KT = 300;
const DESCENT_KT = 280;
const TAXI_MIN = 26;

export function flightCostRoute(configuration: { ev: Evaluation; ctx: EvalContext; levers: Lever[] }, input: RouteInput) {
  const { ev, ctx, levers } = configuration;
  if (!Number.isInteger(input.pax) || input.pax < 0 || input.pax > 1000 ||
      !Number.isFinite(input.distanceNm) || input.distanceNm <= 0) throw Error("Некорректные параметры рейса");
  const def = ev.definition;
  const as = { ...ev.missionAssumptions };
  for (const v of [input.alternateNm, input.contingency, input.finalMin]) {
    if (v !== undefined && (!Number.isFinite(v) || v < 0)) throw Error("Некорректный резерв топлива");
  }
  if (input.alternateNm !== undefined) as.alternateDistanceNm = input.alternateNm;
  if (input.contingency !== undefined) as.contingencyFraction = input.contingency;
  if (input.finalMin !== undefined) as.finalReserveMin = input.finalMin;
  const engine = engineStateFor(def, ctx, levers, as);
  const tank = def.systems.fuelVolumeL * ctx.fuelDensityKgL - as.taxiFuelKg;
  const payloadLimit = ev.maxPayloadKg;
  function solve(pax: number) {
    const payload = pax * PAX_KG;
    const zfw = ev.oewKg + payload;
    const available = Math.max(0, Math.min(tank, def.weights.mtowKg - zfw));
    const { takeoffFuelKg, result } = solveMissionFuel(ev.aero, engine, as, zfw, available, input.distanceNm);
    const limits: Record<string, string> = {};
    if (pax > ev.seats) limits.cabin = "Превышено число кресел в сохранённом салоне";
    if (payload > payloadLimit) limits.payload = "Превышена допустимая коммерческая нагрузка";
    if (!result.feasible) limits.range = "Доступного топлива недостаточно для дистанции и резервов";
    if (result.trip.landingMassKg > def.weights.mlwKg) limits.mlw = "Превышена максимальная посадочная масса";
    return { result, limits, takeoffMassKg: zfw + takeoffFuelKg };
  }
  const requested = solve(input.pax);
  function canCarry(pax: number) {
    return Object.keys((pax === input.pax ? requested : solve(pax)).limits).length === 0;
  }
  let maxPax = Math.min(ev.seats, Math.max(0, Math.floor(payloadLimit / PAX_KG)));
  if (!canCarry(maxPax)) {
    let lo = 0, hi = maxPax;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (canCarry(mid)) lo = mid; else hi = mid - 1;
    }
    maxPax = lo;
  }
  const { result: mission, takeoffMassKg, limits } = requested;
  const t = mission.trip;
  const minutes = {
    taxi: TAXI_MIN, climb: t.climbTimeMin ?? (t.climbDistanceNm ?? 0) / CLIMB_KT * 60,
    cruise: t.cruiseTimeMin,
    descent: t.pureDescentTimeMin !== undefined && as.fcomApproachDurationMin !== undefined
      ? t.pureDescentTimeMin + as.fcomApproachDurationMin
      : t.descentDistanceNm / DESCENT_KT * 60,
  };
  const fuel = { taxi: as.taxiFuelKg, climb: t.takeoffFuelKg + t.climbFuelKg,
    cruise: t.cruiseFuelKg + t.stepClimbFuelKg, descent: t.descentFuelKg };
  return { pax: input.pax, maxPax, limits, takeoffMassKg, fuel, minutes, reserves: mission.reserves,
    tripKg: mission.tripFuelKg + as.taxiFuelKg, blockMin: Object.values(minutes).reduce((a, b) => a + b, 0) };
}
