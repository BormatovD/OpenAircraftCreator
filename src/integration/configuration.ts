import { contextFor } from "../aircraft/contextFor.ts";
import type { AircraftDefinition } from "../definition.ts";
import { DEFAULT_MISSION, evaluate, type Evaluation } from "../evaluate.ts";
import type { Lever } from "../levers.ts";
import { designMissionOf, redesign } from "../redesign.ts";

/** Resolve the editable design once, including the geometry produced by redesign. */
export function evaluateConfiguration(def: AircraftDefinition, levers: Lever[], mode: "fixed" | "redesign", base: Evaluation) {
  const ctx = contextFor(def);
  const fixed = evaluate(def, levers, ctx);
  if (mode === "fixed") return { ev: fixed, base, levers, ctx };
  const mission = { ...designMissionOf(base), payloadKg: fixed.seats * DEFAULT_MISSION.massPerPaxKg };
  const rs = redesign(def, levers, ctx, mission);
  return { ev: rs.evaluation, base, levers, ctx,
    redesign: { converged: rs.converged, iterations: rs.iterations, designRangeNm: mission.rangeNm } };
}
