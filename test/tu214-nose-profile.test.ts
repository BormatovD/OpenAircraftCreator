import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const profile = JSON.parse(readFileSync(new URL("../data/ac/tu214-shapes.json", import.meta.url), "utf8"));
const f = profile.fuselage as { x: number[]; top: number[]; bottom: number[]; half_width: number[] };
const at = (xs: number[], values: number[], x: number) => {
  const i = xs.findIndex((value) => value >= x);
  assert.ok(i >= 0);
  if (i === 0) return values[0];
  const t = (x - xs[i-1]) / (xs[i] - xs[i-1]);
  return values[i-1] * (1-t) + values[i] * t;
};

test("Ту-214: плавный нос по A321 без выступов и перегибов у цилиндра", () => {
  assert.ok(f.top[0] < -0.65 && f.top[0] > -1.1, "tip is below fuselage centreline");
  assert.ok(Math.abs(f.top[0] - f.bottom[0]) < 1e-5, "closed nose tip");
  assert.ok(at(f.x, f.top, 1) > 0.24 && at(f.x, f.top, 1) < 0.34, "A321 roof at station 1m");
  assert.ok(at(f.x, f.half_width, 1) < at(f.x, f.half_width, 3));
  assert.ok(Math.abs(at(f.x, f.top, 6.5) - 2.05) < 0.001);
  assert.ok(Math.abs(at(f.x, f.half_width, 6.5) - 1.90) < 0.001);
  for (const x of [4.8, 4.85, 4.9, 4.95, 5.0, 5.5, 6]) {
    assert.ok(at(f.x,f.bottom,x) >= -2.050001, `no underbody protrusion at x=${x}`);
    assert.ok(at(f.x,f.half_width,x) <= 1.900001, `no broad shoulder at x=${x}`);
  }
  assert.ok(f.x.every((x: number, i: number) => i === 0 || x > f.x[i-1]));
  for (let i=0;i<f.x.length;i++) {
    for (const key of ["top", "bottom", "half_width"] as const)
      assert.ok(Number.isFinite(f[key][i]));
    assert.ok(f.half_width[i] >= 0 && f.top[i] >= f.bottom[i]);
  }
});

test("Ту-214: боковые стекла над обшивкой, но не выходят за верх фюзеляжа", () => {
  for (const poly of profile.cockpit.side as number[][][]) {
    for (const [x,y] of poly) {
      assert.ok(x>1.8 && x<4);
      assert.ok(y < at(f.x,f.top,x)-0.045, `glazing outside roof at ${x}`);
      assert.ok(y > at(f.x,f.bottom,x)+0.1, `glazing below hull at ${x}`);
    }
  }
});
