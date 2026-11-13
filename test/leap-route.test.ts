import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { A320NEO } from "../src/aircraft/a320.ts";
import { contextFor } from "../src/aircraft/contextFor.ts";
import { evaluate } from "../src/evaluate.ts";
import { evaluateConfiguration } from "../src/integration/configuration.ts";
import { flightCostDesign, layoutFor, withCabinLayout } from "../src/integration/flightcost.ts";
import { FRA_BCN_NM, leapRoute } from "../src/integration/leapRoute.ts";
import { defaults, leversFor } from "../web/controls.ts";

const def = withCabinLayout(A320NEO, layoutFor("a320neo", "a320-194")!);
const base = evaluate(A320NEO, [], contextFor(A320NEO));
const runner = fileURLToPath(new URL("../scripts/flightcost-route.ts", import.meta.url));

function replay(design: unknown, pax: number) {
  return spawnSync(process.execPath, [runner], {encoding: "utf8",
    input: JSON.stringify({ design, route: { pax, distanceNm: FRA_BCN_NM } }) });
}

test("LEAP mission uses the same airborne fuel as evaluate, adds taxi once and carries the reserve", () => {
  const c = evaluateConfiguration(def, [], "fixed", base);
  for (const pax of [78, 116, 155, 159, 194]) {
    const r = leapRoute(c, {pax, distanceNm: FRA_BCN_NM});
    const reference = evaluate(def, [], contextFor(def), {seats: pax, massPerPaxKg: 100, distanceNm: FRA_BCN_NM});
    assert.deepEqual(r.limits, {});
    assert.equal(r.tripKg, reference.tripFuelKg + reference.missionAssumptions.taxiFuelKg);
    assert.equal(r.reserves.totalKg, reference.missionResult.reserves.totalKg);
    assert.ok(Math.abs(r.tripKg - Object.values(r.fuel).reduce((a, b) => a + b, 0)) < 0.001);
    assert.ok(Math.abs(r.blockMin - 126.9098) < 0.001);
  }
  assert.ok(leapRoute(c, {pax: 195, distanceNm: FRA_BCN_NM}).limits.cabin);
  const far = leapRoute(c, {pax: 194, distanceNm: 6000});
  assert.ok(far.limits.range);
  assert.equal(far.maxPax, 0);
});

test("Runner replays edited and legacy exports, rejects an inconsistent mass or engine", () => {
  const values = {...defaults(A320NEO), harness: 5};
  const levers = leversFor(def, values);
  for (const mode of ["fixed", "redesign"] as const) {
    const c = evaluateConfiguration(def, levers, mode, base);
    const design = flightCostDesign(c.ev.definition, c.ev.oewKg, values, mode, "a320neo", "a320-194", c.ctx.fuelDensityKgL);
    if (mode === "fixed") delete design.model.routeSolver;
    const result = replay(design, 155);
    assert.equal(result.status, 0, result.stderr);
    const expected = leapRoute(c, {pax: 155, distanceNm: FRA_BCN_NM});
    assert.deepEqual(JSON.parse(result.stdout).route, JSON.parse(JSON.stringify(expected)));
    design.weights.oew_kg += 1;
    assert.notEqual(replay(design, 155).status, 0);
    design.weights.oew_kg -= 1;
    design.aircraft.engine = "PW1127G-JM";
    assert.notEqual(replay(design, 155).status, 0);
  }
});
