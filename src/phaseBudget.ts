// Справочный бюджет фаз для конкретного набора FCOM. Не выбирает самолёт по похожему названию
// и не переносит таблицы на изменённое крыло/двигатель. Массы фаз задаются явно: это ещё не
// интегратор полной миссии, который должен связать их расходом крейсера и резервами.
import { type PhaseTableDataset, lookupClimb, lookupDescent, lookupHolding } from "./phaseTables.ts";

export interface PhaseBoundaries {
  /** До этой высоты выделяется взлёт вместе с начальным набором, не один разбег. */
  initialClimbEndFl: number;
  /** Нижняя граница табличного снижения. */
  descentEndFl: number;
  /** Отдельный расход от границы снижения до посадки по выбранной методике планирования. */
  approachAndLandingFuelKg: number;
}

export interface ReferencePhaseRequest {
  brakeReleaseMassKg: number;
  climbToFl: number;
  climbIsaDeviationC: number;
  /** Именно WEIGHT таблицы. API не объявляет её начальной, средней или конечной без источника. */
  descentReferenceMassKg: number;
  descentFromFl: number;
  /** Для CES planning — landing weight at the alternate до вычитания holding fuel. */
  holdingReferenceMassKg: number;
  holdingFl: number;
  holdingMinutes: number;
}

export interface PhaseFuelCorrections {
  /** Поправки в процентах к FUEL / FF. N1, EPR, kVA и кВт сюда не подставляются. */
  climbFuelPct?: number;
  descentFuelPct?: number;
  holdingFuelFlowPct?: number;
}

/**
 * Бюджет без двойного учёта: набор от brake release уже содержит взлёт; к снижению
 * добавляется только отдельный заход; FF ожидания умножается на число двигателей.
 * Ожидание считается по опорной массе планирования × длительность, без неоговорённой
 * интеграции меняющейся массы. Поправки вызывающий берёт из применимого источника.
 * За границами таблиц или в пустой ячейке возвращает undefined, без экстраполяции.
 */
export function referencePhaseBudget(
  dataset: PhaseTableDataset,
  boundaries: PhaseBoundaries,
  request: ReferencePhaseRequest,
  corrections: PhaseFuelCorrections = {},
) {
  const factors = [corrections.climbFuelPct ?? 0, corrections.descentFuelPct ?? 0, corrections.holdingFuelFlowPct ?? 0]
    .map((pct) => 1 + pct / 100);
  if (!factors.every((x) => Number.isFinite(x) && x > 0)
      || !Number.isFinite(request.holdingMinutes) || request.holdingMinutes < 0
      || !Number.isFinite(boundaries.approachAndLandingFuelKg) || boundaries.approachAndLandingFuelKg < 0
      || !Number.isFinite(boundaries.initialClimbEndFl) || boundaries.initialClimbEndFl < 0
      || !Number.isFinite(boundaries.descentEndFl) || boundaries.descentEndFl < 0
      || !Number.isInteger(dataset.holding.engineCount) || dataset.holding.engineCount <= 0)
    throw new RangeError("Некорректные границы фаз, поправки, длительность или число двигателей");
  if (request.climbToFl < boundaries.initialClimbEndFl || request.descentFromFl < boundaries.descentEndFl)
    return undefined;
  const climb = lookupClimb(dataset, request.brakeReleaseMassKg, request.climbToFl, request.climbIsaDeviationC);
  const initial = lookupClimb(dataset, request.brakeReleaseMassKg, boundaries.initialClimbEndFl, request.climbIsaDeviationC);
  const descent = lookupDescent(dataset, request.descentReferenceMassKg, request.descentFromFl);
  const descentEnd = lookupDescent(dataset, request.descentReferenceMassKg, boundaries.descentEndFl);
  const holding = lookupHolding(dataset, request.holdingReferenceMassKg, request.holdingFl);
  // Подпись границы не должна переименовать полный источник FL→1500 ft в FL→5000 ft.
  // Только нулевой конец накопленной таблицы позволяет добавить отдельный заход без вычитания фаз.
  if (!climb || !initial || !descent || !descentEnd || !holding || climb.fuelKg < initial.fuelKg
      || descentEnd.fuelKg !== 0 || descentEnd.timeMin !== 0 || descentEnd.distanceNm !== 0) return undefined;
  const departureFuelKg = climb.fuelKg * factors[0];
  const takeoffAndInitialClimbFuelKg = initial.fuelKg * factors[0];
  const descentFuelKg = descent.fuelKg * factors[1];
  const arrivalFuelKg = descentFuelKg + boundaries.approachAndLandingFuelKg;
  const holdingFlowPerEngineKgH = holding.fuelFlowPerEngineKgH * factors[2];
  const holdingFlowTotalKgH = holdingFlowPerEngineKgH * dataset.holding.engineCount;
  return {
    request: { ...request },
    boundaries: { ...boundaries },
    corrections: { ...corrections },
    departure: {
      source: climb,
      sourceInitialClimb: initial,
      takeoffAndInitialClimbFuelKg,
      climbAboveInitialFuelKg: departureFuelKg - takeoffAndInitialClimbFuelKg,
      totalFuelKg: departureFuelKg,
      /** Табличная дистанция/время сохранены; топливные поправки не меняют их автоматически. */
      distanceNm: climb.distanceNm,
      timeMin: climb.timeMin,
    },
    arrival: {
      source: descent,
      descentFuelKg,
      approachAndLandingFuelKg: boundaries.approachAndLandingFuelKg,
      totalFuelKg: arrivalFuelKg,
      /** Дистанция и время только табличного снижения, без выдуманного участка захода. */
      descentDistanceNm: descent.distanceNm,
      descentTimeMin: descent.timeMin,
    },
    holding: {
      source: holding,
      engineCount: dataset.holding.engineCount,
      fuelFlowPerEngineKgH: holdingFlowPerEngineKgH,
      fuelFlowTotalKgH: holdingFlowTotalKgH,
      fuelKg: holdingFlowTotalKgH * request.holdingMinutes / 60,
    },
    /** Без крейсера, руления и резервов. Ожидание показано отдельно, не списано как рейсовое топливо. */
    tripNonCruiseFuelKg: departureFuelKg + arrivalFuelKg,
  };
}
