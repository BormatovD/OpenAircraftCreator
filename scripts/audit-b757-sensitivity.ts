/**
 * Step 08: independent, one-parameter-at-a-time sensitivities of the existing 757 mass tree.
 * Baseline and calibration match Step 07. This script changes NO production coefficients.
 * Run: node --experimental-strip-types scripts/audit-b757-sensitivity.ts > b757-sensitivity-local.json
 */
import { type AircraftDefinition } from "../src/definition.ts";
import { B757_RB211, B757_PW2037 } from "../src/aircraft/b757.ts";
import { A320CEO, AC_OEW_KG } from "../src/aircraft/a320.ts";
import { calibrateMasses, computeMasses } from "../src/mass/massTree.ts";
import { GROUP_MAP, analogueShares } from "../src/mass/analogue.ts";

const calibration = calibrateMasses(A320CEO, AC_OEW_KG.a320ceo, analogueShares(), GROUP_MAP);
const round = (x: number, precision = 3) => Number(x.toFixed(precision));
const H = 0.01; // central finite-difference: x ± 1%

type Scenario = {
  id: string;
  description: string;
  change: (d: AircraftDefinition, multiplier: number) => void;
};
// Not proposed modifications: these are local, hypothetical perturbations to measure model behavior.
const scenarios: Scenario[] = [
  { id: "mtowKg", description: "MTOW, +1% / -1%", change: (d, v) => { d.weights.mtowKg *= v; } },
  { id: "mlwKg", description: "MLW, +1% / -1%", change: (d, v) => { d.weights.mlwKg *= v; } },
  { id: "wing.spanM", description: "Wing span, +1% / -1%", change: (d, v) => { d.wing.spanM *= v; } },
  { id: "wing.areaM2", description: "Wing area, +1% / -1%", change: (d, v) => { d.wing.areaM2 *= v; } },
  { id: "fuselage.lengthM", description: "Fuselage length, +1% / -1%", change: (d, v) => { d.fuselage.lengthM *= v; } },
  { id: "engine.dryMassKg", description: "One dry engine mass, +1% / -1%", change: (d, v) => { d.engine.dryMassKg *= v; } },
  { id: "engine.nacelleWidthM", description: "Nacelle width, +1% / -1%", change: (d, v) => { d.engine.nacelleWidthM *= v; } },
  { id: "engine.nacelleLengthM", description: "Nacelle length, +1% / -1%", change: (d, v) => { d.engine.nacelleLengthM *= v; } },
  { id: "systems.apuUninstalledKg", description: "APU uninstalled mass, +1% / -1%", change: (d, v) => { d.systems.apuUninstalledKg *= v; } },
  { id: "systems.avionicsUninstalledKg", description: "Avionics uninstalled mass, +1% / -1%", change: (d, v) => { d.systems.avionicsUninstalledKg *= v; } },
  { id: "systems.generatorsKva", description: "Installed generator kVA, +1% / -1%", change: (d, v) => { d.systems.generatorsKva *= v; } },
  { id: "systems.electricalRoutingM", description: "Electrical routing length, +1% / -1%", change: (d, v) => { d.systems.electricalRoutingM *= v; } },
  { id: "fuselage.pressurizedVolumeM3", description: "Pressurized volume, +1% / -1%", change: (d, v) => { d.fuselage.pressurizedVolumeM3 *= v; } },
  { id: "systems.cargoMassKg", description: "Cargo design allowance input, +1% / -1%", change: (d, v) => { d.systems.cargoMassKg *= v; } },
];

