// Проверка модели на других типах — без подгонки: калибровка A320 (массы, TSFC, поляра) как есть.
//  • A319 и A321 (ceo с «заборчиками» и шарклетами, neo): углы диаграмм нагрузка–дальность Airbus AC 3-2-1
//    и OEW, «зашитый» в эти графики.
//  • Boeing 737-300: точки (взлётная масса, ZFW, дальность) с графика D6-58325-6, 3.2.6, и OEW из 2.1.6.
// Используется скриптом scripts/validate-family.ts, тестами и страницей «Как рассчитано».

import a320Data from "../data/a320.json" with { type: "json" };
import famData from "../data/a319-a321.json" with { type: "json" };
import b737Points from "../data/b737-300-points.json" with { type: "json" };
import b757RbPoints from "../data/b757-200-rb211-points.json" with { type: "json" };
import b757PwPoints from "../data/b757-200-pw2037-points.json" with { type: "json" };
import { B757_ASSUMPTIONS, B757_OEW_KG, B757_PW2037, B757_RB211 } from "./aircraft/b757.ts";
import { type MissionAssumptions } from "./mission.ts";
import b7378Points from "../data/b737-8-points.json" with { type: "json" };
import { B737_8, B737_8_ASSUMPTIONS } from "./aircraft/b737max.ts";
import { A320CEO, A320NEO } from "./aircraft/a320.ts";
import { A319CEO, A319NEO, A321CEO, A321NEO } from "./aircraft/a320family.ts";
import { B737_300, B737_300_OEW_KG, B737_ASSUMPTIONS } from "./aircraft/b737.ts";
import { type AircraftDefinition } from "./definition.ts";
import { type EvalContext, aeroFor, assumptionsFor, engineStateFor } from "./evaluate.ts";
import { computeMasses } from "./mass/massTree.ts";
import { rangeForFuel } from "./mission.ts";
import { type AircraftData, type CornerComparison, chartOewKg, compareAircraft, maxAbsErrorPct, rmsErrorPct } from "./payloadRange.ts";

const DENSITY = 0.785;
const sharklet = (d: AircraftDefinition): AircraftDefinition => ({ ...d, wing: { ...d.wing, tip: "sharklet" } });

export interface FamilyCase {
  type: "A319" | "A320" | "A321";
  name: string;
  data: AircraftData;
  def: AircraftDefinition;
  /** Роль в проверке: по этим графикам подобран TSFC A320ceo — остальное прогноз. */
  role: "калибровка" | "проверка";
}

export function familyCases(): FamilyCase[] {
  const a = a320Data.aircraft as unknown as Record<string, AircraftData>;
  const f = famData.aircraft as unknown as Record<string, AircraftData>;
  return [
    { type: "A320", name: "A320ceo, шарклеты", data: a.ceo_sharklet, def: sharklet(A320CEO), role: "калибровка" },
    { type: "A320", name: "A320ceo, «заборчики»", data: a.ceo_fence, def: A320CEO, role: "проверка" },
    { type: "A320", name: "A320neo", data: a.neo, def: A320NEO, role: "проверка" },
    { type: "A319", name: "A319ceo, «заборчики»", data: f.a319_fence, def: A319CEO, role: "проверка" },
    { type: "A319", name: "A319ceo, шарклеты", data: f.a319_sharklet, def: sharklet(A319CEO), role: "проверка" },
    { type: "A319", name: "A319neo", data: f.a319_neo, def: A319NEO, role: "проверка" },
    { type: "A321", name: "A321ceo, «заборчики»", data: f.a321_fence, def: A321CEO, role: "проверка" },
    { type: "A321", name: "A321ceo, шарклеты", data: f.a321_sharklet, def: sharklet(A321CEO), role: "проверка" },
    { type: "A321", name: "A321neo", data: f.a321_neo, def: A321NEO, role: "проверка" },
  ];
}

export interface FamilyResult {
  c: FamilyCase;
  rows: CornerComparison[];
  rmsPct: number;
  maxAbsPct: number;
  biasPct: number;
  /** OEW из графиков (угол «MTOW + полные баки», кривые без доп. баков) и по модели масс. */
  oewChartKg: number;
  oewModelKg: number;
}

