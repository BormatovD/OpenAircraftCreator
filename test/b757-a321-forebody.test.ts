import assert from "node:assert/strict";
import { test } from "node:test";
import b757 from "../data/ac/b757-shapes.json" with { type: "json" };
import a320 from "../data/ac/a320-shapes.json" with { type: "json" };

type Axis = "top" | "bottom" | "half_width";
type Surface = { x: number[]; top: number[]; bottom: number[]; half_width: number[] };
const f = b757.fuselage as Surface;
const donor = a320.ceo.fuselage as Surface;

function interp(s: Surface, name: Axis, x: number): number {
  const xs = s.x;
  const values = s[name];
  for (let i = 1; i < xs.length; i++) {
    if (x <= xs[i]) {
      const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
      return values[i - 1] * (1 - t) + values[i] * t;
    }
  }
  return values.at(-1)!;
}

const near = (a: number, b: number, tol = 0.001) => assert.ok(
  Math.abs(a - b) <= tol, `expected ${b}±${tol}, got ${a}`,
);

test("757: A321 visual forebody replaces pointed trace without changing the body dimensions", () => {
  assert.equal(b757.baseLengthM, 46.97);
  assert.equal(b757.dimensions.overallLengthM, 47.32);
  near(f.top[0], f.bottom[0], 0.002);
  near(f.half_width[0], 0, 1e-8);
  for (const [axis, scale] of [
    ["top", 2.005 / 2.069],
    ["bottom", 2.005 / 2.073],
    ["half_width", 1.88 / 1.977],
  ] as const) {
    for (const x of [0.25, 0.5, 1, 2, 3, 4]) {
      near(interp(f, axis, x), interp(donor, axis, x) * scale);
    }
  }
  near(interp(f, "top", 10), 2.005, 1e-6);
  near(interp(f, "bottom", 10), -2.005, 1e-6);
  near(interp(f, "half_width", 10), 1.88, 1e-6);
});

test("757: forebody merges into original Boeing barrel without roof dip", () => {
  for (const axis of ["top", "half_width"] as const) {
    for (let x = 0.1; x < 9; x += 0.05) {
      assert.ok(interp(f, axis, x + 0.05) >= interp(f, axis, x) - 1e-5, `${axis} decreases at ${x}`);
    }
  }
  for (let x = 0.1; x < 9; x += 0.05) {
    assert.ok(interp(f, "bottom", x + 0.05) <= interp(f, "bottom", x) + 1e-5, `bottom rises at ${x}`);
  }
  for (const axis of ["top", "bottom", "half_width"] as const) {
    near(interp(f, axis, 8.50), interp(f, axis, 8.55), 0.003);
    assert.ok(f[axis].every(Number.isFinite));
  }
});

test("757: A321 cockpit silhouettes are projected with one set of frame materials", () => {
  const glazing = b757.cockpit;
  assert.equal(glazing.windscreen.length, 5);
  assert.deepEqual(glazing.side.map((window) => window.length), [5, 6]);
  for (const polygon of [glazing.windscreen, ...glazing.side]) {
    const cross: number[] = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length], c = polygon[(i + 2) % polygon.length];
      cross.push((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]));
      assert.ok(a.every(Number.isFinite));
    }
    assert.ok(cross.every((x) => x > -1e-5) || cross.every((x) => x < 1e-5), "convex pane");
  }
  assert.ok(b757._assumptions.some((note) => note.includes("A321-family")));
});

test("757: window and door stations, engines, wing and gear remain Boeing-based", () => {
  assert.equal(b757.featuresBySide.left.filter((f) => f.kind === "door").length, 3);
  assert.equal(b757.featuresBySide.left.filter((f) => f.kind === "exit").length, 2);
  near(b757.gear.noseX, 5.89, 1e-6);
  near(b757.wing.tip_z * 2, 38.05, 1e-6);
  near(b757.nacelleByEngine.RB211.width_m, 2.46, 1e-6);
  near(b757.nacelleByEngine.PW2000.width_m, 2.69, 1e-6);
});
