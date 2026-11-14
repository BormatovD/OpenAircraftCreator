import { test } from "node:test";
import assert from "node:assert/strict";
import { A320CEO, A320NEO } from "../src/aircraft/a320.ts";
import { A320_CONTEXT as ctx } from "../src/aircraft/a320Context.ts";
import { aeroSpanM } from "../src/definition.ts";
import { evaluate } from "../src/evaluate.ts";
import { highLiftAnchor } from "../src/highlift.ts";
import { doubleSlottedFlaps, flapChord, fuselageStretch, slats } from "../src/levers.ts";
import { designMissionOf, redesign } from "../src/redesign.ts";

test("формулы Raymer без привязки — в пределах 15% от A320", () => {
  assert.ok(Math.abs(highLiftAnchor(A320CEO) - 1) < 0.15);
});

test("A320ceo: заход 134 уз при MLW (привязка), категория C; NEO тяжелее на посадке — быстрее", () => {
  const c = evaluate(A320CEO, [], ctx).highLift;
  const n = evaluate(A320NEO, [], ctx).highLift;
  assert.ok(Math.abs(c.vAppKt - 134) < 0.5);
  assert.ok(n.vAppKt > c.vAppKt && n.vAppKt < 140);
  assert.ok(c.clMaxTakeoff > 2 && c.clMaxTakeoff < 2.5);
});

test("двухщелевые закрылки: выше CLmax, короче ВПП, тяжелее", () => {
  const b = evaluate(A320CEO, [], ctx);
  const d = evaluate(A320CEO, [doubleSlottedFlaps(true)], ctx);
  const tofl = (e: typeof b) => parseFloat(e.constraints.find((c) => c.id === "takeoff-field")!.value.replace(/\s/g, ""));
  assert.ok(d.highLift.clMaxLanding > b.highLift.clMaxLanding * 1.05);
  assert.ok(tofl(d) < tofl(b));
  assert.ok(d.oewKg > b.oewKg);
});

test("без предкрылков — категория D по скорости захода", () => {
  const e = evaluate(A320CEO, [slats(false)], ctx);
  assert.equal(e.constraints.find((c) => c.id === "approach-speed")!.status, "info");
});

test("больше хорда закрылков — выше CLmax и масса механизации", () => {
  const a = evaluate(A320CEO, [flapChord(20)], ctx);
  const b = evaluate(A320CEO, [flapChord(32)], ctx);
  assert.ok(b.highLift.clMaxLanding > a.highLift.clMaxLanding);
  assert.ok(b.masses.byId.get("wing.highLift")!.kg > a.masses.byId.get("wing.highLift")!.kg);
});

test("путь к A321: двухщелевые закрылки возвращают размах в код C при перепроектировании", () => {
  const base = evaluate(A320CEO, [], ctx);
  const run = (l: Parameters<typeof redesign>[1]) => {
    const fixed = evaluate(A320CEO, l, ctx);
    return redesign(A320CEO, l, ctx, { ...designMissionOf(base), payloadKg: fixed.seats * 95 }).evaluation;
  };
  const single = run([fuselageStretch(9)]);
  const dbl = run([fuselageStretch(9), doubleSlottedFlaps(true)]);
  assert.ok(aeroSpanM(single.definition) > 36);
  assert.ok(aeroSpanM(dbl.definition) <= 36);
  assert.ok(dbl.definition.wing.areaM2 < single.definition.wing.areaM2);
});
