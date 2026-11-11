import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

type Row = Record<string, number | string | null>;
type Table = { rows: Row[]; source: { pdfPage: number; pageCode: string }; missingCells?: Row[]; altitudesFt?: number[]; massesKg?: number[]; conditions?: Record<string, unknown> };
type Packet = { id: string; model: string; engine: string; sourceWeightUnit: string; lrc: Table; holding: Table; descent: Table; maxClimbEpr: Table; bleedEprAdjustments: Table; apuFuelIncrement: Table & { isPureApuFuelFlow: boolean }; lrcMaximumAltitude: Table };
const data = JSON.parse(readFileSync(new URL("../data/fcom/b757-nordwind-performance.json", import.meta.url), "utf8"));
const packets: Packet[] = data.packets;
const packet = (id: string): Packet => {
  const p = packets.find(p => p.id === id);
  assert.ok(p, id);
  return p;
};
const cell = (table: Table, sourceMass: number, fl: number): Row => {
  const row = table.rows.find(r => r.sourceMassThousands === sourceMass && r.fl === fl);
  assert.ok(row, `${sourceMass}/${fl}`);
  return row;
};

test("757 FCOM retains five source configurations and their actual table extents", () => {
  assert.equal(data._source.revisionDate, "2014-05-15");
  assert.equal(data._source.sha256, "eafcade91517e8e507e31b70552eafd4e0b59ee819259901fe9533ea5b106a86");
  assert.equal(data._source.pdfPageCount, 1702);
  assert.equal(data.scope.rb211DataPresent, false);
  assert.deepEqual(packets.map(p => [p.lrc.rows.length, p.holding.rows.length]), [[78, 59], [67, 59], [67, 59], [57, 58], [57, 58]]);
  let total = 0;
  for (const p of packets) {
    for (const t of [p.lrc, p.holding, p.descent, p.maxClimbEpr, p.bleedEprAdjustments, p.apuFuelIncrement, p.lrcMaximumAltitude]) {
      assert.ok(t.rows.every(r => r.pdfPage === t.source.pdfPage));
      total += t.rows.length;
    }
    for (const t of [p.lrc, p.holding]) {
      const present = new Set(t.rows.map(r => `${r.massKg}/${r.fl}`));
      assert.equal(present.size, t.rows.length);
      assert.ok(t.missingCells!.every(r => !present.has(`${r.massKg}/${r.fl}`)));
      assert.equal(present.size + t.missingCells!.length, t.altitudesFt!.length * t.massesKg!.length);
    }
  }
  assert.equal(total, 1464);
});

test("757 PW2037 pounds are converted once, with FF remaining per engine", () => {
  const p = packet("pi10-pw2037");
  const r = cell(p.lrc, 200, 350);
  assert.equal(r.massKg, 90718.474);
  assert.equal(r.mach, 0.797);
  assert.equal(r.epr, 1.18);
  assert.equal(r.iasKt, 271);
  assert.equal(r.sourceFuelFlowPerEngine, 3556);
  assert.ok(Math.abs(Number(r.fuelFlowPerEngineKgH) - 3556 * 0.45359237) < 1e-8);
  assert.equal(cell(p.lrc, 120, 390).sourceFuelFlowPerEngine, 2559, "retain the printed value, including its discontinuity");
  assert.equal(cell(p.holding, 200, 15).sourceFuelFlowPerEngine, 3650);
  assert.equal(p.holding.conditions!.racetrackFuelAllowanceIncludedPct, 5);
});

test("757 winglets and engine variants retain distinct LRC and holding values", () => {
  const plain = cell(packet("pi20-pw2040").lrc, 100, 350);
  const pw37w = cell(packet("pi40-pw2037-winglets").lrc, 100, 350);
  const pw40w = cell(packet("pi50-pw2040-winglets").lrc, 100, 350);
  assert.deepEqual([plain.mach, plain.fuelFlowPerEngineKgH], [0.798, 1728]);
  assert.deepEqual([pw37w.mach, pw37w.fuelFlowPerEngineKgH], [0.789, 1632]);
  assert.deepEqual([pw40w.mach, pw40w.fuelFlowPerEngineKgH], [0.789, 1614]);
  assert.equal(cell(packet("pi40-pw2037-winglets").holding, 60, 15).fuelFlowPerEngineKgH, 1170);
  assert.equal(cell(packet("pi50-pw2040-winglets").holding, 60, 15).fuelFlowPerEngineKgH, 1160);
  const stripPage = (r: Row) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== "pdfPage"));
  assert.deepEqual(packet("pi20-pw2040").lrc.rows.map(stripPage), packet("pi30-pw2040").lrc.rows.map(stripPage));
  assert.notEqual(packet("pi20-pw2040").lrc.source.pageCode, packet("pi30-pw2040").lrc.source.pageCode);
});

test("757 descent does not invent fuel and climb EPR corrections are additive", () => {
  const p = packet("pi10-pw2037");
  const descent = p.descent.rows.find(r => r.fl === 350)!;
  assert.deepEqual([descent.timeMin, descent.distanceNm, descent.fuelKg], [22, 114, null]);
  for (const p of packets) assert.ok(p.descent.rows.every(r => r.fuelKg === null));
  assert.equal(data.scope.normalClimbFuelTimeDistanceTablePresent, false);
  assert.equal(data.scope.fixedMach080FuelFlowTablePresent, false);
  const deltas = p.bleedEprAdjustments.rows.filter(r => r.fl === 350);
  assert.deepEqual(deltas.map(r => [r.configuration, r.deltaEpr]), [["packsOff", 0.04], ["engineAntiIceOn", -0.05], ["engineAndWingAntiIceOn", -0.1]]);
  const epr = p.maxClimbEpr.rows.find(r => r.fl === 350 && r.tatC === -10)!;
  assert.deepEqual([epr.epr, epr.mach, epr.iasKt], [1.41, 0.78, null]);
  assert.equal(p.apuFuelIncrement.isPureApuFuelFlow, false);
  assert.ok(Math.abs(Number(p.apuFuelIncrement.rows.find(r => r.fl === 350)!.totalFuelFlowIncrementKgH) - 160 * 0.45359237) < 1e-8);
});

test("757 maximum-altitude evidence preserves differing printed footnotes", () => {
  const plain = packet("pi10-pw2037").lrcMaximumAltitude.conditions!;
  const winglet = packet("pi40-pw2037-winglets").lrcMaximumAltitude.conditions!;
  assert.match(String(plain.pageFootnote), /100 fpm/);
  assert.doesNotMatch(String(winglet.pageFootnote), /100 fpm/);
  assert.equal(plain.isUniversal300FpmCriterion, false);
  assert.equal(winglet.isUniversal300FpmCriterion, false);
  const bto = data.fleet.find((f: { registry: string }) => f.registry === "VQ-BTO");
  assert.equal(bto.engine, "PW2037");
  assert.equal(bto.winglets, false);
  assert.equal(bto.nominalTakeoffThrustPerEngineLbf, 37000);
  assert.equal(bto.maximumWeightLimits.sourceValues.takeoff, 255500);
  assert.equal(data.systemsFacts.electrical.idgRatedKva, null);
  assert.equal(data.systemsFacts.electrical.externalPowerReferenceKva, 90);
});
