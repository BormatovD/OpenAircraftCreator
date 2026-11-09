// Массовая сводка A320: калибровка на OEW CEO и проверка на NEO без подгонки.
// Запуск: node scripts/masses-a320.ts

import { A320CEO, A320NEO, AC_OEW_KG } from "../src/aircraft/a320.ts";
import { calibrateMasses, computeMasses, type MassNode } from "../src/mass/massTree.ts";
import { GROUP_MAP, analogueShares } from "../src/mass/analogue.ts";

const k = calibrateMasses(A320CEO, AC_OEW_KG.a320ceo, analogueShares(), GROUP_MAP);
const ceo = computeMasses(A320CEO, k);
const neo = computeMasses(A320NEO, k);

const print = (n: MassNode, depth = 0): void => {
  const pad = "  ".repeat(depth);
  const ata = n.ata ? `ATA ${n.ata}` : "";
  console.log(
    `${pad}${n.label.padEnd(36 - depth * 2)} ${ata.padEnd(10)} raw ${Math.round(n.rawKg).toString().padStart(6)}  →  ${Math.round(n.kg).toString().padStart(6)} кг${k.has(n.id) ? `  ×${k.get(n.id)!.toFixed(2)}` : ""}`,
  );
  n.children.forEach((c) => print(c, depth + 1));
};

console.log(`Raymer «как есть» CEO: ${Math.round(ceo.rawOewKg)} кг; цель AC ${AC_OEW_KG.a320ceo} кг; множители по узлам — справа`);
ceo.roots.forEach((r) => print(r));
const err = ((neo.oewKg - AC_OEW_KG.a320neo) / AC_OEW_KG.a320neo) * 100;
console.log(`\nNEO без подгонки: ${Math.round(neo.oewKg)} кг; AC ${AC_OEW_KG.a320neo} кг; ошибка ${err.toFixed(1)}%`);
console.log(`Разница NEO − CEO: модель ${Math.round(neo.oewKg - ceo.oewKg)} кг, AC ${AC_OEW_KG.a320neo - AC_OEW_KG.a320ceo} кг`);
for (const id of ["engines", "nacelles", "wingtips", "gear.main", "fuel"]) {
  console.log(`  ${id.padEnd(10)} ${Math.round(neo.byId.get(id)!.kg - ceo.byId.get(id)!.kg)} кг`);
}
