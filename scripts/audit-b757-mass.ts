/**
 * Step 07: diagnostic-only Boeing 757 mass audit; does not change model coefficients.
 * Run: node --experimental-strip-types scripts/audit-b757-mass.ts > b757-mass-local.json
 * Reference: Boeing D6-58327 Rev H (Dec 2024), PDF pp. 15-17, sections 2.1.1 and 2.1.2.
 */
import { type AircraftDefinition } from "../src/definition.ts";
import { A320CEO, AC_OEW_KG } from "../src/aircraft/a320.ts";
import { B757_RB211, B757_PW2037 } from "../src/aircraft/b757.ts";
import { calibrateMasses, computeMasses } from "../src/mass/massTree.ts";
import { GROUP_MAP, analogueShares } from "../src/mass/analogue.ts";

const CAL = calibrateMasses(A320CEO, AC_OEW_KG.a320ceo, analogueShares(), GROUP_MAP);

// Each value is from the SAME MTOW column in the source, but a column can be a different
// as-delivered or as-offered configuration. A different column is NOT a controlled MTOW experiment.
const SPEC = {
  mtowLb: [220_000, 230_000, 240_000, 250_000, 255_000],
  rb211OewKg: [60_822, 56_748, 60_001, 62_114, 62_114],
  pwOewKg: [58_232, 59_352, 59_357, 59_363, 59_363],
} as const;
const round = (x: number) => Math.round(x * 1000) / 1000;
const percent = (model: number, ref: number) => round(((model - ref) / ref) * 100);

function calculate(id: string, definition: AircraftDefinition, reference: readonly number[]) {
  const mass = computeMasses(definition, CAL);
  return {
    id,
    engine: definition.engine.name,
    dryEngineKgPair: definition.engine.count * definition.engine.dryMassKg,
    modelOewKg: round(mass.oewKg),
    specAt240kKg: reference[2],
    deltaAt240kKg: round(mass.oewKg - reference[2]),
    deltaAt240kPercent: percent(mass.oewKg, reference[2]),
    comparisons: SPEC.mtowLb.map((mtowLb, i) => ({
      mtowLb,
      specOewKg: reference[i],
      modelMinusSpecKg: round(mass.oewKg - reference[i]),
      modelMinusSpecPercent: percent(mass.oewKg, reference[i]),
      // Note: the model definition is always the 240,000 lb MTOW airframe,
      // so comparisons with other MTOW columns show configuration sensitivity, not validation.
      comparableAirframe: mtowLb === 240_000,
    })),
    massGroupsKg: Object.fromEntries(mass.roots.map((n) => [n.id, round(n.kg)])),
    massLeaves: [...mass.byId.values()]
      .filter((n) => n.children.length === 0)
      .map((n) => ({ id: n.id, ata: n.ata ?? null, kg: round(n.kg), uncalibratedKg: round(n.rawKg) })),
  };
}

const rb = calculate("757-RB211", B757_RB211, SPEC.rb211OewKg);
const pw = calculate("757-PW2037", B757_PW2037, SPEC.pwOewKg);
console.log(JSON.stringify({
  report: "B757 mass cross-check: diagnostic only, no recalibration",
  sources: [
    "Boeing 757-200/-300 Aircraft Characteristics for Airport Planning, D6-58327 Rev H (Dec 2024), PDF pp. 15-17",
    "Mass breakdown: Raymer formulas calibrated to A320 OEW with 737-200 analogue group shares",
  ],
  sourceWarnings: [
    "Boeing values are typical as-delivered or as-offered OEW; consult airline for actual aircraft weights",
    "Non-240k source columns may differ in equipment and MTOW; not a controlled mass sensitivity test",
    "No component-level Boeing 757 mass breakdown is available in these ACAP pages",
  ],
  referenceColumns: SPEC,
  calibrationA320OewKg: AC_OEW_KG.a320ceo,
  variantComparison240k: {
    sourceRbMinusPwKg: SPEC.rb211OewKg[2] - SPEC.pwOewKg[2],
    modelRbMinusPwKg: round(rb.modelOewKg - pw.modelOewKg),
  },
  variants: [rb, pw],
}, null, 2));
