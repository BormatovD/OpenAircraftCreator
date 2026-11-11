import assert from "node:assert/strict";
import { test } from "node:test";
import { A320CEO } from "../src/aircraft/a320.ts";
import { A319CEO, A321CEO, A321NEO } from "../src/aircraft/a320family.ts";
import { useShapes } from "../web/scene/shapeSet.ts";
import { acX, modelX, fuselagePlugs } from "../web/scene/shapes.ts";
import { cabinOpenings, cabinWindows, cargoOpenings } from "../web/scene/features.ts";
import { B757_RB211, B757_PW2037 } from "../src/aircraft/b757.ts";
import { buildAircraft } from "../web/scene/aircraft.ts";
import * as THREE from "three";

const near = (a: number, b: number, tolerance = 1e-8) => assert.ok(Math.abs(a - b) < tolerance, `${a} ≠ ${b}`);

test("A321: передняя вставка 4,27 м и задняя 2,67 м сохраняют нос, крыло и хвост", () => {
  useShapes(A321CEO);
  const L = A321CEO.fuselage.lengthM;
  near(fuselagePlugs(L).forwardM, 4.27);
  near(fuselagePlugs(L).aftM, 2.67);
  near(modelX(L, 5.07), 5.07);
  near(modelX(L, 17.71), 21.98);
  near(modelX(L, 37.57), 44.51);
  for (const x of [0, 5, 12, 18, 28, 36]) near(acX(L, modelX(L, x)), x);
  // При следующем выборе исходного A320 не остаётся передняя вставка A321.
  useShapes(A320CEO);
  near(modelX(37.57, 17.71), 17.71);
});

test("A319: сокращение фюзеляжа монотонно и не создаёт развёрнутых участков", () => {
  useShapes(A319CEO);
  const L = A319CEO.fuselage.lengthM;
  let previous = -Infinity;
  for (let x = 0; x <= 37.57; x += 0.025) {
    const mapped = modelX(L, x);
    assert.ok(mapped >= previous - 1e-10);
    previous = mapped;
  }
  for (const x of [0, 5, 12, 18, 28, 36]) near(acX(L, modelX(L, x)), x);
  near(modelX(L, 37.57), L);
});

test("A321 ceo/neo: четыре собственных проёма не растягиваются повторно и не перекрываются окнами", () => {
  for (const def of [A321CEO, A321NEO]) {
    useShapes(def);
    const openings = cabinOpenings(def);
    assert.equal(openings.length, 4);
    assert.ok(openings.every((d) => d.y1 - d.y0 > 1.8));
    for (const [i, center] of [5.02, 13.84, 24.79, 36.58].entries())
      near((openings[i].x0 + openings[i].x1) / 2, center, 0.12);
    near((cargoOpenings(def)[0].x0 + cargoOpenings(def)[0].x1) / 2, 8.16, 0.05);
    const windows = cabinWindows(def);
    assert.ok(windows.length > 40);
    for (const w of windows) assert.ok(openings.every((d) => w.x1 <= d.x0 - 0.08 || w.x0 >= d.x1 + 0.08));
  }
});

test("A321: дополнительное удлинение переносит проёмы, сохраняя ширину дверей", () => {
  useShapes(A321CEO);
  const before = cabinOpenings(A321CEO);
  const stretched = { ...A321CEO, fuselage: { ...A321CEO.fuselage, lengthM: A321CEO.fuselage.lengthM + 2 } };
  useShapes(stretched);
  const after = cabinOpenings(stretched);
  for (const [i, offset] of [0, 1, 1, 2].entries()) {
    near(after[i].x0 - before[i].x0, offset);
    near(after[i].x1 - after[i].x0, before[i].x1 - before[i].x0);
  }
});

test("757: реальные собранные меши имеют восемь точек касания основных шин и общий габарит из ACAP", () => {
  for (const def of [B757_RB211, B757_PW2037]) {
    const model = buildAircraft(def);
    model.root.updateMatrixWorld(true);
    assert.ok(!model.parts.has("wingtips"), "у исходного 757 не должно быть fence A320");
    model.root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        for (const v of o.geometry.getAttribute("position").array) assert.ok(Number.isFinite(v), o.userData.partId);
      }
    });
    const box = new THREE.Box3().setFromObject(model.root);
    near(box.max.x, 47.32, 0.03);
    assert.ok(box.max.y - model.groundY >= 13.49 && box.max.y - model.groundY <= 13.74);
    const contacts = new Set<string>();
    const p = new THREE.Vector3();
    model.parts.get("gear.main")!.group.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const positions = o.geometry.getAttribute("position");
      for (let i = 0; i < positions.count; i++) {
        p.fromBufferAttribute(positions, i).applyMatrix4(o.matrixWorld);
        if (Math.abs(p.y - model.groundY) < 1e-5) contacts.add(`${p.x.toFixed(3)},${p.z.toFixed(3)}`);
      }
    });
    assert.equal(contacts.size, 8, [...contacts].join("; "));
    const axleX = [...new Set([...contacts].map((q) => +q.split(",")[0]))].sort((a, b) => a - b);
    assert.equal(axleX.length, 2);
    near(axleX[1] - axleX[0], 1.143, 0.002);
    near((axleX[1] + axleX[0]) / 2 - 5.89, 18.29, 0.002);
    model.root.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
  }
});

test("757: первый проём зависит от борта, установка гондолы — от выбранного двигателя", () => {
  const rb = useShapes(B757_RB211);
  near(rb.nacelle.inletX, 16.84);
  const left = cabinOpenings(B757_RB211, -1)[0];
  const right = cabinOpenings(B757_RB211, 1)[0];
  near((left.x0 + left.x1) / 2, 5.05);
  near((right.x0 + right.x1) / 2, 4.78);
  assert.ok(left.x1 - left.x0 > right.x1 - right.x0);
  const pw = useShapes(B757_PW2037);
  near(pw.nacelle.inletX, 16.61);
  near(B757_RB211.engine.nacelleWidthM, 2.46);
  near(B757_PW2037.engine.nacelleWidthM, 2.69);
});
