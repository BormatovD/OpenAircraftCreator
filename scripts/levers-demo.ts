// Рычаги на A320ceo (режим «та же геометрия») и проверка критерия фазы 2: переход CEO → NEO.
// Запуск: node scripts/levers-demo.ts

import { A320CEO, A320NEO } from "../src/aircraft/a320.ts";
import { A320_CONTEXT as ctx } from "../src/aircraft/a320Context.ts";
import { type Evaluation, evaluate } from "../src/evaluate.ts";
import {
  type Lever,
  aeroQuality,
  bypassRatio,
  compositeWing,
  gearedFan,
  pressureRatio,
  fuselageStretch,
  lighterHarness,
  wingSpan,
} from "../src/levers.ts";
import { engineCycle } from "../src/propulsion.ts";

const f0 = (x: number) => Math.round(x).toString();
const pct = (a: number, b: number) => `${a >= b ? "+" : ""}${(((a - b) / b) * 100).toFixed(1)}%`;

const base = evaluate(A320CEO, [], ctx);
console.log(
  `База A320ceo: OEW ${f0(base.oewKg)} кг, ${base.seats} мест, дальность со всеми местами ${f0(base.rangeWithMissionPayloadNm)} nm, ` +
    `${base.fuelPerSeatPer100KmKg.toFixed(3)} кг/место/100 км на 1 500 км\n`,
);

const row = (name: string, r: Evaluation) =>
  console.log(
    `${name.padEnd(34)} OEW ${(r.oewKg - base.oewKg >= 0 ? "+" : "") + f0(r.oewKg - base.oewKg)} кг`.padEnd(54) +
      `| мест ${String(r.seats).padStart(3)} | TSFC ${pct(r.tsfcCruise, base.tsfcCruise).padStart(6)} | ` +
      `дальность ${pct(r.rangeWithMissionPayloadNm, base.rangeWithMissionPayloadNm).padStart(6)} | на место ${pct(r.fuelPerSeatPer100KmKg, base.fuelPerSeatPer100KmKg).padStart(6)}` +
      (r.payloadLimitedByMzfw ? " | упор в MZFW" : ""),
  );

const cases: [string, Lever[]][] = [
  ["Композитное крыло −20%", [compositeWing(20)]],
  ["Облегчённые жгуты −15%", [lighterHarness(15)]],
  ["Аэродинамическое качество +2%", [aeroQuality(2)]],
  ["Размах +1,5 м", [wingSpan(1.5)]],
  ["Двухконтурность 5,7 → 11", [bypassRatio(11)]],
  ["Двухконтурность 5,7 → 15", [bypassRatio(15)]],
  ["Степень сжатия 32,6 → 40", [pressureRatio(40)]],
  ["Фюзеляж +3 ряда", [fuselageStretch(3)]],
  ["Фюзеляж −3 ряда", [fuselageStretch(-3)]],
];
for (const [name, levers] of cases) row(name, evaluate(A320CEO, levers, ctx));

console.log("\nКритерий фазы 2 — переход CEO → NEO:");
const neo = evaluate(A320NEO, [], ctx);
row("A320neo (определение NEO целиком)", neo);
console.log(
  `  Airbus: NEO экономит не менее 15% топлива (с кабинными улучшениями — до 20%). Модель: ${pct(neo.fuelPerSeatPer100KmKg, base.fuelPerSeatPer100KmKg)} на место.`,
);
const leap = A320NEO.engine;
const pw = engineCycle({ ...leap, bypassRatio: 12.5, cycle: { ...leap.cycle, gearbox: true, lptEff: leap.cycle.lptEff + 0.015 } }).tsfc / engineCycle(leap).tsfc;
console.log(`  PW1100G (редуктор, двухконтурность 12,5) против LEAP-1A при том же ядре — TSFC ${((pw - 1) * 100).toFixed(1)}%.`);
void gearedFan;
