// Скоростной/высотный профиль типа и правила резервов сравнения — независимые условия.
// Проверки графиков используют полные *_ASSUMPTIONS из определений. Пользовательские сценарии
// сохраняют общие резервы A320 (5%, запасной 200 nm, ожидание 30 мин), но летят со скоростями своего типа.

import { type AircraftDefinition } from "../definition.ts";
import { DEFAULT_ASSUMPTIONS, type MissionAssumptions } from "../mission.ts";
import { B737_ASSUMPTIONS } from "./b737.ts";
import { B737_8_ASSUMPTIONS } from "./b737max.ts";
import { B757_ASSUMPTIONS } from "./b757.ts";

export function comparisonAssumptionsFor(def: AircraftDefinition): MissionAssumptions {
  const flight = def.id === "b737-300" ? B737_ASSUMPTIONS
    : def.id === "b737-8" ? B737_8_ASSUMPTIONS
    : def.id.startsWith("b757-") ? B757_ASSUMPTIONS
    : DEFAULT_ASSUMPTIONS;
  return {
    ...DEFAULT_ASSUMPTIONS,
    cruiseMach: flight.cruiseMach,
    cruiseSpeedMode: flight.cruiseSpeedMode,
    lrcTable: flight.lrcTable,
    cruiseFL: flight.cruiseFL,
    cruiseAltitudeMode: flight.cruiseAltitudeMode,
    stepFLs: [...flight.stepFLs],
    cruiseClMax: flight.cruiseClMax,
  };
}
