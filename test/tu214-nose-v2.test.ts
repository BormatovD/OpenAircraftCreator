import assert from "node:assert/strict";
import { test } from "node:test";
import tu from "../data/ac/tu214-shapes.json" with { type: "json" };

test("Tu-214 A321-derived radome: continuous and bounded up to station 6.5 m", () => {
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
  // The A321 nose rises more gradually: no false lower fairing ridge at x=4.8m.
  assert.ok(f.half_width[at(0.5)] > 0.60);
  assert.ok(f.top[at(1)] > 0.24 && f.top[at(1)] < 0.32);
  assert.ok(f.bottom[at(4.8)] >= -2.050001);
  assert.ok(f.half_width[at(5.5)] <= 1.900001);
  assert.equal(f.top[at(6.5)], 2.05);
  assert.equal(f.bottom[at(6.5)], -2.05);
});

test("Tu-214 windscreen adopts A321 five-point layout without vertical clipping", () => {
  assert.equal(tu.cockpit.windscreen.length, 5);
  assert.ok(Math.max(...tu.cockpit.windscreen.map((v) => v[1])) < 0.95);
  assert.ok(Math.min(...tu.cockpit.windscreen.map((v) => v[1])) > 0.40);
  assert.equal(tu.cockpit.side.length, 2);
});
