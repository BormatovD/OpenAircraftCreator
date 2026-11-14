// Механизация крыла: максимальный коэффициент подъёмной силы по конфигурациям, скорости взлёта и захода.
//
//   CLmax,чистое = 0,9 · Cl_max,профиль · cos Λc/4                                  (Raymer, 12.4)
//   ΔCLmax = 0,9 · ΔCl_max,профиль · (S_мех / S) · cos Λ_шарнир                      (Raymer, 12.21)
//   ΔCl_max,профиль: однощелевой Фаулер 1,3·c'/c, двухщелевой 1,6·c'/c, предкрылок 0,4·c'/c (Raymer, табл. 12.2)
//   c'/c — удлинение хорды при выпуске: Фаулер выезжает назад на долю своей хорды.
//
// Уровень привязан одним множителем к A320: CLmax посадочный по скорости сваливания из V_app 134 уз
// (Jenkinson) при MLW. Формулы дают чувствительность к типу закрылков, их хорде и предкрылкам.

import { type AircraftDefinition } from "./definition.ts";
import { G0 } from "./atmosphere.ts";

const RHO0 = 1.225;
const KT = 0.514444;

/** Cl_max профиля без механизации (суперкритический профиль транспортного самолёта). Допущение. */
export const AIRFOIL_CLMAX = 1.6;
export const FLAP_DCL = { single: 1.3, double: 1.6 } as const;
export const SLAT_DCL = 0.4;
/** Выдвижение назад, в долях хорды закрылка: Фаулер ≈0,6, двухщелевой ≈0,8. Допущение по Raymer. */
const FLAP_EXTENSION = { single: 0.6, double: 0.8 } as const;
const SLAT_CHORD = 0.11;
const SLAT_EXTENSION = 0.9;
/** Закрылки — от борта до 77% полуразмаха, предкрылки — до 97% (AC 2-2-0). */
const FLAP_SPAN_END = 0.77;
const SLAT_SPAN_END = 0.97;
/** Взлётная конфигурация (CONF 1+F): доля посадочного прироста от закрылков и предкрылков. Raymer: 60–80%. Допущение. */
export const TAKEOFF_SHARE = { flaps: 0.6, slats: 0.8 };
/** Угол закрылков в посадочной конфигурации, ° (A320 CONF FULL). */
export const LANDING_FLAP_DEG = 40;
/** Raymer 12.61: ΔCD0 = F·(cf/c)·(S_мех/S)·(δ − 10°), F = 0,0074 для щелевых закрылков. */
const FLAP_DRAG_F = 0.0074;
/** V_app = 1,23·V_SR (CS 25.125: V_REF ≥ 1,23·V_SR; так же Jenkinson для A320). */
export const VAPP_FACTOR = 1.23;

const rad = (d: number) => (d * Math.PI) / 180;

/** Доля площади трапециевидного крыла между долями полуразмаха η1 и η2. */
function areaShare(taper: number, eta1: number, eta2: number): number {
  const F = (e: number) => e - ((1 - taper) * e * e) / 2;
  return (F(eta2) - F(eta1)) / F(1);
}

export interface HighLiftRaw {
  clean: number;
  flapLanding: number;
  slatLanding: number;
  flappedShare: number;
}

export function highLiftRaw(def: AircraftDefinition): HighLiftRaw {
  const w = def.wing;
  const h = w.highLift;
  const eta0 = def.fuselage.widthM / w.spanM;
  const flappedShare = areaShare(w.taper, eta0, FLAP_SPAN_END);
  const slattedShare = areaShare(w.taper, eta0, SLAT_SPAN_END);
  const flapExt = 1 + FLAP_EXTENSION[h.flapType] * h.flapChordFraction;
  const slatExt = 1 + SLAT_EXTENSION * SLAT_CHORD;
  // Шарнир закрылков почти не стреловиден у корня — берём стреловидность по 3/4 хорды; предкрылков — по передней кромке.
  const hingeFlap = Math.cos(rad(Math.max(0, w.sweepQuarterDeg - 8)));
  const hingeSlat = Math.cos(rad(w.sweepQuarterDeg + 3));
  return {
    clean: 0.9 * AIRFOIL_CLMAX * Math.cos(rad(w.sweepQuarterDeg)),
    flapLanding: 0.9 * FLAP_DCL[h.flapType] * flapExt * flappedShare * hingeFlap,
    slatLanding: h.slats ? 0.9 * SLAT_DCL * slatExt * slattedShare * hingeSlat : 0,
    flappedShare,
  };
}

