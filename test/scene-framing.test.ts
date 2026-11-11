import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { A320CEO } from "../src/aircraft/a320.ts";
import { B757_RB211 } from "../src/aircraft/b757.ts";
import { buildAircraft } from "../web/scene/aircraft.ts";
import { SELECTED_EXPLODE_FRACTION, fitAircraftFrame, meshFramePoints, type SceneFrameArea } from "../web/scene/framing.ts";

const areas: SceneFrameArea[] = [
  { width: 1100, height: 790, top: 88, bottom: 58, left: 14, right: 14 },
  { width: 780, height: 620, top: 100, bottom: 238, left: 14, right: 14 },
  { width: 490, height: 480, top: 115, bottom: 220, left: 14, right: 14 },
];
const directions = [new THREE.Vector3(-60, 17.5, 56), new THREE.Vector3(20, 45, -40)];

test("A320 и 757: текущие Mesh после выбора/разбора помещаются между KPI и панелью рычагов", () => {
  for (const def of [A320CEO, B757_RB211]) {
    const model = buildAircraft(def);
    // Наклон всей модели проверяет мировые координаты, а не только исходные A320-габариты.
    model.root.rotation.set(0.09, -0.12, 0.15);
    for (const mode of ["assembled", "selected", "exploded"]) {
      for (const p of model.parts.values()) {
        const k = mode === "exploded" ? 1 : mode === "selected" && p.id === "nacelles" ? SELECTED_EXPLODE_FRACTION : 0;
        p.group.position.copy(p.explode).multiplyScalar(k);
        for (const child of p.group.children) {
          if (!(child instanceof THREE.Mesh)) continue;
          const base = child.userData.basePos as THREE.Vector3 | null;
          const offset = child.userData.offset as THREE.Vector3 | null;
          child.position.copy(base ?? new THREE.Vector3());
          if (offset) child.position.addScaledVector(offset, k);
          child.position.z += (child.userData.side ?? 0) * p.sideSpread * k;
        }
      }
      const points = meshFramePoints(model.root);
      assert.ok(points.length > 100);
      for (const area of areas) for (const direction of directions) {
        const camera = new THREE.PerspectiveCamera(32, area.width / area.height, 0.5, 2500);
        const frame = fitAircraftFrame(points, direction, camera.up, camera.fov, camera.zoom, camera.near, area)!;
        assert.ok(frame, `${def.id} ${mode}`);
        camera.position.copy(frame.position);
        camera.lookAt(frame.target);
        camera.setViewOffset(area.width, area.height, frame.offsetX, frame.offsetY, area.width, area.height);
        camera.updateMatrixWorld(true);
        // Независимая обратная проверка перспективной проекцией Three, не формулой fit.
        for (const point of points) {
          const ndc = point.clone().project(camera);
          const x = (ndc.x + 1) * area.width / 2;
          const y = (1 - ndc.y) * area.height / 2;
          assert.ok(x >= area.left - 1e-6 && x <= area.width - area.right + 1e-6, `${def.id}/${mode}: x ${x}`);
          assert.ok(y >= area.top - 1e-6 && y <= area.height - area.bottom + 1e-6, `${def.id}/${mode}: y ${y}`);
          assert.ok(ndc.z > -1 && ndc.z < 1, `${def.id}/${mode}: clipped depth`);
        }
      }
    }
    model.root.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
  }
});

test("Кадрирование игнорирует длинные выноски и скрытые меши", () => {
  const root = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(40, 12, 36));
  root.add(mesh);
  const leader = new THREE.Line(new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(), new THREE.Vector3(10000, 10000, 10000),
  ]));
  root.add(leader);
  const hidden = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10));
  hidden.visible = false;
  hidden.position.set(20000, 20000, 20000);
  root.add(hidden);
  const points = meshFramePoints(root);
  assert.equal(points.length, 8);
  const box = new THREE.Box3().setFromPoints(points);
  assert.deepEqual(box.getSize(new THREE.Vector3()).toArray(), [40, 12, 36]);
  mesh.geometry.dispose();
  hidden.geometry.dispose();
  leader.geometry.dispose();
});

test("Скрытая или полностью закрытая панелями сцена не создаёт неверную проекцию", () => {
  const point = [new THREE.Vector3(1, 2, 3)];
  const direction = new THREE.Vector3(0, 0, 1);
  const up = new THREE.Vector3(0, 1, 0);
  assert.equal(fitAircraftFrame(point, direction, up, 32, 1, 0.5, { ...areas[0], width: 0 }), undefined);
  assert.equal(fitAircraftFrame(point, direction, up, 32, 1, 0.5, { ...areas[0], height: 100 }), undefined);
  assert.equal(fitAircraftFrame([], direction, up, 32, 1, 0.5, areas[0]), undefined);
});
