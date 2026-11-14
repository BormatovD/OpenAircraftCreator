import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { A320CEO } from "../src/aircraft/a320.ts";
import { B757_RB211 } from "../src/aircraft/b757.ts";
import { TU214_FACTORY, TU214_PS90A } from "../src/aircraft/tu214.ts";
import { contextFor } from "../src/aircraft/contextFor.ts";
import { evaluate } from "../src/evaluate.ts";
import { PS90A_EMERGENCY_OEI } from "../src/thrust.ts";
import { passportRows, savedPassports } from "../web/passport.ts";
import { PRESETS } from "../src/integration/flightcost.ts";
import { AIRCRAFT_CHOICES } from "../web/aircraftCatalog.ts";

const ref = (d: typeof TU214_PS90A) => evaluate(d, [], contextFor(d));

test("Ту-214: оба весовых профиля без β в каталоге и названии", () => {
  for (const a of [TU214_PS90A, TU214_FACTORY]) {
    assert.doesNotMatch(a.label, /β|бета|preview/i);
    assert.doesNotMatch(AIRCRAFT_CHOICES[a.id].label, /β|бета|preview/i);
  }
  const app = readFileSync(new URL("../web/index.html", import.meta.url), "utf8");
  assert.match(app, /data-type="tu214"[^>]*>Ту-214</);
});

test("OEI ПС-90А: ЧР отдельная, порог условно проходит, остаётся warning", () => {
  assert.equal(PS90A_EMERGENCY_OEI.emergencyKgf, 17500);
  assert.equal(PS90A_EMERGENCY_OEI.maxMinutes, 3);
  for (const d of [TU214_PS90A, TU214_FACTORY]) {
    const ev = ref(d);
    assert.ok(ev.oeiAtMtow.gradient > 0.018 && ev.oeiAtMtow.gradient < 0.022);
    assert.ok(ev.oeiEmergencyAtMtow && ev.oeiEmergencyAtMtow.gradient > 0.029 && ev.oeiEmergencyAtMtow.gradient < 0.033);
    const c = ev.constraints.find(c => c.id === "oei-mtow")!;
    assert.equal(c.status, "warning");
    assert.match(c.value, /ЧР/);
    assert.match(c.message, /MTOW/);
  }
});

test("Обычная миссия и двигатель ПС-90А не получили повышенной тяги", () => {
  assert.ok(Math.abs(TU214_PS90A.engine.takeoffThrustKn - 16000 * 9.80665 / 1000) < 1e-9);
  const e = ref(TU214_PS90A);
  assert.ok(Math.abs(e.oewKg - 61830) < 1e-6);
  assert.ok(Math.abs(e.missionFuelKg - 9899.662969404599) < 1e-4);
});

test("OEI чрезвычайный: A320 и Boeing 757 не наследуют ПС-90А", () => {
  for (const d of [A320CEO, B757_RB211]) {
    const e = evaluate(d, [], contextFor(d));
    assert.equal(e.oeiEmergency, undefined);
    assert.ok(!e.constraints.find(x => x.id === "oei-climb")!.value.includes("ЧР"));
  }
});

test("Паспорт базового типа показывает факты FlightCost для всех поддерживаемых типов", () => {
  for (const { icao } of PRESETS) assert.ok(savedPassports[icao], icao);
  const rows = new Map(passportRows(savedPassports.A321!).map(r => [r.label, r.value]));
  assert.equal(rows.get("Мест · типовая компоновка"), "210");
  assert.equal(rows.get("Мест · максимум"), "220");
  assert.equal(rows.get("OEW"), "48,50 т");
  assert.equal(rows.get("Запас топлива"), "30,03 т");
  assert.equal(rows.get("MZFW"), "—");
  assert.equal(rows.get("Двигатели · базовый тип"), "2 × CFM56-5B1");
  const tu = new Map(passportRows(savedPassports.T204!).map(r => [r.label, r.value]));
  assert.equal(tu.get("Двигатели · базовый тип"), "2 × ОДК-ПМ ПС-90А (16 тс)");
});

test("Сцена не красит весь кессон при нормальном ICAO code D", () => {
  const ev = ref(TU214_PS90A);
  assert.equal(ev.constraints.find(c => c.id === "span-code")!.kind, "classification");
});

test("Рендер формул не выводит сырой LaTeX красной ошибкой", () => {
  const method = readFileSync(new URL("../web/method.ts", import.meta.url), "utf8");
  assert.ok(method.includes('throwOnError: true'));
  assert.ok(!method.includes('throwOnError: false'));
  assert.ok(method.includes('output: "mathml"'));
  assert.ok(method.includes('\\mathrm{box}'));
});
