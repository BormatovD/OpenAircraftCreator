// Численная диагностика нового пакета FCOM. Не меняет калибровку или миссии интерфейса.
import { writeFileSync } from "node:fs";
import ces from "../data/fcom/a320-214-ces-phases.json" with { type: "json" };
import cesCruise from "../data/fcom/a320-214-ces-cruise-checks.json" with { type: "json" };
import nordwind from "../data/fcom/b757-nordwind-performance.json" with { type: "json" };
import { A320CEO } from "../src/aircraft/a320.ts";
import { A320_CONTEXT } from "../src/aircraft/a320Context.ts";
import { B757_PW2037, B757_ASSUMPTIONS, B757_OEW_KG } from "../src/aircraft/b757.ts";
import { aeroFor, engineStateFor } from "../src/evaluate.ts";
import { DEFAULT_ASSUMPTIONS, simulateTrip } from "../src/mission.ts";
import { referencePhaseBudget } from "../src/phaseBudget.ts";
import { maxLiftToDrag } from "../src/aero.ts";
import { G0, NM } from "../src/atmosphere.ts";
import { type LrcTable } from "../src/cruise.ts";
import { validateCruiseTable } from "../src/validation.ts";

const request = {
  brakeReleaseMassKg: 60000, climbToFl: 350, climbIsaDeviationC: 0,
  descentReferenceMassKg: 60000, descentFromFl: 350,
  holdingReferenceMassKg: 60000, holdingFl: 15, holdingMinutes: 30,
};
const boundaries = {
  initialClimbEndFl: 15, descentEndFl: 15,
  approachAndLandingFuelKg: ces.groundAndTerminalFuel.approachAndLanding.ifrFuelKg,
};
const reference = referencePhaseBudget(ces, boundaries, request);
if (!reference) throw new Error("Нет контрольных точек A320 CES");
const as = DEFAULT_ASSUMPTIONS;
const aero = aeroFor(A320CEO, A320_CONTEXT.aero, []);
const engine = engineStateFor(A320CEO, A320_CONTEXT, [], as);
const modelTrip = simulateTrip(aero, engine, as, request.brakeReleaseMassKg, 6000, request.climbToFl);
const modelDepartureFuelKg = modelTrip.takeoffFuelKg + modelTrip.climbFuelKg;
const modelHoldingFlowKgH = request.holdingReferenceMassKg * G0 * engine.tsfcCruise * as.holdTsfcRatio / maxLiftToDrag(aero) * 3600;
const straightLineFlowKgH = reference.holding.fuelFlowTotalKgH * (1 + ces.holding.correctionsFuelFlowPct.straightLine / 100);
const percentDifference = (model: number, source: number) => (model / source - 1) * 100;
const c = ces.climb.correctionsFuelPct[0];
const systemCases = [
  { id: "normal", corrections: {} },
  { id: "lowAirConditioning", corrections: {
    climbFuelPct: c.lowAirConditioning,
    descentFuelPct: ces.descent.correctionsPct.lowAirConditioning.fuel,
    holdingFuelFlowPct: ces.holding.correctionsFuelFlowPct.lowAirConditioning,
  } },
  { id: "engineAntiIce", corrections: {
    climbFuelPct: c.engineAntiIceOn,
    descentFuelPct: ces.descent.correctionsPct.engineAntiIceOn.fuel,
    holdingFuelFlowPct: ces.holding.correctionsFuelFlowPct.engineAntiIceOn,
  } },
  { id: "totalAntiIce", corrections: {
    climbFuelPct: c.totalAntiIceOn,
    descentFuelPct: ces.descent.correctionsPct.totalAntiIceOn.fuel,
    holdingFuelFlowPct: ces.holding.correctionsFuelFlowPct.totalAntiIceOn,
  } },
].map(({ id, corrections }) => {
  const budget = referencePhaseBudget(ces, boundaries, request, corrections)!;
  return {
    id, corrections,
    departureFuelKg: budget.departure.totalFuelKg,
    arrivalFuelKg: budget.arrival.totalFuelKg,
    holdingReserveFuelKg: budget.holding.fuelKg,
    tripNonCruiseFuelKg: budget.tripNonCruiseFuelKg,
    extraTripNonCruiseFuelKg: budget.tripNonCruiseFuelKg - reference.tripNonCruiseFuelKg,
    extraHoldingReserveFuelKg: budget.holding.fuelKg - reference.holding.fuelKg,
  };
});

