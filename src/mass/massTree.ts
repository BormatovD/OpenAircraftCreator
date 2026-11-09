// Дерево масс по агрегатам с привязкой к главам ATA. Листья считаются оценщиками,
// группы — суммой детей. Калибровочные множители задаются по узлам (см. calibrateMasses).
// Чтобы добавить «систему №», достаточно новой записи в NODES — рычаги на неё сработают сразу.

import { type AircraftDefinition } from "../definition.ts";
import { type Lever } from "../levers.ts";
import * as R from "./raymer.ts";

export interface NodeSpec {
  id: string;
  label: string;
  ata?: string;
  parent?: string;
  /** Оценка массы для листа; у групп отсутствует. */
  estimate?: (def: AircraftDefinition) => number;
  source: string;
}

const RAYMER = "Raymer, гл. 15, транспортные самолёты";

/** Масса шарклета (пара): оценка по разнице OEW в графиках AC «заборчики» vs шарклеты (≈200 кг ± 300). */
const SHARKLETS_PAIR_KG = 200;

export const NODES: NodeSpec[] = [
  { id: "structure", label: "Конструкция", source: "группа" },
  { id: "wing", label: "Крыло", ata: "57", parent: "structure", source: "группа" },
  {
    id: "wing.box",
    label: "Кессон и панели крыла",
    ata: "57-10…30",
    parent: "wing",
    estimate: (d) => R.wingKg(d) * (1 - d.wing.movablesShareOfWing),
    source: `${RAYMER}; без подвижных частей`,
  },
  {
    id: "wing.highLift",
    label: "Механизация и элероны",
    ata: "57-40…70",
    parent: "wing",
    estimate: (d) => R.wingKg(d) * d.wing.movablesShareOfWing,
    source: `${RAYMER}; доля 18% — по Torenbeek (закрылки) и допущению (предкрылки, элероны, интерцепторы)`,
  },
  {
    id: "wingtips",
    label: "Законцовки (шарклеты)",
    ata: "57",
    parent: "structure",
    estimate: (d) => (d.wing.tip === "sharklet" ? SHARKLETS_PAIR_KG : 0),
    source: "оценка по графикам AC 3-2-1, низкая точность",
  },
  { id: "fuselage", label: "Фюзеляж", ata: "53", parent: "structure", estimate: R.fuselageKg, source: RAYMER },
  { id: "htail", label: "Горизонтальное оперение", ata: "55", parent: "structure", estimate: R.htailKg, source: RAYMER },
  { id: "vtail", label: "Вертикальное оперение", ata: "55", parent: "structure", estimate: R.vtailKg, source: RAYMER },
  { id: "gear.main", label: "Основные стойки шасси", ata: "32", parent: "structure", estimate: R.mainGearKg, source: RAYMER },
  { id: "gear.nose", label: "Передняя стойка шасси", ata: "32", parent: "structure", estimate: R.noseGearKg, source: RAYMER },
  { id: "nacelles", label: "Гондолы и пилоны", ata: "54", parent: "structure", estimate: R.nacellesKg, source: RAYMER },

  { id: "propulsion", label: "Силовая установка", source: "группа" },
  {
    id: "engines",
    label: "Двигатели (сухая масса)",
    ata: "72",
    parent: "propulsion",
    estimate: (d) => d.engine.dryMassKg * d.engine.count,
    source: "данные двигателя",
  },
  { id: "engine.controls", label: "Управление двигателем и запуск", ata: "76/80", parent: "propulsion", estimate: R.engineControlsAndStarterKg, source: RAYMER },
  { id: "fuel", label: "Топливная система", ata: "28", parent: "propulsion", estimate: R.fuelSystemKg, source: RAYMER },

  { id: "systems", label: "Бортовые системы", source: "группа" },
  { id: "flightControls", label: "Система управления", ata: "27", parent: "systems", estimate: R.flightControlsKg, source: RAYMER },
  { id: "hydraulics", label: "Гидросистема", ata: "29", parent: "systems", estimate: R.hydraulicsKg, source: RAYMER },
  { id: "electrical", label: "Электросистема", ata: "24", parent: "systems", source: "группа" },
  {
    id: "electrical.generation",
    label: "Генерация и преобразование",
    ata: "24",
    parent: "electrical",
    estimate: (d) => R.electricalKg(d),
    source: `${RAYMER}; доля — допущение`,
  },
  {
    id: "electrical.harness",
    label: "Электрожгуты и распределение",
    ata: "24/92",
    parent: "electrical",
    estimate: () => 0,
    source: "сквозной узел: доли проводки из масс систем (ATA 24 — 60%, авионика 45%, приборы 40%, СУ 15%, салон 8% и др.) — допущения; итог ≈1,85 т при оценке ≈2 т для узкофюзеляжника",
  },
  { id: "avionics", label: "Авионика", ata: "34", parent: "systems", estimate: R.avionicsKg, source: RAYMER },
  { id: "instruments", label: "Приборы", ata: "31", parent: "systems", estimate: R.instrumentsKg, source: RAYMER },
  { id: "airConditioning", label: "Кондиционирование и наддув", ata: "21", parent: "systems", estimate: R.airConditioningKg, source: RAYMER },
  { id: "antiIce", label: "Противообледенение", ata: "30", parent: "systems", estimate: R.antiIceKg, source: RAYMER },
  { id: "apu", label: "ВСУ", ata: "49", parent: "systems", estimate: R.apuKg, source: RAYMER },
  { id: "handling", label: "Такелажное оборудование", parent: "systems", estimate: R.handlingGearKg, source: RAYMER },

  { id: "furnishings", label: "Интерьер и оборудование салона", ata: "25", estimate: R.furnishingsKg, source: RAYMER },
  {
    id: "operatorItems",
    label: "Оборудование эксплуатанта",
    estimate: (d) => d.weights.operatorItemsKg,
    source: "допущение",
  },
];

