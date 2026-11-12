import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { A320CEO } from "../src/aircraft/a320.ts";
import { B757_RB211 } from "../src/aircraft/b757.ts";
import { TU214_FACTORY, TU214_PS90A } from "../src/aircraft/tu214.ts";
import { contextFor } from "../src/aircraft/contextFor.ts";
import { evaluate } from "../src/evaluate.ts";
import { PS90A_EMERGENCY_OEI } from "../src/thrust.ts";
import { passportRows } from "../web/passport.ts";
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
    assert.ok(ev.oei.gradient > 0.018 && ev.oei.gradient < 0.021);
    assert.ok(ev.oeiEmergency && ev.oeiEmergency.gradient > 0.029 && ev.oeiEmergency.gradient < 0.032);
    const c = ev.constraints.find(c => c.id === "oei-climb")!;
    assert.equal(c.status, "warning");
    assert.match(c.value, /ЧР/);
    assert.match(c.limit, /3 мин/);
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

test("Паспорт берёт исходные данные определения и не выдумывает maximum seats", () => {
  const e = ref(TU214_PS90A);
  const r = passportRows(e.definition, e.oewKg, e.missionAssumptions.cruiseMach);
  const get = (label: string) => r.find(x => x.label.startsWith(label))?.value;
  assert.equal(get("OEW"), "61,83 т");
  assert.equal(get("MZFW"), "84,20 т");
  assert.equal(get("Двигатели"), "2 × ПС-90А");
  assert.equal(get("Мест · максимум"), "210");
  assert.equal(get("Топливо"), "35,71 т");
  const b = evaluate(B757_RB211, [], contextFor(B757_RB211));
  assert.equal(passportRows(b.definition, b.oewKg, b.missionAssumptions.cruiseMach).find(x => x.label === "Мест · максимум")!.value, "не подтверждено");
});

test("Сцена не красит весь кессон при нормальном ICAO code D", () => {
  const main = readFileSync(new URL("../web/main.ts", import.meta.url), "utf8");
  assert.match(main, /"span-code": \[\]/);
  assert.ok(!/"span-code": \["wing\.box"/.test(main));
});

test("Рендер формул не выводит сырой LaTeX красной ошибкой", () => {
  const method = readFileSync(new URL("../web/method.ts", import.meta.url), "utf8");
  assert.ok(method.includes('throwOnError: true'));
  assert.ok(!method.includes('throwOnError: false'));
  assert.ok(method.includes('output: "mathml"'));
  assert.ok(method.includes('\\mathrm{box}'));
});
