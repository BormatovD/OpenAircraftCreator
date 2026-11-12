import test from "node:test";
import assert from "node:assert/strict";
import ces from "../data/fcom/a320-214-ces-phases.json" with { type: "json" };
import { DEFAULT_ASSUMPTIONS, simulateTrip, type MissionAssumptions } from "../src/mission.ts";
import { A320CEO } from "../src/aircraft/a320.ts";
import { comparisonAssumptionsFor, isCesA320Reference } from "../src/aircraft/missionProfiles.ts";
import { contextFor } from "../src/aircraft/contextFor.ts";

const aero = { wingAreaM2: 122.4, spanM: 34.1, cd0: 0.019, oswald: 0.78 };
const engine = { tsfcCruise: 0.586 / (3600 * 9.80665) };
const as: MissionAssumptions = { ...DEFAULT_ASSUMPTIONS, cruiseAltitudeMode: "fixed", cruiseFL: 350, fcomClimb: ces };

const same = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);

test("CES A320-214: FL350/60t — взлёт включён, без удвоения 90 кг", () => {
  const r = simulateTrip(aero, engine, as, 60_000, 8_000);
  assert.equal(r.climbSource, "fcom");
  same(r.takeoffFuelKg, 163);
  same(r.climbFuelKg, 1417 - 163);
  same(r.climbDistanceNm!, 114);
  same(r.climbTimeMin!, 18);
  const sum = r.takeoffFuelKg + r.climbFuelKg + r.cruiseFuelKg + r.stepClimbFuelKg + r.descentFuelKg;
  same(sum, 8000);
});

test("Физический расчёт не изменён при отсутствии таблицы", () => {
  const original = simulateTrip(aero, engine, DEFAULT_ASSUMPTIONS, 60_000, 8_000);
  const explicit = simulateTrip(aero, engine, { ...DEFAULT_ASSUMPTIONS, fcomClimb: undefined }, 60_000, 8_000);
  same(original.distanceM, explicit.distanceM);
  same(original.takeoffFuelKg, 90);
  assert.equal(original.climbSource, "energy");
});

test("Запасной аэродром не использует таблицу от brake release", () => {
  const r = simulateTrip(aero, engine, as, 60_000, 3_000, 250);
  assert.equal(r.climbSource, "energy");
  same(r.takeoffFuelKg, 90);
});

test("Вне табличного покрытия или другого профиля — без экстраполяции", () => {
  const uncovered = simulateTrip(aero, engine, as, 79_000, 6_000);
  assert.equal(uncovered.climbSource, "energy-uncovered");
  const otherMach = simulateTrip(aero, engine, { ...as, cruiseMach: 0.79 }, 60_000, 8_000);
  assert.equal(otherMach.climbSource, "energy");
  const otherIsa = simulateTrip(aero, engine, { ...as, fcomClimbIsaDeviationC: 10 }, 60_000, 8_000);
  assert.equal(otherIsa.climbSource, "energy");
});

test("Слишком короткий полёт использует физический режим частичного набора", () => {
  const r = simulateTrip(aero, engine, as, 60_000, 800);
  assert.equal(r.climbSource, "energy-short-route");
  assert.ok(r.distanceM >= 0);
});

test("Таблица CES подключается только к геометрически исходному A320ceo", () => {
  assert.equal(isCesA320Reference(A320CEO), true);
  assert.ok(comparisonAssumptionsFor(A320CEO).fcomClimb);
  assert.equal(isCesA320Reference({ ...A320CEO, wing: { ...A320CEO.wing, tip: "sharklet" } }), false);
  assert.equal(comparisonAssumptionsFor({ ...A320CEO, wing: { ...A320CEO.wing, tip: "sharklet" } }).fcomClimb, undefined);
  assert.equal(isCesA320Reference({ ...A320CEO, engine: { ...A320CEO.engine, bypassRatio: 9 } }), false);
  assert.equal(comparisonAssumptionsFor({ ...A320CEO, id: "a320neo" }).fcomClimb, undefined);
});


test("Кеш контекста не смешивает оригинальный A320 и переделанный с тем же id", () => {
  const original = contextFor(A320CEO);
  const converted = contextFor({ ...A320CEO, wing: { ...A320CEO.wing, tip: "sharklet" } });
  assert.ok(original.assumptions?.fcomClimb);
  assert.equal(converted.assumptions?.fcomClimb, undefined);
  assert.ok(contextFor(A320CEO).assumptions?.fcomClimb);
});
