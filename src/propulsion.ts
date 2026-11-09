// Модель двигателя для рычагов: общий КПД = термический (ядро) × пропульсивный (вентилятор).
//   TSFC = V / (η_th · η_p · LHV)  →  рычаги меняют TSFC относительно откалиброванной точки.
//
// Пропульсивный КПД: ядро отдаёт удельную работу w (Дж на кг воздуха через ядро); при двухконтурности B
// её делит поток (1 + B):  V_j = √(V² + 2w/(1+B)),  η_p = 2V / (V + V_j).
// Термический КПД: идеальный цикл Брайтона по степени сжатия × коэффициент прочих технологий ядра.
//
// Разделение выигрыша NEO (TSFC −16,5% по диаграммам AC при сопротивлении по составляющим — большая гондола
// LEAP добавляет ≈5 каунтов) на «ядро» и «вентилятор» — допущение: ядру приписан только эффект роста степени
// сжатия 32,6 → 40 по идеальному циклу (+3,3%), остальное — вентилятору. Отсюда w ≈ 753 кДж/кг
// и η_p ≈ 0,61 (CEO) / 0,71 (NEO). При других оценках степени сжатия CFM56-5B (27–35,5) η_p CEO = 0,62–0,76.

import { type EngineDef } from "./definition.ts";

/** Удельная работа ядра, Дж/кг; выведена из калибровки CEO/NEO при допущении выше. */
export const CORE_SPECIFIC_WORK = 753_000;
/** Крейсерская скорость точки калибровки: M 0,78 на FL350. */
export const V_CRUISE_REF = 0.78 * 296.5;

export function propulsiveEfficiency(bypassRatio: number, v = V_CRUISE_REF, w = CORE_SPECIFIC_WORK): number {
  const vj = Math.sqrt(v * v + (2 * w) / (1 + bypassRatio));
  return (2 * v) / (v + vj);
}

export function thermalEfficiency(opr: number, techFactor: number): number {
  return (1 - Math.pow(opr, -0.4 / 1.4)) * techFactor;
}

export function overallEfficiency(e: EngineDef): number {
  return propulsiveEfficiency(e.bypassRatio) * thermalEfficiency(e.overallPressureRatio, e.coreTechFactor);
}

/** Множитель TSFC нового двигателя относительно опорного (откалиброванного). */
export function tsfcFactor(reference: EngineDef, engine: EngineDef): number {
  return overallEfficiency(reference) / overallEfficiency(engine);
}

// ——— Эмпирика по реальным двигателям класса A320 (тяга ≈27 000 lbf) ———
// CFM56-5B: B 5,7, вентилятор 1,73 м, 2 380 кг; LEAP-1A: B 11, 1,98 м, 2 990 кг; PW1100G: B 12,5, ≈2,05 м.
// Диаметр по линии через CFM56 и LEAP; PW1100G ложится на неё с точностью ±0,02 м — независимая проверка.

export const BPR_VALID_RANGE = [5, 13] as const;

export function fanDiameterForBpr(bpr: number): number {
  return 1.73 + ((1.98 - 1.73) / (11 - 5.7)) * (bpr - 5.7);
}

/** Сухая масса прямоприводного двигателя по линии CFM56 → LEAP. PW1100G (редукторный) легче этой линии. */
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
  const b = Math.min(bypassRatio, 8);
  const k = 0.28 * (1 + 0.063 * b * b);
  return (1 + k * mach) / (1 + k * machRef);
}
