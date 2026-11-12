/**
 * Shared, versioned contract used by Aircraft Designer and FlightCost.
 * The JSON file is public at /aircraft-configurations.v1.json, so FlightCost
 * can pin/import the same presets instead of maintaining a second seat table.
 * Presets are modelling choices, not certified airline LOPA documents.
 */
import DATA from "../../web/public/aircraft-configurations.v1.json" with { type: "json" };
import type { AircraftDefinition } from "../definition.ts";

export interface CabinZone {
  class: "business" | "economy" | "premium";
  rows: number;
  seatsPerRow: number;
  lastRowSeats?: number;
  pitchM: number;
}
export interface CabinLayout {
  id: string;
  label: string;
  zones: CabinZone[];
}
export interface AircraftPreset {
  aircraftId: string;
  icao: string;
  engine: string;
  weightProfile: string;
  defaultLayoutId: string;
  layouts: CabinLayout[];
}
export const FC_SCHEMA = "aircraft-designer/flightcost-configurations";
export const FC_PROTOCOL = "aircraft-designer/flightcost-design";
export const FC_VERSION = 1;
export const FC_ORIGIN = "https://flightcost.app";
export const PRESETS: readonly AircraftPreset[] = DATA.aircraft as AircraftPreset[];

export function seatsInZone(z: CabinZone): number {
  return (z.rows - 1) * z.seatsPerRow + (z.lastRowSeats ?? z.seatsPerRow);
}
export function seatsInLayout(layout: CabinLayout): number {
  return layout.zones.reduce((total, z) => total + seatsInZone(z), 0);
}
export function presetFor(aircraftId: string): AircraftPreset | undefined {
  return PRESETS.find((entry) => entry.aircraftId === aircraftId);
}
export function layoutFor(aircraftId: string, layoutId?: string): CabinLayout | undefined {
  const preset = presetFor(aircraftId);
  return preset?.layouts.find((l) => l.id === (layoutId ?? preset.defaultLayoutId));
}
/** Reject unknown or engine-mismatched links; never silently map PW1100G to LEAP. */
export function resolveFlightCostAircraft(params: URLSearchParams): {
  preset: AircraftPreset;
  layout: CabinLayout;
} | { error: string } {
  const icao = (params.get("ac") ?? "").trim().toUpperCase();
  const engine = (params.get("engine") ?? "").trim().toUpperCase();
  const chosen = (params.get("aircraft") ?? "").trim();
  const profile = (params.get("profile") ?? "").trim().toLowerCase();
  const candidates = PRESETS.filter((p) => (!icao || p.icao === icao) && (!chosen || p.aircraftId === chosen) && (!profile || p.weightProfile === profile));
  if (!candidates.length) return { error: `Тип ${icao || chosen || "(не выбран)"} не поддерживается конструктором.` };
  const preset = candidates.find((p) => !engine || p.engine.toUpperCase() === engine);
  if (!preset) return { error: `${icao}: двигатель ${engine} ещё не реализован в Aircraft Designer. Нельзя подменить его другой моделью.` };
  const layout = layoutFor(preset.aircraftId, params.get("layout") || undefined);
  if (!layout) return { error: `${icao}: неизвестная компоновка ${params.get("layout")}.` };
  return { preset, layout };
}

/** Keep cabin layout and calculation seats in the same AircraftDefinition. */
export function withCabinLayout(def: AircraftDefinition, layout: CabinLayout): AircraftDefinition {
  const seats = seatsInLayout(layout);
  const totalRows = layout.zones.reduce((sum, z) => sum + z.rows, 0);
  const totalLength = layout.zones.reduce((sum, z) => sum + z.rows * z.pitchM, 0);
  if (seats <= 0 || totalRows <= 0) throw new RangeError("Пустая компоновка");
  return {
    ...def,
    cabinLayout: structuredClone(layout),
    systems: { ...def.systems, seats, seatPitchM: totalLength / totalRows },
  };
}

export interface CabinRow { seats: number; seatsPerRow: number; pitchM: number; class: CabinZone["class"] }
/** The renderer handles fractional last rows; fuselage stretch adds/removes economy seats. */
export function cabinRowsFor(def: AircraftDefinition): CabinRow[] {
  const zones = def.cabinLayout?.zones ?? [{
    class: "economy" as const,
    rows: Math.ceil(def.systems.seats / def.systems.seatsAbreast),
    seatsPerRow: def.systems.seatsAbreast,
    lastRowSeats: def.systems.seats % def.systems.seatsAbreast || def.systems.seatsAbreast,
    pitchM: def.systems.seatPitchM,
  }];
  const rows: CabinRow[] = [];
  for (const z of zones) for (let i = 0; i < z.rows; i++) rows.push({
    seats: i === z.rows - 1 ? z.lastRowSeats ?? z.seatsPerRow : z.seatsPerRow,
    seatsPerRow: z.seatsPerRow,
    pitchM: z.pitchM,
    class: z.class,
  });
  let delta = def.systems.seats - rows.reduce((s, r) => s + r.seats, 0);
  if (delta > 0) {
    const template = rows.at(-1)!;
    while (delta > 0) {
      const n = Math.min(delta, def.systems.seatsAbreast);
      rows.push({ seats: n, seatsPerRow: def.systems.seatsAbreast, pitchM: template.pitchM, class: "economy" });
      delta -= n;
    }
  } else if (delta < 0) {
    while (delta < 0 && rows.length) {
      const row = rows[rows.length - 1];
      const take = Math.min(row.seats, -delta);
      row.seats -= take;
      delta += take;
      if (!row.seats) rows.pop();
    }
  }
  return rows;
}

