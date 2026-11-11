import test from "node:test";
import assert from "node:assert/strict";
import ces from "../data/fcom/a320-214-ces-phases.json" with { type: "json" };
import { referencePhaseBudget } from "../src/phaseBudget.ts";

const boundaries = { initialClimbEndFl: 15, descentEndFl: 15, approachAndLandingFuelKg: 120 };
const request = {
  brakeReleaseMassKg: 60000, climbToFl: 350, climbIsaDeviationC: 0,
  descentReferenceMassKg: 60000, descentFromFl: 350,
  holdingReferenceMassKg: 60000, holdingFl: 15, holdingMinutes: 30,
};

test("CES: взлёт не добавлен второй раз, IFR отдельно, holding на два двигателя", () => {
  const b = referencePhaseBudget(ces, boundaries, request)!;
  assert.equal(b.departure.totalFuelKg, 1417);
  assert.equal(b.departure.takeoffAndInitialClimbFuelKg, 163);
  assert.equal(b.departure.climbAboveInitialFuelKg, 1254);
  assert.equal(b.departure.takeoffAndInitialClimbFuelKg + b.departure.climbAboveInitialFuelKg, b.departure.totalFuelKg);
  assert.equal(b.arrival.descentFuelKg, 150.5); // Линейная интерполяция между 45 т / 134 кг и 65 т / 156 кг.
  assert.equal(b.arrival.totalFuelKg, 270.5);
  assert.equal(b.holding.fuelFlowPerEngineKgH, 1128);
  assert.equal(b.holding.fuelFlowTotalKgH, 2256);
  assert.equal(b.holding.fuelKg, 1128);
  assert.equal(b.tripNonCruiseFuelKg, 1687.5); // Резерв ожидания сюда не входит.
});

test("Поправки FUEL/FF не масштабируют отдельный IFR-заход, время или дистанцию", () => {
  const b = referencePhaseBudget(ces, boundaries, request, { climbFuelPct: 5, descentFuelPct: 44, holdingFuelFlowPct: 9 })!;
  assert.ok(Math.abs(b.departure.totalFuelKg - 1487.85) < 1e-8);
  assert.equal(b.arrival.approachAndLandingFuelKg, 120);
  assert.ok(Math.abs(b.arrival.totalFuelKg - 336.72) < 1e-8);
  assert.ok(Math.abs(b.holding.fuelKg - 1229.52) < 1e-8);
  assert.equal(b.departure.timeMin, 18);
  assert.equal(b.departure.distanceNm, 114);
});

test("Нет экстраполяции за массу/ISA, заполнения потолочной дырки или бюджета ниже границ фаз", () => {
  assert.equal(referencePhaseBudget(ces, boundaries, { ...request, climbIsaDeviationC: 10 }), undefined);
  assert.equal(referencePhaseBudget(ces, boundaries, { ...request, brakeReleaseMassKg: 78000, climbToFl: 390 }), undefined);
  assert.equal(referencePhaseBudget(ces, boundaries, { ...request, descentReferenceMassKg: 66000 }), undefined);
  assert.equal(referencePhaseBudget(ces, boundaries, { ...request, holdingReferenceMassKg: 45000 }), undefined);
  assert.equal(referencePhaseBudget(ces, boundaries, { ...request, climbToFl: 10 }), undefined);
  assert.equal(referencePhaseBudget(ces, boundaries, { ...request, descentFromFl: 10 }), undefined);
  assert.equal(referencePhaseBudget(ces, { ...boundaries, descentEndFl: 50 }, request), undefined);
});

test("Нулевая длительность ожидания допустима, физически неверные вводы отвергаются", () => {
  assert.equal(referencePhaseBudget(ces, boundaries, { ...request, holdingMinutes: 0 })!.holding.fuelKg, 0);
  assert.throws(() => referencePhaseBudget(ces, boundaries, { ...request, holdingMinutes: -1 }), RangeError);
  assert.throws(() => referencePhaseBudget(ces, boundaries, request, { climbFuelPct: -101 }), RangeError);
  assert.throws(() => referencePhaseBudget(ces, { ...boundaries, approachAndLandingFuelKg: NaN }, request), RangeError);
});
