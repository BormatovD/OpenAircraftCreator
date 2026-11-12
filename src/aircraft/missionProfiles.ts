// Скоростной/высотный профиль типа и правила резервов сравнения — независимые условия.
// Проверки графиков используют полные *_ASSUMPTIONS из определений. Пользовательские сценарии
// сохраняют общие резервы A320 (5%, запасной 200 nm, ожидание 30 мин), но летят со скоростями своего типа.

import { type AircraftDefinition } from "../definition.ts";
import { A320CEO } from "./a320.ts";
import ces from "../../data/fcom/a320-214-ces-phases.json" with { type: "json" };
import { DEFAULT_ASSUMPTIONS, type MissionAssumptions } from "../mission.ts";
import { B737_ASSUMPTIONS } from "./b737.ts";
import { B737_8_ASSUMPTIONS } from "./b737max.ts";
import { B757_ASSUMPTIONS } from "./b757.ts";

/** FCOM-числа нельзя переносить на перепроектированную машину, даже если прежний id сохранён. */
export function isCesA320Reference(def: AircraftDefinition): boolean {
  return def.id === "a320ceo" &&
    (["wing", "fuselage", "htail", "vtail", "gear", "engine", "systems", "weights"] as const)
      .every((key) => JSON.stringify(def[key]) === JSON.stringify(A320CEO[key]));
}

export function comparisonAssumptionsFor(def: AircraftDefinition): MissionAssumptions {
  const flight = def.id === "b737-300" ? B737_ASSUMPTIONS
    : def.id === "b737-8" ? B737_8_ASSUMPTIONS
    : def.id.startsWith("b757-") ? B757_ASSUMPTIONS
    : DEFAULT_ASSUMPTIONS;
  return {
    ...DEFAULT_ASSUMPTIONS,
    fcomClimb: isCesA320Reference(def) ? ces : undefined,
    fcomClimbIsaDeviationC: 0,
    fcomDescent: isCesA320Reference(def) ? ces : undefined,
    fcomApproachFuelKg: 120, // CES FCOM V2: IFR approach+landing, six minutes, aircraft total.
    fcomApproachDurationMin: 6,
    fcomApproachGroundspeedKt: 135, // Explicit engineering estimate, NOT in the CES FCOM descent table.
    fcomHolding: isCesA320Reference(def) ? ces : undefined,
    fcomHoldingFL: 15, // FCOM planning: alternate aerodrome at sea level, holding at 1,500 ft.
    cruiseMach: flight.cruiseMach,
    cruiseSpeedMode: flight.cruiseSpeedMode,
    lrcTable: flight.lrcTable,
    cruiseFL: flight.cruiseFL,
    cruiseAltitudeMode: flight.cruiseAltitudeMode,
    stepFLs: [...flight.stepFLs],
    cruiseClMax: flight.cruiseClMax,
  };
}
