import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isa } from "../src/atmosphere.ts";
import { type AeroConfig, maxLiftToDrag } from "../src/aero.ts";
import { DEFAULT_ASSUMPTIONS, rangeForFuel } from "../src/mission.ts";
import { calibrateTsfc } from "../src/calibrate.ts";
import { type AircraftData, maxAbsErrorPct } from "../src/payloadRange.ts";

const data = JSON.parse(readFileSync(new URL("../data/a320.json", import.meta.url), "utf8"));
const aero = (span: number): AeroConfig => ({ wingAreaM2: 122.4, spanM: span, cd0: 0.019, oswald: 0.78 });
const engine = { tsfcCruise: 1.64e-5 };

test("МСА: уровень моря и тропопауза", () => {
  const sl = isa(0);
  assert.ok(Math.abs(sl.densityKgM3 - 1.225) < 0.001);
  const tp = isa(11000);
  assert.ok(Math.abs(tp.temperatureK - 216.65) < 0.01);
  assert.ok(Math.abs(tp.pressurePa - 22632) < 5);
});

test("больше топлива — больше дальность", () => {
  const a = rangeForFuel(aero(35.8), engine, DEFAULT_ASSUMPTIONS, 70000, 10000).rangeNm;
  const b = rangeForFuel(aero(35.8), engine, DEFAULT_ASSUMPTIONS, 70000, 14000).rangeNm;
  assert.ok(b > a);
});

test("лучше TSFC — больше дальность", () => {
  const a = rangeForFuel(aero(35.8), engine, DEFAULT_ASSUMPTIONS, 70000, 14000).rangeNm;
  const b = rangeForFuel(aero(35.8), { tsfcCruise: 1.4e-5 }, DEFAULT_ASSUMPTIONS, 70000, 14000).rangeNm;
  assert.ok(b > a);
});

test("больший размах — выше L/D max", () => {
  assert.ok(maxLiftToDrag(aero(35.8)) > maxLiftToDrag(aero(34.1)));
});

test("резервы положительны и разумны для A320", () => {
  const r = rangeForFuel(aero(35.8), engine, DEFAULT_ASSUMPTIONS, 73500, 15000).reserves;
  assert.ok(r.totalKg > 1500 && r.totalKg < 4000, `резервы ${r.totalKg} кг`);
});

// Критерий фазы 1 — 5%. Пороги ниже — защита от регрессий на текущем уровне точности.
for (const [key, limitPct] of [["ceo_sharklet", 1.5], ["neo", 4]] as const) {
  test(`калибровка ${key}: каждый угол в пределах ${limitPct}%`, () => {
    const ac: AircraftData = data.aircraft[key];
    const cal = calibrateTsfc(ac, aero(ac.spanM), DEFAULT_ASSUMPTIONS, data.fuelDensityKgPerL);
    assert.ok(maxAbsErrorPct(cal.rows) <= limitPct, `макс. ошибка ${maxAbsErrorPct(cal.rows).toFixed(2)}%`);
  });
}

test("ступенчатый набор: лёгкий самолёт идёт выше и летит дальше, чем на постоянном FL350", async () => {
  const { simulateTrip, bestFlightLevel } = await import("../src/mission.ts");
  const a = aero(35.8);
  assert.ok(bestFlightLevel(a, DEFAULT_ASSUMPTIONS, 78000) < bestFlightLevel(a, DEFAULT_ASSUMPTIONS, 55000));
  const fixed = { ...DEFAULT_ASSUMPTIONS, cruiseAltitudeMode: "fixed" as const };
  const dStep = simulateTrip(a, engine, DEFAULT_ASSUMPTIONS, 62000, 18000).distanceM;
  const dFixed = simulateTrip(a, engine, fixed, 62000, 18000).distanceM;
  assert.ok(dStep > dFixed, `step ${dStep} vs fixed ${dFixed}`);
});
