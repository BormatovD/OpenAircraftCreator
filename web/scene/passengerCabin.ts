// Visual cabin only. Layout/weight calculations remain in the shared core.
// Coordinates use the active ShapeSet, just like fuselageGeometry and doors.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { AircraftDefinition } from "../../src/definition.ts";
import { cabinRowsFor, type CabinRow } from "../../src/integration/flightcost.ts";
import { cabinOpenings } from "./features.ts";
import { fuselageHalfWidthAt, fuselageSection } from "./shapes.ts";
import { compactDetails, type DetailTone } from "./systemDetails.ts";

export interface PassengerCabinModule {
  role: "lavatory" | "galley" | "wardrobe";
  x0: number; x1: number; z0: number; z1: number;
  heightM?: number;
}
export interface PassengerCabinSpec {
  id: string;
  floorY: number;
  firstRowX: number;
  /** Limit for the rearmost seat vertex, not the last row reference point. */
  lastRowEndX: number;
  floorStartX: number; floorEndX: number;
  aisleWidthM: number;
  seatOuterZ: number;
  overheadBin?: { innerZ: number; outerZ: number; bottomY: number; topY: number };
  modules: PassengerCabinModule[];
  doorClearanceM?: number;
  minimumPitchM?: number;
}
export interface CabinDoorZone { x0: number; x1: number }
export interface PlacedCabinRow extends CabinRow {
  x0: number; x1: number; actualPitchM: number;
  leftSeats: number; rightSeats: number;
}
export interface PassengerCabinLayout {
  id: string;
  seatCount: number;
  rows: PlacedCabinRow[];
  doorZones: CabinDoorZone[];
  modules: PassengerCabinModule[];
  pitchScale: number;
  capacityWarning?: string;
}
export interface PassengerCabinPackage {
  furnishings: THREE.BufferGeometry[];
  /** Actual mass-tree id is operatorItems (not operationalItems). */
  operatorItems: THREE.BufferGeometry[];
  layout: PassengerCabinLayout;
}

const EPS = 1e-7;
const SEAT_DEPTH = .63;
const overlaps = (a: CabinDoorZone, b: CabinDoorZone) => a.x1 > b.x0 + EPS && a.x0 < b.x1 - EPS;

function unionIntervals(zones: CabinDoorZone[]): CabinDoorZone[] {
  const out: CabinDoorZone[] = [];
  for (const zone of zones.sort((a, b) => a.x0 - b.x0)) {
    const previous = out.at(-1);
    if (previous && zone.x0 <= previous.x1) previous.x1 = Math.max(previous.x1, zone.x1);
    else out.push({ ...zone });
  }
  return out;
}

/** One reusable packing contract for economy, business, fractional rows and plugs.
 * Exit passages always take priority over a schematic row pitch. A reduced visual
 * pitch is explicit metadata and never changes def.systems or exported LOPA data. */