export function validatePresetCatalog(): string[] {
  const errors: string[] = [];
  const keys = new Set<string>();
  for (const p of PRESETS) {
    const pair = `${p.icao}|${p.engine}|${p.weightProfile}`;
    if (keys.has(pair)) errors.push(`Повтор ICAO/engine/profile: ${pair}`);
    keys.add(pair);
    if (!p.layouts.some((l) => l.id === p.defaultLayoutId)) errors.push(`Нет defaultLayout: ${p.aircraftId}`);
    for (const l of p.layouts) {
      const rowCount = l.zones.reduce((s, z) => s + z.rows, 0);
      if (rowCount === 0 || !l.zones.every((z) => Number.isInteger(z.rows) && z.rows > 0 &&
        Number.isInteger(z.seatsPerRow) && z.seatsPerRow >= 2 && z.seatsPerRow <= 10 &&
        (z.lastRowSeats === undefined || Number.isInteger(z.lastRowSeats) && z.lastRowSeats > 0 && z.lastRowSeats <= z.seatsPerRow) &&
        z.pitchM >= 0.65 && z.pitchM <= 1.5)) errors.push(`Неверные ряды: ${p.aircraftId}/${l.id}`);
      if (seatsInLayout(l) < 2) errors.push(`Пустые места: ${p.aircraftId}/${l.id}`);
    }
  }
  return errors;
}

export interface FlightCostDesign {
  protocol: typeof FC_PROTOCOL;
  version: number;
  aircraft: { icao: string; aircraftId: string; engine: string; weightProfile: string; layoutId: string; cabin: CabinZone[]; seats: number };
  weights: { oew_kg: number; mtow_kg: number; mzfw_kg: number; mlw_kg: number; fuel_capacity_kg: number };
  geometry: { length_m: number; span_m: number };
  model: { mode: "fixed" | "redesign"; controls: Record<string, number | boolean>; provisional: true };
}

/** No guess for fuel burn here: FlightCost must select and label its own method. */
export function flightCostDesign(def: AircraftDefinition, oewKg: number, controls: Record<string, number | boolean>, mode: "fixed" | "redesign", aircraftId: string, layoutId: string, fuelDensityKgL: number): FlightCostDesign {
  const preset = presetFor(aircraftId);
  const layout = layoutFor(aircraftId, layoutId);
  if (!preset || !layout) throw new TypeError("Неизвестная комбинация ICAO/двигатель/салон");
  // Encode the actual, lever-adjusted row plan. The selected preset is provenance,
  // not a claim that an altered fuselage still carries the original seat map.
  const cabin: CabinZone[] = [];
  for (const row of cabinRowsFor(def)) {
    const prev = cabin.at(-1);
    if (prev && prev.class === row.class && prev.seatsPerRow === row.seatsPerRow && prev.pitchM === row.pitchM &&
        !prev.lastRowSeats && row.seats === row.seatsPerRow) {
      prev.rows++;
    } else {
      cabin.push({ class: row.class, rows: 1, seatsPerRow: row.seatsPerRow, pitchM: row.pitchM,
        ...(row.seats === row.seatsPerRow ? {} : { lastRowSeats: row.seats }) });
    }
  }
  return {
    protocol: FC_PROTOCOL,
    version: FC_VERSION,
    aircraft: { icao: preset.icao, aircraftId, engine: preset.engine, weightProfile: preset.weightProfile, layoutId, cabin, seats: def.systems.seats },
    weights: { oew_kg: oewKg, mtow_kg: def.weights.mtowKg, mzfw_kg: def.weights.mzfwKg, mlw_kg: def.weights.mlwKg, fuel_capacity_kg: def.systems.fuelVolumeL * fuelDensityKgL },
    geometry: { length_m: def.fuselage.lengthM, span_m: def.wing.tip === "sharklet" ? def.wing.sharkletSpanM : def.wing.spanM },
    model: { mode, controls: { ...controls }, provisional: true },
  };
}
