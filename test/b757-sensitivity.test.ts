import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

function readAudit() {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/audit-b757-sensitivity.ts"], {
    cwd: process.cwd(), encoding: "utf8", maxBuffer: 3_000_000,
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("B757 sensitivity: unchanged mass baseline and arithmetic closure", () => {
  const d = readAudit();
  const [rb, pw] = d.variants;
  assert.ok(Math.abs(rb.modelOewKg - 55_990.79) < 0.02);
  assert.ok(Math.abs(pw.modelOewKg - 56_101.519) < 0.02);
  for (const v of [rb, pw]) {
    assert.ok(Math.abs(Object.values(v.groupsKg).reduce((a: number, x: unknown) => a + Number(x), 0) - v.modelOewKg) < 0.02);
    assert.ok(Math.abs(v.referenceKg - v.modelOewKg - v.shortfallKg) < 0.002);
    assert.ok(v.sensitivities.every((x: {deltaOewKgForPlus1Pct: number, deltaOewKgForMinus1Pct:number}) =>
      x.deltaOewKgForPlus1Pct > 0 && x.deltaOewKgForMinus1Pct < 0));
  }
});

test("B757 sensitivity: modeled PW-RB sign and contributions stay visible", () => {
  const d = readAudit();
  assert.equal(d.comparison.sourceRbMinusPwKg, 644);
  assert.ok(d.comparison.modelRbMinusPwKg < -110 && d.comparison.modelRbMinusPwKg > -112);
  const parts = d.comparison.modelPwMinusRbByLeafKg;
  const by = Object.fromEntries(parts.map((x:{leaf:string,pwMinusRbKg:number})=>[x.leaf,x.pwMinusRbKg]));
  assert.ok(Math.abs(by.nacelles - 78.258) < 0.003);
  assert.ok(Math.abs(by.engines - 32) < 0.003);
  assert.ok(Math.abs(parts.reduce((s:number,x:{pwMinusRbKg:number}) => s + x.pwMinusRbKg, 0) + d.comparison.modelRbMinusPwKg) < 0.008);
});

test("B757 sensitivity: +1% geometry/input perturbations are local diagnostics, not adjustments", () => {
  const d = readAudit();
  const rb = d.variants[0];
  const by = Object.fromEntries(rb.sensitivities.map((s:{input:string,deltaOewKgForPlus1Pct:number})=>[s.input,s.deltaOewKgForPlus1Pct]));
  assert.ok(by.mtowKg > 100 && by.mtowKg < 200);
  assert.ok(by["fuselage.lengthM"] > 100 && by["fuselage.lengthM"] < 150);
  assert.ok(by["wing.spanM"] > 100 && by["wing.spanM"] < 140);
  assert.ok(by["systems.apuUninstalledKg"] > 0 && by["systems.apuUninstalledKg"] < 10);
  assert.ok(rb.hypotheticalSingleGroupBridges.every((g:{upliftPercentIfOnlyThisGroupBridgesGap:number})=>g.upliftPercentIfOnlyThisGroupBridgesGap>0));
});
