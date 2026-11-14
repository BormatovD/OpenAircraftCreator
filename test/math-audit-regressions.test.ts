import assert from "node:assert/strict";
import { test } from "node:test";
import { A320CEO } from "../src/aircraft/a320.ts";
import { contextFor } from "../src/aircraft/contextFor.ts";
import { liftToDrag } from "../src/aero.ts";
import { evaluate } from "../src/evaluate.ts";
import { AIRCRAFT } from "../web/aircraftCatalog.ts";
import { CONTROLS, controlsFor } from "../web/controls.ts";
import { aeroQuality, compositeWing, cruiseMach, doubleSlottedFlaps, flapChord, nacelleRaise, slats } from "../src/levers.ts";
import { evaluateConfiguration } from "../src/integration/configuration.ts";
import { renderMethod } from "../web/method.ts";

const close = (actual: number, expected: number, tolerance: number, label: string) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} ≠ ${expected} (±${tolerance})`);
};

test("Math audit 01 — A321 redesign without edits reproduces its base mission", () => {
  const def = AIRCRAFT.a321ceo;
  const base = evaluate(def, [], contextFor(def));
  const result = evaluateConfiguration(def, [], "redesign", base);
  assert.equal(result.redesign?.converged, true);
  close(result.ev.definition.weights.mtowKg, def.weights.mtowKg, 0.01, "MTOW");
  close(result.ev.rangeWithMissionPayloadNm, base.rangeWithMissionPayloadNm, 0.02, "range");
  close(result.ev.tripFuelKg, base.tripFuelKg, 0.02, "trip fuel");
});

test("Math audit 02 — 737 and A321 flap levers move high-lift mass and CLmax in the physical direction", () => {
  for (const id of ["b737-8", "b737-800", "a321ceo"] as const) {
    const def = AIRCRAFT[id];
    const ctx = contextFor(def);
    const base = evaluate(def, [], ctx);
    const mass = (ev: typeof base) => ev.masses.byId.get("wing.highLift")!.kg;

    const nextType = def.wing.highLift.flapType === "double" ? "single" : "double";
    const typeEdit = evaluate(def, [doubleSlottedFlaps(nextType === "double")], ctx);
    const typeSign = nextType === "double" ? 1 : -1;
    assert.equal(Math.sign(mass(typeEdit) - mass(base)), typeSign, `${id}: flap type mass`);
    assert.equal(Math.sign(typeEdit.highLift.clMaxLanding - base.highLift.clMaxLanding), typeSign, `${id}: flap type CLmax`);

    const shorterChord = def.wing.highLift.flapChordFraction * 100 - 1;
    const chordEdit = evaluate(def, [flapChord(shorterChord)], ctx);
    assert.ok(mass(chordEdit) < mass(base), `${id}: shorter flap chord should reduce mass`);
    assert.ok(chordEdit.highLift.clMaxLanding < base.highLift.clMaxLanding, `${id}: shorter flap chord should reduce CLmax`);

    const slatEdit = evaluate(def, [slats(!def.wing.highLift.slats)], ctx);
    const slatSign = def.wing.highLift.slats ? -1 : 1;
    assert.equal(Math.sign(mass(slatEdit) - mass(base)), slatSign, `${id}: slat mass`);
    assert.equal(Math.sign(slatEdit.highLift.clMaxLanding - base.highLift.clMaxLanding), slatSign, `${id}: slat CLmax`);

    const combined = evaluate(def, [doubleSlottedFlaps(false), flapChord(shorterChord), slats(false)], ctx);
    assert.ok(mass(combined) < mass(base), `${id}: combined high-lift mass`);
    assert.ok(combined.highLift.clMaxLanding < base.highLift.clMaxLanding, `${id}: combined CLmax`);
  }
});

test("Math audit 03 — +6% aerodynamic quality gives exactly +6% L/D at CL .55 and M .84", () => {
  const base = evaluate(A320CEO, [], contextFor(A320CEO));
  const improved = evaluate(A320CEO, [aeroQuality(6)], contextFor(A320CEO));
  const baselineLd = liftToDrag(base.aero, 0.55, 0.84);
  const improvedLd = liftToDrag(improved.aero, 0.55, 0.84);
  close(improvedLd / baselineLd, 1.06, 1e-10, "L/D ratio");
});

test("Math audit 04 — 1 cm nacelle raise compares identical energy-based mission phases", () => {
  const base = evaluate(A320CEO, [], contextFor(A320CEO));
  const edited = evaluateConfiguration(A320CEO, [nacelleRaise(0.01)], "fixed", base);
  assert.equal(base.missionResult.trip.climbSource, "fcom", "unmodified A320 baseline retains its reference FCOM climb");
  assert.equal(edited.base.missionResult.trip.climbSource, "energy");
  assert.equal(edited.ev.missionResult.trip.climbSource, "energy");
  for (const phase of ["takeoffFuelKg", "climbFuelKg", "cruiseFuelKg", "stepClimbFuelKg", "descentFuelKg"] as const) {
    close(edited.ev.missionResult.trip[phase], edited.base.missionResult.trip[phase], 1e-8, phase);
  }
  close(edited.ev.tripFuelKg, edited.base.tripFuelKg, 1e-8, "trip fuel");
});

test("Math audit 05 — payload accounting uses whole passengers before cargo", () => {
  const mission = { seats: A320CEO.systems.seats, distanceNm: 810, massPerPaxKg: 123.45, cargoKg: 2500 };
  const result = evaluate(A320CEO, [], contextFor(A320CEO), mission);
  const expectedSeats = Math.min(mission.seats, Math.floor((result.maxPayloadKg + 1e-6) / mission.massPerPaxKg));
  const expectedCargo = Math.min(mission.cargoKg, Math.max(0, result.maxPayloadKg - expectedSeats * mission.massPerPaxKg));
  assert.equal(result.seatsCarried, expectedSeats);
  assert.equal(result.cargoCarriedKg, expectedCargo);
  close(result.payloadKg, expectedSeats * mission.massPerPaxKg + expectedCargo, 1e-8, "actual payload");
  close(result.payloadKg, result.seatsCarried * mission.massPerPaxKg + result.cargoCarriedKg, 1e-8, "integer passenger and cargo sum");
});

test("Math audit 06 — Reynolds correction cache changes with nacelle installation and engine count", () => {
  const def = AIRCRAFT["b737-8"];
  const original = evaluate(def, [], contextFor(def));
  const other = { ...def, engine: { ...def.engine,
    installation: def.engine.installation === "pylon" ? "close-coupled" as const : "pylon" as const,
    count: def.engine.count + 1,
  } };
  const switched = evaluate(other, [], contextFor(other));
  const repeated = evaluate(def, [], contextFor(def));
  assert.notDeepEqual(switched.aero.cd0Scale, original.aero.cd0Scale, "changed nacelle setup must build its own correction table");
  assert.deepEqual(repeated.aero.cd0Scale, original.aero.cd0Scale, "returning to the first setup must restore its table");
  close(repeated.aero.cd0, original.aero.cd0, 1e-14, "base CD0");
});

test("Math audit 07 — exactly 36 m is at the code C/D boundary", () => {
  const def = { ...A320CEO, wing: { ...A320CEO.wing, tip: "sharklet" as const, sharkletSpanM: 36 } };
  const result = evaluate(def, [], contextFor(def));
  const span = result.constraints.find(c => c.id === "span-code")!;
  assert.equal(span.value, "36.00 м");
  assert.equal(span.status, "warning");
  assert.match(span.message, /Код D/);
});

test("Math audit 08 — OPR slider has a 0.1 step", () => {
  const opr = controlsFor(AIRCRAFT.a320ceo).find(c => c.id === "opr");
  assert.ok(opr && opr.kind === "range");
  assert.equal(opr.step, 0.1);
});

test("Math audit 09 — method explains a non-finite per-seat result without displaying NaN", () => {
  const result = evaluate(A320CEO, [], contextFor(A320CEO), { seats: 0, distanceNm: 810, massPerPaxKg: 95 });
  assert.ok(Number.isNaN(result.fuelPerSeatPer100KmKg));
  const html = renderMethod(result);
  assert.match(html, /нет пассажиров|расход на место[^<]*(не|невозможно)/i);
  assert.doesNotMatch(html, /\bNaN\b|\bInfinity\b/);
});

test("Math audit 10 — method identifies RB211's three-spool architecture and labels mission phases", () => {
  const def = AIRCRAFT["b757-200-rb"];
  const html = renderMethod(evaluate(def, [], contextFor(def)));
  assert.ok(html.includes("У RB211 три соосных вала."));
  assert.ok(html.includes("Турбина НД приводит вентилятор"));
  assert.ok(html.includes("турбина СД — шестиступенчатый КСД"));
  assert.ok(html.includes("турбина ВД — шестиступенчатый КВД"));
  assert.ok(html.includes("Расчёт расхода использует общий упрощённый цикл"));
  assert.doesNotMatch(html, /отдельный вал СД и смешение потоков RB211 пока не воспроизведены/);
  for (const phase of ["Взлёт", "Начальный набор", "Горизонтальный крейсер", "Ступенчатый набор в крейсере", "Снижение", "Рейсовое топливо"]) {
    assert.ok(html.includes(phase), `missing phase description: ${phase}`);
  }

  const available = controlsFor(def);
  for (const control of available) assert.ok(html.includes(control.label), `missing B757 control ${control.id}`);
  const excluded = CONTROLS.find(control => !available.some(candidate => candidate.id === control.id));
  assert.ok(excluded, "B757 should not inherit every catalog control");
  assert.ok(!html.includes(excluded.label), `unavailable B757 control was rendered: ${excluded.id}`);

  const baseHtml = renderMethod(evaluate(A320CEO, [], contextFor(A320CEO)));
  assert.ok(baseHtml.includes("набор рассчитан по таблице CES FCOM"));
  assert.ok(baseHtml.includes("ожидания по таблице Green Dot CES FCOM"));
  const changedHtml = renderMethod(evaluate(A320CEO, [nacelleRaise(0.01)], contextFor(A320CEO)));
  assert.ok(changedHtml.includes("набор рассчитан энергетическим методом"));
  assert.ok(changedHtml.includes("снижение — по модели"));
});

test("Math audit 11 — method Mach table preserves current controls and mission", () => {
  const ctx = contextFor(A320CEO);
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
