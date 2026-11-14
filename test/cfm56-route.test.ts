import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { A320CEO } from "../src/aircraft/a320.ts";
import { contextFor } from "../src/aircraft/contextFor.ts";
import { evaluate } from "../src/evaluate.ts";
import { evaluateConfiguration } from "../src/integration/configuration.ts";
import { CFM56_ROUTE_MODEL, LEAP_ROUTE_MODEL, flightCostDesign, layoutFor, withCabinLayout } from "../src/integration/flightcost.ts";
import { flightCostRoute, FRA_BCN_NM } from "../src/integration/flightcostRoute.ts";
import { defaults, leversFor } from "../web/controls.ts";

const layout = "a320-180";
const def = withCabinLayout(A320CEO, layoutFor("a320ceo", layout)!);
const ctx = contextFor(def);
const base = evaluate(A320CEO, [], contextFor(A320CEO));
const runner = fileURLToPath(new URL("../scripts/flightcost-route.ts", import.meta.url));

test("CFM56 route uses the Designer mission at the requested payload, including FCOM phase times and IFR approach", () => {
  const c = evaluateConfiguration(def, [], "fixed", base);
  for (const pax of [72, 108, 144, 148, 180]) {
    const route = flightCostRoute(c, { pax, distanceNm: FRA_BCN_NM });
    const ev = evaluate(def, [], ctx, { seats: pax, massPerPaxKg: 100, distanceNm: FRA_BCN_NM });
    const { trip } = ev.missionResult;
    assert.deepEqual(route.limits, {});
    assert.equal(route.tripKg, ev.tripFuelKg + ev.missionAssumptions.taxiFuelKg);
    assert.equal(trip.climbSource, "fcom");
    assert.equal(trip.descentSource, "fcom");
    assert.equal(route.minutes.climb, trip.climbTimeMin);
    assert.equal(route.minutes.descent, trip.pureDescentTimeMin! + ev.missionAssumptions.fcomApproachDurationMin!);
    assert.equal(route.blockMin, 26 + trip.climbTimeMin! + trip.cruiseTimeMin + route.minutes.descent);
  }
});

test("CFM56 exports and old v1 designs replay by engine; changing the airframe uses the Designer fallback", () => {
  const values = { ...defaults(A320CEO), harness: 5 };
  const levers = leversFor(def, values);
  const c = evaluateConfiguration(def, levers, "fixed", base);
  const design = flightCostDesign(c.ev.definition, c.ev.oewKg, values, "fixed", "a320ceo", layout, ctx.fuelDensityKgL);
  assert.equal(design.model.routeSolver, CFM56_ROUTE_MODEL);
  const input = { pax: 144, distanceNm: FRA_BCN_NM };
  const expected = flightCostRoute(c, input);
  const reference = evaluate(def, levers, ctx, { seats: input.pax, massPerPaxKg: 100, distanceNm: FRA_BCN_NM });
  assert.equal(reference.missionResult.trip.pureDescentTimeMin, undefined);
  assert.equal(expected.minutes.descent, reference.missionResult.trip.descentDistanceNm / 280 * 60);
  const run = () => spawnSync(process.execPath, [runner], { encoding: "utf8", input: JSON.stringify({ design, route: input }) });
  delete design.model.routeSolver;
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).route.tripKg, expected.tripKg);
  assert.equal(JSON.parse(result.stdout).model, CFM56_ROUTE_MODEL);
  design.model.routeSolver = LEAP_ROUTE_MODEL;
  assert.notEqual(run().status, 0);
  design.model.routeSolver = CFM56_ROUTE_MODEL;
  design.aircraft.engine = "CFM56-5B4";
  assert.notEqual(run().status, 0);
});
