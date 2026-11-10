// Контекст расчёта для выбранного базового самолёта: калибровка — общая (A320), а опорные значения ограничений —
// от самого базового самолёта, чтобы «как у базы» означало его собственные длину ВПП, угол касания и тягу.
// Длина ВПП базового A319/A321 — оценка той же формулой Raymer от A320 (данных AC в модели нет).

import { type EvalContext } from "../evaluate.ts";
import { type AircraftDefinition } from "../definition.ts";
import { highLiftPerf } from "../highlift.ts";
import { takeoffThrustN } from "../thrust.ts";
import { A320_CONTEXT } from "./a320Context.ts";

const cache = new Map<string, EvalContext>();

export function contextFor(def: AircraftDefinition): EvalContext {
  let c = cache.get(def.id);
  if (c) return c;
  const r = A320_CONTEXT.constraintsRef;
  const clTo = highLiftPerf(def, A320_CONTEXT.highLiftAnchor).clMaxTakeoff;
  const tofl =
    (r.takeoffFieldLengthM * Math.pow(def.weights.mtowKg / r.mtowKg, 2) * (r.wingAreaM2 / def.wing.areaM2) * (r.clMaxTakeoff / clTo)) /
    (takeoffThrustN(def) / r.takeoffThrustN);
  c = {
    ...A320_CONTEXT,
    constraintsRef: {
      ...r,
      takeoffFieldLengthM: Math.round(tofl),
      mtowKg: def.weights.mtowKg,
      wingAreaM2: def.wing.areaM2,
      takeoffThrustN: takeoffThrustN(def),
      clMaxTakeoff: clTo,
      baseLengthM: def.fuselage.lengthM,
    },
  };
  cache.set(def.id, c);
  return c;
}
