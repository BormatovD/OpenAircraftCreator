// Source-packet checks: units, sparse domains and cross-table consistency.
// These sample manuals are not connected to an aircraft or used for calibration.
import assert from "node:assert/strict";
import { test } from "node:test";
import NG from "../data/fcom/b737-800-cfm56-7b26-sample-2008.json" with { type: "json" };
import CL from "../data/fcom/b737-300-cfm56-3-22k-sample-2007.json" with { type: "json" };

test("737 source packets retain sample status and distinguish NG, Classic and engine labels", () => {
  for (const packet of [NG, CL]) {
    assert.equal(packet.source.sampleOnly, true);
    assert.equal(packet.source.approvedForOperationalUse, false);
    assert.equal(packet.applicability.connectedToRuntimeModel, false);
    assert.match(packet.source.sha256, /^[a-f0-9]{64}$/);
    assert.match(packet.source.qualification, /layout and structure/);
  }
  assert.equal(NG.applicability.tableHeader, "737-800/CFM56-7B26");
  assert.equal(CL.applicability.tableHeader, "737-300/CFM56-3_22K");
  assert.match(CL.applicability.engineSuffixResolution, /does not uniquely establish/);
  assert.deepEqual(NG.otherPerformanceSectionsInThisPdf.map(v => v.sourceMassUnit), ["KG", "LB", "KG", "LB", "KG"]);
});

test("737-800 LRC preserves its sparse mass/altitude domain and per-engine fuel units", () => {
  const t = NG.tables.lrcControl;
  assert.equal(t.rows.length, 76);
  assert.equal(t.missingCells.length, 14);
  assert.equal(new Set(t.rows.map(r => `${r.massKg}/${r.fl}`)).size, 76);
  assert.equal(t.sourceFuelFlowUnit, "kg/h per engine");
  assert.ok(t.missingCells.some(r => r.massKg === 85000 && r.fl === 350));
  assert.ok(!t.rows.some(r => r.massKg === 85000 && r.fl >= 350));
  const at = t.rows.find(r => r.massKg === 60000 && r.fl === 350)!;
  assert.deepEqual([at.n1Pct, at.mach, at.iasKt, at.fuelFlowPerEngineKgH], [85.6, 0.773, 262, 1140]);
  assert.equal(t.rows.find(r => r.massKg === 40000 && r.fl === 410)!.fuelFlowPerEngineKgH, 813);
});

test("737-800 independent PI and PD holding tables agree within printed rounding, with factor two applied once", () => {
  const pi = NG.tables.holdingInflight;
  const pd = NG.tables.holdingPlanning;
  assert.equal(pi.rows.length, 83);
  assert.equal(pd.rows.length, 83);
  assert.deepEqual(pi.missingCells, pd.missingCells);
  assert.equal(pd.conditions.racetrackAllowanceIncludedPct, 5);
  for (const row of pi.rows) {
    const planning = pd.rows.find(r => r.massKg === row.massKg && r.fl === row.fl)!;
    assert.ok(planning, `No planning cell for ${row.massKg}/${row.fl}`);
    assert.ok(Math.abs(2 * row.fuelFlowPerEngineKgH - planning.totalFuelFlowKgH) <= 10,
      `PI/PD disagreement at ${row.massKg}/${row.fl}`);
  }
  assert.equal(pd.rows.find(r => r.massKg === 60000 && r.fl === 15)!.totalFuelFlowKgH, 2260);
});

test("737-300 holding is total airplane flow and keeps all nine published blank cells", () => {
  const t = CL.tables.holdingPlanning;
  assert.equal(t.rows.length, 117);
  assert.equal(t.missingCells.length, 9);
  assert.equal(t.sourceFuelFlowUnit, "kg/h total airplane");
  assert.equal(t.rows.find(r => r.massKg === 60000 && r.fl === 15)!.totalFuelFlowKgH, 2790);
  assert.equal(t.rows.find(r => r.massKg === 50000 && r.fl === 370)!.totalFuelFlowKgH, 2140);
  assert.ok(t.missingCells.some(r => r.massKg === 62000 && r.fl === 350));
  assert.ok(!t.rows.some(r => r.massKg === 62000 && r.fl === 350));
});