function audit(def: AircraftDefinition, referenceKg: number) {
  const base = computeMasses(def, calibration);
  const groupMasses = Object.fromEntries(base.roots.map((n) => [n.id, round(n.kg)]));
  const components = Object.fromEntries(
    [...base.byId.values()].filter((n) => n.children.length === 0).map((n) => [n.id, round(n.kg)]),
  );
  const shortfall = referenceKg - base.oewKg;
  const sensitivities = scenarios.map((scenario) => {
    const plus = structuredClone(def);
    const minus = structuredClone(def);
    scenario.change(plus, 1 + H);
    scenario.change(minus, 1 - H);
    const massPlus = computeMasses(plus, calibration);
    const massMinus = computeMasses(minus, calibration);
    const derivativeOfOew = (massPlus.oewKg - massMinus.oewKg) / (2 * H);
    // Relative elasticity: %OEW change for 1% change of this input (local approximation).
    const elasticity = derivativeOfOew / base.oewKg;
    const leafDeltas = [...base.byId.values()].filter(n => n.children.length === 0)
      .map(n => ({ id: n.id, deltaKgForPlus1Pct: massPlus.byId.get(n.id)!.kg - n.kg }))
      .filter(n => Math.abs(n.deltaKgForPlus1Pct) > 0.01)
      .sort((a, b) => Math.abs(b.deltaKgForPlus1Pct) - Math.abs(a.deltaKgForPlus1Pct));
    return {
      input: scenario.id,
      description: scenario.description,
      deltaOewKgForPlus1Pct: round(massPlus.oewKg - base.oewKg),
      deltaOewKgForMinus1Pct: round(massMinus.oewKg - base.oewKg),
      localOewElasticity: round(elasticity, 5),
      leadingChangedLeaves: leafDeltas.slice(0, 4).map(v => ({ id: v.id, deltaKgForPlus1Pct: round(v.deltaKgForPlus1Pct) })),
    };
  }).sort((a, b) => Math.abs(b.deltaOewKgForPlus1Pct) - Math.abs(a.deltaOewKgForPlus1Pct));
  return {
    variant: def.engine.name,
    mtowKg: def.weights.mtowKg,
    referenceKg,
    modelOewKg: round(base.oewKg),
    shortfallKg: round(shortfall),
    shortfallPctOfReference: round((100 * shortfall) / referenceKg),
    sourceLabel: "Boeing D6-58327 Rev H, typical as-delivered or as-offered OEW for 240,000 lb MTOW column",
    groupsKg: groupMasses,
    leavesKg: components,
    hypotheticalSingleGroupBridges: base.roots.map((n) => ({
      group: n.id,
      groupKg: round(n.kg),
      upliftPercentIfOnlyThisGroupBridgesGap: round((100 * shortfall) / n.kg),
      unresolvedGapKgAfterHypotheticalPlus10Pct: round(shortfall - n.kg * 0.10),
    })),
    sensitivities,
  };
}
const rb = audit(B757_RB211, 60_001);
const pw = audit(B757_PW2037, 59_357);
const groupContributions = Object.keys(rb.groupsKg).map((id) => ({
  group: id,
  pwMinusRbKg: round(pw.groupsKg[id] - rb.groupsKg[id]),
}));
const leafContributions = Object.keys(rb.leavesKg).map((id) => ({
  leaf: id,
  pwMinusRbKg: round(pw.leavesKg[id] - rb.leavesKg[id]),
})).filter(row => Math.abs(row.pwMinusRbKg) > 0.01).sort((a, b) => Math.abs(b.pwMinusRbKg) - Math.abs(a.pwMinusRbKg));
console.log(JSON.stringify({
  name: "757 mass sensitivity — independent diagnostic, not a fit",
  warning: "Partial derivatives describe this model near its existing reference point. They neither establish true OEM component weights nor solve source configuration mismatches.",
  method: "One input at a time, central difference +/-1%; original A320 mass calibration kept fixed. The group bridge scenario is hypothetical, not an engineering correction.",
  variants: [rb, pw],
  comparison: {
    sourceRbMinusPwKg: 644,
    modelRbMinusPwKg: round(rb.modelOewKg - pw.modelOewKg),
    signReversalGapKg: round(644 - (rb.modelOewKg - pw.modelOewKg)),
    modelPwMinusRbByGroupKg: groupContributions,
    modelPwMinusRbByLeafKg: leafContributions,
  },
}, null, 2));
