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
      // A320neo's dimension is not a universal safety/operating clearance.
      provenMinClearanceM: undefined,
      clearanceEstimated: true,
      clearanceReference: "Размерная модель; условия массы, CG и обжатия стоек не подтверждены",
      baseBypassRatio: def.engine.bypassRatio,
      ...(def.engine.name.startsWith("CFM56-5") && {
        provenMinClearanceM: def.id.startsWith("a321") ? .599 : def.id.startsWith("a319") ? .57 : .568,
        clearanceReference: `Airbus AC ${def.shortName ?? def.id} §2-3-0, CFM56-5B: собственные размерные таблицы стояночных конфигураций. Геометрия семейства приближённая, обжатие стоек для массы/CG не рассчитано.`,
      }),
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
        clearanceVariationM: .0762,
        clearanceEstimated: false,
        clearanceReference: "Boeing 737NG ACAP Rev C §2.3.3, 737-800W: 0,48 м при MTW; вариация загрузки, oleo, шин и CG ±3 in. https://www.boeing.com/content/dam/boeing/v2/airports/acaps/737NG_REV_C.pdf",
      }),
      ...(nacelle757 && { nacelleClearanceM: nacelle757.clearance_m, nacelleWidthM: nacelle757.width_m,
        provenMinClearanceM: .74,
        clearanceReference: "Boeing 757 ACAP Rev H §2.3.1: общий диапазон 0,74–0,86 м при загрузке/разгрузке; разделения по двигателям нет. Модельные значения сняты с геометрии. https://www.boeing.com/content/dam/boeing/v2/airports/acaps/757_Rev_H.pdf" }),
      ...(def.shapeSet === "tu214" && { nacelleClearanceM: tuShape.nacelle.clearance_m, nacelleWidthM: 2.36,
        clearanceReference: "Оцифрованный чертёж Ту-204-200, docs/TU214_MODEL.md: точность порядка 0,1 м; масса/CG/обжатие стоек не установлены. Подтверждённого эксплуатационного минимума нет." }),
      ...(def.engine.name.startsWith("CFM56-3") && {
        nacelleClearanceM: CLASSIC_COWL.clearanceM, nacelleWidthM: B737_300.engine.nacelleWidthM,
        nacelleLowerRadiusPerWidth: CLASSIC_COWL.lowerRadiusM / B737_300.engine.nacelleWidthM,
        provenMinClearanceM: .46, clearanceVariationM: .0762, clearanceEstimated: false,
        clearanceReference: "Boeing 737 Classic ACAP Rev E §2.3.2: 0,46 м при MTW, 0,53 м при OEW; вариация условий ±3 in. https://www.boeing.com/content/dam/boeing/v2/airports/acaps/737CL_REV_E.pdf",
      }),
      ...(def.engine.name.startsWith("LEAP-1B") && {
        nacelleClearanceM: maxShape.nacelle.axis_y - maxShape.groundY - 1.22,
        nacelleWidthM: B737_8.engine.nacelleWidthM, nacelleLowerRadiusPerWidth: 1.22 / B737_8.engine.nacelleWidthM,
        provenMinClearanceM: .43, clearanceVariationM: .0762,
        clearanceReference: "Boeing 737 MAX ACAP Rev G §2.3.2: 0,43–0,56 м; вариация условий ±3 in. Геометрия модели ≈0,40 м: условия не согласованы. https://www.boeing.com/content/dam/boeing/boeingdotcom/commercial/airports/acaps/737MAX_RevG.pdf",
      }),
      ...(def.engine.name.startsWith("LEAP-1A") && {
        nacelleClearanceM: r.nacelleClearanceM + r.nacelleWidthM / 2 - 1.35,
        nacelleWidthM: A320NEO.engine.nacelleWidthM, nacelleLowerRadiusPerWidth: 1.35 / A320NEO.engine.nacelleWidthM,
        provenMinClearanceM: .46,
        clearanceReference: `Airbus AC ${def.shortName ?? def.id} §2-3-0: LEAP-1A, минимум размерной таблицы 0,46 м (MRW, FWD CG); геометрия модели без расчёта обжатия стоек.`,
      }),
    },
  };
  cache.set(key, c);
  return c;
}
