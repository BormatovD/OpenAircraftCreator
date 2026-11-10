import assert from "node:assert/strict";
import { test } from "node:test";
import classicLrc from "../data/fcom/b737-300-lrc.json" with { type: "json" };
import { type AeroConfig, aeroAtFl, clForWeight, liftToDrag } from "../src/aero.ts";
import { A320CEO } from "../src/aircraft/a320.ts";
import { A320_CONTEXT as ctx } from "../src/aircraft/a320Context.ts";
import { B737_300, B737_ASSUMPTIONS } from "../src/aircraft/b737.ts";
import { B737_8, B737_8_ASSUMPTIONS } from "../src/aircraft/b737max.ts";
import { B757_ASSUMPTIONS, B757_RB211 } from "../src/aircraft/b757.ts";
import { contextFor } from "../src/aircraft/contextFor.ts";
import { G0, flightLevelToM, isa } from "../src/atmosphere.ts";
import { interpolateLrcMach } from "../src/cruise.ts";
import { aeroFor, assumptionsFor, engineStateFor, evaluate } from "../src/evaluate.ts";
import { cruiseMach } from "../src/levers.ts";
import {
  DEFAULT_ASSUMPTIONS, type MissionAssumptions, type TripResult, cruiseMachAt, rangeForFuel,
  reserves, selectFlightLevel, simulateTrip, tsfcAtMach,
} from "../src/mission.ts";

const a320Aero = aeroFor(A320CEO, ctx.aero, []);
const plainAero: AeroConfig = { wingAreaM2: 122.4, spanM: 35.8, cd0: 0.019, oswald: 0.78 };
const plainEngine = { tsfcCruise: ctx.tsfcCruise };
const cases = [
  { def: A320CEO, as: DEFAULT_ASSUMPTIONS, mass: 70000, fuel: 12000 },
  { def: B737_8, as: B737_8_ASSUMPTIONS, mass: 60000, fuel: 8000 },
  { def: B737_300, as: B737_ASSUMPTIONS, mass: 50000, fuel: 8000 },
  { def: B757_RB211, as: B757_ASSUMPTIONS, mass: 100000, fuel: 20000 },
];

const near = (a: number, b: number, tolerance = 1e-6) => assert.ok(Math.abs(a - b) <= tolerance, `${a} вместо ${b}`);
function checkTripBudget(trip: TripResult, mass: number, fuel: number): void {
  const phases = [trip.takeoffFuelKg, trip.climbFuelKg, trip.cruiseFuelKg, trip.stepClimbFuelKg, trip.descentFuelKg];
  for (const v of phases) assert.ok(Number.isFinite(v) && v >= 0, `невалидный расход фазы ${v}`);
  near(phases.reduce((a, b) => a + b, 0), fuel);
  near(trip.landingMassKg, mass - fuel);
  assert.ok(trip.landingMassKg <= mass && trip.landingMassKg > 0);
}

test("737 Classic: все 71 узла новой таблицы участвуют в профиле LRC", () => {
  let n = 0;
  for (const [mass, row] of Object.entries(classicLrc.rows)) row.forEach((cell, i) => {
    const fl = classicLrc.altitudesFt[i] / 100;
    assert.equal(interpolateLrcMach(classicLrc, +mass * 1000, fl), cell[1]);
    assert.deepEqual(cruiseMachAt(B737_ASSUMPTIONS, +mass * 1000, fl), { mach: cell[1], fallback: false });
    n++;
  });
  assert.equal(n, 71);
  assert.equal(interpolateLrcMach(classicLrc, 62000, 370), undefined);
});

