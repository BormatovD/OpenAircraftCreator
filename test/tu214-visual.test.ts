// Визуальные улучшения Ту-214 не меняют сертификационные данные или результат миссии.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TU214_PS90A, TU214_FACTORY } from "../src/aircraft/tu214.ts";
import { aeroSpanM } from "../src/definition.ts";
import { contextFor } from "../src/aircraft/contextFor.ts";
import { evaluate } from "../src/evaluate.ts";
import { controlsFor } from "../web/controls.ts";

const s = JSON.parse(readFileSync(new URL("../data/ac/tu214-shapes.json", import.meta.url), "utf8"));

test("Ту-214: собственные загнутые законцовки без нижних fences и без доп. массы A320", () => {
  for (const d of [TU214_PS90A, TU214_FACTORY]) {
    assert.equal(d.wing.tip, "blended");
    assert.equal(aeroSpanM(d), d.wing.spanM);
    assert.ok(!controlsFor(d).some((c) => c.id === "sharklets"));
    const oldWingCode = { ...d, wing: { ...d.wing, tip: "fence" as const } };
    const baseline = evaluate(oldWingCode, [], contextFor(oldWingCode));
    const newModel = evaluate(d, [], contextFor(d));
    assert.ok(Math.abs(newModel.oewKg - baseline.oewKg) < 1e-6);
    assert.ok(Math.abs(newModel.oei.gradient - baseline.oei.gradient) < 1e-10);
    assert.ok(Math.abs(newModel.missionFuelKg - baseline.missionFuelKg) < 1e-6);
    assert.equal(newModel.masses.byId.get("wingtips")?.kg, 0);
  }
});

test("Ту-214: собственные окна кабины — выпуклые, в допустимом диапазоне носа", () => {
  const windows: number[][][] = [s.cockpit.windscreen, ...s.cockpit.side];
  assert.equal(windows.length, 3);
  const inside = (p: number[][]) => {
    const turns = p.map((_, i) => {
      const a = p[(i + p.length - 1) % p.length];
      const b = p[i];
      const c = p[(i + 1) % p.length];
      return (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    });
    assert.ok(turns.every((x) => x < -0.01) || turns.every((x) => x > 0.01), "glazing must be convex");
  };
  for (const window of windows) {
    assert.ok(window.length >= 4 && window.length <= 6);
    assert.ok(window.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)));
    inside(window);
  }
  assert.ok(s.cockpit.windscreen.every(([z, y]: number[]) => z >= 0.04 && z <= 1 && y > 0.24 && y < 0.96));
  for (const poly of s.cockpit.side)
    assert.ok(poly.every(([x, y]: number[]) => x >= 1.8 && x <= 3.8 && y >= 0.2 && y <= 1.1));
});