export function validateFamily(ctx: EvalContext): FamilyResult[] {
  const as = assumptionsFor(ctx, []);
  return familyCases().map((c) => {
    const rows = compareAircraft(c.data, aeroFor(c.def, ctx.aero, []), engineStateFor(c.def, ctx, [], as), as, DENSITY);
    const plain = c.data.curves.filter((k) => !k.act);
    const oewChartKg = plain.reduce((s, k) => s + chartOewKg(c.data, k, DENSITY, as.taxiFuelKg), 0) / plain.length;
    return {
      c,
      rows,
      rmsPct: rmsErrorPct(rows),
      maxAbsPct: maxAbsErrorPct(rows),
      biasPct: rows.reduce((s, r) => s + r.errorPct, 0) / rows.length,
      oewChartKg,
      oewModelKg: computeMasses(c.def, ctx.calibration).oewKg,
    };
  });
}

/**
 * Ошибка OEW относительно A320 того же поколения: OEW в графиках AC тяжелее «пустого» OEW из 2-3-0, по которому
 * откалиброваны массы (≈4% у A320), поэтому сравнивается масштабирование модели масс, а не абсолютный уровень.
 */
export function relativeOewErrorPct(r: FamilyResult, all: FamilyResult[]): number {
  const isNeo = r.c.def.engine.bypassRatio > 8;
  const ref = all.find((x) => x.c.type === "A320" && (x.c.def.engine.bypassRatio > 8) === isNeo && x.c.def.wing.tip === r.c.def.wing.tip)
    ?? all.find((x) => x.c.type === "A320" && (x.c.def.engine.bypassRatio > 8) === isNeo)!;
  const k = ref.oewModelKg / ref.oewChartKg;
  return ((r.oewModelKg / r.oewChartKg / k) - 1) * 100;
}

// ——— Boeing: графики «ZFW — дальность» при разных взлётных массах ———

export interface BoeingPoint {
  towKg: number;
  zfwKg: number;
  rangeNm: number;
}

export interface BoeingCase {
  name: string;
  def: AircraftDefinition;
  as: MissionAssumptions;
  points: BoeingPoint[];
  /** OEW по документу; 0 — не приводится. */
  oewKg: number;
  source: string;
}

export function boeingCases(): BoeingCase[] {
  return [
    { name: "737-300 (CFM56-3)", def: B737_300, as: B737_ASSUMPTIONS, points: b737Points as BoeingPoint[], oewKg: B737_300_OEW_KG, source: "D6-58325-6, 3.2.6" },
    { name: "737-8 (LEAP-1B)", def: B737_8, as: B737_8_ASSUMPTIONS, points: b7378Points as BoeingPoint[], oewKg: 0, source: "D6-38A004, 3.2.3 (растровый график)" },
    { name: "757-200 (RB211-535E4)", def: B757_RB211, as: B757_ASSUMPTIONS, points: b757RbPoints as BoeingPoint[], oewKg: B757_OEW_KG.rb211, source: "D6-58327, 3.2.2" },
    { name: "757-200 (PW2037)", def: B757_PW2037, as: B757_ASSUMPTIONS, points: b757PwPoints as BoeingPoint[], oewKg: B757_OEW_KG.pw2037, source: "D6-58327, 3.2.3" },
  ];
}

export interface BoeingResult {
  c: BoeingCase;
  points: (BoeingPoint & { modelNm: number; errorPct: number })[];
  rmsPct: number;
  maxAbsPct: number;
  biasPct: number;
  oewModelKg: number;
}

function boeingErrors(c: BoeingCase, ctx: EvalContext, k = 1) {
  const aero = aeroFor(c.def, ctx.aero, []);
  const e0 = engineStateFor(c.def, ctx, [], c.as);
  const engine = { ...e0, tsfcCruise: e0.tsfcCruise * k };
  return c.points.map((p) => {
    const modelNm = rangeForFuel(aero, engine, c.as, p.towKg, p.towKg - p.zfwKg).rangeNm;
    return { ...p, modelNm, errorPct: ((modelNm - p.rangeNm) / p.rangeNm) * 100 };
  });
}

