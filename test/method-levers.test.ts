import assert from "node:assert/strict";
import { test } from "node:test";
import { A320CEO } from "../src/aircraft/a320.ts";
import { contextFor } from "../src/aircraft/contextFor.ts";
import { evaluate } from "../src/evaluate.ts";
import { compositeWing, cruiseMach, flapChord, nacelleRaise, slats, doubleSlottedFlaps, aeroQuality } from "../src/levers.ts";
import { evaluateConfiguration } from "../src/integration/configuration.ts";
import { renderMethod } from "../web/method.ts";
import { AIRCRAFT } from "../web/aircraftCatalog.ts";

const ctx = contextFor(A320CEO);
const base = evaluate(A320CEO, [], ctx);

test("Подстановка Raymer совпадает с независимым численным расчётом и рендерится целиком", () => {
  // Подстановка в исходных единицах Raymer: lb, ft², без вызова массовых оценщиков.
  const areaFt2 = 122.4 / 0.3048 ** 2;
  const wingKg = 0.45359237 * 0.0051 * (73500 / 0.45359237 * 3.75) ** 0.557
    * areaFt2 ** 0.649 * (34.1 ** 2 / 122.4) ** 0.5 * 0.15 ** -0.4
    * 1.24 ** 0.1 / Math.cos(25 * Math.PI / 180) * (28 / 0.3048 ** 2) ** 0.1;
  assert.ok(Math.abs(base.masses.byId.get("wing.box")!.rawKg - wingKg * 0.82) < 1e-8);
  assert.ok(Math.abs(base.masses.byId.get("wing.highLift")!.rawKg - wingKg * 0.18) < 1e-8);
  const html = renderMethod(base);
  assert.doesNotMatch(html, /math-render-fallback|katex-error/);
  assert.ok(html.includes(String.raw`W^R_{\mathrm{box}} = 4\,392\,\mathrm{kg},\quad W^R_{\mathrm{flaps}} = 964\,\mathrm{kg}`));
  assert.ok(html.includes(String.raw`OEW = 41\,244\,\mathrm{kg}`));
});

test("Таблица Маха сохраняет массу, поляру и миссию выбранной конфигурации", () => {
  const levers = [compositeWing(), aeroQuality(6)];
  const mission = { seats: 123, distanceNm: 1234, massPerPaxKg: 98 };
  const html = renderMethod(evaluate(A320CEO, levers, ctx, mission));
  const expected = evaluate(A320CEO, [...levers, cruiseMach(0.8)], ctx, mission);
  const fmt = (x: number, n: number) => x.toLocaleString("ru-RU", { minimumFractionDigits: n, maximumFractionDigits: n });
  const wave = expected.cruiseDrag.parts.find(p => p.id === "wave")!.counts;
  const row = ["M 0,80", fmt(wave, 1), "1,000", fmt(expected.cruiseDrag.ld, 1), fmt(expected.fuelPerSeatPer100KmKg, 3)];
  assert.ok(html.includes(row.map(s => `<td>${s}</td>`).join("")));
  assert.ok(html.includes(String.raw`123 \cdot 2\,285`));
  assert.doesNotMatch(html, /math-render-fallback|katex-error/);
});

test("Массы закрылков, предкрылков и прочей механизации складываются по компонентам", () => {
  const r = evaluate(A320CEO, [doubleSlottedFlaps(true), flapChord(30), slats(false)], ctx);
  const expected = 0.6 * 1.25 * 30 / 26 + 0.2;
  assert.ok(Math.abs(r.masses.byId.get("wing.highLift")!.kg / base.masses.byId.get("wing.highLift")!.kg - expected) < 1e-12);
});

test("Подъём гондолы сравнивается при одинаковых фазах, нулевое перепроектирование сохраняет базу", () => {
  const edit = evaluateConfiguration(A320CEO, [nacelleRaise(0.01)], "fixed", base);
  assert.equal(base.missionResult.trip.climbSource, "fcom");
  assert.equal(edit.base.missionResult.trip.climbSource, "energy");
  assert.equal(edit.ev.tripFuelKg, edit.base.tripFuelKg);
  for (const d of [A320CEO, AIRCRAFT.a321ceo]) {
    const b = evaluate(d, [], contextFor(d));
    const r = evaluateConfiguration(d, [], "redesign", b);
    assert.ok(r.redesign?.converged);
    assert.equal(r.ev.definition.weights.mtowKg, d.weights.mtowKg);
    assert.equal(r.ev.rangeWithMissionPayloadNm, b.rangeWithMissionPayloadNm);
    assert.equal(r.ev.tripFuelKg, b.tripFuelKg);
  }
});
