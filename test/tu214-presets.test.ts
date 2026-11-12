import { test } from "node:test";
import assert from "node:assert/strict";
import { TU214_PS90A, TU214_FACTORY, TU214_REFERENCE, TU214_FUEL_DENSITY_KG_L, TU214_UNADJUSTED_OEW_REFERENCE_KG } from "../src/aircraft/tu214.ts";
import { contextFor } from "../src/aircraft/contextFor.ts";
import { comparisonAssumptionsFor } from "../src/aircraft/missionProfiles.ts";
import { evaluate } from "../src/evaluate.ts";
import { compositeWing } from "../src/levers.ts";
import { A320CEO } from "../src/aircraft/a320.ts";

const approx = (actual: number, expected: number, tolerance = 0.001) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} vs ${expected}`);
const reference = (d: typeof TU214_PS90A) => evaluate(d, [], contextFor(d));

test("Ту-214: оба весовых пресета имеют согласованные OEW, MZFW и коммерческую нагрузку", () => {
  for (const [d, oew, payload] of [
    [TU214_FACTORY, 59000, 25200],
    [TU214_PS90A, 61830, 22370],
  ] as const) {
    const r = reference(d);
    approx(r.oewKg, oew);
    approx(r.maxPayloadKg, payload);
    approx(r.oewKg + r.maxPayloadKg, 84200);
    assert.equal(d.weights.mzfwKg, 84200);
    assert.equal(d.weights.mlwKg, 93000);
    assert.equal(d.weights.mtowKg, 110750);
    assert.equal(d.engine.name, "ПС-90А");
    assert.equal(r.missionAssumptions.cruiseMach, 0.78);
    approx(contextFor(d).fuelDensityKgL, TU214_FUEL_DENSITY_KG_L);
    approx(d.systems.fuelVolumeL * contextFor(d).fuelDensityKgL, 35710, 0.05);
  }
});

test("Ту-214: разница комплектаций показана в дереве масс отдельно, не выдаётся за массу крыла", () => {
  const f = reference(TU214_FACTORY);
  const o = reference(TU214_PS90A);
  approx(o.oewKg - f.oewKg, 2830);
  approx(f.masses.byId.get("oewReconciliation")!.kg, TU214_REFERENCE.factoryOewKg - TU214_UNADJUSTED_OEW_REFERENCE_KG);
  approx(f.masses.byId.get("additionalEquipment")!.kg, 0);
  approx(o.masses.byId.get("additionalEquipment")!.kg, 2830);
  approx(f.masses.byId.get("wing.box")!.kg, o.masses.byId.get("wing.box")!.kg);
  for (const r of [o, f]) approx(r.masses.roots.reduce((a, n) => a + n.kg, 0), r.oewKg);
});

test("Ту-214: 210 пассажиров и дополнительный груз учитываются до MZFW, первыми размещаются пассажиры", () => {
  const mission = { distanceNm: 810, massPerPaxKg: 95, seats: 210, cargoKg: 3000 };
  const op = evaluate(TU214_PS90A, [], contextFor(TU214_PS90A), mission);
  const factory = evaluate(TU214_FACTORY, [], contextFor(TU214_FACTORY), mission);
  assert.equal(op.seatsCarried, 210);
  assert.equal(factory.seatsCarried, 210);
  approx(op.payloadRequestedKg, 22950);
  approx(op.payloadKg, 22370);
  approx(op.cargoCarriedKg, 2420);
  assert.equal(op.payloadLimitedByMzfw, true);
  approx(factory.payloadKg, 22950);
  approx(factory.cargoCarriedKg, 3000);
  assert.equal(factory.payloadLimitedByMzfw, false);
  approx(TU214_PS90A.weights.mtowKg - op.oewKg - op.payloadKg, 26550);
  approx(TU214_FACTORY.weights.mtowKg - factory.oewKg - factory.maxPayloadKg, 26550);
  assert.ok(op.missionFuelKg <= 26550);
});

test("Ту-214: 210 пассажиров по 95 кг без груза оставляют 28,97 т топлива в эксплуатационном варианте", () => {
  const op = evaluate(TU214_PS90A, [], contextFor(TU214_PS90A), { distanceNm: 810, massPerPaxKg: 95, seats: 210 });
  approx(op.payloadKg, 19950);
  approx(op.cargoCarriedKg, 0);
  approx(TU214_PS90A.weights.mtowKg - op.oewKg - op.payloadKg, 28970);
});

test("Ту-214: при максимальной коммерческой нагрузке ZFW и дальность обоих пресетов одинаковы", () => {
  const o = reference(TU214_PS90A);
  const f = reference(TU214_FACTORY);
  approx(o.payloadRange[1].payloadKg + o.oewKg, f.payloadRange[1].payloadKg + f.oewKg);
  approx(o.payloadRange[1].rangeNm, f.payloadRange[1].rangeNm, 1e-5);
});

test("Ту-214: облегчение крыла меняет OEW, не переустанавливая автоматически заводскую опору", () => {
  const d = TU214_PS90A;
  const base = reference(d);
  const altered = evaluate(d, [compositeWing(20)], contextFor(d));
  assert.ok(altered.oewKg < base.oewKg);
  approx(altered.masses.byId.get("oewReconciliation")!.kg, base.masses.byId.get("oewReconciliation")!.kg);
  approx(altered.masses.byId.get("additionalEquipment")!.kg, base.masses.byId.get("additionalEquipment")!.kg);
});

test("Новые статьи массы и дополнительный груз не меняют стандартный расчёт A320", () => {
  const a = evaluate(A320CEO, [], contextFor(A320CEO));
  approx(a.missionFuelKg, 7590.241986107547, 0.05);
  approx(a.masses.byId.get("oewReconciliation")!.kg, 0);
  approx(a.masses.byId.get("additionalEquipment")!.kg, 0);
  approx(a.payloadRequestedKg, a.payloadKg);
});

test("Дополнительный груз нельзя задавать отрицательным или NaN", () => {
  const d = TU214_FACTORY;
  assert.throws(() => evaluate(d, [], contextFor(d), { distanceNm: 810, massPerPaxKg: 95, cargoKg: -5 }), RangeError);
  assert.throws(() => evaluate(d, [], contextFor(d), { distanceNm: 810, massPerPaxKg: 95, cargoKg: Number.NaN }), RangeError);
});