const rms = (x: number[]) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);

export function validateBoeing(ctx: EvalContext, c: BoeingCase): BoeingResult {
  const points = boeingErrors(c, ctx);
  const errs = points.map((p) => p.errorPct);
  return {
    c,
    points,
    rmsPct: rms(errs),
    maxAbsPct: Math.max(...errs.map(Math.abs)),
    biasPct: errs.reduce((s, v) => s + v, 0) / errs.length,
    oewModelKg: computeMasses(c.def, ctx.calibration).oewKg,
  };
}

/** Множитель расхода, при котором модель ложится на график, — мера того, что модель пока не объясняет. Долгий расчёт. */
export function residualFactor(ctx: EvalContext, c: BoeingCase): { factor: number; rmsPct: number; maxAbsPct: number } {
  const f = (k: number) => rms(boeingErrors(c, ctx, k).map((p) => p.errorPct));
  const phi = (Math.sqrt(5) - 1) / 2;
  let a = 0.8;
  let b = 1.5;
  for (let i = 0; i < 20; i++) {
    const x = b - phi * (b - a);
    const y = a + phi * (b - a);
    if (f(x) < f(y)) b = y;
    else a = x;
  }
  const k = (a + b) / 2;
  const e = boeingErrors(c, ctx, k).map((p) => p.errorPct);
  return { factor: k, rmsPct: rms(e), maxAbsPct: Math.max(...e.map(Math.abs)) };
}

// ——— Разложение ошибки Boeing: крейсер и «постоянное» топливо ———

/**
 * На каждой линии взлётной массы топливо почти линейно по дальности: m = a + b·R. Наклон b (кг/nm) — экономичность
 * крейсера (сопротивление × TSFC), отрезок a — топливо, не зависящее от дальности (резервы, взлёт, набор, снижение).
 * Сравнение a и b графика и модели разделяет две ошибки, которые в процентах дальности складываются и могут гасить друг друга.
 */
export interface ErrorSplit {
  /** Ошибка расхода на милю в крейсере, %: минус — модель экономичнее графика. */
  cruisePct: number;
  /** Ошибка постоянного топлива, кг: плюс — модель тратит больше на резервы, набор и снижение. */
  fixedKg: number;
  /** Постоянное топливо по графику, кг (среднее по линиям). */
  fixedChartKg: number;
  lines: { towKg: number; cruisePct: number; fixedKg: number }[];
}

function linFit(x: number[], y: number[]) {
  const n = x.length;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  const b = x.reduce((s, xi, i) => s + (xi - mx) * (y[i] - my), 0) / x.reduce((s, xi) => s + (xi - mx) ** 2, 0);
  return { a: my - b * mx, b };
}

export function errorSplit(ctx: EvalContext, c: BoeingCase): ErrorSplit {
  const pts = boeingErrors(c, ctx);
  const tows = [...new Set(pts.map((p) => Math.round(p.towKg / 100)))].sort((a, b) => a - b);
  const lines: ErrorSplit["lines"] = [];
  let chartA = 0;
  for (const t of tows) {
    const on = pts.filter((p) => Math.round(p.towKg / 100) === t);
    if (on.length < 3) continue;
    const fuel = on.map((p) => p.towKg - p.zfwKg);
    const ch = linFit(on.map((p) => p.rangeNm), fuel);
    const mo = linFit(on.map((p) => p.modelNm), fuel);
    chartA += ch.a;
    lines.push({ towKg: t * 100, cruisePct: (mo.b / ch.b - 1) * 100, fixedKg: mo.a - ch.a });
  }
  const avg = (f: (l: ErrorSplit["lines"][number]) => number) => lines.reduce((s, l) => s + f(l), 0) / lines.length;
  return { cruisePct: avg((l) => l.cruisePct), fixedKg: avg((l) => l.fixedKg), fixedChartKg: chartA / lines.length, lines };
}
