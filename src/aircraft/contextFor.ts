// Контекст расчёта для выбранного базового самолёта: калибровка — общая (A320), а опорные значения ограничений —
// от самого базового самолёта, чтобы «как у базы» означало его собственные длину ВПП, угол касания и тягу.
// Длина ВПП базового A319/A321 — оценка той же формулой Raymer от A320 (данных AC в модели нет).

import { type EvalContext } from "../evaluate.ts";
import { type AircraftDefinition } from "../definition.ts";
import { highLiftPerf } from "../highlift.ts";
import { takeoffThrustN } from "../thrust.ts";
import { A320_CONTEXT } from "./a320Context.ts";
import { comparisonAssumptionsFor } from "./missionProfiles.ts";

const cache = new Map<string, EvalContext>();

export function contextFor(def: AircraftDefinition): EvalContext {
  // Id не отличает модифицированную геометрию с тем же именем. Условия FCOM
  // и ограничения относятся к конкретной конфигурации, поэтому ключ — определение целиком.
  const key = JSON.stringify(def);
  let c = cache.get(key);
  if (c) return c;
  const r = A320_CONTEXT.constraintsRef;
  const clTo = highLiftPerf(def, A320_CONTEXT.highLiftAnchor).clMaxTakeoff;
  const tofl =
    (r.takeoffFieldLengthM * Math.pow(def.weights.mtowKg / r.mtowKg, 2) * (r.wingAreaM2 / def.wing.areaM2) * (r.clMaxTakeoff / clTo)) /
    (takeoffThrustN(def) / r.takeoffThrustN);
  c = {
    ...A320_CONTEXT,
    // Ту-214: 35 710 кг баки при плотности 0,78 кг/л; для A320 — прежние 0,785.
    fuelDensityKgL: def.shapeSet === "tu214" ? 0.78 : A320_CONTEXT.fuelDensityKgL,
    assumptions: comparisonAssumptionsFor(def),
    constraintsRef: {
      ...r,
      takeoffFieldLengthM: Math.round(tofl),
      mtowKg: def.weights.mtowKg,
      wingAreaM2: def.wing.areaM2,
      takeoffThrustN: takeoffThrustN(def),
      clMaxTakeoff: clTo,
      baseLengthM: def.fuselage.lengthM,
      // For Tu-214, use the provisional installed PS-90A reference from its own
      // three-view shape, not the A320 nacelle datum (0.58 m).
      ...(def.shapeSet === "tu214" ? { nacelleClearanceM: 0.79, nacelleWidthM: 2.36 } : {}),
    },
  };
  cache.set(key, c);
  return c;
}
