import assert from "node:assert/strict";
import { test } from "node:test";
import { Box3 } from "three";
import { B737_800 } from "../src/aircraft/b737ng.ts";
import { contextFor } from "../src/aircraft/contextFor.ts";
import { evaluate } from "../src/evaluate.ts";
import { presetFor, withCabinLayout } from "../src/integration/flightcost.ts";
import { nacelleRaise, thrustRating } from "../src/levers.ts";
import { buildAircraft } from "../web/scene/aircraft.ts";

for (const layout of presetFor("b737-800")!.layouts) {
  test(`737-800 ${layout.id}: клиренс в сцене и предупреждения при изменении гондолы`, () => {
    const def = withCabinLayout(B737_800, layout);
    for (const [levers, expected] of [
      [[], "ok"],
      [[thrustRating(110)], "warning"],
      [[thrustRating(140)], "violation"],
      [[thrustRating(140), nacelleRaise(0.23)], "ok"],
    ] as const) {
      const ev = evaluate(def, [...levers], contextFor(def));
      const limit = ev.constraints.find(c => c.id === "nacelle-clearance")!;
      assert.equal(limit.status, expected);
      assert.match(limit.limit, /737-800W/);
      const model = buildAircraft(ev.definition);
      const mesh = new Box3().setFromObject(model.parts.get("nacelles")!.group, true);
      const clearance = mesh.min.y - model.groundY;
      assert.equal(limit.value, clearance.toFixed(2) + " м");
      if (!levers.length) assert.ok(Math.abs(clearance - 0.48) < 0.001);
    }
  });
}
