// Реальный цикл двухконтурного двигателя с раздельными соплами — параметрический расчёт в точке крейсера
// (Mattingly, «Elements of Propulsion», гл. 7; Mattingly–Heiser–Pratt, «Aircraft Engine Design», гл. 4).
//
// Каждый параметр — физическая величина, за которой стоит конкретное инженерное решение:
//   t4K          — температура газа перед турбиной: монокристаллические лопатки ТВД, термобарьерные покрытия,
//                  керамические (CMC) детали — всё, что позволяет горячее;
//   coolingFrac  — доля воздуха ядра на охлаждение турбины: чем лучше материалы и каналы охлаждения, тем меньше;
//   fanEff, compEff, hptEff, lptEff — политропные КПД узлов: широкохордные и 3D-лопатки, зазоры, число ступеней;
//   gearbox      — редуктор вентилятора: ТНД вращается быстро и с высоким КПД, теряется ≈0,5% мощности в редукторе;
//   bypassRatio, overallPressureRatio — уже были.
// Степень повышения давления вентилятора подбирается оптимальной для заданной двухконтурности (максимум тяги
// на килограмм воздуха ядра) — так проектируют реальные двигатели.
//
// Модель отдаёт TSFC «на стенде», без гондолы: сопротивление гондолы считается в аэродинамике.

import { flightLevelToM, isa } from "./atmosphere.ts";

const CPC = 1004.5; // теплоёмкость воздуха, Дж/(кг·К)
const GC = 1.4;
const CPT = 1156; // продуктов сгорания
const GT = 1.33;
const LHV = 43.2e6;
const ETA_BURNER = 0.995;
const PI_BURNER = 0.95;
const PI_INLET = 0.995;
const PI_NOZZLE = 0.99;
const ETA_MECH = 0.99;
const ETA_GEARBOX = 0.995;
/** Коэффициент скорости сопел (неполное расширение, трение). */
const CV = 0.985;

export interface CycleParams {
  bypassRatio: number;
  /** Суммарная степень сжатия (вентилятор × компрессор) в крейсере. */
  overallPressureRatio: number;
  t4K: number;
  coolingFrac: number;
  fanEff: number;
  compEff: number;
  hptEff: number;
  lptEff: number;
  gearbox: boolean;
}

export interface CycleResult {
  ok: boolean;
  fanPressureRatio: number;
  /** TSFC, кг/(Н·с). */
  tsfc: number;
  /** Удельная тяга на кг воздуха ядра, Н·с/кг. */
  specificThrustCore: number;
  fuelAirRatio: number;
  coreJetMs: number;
  bypassJetMs: number;
  /** Тепловой КПД (прирост кинетической энергии струй / теплота топлива) и пропульсивный. */
  etaThermal: number;
  etaPropulsive: number;
  etaOverall: number;
}

