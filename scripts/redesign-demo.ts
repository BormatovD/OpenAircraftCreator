// Сравнение режимов: «та же геометрия» против «перепроектировать под ту же миссию».
// Запуск: node scripts/redesign-demo.ts

import { A320CEO } from "../src/aircraft/a320.ts";
import { A320_CONTEXT as ctx } from "../src/aircraft/a320Context.ts";
import { worstStatus } from "../src/constraints.ts";
import { evaluate } from "../src/evaluate.ts";
import { type Lever, aeroQuality, bypassRatio, compositeWing, pressureRatio, fuselageStretch } from "../src/levers.ts";
import { designMissionOf, redesign } from "../src/redesign.ts";

const base = evaluate(A320CEO, [], ctx);
const mission = designMissionOf(base);
const f0 = (x: number) => Math.round(x).toLocaleString("ru-RU");
const pct = (a: number, b: number) => `${a >= b ? "+" : ""}${(((a - b) / b) * 100).toFixed(1)}%`;
const icon = { ok: "✓", info: "i", warning: "!", violation: "✗" } as const;

console.log(
  `Расчётная миссия A320ceo: ${f0(mission.payloadKg)} кг (180 × 95) на ${f0(mission.rangeNm)} nm. ` +
    `База: MTOW ${f0(A320CEO.weights.mtowKg)} кг, S ${A320CEO.wing.areaM2} м², ${base.fuelPerSeatPer100KmKg.toFixed(3)} кг/место/100 км\n`,
);

const cases: [string, Lever[]][] = [
  ["Без рычагов (самопроверка)", []],
  ["Композитное крыло −20%", [compositeWing(20)]],
  ["Аэродинамическое качество +5%", [aeroQuality(5)]],
  ["Двухконтурность 11 + ядро 40", [bypassRatio(11), pressureRatio(40)]],
  ["Фюзеляж +9 рядов (≈A321)", [fuselageStretch(9)]],
];

for (const [name, levers] of cases) {
  const fixed = evaluate(A320CEO, levers, ctx);
  const rs = redesign(A320CEO, levers, ctx, { ...mission, payloadKg: fixed.seats * 95 });
  const e = rs.evaluation;
  const d = e.definition;
  console.log(`${name}`);
  console.log(
    `  та же геометрия:   OEW ${pct(fixed.oewKg, base.oewKg).padStart(6)} | на место ${pct(fixed.fuelPerSeatPer100KmKg, base.fuelPerSeatPer100KmKg).padStart(6)} | ${icon[worstStatus(fixed.constraints)]}`,
  );
  console.log(
    `  перепроектировать: MTOW ${pct(rs.mtowKg, A320CEO.weights.mtowKg).padStart(6)} (${f0(rs.mtowKg)} кг) | S ${d.wing.areaM2.toFixed(1)} м² | ` +
      `размах ${d.wing.spanM.toFixed(2)} м | тяга ×${d.engine.thrustScale.toFixed(3)} | OEW ${pct(e.oewKg, base.oewKg).padStart(6)} | ` +
      `на место ${pct(e.fuelPerSeatPer100KmKg, base.fuelPerSeatPer100KmKg).padStart(6)} | ${rs.converged ? `сошлось за ${rs.iterations}` : "НЕ СОШЛОСЬ"} | ${icon[worstStatus(e.constraints)]}`,
  );
  for (const c of e.constraints) if (c.status !== "ok") console.log(`     ${icon[c.status]} ${c.label}: ${c.value} — ${c.message}`);
}