test("LRC MAX и Classic: на одном эшелоне Мах меняется с выработкой топлива", () => {
  for (const c of cases.filter((c) => c.as.cruiseSpeedMode === "lrc")) {
    const as: MissionAssumptions = { ...c.as, cruiseAltitudeMode: "fixed", cruiseFL: c.def === B737_300 ? 310 : 350 };
    const aero = aeroFor(c.def, ctx.aero, []);
    const trip = simulateTrip(aero, engineStateFor(c.def, ctx, [], as), as, c.mass, c.fuel);
    assert.equal(trip.initialFL, as.cruiseFL);
    assert.equal(trip.finalFL, as.cruiseFL);
    assert.equal(trip.lrcFallback, false);
    assert.ok(trip.initialMach - trip.finalMach > 0.01, `${c.def.id}: ${trip.initialMach} → ${trip.finalMach}`);
    assert.ok(trip.minMach <= trip.finalMach && trip.maxMach >= trip.initialMach);
    assert.ok(trip.cruiseSample);
    const sample = trip.cruiseSample;
    assert.equal(sample.mach, interpolateLrcMach(as.lrcTable!, sample.massKg, sample.fl));
  }
});

test("постоянный Мах сохраняется на всём маршруте, включая 757 M0,80", () => {
  for (const c of cases) {
    const as: MissionAssumptions = { ...c.as, cruiseSpeedMode: "fixedMach" };
    const trip = simulateTrip(aeroFor(c.def, ctx.aero, []), engineStateFor(c.def, ctx, [], as), as, c.mass, c.fuel);
    for (const m of [trip.initialMach, trip.finalMach, trip.minMach, trip.maxMach]) assert.equal(m, as.cruiseMach);
    assert.equal(trip.lrcFallback, false);
  }
  assert.equal(B757_ASSUMPTIONS.cruiseSpeedMode, "fixedMach");
  assert.equal(B757_ASSUMPTIONS.cruiseMach, 0.8);
  assert.equal(B757_ASSUMPTIONS.lrcTable, undefined);
  assert.deepEqual(B757_ASSUMPTIONS.stepFLs, [350, 390]);
});

test("при LRC расход остаётся модельным: TSFC меняет дальность, табличный FF её не меняет", () => {
  for (const c of cases.filter((c) => c.as.cruiseSpeedMode === "lrc")) {
    const as: MissionAssumptions = { ...c.as, cruiseAltitudeMode: "fixed", cruiseFL: 350 };
    const aero = aeroFor(c.def, ctx.aero, []);
    const engine = engineStateFor(c.def, ctx, [], as);
    const trip = simulateTrip(aero, engine, as, c.mass, c.fuel);
    const worse = simulateTrip(aero, { ...engine, tsfcCruise: engine.tsfcCruise * 1.1 }, as, c.mass, c.fuel);
    assert.ok(worse.distanceM < trip.distanceM * 0.95, `${c.def.id}: ухудшение TSFC не снижает дальность`);
    const otherFlow = structuredClone(as.lrcTable!);
    for (const row of Object.values(otherFlow.rows)) for (const cell of row) cell[3] *= 10;
    assert.deepEqual(simulateTrip(aero, engine, { ...as, lrcTable: otherFlow }, c.mass, c.fuel), trip);
  }
});

test("топливо фаз, посадочная масса и резервы замыкаются у A320, обоих 737 и 757", () => {
  for (const c of cases) {
    const aero = aeroFor(c.def, ctx.aero, []);
    const engine = engineStateFor(c.def, ctx, [], c.as);
    const trip = simulateTrip(aero, engine, c.as, c.mass, c.fuel);
    checkTripBudget(trip, c.mass, c.fuel);
    const mission = rangeForFuel(aero, engine, c.as, c.mass, c.fuel);
    checkTripBudget(mission.trip, c.mass, mission.tripFuelKg);
    assert.equal(mission.feasible, true);
    assert.equal(mission.reserveShortfallKg, 0);
    near(mission.tripFuelKg + mission.reserves.totalKg, c.fuel, 0.5);
    near(mission.reserves.totalKg, mission.reserves.contingencyKg + mission.reserves.alternateKg + mission.reserves.finalKg);
  }
  const trip = simulateTrip(plainAero, plainEngine, DEFAULT_ASSUMPTIONS, 70000, 12000);
  checkTripBudget(trip, 70000, 12000);
  assert.ok(trip.stepClimbFuelKg > 0, "проверка должна включать оплаченную ступень");
});

