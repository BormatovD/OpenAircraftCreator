/**
 * Независимый шаг 04: никаких новых коэффициентов и подгонки.
 * npm run? Не требуется: node --experimental-strip-types scripts/audit-math-step04.ts
 * Проверяет эффект табличного НАБОРА A320ceo отдельно от графиков семейства и Boeing.
 */
import { A320CEO } from "../src/aircraft/a320.ts";
import { A320_CONTEXT } from "../src/aircraft/a320Context.ts";
import { contextFor } from "../src/aircraft/contextFor.ts";
import { aeroFor, evaluate, type EvalContext, engineStateFor, DEFAULT_MISSION } from "../src/evaluate.ts";
import { simulateTrip } from "../src/mission.ts";
import { boeingCases, validateBoeing, validateFamily } from "../src/validation.ts";

const round = (v: number, digits = 3) => Number(v.toFixed(digits));
const withContext = contextFor(A320CEO);
if (!withContext.assumptions?.fcomClimb) throw new Error("Контекст A320ceo не использует FCOM в эталонном режиме");
const physical: EvalContext = { ...withContext, assumptions: { ...withContext.assumptions, fcomClimb: undefined } };
const before = evaluate(A320CEO, [], physical, DEFAULT_MISSION);
const after = evaluate(A320CEO, [], withContext, DEFAULT_MISSION);
const aero = aeroFor(A320CEO, A320_CONTEXT.aero, []);
const as = { ...withContext.assumptions, cruiseAltitudeMode: "fixed" as const, cruiseFL: 350 };
const engine = engineStateFor(A320CEO, A320_CONTEXT, [], as);
const physics60 = simulateTrip(aero, engine, { ...as, fcomClimb: undefined }, 60_000, 8_000);
const fcom60 = simulateTrip(aero, engine, as, 60_000, 8_000);
const family = validateFamily(A320_CONTEXT).map((r) => ({
  type: r.c.name, role: r.c.role, count: r.rows.length,
  biasPct: round(r.biasPct), rmsPct: round(r.rmsPct), maxAbsPct: round(r.maxAbsPct),
  oewModelKg: round(r.oewModelKg, 1), oewChartKg: round(r.oewChartKg, 1),
}));
const boeing = boeingCases().map((c) => {
  const r = validateBoeing(A320_CONTEXT, c);
  return {
    type: c.name, count: r.points.length,
    biasPct: round(r.biasPct), rmsPct: round(r.rmsPct), maxAbsPct: round(r.maxAbsPct),
    lrcFallbackPoints: r.lrcFallbackPoints,
    flightLevelLimitedPoints: r.flightLevelLimitedPoints,
    reserveShortfallPoints: r.reserveShortfallPoints,
  };
});
const kg = (r: ReturnType<typeof evaluate>) => round(r.missionFuelKg, 4);
const result = {
  reference: {
    source: "A320-214 CFM56-5B4/P fence, CES FCOM V3, ISA0, climb from brake release",
    massKg: 60_000, fl: 350,
    before: { climbFuelKg: round(physics60.takeoffFuelKg + physics60.climbFuelKg), climbDistanceNm: round(physics60.climbDistanceNm!), source: physics60.climbSource },
    after: { climbFuelKg: round(fcom60.takeoffFuelKg + fcom60.climbFuelKg), climbDistanceNm: round(fcom60.climbDistanceNm!), timeMin: fcom60.climbTimeMin, source: fcom60.climbSource },
  },
  referenceMission: {
    targetNm: DEFAULT_MISSION.distanceNm,
    before: { takeoffFuelKg: kg(before), tripFuelKg: round(before.tripFuelKg), feasible: before.missionResult.feasible },
    after: { takeoffFuelKg: kg(after), tripFuelKg: round(after.tripFuelKg), feasible: after.missionResult.feasible },
    deltaTakeoffFuelKg: round(after.missionFuelKg - before.missionFuelKg),
    deltaTakeoffFuelPct: round(100 * (after.missionFuelKg - before.missionFuelKg) / before.missionFuelKg),
  },
  independent: { family, boeing },
  decision: "TSFC не менять. После согласованного снижения и ожидания повторить полную фазовую калибровку; независимые точки не включать в подбор.",
  limits: ["Восстановление исходного набора возможно только в покрытии FCOM", "Ни один другой тип не использует таблицу набора CES", "Ни один результат FCOM крейсера не используется для подгонки"],
};
console.log(JSON.stringify(result, null, 2));
