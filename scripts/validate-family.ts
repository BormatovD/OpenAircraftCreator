// Проверка модели на A319, A321 и самолётах Boeing (737-300, 757-200) без подгонки — калибровка A320 как есть.
// Запуск: node scripts/validate-family.ts [-v]   (npm run validate)

import { writeFileSync } from "node:fs";
import { A320_CONTEXT as ctx } from "../src/aircraft/a320Context.ts";
import { boeingCases, errorSplit, relativeOewErrorPct, residualFactor, validateBoeing, validateFamily } from "../src/validation.ts";

const v = process.argv.includes("-v");
const s = (x: number, d = 1) => `${x >= 0 ? "+" : ""}${x.toFixed(d)}`;
const fam = validateFamily(ctx);
for (const r of fam) {
  console.log(
    `${r.c.name.padEnd(24)} ${r.c.role.padEnd(10)} дальность: СКО ${r.rmsPct.toFixed(1)}%, среднее ${s(r.biasPct)}%, max ${r.maxAbsPct.toFixed(1)}% | ` +
      `OEW график ${Math.round(r.oewChartKg)}, модель ${Math.round(r.oewModelKg)} кг; относительно A320 ${s(relativeOewErrorPct(r, fam))}%`,
  );
  if (v) for (const x of r.rows) console.log(`    ${x.curve.padEnd(20)} ${x.corner.padEnd(10)} ${String(x.chartNm).padStart(5)} → ${Math.round(x.modelNm).toString().padStart(5)} nm ${s(x.errorPct).padStart(6)}%`);
}
// Множитель остатка подбирается долго (≈10 с на тип) — результат сохраняется для страницы «Как рассчитано».
const saved: Record<string, unknown> = { _about: "Сгенерировано scripts/validate-family.ts (npm run validate) — не править вручную." };
for (const c of boeingCases()) {
  const r = validateBoeing(ctx, c);
  const k = residualFactor(ctx, c);
  console.log(
    `${c.name.padEnd(24)} ${String(r.points.length).padStart(3)} точек: без подгонки СКО ${r.rmsPct.toFixed(1)}%, среднее ${s(r.biasPct)}% | ` +
      (c.oewKg ? `OEW Boeing ${c.oewKg}, модель ${Math.round(r.oewModelKg)} кг (${s(((r.oewModelKg - c.oewKg) / c.oewKg) * 100)}%)` : `OEW модель ${Math.round(r.oewModelKg)} кг`) + ` | остаток ×${k.factor.toFixed(3)} → СКО ${k.rmsPct.toFixed(1)}%`,
  );
  const sp = errorSplit(ctx, c);
  console.log(`    крейсер (кг/nm) ${s(sp.cruisePct)}%, постоянное топливо ${s(sp.fixedKg, 0)} кг (по графику ≈${Math.round(sp.fixedChartKg)} кг)`);
  console.log(`    профиль: ${c.as.cruiseSpeedMode === "lrc" ? "LRC по таблице" : `M ${c.as.cruiseMach}`}; вне таблицы ${r.lrcFallbackPoints}, ограничение высоты ${r.flightLevelLimitedPoints}, нехватка резервов ${r.reserveShortfallPoints} точек`);
  saved[c.def.id] = {
    blindRmsPct: r.rmsPct,
    blindBiasPct: r.biasPct,
    points: r.points.length,
    oewModelKg: r.oewModelKg,
    residualFactor: k.factor,
    fittedRmsPct: k.rmsPct,
    fittedMaxAbsPct: k.maxAbsPct,
    cruisePct: sp.cruisePct,
    fixedKg: sp.fixedKg,
    fixedChartKg: sp.fixedChartKg,
    cruiseSpeedMode: c.as.cruiseSpeedMode ?? "fixedMach",
    lrcFallbackPoints: r.lrcFallbackPoints,
    flightLevelLimitedPoints: r.flightLevelLimitedPoints,
    reserveShortfallPoints: r.reserveShortfallPoints,
  };
}
// Разложение для 737-300: что дали конкретные отличия от A320 (профиль, установка гондолы, правило резервов).
{
  const c = boeingCases()[0];
  const sc = (def: typeof c.def, as: typeof c.as) => validateBoeing(ctx, { ...c, def, as }).biasPct;
  const plain = { ...c.def, wing: { ...c.def.wing, airfoil: { kind: "supercritical" as const, kornKappa: 0.935 } }, engine: { ...c.def.engine, installation: "pylon" as const } };
  const steps = [
    ["как у A320: суперкритический профиль, гондола на пилоне, резерв — ожидание", sc(plain, { ...c.as, finalReserveMode: "hold" })],
    ["+ резервы ATA: 45 мин крейсера, а не ожидания", sc(plain, c.as)],
    ["+ обычный профиль крыла (κ 0,87)", sc({ ...plain, wing: c.def.wing }, c.as)],
    ["+ гондола вплотную под крылом (Q 1,5)", sc(c.def, c.as)],
  ] as [string, number][];
  for (const [n, b] of steps) console.log(`  737-300 ${n}: среднее ${s(b)}%`);
  saved.b737Steps = steps;
}
writeFileSync(new URL("../data/validation-boeing.json", import.meta.url), JSON.stringify(saved, null, 2));
