import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AIRCRAFT, aircraftForType, variantsFor } from "../web/aircraftCatalog.ts";
import { TU214_PS90A, TU214_FACTORY, TU214_ASSUMPTIONS, TU214_REFERENCE } from "../src/aircraft/tu214.ts";
import { A320CEO } from "../src/aircraft/a320.ts";
import { contextFor } from "../src/aircraft/contextFor.ts";
import { comparisonAssumptionsFor } from "../src/aircraft/missionProfiles.ts";
import { evaluate, DEFAULT_MISSION } from "../src/evaluate.ts";
import { defaults, leversFor, scenarioFamily } from "../web/controls.ts";
import { useShapes } from "../web/scene/shapeSet.ts";

const shape = JSON.parse(readFileSync(new URL("../data/ac/tu214-shapes.json", import.meta.url), "utf8"));
const close = (a: number, b: number, eps = 1e-8) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

test("Ту-214: собственный геометрический набор и точные габаритные ограничения", () => {
  assert.equal(TU214_PS90A.shapeSet, "tu214");
  assert.equal(shape.source.includes("Tu-204-200"), true);
  close(shape.baseLengthM, 45.22);
  close(TU214_REFERENCE.lengthOverallM, 46.14);
  close(TU214_PS90A.wing.spanM, 41.84);
  close(TU214_PS90A.wing.areaM2, 184.17);
  close(TU214_REFERENCE.wingAreaDesignM2, 168.63);
  close(shape.wing.tip_z * 2, 41.84);
  close(shape.htail.tip_z * 2, 15.018);
  close(TU214_PS90A.fuselage.widthM, shape.halfWidth * 2);
  close(TU214_PS90A.fuselage.heightM, shape.halfHeight * 2);
  close(shape.gear.wheelbaseM, 13.97);
  close(shape.gear.mainZ * 2, 7.82);
  assert.equal(useShapes(TU214_PS90A).id, "tu214");
  assert.equal(useShapes(A320CEO).id, "a320");
  close(shape.vtail.table.te.at(-1), TU214_REFERENCE.lengthOverallM, 0.002);
  assert.equal(shape.fuselage.x.length, shape.fuselage.top.length);
  assert.equal(shape.fuselage.x.length, shape.fuselage.bottom.length);
  assert.equal(shape.fuselage.x.length, shape.fuselage.half_width.length);
  for (let i = 0; i < shape.fuselage.x.length; i++) {
    if (i) assert.ok(shape.fuselage.x[i] > shape.fuselage.x[i - 1]);
    assert.ok(shape.fuselage.top[i] >= shape.fuselage.bottom[i]);
    assert.ok(shape.fuselage.half_width[i] >= 0);
  }
  for (let i = 0; i < shape.vtail.table.y.length; i++)
    assert.ok(shape.vtail.table.te[i] > shape.vtail.table.le[i], `fin chord ${i}`);
  assert.ok(shape.features.every((f: { x0: number; x1: number }) => f.x0 >= 0 && f.x1 <= 45.22));
});

test("Ту-214: данные производителя ПС-90А не смешивают сухую и поставочную массу", () => {
  const e = TU214_PS90A.engine;
  assert.equal(e.name, "ПС-90А");
  assert.equal(e.count, 2);
  assert.equal(e.dryMassKg, 2950);
  assert.equal(e.fanDiameterM, 1.9);
  assert.equal(e.bypassRatio, 4.4);
  assert.equal(e.cycle.gearbox, false);
  assert.equal(e.architecture.spools, 2);
  close(e.takeoffThrustKn, 16000 * 9.80665 / 1000);
  assert.notEqual(e.cycle.t4K, 1640, "1640 K is published maximum, not a verified cruise T4");
});

test("Ту-214: селектор и профиль независимы от Boeing и FCOM A320", () => {
  assert.deepEqual(variantsFor("tu214"), ["tu214-ps90a", "tu214-ps90a-factory"]);
  assert.equal(aircraftForType("tu214", "a320ceo"), "tu214-ps90a");
  assert.equal(AIRCRAFT["tu214-ps90a"], TU214_PS90A);
  assert.equal(AIRCRAFT["tu214-ps90a-factory"], TU214_FACTORY);
  assert.equal(comparisonAssumptionsFor(TU214_FACTORY).cruiseMach, TU214_ASSUMPTIONS.cruiseMach);
  assert.equal(scenarioFamily(TU214_PS90A.id), "tu214");
  assert.deepEqual(leversFor(TU214_PS90A, defaults(TU214_PS90A)), []);
  const a = comparisonAssumptionsFor(TU214_PS90A);
  assert.equal(a.cruiseMach, TU214_ASSUMPTIONS.cruiseMach);
  assert.equal(a.fcomClimb, undefined);
  assert.equal(a.fcomDescent, undefined);
  assert.equal(a.fcomHolding, undefined);
  assert.equal(a.lrcTable, undefined);
});

test("Ту-214: расчётная масса, сертификационные пределы и баланс миссии", () => {
  const d = TU214_PS90A;
  const ev = evaluate(d, [], contextFor(d));
  assert.ok(Number.isFinite(ev.oewKg) && ev.oewKg > 48000 && ev.oewKg < 75000);
  assert.equal(ev.maxPayloadKg, 22370);
  assert.equal(d.weights.mtowKg, 110750);
  assert.equal(d.weights.mlwKg, 93000);
  assert.equal(d.weights.mzfwKg, 84200);
  close(d.systems.fuelVolumeL * contextFor(d).fuelDensityKgL, 35710, 1);
  assert.equal(ev.missionResult.feasible, true);
  assert.ok(ev.missionFuelKg > 0 && ev.tripFuelKg > 0);
  close(contextFor(d).constraintsRef.nacelleClearanceM, 0.79);
  assert.ok(ev.missionFuelKg + ev.payloadKg + ev.oewKg <= d.weights.mtowKg + 0.02);
  assert.ok(ev.seatsCarried <= d.systems.seats);
  assert.ok(ev.missionResult.rangeNm >= DEFAULT_MISSION.distanceNm - 1e-3);
  assert.ok(ev.missionAssumptions.fcomClimb === undefined);
});

test("Универсальный предел коммерческой нагрузки не меняет A320 и ограничивает Ту-214", () => {
  const ctx = contextFor(TU214_PS90A);
  const ev = evaluate(TU214_PS90A, [], ctx, { distanceNm: 810, massPerPaxKg: 145, seats: 210 });
  assert.equal(ev.maxPayloadKg, 22370);
  assert.ok(ev.payloadKg <= 22370);
  assert.ok(ev.payloadLimitedByMzfw);
  assert.ok(ev.payloadRange.every((x) => x.payloadKg <= 25200));
  assert.equal(evaluate(A320CEO, [], contextFor(A320CEO)).maxPayloadKg > 0, true);
  assert.equal(A320CEO.weights.maxPayloadKg, undefined);
});

test("Регрессия: добавление Ту-214 не меняет баланс принятого A320ceo", () => {
  const ref = evaluate(A320CEO, [], contextFor(A320CEO));
  close(ref.missionFuelKg, 7590.241986107547, 0.05);
  close(ref.tripFuelKg, 4671.468884923102, 0.05);
  assert.equal(ref.missionResult.feasible, true);
});
