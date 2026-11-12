import test from "node:test";
import assert from "node:assert/strict";
import ces from "../data/fcom/a320-214-ces-phases.json" with { type: "json" };
import { lookupDescent } from "../src/phaseTables.ts";
import { DEFAULT_ASSUMPTIONS, simulateTrip, type MissionAssumptions } from "../src/mission.ts";

const aero = { wingAreaM2: 122.4, spanM: 34.1, cd0: 0.019, oswald: 0.78 };
const engine = { tsfcCruise: 0.586 / (3600 * 9.80665) };
const baseline: MissionAssumptions = {
  ...DEFAULT_ASSUMPTIONS, cruiseAltitudeMode: "fixed", cruiseFL: 350, cruiseSteps: 50,
  fcomClimb: ces, fcomClimbIsaDeviationC: 0,
  fcomDescent: ces, fcomApproachFuelKg: 120,
  fcomApproachDurationMin: 6, fcomApproachGroundspeedKt: 135,
};
const close = (a: number, b: number, tolerance = 1e-7) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);

test("source descent mass/FL grid is interpolated but never extrapolated", () => {
  const found = lookupDescent(ces, 60_000, 350);
  assert.ok(found);
  close(found.fuelKg, 150.5);
  close(found.distanceNm, 90.5);
  assert.equal(lookupDescent(ces, 70_000, 350), undefined);
  assert.equal(lookupDescent(ces, 60_000, 410), undefined);
});

test("pure descent and IFR approach are separate, no additional old 300 kg", () => {
  const result = simulateTrip(aero, engine, baseline, 60_000, 7_000);
  assert.equal(result.climbSource, "fcom");
  assert.equal(result.descentSource, "fcom");
  assert.equal(result.descentMassBasis, "estimated-mass-at-1500ft");
  close(result.approachFuelKg!, 120);
  const row = lookupDescent(ces, 60_000 - 7_000 + 120, result.finalFL)!;
  close(result.pureDescentFuelKg!, row.fuelKg);
  close(result.descentFuelKg, row.fuelKg + 120);
  close(result.pureDescentDistanceNm!, row.distanceNm);
  close(result.approachDistanceNm!, 13.5);
  close(result.landingMassKg, 53_000, 1e-5);
  close(result.takeoffFuelKg + result.climbFuelKg + result.cruiseFuelKg +
    result.stepClimbFuelKg + result.descentFuelKg, 7_000, 1e-5);
});

test("no FCOM arrival on alternate leg or changed speed", () => {
  const alt = simulateTrip(aero, engine, baseline, 60_000, 6_000, 250);
  assert.equal(alt.descentSource, "energy");
  assert.equal(alt.descentFuelKg, 300);
  const fast = simulateTrip(aero, engine, { ...baseline, cruiseMach: 0.8 }, 60_000, 7_000);
  assert.equal(fast.descentSource, "energy");
});

test("out of tabular coverage falls back without extrapolating", () => {
  const outside = simulateTrip(aero, engine, baseline, 72_000, 6_000);
  assert.equal(outside.descentSource, "energy-uncovered");
  assert.equal(outside.descentFuelKg, 300);
});

test("short routes do not claim complete tabular descent", () => {
  const short = simulateTrip(aero, engine, baseline, 60_000, 750);
  assert.notEqual(short.descentSource, "fcom");
  assert.notEqual(short.climbSource, "fcom");
});

test("only unchanged A320ceo receives CES arrival table", async () => {
  const { A320CEO } = await import("../src/aircraft/a320.ts");
  const { comparisonAssumptionsFor } = await import("../src/aircraft/missionProfiles.ts");
  assert.ok(comparisonAssumptionsFor(A320CEO).fcomDescent);
  assert.equal(comparisonAssumptionsFor({
    ...A320CEO,
    wing: { ...A320CEO.wing, areaM2: A320CEO.wing.areaM2 + 1 },
  }).fcomDescent, undefined);
});
