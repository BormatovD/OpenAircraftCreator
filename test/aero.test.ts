import { test } from "node:test";
import assert from "node:assert/strict";
import { A320CEO } from "../src/aircraft/a320.ts";
import { A320_CONTEXT as ctx } from "../src/aircraft/a320Context.ts";
import { dragBuildup, dragDivergenceMach, waveDrag, waveParams } from "../src/drag.ts";
import { aeroFor, evaluate } from "../src/evaluate.ts";
import { bypassRatio, cruiseMach, fuselageStretch, wingThickness } from "../src/levers.ts";

test("сопротивление по составляющим без привязки близко к поляре A320 (0,019 ± 15%)", () => {
  const cd0 = dragBuildup(A320CEO).cd0;
  assert.ok(Math.abs(cd0 / 0.019 - 1) < 0.15, `CD0 ${cd0}`);
});

test("привязка: множитель CD0 в пределах ±10% — формулы не подгоняются сильно", () => {
  assert.ok(Math.abs(ctx.aero.cd0Factor! - 1) < 0.1);
});

test("число Маха расходимости A320 при CL 0,55 — 0,78…0,84 (MMO 0,82)", () => {
  const { mdd } = dragDivergenceMach(waveParams(A320CEO), 0.55);
  assert.ok(mdd > 0.78 && mdd < 0.84, `Mdd ${mdd}`);
});

test("волновое растёт с числом Маха и толщиной профиля", () => {
  const w = waveParams(A320CEO);
  assert.ok(waveDrag(w, 0.55, 0.82) > waveDrag(w, 0.55, 0.78));
  const thick = waveParams({ ...A320CEO, wing: { ...A320CEO.wing, thicknessRootPct: 17 } });
  assert.ok(waveDrag(thick, 0.55, 0.78) > waveDrag(w, 0.55, 0.78));
});

test("больше гондола (двухконтурность) — больше CD0", () => {
  const a = aeroFor(A320CEO, ctx.aero, []).cd0;
  const b = aeroFor({ ...A320CEO, engine: { ...A320CEO.engine, nacelleWidthM: 2.8, nacelleLengthM: 5.2 } }, ctx.aero, []).cd0;
  assert.ok(b > a);
  assert.ok(evaluate(A320CEO, [bypassRatio(11)], ctx).fuelPerSeatPer100KmKg < evaluate(A320CEO, [], ctx).fuelPerSeatPer100KmKg);
});

test("длиннее фюзеляж — больше CD0", () => {
  assert.ok(evaluate(A320CEO, [fuselageStretch(6)], ctx).aero.cd0 > evaluate(A320CEO, [], ctx).aero.cd0);
});

test("число Маха: у A320 оптимум расхода около M 0,78 — быстрее 0,82 и медленнее 0,70 дороже, 0,74–0,80 в пределах 1,5%", () => {
  // Удельный расход в крейсере не зависит от Маха (проверено по FCOM 737-8), поэтому оптимум задаёт поляра: качество × скорость.
  const base = evaluate(A320CEO, [], ctx).fuelPerSeatPer100KmKg;
  assert.ok(evaluate(A320CEO, [cruiseMach(0.82)], ctx).fuelPerSeatPer100KmKg > base);
  assert.ok(evaluate(A320CEO, [cruiseMach(0.7)], ctx).fuelPerSeatPer100KmKg > base * 1.03);
  for (const m of [0.74, 0.8]) assert.ok(Math.abs(evaluate(A320CEO, [cruiseMach(m)], ctx).fuelPerSeatPer100KmKg / base - 1) < 0.015);
});

test("тоньше крыло — тяжелее, но меньше волновое", () => {
  const base = evaluate(A320CEO, [], ctx);
  const thin = evaluate(A320CEO, [wingThickness(12)], ctx);
  assert.ok(thin.oewKg > base.oewKg);
  assert.ok(waveParams(thin.definition).tc < waveParams(base.definition).tc);
});
