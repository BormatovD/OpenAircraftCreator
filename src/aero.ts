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
