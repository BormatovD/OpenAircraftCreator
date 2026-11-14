// Three.js-level smoke tests for the visual-only Tu-214 cleanup.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { TU214_FACTORY, TU214_PS90A } from "../src/aircraft/tu214.ts";
import { buildAircraft } from "../web/scene/aircraft.ts";

test("Ту-214: собственные загнутые законцовки без нижних вертикальных пластин", () => {
  const model = buildAircraft(TU214_PS90A);
  model.root.updateMatrixWorld(true);
  const winglets = model.parts.get("wingtips");
  assert.ok(winglets, "winglet mesh missing");
  const bound = new THREE.Box3().setFromObject(winglets.group);
  assert.ok(bound.max.y - bound.min.y > 1.6, "winglet must rise above the wing tip");
  assert.ok(bound.max.z <= TU214_PS90A.wing.spanM / 2 + 0.2, "do not silently enlarge the published span");
  assert.ok(bound.min.y > -0.6, "a lower A320-style fence must not remain");
  model.root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      const verts = o.geometry.getAttribute("position");
      for (let i = 0; i < verts.count; i++)
        for (const coord of [verts.getX(i), verts.getY(i), verts.getZ(i)]) assert.ok(Number.isFinite(coord));
    }
  });
  model.root.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
});

test("Ту-214: шесть стёкол и шесть отдельных рам без изменения других типов", () => {
  const model = buildAircraft(TU214_PS90A);
  const tones: Record<string, number> = {};
  model.parts.get("fuselage")!.group.traverse((o) => {
    if (o instanceof THREE.Mesh && o.userData.tone) {
      tones[o.userData.tone] = (tones[o.userData.tone] || 0) + 1;
      const n = o.geometry.getAttribute("normal");
      for (let i = 0; i < n.count; i++) assert.ok(Number.isFinite(n.getX(i) + n.getY(i) + n.getZ(i)));
    }
  });
  assert.equal(tones.glass, 6);
  assert.equal(tones.glassFrame, 6);
  model.root.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
});

test("ПС-90А: обе установленные гондолы повторяют боковой и верхний виды Ту-204-200", () => {
  const near = (a: number, b: number, tolerance: number) => assert.ok(Math.abs(a - b) < tolerance, `${a} vs ${b}`);
  for (const def of [TU214_PS90A, TU214_FACTORY]) {
    const model = buildAircraft(def);
    model.root.updateMatrixWorld(true);
    for (const side of [-1, 1]) {
      const boundsOf = (object: THREE.Object3D) => new THREE.Box3().setFromObject(object);
      const segments = model.parts.get("nacelles")!.group.children.filter(o => o.userData.side === side);
      const rings = segments.filter(o => (o as THREE.Mesh).geometry.type === "LatheGeometry");
      const shell = rings.reduce((box, ring) => box.union(boundsOf(ring)), new THREE.Box3());
      const inlet = boundsOf(rings[0]), nozzle = boundsOf(rings.at(-1)!);
      near(shell.min.x, 14.25, 0.05);
      near(shell.max.x, 20.40, 0.05);
      near(inlet.getCenter(new THREE.Vector3()).z, side * 6.52, 0.05);
      near(inlet.getCenter(new THREE.Vector3()).y, -2.84, 0.05);
      near(shell.max.z - shell.min.z, 2.36, 0.05);
      near(nozzle.max.z - nozzle.min.z, 1.20, 0.06);
      const engine = model.parts.get("engines")!.group.children.filter(o => o.userData.side === side);
      const engineBox = engine.reduce((box, item) => box.union(boundsOf(item)), new THREE.Box3());
      assert.ok(engineBox.min.x > shell.min.x && engineBox.max.x < shell.max.x);
      near(engineBox.max.x - engineBox.min.x, 4.964, 0.025);
    }
    model.root.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
  }
});

test("Ту-214: нижняя образующая хвоста следует боковой фотографии RA-64549", () => {
  const model = buildAircraft(TU214_PS90A);
  const hull = model.parts.get("fuselage")!.group.children[0] as THREE.Mesh<THREE.BufferGeometry>;
  const p = hull.geometry.getAttribute("position");
  const stride = hull.geometry.userData.radialSegments + 1;
  // One scale and pitch for the whole aircraft, using body length and crown.
  for (const [px, py] of [[656,295.5], [688,290.5], [724,282.5], [756,274], [790,264.5], [818,255.5]]) {
    let previousX = 0, previousY = 0;
    let residual = Infinity;
    for (let i = 0; i < p.count; i += stride) {
      const bottom = i + 3 * (stride - 1) / 4;
      const x = p.getX(bottom), y = p.getY(bottom);
      const projectedX = 28.54 + 17.824 * (x + 0.002173 * y);
      const projectedY = 263.03 + 17.824 * (0.002173 * x - y);
      if (projectedX >= px) {
        residual = THREE.MathUtils.lerp(previousY, projectedY, (px - previousX) / (projectedX - previousX)) - py;
        break;
      }
      previousX = projectedX;
      previousY = projectedY;
    }
    assert.ok(Math.abs(residual) < 2, `lower edge at ${px} px, residual ${residual}`);
  }
  model.root.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
});
