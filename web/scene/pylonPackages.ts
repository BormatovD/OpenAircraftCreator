import type { NacelleStyle } from "./shapes.ts";
import type { PylonSpec } from "./pylonGeometry.ts";
import { pylon737 } from "./pylon737.ts";
import { pylon757Tu } from "./pylon757Tu.ts";
import { airbusPylons } from "./pylonAirbus.ts";

const packages = { ...airbusPylons, ...pylon737, ...pylon757Tu };
export function pylonFor(style: NacelleStyle): PylonSpec | undefined {
  if (style === "separateFlow" || style === "longDuct" || style === "cfm56-7b") return undefined;
  return packages[style];
}
