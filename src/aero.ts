// Параболическая поляра: CD = CD0 + CL² / (π · AR · e).
// Значения CD0 и e для A320 — оценка по методу Poll & Schumann (Aeronautical Journal, ч. 2–3):
// CD0 ≈ 0,019, e ≈ 0,78 при удлинении ≈ 9,5. Это закреплённая («литературная») часть калибровки:
// TSFC выводится из диаграмм нагрузка–дальность при фиксированной аэродинамике.

import { type WaveParams, waveDrag } from "./drag.ts";

export interface AeroConfig {
  wingAreaM2: number;
  spanM: number;
  cd0: number;
  oswald: number;
  /** Параметры волнового сопротивления; без них поляра — чисто параболическая. */
  wave?: WaveParams;
  /**
   * CD0 задан на эталонном эшелоне (FL350, M 0,78). Трение зависит от числа Рейнольдса: выше — воздух реже, Re меньше,
   * коэффициент трения больше. Таблица множителей CD0 по эшелонам — из того же расчёта по составляющим.
   */
  cd0Scale?: { fl: number[]; k: number[] };
}

/** Поляра на данном эшелоне: CD0 с поправкой на число Рейнольдса. Без таблицы — как есть. */
export function aeroAtFl(a: AeroConfig, fl: number): AeroConfig {
  const t = a.cd0Scale;
  if (!t) return a;
  const { fl: x, k } = t;
  let f: number;
  if (fl <= x[0]) f = k[0];
  else if (fl >= x[x.length - 1]) f = k[k.length - 1];
  else {
    let i = 1;
    while (x[i] < fl) i++;
    f = k[i - 1] + ((k[i] - k[i - 1]) * (fl - x[i - 1])) / (x[i] - x[i - 1]);
  }
  return { ...a, cd0: a.cd0 * f };
}

export function aspectRatio(a: AeroConfig): number {
  return (a.spanM * a.spanM) / a.wingAreaM2;
}

export function inducedFactor(a: AeroConfig): number {
  return 1 / (Math.PI * aspectRatio(a) * a.oswald);
}

/** CD при данном CL; если задано число Маха и параметры волны — с волновым сопротивлением. */
export function dragCoefficient(a: AeroConfig, cl: number, mach?: number): number {
  const wave = a.wave && mach !== undefined ? waveDrag(a.wave, cl, mach) : 0;
  return a.cd0 + inducedFactor(a) * cl * cl + wave;
}

export function liftToDrag(a: AeroConfig, cl: number, mach?: number): number {
  return cl / dragCoefficient(a, cl, mach);
}

export function maxLiftToDrag(a: AeroConfig): number {
  return 0.5 * Math.sqrt(1 / (a.cd0 * inducedFactor(a)));
}

export function clForWeight(a: AeroConfig, weightN: number, densityKgM3: number, speedMs: number): number {
  const q = 0.5 * densityKgM3 * speedMs * speedMs;
  return weightN / (q * a.wingAreaM2);
}
