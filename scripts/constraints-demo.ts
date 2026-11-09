// Ограничения по сценариям. Запуск: node scripts/constraints-demo.ts

import { A320CEO, A320NEO } from "../src/aircraft/a320.ts";
import { A320_CONTEXT as ctx } from "../src/aircraft/a320Context.ts";
import { worstStatus } from "../src/constraints.ts";
import { evaluate } from "../src/evaluate.ts";
import { type Lever, bypassRatio, fuselageStretch, wingSpan } from "../src/levers.ts";
import { type AircraftDefinition } from "../src/definition.ts";

const icon = { ok: "✓", warning: "!", violation: "✗" } as const;
const cases: [string, AircraftDefinition, Lever[]][] = [
  ["A320ceo (база)", A320CEO, []],
  ["A320neo", A320NEO, []],
  ["NEO + размах 1,5 м", A320NEO, [wingSpan(1.5)]],
  ["CEO, двухконтурность 13", A320CEO, [bypassRatio(13)]],
  ["CEO, двухконтурность 16", A320CEO, [bypassRatio(16)]],
  ["CEO, фюзеляж +4 ряда", A320CEO, [fuselageStretch(4)]],
  ["CEO, фюзеляж +9 рядов (≈A321)", A320CEO, [fuselageStretch(9)]],
];

for (const [name, def, levers] of cases) {
  const r = evaluate(def, levers, ctx);
  console.log(`\n${icon[worstStatus(r.constraints)]} ${name}`);
  for (const c of r.constraints) {
    if (c.status === "ok" && name !== "A320ceo (база)") continue;
    console.log(`   ${icon[c.status]} ${c.label}: ${c.value} (${c.limit}) — ${c.message}`);
  }
}
