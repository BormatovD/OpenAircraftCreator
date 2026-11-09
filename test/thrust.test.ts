import { test } from "node:test";
import assert from "node:assert/strict";
import { A320CEO, A320NEO } from "../src/aircraft/a320.ts";
import { A320_CONTEXT as ctx } from "../src/aircraft/a320Context.ts";
import { evaluate } from "../src/evaluate.ts";
import { cruiseMach, fuselageStretch, thrustRating } from "../src/levers.ts";
import { availableThrustN, thrustLapse } from "../src/thrust.ts";

test("тяга CFM56-5B4 на FL350, M 0,78 — 5 000…5 900 lbf (порядок опубликованных крейсерских тяг)", () => {
  const lbf = availableThrustN(A320CEO, 350, 0.78, 1) / 4.448;
  assert.ok(lbf > 5000 && lbf < 5900, `${lbf}`);
});

test("тяга падает с высотой и растёт с давлением торможения", () => {
  assert.ok(thrustLapse(10668, 0.78) < thrustLapse(7620, 0.78));
  assert.ok(thrustLapse(0, 0) === 1);
});

test("A320ceo и A320neo при MTOW занимают FL330 и выше; второй сегмент с запасом к 2,4%", () => {
  for (const d of [A320CEO, A320NEO]) {
    const e = evaluate(d, [], ctx);
    assert.ok(e.thrust.ceilingFl >= 330 && e.thrust.ceilingFl <= 398, `${d.id} FL${e.thrust.ceilingFl}`);
    assert.ok(e.oei.gradient > 0.03 && e.oei.gradient < 0.06, `${d.id} ${e.oei.gradient}`);
  }
});

test("меньший двигатель: легче, но ниже потолок, хуже набор с отказом и длиннее разбег", () => {
  const b = evaluate(A320CEO, [], ctx);
  const s = evaluate(A320CEO, [thrustRating(85)], ctx);
  const tofl = (e: typeof b) => parseFloat(e.constraints.find((c) => c.id === "takeoff-field")!.value.replace(/\s/g, ""));
  assert.ok(s.oewKg < b.oewKg);
  assert.ok(s.thrust.ceilingFl < b.thrust.ceilingFl);
  assert.ok(s.oei.gradient < b.oei.gradient);
  assert.ok(tofl(s) > tofl(b));
});

test("быстрее и тяжелее — ниже потолок по тяге", () => {
  const b = evaluate(A320CEO, [], ctx).thrust.ceilingFl;
  assert.ok(evaluate(A320CEO, [cruiseMach(0.82)], ctx).thrust.ceilingFl <= b);
  assert.ok(evaluate(A320CEO, [fuselageStretch(6)], ctx).thrust.ceilingFl <= b);
});
