import { test } from "node:test";
import assert from "node:assert/strict";
import { A320CEO, A320NEO } from "../src/aircraft/a320.ts";
import { B737_300 } from "../src/aircraft/b737.ts";
import { runCycle } from "../src/cycle.ts";
import { cycleParamsOf, engineCycle } from "../src/propulsion.ts";

test("CFM56-3B2: тяга, BPR, OPR и сухая масса соответствуют одной колонке таблицы CFM", () => {
  // CFM International, «CFM56 Engine Family», стр. 2, колонка -3B2:
  // https://walter.bislins.ch/aviatik/media/cfm-technical-data.pdf
  // BPR — SLS takeoff; OPR — max climb, FL350 / M 0,80 / ISA. Проверка предотвращает
  // смешение имени/тяги -3B2 с данными -3B1 и ошибочным BPR 6,0 из вторичного источника.
  const e = B737_300.engine;
  assert.equal(e.name, "CFM56-3B2");
  assert.equal(e.bypassRatio, 4.9);
  assert.equal(e.overallPressureRatio, 28.8);
  assert.ok(Math.abs(e.dryMassKg / 0.45359237 - 4301) < 0.01, "basic dry weight: 4301 lb");
  assert.ok(Math.abs(e.takeoffThrustKn * 1000 / 4.44822 - 22000) < 0.01, "SLS takeoff thrust: 22000 lbf");
});

test("цикл CFM56-5B: TSFC без гондолы 0,55…0,75 lb/(lbf·h), КПД — в физических пределах", () => {
  const c = engineCycle(A320CEO.engine);
  const lb = c.tsfc * 3600 * 9.80665;
  assert.ok(lb > 0.55 && lb < 0.75, `${lb}`);
  assert.ok(c.etaThermal > 0.3 && c.etaThermal < 0.55 && c.etaPropulsive > 0.6 && c.etaPropulsive < 0.9);
});

test("каждое изменение LEAP против CFM56-5B по отдельности снижает TSFC", () => {
  const ce = cycleParamsOf(A320CEO.engine);
  const ne = cycleParamsOf(A320NEO.engine);
  const base = runCycle(ce).tsfc;
  for (const k of ["t4K", "coolingFrac", "fanEff", "compEff", "hptEff", "lptEff", "bypassRatio"] as const) {
    assert.ok(runCycle({ ...ce, [k]: ne[k] }).tsfc < base, k);
  }
});

test("CFM56-3 расходует больше CFM56-5B, редуктор при B 12,5 — меньше LEAP", () => {
  assert.ok(engineCycle(B737_300.engine).tsfc > engineCycle(A320CEO.engine).tsfc);
  const ne = cycleParamsOf(A320NEO.engine);
  assert.ok(runCycle({ ...ne, bypassRatio: 12.5, gearbox: true, lptEff: ne.lptEff + 0.015 }).tsfc < runCycle(ne).tsfc);
});

test("оптимальный напор вентилятора падает с ростом двухконтурности", () => {
  const ne = cycleParamsOf(A320NEO.engine);
  assert.ok(runCycle({ ...ne, bypassRatio: 13 }).fanPressureRatio < runCycle({ ...ne, bypassRatio: 6 }).fanPressureRatio);
});
