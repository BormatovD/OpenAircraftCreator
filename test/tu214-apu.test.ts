import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { TU214_FACTORY, TU214_PS90A } from "../src/aircraft/tu214.ts";
import { controlsFor } from "../web/controls.ts";
import { useShapes } from "../web/scene/shapeSet.ts";
import { fuselageGeometry, fuselageHalfWidthAt } from "../web/scene/shapes.ts";
import { type ApuDoorMotion, cutTu214ApuOpenings, tu214Apu } from "../web/scene/tu214Apu.ts";

test("Ту-214: ВСУ помещается в реальном модельном хвосте при обеих комплектациях и крайних длинах", () => {
  for (const def of [TU214_PS90A, TU214_FACTORY]) {
    const before = JSON.stringify(def);
    const rows = controlsFor(def).find(c => c.id === "rows")!;
    assert.equal(rows.kind, "range");
    if (rows.kind !== "range") throw new Error("length control missing");
    for (const count of [rows.min, 0, rows.max]) {
      const f = { ...def.fuselage, lengthM: def.fuselage.lengthM + count * def.systems.seatPitchM };
      useShapes(def);
      const apu = tu214Apu(f);
      assert.ok(apu.internal.length > 15 && apu.external.length >= 6);
      for (const g of apu.internal) {
        const p = g.getAttribute("position"), n = g.getAttribute("normal");
        for (let i = 0; i < p.count; i++) {
          const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
          assert.ok(Number.isFinite(x + y + z + n.getX(i) + n.getY(i) + n.getZ(i)), g.name);
          assert.ok(x >= f.lengthM - 3.351 && x <= f.lengthM - .25, g.name);
          assert.ok(Math.abs(z) <= fuselageHalfWidthAt(f, x, y) + .002, `${g.name} penetrates tail at ${[x, y, z]}`);
        }
        g.dispose();
      }
      for (const g of apu.external) g.dispose();
    }
    assert.equal(JSON.stringify(def), before, "visual package must not mutate mass or configuration data");
  }
});

test("Ту-214: входы действительно прорезаны, соседняя обшивка сохранена, хвост открыт под выхлоп", () => {
  useShapes(TU214_PS90A);
  const f = TU214_PS90A.fuselage, apu = tu214Apu(f), hull = fuselageGeometry(f);
  const original = Object.fromEntries(["position", "normal", "uv"].map(name => [name, Array.from(hull.getAttribute(name).array)]));
  const radialSegments = hull.userData.radialSegments;
  cutTu214ApuOpenings(hull, f);
  assert.ok(hull.getIndex(), "subsequent indexed hull operations must remain available");
  assert.equal(hull.userData.radialSegments, radialSegments);
  for (const [name, values] of Object.entries(original))
    assert.deepEqual(Array.from(hull.getAttribute(name).array).slice(0, values.length), values, `original ${name} ring layout changed`);
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(hull, material);
  mesh.updateMatrixWorld(true);
  for (const o of apu.intakeOpenings) {
    const x = (o.x0 + o.x1) / 2, y = (o.y0 + o.y1) / 2;
    const ray = new THREE.Raycaster(new THREE.Vector3(x, y, o.side * 4), new THREE.Vector3(0, 0, -o.side));
    const apertureHits = ray.intersectObject(mesh);
    assert.ok(apertureHits.every(hit => hit.point.z * o.side < 0), "an intact face still covers the intake");
    ray.ray.origin.x = o.x0 - .12;
    assert.ok(ray.intersectObject(mesh).some(hit => hit.point.z * o.side > .5), "unrelated skin was cut away");
  }
  const p = hull.getAttribute("position"), uv = hull.getAttribute("uv");
  const used = new Set(Array.from(hull.getIndex()!.array));
  for (let i = 0; i < p.count; i++) {
    if (used.has(i)) assert.ok(p.getX(i) <= apu.exhaustX + .00001);
    assert.ok(Number.isFinite(uv.getX(i) + uv.getY(i)));
  }
  const tail = new THREE.Raycaster(new THREE.Vector3(f.lengthM + 1, 1.0, 0), new THREE.Vector3(-1, 0, 0));
  assert.ok(tail.intersectObject(mesh).every(hit => hit.point.x < f.lengthM - 3), "tail outlet remains capped");
  hull.dispose(); material.dispose();
  for (const g of [...apu.internal, ...apu.external]) g.dispose();
});

test("Ту-214: парные входные створки имеют устойчивый шарнир и расходятся наружу в середине хода", () => {
  useShapes(TU214_PS90A);
  const apu = tu214Apu(TU214_PS90A.fuselage);
  const doors = apu.external.filter(g => g.userData.apuDoor);
  assert.equal(doors.length, 2);
  for (const door of doors) {
    const motion = door.userData.apuDoor as ApuDoorMotion;
    assert.equal(motion.axis.length(), 1);
    const side = Math.sign(motion.angle), o = apu.intakeOpenings.find(o => o.side === side)!;
    const q = new THREE.Quaternion().setFromAxisAngle(motion.axis, motion.angle * .5);
    const p = door.getAttribute("position");
    let moved = 0;
    for (let i = 0; i < p.count; i++) {
      const before = new THREE.Vector3().fromBufferAttribute(p, i);
      const after = before.clone().sub(motion.pivot).applyQuaternion(q).add(motion.pivot);
      assert.ok(Number.isFinite(after.x + after.y + after.z));
      if (before.x < o.x0 + .04) moved = Math.max(moved, (after.z - before.z) * side);
    }
    assert.ok(moved > .3, "forward edge should expose the air path");
    const pivotAfter = motion.pivot.clone().sub(motion.pivot).applyQuaternion(q).add(motion.pivot);
    assert.ok(pivotAfter.distanceTo(motion.pivot) < 1e-12);
  }
  for (const g of [...apu.internal, ...apu.external]) g.dispose();
});
