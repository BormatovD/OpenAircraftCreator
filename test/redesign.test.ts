import { test } from "node:test";
import assert from "node:assert/strict";
import { A320CEO } from "../src/aircraft/a320.ts";
import { A320_CONTEXT as ctx } from "../src/aircraft/a320Context.ts";
import { evaluate } from "../src/evaluate.ts";
import { compositeWing, fuselageStretch } from "../src/levers.ts";
import { designMissionOf, redesign } from "../src/redesign.ts";

const base = evaluate(A320CEO, [], ctx);
const mission = designMissionOf(base);

test("без рычагов перепроектирование возвращает исходный самолёт", () => {
  const r = redesign(A320CEO, [], ctx, mission);
  assert.ok(r.converged);
  assert.ok(Math.abs(r.mtowKg - A320CEO.weights.mtowKg) < 50, `MTOW ${r.mtowKg}`);
});

test("снежный ком: композитное крыло снижает OEW сильнее, чем при той же геометрии", () => {
  const fixed = evaluate(A320CEO, [compositeWing(20)], ctx);
  const r = redesign(A320CEO, [compositeWing(20)], ctx, mission);
  assert.ok(r.converged);
  assert.ok(r.mtowKg < A320CEO.weights.mtowKg);
  assert.ok(r.evaluation.oewKg < fixed.oewKg);
});

test("удлинение на 9 рядов сходится к MTOW класса A321 (AC A321: 78–93,5 т у A321ceo)", () => {
  const rows = 9;
  const r = redesign(A320CEO, [fuselageStretch(rows)], ctx, { ...mission, payloadKg: (180 + 6 * rows) * 95 });
  assert.ok(r.converged);
  assert.ok(r.mtowKg > 78000 && r.mtowKg < 93500, `MTOW ${r.mtowKg}`);
});
