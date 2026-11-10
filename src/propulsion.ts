// Двигатель в расчёте: TSFC = TSFC_опорный × TSFC_цикл(двигатель) / TSFC_цикл(опорный).
// TSFC_опорный (CFM56-5B на A320) подобран по диаграммам нагрузка–дальность; разница между двигателями —
// из реального цикла (cycle.ts), где каждый параметр — физическая величина, за которой стоит инженерное решение.

import { type EngineDef } from "./definition.ts";
import { type CycleParams, type CycleResult, runCycle } from "./cycle.ts";

export function cycleParamsOf(e: EngineDef): CycleParams {
  return { bypassRatio: e.bypassRatio, overallPressureRatio: e.overallPressureRatio, ...e.cycle };
}

const cache = new Map<string, CycleResult>();
/** Цикл двигателя в точке калибровки (M 0,78, FL350); кешируется — оценка вызывается тысячи раз. */
export function engineCycle(e: EngineDef): CycleResult {
  const p = cycleParamsOf(e);
  const key = JSON.stringify(p);
  let r = cache.get(key);
  if (!r) {
    r = runCycle(p);
    cache.set(key, r);
  }
  return r;
}

/** Множитель TSFC нового двигателя относительно опорного (откалиброванного). */
export function tsfcFactor(reference: EngineDef, engine: EngineDef): number {
  return engineCycle(engine).tsfc / engineCycle(reference).tsfc;
}

// ——— Эмпирика по реальным двигателям класса A320 (тяга ≈27 000 lbf) ———
// CFM56-5B: B 5,7, вентилятор 1,73 м, 2 380 кг; LEAP-1A: B 11, 1,98 м, 2 990 кг; PW1100G: B 12,5, ≈2,05 м.
// Диаметр по линии через CFM56 и LEAP; PW1100G ложится на неё с точностью ±0,02 м — независимая проверка.

export const BPR_VALID_RANGE = [5, 13] as const;

export function fanDiameterForBpr(bpr: number): number {
  return 1.73 + ((1.98 - 1.73) / (11 - 5.7)) * (bpr - 5.7);
}

/** Сухая масса прямоприводного двигателя по линии CFM56 → LEAP. */
export function dryMassForBpr(bpr: number): number {
  return 2380 + ((2990 - 2380) / (11 - 5.7)) * (bpr - 5.7);
}

export function bprInValidRange(bpr: number): boolean {
  return bpr >= BPR_VALID_RANGE[0] && bpr <= BPR_VALID_RANGE[1];
}

/**
 * Зависимость TSFC от числа Маха по Howe («Aircraft Conceptual Design Synthesis», 2000):
 * TSFC ∝ 1 + 0,28·(1 + 0,063·B²)·M. Нормировано на точку калибровки M 0,78; степень двухконтурности
 * ограничена 8 — дальше формула Howe завышает чувствительность.
 */
export function tsfcMachFactor(bypassRatio: number, mach: number, machRef = 0.78): number {
  if (!HOWE_MACH_TSFC) return 1;
  const b = Math.min(bypassRatio, 8);
  const k = 0.28 * (1 + 0.063 * b * b);
  return (1 + k * mach) / (1 + k * machRef);
}

/**
 * Формула Howe описывает двигатель при постоянном режиме. В крейсере режим следует за сопротивлением: на меньшем Махе
 * двигатель дросселирован, и выигрыш от меньшего входного импульса съедает рост удельного расхода на частичном режиме.
 * Проверка по таблице Long Range Cruise Control FCOM 737-8 (M 0,53–0,80, 40–85 т, FL250–410): с формулой Howe ошибка
 * расхода от −1 до −22% и растёт к малым Махам; с постоянным TSFC — −3% ± 1,3% по всей таблице. Поэтому по умолчанию — выключена.
 */
export const HOWE_MACH_TSFC = false;
