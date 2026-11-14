import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { contextFor } from "../src/aircraft/contextFor.ts";
import { evaluate } from "../src/evaluate.ts";
import { evaluateConfiguration } from "../src/integration/configuration.ts";
import { flightCostDesign, PRESETS, withCabinLayout } from "../src/integration/flightcost.ts";
import { flightCostRoute, FRA_BCN_NM } from "../src/integration/flightcostRoute.ts";
import { AIRCRAFT } from "../web/aircraftCatalog.ts";
import { defaults, leversFor } from "../web/controls.ts";

const runner = fileURLToPath(new URL("../scripts/flightcost-route.ts", import.meta.url));

for (const preset of PRESETS) {
  if (preset.aircraftId === "b737-800") {
    test("737-800 preview does not advertise a route solver to FlightCost", () => {
      assert.equal(preset.routeSolver, undefined);
    });
    continue;
  }
  test(`Replay every saved cabin of ${preset.aircraftId} with its own engine and weight profile`, () => {
    const reference = AIRCRAFT[preset.aircraftId];
    const base = evaluate(reference, [], contextFor(reference));
    const values = defaults(reference);
    for (const layout of preset.layouts) {
      const def = withCabinLayout(reference, layout);
      const levers = leversFor(def, values);
      const config = evaluateConfiguration(def, levers, "fixed", base);
      const { ev, ctx } = config;
      const design = flightCostDesign(ev.definition, ev.oewKg, values, "fixed", preset.aircraftId, layout.id, ctx.fuelDensityKgL);
      assert.ok(design.model.routeSolver);
      assert.equal(design.model.routeSolver, preset.routeSolver);
      const route = { distanceNm: FRA_BCN_NM, pax: Math.round(ev.seats * 0.8) };
      const expected = flightCostRoute(config, route);
      const mission = evaluate(def, levers, ctx, { seats: route.pax, massPerPaxKg: 100, distanceNm: route.distanceNm });
      assert.deepEqual(expected.limits, {});
      assert.equal(expected.tripKg, mission.tripFuelKg + mission.missionAssumptions.taxiFuelKg);
      assert.ok(Number.isFinite(expected.blockMin) && expected.blockMin > expected.minutes.taxi);
      // Before a preset gained route support its saved v1 designs had no solver tag.
      delete design.model.routeSolver;
      const replay = spawnSync(process.execPath, [runner], { encoding: "utf8", input: JSON.stringify({ design, route }) });
      assert.equal(replay.status, 0, replay.stderr);
      const actual = JSON.parse(replay.stdout);
      assert.equal(actual.model, preset.routeSolver);
      assert.deepEqual(actual.route, JSON.parse(JSON.stringify(expected)));
    }
  });
}
