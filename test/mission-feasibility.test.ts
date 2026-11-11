import assert from "node:assert/strict";
import { test } from "node:test";
import { A320CEO } from "../src/aircraft/a320.ts";
import { A320_CONTEXT } from "../src/aircraft/a320Context.ts";
import { evaluate } from "../src/evaluate.ts";
import { DEFAULT_ASSUMPTIONS, rangeForFuel, solveMissionFuel } from "../src/mission.ts";

const mission = (distanceNm: number, seats?: number) =>
  evaluate(A320CEO, [], A320_CONTEXT, { distanceNm, massPerPaxKg: 95, ...(seats === undefined ? {} : { seats }) });

test("обычный рейс: есть дальность, резервы и удельный расход", () => {
  const r = mission(810);
  assert.equal(r.missionResult.feasible, true);
  assert.ok(Math.abs(r.missionResult.rangeNm - 810) < 0.0001);
  assert.equal(r.missionResult.reserveShortfallKg, 0);
  assert.ok(r.missionFuelKg > 0);
  assert.ok(Number.isFinite(r.fuelPerSeatPer100KmKg) && r.fuelPerSeatPer100KmKg > 0);
  assert.ok(r.missionFuelKg + r.oewKg + r.payloadKg <= A320CEO.weights.mtowKg + 0.001);
  assert.equal(r.constraints.find((x) => x.id === "mission-distance"), undefined);
});

test("короткий рейс соблюдает дистанцию", () => {
  const r = mission(50);
  assert.equal(r.missionResult.feasible, true);
  assert.ok(Math.abs(r.missionResult.rangeNm - 50) < 0.0001);
  assert.ok(r.missionFuelKg > 0);
  assert.ok(Number.isFinite(r.fuelPerSeatPer100KmKg));
});


test("решатель не устанавливает искусственную нижнюю границу в 1000 кг", () => {
  const aero = { wingAreaM2: 122.4, spanM: 34.1, cd0: 0.019, oswald: 0.78 };
  const engine = { tsfcCruise: A320_CONTEXT.tsfcCruise, takeoffThrustN: 240200 };
  // Синтетическая миссия без резервов, набора и снижения: изолирует ошибку нижней границы.
  const as = { ...DEFAULT_ASSUMPTIONS, cruiseAltitudeMode: "fixed" as const, cruiseFL: 0,
    alternateFL: 0, alternateDistanceNm: 0, contingencyFraction: 0, finalReserveMin: 0,
    takeoffFuelKg: 0, climbDistanceKm: 0, descentFuelKg: 0, descentDistanceKm: 0 };
  const { takeoffFuelKg, result } = solveMissionFuel(aero, engine, as, 58000, 10000, 50);
  assert.equal(result.feasible, true);
  assert.ok(takeoffFuelKg < 1000, `Ожидался расход < 1000 кг, получено ${takeoffFuelKg}`);
  assert.ok(Math.abs(result.rangeNm - 50) < 0.0001);
});

test("недостижимая дистанция: топливо ограничено MTOW/баками, удельный расход не публикуется", () => {
  const r = mission(25000);
  const fuelCap = A320CEO.systems.fuelVolumeL * A320_CONTEXT.fuelDensityKgL - DEFAULT_ASSUMPTIONS.taxiFuelKg;
  const fuelLimit = Math.min(fuelCap, A320CEO.weights.mtowKg - r.oewKg - r.payloadKg);
  assert.equal(r.missionResult.feasible, false);
  assert.ok(Number.isNaN(r.fuelPerSeatPer100KmKg));
  assert.ok(r.missionResult.distanceShortfallNm! > 0);
  assert.ok(r.missionResult.rangeNm < 25000);
  assert.ok(Math.abs(r.missionFuelKg - fuelLimit) < 0.01);
  assert.ok(r.missionFuelKg + r.oewKg + r.payloadKg <= A320CEO.weights.mtowKg + 0.001);
  assert.equal(r.constraints.find((x) => x.id === "mission-distance")?.status, "violation");
});

test("если рейсовая дистанция меньше возможной, но нет резервов, статус всё равно отрицательный", () => {
  const aero = { wingAreaM2: 122.4, spanM: 34.1, cd0: 0.019, oswald: 0.78 };
  const engine = { tsfcCruise: A320_CONTEXT.tsfcCruise, takeoffThrustN: 240200 };
  const as = { ...DEFAULT_ASSUMPTIONS, contingencyFraction: 2 };
  const r = solveMissionFuel(aero, engine, as, 58300, 15000, 500).result;
  assert.equal(r.feasible, false);
  assert.ok(r.reserveShortfallKg > 0);
});

test("нет пассажиров: знаменатель не превращается в Infinity или NaN", () => {
  const r = mission(810, 0);
  assert.equal(r.seatsCarried, 0);
  assert.ok(Number.isNaN(r.fuelPerSeatPer100KmKg));
  assert.equal(r.constraints.find((x) => x.id === "mission-no-passengers")?.status, "warning");
});

test("rangeForFuel сохраняет прежнюю семантику: без целевой дистанции feasible — это резервы", () => {
  const aero = { wingAreaM2: 122.4, spanM: 34.1, cd0: 0.019, oswald: 0.78 };
  const engine = { tsfcCruise: A320_CONTEXT.tsfcCruise, takeoffThrustN: 240200 };
  const as = DEFAULT_ASSUMPTIONS;
  const r = rangeForFuel(aero, engine, as, 65000, 8000);
  assert.equal(r.requestedRangeNm, undefined);
  assert.equal(r.distanceShortfallNm, undefined);
  assert.equal(r.feasible, r.reserveShortfallKg <= 0.5);
  assert.ok(r.rangeNm > 0);
});

test("некорректный запрос не приводит к делению на ноль", () => {
  assert.throws(() => mission(0), RangeError);
  assert.throws(() => mission(-1), RangeError);
  assert.throws(() => mission(100, -1), RangeError);
});
