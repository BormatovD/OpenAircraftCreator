// Расход каждого двигателя против независимых таблиц Boeing. Никакой подгонки по этим таблицам.
import { writeFileSync } from "node:fs";
import { A320_CONTEXT } from "../src/aircraft/a320Context.ts";
import { B737_300, B737_ASSUMPTIONS } from "../src/aircraft/b737.ts";
import { B737_8, B737_8_ASSUMPTIONS } from "../src/aircraft/b737max.ts";
import { validateCruiseTable } from "../src/validation.ts";

const results = [
  { def: B737_300, as: B737_ASSUMPTIONS },
  { def: B737_8, as: B737_8_ASSUMPTIONS },
].map(({ def, as }) => {
  const result = validateCruiseTable(A320_CONTEXT, def, as, as.lrcTable!);
  console.log(`${def.label}: ${result.rows.length} точек, среднее ${result.biasPct.toFixed(2)}%, СКО ${result.rmsPct.toFixed(2)}%, разброс ${result.sdPct.toFixed(2)}%, пределы ${result.minPct.toFixed(2)}…${result.maxPct.toFixed(2)}%`);
  return { id: def.id, name: def.label, ...result };
});

writeFileSync(new URL("../data/validation-fcom.json", import.meta.url), JSON.stringify({
  _about: "Сгенерировано scripts/validate-fcom.ts (npm run validate:fcom). FF — кг/ч на двигатель; отрицательная ошибка означает, что модель экономичнее таблицы. В расчёт миссии табличный FF не подставляется.",
  results,
}, null, 2) + "\n");
