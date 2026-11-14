// Контекст расчёта для выбранного базового самолёта: калибровка — общая (A320), а опорные значения ограничений —
// от самого базового самолёта, чтобы «как у базы» означало его собственные длину ВПП, угол касания и тягу.
// Длина ВПП базового A319/A321 — оценка той же формулой Raymer от A320 (данных AC в модели нет).

import { type EvalContext } from "../evaluate.ts";
import { type AircraftDefinition } from "../definition.ts";
import { highLiftPerf } from "../highlift.ts";
import { takeoffThrustN } from "../thrust.ts";
import { A320_CONTEXT } from "./a320Context.ts";
import { A320NEO } from "./a320.ts";
import { B737_300, CLASSIC_COWL } from "./b737.ts";
import { B737_8 } from "./b737max.ts";
import maxShape from "../../data/ac/b737-8-shapes.json" with { type: "json" };
import tuShape from "../../data/ac/tu214-shapes.json" with { type: "json" };
import { B737_800, B737_800_NACELLE } from "./b737ng.ts";
import { b757NacelleFor } from "./b757.ts";
import { comparisonAssumptionsFor } from "./missionProfiles.ts";

const cache = new Map<string, EvalContext>();

export function contextFor(def: AircraftDefinition): EvalContext {
  // Id не отличает модифицированную геометрию с тем же именем. Условия FCOM
  // и ограничения относятся к конкретной конфигурации, поэтому ключ — определение целиком.
  const key = JSON.stringify(def);
  let c = cache.get(key);
  if (c) return c;
  const r = A320_CONTEXT.constraintsRef;
  const nacelle757 = def.shapeSet === "b757" ? b757NacelleFor(def.engine) : undefined;
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
      ...(def.id === B737_800.id && {
        nacelleClearanceM: B737_800_NACELLE.clearanceM,
        nacelleWidthM: B737_800_NACELLE.widthM,
        nacelleLowerRadiusPerWidth: B737_800_NACELLE.lowerRadiusPerWidth,
        provenMinClearanceM: B737_800_NACELLE.clearanceM,
        clearanceReference: "737-800W при максимальной рулёжной массе, Boeing §2.3.3",
      }),
      ...(nacelle757 && { nacelleClearanceM: nacelle757.clearance_m, nacelleWidthM: nacelle757.width_m }),
      ...(def.shapeSet === "tu214" && { nacelleClearanceM: tuShape.nacelle.clearance_m, nacelleWidthM: 2.36 }),
      ...(def.engine.name.startsWith("CFM56-3") && {
        nacelleClearanceM: CLASSIC_COWL.clearanceM, nacelleWidthM: B737_300.engine.nacelleWidthM,
        nacelleLowerRadiusPerWidth: CLASSIC_COWL.lowerRadiusM / B737_300.engine.nacelleWidthM,
      }),
      ...(def.engine.name.startsWith("LEAP-1B") && {
        nacelleClearanceM: maxShape.nacelle.axis_y - maxShape.groundY - 1.22,
        nacelleWidthM: B737_8.engine.nacelleWidthM, nacelleLowerRadiusPerWidth: 1.22 / B737_8.engine.nacelleWidthM,
      }),
      ...(def.engine.name.startsWith("LEAP-1A") && {
        nacelleClearanceM: r.nacelleClearanceM + r.nacelleWidthM / 2 - 1.35,
        nacelleWidthM: A320NEO.engine.nacelleWidthM, nacelleLowerRadiusPerWidth: 1.35 / A320NEO.engine.nacelleWidthM,
      }),
    },
  };
  cache.set(key, c);
  return c;
}