export interface MassNode {
  id: string;
  label: string;
  ata?: string;
  source: string;
  /** Оценка по формуле до калибровки и рычагов. */
  rawKg: number;
  /** Итоговая масса: после калибровки и рычагов. */
  kg: number;
  children: MassNode[];
}

export interface MassBreakdown {
  roots: MassNode[];
  oewKg: number;
  rawOewKg: number;
  /** Калибровочный множитель для каждого узла (1 — если узел не калибруется). */
  factors: Map<string, number>;
  byId: Map<string, MassNode>;
}

export type Calibration = Map<string, number>;

function ancestors(id: string): string[] {
  const out: string[] = [];
  let spec = NODES.find((n) => n.id === id);
  while (spec?.parent) {
    out.push(spec.parent);
    const parentId: string = spec.parent;
    spec = NODES.find((n) => n.id === parentId);
  }
  return out;
}

function modifiersFor(id: string, levers: Lever[]): { factor: number; deltaKg: number } {
  let factor = 1;
  let deltaKg = 0;
  const lineage = [id, ...ancestors(id)];
  for (const l of levers)
    for (const e of l.effects) {
      // Рычаг на группу действует на всех её потомков: "electrical" затрагивает "electrical.harness".
      if (e.kind === "massFactor" && lineage.includes(e.node)) factor *= e.factor;
      if (e.kind === "massDelta" && e.node === id) deltaKg += e.kg;
    }
  return { factor, deltaKg };
}

/** Оценки по формулам до калибровки и рычагов. */
export function rawEstimates(def: AircraftDefinition): Map<string, number> {
  const out = new Map<string, number>();
  for (const spec of NODES) if (spec.estimate) out.set(spec.id, spec.estimate(def));
  return out;
}

export function computeMasses(def: AircraftDefinition, calibration: Calibration, levers: Lever[] = []): MassBreakdown {
  const byId = new Map<string, MassNode>();
  const raw = rawEstimates(def);
  for (const spec of NODES) {
    byId.set(spec.id, { id: spec.id, label: spec.label, ata: spec.ata, source: spec.source, rawKg: 0, kg: 0, children: [] });
  }
  for (const spec of NODES) {
    const node = byId.get(spec.id)!;
    if (spec.parent) byId.get(spec.parent)!.children.push(node);
    if (spec.estimate) {
      const r = raw.get(spec.id)!;
      const { factor, deltaKg } = modifiersFor(spec.id, levers);
      node.rawKg = r;
      node.kg = r * (calibration.get(spec.id) ?? 1) * factor + deltaKg;
    }
  }
  // Перенос проводки: из каждой системы в узел БКС уходит её доля (до рычагов БКС), затем к БКС
  // применяются её собственные рычаги. Сумма масс без рычагов не меняется — калибровка OEW сохраняется.
  const harness = byId.get("electrical.harness");
  if (harness) {
    const { factor, deltaKg } = modifiersFor("electrical.harness", levers);
    const shares: Record<string, number> = { "electrical.generation": def.systems.harnessShareOfElectrical, ...def.systems.ewisShares };
    let moved = 0;
    let movedRaw = 0;
    for (const [id, share] of Object.entries(shares)) {
      const src = byId.get(id);
      if (!src || !raw.has(id)) continue;
      // Переносим базовую (откалиброванную, без рычагов) часть; у источника она снимается с его множителем рычагов.
      const base = raw.get(id)! * (calibration.get(id) ?? 1) * share;
      src.kg -= base * modifiersFor(id, levers).factor;
      src.rawKg -= raw.get(id)! * share;
      moved += base;
      movedRaw += raw.get(id)! * share;
    }
    harness.kg = moved * factor + deltaKg;
    harness.rawKg = movedRaw;
  }
  const sum = (n: MassNode): void => {
    if (n.children.length === 0) return;
    n.children.forEach(sum);
    n.rawKg = n.children.reduce((s, c) => s + c.rawKg, 0);
    n.kg = n.children.reduce((s, c) => s + c.kg, 0);
  };
  const roots = NODES.filter((n) => !n.parent).map((n) => byId.get(n.id)!);
  roots.forEach(sum);
  return {
    roots,
    byId,
    factors: calibration,
    oewKg: roots.reduce((s, r) => s + r.kg, 0),
    rawOewKg: roots.reduce((s, r) => s + r.rawKg, 0),
  };
}

/**
 * Калибровка на OEW по аналогу: целевая масса «без двигателей и фиксированных узлов» делится между
 * группами в долях аналога (737-200), внутри группы — пропорционально Raymer. Для каждого узла
 * множитель = базовая масса / оценка Raymer. Дальше любые изменения идут через формулы Raymer,
 * т. е. рычаги меняют массу в той же пропорции, в какой её меняет формула.
 */
export function calibrateMasses(
  def: AircraftDefinition,
  targetOewKg: number,
  shares: Record<string, number>,
  groupMap: Record<string, string[]>,
): Calibration {
  const raw = rawEstimates(def);
  const mapped = new Set(Object.values(groupMap).flat());
  let fixed = 0;
  for (const spec of NODES) if (spec.estimate && !mapped.has(spec.id)) fixed += raw.get(spec.id)!;
  const pool = targetOewKg - fixed;
  const shareSum = Object.values(shares).reduce((s, x) => s + x, 0);
  const cal: Calibration = new Map();
  for (const [group, ids] of Object.entries(groupMap)) {
    const groupKg = (pool * shares[group]) / shareSum;
    const rawSum = ids.reduce((s, id) => s + raw.get(id)!, 0);
    for (const id of ids) cal.set(id, groupKg / rawSum);
  }
  return cal;
}
