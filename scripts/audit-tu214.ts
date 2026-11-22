// Run: node --experimental-strip-types scripts/audit-tu214.ts > tu214-local.json
// Data below represent model forecasts and assumed example weight configurations, NOT flight planning data.
import { evaluate, type MissionSpec } from "../src/evaluate.ts";
import { contextFor } from "../src/aircraft/contextFor.ts";
import { TU214_PS90A, TU214_FACTORY, TU214_PUBLISHED_LIMIT, TU214_REFERENCE, TU214_OPERATIONAL_CD0_FACTOR, TU214_UNADJUSTED_OEW_REFERENCE_KG, TU214_FUEL_DENSITY_KG_L } from "../src/aircraft/tu214.ts";

const toKm = (nm: number) => nm * 1.852;
const paxSpec: MissionSpec = { distanceNm: 810, seats: 210, massPerPaxKg: 95 };

function modelRow(def: typeof TU214_PS90A) {
  const ctx = contextFor(def);
  const ev = evaluate(def, [], ctx, paxSpec);
  const full = evaluate(def, [], ctx, { ...paxSpec, cargoKg: Math.max(0, ev.maxPayloadKg - 210 * 95) });
  const requestedCargo = evaluate(def, [], ctx, { ...paxSpec, cargoKg: 3000 });
  const fuelCapAtMaxPayloadKg = def.weights.mtowKg - ev.oewKg - ev.maxPayloadKg;
  return {
    id: def.id,
    label: def.label,
    modeledOewKg: ev.oewKg,
    maxPayloadKg: ev.maxPayloadKg,
    maxZeroFuelWeightKg: def.weights.mzfwKg,
    maxTakeoffWeightKg: def.weights.mtowKg,
    maxLandingWeightKg: def.weights.mlwKg,
    fuelDensityKgPerL: ctx.fuelDensityKgL,
    tankMassCapacityKg: def.systems.fuelVolumeL * ctx.fuelDensityKgL,
    fuelAtMaximumPayloadKg: fuelCapAtMaxPayloadKg,
    massReconciliation: {
      rawA320CalibratedModelOewKg: TU214_UNADJUSTED_OEW_REFERENCE_KG,
      unresolvedOewDifferenceKg: ev.masses.byId.get("oewReconciliation")!.kg,
      extraEquipmentKg: ev.masses.byId.get("additionalEquipment")!.kg,
    },
    with210PaxAt95Kg: {
      passengerAndBaggageKg: 210 * 95,
      commercialCargoKg: 0,
      availableFuelByMtowKg: def.weights.mtowKg - ev.oewKg - 210 * 95,
      missionFuelWithReservesKg: ev.missionFuelKg,
      tripFuelKg: ev.tripFuelKg,
      feasible: ev.missionResult.feasible,
    },
    withMaximumPayloadAt210Pax: {
      cargoKg: full.cargoCarriedKg,
      zfwKg: ev.oewKg + full.payloadKg,
      availableFuelByMtowKg: def.weights.mtowKg - ev.oewKg - full.payloadKg,
      missionFuelWithReservesKg: full.missionFuelKg,
      feasible: full.missionResult.feasible,
    },
    requested3000KgCargo: {
      carriedKg: requestedCargo.cargoCarriedKg,
      payloadKg: requestedCargo.payloadKg,
      payloadTruncated: requestedCargo.payloadLimitedByMzfw,
    },
    engine: {
      modelCruiseTsfcKgPerKgfH: ev.tsfcCruise * 9.80665 * 3600,
      manufacturerReferenceCruiseTsfcKgPerKgfH: TU214_REFERENCE.engineCruiseTsfcKgPerKgfHour,
    },
    maxPayloadPoint: {
      ...ev.payloadRange[1],
      rangeKm: toKm(ev.payloadRange[1].rangeNm),
    },
    payloadRange: ev.payloadRange,
    constraints: ev.constraints.map((c) => ({ id: c.id, status: c.status, value: c.value })),
  };
}

const factory = modelRow(TU214_FACTORY);
const operational = modelRow(TU214_PS90A);
const publishedLimit = modelRow(TU214_PUBLISHED_LIMIT);
console.log(JSON.stringify({
  schema: "aircraft-designer/tu214-weight-presets/v3",
  status: "PRELIMINARY ENGINEERING FORECAST — NOT CERTIFIED PERFORMANCE",
  sources: [
    "UAC public Tu-214 figures for MTOW/MLW/fuel/max payload; applicability of weight definitions must be checked",
    "59,000 kg factory reference is indicative, not a component-level weighing report",
    "Tupolev catalogue on AmasEnergy lists 65,265 kg OEW; 22,370 kg payload at 3,800 km is the study reference",
    "FATA-02019A edition 03 (29 May 2020) p. 4 lists 86,000 kg MZFW",
    "Tu-204-200 three-view, UIGA 2024, Perm Motors PS-90A; docs/TU214_MODEL.md",
  ],
  constraints: {
    mtowKg: TU214_REFERENCE.mtowKg,
    mlwKg: TU214_REFERENCE.mlwKg,
    reportedMZFWKg: TU214_REFERENCE.publishedMZFWKg,
    maxFuelKg: TU214_REFERENCE.maxFuelKg,
    densityKgPerL: TU214_FUEL_DENSITY_KG_L,
  },
  factory,
  operational,
  publishedLimit,
  workingRangeCalibration: {
    commercialPayloadKg: TU214_REFERENCE.operationalMaxPayloadKg,
    targetRangeKm: TU214_REFERENCE.operationalRangeTargetKm,
    workingMZFWKg: TU214_REFERENCE.operationalMZFWKg,
    cd0Factor: TU214_OPERATIONAL_CD0_FACTOR,
  },
  consistency: {
    oewDifferenceKg: operational.modeledOewKg - factory.modeledOewKg,
    fullPayloadMaxFuelEqual: Math.abs(factory.fuelAtMaximumPayloadKg - operational.fuelAtMaximumPayloadKg) < 0.01,
    fullPayloadRangeDifferenceNm: operational.maxPayloadPoint.rangeNm - factory.maxPayloadPoint.rangeNm,
  },
  caveats: [
    "No manufacturer weight-and-balance sheet for either specific variant; do not treat the profiles as certified OEW.",
    "The 6,265 kg delta is an OEW accounting difference without an ATA component allocation.",
    "The baseline 59 t minus Raymer/A320-calibrated estimate is an explicit, non-physical reconciliation item.",
    "Structural/levers changes remain driven by the physical model, with reconciliation held constant.",
    "Mission and reserves inherit the A320 comparison policy, not a Tu-214 approved dispatch flight plan.",
    "PS-90A cycle efficiencies and cruise T4 are assumptions; mixer-nozzle effects absent.",
    "The operating scenario exceeds the 2020 type-certificate MZFW by 1,635 kg. The fitted point sets the study model and gives no independent performance validation.",
    "The second-segment climb model warning is not evidence of real Tu-214 certification performance.",
  ],
}, null, 2));