export function passengerCabinLayout(def: AircraftDefinition, spec: PassengerCabinSpec): PassengerCabinLayout {
  const clearance = spec.doorClearanceM ?? .10;
  const doorZones = unionIntervals(([-1, 1] as const).flatMap(side => cabinOpenings(def, side))
    .map(d => ({ x0: d.x0 - clearance, x1: d.x1 + clearance })));
  const blocked = unionIntervals([...doorZones, ...spec.modules.map(m => ({ x0: m.x0 - .06, x1: m.x1 + .06 }))]);
  const sourceRows = cabinRowsFor(def);
  const place = (scale: number): PlacedCabinRow[] => {
    let x = spec.firstRowX;
    return sourceRows.map(row => {
      for (const zone of blocked) if (overlaps({ x0: x, x1: x + SEAT_DEPTH }, zone)) x = zone.x1;
      const actualPitchM = row.pitchM * scale;
      const result = { ...row, x0: x, x1: x + SEAT_DEPTH, actualPitchM,
        leftSeats: Math.min(Math.ceil(row.seatsPerRow / 2), Math.ceil(row.seats / 2)),
        rightSeats: row.seats - Math.min(Math.ceil(row.seatsPerRow / 2), Math.ceil(row.seats / 2)) };
      x += actualPitchM;
      return result;
    });
  };
  let scale = 1, rows = place(scale);
  const fits = (r: PlacedCabinRow[]) => !r.length || r.at(-1)!.x1 <= spec.lastRowEndX + EPS;
  if (!fits(rows)) {
    const minimumScale = Math.min(1, (spec.minimumPitchM ?? .68) / Math.min(...sourceRows.map(r => r.pitchM)));
    let low = minimumScale, high = 1;
    if (!fits(place(low))) throw new RangeError(`Cabin ${spec.id}: seats and protected exits cannot fit at minimum visual pitch`);
    for (let i = 0; i < 36; i++) {
      const middle = (low + high) / 2;
      if (fits(place(middle))) low = middle; else high = middle;
    }
    scale = low;
    rows = place(scale);
  }
  return { id: spec.id, seatCount: rows.reduce((n, r) => n + r.seats, 0), rows, doorZones,
    modules: spec.modules.map(m => ({ ...m })), pitchScale: scale,
    ...(scale < .99999 ? { capacityWarning: `Эскизный шаг кресел уменьшен до ${Math.round(Math.min(...rows.map(r => r.actualPitchM)) * 100)} см, чтобы сохранить ${def.systems.seats} мест и свободные выходы. Расчётная компоновка не изменена.` } : {}) };
}