function cycleAt(p: CycleParams, piF: number, mach: number, altitudeM: number): CycleResult {
  const bad: CycleResult = { ok: false, fanPressureRatio: piF, tsfc: Infinity, specificThrustCore: 0, fuelAirRatio: 0, coreJetMs: 0, bypassJetMs: 0, etaThermal: 0, etaPropulsive: 0, etaOverall: 0 };
  const atm = isa(altitudeM);
  const T0 = atm.temperatureK;
  const V0 = mach * atm.speedOfSoundMs;
  const tauR = 1 + ((GC - 1) / 2) * mach * mach;
  const piR = Math.pow(tauR, GC / (GC - 1));
  const Tt2 = T0 * tauR;

  // Вентилятор (наружный контур и корень перед ядром — одна степень сжатия).
  const tauF = Math.pow(piF, (GC - 1) / (GC * p.fanEff));
  const piC = p.overallPressureRatio / piF;
  if (piC < 1.5) return bad;
  const tauC = Math.pow(piC, (GC - 1) / (GC * p.compEff));
  const Tt25 = Tt2 * tauF;
  const Tt3 = Tt25 * tauC;

  // Камера сгорания: часть воздуха ядра (β) идёт мимо неё на охлаждение турбины.
  const beta = p.coolingFrac;
  const f = (CPT * p.t4K - CPC * Tt3) / (ETA_BURNER * LHV - CPT * p.t4K); // на кг воздуха через камеру
  if (f <= 0) return bad;
  const mHot = (1 - beta) * (1 + f); // на кг воздуха ядра
  // Охлаждение: половина отбора смешивается перед ротором ТВД (сопловой аппарат), половина — после ТВД (лопатки ротора).
  const b1 = beta / 2;
  const m41 = mHot + b1;
  const Tt41 = (mHot * CPT * p.t4K + b1 * CPC * Tt3) / (m41 * CPT);

  // ТВД вращает компрессор, ТНД — вентилятор (через редуктор, если он есть).
  const wHpt = (CPC * (Tt3 - Tt25)) / ETA_MECH;
  const tauTH = 1 - wHpt / (m41 * CPT * Tt41);
  const mGas = m41 + (beta - b1);
  const Tt45 = (m41 * CPT * Tt41 * tauTH + (beta - b1) * CPC * Tt3) / (mGas * CPT);
  const wLpt = ((1 + p.bypassRatio) * CPC * (Tt25 - Tt2)) / (ETA_MECH * (p.gearbox ? ETA_GEARBOX : 1));
  const tauTL = 1 - wLpt / (mGas * CPT * Tt45);
  if (tauTH <= 0.2 || tauTL <= 0.2) return bad;
  const piTH = Math.pow(tauTH, GT / ((GT - 1) * p.hptEff));
  const piTL = Math.pow(tauTL, GT / ((GT - 1) * p.lptEff));
  const Tt5 = Tt45 * tauTL;

  // Сопла — полное расширение до давления окружающей среды.
  const pt9p0 = piR * PI_INLET * piF * piC * PI_BURNER * piTH * piTL * PI_NOZZLE;
  if (pt9p0 <= 1.01) return bad;
  const T9 = Tt5 * Math.pow(pt9p0, -(GT - 1) / GT);
  const V9 = CV * Math.sqrt(2 * CPT * (Tt5 - T9));
  const pt19p0 = piR * PI_INLET * piF * PI_NOZZLE;
  const Tt19 = Tt2 * tauF;
  const T19 = Tt19 * Math.pow(pt19p0, -(GC - 1) / GC);
  const V19 = CV * Math.sqrt(2 * CPC * Math.max(0, Tt19 - T19));
  if (V19 <= V0) return bad;

  const fuel = (1 - beta) * f; // кг топлива на кг воздуха ядра
  const F = mGas * V9 - V0 + p.bypassRatio * (V19 - V0); // Н·с на кг воздуха ядра (тяга на единицу расхода ядра)
  if (F <= 0) return bad;
  const dKE = 0.5 * (mGas * V9 * V9 - V0 * V0 + p.bypassRatio * (V19 * V19 - V0 * V0));
  const etaTh = dKE / (fuel * LHV);
  const etaP = (F * V0) / dKE;
  return {
    ok: true,
    fanPressureRatio: piF,
    tsfc: fuel / F,
    specificThrustCore: F,
    fuelAirRatio: fuel,
    coreJetMs: V9,
    bypassJetMs: V19,
    etaThermal: etaTh,
    etaPropulsive: etaP,
    etaOverall: etaTh * etaP,
  };
}

export const CYCLE_REF = { mach: 0.78, fl: 350 };

/** Цикл с оптимальной степенью повышения давления вентилятора (минимум TSFC при заданной двухконтурности). */
export function runCycle(p: CycleParams, mach = CYCLE_REF.mach, fl = CYCLE_REF.fl): CycleResult {
  const h = flightLevelToM(fl);
  // Минимум TSFC по πf: сетка (на краях цикл может не сходиться), затем золотое сечение вокруг лучшей точки.
  const g = (x: number) => cycleAt(p, x, mach, h).tsfc;
  let best = 1.3;
  for (let x = 1.1; x <= 3.5; x += 0.05) if (g(x) < g(best)) best = x;
  const phi = (Math.sqrt(5) - 1) / 2;
  let a = Math.max(1.05, best - 0.05);
  let b = best + 0.05;
  for (let i = 0; i < 30; i++) {
    const c = b - phi * (b - a);
    const d = a + phi * (b - a);
    if (g(c) < g(d)) b = d;
    else a = c;
  }
  return cycleAt(p, (a + b) / 2, mach, h);
}
