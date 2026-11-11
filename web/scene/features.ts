// Окна и проёмы в координатах выбранного самолёта. Чертежи A321 имеют собственные
// наружные контуры; опубликованная координата прохода хранится отдельно в исходном JSON.
import A321 from "../../data/ac/a321-doors.json" with { type: "json" };
import { type AircraftDefinition } from "../../src/definition.ts";
import { S, type Feature } from "./shapeSet.ts";
import { fuselagePlugs, modelX } from "./shapes.ts";

/** Текущие A321ceo/neo — обычная схема; ACF/XLR требуют отдельных определений самолёта. */
const ownA321 = (def: AircraftDefinition) => def.id === "a321ceo" || def.id === "a321neo";

/** Перенос координат с собственного чертежа варианта при дополнительном удлинении рычагом. */
function ownX(def: AircraftDefinition, x: number): number {
  const referenceLengthM = def.fuselage.shapeStretch?.referenceLengthM ?? def.fuselage.lengthM;
  const extra = (def.fuselage.lengthM - referenceLengthM) / 2;
  const forwardM = def.fuselage.shapeStretch?.forwardM ?? 0;
  const offset = (station: number) => x < station ? 0 : Math.max(extra, station - x);
  return x + offset(S().plugFwd) + offset(S().plugAft + forwardM);
}

const featuresOnSide = (side: 1 | -1) => S().featuresBySide?.[side === -1 ? "left" : "right"] ?? S().features;

export function cabinOpenings(def: AircraftDefinition, side: 1 | -1 = -1): Feature[] {
  if (ownA321(def)) return A321.variants.standard.cabinOpenings.map((q) => {
    const b = q.exteriorBBox;
    const x0 = ownX(def, b.x0);
    return { kind: q.kind, x0, x1: x0 + b.x1 - b.x0, y0: b.y0, y1: b.y1 };
  });
  return featuresOnSide(side).filter((q) => q.kind === "door" || q.kind === "exit").map((q) => {
    const x0 = modelX(def.fuselage.lengthM, q.x0);
    return { ...q, x0, x1: x0 + q.x1 - q.x0 };
  });
}

/** Только наружный контур грузовых люков, без подмены его размерами свободного проёма. */
export function cargoOpenings(def: AircraftDefinition): Feature[] {
  if (ownA321(def)) return A321.variants.standard.cargoOpenings.map((q) => {
    const b = q.exteriorBBox;
    const x0 = ownX(def, b.x0);
    return { kind: "cargo", x0, x1: x0 + b.x1 - b.x0, y0: b.y0, y1: b.y1 };
  });
  return S().cargo.map(([x, width, y0, y1]) => {
    const x0 = modelX(def.fuselage.lengthM, x);
    return { kind: "cargo", x0, x1: x0 + width, y0, y1 };
  });
}

/** Окна следуют за вставками; в местах собственных дверей и выходов окон нет. */
export function cabinWindows(def: AircraftDefinition, side: 1 | -1 = -1): Feature[] {
  const L = def.fuselage.lengthM;
  const drawn = featuresOnSide(side).filter((q) => q.kind === "window").sort((a, b) => a.x0 - b.x0);
  const steps = drawn.slice(1).map((w, i) => w.x0 - drawn[i].x0).filter((v) => v > 0).sort((a, b) => a - b);
  const pitch = steps.length ? steps[Math.floor(steps.length / 2)] : 0.5334;
  const openings = cabinOpenings(def, side);
  const windows: Feature[] = [];
  for (const [i, w] of drawn.entries()) {
    windows.push(w);
    const next = drawn[i + 1];
    if (!next || next.x0 - w.x0 < 1.6 * pitch) continue;
    // На A320 часть окон скрыта крылом. У A321 старые выходы A320 также заменены окнами.
    for (let x = w.x0 + pitch; x < next.x0 - 0.6 * pitch; x += pitch)
      windows.push({ ...w, x0: x, x1: x + w.x1 - w.x0 });
  }
  const plugs = fuselagePlugs(L);
  const extra: Feature[] = [];
  for (const [station, delta] of [[plugs.forward, plugs.forwardM], [plugs.aft, plugs.aftM]]) {
    if (delta <= 0) continue;
    const before = windows.filter((w) => w.x0 < station).at(-1);
    if (!before) continue;
    const start = modelX(L, before.x0 - 1e-6);
    const plugStart = modelX(L, station - 1e-6);
    for (let x = start + pitch; x < plugStart + delta - 0.05; x += pitch)
      extra.push({ ...before, x0: x, x1: x + before.x1 - before.x0 });
  }
  const candidates = [
    ...windows.map((q) => { const x0 = modelX(L, q.x0); return { ...q, x0, x1: x0 + q.x1 - q.x0 }; }),
    ...extra,
  ].sort((a, b) => a.x0 - b.x0);
  const placed: Feature[] = [];
  for (const w of candidates) {
    if (openings.some((d) => w.x1 > d.x0 - 0.08 && w.x0 < d.x1 + 0.08)) continue;
    if (!placed.length || w.x0 - placed.at(-1)!.x0 >= 0.8 * pitch) placed.push(w);
  }
  return placed;
}