test("нулевой и малый запас топлива не создаёт отрицательные фазы или рост массы", () => {
  for (const fuel of [0, 1, 100, 1000, 2000]) {
    checkTripBudget(simulateTrip(plainAero, plainEngine, DEFAULT_ASSUMPTIONS, 70000, fuel), 70000, fuel);
    const mission = rangeForFuel(plainAero, plainEngine, DEFAULT_ASSUMPTIONS, 70000, fuel);
    assert.equal(mission.feasible, false);
    assert.ok(mission.reserveShortfallKg > 0);
    assert.equal(mission.tripFuelKg, 0);
    assert.equal(mission.rangeNm, 0);
    assert.equal(mission.trip.landingMassKg, 70000);
    assert.ok(mission.reserves.contingencyKg >= 0);
    checkTripBudget(mission.trip, 70000, 0);
  }
});

test("ступень FL290→390 не выполняется за оставшийся 1 кг топлива", () => {
  const atm = isa(flightLevelToM(390));
  const clMax = clForWeight(a320Aero, 69000 * G0, atm.densityKgM3, 0.78 * atm.speedOfSoundMs);
  const as: MissionAssumptions = { ...DEFAULT_ASSUMPTIONS, stepFLs: [290, 390], cruiseClMax: clMax };
  const full = simulateTrip(a320Aero, plainEngine, as, 70000, 10000);
  assert.equal(full.initialFL, 290);
  assert.equal(full.finalFL, 390);
  assert.ok(full.stepClimbFuelKg > 1);
  const fuel = as.takeoffFuelKg + full.climbFuelKg + as.descentFuelKg + 1;
  const short = simulateTrip(a320Aero, plainEngine, as, 70000, fuel);
  assert.equal(short.initialFL, 290);
  assert.equal(short.finalFL, 290);
  assert.equal(short.stepClimbFuelKg, 0);
  near(short.cruiseFuelKg, 1);
  checkTripBudget(short, 70000, fuel);
});

test("нижний эшелон при недостатке тяги помечается ограниченным, в том числе при нулевой тяге", () => {
  for (const takeoffThrustN of [0, 1]) {
    const engine = { ...plainEngine, takeoffThrustN };
    const selected = selectFlightLevel(plainAero, DEFAULT_ASSUMPTIONS, 70000, engine);
    assert.equal(selected.fl, Math.min(...DEFAULT_ASSUMPTIONS.stepFLs));
    assert.equal(selected.limited, true);
    assert.equal(simulateTrip(plainAero, engine, DEFAULT_ASSUMPTIONS, 70000, 10000).flightLevelLimited, true);
  }
});

test("вне области LRC fallback явный, а отсутствующий верхний эшелон не используется", () => {
  assert.deepEqual(cruiseMachAt(B737_8_ASSUMPTIONS, 80000, 390), { mach: 0.78, fallback: true });
  assert.deepEqual(cruiseMachAt(B737_ASSUMPTIONS, 63000, 350), { mach: 0.745, fallback: true });
  const as = { ...B737_8_ASSUMPTIONS, cruiseClMax: 10 };
  const selected = selectFlightLevel(aeroFor(B737_8, ctx.aero, []), as, 80000);
  assert.equal(selected.fl, 350);
  const trip = simulateTrip(aeroFor(B737_8, ctx.aero, []), plainEngine, { ...as, cruiseAltitudeMode: "fixed", cruiseFL: 390 }, 80000, 3000);
  assert.equal(trip.lrcFallback, true);
});

