// Режим «перепроектировать под ту же миссию» — эффект снежного кома.
//
// Держим постоянными: расчётную нагрузку (все места × 95 кг) и расчётную дальность базового самолёта,
// скорость захода (W / (S·CLmax) — с лучшей механизацией крыло меньше), удлинение крыла и тяговооружённость.
// Итерируем MTOW: геометрия и двигатели масштабируются под MTOW → массы по Raymer → топливо на миссию →
// новое MTOW = OEW + нагрузка + топливо. Сходится, если каждое облегчение не порождает больше, чем снимает.

import { type AircraftDefinition } from "./definition.ts";
import { DEFAULT_MISSION, type EvalContext, type Evaluation, type MissionSpec, bisect, evaluateResolved } from "./evaluate.ts";
import { type Lever, applyDefinition } from "./levers.ts";
import { rangeForFuel } from "./mission.ts";
import { aeroFor, assumptionsFor, engineStateFor } from "./evaluate.ts";
import { computeMasses } from "./mass/massTree.ts";
import { highLiftRaw } from "./highlift.ts";

/** Посадочный CLmax без привязки — для отношения двух вариантов механизации привязка не нужна. */
function clMaxLandingRaw(def: AircraftDefinition): number {
  const r = highLiftRaw(def);
  return r.clean + r.flapLanding + r.slatLanding;
}

/** Площадь крыла (и оперения) × k при том же удлинении: так держится скорость захода при другом CLmax. */
function scaleWingArea(d: AircraftDefinition, k: number): AircraftDefinition {
  if (Math.abs(k - 1) < 1e-9) return d;
  const r = Math.sqrt(k);
  return {
    ...d,
    wing: { ...d.wing, areaM2: d.wing.areaM2 * k, spanM: d.wing.spanM * r, sharkletSpanM: d.wing.sharkletSpanM * r, controlSurfaceAreaM2: d.wing.controlSurfaceAreaM2 * k },
    htail: { ...d.htail, areaM2: d.htail.areaM2 * k, spanM: d.htail.spanM * r },
    vtail: { ...d.vtail, areaM2: d.vtail.areaM2 * k, spanM: d.vtail.spanM * r },
    systems: { ...d.systems, fuelVolumeL: d.systems.fuelVolumeL * Math.pow(k, 1.5) },
  };
}

export interface DesignMission {
  payloadKg: number;
  rangeNm: number;
}

/** Масштабирует самолёт под новое MTOW при той же нагрузке на крыло, удлинении и тяговооружённости. */
export function resize(ref: AircraftDefinition, mtowKg: number): AircraftDefinition {
  const s = mtowKg / ref.weights.mtowKg;
  const r = Math.sqrt(s);
  return {
    ...ref,
    wing: {
      ...ref.wing,
      areaM2: ref.wing.areaM2 * s,
      spanM: ref.wing.spanM * r,
      sharkletSpanM: ref.wing.sharkletSpanM * r,
      controlSurfaceAreaM2: ref.wing.controlSurfaceAreaM2 * s,
    },
    // Оперение пропорционально крылу (тот же коэффициент статического объёма при тех же плечах).
    htail: { ...ref.htail, areaM2: ref.htail.areaM2 * s, spanM: ref.htail.spanM * r },
    vtail: { ...ref.vtail, areaM2: ref.vtail.areaM2 * s, spanM: ref.vtail.spanM * r },
    // Тяга ∝ MTOW: масса двигателя ∝ тяге, диаметр и гондола ∝ √тяги.
    engine: {
      ...ref.engine,
      thrustScale: ref.engine.thrustScale * s,
      dryMassKg: ref.engine.dryMassKg * s,
      fanDiameterM: ref.engine.fanDiameterM * r,
      nacelleLengthM: ref.engine.nacelleLengthM * r,
      nacelleWidthM: ref.engine.nacelleWidthM * r,
    },
    // Объём баков в крыле ∝ S^1,5.
    systems: { ...ref.systems, fuelVolumeL: ref.systems.fuelVolumeL * Math.pow(s, 1.5) },
    weights: { ...ref.weights, mtowKg, mlwKg: ref.weights.mlwKg * s },
  };
}

export interface RedesignResult {
  converged: boolean;
  iterations: number;
  evaluation: Evaluation;
  mtowKg: number;
  history: number[];
}

/** Топливо на взлёте, нужное для расчётной миссии при данных OEW и аэродинамике. */
function missionTakeoffFuel(def: AircraftDefinition, levers: Lever[], ctx: EvalContext, mission: DesignMission, oewKg: number): number {
  const as = assumptionsFor(ctx, levers);
  const aero = aeroFor(def, ctx.aero, levers);
  const engine = engineStateFor(def, ctx, levers, as);
  return bisect(
    (fuel) => rangeForFuel(aero, engine, as, oewKg + mission.payloadKg + fuel, fuel).rangeNm,
    500,
    60000,
    mission.rangeNm,
  );
}

export function redesign(
  baseDef: AircraftDefinition,
  levers: Lever[],
  ctx: EvalContext,
  mission: DesignMission,
  reporting: MissionSpec = DEFAULT_MISSION,
): RedesignResult {
  // Рычаги применяются к базовому самолёту при исходном MTOW, затем всё масштабируется вместе.
  // Механизация меняет CLmax: при той же скорости захода крыло масштабируется на CLmax_база / CLmax.
  const applied = applyDefinition(baseDef, levers);
  const ref = scaleWingArea(applied, clMaxLandingRaw(baseDef) / clMaxLandingRaw(applied));
  // Запас MZFW над расчётной нагрузкой — как у базового самолёта со всеми его местами.
  const basePayload = baseDef.systems.seats * reporting.massPerPaxKg;
  const mzfwMargin = baseDef.weights.mzfwKg - computeMasses(baseDef, ctx.calibration).oewKg - basePayload;

  let mtow = ref.weights.mtowKg;
  const history = [mtow];
  let converged = false;
  let i = 0;
  for (; i < 60; i++) {
    const def = resize(ref, mtow);
    const oew = computeMasses(def, ctx.calibration, levers).oewKg;
    const fuel = missionTakeoffFuel(def, levers, ctx, mission, oew);
    const next = oew + mission.payloadKg + fuel;
    if (!Number.isFinite(next) || next > 3 * ref.weights.mtowKg || next < 0.3 * ref.weights.mtowKg) break;
    const relaxed = mtow + 0.7 * (next - mtow);
    history.push(relaxed);
    if (Math.abs(relaxed - mtow) < 1) {
      mtow = relaxed;
      converged = true;
      break;
    }
    mtow = relaxed;
  }

  const sized = resize(ref, mtow);
  const oew = computeMasses(sized, ctx.calibration, levers).oewKg;
  // MZFW: расчётная нагрузка плюс тот же запас, что у базового самолёта.
  const final: AircraftDefinition = { ...sized, weights: { ...sized.weights, mzfwKg: oew + mission.payloadKg + mzfwMargin } };
  return { converged, iterations: i + 1, evaluation: evaluateResolved(final, levers, ctx, reporting), mtowKg: mtow, history };
}

/** Расчётная миссия базового самолёта: все места × масса пассажира на дальность, которую он для этого имеет при MTOW. */
export function designMissionOf(base: Evaluation, massPerPaxKg = DEFAULT_MISSION.massPerPaxKg): DesignMission {
  return { payloadKg: base.seats * massPerPaxKg, rangeNm: base.rangeWithMissionPayloadNm };
}
