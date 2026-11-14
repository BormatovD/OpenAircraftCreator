import type { FleetEnginePackage } from "./fleetEngine.ts";
import { cfm3b2, cfm5b } from "./fleetCfm.ts";
import { leap1a, leap1b } from "./fleetLeap.ts";
import { ps90a } from "./fleetPs90.ts";

export const fleetPackages = { cfm3b2, cfm5b, leap1a, leap1b, ps90a } satisfies Record<string, FleetEnginePackage>;
export type FleetStyle = keyof typeof fleetPackages;

export function isFleetStyle(style: string): style is FleetStyle {
  return Object.hasOwn(fleetPackages, style);
}
