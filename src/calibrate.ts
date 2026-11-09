// Калибровка: один параметр — крейсерский TSFC — подбирается так, чтобы минимизировать
// среднеквадратичную ошибку дальности по всем углам диаграмм одного типа.

import { type AeroConfig } from "./aero.ts";
import { type MissionAssumptions } from "./mission.ts";
import { type AircraftData, type CornerComparison, compareAircraft, rmsErrorPct } from "./payloadRange.ts";

export interface CalibrationResult {
  tsfcCruise: number;
  rmsPct: number;
  rows: CornerComparison[];
}

/** TSFC, кг/(Н·с) → lb/(lbf·h). */
export function tsfcToImperial(tsfc: number): number {
  return tsfc * 3600 * 9.80665;
}

export function calibrateTsfc(
  ac: AircraftData,
  aero: AeroConfig,
  as: MissionAssumptions,
  densityKgL: number,
  lo = 1.0e-5,
  hi = 2.4e-5,
): CalibrationResult {
  const f = (tsfc: number) => rmsErrorPct(compareAircraft(ac, aero, { tsfcCruise: tsfc }, as, densityKgL));
  // Золотое сечение: ошибка — унимодальная функция TSFC.
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
  const rows = compareAircraft(ac, aero, { tsfcCruise: tsfc }, as, densityKgL);
  return { tsfcCruise: tsfc, rmsPct: rmsErrorPct(rows), rows };
}
