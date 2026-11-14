import { test } from "node:test";
import assert from "node:assert/strict";
import { A320CEO, A320NEO } from "../src/aircraft/a320.ts";
import { A320_CONTEXT as ctx } from "../src/aircraft/a320Context.ts";
import { contextFor } from "../src/aircraft/contextFor.ts";
import { checkConstraints, worstStatus } from "../src/constraints.ts";
import { evaluate } from "../src/evaluate.ts";
import { bypassRatio, wingSpan } from "../src/levers.ts";

const byId = (rs: ReturnType<typeof checkConstraints>, id: string) => rs.find((r) => r.id === id)!;

test("базовые A320ceo и A320neo проходят все ограничения", () => {
  assert.equal(worstStatus(evaluate(A320CEO, [], contextFor(A320CEO)).constraints), "ok");
  assert.equal(worstStatus(evaluate(A320NEO, [], contextFor(A320NEO)).constraints), "ok");
});

test("размах больше 36 м переводит в код D", () => {
  const r = evaluate(A320NEO, [wingSpan(1.5)], ctx).constraints;
  assert.equal(byId(r, "span-code").status, "info");
});

test("двухконтурность 16 уменьшает клиренс CEO и требует экстраполяции", () => {
  const r = evaluate(A320CEO, [bypassRatio(16)], ctx).constraints;
  assert.equal(byId(r, "nacelle-clearance").status, "warning");
  assert.equal(byId(r, "bpr-range").status, "warning");
});

test("вставка как у A321 (6,94 м) даёт угол касания ≈9,7° (FCOM Bulletin 22/2)", () => {
  const def = { ...A320CEO, fuselage: { ...A320CEO.fuselage, lengthM: 37.57 + 6.94 } };
  const r = checkConstraints(def, ctx.constraintsRef, { payloadLimitedByMzfw: false, ceilingFl: 350, oeiGradient: 0.04, highLift: evaluate(A320CEO, [], ctx).highLift });
  assert.ok(Math.abs(parseFloat(byId(r, "tail-strike").value) - 9.7) < 0.15);
});
