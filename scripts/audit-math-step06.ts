// User-side production audit: run with the project's OWN atmosphere and installed code.
// node --experimental-strip-types scripts/audit-math-step06.ts > math-step06-local.json
import { A320CEO, A320NEO } from "../src/aircraft/a320.ts";
import { A319CEO, A321CEO } from "../src/aircraft/a320family.ts";
import { contextFor } from "../src/aircraft/contextFor.ts";
import { DEFAULT_MISSION, evaluateResolved, type EvalContext } from "../src/evaluate.ts";

const ctx = contextFor(A320CEO);
if (!ctx.assumptions) throw new Error("No source-specific mission assumptions for A320ceo");
const assumptions = ctx.assumptions;
const scenarios = [
  { key: "step04-climb-only", descent: false, holding: false },
  { key: "05-descent-only", descent: true, holding: false },
  { key: "06-holding-only", descent: false, holding: true },
  { key: "05-plus-06", descent: true, holding: true },
];

function summarize(label: string, context: EvalContext, distanceNm: number) {
  const e = evaluateResolved(A320CEO, [], context, { ...DEFAULT_MISSION, distanceNm });
  return {
    label, distanceNm,
    feasible: e.missionResult.feasible,
    actualRangeNm: e.missionResult.rangeNm,
    takeoffFuelKg: e.missionFuelKg,
    tripFuelKg: e.tripFuelKg,
    finalReserveKg: e.missionResult.reserves.finalKg,
    climbSource: e.missionResult.trip.climbSource,
    descentSource: e.missionResult.trip.descentSource,
    finalReserveSource: e.missionResult.reserves.finalReserveSource,
    selectedInitialFL: e.missionResult.trip.initialFL,
    selectedFinalFL: e.missionResult.trip.finalFL,
    pureDescentFuelKg: e.missionResult.trip.pureDescentFuelKg ?? null,
    approachFuelKg: e.missionResult.trip.approachFuelKg ?? null,
    descentMassBasis: e.missionResult.trip.descentMassBasis ?? null,
  };
}
const comparison810 = scenarios.map((s) => summarize(s.key, {
  ...ctx, assumptions: {
    ...assumptions,
    fcomDescent: s.descent ? assumptions.fcomDescent : undefined,
    fcomHolding: s.holding ? assumptions.fcomHolding : undefined,
  },
}, 810));

const distances = [500, 810, 1500, 2500];
const routeSensitivity = distances.map((d) => summarize(`reference-${d}nm`, ctx, d));
const otherAircraft = [A319CEO, A321CEO, A320NEO].map((def) => {
  const otherCtx = contextFor(def);
  const e = evaluateResolved(def, [], otherCtx);
  return {
    aircraft: def.id,
    takeoffFuelKg: e.missionFuelKg,
    feasible: e.missionResult.feasible,
    fcomClimbEnabled: !!e.missionAssumptions.fcomClimb,
    fcomDescentEnabled: !!e.missionAssumptions.fcomDescent,
    fcomHoldingEnabled: !!e.missionAssumptions.fcomHolding,
  };
});
console.log(JSON.stringify({
  label: "Math Steps 05/06 — source and calculated mission, no TSFC re-fit",
  source: "China Eastern A320-214 FCOM V3 pages 1846/1826, V2 page 647",
  caveats: [
    "WEIGHT in pure descent table does not specify mass timing; uses estimated mass at FL15",
    "135 kt approach groundspeed is an explicit model assumption, not from FCOM",
    "Holding FL15 assumes alternate aerodrome at sea level",
  ],
  comparison810, routeSensitivity, otherAircraft,
}, null, 2));