const a320Cruise = ["fixedMach", "lrc"].map((regime) => {
  const checks = cesCruise.checks.filter((r) => r.regime === regime);
  const altitudesFt = [...new Set(checks.map((r) => r.fl * 100))].sort((a, b) => a - b);
  const rows: Record<string, number[][]> = {};
  for (const r of checks) {
    const key = String(r.massKg / 1000);
    rows[key] ??= altitudesFt.map(() => []);
    const i = altitudesFt.indexOf(r.fl * 100);
    if (rows[key][i].length) throw new Error("Повторный контрольный узел A320 cruise");
    rows[key][i] = [r.n1Pct, r.mach, r.iasKt, r.fuelFlowPerEngineKgH];
  }
  return {
    regime,
    scope: "Selected 9 holdout nodes, not a full LRC interpolation grid. The model uses each source Mach; no fitted correction or source FF injection.",
    ...validateCruiseTable(A320_CONTEXT, A320CEO, as, {
      _source: `${cesCruise.source.document}, ${checks[0].pageCode}, PDF ${checks[0].pdfPage}`,
      altitudesFt, rows,
    }),
  };
});

// Сравниваем PW2037 без winglets; нормализованные кг из исходных фунтов не округляем.
// Первая колонка LrcTable здесь EPR. validateCruiseTable использует только Mach и FF.
const packet = nordwind.packets.find((p) => p.engine === "PW2037" && !p.winglets)!;
const rows: Record<string, number[][]> = {};
for (const r of packet.lrc.rows) {
  const key = String(r.massKg / 1000);
  rows[key] ??= packet.lrc.altitudesFt.map(() => []);
  const i = packet.lrc.altitudesFt.indexOf(r.fl * 100);
  if (i < 0 || rows[key][i].length) throw new Error("Неоднозначные координаты LRC 757");
  rows[key][i] = [r.epr, r.mach!, r.iasKt, r.fuelFlowPerEngineKgH];
}
const table: LrcTable = {
  _source: `${nordwind._source.documentNumber}, Rev ${nordwind._source.revision}, ${packet.lrc.source.pageCode}; PDF ${packet.lrc.source.pdfPage}; ${packet.id}`,
  altitudesFt: packet.lrc.altitudesFt, rows,
};
const pwCruise = validateCruiseTable(A320_CONTEXT, B757_PW2037, B757_ASSUMPTIONS, table);
const chartLevelRows = pwCruise.rows.filter((r) => B757_ASSUMPTIONS.stepFLs.includes(r.fl)
  && r.massKg >= B757_OEW_KG.pw2037 && r.massKg <= B757_PW2037.weights.mtowKg + 1);
const chartLevelErrors = chartLevelRows.map((r) => r.errorPct);
const chartLevels = {
  description: "Only FL350/390 from the ACAP profile, source masses between published model-variant OEW and MTOW (1 kg rounding tolerance). Still LRC Mach and a different engine rating, not a direct ACAP-point validation.",
  count: chartLevelRows.length,
  biasPct: chartLevelErrors.reduce((s, x) => s + x, 0) / chartLevelErrors.length,
  rmsPct: Math.sqrt(chartLevelErrors.reduce((s, x) => s + x * x, 0) / chartLevelErrors.length),
  rows: chartLevelRows,
};

