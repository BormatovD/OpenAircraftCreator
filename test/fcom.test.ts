// Крейсерский расход 737-8 против таблицы FCOM «Long Range Cruise Control»: 80 точек, 40–85 т, FL250–410, M 0,53–0,80.
import assert from "node:assert/strict";
import { test } from "node:test";
import T from "../data/fcom/b737-8-lrc.json" with { type: "json" };
import { B737_8, B737_8_ASSUMPTIONS } from "../src/aircraft/b737max.ts";
import { B737_300, B737_ASSUMPTIONS } from "../src/aircraft/b737.ts";
import { contextFor } from "../src/aircraft/contextFor.ts";
import { validateCruiseTable } from "../src/validation.ts";

test("737-8: расход на двигатель в крейсере — модель экономичнее FCOM на 0–11% во всех точках, разброс ≤ 2% (уровень −5% — не объяснён, см. «Как рассчитано»)", () => {
  const result = validateCruiseTable(contextFor(B737_8), B737_8, B737_8_ASSUMPTIONS, T);
  assert.equal(result.rows.length, 80);
  for (const r of result.rows) assert.ok(r.errorPct > -11 && r.errorPct < 0, `ошибка ${r.errorPct.toFixed(1)}%`);
  assert.ok(result.sdPct <= 2, `разброс ${result.sdPct.toFixed(1)}%`);
});

test("737-300/CFM56-3B2: 71 независимая точка Boeing; текущая СКО расхода ≤12%, максимальная ошибка ≤20%", () => {
  // Это предел регрессии неполной модели, а не критерий точности реального двигателя. Подгонки по FCOM нет.
  const result = validateCruiseTable(contextFor(B737_300), B737_300, B737_ASSUMPTIONS, B737_ASSUMPTIONS.lrcTable!);
  assert.equal(result.rows.length, 71);
  assert.ok(result.rmsPct <= 12, `СКО ${result.rmsPct}%`);
  for (const r of result.rows) assert.ok(Math.abs(r.errorPct) <= 20, `ошибка ${r.errorPct}% при ${r.massKg} кг / FL${r.fl}`);
});
