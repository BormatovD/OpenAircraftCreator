import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { A321NEO } from "../src/aircraft/a320family.ts";
import { contextFor } from "../src/aircraft/contextFor.ts";
import { evaluate } from "../src/evaluate.ts";
import { evaluateConfiguration } from "../src/integration/configuration.ts";
import { flightCostDesign, layoutFor, LEAP_ROUTE_MODEL, withCabinLayout } from "../src/integration/flightcost.ts";
import { flightCostRoute, FRA_BCN_NM } from "../src/integration/flightcostRoute.ts";
import { defaults, leversFor } from "../web/controls.ts";

const runner = fileURLToPath(new URL("../scripts/flightcost-route.ts", import.meta.url));
const base = evaluate(A321NEO, [], contextFor(A321NEO));
const values = defaults(A321NEO);

for (const layoutId of ["a321-220", "a321-244"]) {
  test(`A21N ${layoutId} replays its own airframe for the LEAP-1A route`, () => {
    const def = withCabinLayout(A321NEO, layoutFor("a321neo", layoutId)!);
    const levers = leversFor(def, values);
    const c = evaluateConfiguration(def, levers, "fixed", base);
    const design = flightCostDesign(c.ev.definition, c.ev.oewKg, values, "fixed", "a321neo", layoutId, c.ctx.fuelDensityKgL);
    assert.equal(design.model.routeSolver, "a321neo-leap-mission-v1");
    const route = {distanceNm: FRA_BCN_NM, pax: Math.round(c.ev.seats * 0.8)};
    const expected = flightCostRoute(c, route);
    const mission = evaluate(def, levers, c.ctx, {distanceNm: route.distanceNm, seats: route.pax, massPerPaxKg: 100});
    assert.equal(expected.tripKg, mission.tripFuelKg + mission.missionAssumptions.taxiFuelKg);
    assert.deepEqual(expected.limits, {});
    const replay = () => spawnSync(process.execPath, [runner], { encoding: "utf8", input: JSON.stringify({design, route}) });
    // Older exports identify the solver by the saved airframe, engine and layout.
    if (layoutId === "a321-244") delete design.model.routeSolver;
    const result = replay();
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.model, "a321neo-leap-mission-v1");
    assert.equal(parsed.route.tripKg, expected.tripKg);
    assert.equal(parsed.route.blockMin, expected.blockMin);
    const full = flightCostRoute(c, { ...route, pax: c.ev.seats });
    assert.equal(full.maxPax, Math.min(c.ev.seats, Math.floor(c.ev.maxPayloadKg / 100)));
    assert.equal(Boolean(full.limits.payload), c.ev.seats > full.maxPax);
    design.model.routeSolver = LEAP_ROUTE_MODEL;
    assert.notEqual(replay().status, 0);
  });
}