test("NG descent fuel includes approach and is not multiplied by engine count or mass columns", () => {
  const t = NG.tables.descent;
  assert.equal(t.rows.length, 68);
  assert.equal(t.altitudesFt.length, 17);
  assert.equal(t.sourceFuelUnit, "kg total airplane");
  assert.equal(t.conditions.straightInApproachIncluded, true);
  const at350 = t.rows.filter(r => r.fl === 350);
  assert.deepEqual(at350.map(r => [r.landingMassKg, r.timeMin, r.fuelKg, r.distanceNm]), [
    [40000, 24, 320, 88], [50000, 24, 320, 102],
    [60000, 24, 320, 113], [70000, 24, 320, 121],
  ]);
  assert.ok(t.rows.filter(r => r.fl === 15).every(r => r.fuelKg === 110 && r.timeMin === 4 && r.distanceNm === 9));
});

test("Max-climb and anti-ice data remain N1 settings; emergency fuel penalties retain their distinct scope", () => {
  const t = NG.tables.maxClimbN1;
  assert.equal(t.rows.length, 210);
  assert.equal(t.bleedCorrections.length, 12);
  assert.equal(t.rows.find(r => r.tatC === 20 && r.fl === 350)!.n1Pct, 95.4);
  assert.equal(t.bleedCorrections.find(r => r.configuration === "engineAntiIce" && r.fl === 350)!.n1AdjustmentPercentagePoints, -0.8);
  assert.equal(t.bleedCorrections.find(r => r.configuration === "engineAndWingAntiIceDualBleed" && r.fl === 350)!.n1AdjustmentPercentagePoints, -3);
  assert.match(t.bleedCorrectionUnit, /not thrust percent or fuel-flow percent/);
  assert.deepEqual(NG.scopedCriticalFuelCorrections.map(r => r.icingFuelIncreasePct), [15, 15]);
  assert.deepEqual(CL.scopedCriticalFuelCorrections.map(r => r.icingFuelIncreasePct), [18, 20]);
  for (const c of NG.scopedCriticalFuelCorrections) {
    assert.equal(c.icingComponentsPct.engineAndWingAntiIce + c.icingComponentsPct.iceOnUnheatedSurfaces, c.icingFuelIncreasePct);
    assert.equal(c.scenario.cruiseAltitudeFt, 10000);
    assert.equal(c.scenario.holdingMinutes, 15);
    assert.match(c.scope, /not a normal cruise bleed correction/);
  }
});

test("APU increment includes fuel and door drag, with an explicit all-engine cross-reference", () => {
  const t = NG.tables.apuIncrement;
  assert.equal(t.rows.length, 8);
  assert.equal(t.conditions.includesApuFuelAndDoorDrag, true);
  assert.equal(t.allEngineCrossReference.pageCode, "PI.37.7");
  assert.equal(t.rows.find(r => r.fl === 350)!.fuelFlowIncrementKgH, 45);
  assert.equal(t.rows.find(r => r.fl === 50)!.fuelFlowIncrementKgH, 95);
});

test("Integrated trip data retain landing-mass adjustments and per-cell short-trip altitudes", () => {
  for (const [packet, refCount, adjustmentCount, shortCount, referenceMass] of [
    [NG, 120, 112, 70, 50000], [CL, 80, 66, 60, 45000],
  ] as const) {
    const t = packet.tables;
    assert.equal(t.tripReference.rows.length, refCount);
    assert.equal(t.tripReference.missingCells.length, 5);
    assert.equal(t.tripFuelAdjustment.rows.length, adjustmentCount);
    assert.equal(t.shortTrip.rows.length, shortCount);
    assert.ok(t.tripFuelAdjustment.rows.filter(r => r.landingMassKg === referenceMass).every(r => r.fuelAdjustmentKg === 0));
    assert.equal(t.tripReference.conditions.cruiseSpeedSchedule, "Long Range Cruise");
  }
  const classic = CL.tables.tripReference.rows.find(r => r.airDistanceNm === 1000 && r.fl === 350)!;
  assert.deepEqual([classic.fuelKg, classic.timeMin], [5400, 150]);
  const ng = NG.tables.tripReference.rows.find(r => r.airDistanceNm === 1000 && r.fl === 350)!;
  assert.deepEqual([ng.fuelKg, ng.timeMin], [5300, 149]);
  assert.equal(NG.tables.tripFuelAdjustment.rows.find(r => r.referenceFuelKg === 32000 && r.landingMassKg === 55000)!.fuelAdjustmentKg, 2200);
  const short = NG.tables.shortTrip.rows.find(r => r.airDistanceNm === 200 && r.landingMassKg === 60000)!;
  assert.deepEqual([short.fl, short.fuelKg, short.timeMin], [260, 1600, 37]);
});
