// Откалиброванный контекст A320: массы (на OEW CEO по Airbus AC), TSFC CEO (по диаграммам AC 3-2-1),
// поляра (Poll & Schumann). Все сценарии и рычаги считаются от него.

import { type BaselineAero, type EvalContext, tsfcFromImperial } from "../evaluate.ts";
import { aspectRatioOf, dragBuildup, oswaldObert, waveDrag, waveParams } from "../drag.ts";
import { GROUP_MAP, analogueShares } from "../mass/analogue.ts";
import { calibrateMasses } from "../mass/massTree.ts";
import { A320CEO, AC_OEW_KG } from "./a320.ts";
import { takeoffThrustN } from "../thrust.ts";
import { highLiftAnchor, highLiftPerf } from "../highlift.ts";

/**
 * Привязка сопротивления по составляющим к поляре Poll & Schumann: на A320 с шарклетами (по ним подобран TSFC)
 * в типичной крейсерской точке (CL 0,55, M 0,78) сумма CD0 + волновое = 0,019, e = 0,78. Дальше рычаги
 * меняют CD0, e и волновое через формулы.
 */
function anchoredAero(): BaselineAero {
  const ref = { ...A320CEO, wing: { ...A320CEO.wing, tip: "sharklet" as const } };
  const waveRef = waveDrag(waveParams(ref), 0.55, 0.78);
  return {
    cd0: 0.019,
    oswald: 0.78,
    cd0Factor: (0.019 - waveRef) / dragBuildup(ref).cd0,
    oswaldFactor: 0.78 / oswaldObert(aspectRatioOf(ref)),
  };
}

export const A320_CONTEXT: EvalContext = {
  calibration: calibrateMasses(A320CEO, AC_OEW_KG.a320ceo, analogueShares(), GROUP_MAP),
  tsfcCruise: tsfcFromImperial(0.586),
  engineRef: A320CEO.engine,
  constraintsRef: {
    baseBypassRatio: A320CEO.engine.bypassRatio,
    nacelleClearanceM: 0.57, // AC 2-3-0, CFM56-5B при MRW
    nacelleWidthM: A320CEO.engine.nacelleWidthM,
    tailStrikeDeg: 11.7, // Airbus Safety First, обжатая стойка
    tailContactArmM: 16.4, // откалибровано по A321: вставка 6,94 м, предел 9,7° (FCOM Bulletin 22/2 через отчёт AAIB)
    liftoffPitchDeg: 10, // допущение
    takeoffFieldLengthM: 2180, // Jenkinson: МСА, уровень моря, MTOW 73,5 т
    mtowKg: A320CEO.weights.mtowKg,
    wingAreaM2: A320CEO.wing.areaM2,
    takeoffThrustN: takeoffThrustN(A320CEO),
    clMaxTakeoff: highLiftPerf(A320CEO, highLiftAnchor(A320CEO)).clMaxTakeoff,
    provenMinClearanceM: 0.568, // Own A320-200 CFM56 planning table, not the NEO value.
    clearanceEstimated: true,
    clearanceReference: "Airbus A320 AC §2-3-0 Fig.029, CFM56: 0,568–0,672 м в указанных MRW/OEW состояниях; условия модели приближённые.",
  },
  aero: anchoredAero(),
  fuelDensityKgL: 0.785,
  highLiftAnchor: highLiftAnchor(A320CEO),
};
