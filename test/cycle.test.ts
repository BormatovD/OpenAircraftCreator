import { test } from "node:test";
import assert from "node:assert/strict";
import { A320CEO, A320NEO } from "../src/aircraft/a320.ts";
import { B737_300 } from "../src/aircraft/b737.ts";
import { runCycle } from "../src/cycle.ts";
import { cycleParamsOf, engineCycle } from "../src/propulsion.ts";

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
