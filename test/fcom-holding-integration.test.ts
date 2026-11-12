import test from "node:test";
import assert from "node:assert/strict";
import ces from "../data/fcom/a320-214-ces-phases.json" with { type: "json" };
import { lookupHolding } from "../src/phaseTables.ts";
import { DEFAULT_ASSUMPTIONS, reserves, type MissionAssumptions } from "../src/mission.ts";

const aero = { wingAreaM2: 122.4, spanM: 34.1, cd0: 0.019, oswald: 0.78 };
const engine = { tsfcCruise: 0.586 / (3600 * 9.80665) };
const base: MissionAssumptions = { ...DEFAULT_ASSUMPTIONS, cruiseAltitudeMode: "fixed", cruiseFL: 350,
  cruiseSteps: 50, alternateDistanceNm: 80, fcomHolding: ces, fcomHoldingFL: 15 };

const close = (a: number, b: number, tolerance = 1e-6) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);

test("FCOM at 60t FL15 gives 2256 kg/h aircraft total, not per engine", () => {
  const point = lookupHolding(ces, 60_000, 15);
  assert.ok(point);
  close(point.fuelFlowPerEngineKgH, 1128);
  close(point.fuelFlowPerEngineKgH * ces.holding.engineCount, 2256);
});

test("reserves use alternate landing weight as holding reference mass", () => {
  const r = reserves(aero, engine, base, 6_000, 57_000);
  assert.equal(r.finalReserveSource, "fcom");
  const mAlt = 57_000 - r.alternateKg;
  close(r.holdingReferenceMassKg!, mAlt);
  const row = lookupHolding(ces, mAlt, 15);
  assert.ok(row);
  close(r.holdingFuelFlowKgH!, row.fuelFlowPerEngineKgH * 2);
  close(r.finalKg, r.holdingFuelFlowKgH! * 0.5);
  close(r.totalKg, r.contingencyKg + r.alternateKg + r.finalKg);
});

test("holding out of coverage falls back to physical model", () => {
  const r = reserves(aero, engine, { ...base, fcomHoldingFL: 300 }, 6_000, 57_000);
  assert.equal(r.finalReserveSource, "physical-uncovered");
  assert.ok(Number.isFinite(r.finalKg) && r.finalKg > 0);
});

test("cruise reserve mode is not overwritten by FCOM holding", () => {
  const r = reserves(aero, engine, { ...base, finalReserveMode: "cruise" }, 6_000, 57_000);
  assert.equal(r.finalReserveSource, "cruise");
});

test("different family members and altered A320 never inherit FCOM holding", async () => {
  const { A320CEO, A320NEO } = await import("../src/aircraft/a320.ts");
  const { A319CEO, A321CEO } = await import("../src/aircraft/a320family.ts");
  const { comparisonAssumptionsFor } = await import("../src/aircraft/missionProfiles.ts");
  assert.ok(comparisonAssumptionsFor(A320CEO).fcomHolding);
  for (const def of [A320NEO, A319CEO, A321CEO, {
    ...A320CEO,
    engine: { ...A320CEO.engine, takeoffThrustKn: 124 },
  }]) {
    const assumptions = comparisonAssumptionsFor(def);
    assert.equal(assumptions.fcomHolding, undefined);
    assert.equal(assumptions.fcomDescent, undefined);
  }
});
