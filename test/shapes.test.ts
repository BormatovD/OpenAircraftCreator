// Наборы контуров 3D-модели: таблицы 737 сняты с сетки и должны совпадать с размерами Boeing D6-38A004 2.2.2.
import assert from "node:assert/strict";
import { test } from "node:test";
import B737 from "../data/ac/b737-8-shapes.json" with { type: "json" };

test("737-8: фюзеляж 39,12 м, сечение 3,76 × 4,01 м с точностью 2%", () => {
  const f = B737.fuselage;
  assert.ok(Math.abs(f.x.at(-1)! - 39.12) < 0.02);
  assert.ok(Math.abs((2 * B737.halfWidth) / 3.76 - 1) < 0.02);
  assert.ok(Math.abs((2 * B737.halfHeight) / 4.01 - 1) < 0.02);
  for (const k of ["top", "bottom", "half_width"] as const) assert.ok(f[k].every(Number.isFinite));
  assert.ok(B737.section.r.every(Number.isFinite) && B737.section.deg.at(-1) === 360);
});

test("737-8: оперение и крыло — в пределах 3% от размеров Boeing", () => {
  // Размах стабилизатора 14,35 м (47 ft 1 in), высота самолёта на стоянке 12,29 м (40 ft 4 in).
  assert.ok(Math.abs((2 * B737.htail.tip_z) / 14.35 - 1) < 0.03);
  assert.ok(Math.abs((B737.vtail.tip_y - B737.groundY) / 12.29 - 1) < 0.03);
  // Стреловидность передней кромки внешней части крыла — около 28° (25° по четверти хорд).
  assert.ok(Math.abs(B737.wing.le.sweep_deg - 28) < 2);
});
