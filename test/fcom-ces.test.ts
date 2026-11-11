import assert from "node:assert/strict";
import { test } from "node:test";
import phases from "../data/fcom/a320-214-ces-phases.json" with { type: "json" };
import cruise from "../data/fcom/a320-214-ces-cruise-checks.json" with { type: "json" };
import { lookupClimb, lookupDescent, lookupHolding } from "../src/phaseTables.ts";

test("CES A320: все 413 исходных узлов читаются без потери полей и смены применимости", () => {
  assert.deepEqual([phases.climb.rows.length, phases.holding.rows.length, phases.descent.rows.length], [241, 136, 36]);
  assert.equal(phases.applicability.aircraftModel, "A320-214");
  assert.equal(phases.applicability.engineModel, "CFM56-5B4/P");
  assert.equal(phases.applicability.wingtip, "fence");
  for (const r of phases.climb.rows) {
    const p = lookupClimb(phases, r.massKg, r.fl, r.isaDeviationC);
    assert.ok(p);
    for (const key of ["timeMin", "fuelKg", "distanceNm", "tasKt"] as const) assert.equal(p[key], r[key]);
  }
  for (const r of phases.descent.rows) {
    const p = lookupDescent(phases, r.massKg, r.fl);
    assert.ok(p);
    for (const key of ["timeMin", "fuelKg", "distanceNm", "n1Pct"] as const) assert.equal(p[key], r[key]);
  }
  for (const r of phases.holding.rows) {
    const p = lookupHolding(phases, r.massKg, r.fl);
    assert.ok(p);
    assert.equal(p.n1Pct, r.n1Pct);
    assert.equal(p.fuelFlowPerEngineKgH, r.fuelFlowPerEngineKgH);
  }
});

test("CES climb: контроль PDF1637/1644, взлёт внутри накопленного топлива и 11 пустых ячеек", () => {
  const at350 = lookupClimb(phases, 60000, 350, 0)!;
  assert.deepEqual([at350.timeMin, at350.fuelKg, at350.distanceNm, at350.tasKt], [18, 1417, 114, 376]);
  const initial = lookupClimb(phases, 60000, 15, 0)!;
  assert.deepEqual([initial.timeMin, initial.fuelKg, initial.distanceNm, initial.tasKt], [2, 163, 3, 121]);
  assert.equal(at350.fuelKg - initial.fuelKg, 1254);
  assert.equal(lookupClimb(phases, 59000, 350, 0)!.fuelKg, 1384);
  assert.equal(lookupClimb(phases, 60000, 350, 10), undefined);
  assert.equal(lookupClimb(phases, 51000, 350, 0), undefined);
  for (let mass = 66000; mass <= 78000; mass += 2000) assert.equal(lookupClimb(phases, mass, 390, 0), undefined);
  for (let mass = 72000; mass <= 78000; mass += 2000) assert.equal(lookupClimb(phases, mass, 370, 0), undefined);
  assert.equal(lookupClimb(phases, 70000, 380, 0), undefined);
  assert.equal(lookupClimb(phases, 62000, 270, 0)!.distanceNm, 71);
  assert.equal(lookupClimb(phases, 70000, 160, 0)!.distanceNm, 34);
});

test("CES descent: не приписана временная привязка WEIGHT, численный N1 не заменён IDLE", () => {
  assert.equal(phases.descent.massReferenceTiming, "unspecified-by-source");
  const low = lookupDescent(phases, 45000, 350)!;
  assert.deepEqual([low.timeMin, low.fuelKg, low.distanceNm, low.n1Pct], [12.9, 134, 77, 72.1]);
  const high = lookupDescent(phases, 65000, 350)!;
  assert.deepEqual([high.timeMin, high.fuelKg, high.distanceNm, high.n1Pct], [16, 156, 95, null]);
  assert.equal(lookupDescent(phases, 45000, 390)!.n1Pct, 68.8);
  assert.equal(lookupDescent(phases, 60000, 350)!.n1Pct, undefined);
  assert.equal(lookupDescent(phases, 60000, 350)!.fuelKg, 150.5);
  const end = lookupDescent(phases, 60000, 15)!;
  assert.deepEqual([end.timeMin, end.fuelKg, end.distanceNm], [0, 0, 0]);
  assert.equal(phases.groundAndTerminalFuel.approachAndLanding.ifrFuelKg, 120);
  assert.equal(phases.groundAndTerminalFuel.approachAndLanding.vfrFuelKg, 80);
  assert.equal(phases.groundAndTerminalFuel.goAround.fuelKg, 100);
});

test("CES holding: PDF1826 даёт расход одного двигателя в race-track, поправка straight-line отдельная", () => {
  const point = lookupHolding(phases, 60000, 15)!;
  assert.deepEqual([point.n1Pct, point.fuelFlowPerEngineKgH], [51.5, 1128]);
  assert.equal(phases.holding.engineCount, 2);
  assert.equal(point.fuelFlowPerEngineKgH * phases.holding.engineCount, 2256);
  assert.equal(point.fuelFlowPerEngineKgH * phases.holding.engineCount * 30 / 60, 1128);
  assert.equal(phases.holding.conditions.pattern, "RACE TRACK");
  assert.equal(phases.holding.correctionsFuelFlowPct.straightLine, -5);
  assert.equal(lookupHolding(phases, 66000, 250)!.n1Pct, 72.9);
  assert.equal(lookupHolding(phases, 72000, 220)!.n1Pct, 72.5);
  assert.equal(lookupHolding(phases, 76000, 200)!.n1Pct, 72.3);
});

test("CES cruise: 18 независимых узлов M.78/LRC, FF на двигатель и согласованный specific range", () => {
  assert.equal(cruise.checks.length, 18);
  assert.equal(cruise.applicability.aircraftModel, phases.applicability.aircraftModel);
  assert.equal(cruise.applicability.engineModel, phases.applicability.engineModel);
  assert.equal(cruise.conditions.cgPercentMac, 33);
  assert.equal(cruise.conditions.airConditioning, "NORMAL");
  for (const regime of ["fixedMach", "lrc"]) assert.equal(cruise.checks.filter(r => r.regime === regime).length, 9);
  assert.ok(cruise.checks.filter(r => r.regime === "fixedMach").every(r => r.mach === 0.78 && r.pdfPage === 1707));
  for (const r of cruise.checks) {
    assert.equal(r.isaDeviationC, 0);
    const derivedSpecificRange = r.tasKt / (cruise.applicability.engineCount * r.fuelFlowPerEngineKgH) * 1000;
    assert.ok(Math.abs(derivedSpecificRange / r.specificRangeNmPer1000Kg - 1) < 0.002,
      `${r.regime} ${r.massKg} kg FL${r.fl}: ошибка единиц FF/SR или транскрипции`);
  }
  const point = (regime: string, massKg: number, fl: number) => cruise.checks.find(r => r.regime === regime && r.massKg === massKg && r.fl === fl)!;
  const fixed = point("fixedMach", 60000, 350);
  assert.deepEqual([fixed.mach, fixed.fuelFlowPerEngineKgH, fixed.tasKt, fixed.specificRangeNmPer1000Kg], [0.78, 1135, 450, 198.1]);
  const lrc = point("lrc", 60000, 350);
  assert.deepEqual([lrc.mach, lrc.fuelFlowPerEngineKgH, lrc.tasKt, lrc.specificRangeNmPer1000Kg], [0.771, 1116, 444, 199]);
  assert.equal(point("lrc", 50000, 290).mach, 0.662);
  assert.equal(point("lrc", 60000, 390).mach, 0.788);
  assert.equal(point("lrc", 78000, 350).mach, 0.782);
});
