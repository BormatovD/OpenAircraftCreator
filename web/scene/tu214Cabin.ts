import type { AircraftDefinition } from "../../src/definition.ts";
import { buildPassengerCabin, type PassengerCabinSpec } from "./passengerCabin.ts";
import { S } from "./shapeSet.ts";
import { modelX } from "./shapes.ts";

/** UIGA figure 12 establishes room types and service zoning, not the LOPA of
 * these 194/210-seat presets. Room sizes/stations are an explicitly schematic
 * adaptation; see docs/aggregates/tu214-cabin.md. Both weight profiles share it. */
export function tu214CabinSpec(def: AircraftDefinition): PassengerCabinSpec {
  const floor = S().cabin.floorY;
  const x = (station: number) => modelX(def.fuselage.lengthM, station);
  // Rooms keep their size when a shortening plug collapses source stations.
  const secondDoor = x(11.65), exit = x(25.23), aftDoor = x(36.94);
  return {
    id: "tu214-passenger-cabin-v1",
    floorY: floor,
    firstRowX: 5.40,
    lastRowEndX: aftDoor - 1.48,
    floorStartX: 3.12,
    floorEndX: aftDoor + 1.91,
    aisleWidthM: .58,
    seatOuterZ: 1.73,
    overheadBin: { innerZ: .87, outerZ: 1.64, bottomY: floor + 1.77, topY: floor + 2.19 },
    doorClearanceM: .10,
    minimumPitchM: .68,
    modules: [
      { role: "lavatory", x0: 3.12, x1: 4.00, z0: .43, z1: 1.67 },
      { role: "galley", x0: 3.12, x1: 4.00, z0: -1.67, z1: -.43 },
      ...([-1, 1] as const).flatMap(side => {
        const z0 = side === 1 ? .43 : -1.70, z1 = side === 1 ? 1.70 : -.43;
        return [
          { role: "wardrobe" as const, x0: secondDoor - .71, x1: secondDoor - .21, z0, z1 },
          { role: "lavatory" as const, x0: exit - 1.18, x1: exit - .16, z0, z1 },
          { role: "lavatory" as const, x0: aftDoor - 1.38, x1: aftDoor - .18, z0, z1 },
          { role: "galley" as const, x0: aftDoor + 1.05, x1: aftDoor + 1.89, z0, z1 },
        ];
      }),
    ],
  };
}

/** Call after useShapes(def), consistently with the other scene packages. */
export function tu214Cabin(def: AircraftDefinition) {
  return buildPassengerCabin(def, tu214CabinSpec(def));
}
