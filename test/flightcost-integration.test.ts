import assert from "node:assert/strict";
import { test } from "node:test";
import { AIRCRAFT_CHOICES } from "../web/aircraftCatalog.ts";
import {
  FC_SCHEMA, PRESETS, seatsInLayout, seatsInZone, cabinRowsFor, flightCostDesign,
  layoutFor, presetFor, resolveFlightCostAircraft, validatePresetCatalog, withCabinLayout,
} from "../src/integration/flightcost.ts";
import DATA from "../web/public/aircraft-configurations.v1.json" with { type: "json" };

test("Public config is versioned and valid", () => {
  assert.equal(DATA.schema, FC_SCHEMA);
  assert.equal(DATA.version, 1);
  assert.deepEqual(validatePresetCatalog(), []);
  assert.equal(PRESETS.length, Object.keys(AIRCRAFT_CHOICES).length);
});

test("Every engine maps exactly to the real Aircraft Designer definition", () => {
  for (const p of PRESETS) {
    const def = AIRCRAFT_CHOICES[p.aircraftId]?.definition;
    assert.ok(def, p.aircraftId);
    assert.equal(def.engine.name, p.engine, p.aircraftId);
    const layout = layoutFor(p.aircraftId)!;
    assert.equal(seatsInLayout(layout), def.systems.seats, `base ${p.aircraftId}`);
  }
});

test("FlightCost existing type aliases have explicit engine selection", () => {
  const a = resolveFlightCostAircraft(new URLSearchParams("ac=A20N&engine=LEAP-1A&layout=a320-194"));
  assert.ok("preset" in a);
  if ("preset" in a) {
    assert.equal(a.preset.aircraftId, "a320neo");
    assert.equal(seatsInLayout(a.layout), 194);
  }
  const bad = resolveFlightCostAircraft(new URLSearchParams("ac=A20N&engine=PW1127G-JM"));
  assert.ok("error" in bad && /не реализован/.test(bad.error));
  const rb = resolveFlightCostAircraft(new URLSearchParams("ac=B752&engine=RB211-535E4"));
  const pw = resolveFlightCostAircraft(new URLSearchParams("ac=B752&engine=PW2037"));
  assert.ok("preset" in rb && rb.preset.aircraftId.endsWith("rb"));
  assert.ok("preset" in pw && pw.preset.aircraftId.endsWith("pw"));
});

test("The renderer and the evaluator receive exactly the selected number of seats", () => {
  for (const p of PRESETS) for (const layout of p.layouts) {
    const def = withCabinLayout(AIRCRAFT_CHOICES[p.aircraftId].definition, layout);
    const visible = cabinRowsFor(def);
    assert.equal(def.systems.seats, seatsInLayout(layout));
    assert.equal(visible.reduce((total, r) => total + r.seats, 0), def.systems.seats);
    assert.ok(visible.every((r) => r.seats <= r.seatsPerRow && r.seats > 0));
  }
});

test("Fuselage stretch changes the physical seats and exported cabin plan together", () => {
  const l = layoutFor("b757-200-rb", "b752-225")!;
  assert.equal(seatsInLayout(l), 225);
  const baseline = withCabinLayout(AIRCRAFT_CHOICES["b757-200-rb"].definition, l);
  const extended = { ...baseline, systems: { ...baseline.systems, seats: 231 } };
  const d = flightCostDesign(extended, 62000, { rows: 1 }, "fixed", "b757-200-rb", "b752-225", 0.785);
  assert.equal(d.aircraft.seats, 231);
  assert.equal(d.aircraft.cabin.reduce((n, z) => n + seatsInZone(z), 0), 231);
  assert.equal(d.aircraft.engine, "RB211-535E4");
  assert.ok(!("tripFuelKg" in d));
});

test("Sane trailing partial rows 194, 178, 225 and 239 are not rounded up", () => {
  for (const [id, layout, expected] of [
    ["a320neo", "a320-194", 194],
    ["b737-8", "b38m-178", 178],
    ["b757-200-pw", "b752-225", 225],
    ["b757-200-rb", "b752-239", 239],
    ["tu214-ps90a", "t214-194", 194],
  ] as const) {
    const def = withCabinLayout(AIRCRAFT_CHOICES[id].definition, layoutFor(id, layout)!);
    const seats = cabinRowsFor(def).reduce((n, r) => n + r.seats, 0);
    assert.equal(seats, expected);
  }
});
