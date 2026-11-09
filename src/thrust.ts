// Двигатель вне расчётного режима: располагаемая тяга по высоте и скорости.
//
//   T / T_взл = δ₀ · (1 − 0,49·√M),  δ₀ = δ·(1 + 0,2M²)^3,5     (Mattingly, «Aircraft Engine Design»,
//                                                               ТРДД большой двухконтурности, θ₀ ≤ 1)
// На FL350, M 0,78 это 0,199 взлётной тяги — для CFM56-5B4 ≈5 400 lbf, порядок опубликованной крейсерской тяги.
//
// Почему тяга на высоте не зависит от двухконтурности. По теории импульса при той же мощности ядра
// двигатель с B = 11 терял бы со скоростью на ≈14% больше тяги к верху набора, чем с B = 5,7. Реальные
// двигатели проектируют на точку верха набора: ядро LEAP больше и горячее, и A320neo занимает те же эшелоны,
// что CEO. Цена этого — в массе и диаметре двигателя, которые рычаг двухконтурности берёт с линии реальных
// двигателей (CFM56 → LEAP), то есть уже с учётом такой компенсации. Поэтому формула одна для всех B.

import { G0, flightLevelToM, isa } from "./atmosphere.ts";
import { type AeroConfig, clForWeight, liftToDrag } from "./aero.ts";
import { type AircraftDefinition } from "./definition.ts";

/** Остаточная скороподъёмность на потолке — 300 фут/мин (практика авиакомпаний и Airbus REC MAX). */
export const RESIDUAL_ROC_MS = (300 * 0.3048) / 60;
/** Сертифицированный потолок A320. */
export const MAX_CERT_FL = 398;
/** Масса на верху набора: взлётная минус ≈2% на руление, взлёт и набор. Допущение. */
export const TOC_MASS_FRACTION = 0.98;

/** Доля взлётной тяги, доступная на высоте и скорости (максимальный режим). */
export function thrustLapse(altitudeM: number, mach: number): number {
  const atm = isa(altitudeM);
  const delta = atm.pressurePa / 101325;
  const delta0 = delta * Math.pow(1 + 0.2 * mach * mach, 3.5);
  return delta0 * (1 - 0.49 * Math.sqrt(mach));
}

/** Суммарная взлётная тяга (статика, уровень моря), Н. */
export function takeoffThrustN(def: AircraftDefinition): number {
  return def.engine.takeoffThrustKn * 1000 * def.engine.thrustScale * def.engine.count;
}

export function availableThrustN(def: AircraftDefinition, fl: number, mach: number, engines = def.engine.count): number {
  return (takeoffThrustN(def) / def.engine.count) * engines * thrustLapse(flightLevelToM(fl), mach);
}

/** Потребная тяга в горизонтальном полёте с остаточной скороподъёмностью: D + W·V_y/V. */
export function requiredThrustN(aero: AeroConfig, massKg: number, fl: number, mach: number, rocMs = RESIDUAL_ROC_MS): number {
  const atm = isa(flightLevelToM(fl));
  const v = mach * atm.speedOfSoundMs;
  const w = massKg * G0;
  const cl = clForWeight(aero, w, atm.densityKgM3, v);
  return w / liftToDrag(aero, cl, mach) + (w * rocMs) / v;
}

/**
 * Потолок по тяге: самый высокий эшелон (шаг 10), где располагаемая тяга покрывает потребную
 * с остаточной скороподъёмностью 300 фут/мин. Не выше сертифицированного.
 */
export function thrustCeilingFl(def: AircraftDefinition, aero: AeroConfig, massKg: number, mach: number): number {
  const ok = (fl: number) => availableThrustN(def, fl, mach) >= requiredThrustN(aero, massKg, fl, mach);
  if (ok(MAX_CERT_FL)) return MAX_CERT_FL;
  let best = 0;
  for (let fl = 100; fl < MAX_CERT_FL; fl += 10) if (ok(fl)) best = fl;
  return best;
}

export interface ThrustCurve {
  massKg: number;
  mach: number;
  points: { fl: number; availableN: number; requiredN: number }[];
  ceilingFl: number;
}

export function thrustCurve(def: AircraftDefinition, aero: AeroConfig, massKg: number, mach: number): ThrustCurve {
  const points = [];
  for (let fl = 250; fl <= 410; fl += 10) points.push({ fl, availableN: availableThrustN(def, fl, mach), requiredN: requiredThrustN(aero, massKg, fl, mach) });
  return { massKg, mach, points, ceilingFl: thrustCeilingFl(def, aero, massKg, mach) };
}

// ——— Взлёт ———

/** Полёт с одним двигателем на втором сегменте: допущения по взлётной поляре. */
export const TAKEOFF_POLAR = {
  /** CLmax во взлётной конфигурации (CONF 1+F). Допущение по Obert: 2,0–2,4 для этого класса. */
  clMaxTakeoff: 2.2,
  /** V2 ≥ 1,13·V_SR (CS 25.107). */
  v2Factor: 1.13,
  /** Прирост CD0 от закрылков и предкрылков во взлётном положении. Допущение (Raymer, ESDU: 0,010–0,015). */
  flapCd0: 0.012,
  /** Авторотирующий двигатель и отклонённый руль направления. Допущение. */
  oeiCd0: 0.003,
  /** Требование CS 25.121(b) для двухдвигательного: градиент ≥ 2,4%. */
  requiredGradient: 0.024,
};

export interface OeiClimb {
  gradient: number;
  v2Ms: number;
  ld: number;
  thrustN: number;
}

/** Градиент набора на втором сегменте с отказавшим двигателем при MTOW, МСА, уровень моря. */
export function oeiSecondSegment(def: AircraftDefinition, aero: AeroConfig): OeiClimb {
  const p = TAKEOFF_POLAR;
  const w = def.weights.mtowKg * G0;
  const cl = p.clMaxTakeoff / (p.v2Factor * p.v2Factor);
  const atm = isa(0);
  const v2 = Math.sqrt((2 * w) / (atm.densityKgM3 * aero.wingAreaM2 * cl));
  const ar = (aero.spanM * aero.spanM) / aero.wingAreaM2;
  const cd = aero.cd0 + p.flapCd0 + p.oeiCd0 + (cl * cl) / (Math.PI * ar * aero.oswald);
  const thrust = availableThrustN(def, 0, v2 / atm.speedOfSoundMs, def.engine.count - 1);
  return { gradient: thrust / w - cd / cl, v2Ms: v2, ld: cl / cd, thrustN: thrust };
}
