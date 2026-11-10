// Паспорт и диагностические сопоставления фаз A319 HC-CLF. Это не калибровка и не проверка
// точности в одинаковых условиях: различия температуры, профиля и границ сохранены в отчёте.
import { writeFileSync } from "node:fs";
import table from "../data/fcom/a319-112-hc-clf-phases.json" with { type: "json" };
import { A319CEO } from "../src/aircraft/a320family.ts";
import { contextFor } from "../src/aircraft/contextFor.ts";
import { aeroFor, assumptionsFor, engineStateFor } from "../src/evaluate.ts";
import { maxLiftToDrag } from "../src/aero.ts";
import { G0, NM } from "../src/atmosphere.ts";
import { simulateTrip } from "../src/mission.ts";
import { lookupClimb, lookupDescent, lookupHolding } from "../src/phaseTables.ts";

const ctx = contextFor(A319CEO);
const as = assumptionsFor(ctx, []);
const aero = aeroFor(A319CEO, ctx.aero, []);
const engine = engineStateFor(A319CEO, ctx, [], as);
const massKg = 60000;
const fl = 350;
const climb = lookupClimb(table, massKg, fl, 10)!;
const initialClimb = lookupClimb(table, massKg, 15, 10)!;
const descent = lookupDescent(table, massKg, fl)!;
const holding = lookupHolding(table, massKg, 15)!;
if (!climb || !initialClimb || !descent || !holding) throw new Error("Нет контрольной точки FCOM");

// Точный текущий путь энергетической модели; 6000 кг оставляют достаточно топлива для крейсера.
const modelTrip = simulateTrip(aero, engine, as, massKg, 6000, fl);
// Производная той же экспоненты, которая используется в reserves(): мгновенный расход при 60 т.
const modelHoldingFlowKgH = massKg * G0 * engine.tsfcCruise * as.holdTsfcRatio / maxLiftToDrag(aero) * 3600;
const raceTrackFlowKgH = holding.fuelFlowPerEngineKgH * table.holding.engineCount;
const straightLineFlowKgH = raceTrackFlowKgH * (1 + table.holding.metadata.correctionsFuelFlowPct.straightLine / 100);

const report = {
  kind: "source-specific phase diagnostics, not matched-condition accuracy validation",
  source: table.source,
  applicability: table.applicability,
  sourceCellCounts: {
    climb: table.climb.rows.length,
    holding: table.holding.rows.length,
    descent: table.descent.rows.length,
    total: table.climb.rows.length + table.holding.rows.length + table.descent.rows.length,
  },
  currentModel: {
    aircraftId: A319CEO.id,
    engineDefinition: A319CEO.engine.name,
    engineSpecificPStandardModelled: false,
    calibrationAnchor: "A320ceo, TSFC 0.586 lb/(lbf h), unchanged",
    phaseTablesAutomaticallyApplied: false,
  },
  climb: {
    source: climb,
    sourceBrakeReleaseTo1500Ft: initialClimb,
    sourceClimbAbove1500FtFuelKg: climb.fuelKg - initialClimb.fuelKg,
    currentModel: {
      isaDeviationC: 0,
      fuelFromBrakeReleaseKg: modelTrip.takeoffFuelKg + modelTrip.climbFuelKg,
      takeoffAllowanceKg: modelTrip.takeoffFuelKg,
      climbDistanceNm: as.climbDistanceKm * 1000 / NM,
    },
    matchedConditions: false,
    reason: "FCOM uses ISA+10; current mission atmosphere is ISA0. No ISA0 climb table or temperature extrapolation is provided. The model also lacks the exact CFM56-5B6/P installation standard.",
    isa0LookupAvailable: lookupClimb(table, massKg, fl, 0) !== undefined,
  },
  descent: {
    source: descent,
    sourceEndAltitudeFt: 1500,
    ifrApproachAndLandingFuelKg: table.planningAllowances.approachAndLandingIfr.fuelKg,
    sourceDescentPlusIfrApproachFuelKg: descent.fuelKg + table.planningAllowances.approachAndLandingIfr.fuelKg,
    currentModelFixedDescentFuelKg: as.descentFuelKg,
    matchedConditions: false,
    reason: "Source explicitly ends at 1500 ft and separates approach/landing. The old fixed model allowance has no equally explicit phase boundary. Source mass convention is WEIGHT and needs a stated assumption before mission integration.",
  },
  holding: {
    source: holding,
    sourceEngineCount: table.holding.engineCount,
    sourceRaceTrackFlowKgH: raceTrackFlowKgH,
    sourceStraightLineFlowKgH: straightLineFlowKgH,
    source30MinAtConstantMassKg: raceTrackFlowKgH * 0.5,
    currentModelInstantaneousFlowKgH: modelHoldingFlowKgH,
    diagnosticGapVsRaceTrackPct: (modelHoldingFlowKgH / raceTrackFlowKgH - 1) * 100,
    diagnosticGapVsSourceStraightLinePct: (modelHoldingFlowKgH / straightLineFlowKgH - 1) * 100,
    matchedConditions: false,
    reason: "FCOM uses green-dot race-track at FL15 with installed-engine conditions; the current model uses max L/D and a fixed holding TSFC ratio without an altitude-dependent holding engine model. Straight-line correction only removes the documented pattern difference.",
  },
  conclusions: [
    "The climb total includes takeoff; adding the existing 90 kg on top would double-count fuel.",
    "Holding flow is per engine; descent fuel is aircraft total. Engine count must not be applied to both indiscriminately.",
    "Descent to 1500 ft and IFR approach/landing are different phases.",
    "The source tables do not replace A320, NEO or Boeing phases or justify a new universal TSFC correction.",
    "Exact source-node reproduction checks data handling, not independent accuracy of a mission model using those same tables.",
  ],
};

writeFileSync(new URL("../data/validation-fcom-phases.json", import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
console.log(`FCOM HC-CLF / A319-112: ${report.sourceCellCounts.total} ячейки (${report.sourceCellCounts.climb} набор, ${report.sourceCellCounts.holding} ожидание, ${report.sourceCellCounts.descent} снижение).`);
console.log(`60 т, FL350: FCOM ISA+10 от brake release ${climb.fuelKg} кг; модель ISA0 ${report.climb.currentModel.fuelFromBrakeReleaseKg.toFixed(2)} кг. Условия различаются.`);
console.log(`60 т, FL350 → 1500 ft: ${descent.fuelKg} кг; с отдельными 110 кг IFR: ${report.descent.sourceDescentPlusIfrApproachFuelKg} кг.`);
console.log(`60 т, FL15: FCOM ${holding.fuelFlowPerEngineKgH} кг/ч/дв × ${table.holding.engineCount} = ${raceTrackFlowKgH} кг/ч; текущая формула ${modelHoldingFlowKgH.toFixed(2)} кг/ч.`);
console.log("Это диагностика условий и границ фаз. Калибровка A320 и расчёт миссий не изменены.");
