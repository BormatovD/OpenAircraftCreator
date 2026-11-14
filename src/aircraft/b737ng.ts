// Passenger 737-800W, 174,200 lb option (Boeing D6-58325-7 Rev C §2.1.3).
// The 737 shape set was digitised from the -800. Tail and section estimates are
// already shared with the MAX 8; the installed engine, tips and weights differ.
import type { AircraftDefinition } from "../definition.ts";
import { A320CEO } from "./a320.ts";
import { B737_8 } from "./b737max.ts";

// Boeing D6-58325-7 Rev C §2.3.3, item D: nominal ground clearance at
// maximum taxi weight. The static 3D scene uses this loaded attitude.
export const B737_800_NACELLE = {
  clearanceM: 0.48,
  widthM: 2.53,
  lengthM: 5.16,
  // The mesh flattens the bottom of the outer cowl by 7.5% of its radius.
  lowerRadiusPerWidth: (1 - 0.075) / 2,
} as const;

export const B737_800: AircraftDefinition = {
  id: "b737-800",
  label: "Boeing 737-800, CFM56-7B26",
  shortName: "737-800",
  shapeSet: "b737",
  wing: { ...B737_8.wing, areaM2: 124.6, spanM: 34.32, tip: "blended", sharkletSpanM: 35.79 },
  htail: B737_8.htail,
  vtail: B737_8.vtail,
  fuselage: B737_8.fuselage, // shell length; Boeing quotes 39.47 m overall
  gear: B737_8.gear,
  engine: {
    ...A320CEO.engine, // provisional CFM56 cycle efficiencies
    name: "CFM56-7B26",
    nacelleProfile: "cfm56-7b",
    dryMassKg: 2386, // EASA TCDS E.004, §III.5, original SAC
    takeoffThrustKn: 116.99,
    fanDiameterM: 1.55,
    bypassRatio: 5.1,
    overallPressureRatio: 27.61, // ICAO databank, UID 8CM051, sea-level rating
    architecture: { fanBlades: 24, boosterStages: 3, hpcStages: 9, hptStages: 1 },
    installation: "close-coupled",
    nacelleRaiseM: 0,
    // Installed envelope from the 737-800 mesh, scaled to the shared shell.
    nacelleWidthM: B737_800_NACELLE.widthM,
    nacelleLengthM: B737_800_NACELLE.lengthM,
  },
  systems: {
    ...B737_8.systems, seats: 162, cabinCrew: 4,
    fuelVolumeL: 26024, cargoMassKg: Math.round(45.1 * 160),
  },
  weights: {
    ...B737_8.weights, mtowKg: 79015, mlwKg: 66360, mzfwKg: 62731,
    operatorItemsKg: Math.round(A320CEO.weights.operatorItemsKg * 162 / 180),
  },
};
