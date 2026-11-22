// The separately deployed FlightCost solver still replays the original v1 weights.
import { TU214_PS90A, TU214_REFERENCE } from "../src/aircraft/tu214.ts";
import type { AircraftDefinition } from "../src/definition.ts";

export const FLIGHTCOST_TU214_V1: AircraftDefinition = {
  ...TU214_PS90A,
  id: "tu214-ps90a-flightcost-v1",
  label: "Ту-214 / ПС-90А · FlightCost v1",
  weights: {
    ...TU214_PS90A.weights,
    mzfwKg: TU214_REFERENCE.factoryMZFWKg,
    additionalEquipmentKg: 2830,
  },
};
