import { test } from "node:test";
import assert from "node:assert/strict";
import { A320_CONTEXT as ctx } from "../src/aircraft/a320Context.ts";
import { relativeOewErrorPct, validateFamily } from "../src/validation.ts";
import { B737_300, B737_300_OEW_KG } from "../src/aircraft/b737.ts";
import { computeMasses } from "../src/mass/massTree.ts";

const fam = validateFamily(ctx);

test("A319 и A321 без подгонки: дальность в углах диаграмм — СКО ≤ 3% для ceo, среднее смещение ≤ 3%", () => {
  // С поправкой трения на число Рейнольдса A321 (летит ниже, Re больше) получает на ≈1% больше дальности.
  for (const r of fam.filter((x) => x.c.type !== "A320" && x.c.def.engine.bypassRatio < 8)) {
    assert.ok(r.rmsPct <= 3, `${r.c.name}: СКО ${r.rmsPct}`);
    assert.ok(Math.abs(r.biasPct) <= 3, `${r.c.name}: среднее ${r.biasPct}`);
  }
});

test("A319neo и A321neo: TSFC LEAP — прогноз цикла, без подгонки; среднее смещение дальности ≤ 5%", () => {
  for (const r of fam.filter((x) => x.c.type !== "A320" && x.c.def.engine.bypassRatio > 8)) assert.ok(Math.abs(r.biasPct) <= 5, `${r.c.name}: ${r.biasPct}`);
});

test("модель масс масштабируется на A319 и A321: OEW относительно A320 — в пределах ±2,5%", () => {
  for (const r of fam) assert.ok(Math.abs(relativeOewErrorPct(r, fam)) <= 2.5, `${r.c.name}: ${relativeOewErrorPct(r, fam)}`);
});

test("737-300: OEW по модели масс A320 — в пределах ±5% от Boeing", () => {
  const m = computeMasses(B737_300, ctx.calibration).oewKg;
  assert.ok(Math.abs(m / B737_300_OEW_KG - 1) < 0.05, `${m}`);
});

import { boeingCases, validateBoeing } from "../src/validation.ts";

test("Boeing без подгонки: 737-8 и 757-200 — среднее смещение дальности в пределах ±8%, 737-300 — в пределах +15%", () => {
  for (const c of boeingCases()) {
    const r = validateBoeing(ctx, c);
    const lim = c.def.id === "b737-300" ? 15 : 8;
    assert.ok(Math.abs(r.biasPct) <= lim, `${c.name}: ${r.biasPct}`);
  }
});

test("конкретные отличия 737-300 (резервы ATA, обычный профиль, гондола вплотную) уменьшают завышение дальности", () => {
  const c = boeingCases()[0];
  const plain = { ...c.def, wing: { ...c.def.wing, airfoil: { kind: "supercritical" as const, kornKappa: 0.935 } }, engine: { ...c.def.engine, installation: "pylon" as const } };
  const before = validateBoeing(ctx, { ...c, def: plain, as: { ...c.as, finalReserveMode: "hold" } }).biasPct;
  const after = validateBoeing(ctx, c).biasPct;
  assert.ok(after < before - 10, `${before} → ${after}`);
});
