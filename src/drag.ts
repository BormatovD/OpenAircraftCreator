// Сопротивление по составляющим (Raymer, гл. 12, «component buildup»):
//   CD0 = Σ Cf_i · FF_i · Q_i · Swet_i / Sref · (1 + прочее)
//   Cf — турбулентная пластина по числу Рейнольдса агрегата на крейсере, с поправкой на сжимаемость;
//   FF — форм-фактор (толщина профиля, удлинение тела), Q — интерференция.
// Индуктивное — CL²/(π A e), e по Оберту: e = 1/(1,05 + 0,007·π·A).
// Волновое — по уравнению Корна (число Маха расходимости) и закону Локка: CDw = 20 (M − Mcr)⁴.
// Абсолютный уровень привязан к поляре Poll & Schumann для A320 (CD0 = 0,019, e = 0,78) одним
// множителем на каждую часть; формулы дают чувствительность к рычагам.

import { isa, flightLevelToM } from "./atmosphere.ts";
import { type AircraftDefinition, aeroSpanM } from "./definition.ts";
import { fuselageWettedAreaM2, nacelleWettedAreaM2 } from "./mass/raymer.ts";

export const DRAG_REF = { mach: 0.78, fl: 350 };
/** Прочее (протуберанцы, щели, зализ хвоста, пилоны): доля от суммы агрегатов. Допущение по Raymer (5–10%). */
export const MISC_SHARE = 0.08;
/** Константа Корна: 0,87 — обычный профиль, 0,95 — суперкритический. Крыло A320 — суперкритическое. */
export const KORN_KAPPA = 0.935;
export const NACELLE_Q = { pylon: 1.3, "close-coupled": 1.5 } as const;

export interface DragComponent {
  id: "wing" | "fuselage" | "htail" | "vtail" | "nacelles";
  label: string;
  swetM2: number;
  reynolds: number;
  cf: number;
  ff: number;
  q: number;
  /** Вклад в CD0 до калибровки (относительно Sref). */
  cd0: number;
}

export interface DragBuildup {
  components: DragComponent[];
  misc: number;
  cd0: number;
}

const rad = (d: number) => (d * Math.PI) / 180;

function cfTurbulent(re: number, mach: number): number {
  return 0.455 / (Math.pow(Math.log10(re), 2.58) * Math.pow(1 + 0.144 * mach * mach, 0.65));
}

/** Средняя относительная толщина крыла: корневая из определения × 0,75 (к концу профиль тоньше). Допущение. */
export function wingMeanTc(def: AircraftDefinition): number {
  return (def.wing.thicknessRootPct / 100) * 0.75;
}

export function dragBuildup(def: AircraftDefinition, mach = DRAG_REF.mach, fl = DRAG_REF.fl): DragBuildup {
  const atm = isa(flightLevelToM(fl));
  const v = mach * atm.speedOfSoundMs;
  // Кинематическая вязкость по Сазерленду.
  const mu = (1.458e-6 * Math.pow(atm.temperatureK, 1.5)) / (atm.temperatureK + 110.4);
  const rePerM = (atm.densityKgM3 * v) / mu;
  const S = def.wing.areaM2;
  const w = def.wing;
  const cr = (2 * S) / (w.spanM * (1 + w.taper));
  const mac = (2 / 3) * cr * ((1 + w.taper + w.taper ** 2) / (1 + w.taper));
  const ffLifting = (tc: number, sweepMaxT: number) =>
    (1 + (0.6 / 0.35) * tc + 100 * Math.pow(tc, 4)) * 1.34 * Math.pow(mach, 0.18) * Math.pow(Math.cos(rad(sweepMaxT)), 0.28);

  const comps: DragComponent[] = [];
  const add = (id: DragComponent["id"], label: string, swet: number, len: number, ff: number, q: number) => {
    const re = rePerM * len;
    const cf = cfTurbulent(re, mach);
    comps.push({ id, label, swetM2: swet, reynolds: re, cf, ff, q, cd0: (cf * ff * q * swet) / S });
  };

  // Крыло: омываемая — по открытой части (без центроплана в фюзеляже).
  const tc = wingMeanTc(def);
  const sExp = S - def.fuselage.widthM * cr;
  add("wing", "Крыло", 2 * (1 + 0.2 * tc) * sExp, mac, ffLifting(tc, w.sweepQuarterDeg - 2), 1.0);

  const fus = def.fuselage;
  const d = (fus.widthM + fus.heightM) / 2;
  const fr = fus.lengthM / d;
  add("fuselage", "Фюзеляж", fuselageWettedAreaM2(def), fus.lengthM, 1 + 60 / fr ** 3 + fr / 400, 1.0);

  const tail = (t: AircraftDefinition["htail"]) => {
    const c = t.areaM2 / t.spanM;
    return { swet: 2 * (1 + 0.2 * (t.thicknessPct / 100)) * t.areaM2 * 0.9, c };
  };
  const ht = tail(def.htail);
  add("htail", "Горизонтальное оперение", ht.swet, ht.c, ffLifting(def.htail.thicknessPct / 100, def.htail.sweepDeg - 2), 1.04);
  const vt = tail(def.vtail);
  add("vtail", "Вертикальное оперение", vt.swet, vt.c, ffLifting(def.vtail.thicknessPct / 100, def.vtail.sweepDeg - 2), 1.04);

  const e = def.engine;
  const fn = e.nacelleLengthM / e.nacelleWidthM;
  // Интерференция гондолы с крылом — по типу установки (Raymer, табл. 12.6).
  add("nacelles", "Гондолы", nacelleWettedAreaM2(def) * e.count, e.nacelleLengthM, 1 + 0.35 / fn, NACELLE_Q[e.installation]);

  const sum = comps.reduce((s, c) => s + c.cd0, 0);
  return { components: comps, misc: sum * MISC_SHARE, cd0: sum * (1 + MISC_SHARE) };
}

/** Коэффициент Освальда по Оберту (транспортные самолёты). */
export function oswaldObert(aspectRatio: number): number {
  return 1 / (1.05 + 0.007 * Math.PI * aspectRatio);
}

export interface WaveParams {
  kappa: number;
  tc: number;
  cosSweep: number;
  /** Общий множитель сопротивления текущей конфигурации. */
  dragFactor?: number;
}

export function waveParams(def: AircraftDefinition): WaveParams {
  return { kappa: def.wing.airfoil.kornKappa, tc: wingMeanTc(def), cosSweep: Math.cos(rad(def.wing.sweepQuarterDeg)) };
}

/** Число Маха расходимости (Корн) и критическое (Локк). */
export function dragDivergenceMach(w: WaveParams, cl: number): { mdd: number; mcr: number } {
  const c = w.cosSweep;
  const mdd = w.kappa / c - w.tc / (c * c) - cl / (10 * c * c * c);
  return { mdd, mcr: mdd - Math.pow(0.1 / 80, 1 / 3) };
}

export function waveDrag(w: WaveParams, cl: number, mach: number): number {
  const { mcr } = dragDivergenceMach(w, cl);
  return mach > mcr ? (w.dragFactor ?? 1) * 20 * Math.pow(mach - mcr, 4) : 0;
}

export function aspectRatioOf(def: AircraftDefinition): number {
  const b = aeroSpanM(def);
  return (b * b) / def.wing.areaM2;
}
