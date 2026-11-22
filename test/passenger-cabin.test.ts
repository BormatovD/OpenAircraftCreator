import assert from "node:assert/strict";
import { test } from "node:test";
import { AIRCRAFT } from "../web/aircraftCatalog.ts";
import { presetFor, withCabinLayout } from "../src/integration/flightcost.ts";
import { applyDefinition, fuselageStretch } from "../src/levers.ts";
import { useShapes } from "../web/scene/shapeSet.ts";
import { fuselageHalfWidthAt, fuselageSection } from "../web/scene/shapes.ts";
import { cabinOpenings, cabinWindows } from "../web/scene/features.ts";
import { fleetCabinSpec } from "../web/scene/fleetCabin.ts";
import { tu214CabinSpec } from "../web/scene/tu214Cabin.ts";
import { buildPassengerCabin, passengerCabinLayout, type CabinDoorZone } from "../web/scene/passengerCabin.ts";

const configurations = Object.entries(AIRCRAFT).flatMap(([id, def]) =>
  (presetFor(id)?.layouts ?? [null]).map(layout => ({ id, layout, def: layout ? withCabinLayout(def, layout) : def })));
const overlaps = (a: CabinDoorZone, b: CabinDoorZone) => a.x1 > b.x0 + 1e-6 && a.x0 < b.x1 - 1e-6;

test("Passenger cabin: all 24 offered configurations and 19 lengths preserve seats and open exits", () => {
  assert.equal(configurations.length, 24);
  for (const { id, layout, def } of configurations) for (let stretch = -6; stretch <= 12; stretch++) {
    const d = applyDefinition(def, [fuselageStretch(stretch)]);
    useShapes(d);
    const spec = id.startsWith("tu214") ? tu214CabinSpec(d) : fleetCabinSpec(d);
    const plan = passengerCabinLayout(d, spec);
    const context = `${id}/${layout?.id ?? "default"}/${stretch}`;
    assert.equal(plan.seatCount, d.systems.seats, context);
    assert.equal(plan.rows.reduce((n, r) => n + r.leftSeats + r.rightSeats, 0), d.systems.seats, context);
    for (const [index, row] of plan.rows.entries()) {
      assert.ok(row.leftSeats <= Math.ceil(row.seatsPerRow / 2), context);
      assert.ok(row.rightSeats <= Math.floor(row.seatsPerRow / 2), context);
      assert.ok(row.x1 <= spec.lastRowEndX + 1e-5, context);
      assert.ok(!plan.doorZones.some(zone => overlaps(row, zone)), `${context}: seats block exit`);
      assert.ok(!plan.modules.some(zone => overlaps(row, zone)), `${context}: seats overlap service room`);
      if (index > 0) assert.ok(row.x0 >= plan.rows[index - 1].x1 - 1e-6, `${context}: seat rows intersect`);
    }
    for (const room of plan.modules) {
      assert.ok(!plan.doorZones.some(zone => overlaps(room, zone)), `${context}: service room blocks exit`);
      assert.ok(room.z0 >= spec.aisleWidthM / 2 || room.z1 <= -spec.aisleWidthM / 2, `${context}: service room blocks aisle`);
    }
    if (plan.pitchScale < .99999) assert.ok(plan.capacityWarning, `${context}: undeclared visual pitch change`);
  }
});

test("Passenger cabin: every rendered preset stays inside its own skin with exact seat count", () => {
  for (const { id, layout, def } of configurations) {
    useShapes(def);
    const before = JSON.stringify(def);
    const spec = id.startsWith("tu214") ? tu214CabinSpec(def) : fleetCabinSpec(def);
    const built = buildPassengerCabin(def, spec);
    assert.equal(JSON.stringify(def), before, `${id}: visual builder mutated analytical definition`);
    assert.equal(built.furnishings.reduce((n, g) => n + (g.userData.seatCount ?? 0), 0), def.systems.seats);
    assert.ok(built.furnishings.length + built.operatorItems.length <= 36, `${id}: excessive draw calls`);
    assert.ok(built.operatorItems.every(g => g.userData.cabinRole === "galley"));
    assert.ok(built.furnishings.some(g => g.userData.cabinRole === "overheadBins"));
    const widthCache = new Map<string, number>();
    for (const g of [...built.furnishings, ...built.operatorItems]) {
      const p = g.getAttribute("position"), normals = g.getAttribute("normal");
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        assert.ok(Number.isFinite(x + y + z + normals.getX(i) + normals.getY(i) + normals.getZ(i)));
        const key = `${x}:${y}`;
        let width = widthCache.get(key);
        if (width === undefined) { width = fuselageHalfWidthAt(def.fuselage, x, y); widthCache.set(key, width); }
        const section = fuselageSection(def.fuselage, x);
        assert.ok(y <= section.cy + section.hh + 1e-5 && y >= section.cy - section.hh - 1e-5,
          `${id}/${layout?.id}/${g.userData.cabinRole}: vertical skin penetration`);
        assert.ok(Math.abs(z) <= width + 1e-5, `${id}/${layout?.id}/${g.userData.cabinRole}: lateral skin penetration`);
        if (g.userData.cabinRole === "seats") assert.ok(Math.abs(z) >= spec.aisleWidthM / 2 - 1e-5, `${id}: seat in aisle`);
      }
      g.dispose();
    }
  }
});

test("High-density exit patterns follow the selected layout on both sides", () => {
  const expected: Record<string, number> = {
    "b733-128": 1, "b38m-178": 2, "b38m-210": 3, "a321-220": 2, "a321-244": 3,
  };
  for (const { def } of configurations) {
    const exitsPerSide = expected[def.cabinLayout?.id ?? ""];
    if (exitsPerSide === undefined) continue;
    useShapes(def);
    for (const side of [-1, 1] as const) {
      const exits = cabinOpenings(def, side).filter(d => d.kind === "exit");
      assert.equal(exits.length, exitsPerSide, def.id);
      assert.ok(cabinWindows(def, side).every(w => !exits.some(e => overlaps(w, e))));
    }
  }
});
