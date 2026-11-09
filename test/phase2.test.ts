import { test } from "node:test";
import assert from "node:assert/strict";
import { A320CEO, A320NEO } from "../src/aircraft/a320.ts";
import { A320_CONTEXT as ctx } from "../src/aircraft/a320Context.ts";
import { evaluate } from "../src/evaluate.ts";
import { bypassRatio, fuselageStretch } from "../src/levers.ts";
import { fanDiameterForBpr, tsfcFactor } from "../src/propulsion.ts";

test("линия диаметра вентилятора проходит через PW1100G (≈2,05 м при B 12,5) без подгонки", () => {
  assert.ok(Math.abs(fanDiameterForBpr(12.5) - 2.05) < 0.03);
});

test("модель КПД воспроизводит откалиброванное отношение TSFC NEO/CEO (0,491 / 0,588 при сопротивлении по составляющим)", () => {
  assert.ok(Math.abs(tsfcFactor(A320CEO.engine, A320NEO.engine) - 0.491 / 0.588) < 0.01);
});

test("критерий фазы 2: CEO → NEO экономит 13–20% топлива на место", () => {
  const ceo = evaluate(A320CEO, [], ctx).fuelPerSeatPer100KmKg;
  const neo = evaluate(A320NEO, [], ctx).fuelPerSeatPer100KmKg;
  const d = (neo - ceo) / ceo;
  assert.ok(d < -0.13 && d > -0.2, `Δ ${(d * 100).toFixed(1)}%`);
});

test("рост двухконтурности: двигатель тяжелее, TSFC ниже", () => {
  const base = evaluate(A320CEO, [], ctx);
  const b11 = evaluate(A320CEO, [bypassRatio(11)], ctx);
  assert.ok(b11.oewKg > base.oewKg);
  assert.ok(b11.tsfcCruise < base.tsfcCruise);
});

test("удлинение фюзеляжа: +6 мест на ряд, фюзеляж тяжелее, расход на место ниже", () => {
  const base = evaluate(A320CEO, [], ctx);
  const s = evaluate(A320CEO, [fuselageStretch(2)], ctx);
  assert.equal(s.seats, base.seats + 12);
  assert.ok(s.masses.byId.get("fuselage")!.kg > base.masses.byId.get("fuselage")!.kg);
  assert.ok(s.fuelPerSeatPer100KmKg < base.fuelPerSeatPer100KmKg);
});
