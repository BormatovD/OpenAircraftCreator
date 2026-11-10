// Крейсерский расход 737-8 против таблицы FCOM «Long Range Cruise Control»: 80 точек, 40–85 т, FL250–410, M 0,53–0,80.
import assert from "node:assert/strict";
import { test } from "node:test";
import T from "../data/fcom/b737-8-lrc.json" with { type: "json" };
import { B737_8, B737_8_ASSUMPTIONS } from "../src/aircraft/b737max.ts";
import { contextFor } from "../src/aircraft/contextFor.ts";
import { aeroAtFl, clForWeight, liftToDrag } from "../src/aero.ts";
import { isa } from "../src/atmosphere.ts";
import { aeroFor, engineStateFor } from "../src/evaluate.ts";

test("737-8: расход на двигатель в крейсере — модель экономичнее FCOM на 0–11% во всех точках, разброс ≤ 2% (уровень −5% — не объяснён, см. «Как рассчитано»)", () => {
  const ctx = contextFor(B737_8);
  const aero = aeroFor(B737_8, ctx.aero, []);
  const tsfc = engineStateFor(B737_8, ctx, [], B737_8_ASSUMPTIONS).tsfcCruise;
  const errs: number[] = [];
  for (const [w, cells] of Object.entries(T.rows))
    cells.forEach((c, i) => {
      const fl = T.altitudesFt[i] / 100;
      const atm = isa(fl * 30.48);
      const a = aeroAtFl(aero, fl);
      const W = +w * 1000 * 9.80665;
      const ld = liftToDrag(a, clForWeight(a, W, atm.densityKgM3, c[1] * atm.speedOfSoundMs), c[1]);
      errs.push(((tsfc * (W / ld) * 3600) / 2 / c[3] - 1) * 100);
    });
  const mean = errs.reduce((s, x) => s + x, 0) / errs.length;
  const sd = Math.sqrt(errs.reduce((s, x) => s + (x - mean) ** 2, 0) / errs.length);
  assert.equal(errs.length, 80);
  for (const e of errs) assert.ok(e > -11 && e < 0, `ошибка ${e.toFixed(1)}%`);
  assert.ok(sd <= 2, `разброс ${sd.toFixed(1)}%`);
});
