// Компактный паспорт базового типа: цифры определения, а не результаты изменённых рычагов.
import { type AircraftDefinition } from "../src/definition.ts";

export interface PassportRow { label: string; value: string }
const fmt = (n: number, digits = 0) => n.toLocaleString("ru-RU", { maximumFractionDigits: digits, minimumFractionDigits: digits });

/** Предел мест показываем только там, где он задан в доступных источниках; иначе —. */
export function passportRows(def: AircraftDefinition, oewKg: number, mach: number): PassportRow[] {
  const typical = def.systems.seats;
  const maximum = def.shapeSet === "tu214" ? 210 : def.id.startsWith("a320") ? 194 : null;
  const kgPerL = def.shapeSet === "tu214" ? 0.78 : 0.785;
  return [
    { label: "Мест · типовая компоновка", value: fmt(typical) },
    { label: "Мест · максимум", value: maximum === null ? "не подтверждено" : fmt(maximum) },
    { label: "MTOW", value: `${fmt(def.weights.mtowKg / 1000, 2)} т` },
    { label: "MLW", value: `${fmt(def.weights.mlwKg / 1000, 2)} т` },
    { label: "MZFW", value: `${fmt(def.weights.mzfwKg / 1000, 2)} т` },
    { label: "OEW · базовая модель", value: `${fmt(oewKg / 1000, 2)} т` },
    { label: `Топливо · плотность ${fmt(kgPerL, 3)} кг/л`, value: `${fmt(def.systems.fuelVolumeL * kgPerL / 1000, 2)} т` },
    { label: "Крейсерский Мах · модель", value: fmt(mach, 2) },
    { label: "Двигатели", value: `${def.engine.count} × ${def.engine.name}` },
  ];
}
