// Углы диаграммы нагрузка–дальность и сравнение с оцифрованными графиками Airbus.
// Массы в углах берутся из самих графиков (OEW выводится из угла «MTOW + полные баки»),
// поэтому сравнение проверяет только аэродинамику, двигатель и миссию, а не массовую сводку.

import { type AeroConfig } from "./aero.ts";
import { type EngineState, type MissionAssumptions, rangeForFuel } from "./mission.ts";

export interface CurveData {
  mtowKg: number;
  act: boolean;
  /** Число доп. баков (ACT); по умолчанию — один, если act. */
  acts?: number;
  maxPayloadT: number;
  rangeAtMaxPayloadNm: number;
  fullTankPayloadT: number;
  rangeAtFullTankNm: number;
  ferryRangeNm: number | null;
}

export interface AircraftData {
  label: string;
  engine: string;
  spanM: number;
  fuelCapacityL: number;
  actFuelL: number;
  oewAcKg: number;
  curves: CurveData[];
}

export type CornerName = "maxPayload" | "fullTank" | "ferry";

export interface CornerComparison {
  curve: string;
  corner: CornerName;
  takeoffMassKg: number;
  payloadKg: number;
  fuelKg: number;
  chartNm: number;
  modelNm: number;
  errorPct: number;
}

export function takeoffFuelCapacityKg(ac: AircraftData, curve: CurveData, densityKgL: number, taxiKg: number): number {
  const litres = ac.fuelCapacityL + (curve.act ? ac.actFuelL * (curve.acts ?? 1) : 0);
  return litres * densityKgL - taxiKg;
}

/** OEW, «зашитый» в график: MTOW − нагрузка в угле полных баков − взлётное топливо. */
export function chartOewKg(ac: AircraftData, curve: CurveData, densityKgL: number, taxiKg: number): number {
  return curve.mtowKg - curve.fullTankPayloadT * 1000 - takeoffFuelCapacityKg(ac, curve, densityKgL, taxiKg);
}

export function compareCurve(
  ac: AircraftData,
  curve: CurveData,
  aero: AeroConfig,
  engine: EngineState,
  as: MissionAssumptions,
  densityKgL: number,
): CornerComparison[] {
  const t = curve.mtowKg / 1000;
  const name = `${Number.isInteger(t) ? t : t.toFixed(1)} т${curve.act ? ((curve.acts ?? 1) > 1 ? ` + ${curve.acts} доп. бака` : " + доп. бак") : ""}`;
  const fuelFull = takeoffFuelCapacityKg(ac, curve, densityKgL, as.taxiFuelKg);
  const oew = chartOewKg(ac, curve, densityKgL, as.taxiFuelKg);
  const out: CornerComparison[] = [];

  const add = (corner: CornerName, tow: number, payload: number, fuel: number, chartNm: number) => {
    const modelNm = rangeForFuel(aero, engine, as, tow, fuel).rangeNm;
    out.push({
      curve: name,
      corner,
      takeoffMassKg: tow,
      payloadKg: payload,
      fuelKg: fuel,
      chartNm,
      modelNm,
      errorPct: ((modelNm - chartNm) / chartNm) * 100,
    });
  };

  const plMax = curve.maxPayloadT * 1000;
  add("maxPayload", curve.mtowKg, plMax, curve.mtowKg - oew - plMax, curve.rangeAtMaxPayloadNm);
  add("fullTank", curve.mtowKg, curve.fullTankPayloadT * 1000, fuelFull, curve.rangeAtFullTankNm);
  if (curve.ferryRangeNm !== null) add("ferry", oew + fuelFull, 0, fuelFull, curve.ferryRangeNm);
  return out;
}

export function compareAircraft(
  ac: AircraftData,
  aero: AeroConfig,
  engine: EngineState,
  as: MissionAssumptions,
  densityKgL: number,
): CornerComparison[] {
  return ac.curves.flatMap((c) => compareCurve(ac, c, aero, engine, as, densityKgL));
}

export function rmsErrorPct(rows: CornerComparison[]): number {
  return Math.sqrt(rows.reduce((s, r) => s + r.errorPct * r.errorPct, 0) / rows.length);
}

export function maxAbsErrorPct(rows: CornerComparison[]): number {
  return Math.max(...rows.map((r) => Math.abs(r.errorPct)));
}
