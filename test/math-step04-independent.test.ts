import test from "node:test";
import assert from "node:assert/strict";
import { A320_CONTEXT } from "../src/aircraft/a320Context.ts";
import { assumptionsFor } from "../src/evaluate.ts";
import { boeingCases, validateBoeing, validateFamily } from "../src/validation.ts";

test("Независимые сравнения семейства и Boeing не получают FCOM набор A320", () => {
  assert.equal(assumptionsFor(A320_CONTEXT, []).fcomClimb, undefined);
  const family = validateFamily(A320_CONTEXT);
  const boeing = boeingCases().map((c) => validateBoeing(A320_CONTEXT, c));
  assert.equal(family.length, 9);
  assert.equal(boeing.length, 4);
  const pointCount = family.reduce((sum, r) => sum + r.rows.length, 0) + boeing.reduce((sum, r) => sum + r.points.length, 0);
  assert.equal(pointCount, 499);
  for (const row of [...family, ...boeing]) {
    assert.ok(Number.isFinite(row.rmsPct), "СКО должен быть конечным");
    assert.ok(Number.isFinite(row.maxAbsPct), "максимальная ошибка должна быть конечной");
  }
});