export interface HighLiftPerf {
  clMaxClean: number;
  clMaxTakeoff: number;
  clMaxLanding: number;
  /** Скорость сваливания в посадочной конфигурации при MLW, уз. */
  vStallKt: number;
  /** Скорость захода при MLW, уз. */
  vAppKt: number;
  /** V2 при MTOW во взлётной конфигурации, уз. */
  v2Kt: number;
  /** Прирост CD0 от закрылков в посадочной конфигурации. */
  flapCd0Landing: number;
}

/** Множитель привязки: CLmax посадочный A320 по V_app 134 уз при MLW (Jenkinson). */
export function highLiftAnchor(ref: AircraftDefinition): number {
  const target = (2 * ref.weights.mlwKg * G0) / (RHO0 * ref.wing.areaM2 * ref.gear.stallSpeedMs ** 2);
  const r = highLiftRaw(ref);
  return target / (r.clean + r.flapLanding + r.slatLanding);
}

export function highLiftPerf(def: AircraftDefinition, anchor: number): HighLiftPerf {
  const r = highLiftRaw(def);
  const clMaxClean = r.clean * anchor;
  const clMaxLanding = (r.clean + r.flapLanding + r.slatLanding) * anchor;
  const clMaxTakeoff = (r.clean + TAKEOFF_SHARE.flaps * r.flapLanding + TAKEOFF_SHARE.slats * r.slatLanding) * anchor;
  const vs = (m: number, cl: number) => Math.sqrt((2 * m * G0) / (RHO0 * def.wing.areaM2 * cl));
  const vStall = vs(def.weights.mlwKg, clMaxLanding);
  return {
    clMaxClean,
    clMaxTakeoff,
    clMaxLanding,
    vStallKt: vStall / KT,
    vAppKt: (VAPP_FACTOR * vStall) / KT,
    v2Kt: (1.13 * vs(def.weights.mtowKg, clMaxTakeoff)) / KT,
    flapCd0Landing: FLAP_DRAG_F * def.wing.highLift.flapChordFraction * r.flappedShare * (LANDING_FLAP_DEG - 10),
  };
}

/** Доли массы механизации (узел wing.highLift): закрылки с каретками ≈0,6, предкрылки ≈0,2, элероны и интерцепторы ≈0,2. Допущение. */
export const HIGHLIFT_MASS_SHARES = { flaps: 0.6, slats: 0.2 };
/** Двухщелевой закрылок тяжелее однощелевого той же площади: второе звено и сложнее каретки. Допущение: +25%. */
export const DOUBLE_SLOTTED_MASS = 1.25;

/** Относительная масса при изменении хорды, типа закрылков и наличия предкрылков. */
export function highLiftMassFactor(wing: AircraftDefinition["wing"]): number {
  if (!wing.referenceHighLift) return 1;
  const { flaps, slats } = HIGHLIFT_MASS_SHARES;
  const relativeMass = (h: typeof wing.highLift) => 1 - flaps - slats
    + flaps * h.flapChordFraction / 0.26 * (h.flapType === "double" ? DOUBLE_SLOTTED_MASS : 1)
    + (h.slats ? slats : 0);
  return relativeMass(wing.highLift) / relativeMass(wing.referenceHighLift);
}
