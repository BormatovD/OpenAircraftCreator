// Airport-planning layouts are examples. Fit service modules to the selected
// airframe's door stations; passenger counts and classes come from the catalog.
import type { AircraftDefinition } from "../../src/definition.ts";
import { cabinOpenings } from "./features.ts";
import { S } from "./shapeSet.ts";
import { buildPassengerCabin, type PassengerCabinModule, type PassengerCabinSpec } from "./passengerCabin.ts";

export function fleetCabinSpec(def: AircraftDefinition): PassengerCabinSpec {
  const doors = ([-1, 1] as const).map(side => cabinOpenings(def, side).sort((a, b) => a.x0 - b.x0));
  const forward = Math.min(...doors.map(d => d[0].x0)) - .12;
  const aft = Math.max(...doors.map(d => d.at(-1)!.x1)) + .12;
  const aftEntrance = Math.min(...doors.map(d => d.at(-1)!.x0));
  const airbus = S().id === "a320";
  const longBoeing = S().id === "b757";
  const outer = def.fuselage.widthM / 2 - .13;
  const aisleWidthM = airbus ? .53 : .51;
  const inner = aisleWidthM / 2 + .04;
  const floorY = S().cabin.floorY;
  const modules: PassengerCabinModule[] = [];
  function install(role: PassengerCabinModule["role"], start: number, end: number, side: number) {
    modules.push({ role, x0: start, x1: end, z0: side > 0 ? inner : -outer, z1: side > 0 ? outer : -inner });
  }
  install("galley", forward - .89, forward, 1);
  install("lavatory", forward - .91, forward, -1);
  const compactRear = def.cabinLayout?.id === "a320-194" || def.cabinLayout?.id === "a321-244" || def.cabinLayout?.id === "b38m-210";
  if (compactRear) {
    install("galley", aft, aft + .75, 1);
    install("lavatory", aft + .81, aft + 1.61, 1);
    install("lavatory", aft + .81, aft + 1.61, -1);
  } else {
    install("galley", aft, aft + (longBoeing ? 1.32 : .96), 1);
    install("lavatory", aft, aft + .90, -1);
    if (airbus || longBoeing || def.id !== "b737-300") install("lavatory", aft + 1.03, aft + 1.91, -1);
  }
  if (longBoeing) {
    // The 757 forward service complex also serves the second pair of doors.
    const second = Math.max(...doors.map(d => d[1].x1));
    install("galley", second + .12, second + .84, 1);
  }
  return {
    id: def.cabinLayout?.id ?? def.id, floorY, modules, aisleWidthM,
    floorStartX: forward - .94, floorEndX: Math.max(...modules.map(m => m.x1)) + .05,
    firstRowX: Math.max(...doors.map(d => d[0].x1)) + .11, lastRowEndX: aftEntrance - .11,
    seatOuterZ: outer, overheadBin: { innerZ: outer - .61, outerZ: outer, bottomY: floorY + 1.48, topY: floorY + 1.78 },
    // High-density and shortened model presets need an explicitly schematic
    // visual pitch. Physical seat depth is .63m; rows never overlap one another.
    minimumPitchM: .631,
    doorClearanceM: compactRear ? .07 : .10,
  };
}
export const fleetCabin = (def: AircraftDefinition) => buildPassengerCabin(def, fleetCabinSpec(def));
