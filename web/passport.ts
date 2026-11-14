import snapshot from "../data/flightcost-passports.json" with { type: "json" };

const numericRows = [
  ["seats_typical", "Мест · типовая компоновка", 0, ""],
  ["seats_max", "Мест · максимум", 0, ""],
  ["mtow_t", "MTOW", 2, " т"],
  ["mlw_t", "MLW", 2, " т"],
  ["mzfw_t", "MZFW", 2, " т"],
  ["oew_t", "OEW", 2, " т"],
  ["fuel_capacity_t", "Запас топлива", 2, " т"],
  ["cruise_mach", "Крейсерский Мах", 2, ""],
] as const;
type NumericField = typeof numericRows[number][0] | "engine_count";
export type Passport = Partial<Record<NumericField, number>> & { engine?: string };
export const savedPassports: Readonly<Record<string, Passport | undefined>> = snapshot.types;
export const passportSnapshotDate = snapshot.retrieved.split("-").reverse().join(".");

/** The public FlightCost endpoint returns facts as rows with separate numeric and text values. */
export async function fetchPassport(icao: string): Promise<Passport> {
  const response = await fetch(`/api/aircraft/type?icao=${encodeURIComponent(icao)}`, {
    credentials: "omit", signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`FlightCost HTTP ${response.status}`);
  const data = await response.json();
  if (data.icao !== icao || !Array.isArray(data.fields)) throw new Error("Некорректный паспорт FlightCost");
  const fields = new Map<string, unknown>();
  for (const row of data.fields) {
    if (row && typeof row.field === "string") fields.set(row.field, row.field === "engine" ? row.text : row.value);
  }
  const passport: Passport = {};
  const keys: NumericField[] = [...numericRows.map(([key]) => key), "engine_count"];
  for (const key of keys) {
    const value = fields.get(key);
    if (typeof value === "number" && Number.isFinite(value)) passport[key] = value;
  }
  const engine = fields.get("engine");
  if (typeof engine === "string" && engine.trim()) passport.engine = engine.trim();
  if (!Object.keys(passport).length) throw new Error("Паспорт FlightCost пуст");
  return passport;
}

export function passportRows(passport: Passport): { label: string; value: string }[] {
  const rows = numericRows.map(([key, label, digits, unit]) => {
    const n = passport[key];
    return { label: String(label), value: n === undefined ? "—" :
      n.toLocaleString("ru-RU", { minimumFractionDigits: digits, maximumFractionDigits: digits }) + unit };
  });
  const { engine, engine_count: count } = passport;
  const engineLabel = engine && count !== undefined && !/^\d+\s*[×xх]/i.test(engine) ? `${count} × ${engine}` : engine;
  rows.push({ label: "Двигатели · базовый тип", value: engineLabel ?? "—" });
  return rows;
}
