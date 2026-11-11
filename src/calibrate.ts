// Калибровка: один параметр — крейсерский TSFC — подбирается так, чтобы минимизировать
// среднеквадратичную ошибку дальности по всем углам диаграмм одного типа.

import { type AeroConfig } from "./aero.ts";
import { type EngineState, type MissionAssumptions } from "./mission.ts";
import { type AircraftData, type CornerComparison, compareAircraft, rmsErrorPct } from "./payloadRange.ts";

export interface CalibrationResult {
  /** Эффективный TSFC калибруемого двигателя в его referenceMach, не автоматически опора другого двигателя. */
  tsfcCruise: number;
  rmsPct: number;
  rows: CornerComparison[];
}

/** TSFC, кг/(Н·с) → lb/(lbf·h). */
export function tsfcToImperial(tsfc: number): number {
  return tsfc * 3600 * 9.80665;
}

/**
 * Меняем только TSFC. Ограничение тяги и точка отсчёта скорости остаются теми же,
 * что в прямом расчёте. Для намеренно идеализированного случая fixedEngine можно задать как {}.
 */
export function calibrateTsfc(
  ac: AircraftData,
  aero: AeroConfig,
  fixedEngine: Omit<EngineState, "tsfcCruise">,
  as: MissionAssumptions,
  densityKgL: number,
  lo = 1.0e-5,
  hi = 2.4e-5,
): CalibrationResult {
  const rowsAt = (tsfc: number) => compareAircraft(ac, aero, { ...fixedEngine, tsfcCruise: tsfc }, as, densityKgL);
  const f = (tsfc: number) => rmsErrorPct(rowsAt(tsfc));
  // Золотое сечение по заданному интервалу; дискретный выбор эшелонов остаётся частью миссии.
  const phi = (Math.sqrt(5) - 1) / 2;
  let a = lo;
  let b = hi;
  let c = b - phi * (b - a);
  let d = a + phi * (b - a);
  let fc = f(c);
  let fd = f(d);
  for (let i = 0; i < 40; i++) {
    if (fc < fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - phi * (b - a);
      fc = f(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + phi * (b - a);
      fd = f(d);
    }
  }
  const tsfc = (a + b) / 2;
  const rows = rowsAt(tsfc);
  return { tsfcCruise: tsfc, rmsPct: rmsErrorPct(rows), rows };
}