const report = {
  kind: "source-specific reference budgets and model diagnostics; not new calibration",
  productionMissionChanged: false,
  a320: {
    source: ces.source,
    applicability: ces.applicability,
    calibrationTsfcImperial: 0.586,
    reference,
    cruiseHoldout: a320Cruise,
    comparison: {
      interpretation: "Independent reference points at equal stated mass; not three consecutive phases of one flight. The production engine is generic CFM56-5B, not an explicit /P installation model.",
      departure: {
        sourceFuelKg: reference.departure.totalFuelKg,
        modelFuelKg: modelDepartureFuelKg,
        differenceKg: modelDepartureFuelKg - reference.departure.totalFuelKg,
        differencePct: percentDifference(modelDepartureFuelKg, reference.departure.totalFuelKg),
        sourceDistanceNm: reference.departure.distanceNm,
        modelDistanceNm: as.climbDistanceKm * 1000 / NM,
        conditions: "ISA0 and FL350; source follows 250/300/.78 and CG33%, normal AC, anti-ice off. Production model uses its energy approximation, not this speed schedule.",
      },
      arrival: {
        sourcePureDescentKg: reference.arrival.descentFuelKg,
        sourceIfrArrivalKg: reference.arrival.approachAndLandingFuelKg,
        sourceCombinedKg: reference.arrival.totalFuelKg,
        modelAllowanceKg: as.descentFuelKg,
        differenceKg: as.descentFuelKg - reference.arrival.totalFuelKg,
        massReferenceTiming: ces.descent.massReferenceTiming,
        sourceN1UndefinedBetweenNumericAndIdle: reference.arrival.source.n1Pct === undefined,
      },
      holding: {
        sourceRaceTrackFlowKgH: reference.holding.fuelFlowTotalKgH,
        sourceStraightLineFlowKgH: straightLineFlowKgH,
        sourcePlanning30MinKg: reference.holding.fuelKg,
        modelInstantaneousFlowKgH: modelHoldingFlowKgH,
        differenceVsRaceTrackPct: percentDifference(modelHoldingFlowKgH, reference.holding.fuelFlowTotalKgH),
        differenceVsStraightLinePct: percentDifference(modelHoldingFlowKgH, straightLineFlowKgH),
        conditions: "Source is green-dot at FL15, normal AC, anti-ice off. Production formula is max L/D with holdTsfcRatio=0.8 and no altitude-specific holding engine model. Its instantaneous flow is compared here, not integrated reserve fuel at a different mass.",
      },
    },
    systemCases,
    systemCasesScope: "Only tabulated FUEL/FF corrections at the same reference masses. Arrival's 120 kg stays separate. Descent time/distance corrections are not applied by this fuel-budget helper; no entire-mission or bleedless-aircraft savings are inferred.",
  },
  b757Pw2037: {
    packetId: packet.id,
    diagnosticOnly: true,
    limitations: [
      "The FCOM fleet rating is 37000 lbf per engine; the model definition remains 38250 lbf. This is not a fully matched installation validation.",
      "The model is evaluated at each source LRC Mach. The ACAP validation profile stays fixed M0.80; it is not silently replaced by LRC.",
      "All source grid cells are retained, including masses outside the current model's selected weight variant. Equal-weight grid statistics are not mission-weighted statistics or an operating-envelope approval.",
      "FF is a reference check only, not injected into the mission and not used for fitting.",
    ],
    ...pwCruise,
    chartLevels,
  },
};
writeFileSync(new URL("../data/validation-fcom-batch.json", import.meta.url), JSON.stringify(report, null, 2) + "\n");
console.log(`A320 / 60 т / FL350: набор от brake release ${reference.departure.totalFuelKg} кг, прежняя модель ${modelDepartureFuelKg.toFixed(2)} кг.`);
console.log(`A320 / reference WEIGHT 60 т: снижение ${reference.arrival.descentFuelKg} + IFR ${reference.arrival.approachAndLandingFuelKg} = ${reference.arrival.totalFuelKg} кг.`);
console.log(`A320 / 60 т / FL15: ожидание ${reference.holding.fuelFlowTotalKgH} кг/ч, прежняя формула ${modelHoldingFlowKgH.toFixed(2)} кг/ч.`);
for (const c of a320Cruise) console.log(`A320 ${c.regime}: ${c.rows.length} контрольных узлов; ошибка FF ${c.biasPct.toFixed(2)}%, RMS ${c.rmsPct.toFixed(2)}%.`);
console.log(`757 PW2037 LRC: ${pwCruise.rows.length} точек; диагностическая ошибка FF ${pwCruise.biasPct.toFixed(2)}%, RMS ${pwCruise.rmsPct.toFixed(2)}%. Различие rating сохранено.`);
console.log(`757 на FL350/390 и массах выбранного варианта: ${chartLevels.count} точек; ошибка FF ${chartLevels.biasPct.toFixed(2)}%, RMS ${chartLevels.rmsPct.toFixed(2)}%.`);
console.log("Миссии, профиль ACAP и калибровка не изменены. Отчёт: data/validation-fcom-batch.json");