export function buildPassengerCabin(def: AircraftDefinition, spec: PassengerCabinSpec): PassengerCabinPackage {
  const layout = passengerCabinLayout(def, spec);
  const f = def.fuselage, floor = spec.floorY;
  const roleGroups = new Map<string, THREE.BufferGeometry[]>();
  const skinCache = new Map<string, { y: number; width: number }>();
  const boxTemplates = new Map<string, THREE.BufferGeometry>();
  const shapeBox = (dx: number, dy: number, dz: number, rounded: boolean) => {
    const key = `${dx.toFixed(6)}:${dy.toFixed(6)}:${dz.toFixed(6)}:${rounded}`;
    let template = boxTemplates.get(key);
    if (!template) {
      template = rounded ? new RoundedBoxGeometry(dx, dy, dz, 1, Math.min(.025, dy / 4, dz / 4, dx / 4))
        : new THREE.BoxGeometry(dx, dy, dz);
      boxTemplates.set(key, template);
    }
    return template.clone();
  };
  const push = (g: THREE.BufferGeometry, role: string, tone: DetailTone, side: -1 | 0 | 1 = 0) => {
    // Clip all vertices, rather than testing just seat cushions. This includes the
    // reclined seat backs, high cabinet corners, and tapered nose/tail floors.
    const positions = g.getAttribute("position");
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), rawY = positions.getY(i);
      const key = `${x}:${rawY}`;
      let skin = skinCache.get(key);
      if (!skin) {
        const section = fuselageSection(f, x);
        const y = THREE.MathUtils.clamp(rawY, section.cy - section.hh + .045, section.cy + section.hh - .045);
        skin = { y, width: Math.max(0, fuselageHalfWidthAt(f, x, y) - .045) };
        skinCache.set(key, skin);
      }
      positions.setXYZ(i, x, skin.y, THREE.MathUtils.clamp(positions.getZ(i), -skin.width, skin.width));
    }
    positions.needsUpdate = true;
    g.computeVertexNormals();
    g.userData = { ...g.userData, cabinRole: role, tone, side };
    if (!roleGroups.has(role)) roleGroups.set(role, []);
    roleGroups.get(role)!.push(g);
  };
  const box = (role: string, tone: DetailTone, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, side: -1 | 0 | 1 = 0, rounded = false) => {
    if (x1 <= x0 || y1 <= y0 || z1 <= z0) return;
    const g = shapeBox(x1 - x0, y1 - y0, z1 - z0, rounded);
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    push(g, role, tone, side);
  };
  for (const row of layout.rows) for (const side of [-1, 1] as const) {
    const count = side === -1 ? row.leftSeats : row.rightSeats;
    if (!count) continue;
    const perBank = Math.ceil(row.seatsPerRow / 2);
    const inner = spec.aisleWidthM / 2 + .025;
    const outer = Math.min(spec.seatOuterZ, ...[row.x0, row.x1].map(x => fuselageHalfWidthAt(f, x, floor + .65) - .08));
    const width = (outer - inner) / perBank;
    const zRange = (a: number, b: number): [number, number] => side === 1 ? [a, b] : [-b, -a];
    const seatBox = (tone: DetailTone, a: number, b: number, y0: number, y1: number, za: number, zb: number, round = false) => {
      const [z0, z1] = zRange(za, zb);
      box("seats", tone, row.x0 + a, row.x0 + b, floor + y0, floor + y1, z0, z1, side, round);
    };
    for (let k = 0; k < count; k++) {
      const z0 = inner + k * width + .026, z1 = inner + (k + 1) * width - .026;
      seatBox("detailAir", .055, .48, .36, .465, z0, z1, true);
      // Reclined back and headrest; rear face carries the folded tray-table.
      const back = shapeBox(.095, .74, z1 - z0, true);
      back.translate(0, .37, 0); back.rotateZ(-.14);
      back.translate(row.x0 + .465, floor + .43, side * (z0 + z1) / 2);
      push(back, "seats", "detailAir", side);
      seatBox("detailPanel", .54, .60, .91, 1.18, z0 + .025, z1 - .025);
      seatBox("detailPanel", .56, .585, .56, .85, z0 + .04, z1 - .04);
      seatBox("detailDark", .586, .595, .80, .825, z0 + .12, z1 - .12);
    }
    for (let k = 0; k <= count; k++) {
      const z = inner + k * width;
      seatBox("detailDark", .12, .51, .575, .625, z - .022, z + .022);
    }
    for (const z of [inner + .11, inner + count * width - .11]) {
      for (const x of [.12, .41]) seatBox("detailSteel", x, x + .027, .035, .36, z - .018, z + .018);
      seatBox("detailDark", .08, .49, .018, .046, z - .025, z + .025);
    }
    seatBox("detailSteel", .08, .105, .105, .13, inner + .05, inner + count * width - .05);
  }

  // Thin floor panels follow the local skin; do not create solid cabin blocks.
  for (let x = spec.floorStartX; x < spec.floorEndX - EPS; x += .5) {
    const end = Math.min(spec.floorEndX, x + .5);
    box("floor", "detailPanel", x, end, floor - .045, floor, -f.widthM / 2, f.widthM / 2);
    box("aisle", "detailDark", x, end, floor + .001, floor + .006, -spec.aisleWidthM / 2, spec.aisleWidthM / 2);
  }

  if (spec.overheadBin && layout.rows.length) {
    const bin = spec.overheadBin;
    const begin = layout.rows[0].x0, end = layout.rows.at(-1)!.x1;
    const blocked = unionIntervals([...layout.doorZones, ...spec.modules.map(m => ({ x0: m.x0, x1: m.x1 }))]);
    for (const side of [-1, 1] as const) for (let x = begin; x < end - .15;) {
      const zone = blocked.find(z => overlaps({ x0: x, x1: Math.min(x + .95, end) }, z));
      if (zone && x >= zone.x0 - EPS) { x = zone.x1; continue; }
      const x1 = Math.min(end, x + .95, zone?.x0 ?? Infinity);
      if (x1 - x < .15) { x = zone ? zone.x1 : end; continue; }
      const z0 = side === 1 ? bin.innerZ : -bin.outerZ, z1 = side === 1 ? bin.outerZ : -bin.innerZ;
      box("overheadBins", "detailPanel", x + .012, x1 - .012, bin.bottomY, bin.topY, z0, z1, side, true);
      const faceZ = side * bin.innerZ;
      box("overheadBins", "detailDark", (x + x1) / 2 - .075, (x + x1) / 2 + .075,
        bin.bottomY + .11, bin.bottomY + .126, faceZ - .006, faceZ + .006, side, true);
      box("lighting", "detailElectrical", x + .02, x1 - .02, bin.topY + .015, bin.topY + .027,
        side === 1 ? .66 : -.70, side === 1 ? .70 : -.66, side);
      x = x1;
    }
  }

  for (const m of spec.modules) {
    const y1 = floor + (m.heightM ?? (m.role === "galley" ? 1.84 : 1.94));
    const side = (m.z0 + m.z1) / 2 >= 0 ? 1 : -1;
    const faceZ = side === 1 ? m.z0 : m.z1;
    const role = m.role;
    // An open-topped thin enclosure makes the service room readable in cutaway.
    box(role, "detailPanel", m.x0, m.x0 + .045, floor, y1, m.z0, m.z1, side);
    box(role, "detailPanel", m.x1 - .045, m.x1, floor, y1, m.z0, m.z1, side);
    box(role, "detailPanel", m.x0, m.x1, floor, y1, side === 1 ? m.z1 - .035 : m.z0,
      side === 1 ? m.z1 : m.z0 + .035, side);
    const face = (tone: DetailTone, x0: number, x1: number, low: number, high: number, thick = .028) =>
      box(role, tone, x0, x1, floor + low, floor + high, faceZ - thick / 2, faceZ + thick / 2, side, true);
    if (role === "lavatory") {
      face("detailPanel", m.x0 + .06, m.x1 - .06, .025, y1 - floor - .04);
      face("detailSteel", m.x0 + .13, m.x0 + .17, .89, 1.0, .05);
      face("detailDark", m.x0 + .12, m.x0 + .19, 1.55, 1.61, .031);
      // Toilet pedestal, pan rim and washbasin remain visible from above.
      const midX = (m.x0 + m.x1) / 2, midZ = (m.z0 + m.z1) / 2;
      box(role, "detailPanel", midX - .16, midX + .16, floor + .08, floor + .41, midZ - .17, midZ + .17, side, true);
      const pan = new THREE.TorusGeometry(.17, .035, 6, 18);
      pan.rotateX(Math.PI / 2); pan.scale(.9, 1, 1.15); pan.translate(midX, floor + .43, midZ);
      push(pan, role, "detailPanel", side);
      box(role, "detailSteel", m.x0 + .07, m.x0 + .32, floor + .81, floor + .85,
        m.z0 + .10, m.z1 - .10, side, true);
    } else if (role === "galley") {
      const width = m.x1 - m.x0;
      const columns = Math.max(1, Math.round(width / .45));
      for (let i = 0; i < columns; i++) {
        const a = m.x0 + .04 + i * (width - .08) / columns, b = m.x0 + .04 + (i + 1) * (width - .08) / columns;
        face("detailSteel", a + .015, b - .015, .07, .91);
        face("detailDark", a + .055, b - .055, .78, .815, .042);
        face("detailPanel", a + .015, b - .015, 1.04, Math.min(1.73, y1 - floor - .04));
        face("detailDark", a + .055, b - .055, 1.17, 1.4, .035);
      }
      box(role, "detailDark", m.x0 + .03, m.x1 - .03, floor + .94, floor + .99, m.z0, m.z1, side, true);
    } else {
      face("detailPanel", m.x0 + .05, m.x1 - .05, .04, y1 - floor - .04);
      face("detailSteel", m.x1 - .14, m.x1 - .10, .92, 1.10, .048);
    }
  }
  const furnishings: THREE.BufferGeometry[] = [], operatorItems: THREE.BufferGeometry[] = [];
  for (const [role, geometries] of roleGroups) {
    const compacted = compactDetails(geometries);
    for (const [index, g] of compacted.entries()) {
      g.userData.cabinRole = role;
      g.userData.cabinLayoutId = layout.id;
      // Count once across merged upholstery, legs and trays, not once per tone.
      if (role === "seats") g.userData.seatCount = index === 0 ? layout.seatCount : 0;
    }
    // Installed lavatories and wardrobes stay with interior; catering belongs to
    // the operator equipment part. No reconciliation mass gets fictitious shapes.
    (role === "galley" ? operatorItems : furnishings).push(...compacted);
  }
  for (const template of boxTemplates.values()) template.dispose();
  return { furnishings, operatorItems, layout };
}
