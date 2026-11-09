import { test } from "node:test";
import assert from "node:assert/strict";
import { A320CEO, A320NEO, AC_OEW_KG } from "../src/aircraft/a320.ts";
import { calibrateMasses, computeMasses } from "../src/mass/massTree.ts";
import { GROUP_MAP, analogueShares } from "../src/mass/analogue.ts";
import { aeroQuality, compositeHighLift, compositeWing, lighterHarness, wingSpan, type Lever } from "../src/levers.ts";
import { aeroFor } from "../src/evaluate.ts";
import { maxLiftToDrag } from "../src/aero.ts";

const cal = calibrateMasses(A320CEO, AC_OEW_KG.a320ceo, analogueShares(), GROUP_MAP);

test("калибровка воспроизводит OEW CEO из AC", () => {
  assert.ok(Math.abs(computeMasses(A320CEO, cal).oewKg - AC_OEW_KG.a320ceo) < 1);
});

test("NEO без подгонки: OEW в пределах 2% от AC", () => {
  const oew = computeMasses(A320NEO, cal).oewKg;
  assert.ok(Math.abs(oew - AC_OEW_KG.a320neo) / AC_OEW_KG.a320neo < 0.02, `OEW NEO ${oew}`);
});

test("композитный кессон −20% снимает ровно 20% массы кессона, механизацию не трогает", () => {
  const base = computeMasses(A320CEO, cal);
  const cw = computeMasses(A320CEO, cal, [compositeWing(20)]);
  const box = base.byId.get("wing.box")!.kg;
  assert.ok(Math.abs(base.oewKg - cw.oewKg - 0.2 * box) < 1e-6);
  assert.equal(cw.byId.get("wing.highLift")!.kg, base.byId.get("wing.highLift")!.kg);
});

test("крыло = кессон + механизация; механизация ≈18% и калибровка крыла не изменилась", () => {
  const m = computeMasses(A320CEO, cal);
  const wing = m.byId.get("wing")!.kg;
  assert.ok(Math.abs(m.byId.get("wing.box")!.kg + m.byId.get("wing.highLift")!.kg - wing) < 1e-6);
  assert.ok(Math.abs(m.byId.get("wing.highLift")!.kg / wing - 0.18) < 1e-9);
});

test("композитная механизация −15% снимает 15% механизации", () => {
  const base = computeMasses(A320CEO, cal);
  const hl = computeMasses(A320CEO, cal, [compositeHighLift(15)]);
  assert.ok(Math.abs(base.oewKg - hl.oewKg - 0.15 * base.byId.get("wing.highLift")!.kg) < 1e-6);
});

test("рычаг на группу действует на всех потомков", () => {
  const group: Lever = { id: "t", label: "t", rationale: "", effects: [{ kind: "massFactor", node: "electrical", factor: 0.5 }] };
  const base = computeMasses(A320CEO, cal);
  const half = computeMasses(A320CEO, cal, [group]);
  for (const id of ["electrical.generation", "electrical.harness"]) {
    assert.ok(Math.abs(half.byId.get(id)!.kg - 0.5 * base.byId.get(id)!.kg) < 1e-6);
  }
});

test("рычаг на жгуты не трогает генерацию", () => {
  const base = computeMasses(A320CEO, cal);
  const h = computeMasses(A320CEO, cal, [lighterHarness(15)]);
  assert.equal(h.byId.get("electrical.generation")!.kg, base.byId.get("electrical.generation")!.kg);
  assert.ok(h.byId.get("electrical.harness")!.kg < base.byId.get("electrical.harness")!.kg);
});

test("качество +2% поднимает L/D max на 2%", () => {
  const base = maxLiftToDrag(aeroFor(A320CEO, { cd0: 0.019, oswald: 0.78 }, []));
  const up = maxLiftToDrag(aeroFor(A320CEO, { cd0: 0.019, oswald: 0.78 }, [aeroQuality(2)]));
  assert.ok(Math.abs(up / base - 1.02) < 1e-9);
});

test("больший размах утяжеляет крыло (через удлинение)", () => {
  const base = computeMasses(A320CEO, cal).byId.get("wing")!.kg;
  const longer = computeMasses({ ...A320CEO, wing: { ...A320CEO.wing, spanM: A320CEO.wing.spanM + 1.5 } }, cal, [wingSpan(0)]).byId.get("wing")!.kg;
  assert.ok(longer > base);
});
