import assert from "node:assert/strict";
import { test } from "node:test";
import tu from "../data/ac/tu214-shapes.json" with { type: "json" };

test("Tu-214 v2 radome: continuous, rounded, nonnegative sections up to station 6.5 m", () => {
  const f = tu.fuselage;
  const at = (x: number) => f.x.indexOf(x);
  assert.ok(at(6.5) > 0);
  assert.ok(Math.abs(f.top[0] - f.bottom[0]) < 1e-8);
  assert.equal(f.half_width[0], 0);
  for (let i = 1; i <= at(6.5); i++) {
    assert.ok(f.top[i] > f.bottom[i], `height at station ${f.x[i]}`);
    assert.ok(f.half_width[i] > 0, `width at station ${f.x[i]}`);
    assert.ok(f.half_width[i] >= f.half_width[i - 1] - 1e-7, `width monotonic at ${f.x[i]}`);
  }
  // Короткий туповатый обтекатель — существенная ширина уже на x=0.5 м.
  assert.ok(f.half_width[at(0.5)] > 0.7);
  assert.ok(f.top[at(1)] > 0.40);
  assert.equal(f.top[at(6.5)], 2.05);
  assert.equal(f.bottom[at(6.5)], -2.05);
});

test("Tu-214 v2 windscreen lowered but still above side window sills", () => {
  assert.equal(tu.cockpit.windscreen.length, 4);
  assert.ok(Math.max(...tu.cockpit.windscreen.map((v) => v[1])) < 0.85);
  assert.ok(Math.min(...tu.cockpit.windscreen.map((v) => v[1])) > 0.24);
  assert.equal(tu.cockpit.side.length, 2);
});