test("contextFor выбирает профиль типа и общие резервы; правила графика остаются отдельными", () => {
  for (const def of [B737_8, B737_300, B757_RB211]) {
    const as = contextFor(def).assumptions!;
    assert.equal(as.contingencyFraction, 0.05);
    assert.equal(as.alternateDistanceNm, 200);
    assert.equal(as.finalReserveMin, 30);
    assert.notEqual(as.finalReserveMode, "cruise");
  }
  assert.equal(contextFor(B737_8).assumptions!.lrcTable, B737_8_ASSUMPTIONS.lrcTable);
  assert.equal(contextFor(B737_8).assumptions!.cruiseSpeedMode, "lrc");
  assert.deepEqual(contextFor(B737_300).assumptions!.stepFLs, [310, 350]);
  assert.equal(contextFor(B757_RB211).assumptions!.cruiseMach, 0.8);
  for (const as of [B737_ASSUMPTIONS, B737_8_ASSUMPTIONS, B757_ASSUMPTIONS]) {
    assert.equal(as.contingencyFraction, 0);
    assert.equal(as.finalReserveMin, 45);
    assert.equal(as.finalReserveMode, "cruise");
  }
  assert.equal(assumptionsFor(contextFor(B737_8), [cruiseMach(0.77)]).cruiseSpeedMode, "fixedMach");
});

test("панель аэродинамики использует ту же точку FL/Mach, что интегратор миссии", () => {
  const e = evaluate(B737_8, [], contextFor(B737_8));
  const sample = e.missionResult.trip.cruiseSample;
  assert.ok(sample);
  assert.equal(e.cruiseDrag.fl, sample.fl);
  assert.equal(e.cruiseDrag.mach, sample.mach);
  const atm = isa(flightLevelToM(sample.fl));
  near(e.cruiseDrag.cl, clForWeight(e.aero, sample.massKg * G0, atm.densityKgM3, sample.mach * atm.speedOfSoundMs));
  near(e.cruiseDrag.parts.reduce((s, p) => s + p.counts, 0), e.cruiseDrag.total);
});

test("финальный крейсерский резерв LRC согласован с независимым интегрированием расхода", () => {
  const as: MissionAssumptions = { ...B737_8_ASSUMPTIONS, alternateDistanceNm: 0 };
  const aero = aeroFor(B737_8, ctx.aero, []);
  const engine = engineStateFor(B737_8, ctx, [], as);
  const r = reserves(aero, engine, as, 8000, 60000);
  const atm = isa(flightLevelToM(as.cruiseFL));
  const aFl = aeroAtFl(aero, as.cruiseFL);
  // Независимый RK4 для dm/dt = -TSFC * D; проверяет изменение скорости и CL по массе.
  const flow = (m: number) => {
    const mach = interpolateLrcMach(as.lrcTable!, m, as.cruiseFL)!;
    const cl = clForWeight(aFl, m * G0, atm.densityKgM3, mach * atm.speedOfSoundMs);
    return -tsfcAtMach(engine, mach) * m * G0 / liftToDrag(aFl, cl, mach);
  };
  const start = 60000 - r.alternateKg;
  let m = start;
  const n = 1000;
  const dt = as.finalReserveMin * 60 / n;
  for (let i = 0; i < n; i++) {
    const k1 = flow(m);
    const k2 = flow(m + dt * k1 / 2);
    const k3 = flow(m + dt * k2 / 2);
    const k4 = flow(m + dt * k3);
    m += dt * (k1 + 2 * k2 + 2 * k3 + k4) / 6;
  }
  near(r.finalKg, start - m, 0.2);
  assert.equal(r.lrcFallback, false);
});

test("диагностика покрытия таблицы учитывает также перелёт на запасной", () => {
  const as: MissionAssumptions = { ...B737_8_ASSUMPTIONS, alternateFL: 200, finalReserveMode: "hold" };
  const aero = aeroFor(B737_8, ctx.aero, []);
  const engine = engineStateFor(B737_8, ctx, [], as);
  const mission = rangeForFuel(aero, engine, as, 60000, 8000);
  assert.equal(mission.trip.lrcFallback, false);
  assert.equal(mission.reserves.lrcFallback, true);
});
