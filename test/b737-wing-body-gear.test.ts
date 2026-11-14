import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { AIRCRAFT } from "../web/aircraftCatalog.ts";
import { buildAircraft } from "../web/scene/aircraft.ts";
import { fuselageGeometry } from "../web/scene/shapes.ts";

const v = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

for (const id of ["b737-300", "b737-800", "b737-8"]) {
  test(`${id}: fixed wing/body insert closes the root and the main strut passes through its aperture`, () => {
    const def = AIRCRAFT[id], model = buildAircraft(def);
    const main = model.parts.get("gear.main")!.group.children as THREE.Mesh[];
    const body = model.parts.get("fuselage")!.group.children as THREE.Mesh[];
    const wing = model.parts.get("wing.box")!.group.children as THREE.Mesh[];
    const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    const reference = new THREE.Mesh(fuselageGeometry(def.fuselage), material);
    const [hull] = body;
    const fairings = body.filter(m => m.geometry.name === "main-trunnion-support-fairing");
    assert.equal(fairings.length, 2, "both stationary fairings belong to the fuselage");
    assert.ok(!main.some(m => m.geometry.userData.fixedWingBody));
    for (const f of fairings) {
      assert.equal(f.geometry.userData.fixedWingBody, true);
      assert.equal(f.geometry.userData.bellyPaint, true);
      assert.equal(f.geometry.userData.tone, undefined, "fairing uses the belly paint, without panel markings");
      assert.equal(f.geometry.userData.retract, undefined);
    }
    for (const mesh of [...body, ...wing]) mesh.material = material;
    for (const side of [-1, 1]) {
      const leg = main.find(m => m.geometry.name === "main-strut" && m.userData.side === side)!;
      const pivot = leg.userData.basePos as THREE.Vector3;
      const opening = main.find(m => m.geometry.name === "main-inner-door" && m.userData.side === side)!.geometry.userData.bayOpening;
      for (const frac of [.05, .35, .5, .85, .95]) {
        const x = THREE.MathUtils.lerp(opening.x0, opening.x1, frac);
        for (const y of [-.80, -.56, -.29, -.06]) {
          const ray = new THREE.Raycaster(v(x, y, side * 5), v(0, 0, -side));
          const expected = ray.intersectObject(reference)[0]?.distance;
          const actual = ray.intersectObject(hull)[0]?.distance;
          assert.ok(expected !== undefined && actual !== undefined && Math.abs(expected - actual) < 1e-5,
            `sidewall cut above the wing at x=${x}, y=${y}`);
        }
        for (const z of [1.98, 2.2, pivot.z * side, pivot.z * side + .16]) {
          const roof = new THREE.Raycaster(v(x, 3, side * z), v(0, -1, 0)).intersectObjects(wing)[0];
          assert.ok(roof && roof.point.y > pivot.y - .015, `missing fixed roof at x=${x}, z=${z}`);
        }
      }
      // Check every triangle edge, rather than only mesh vertices: a long strut edge
      // can cross a skin between its ends. Sample the complete stroke at 1% intervals.
      const position = leg.geometry.getAttribute("position"), index = leg.geometry.getIndex();
      const edgeKeys = new Set<string>(), edges: [THREE.Vector3, THREE.Vector3][] = [];
      const point = (i: number) => v().fromBufferAttribute(position, i);
      for (let i = 0; i < (index?.count ?? position.count); i += 3) {
        const triangle = [0, 1, 2].map(k => index ? index.getX(i + k) : i + k);
        for (let j = 0; j < 3; j++) {
          const a = point(triangle[j]), b = point(triangle[(j + 1) % 3]);
          const keys = [a.toArray().map(n => n.toFixed(6)).join(","), b.toArray().map(n => n.toFixed(6)).join(",")].sort();
          const key = keys.join("/");
          if (!edgeKeys.has(key) && a.distanceTo(b) > 1e-6) { edgeKeys.add(key); edges.push([a, b]); }
        }
      }
      // Crop the large aircraft meshes once to the strut's swept bounding box.
      // All intersecting triangles are retained whole, so no possible crossing is lost.
      leg.geometry.computeBoundingBox();
      const swept = new THREE.Box3();
      for (let i = 0; i <= 100; i++) {
        leg.position.copy(pivot); leg.rotation.x = leg.geometry.userData.retract.angle * i / 100;
        leg.updateMatrixWorld(true);
        swept.union(leg.geometry.boundingBox!.clone().applyMatrix4(leg.matrixWorld));
      }
      swept.expandByScalar(.001);
      const fixedPoints: number[] = [], triangleBox = new THREE.Box3();
      for (const mesh of [...body, ...wing]) {
        const p = mesh.geometry.getAttribute("position"), ix = mesh.geometry.getIndex();
        for (let i = 0; i < (ix?.count ?? p.count); i += 3) {
          const points = [0, 1, 2].map(k => v().fromBufferAttribute(p, ix ? ix.getX(i + k) : i + k).applyMatrix4(mesh.matrixWorld));
          if (triangleBox.setFromPoints(points).intersectsBox(swept)) fixedPoints.push(...points.flatMap(p => p.toArray()));
        }
      }
      const fixedGeometry = new THREE.BufferGeometry();
      fixedGeometry.setAttribute("position", new THREE.Float32BufferAttribute(fixedPoints, 3));
      const fixed = new THREE.Mesh(fixedGeometry, material);
      const ray = new THREE.Raycaster();
      for (let step = 0; step <= 100; step++) {
        const up = step / 100;
        leg.position.copy(pivot);
        leg.rotation.x = leg.geometry.userData.retract.angle * up;
        leg.updateMatrixWorld(true);
        for (const [aa, bb] of edges) {
          const a = aa.clone().applyMatrix4(leg.matrixWorld), b = bb.clone().applyMatrix4(leg.matrixWorld);
          ray.set(a, b.clone().sub(a).normalize()); ray.near = 1e-6; ray.far = a.distanceTo(b) - 1e-6;
          const hit = ray.intersectObject(fixed, false)[0];
          assert.ok(!hit, `strut crosses the fixed wing/body skin at stroke ${up}`);
        }
      }
      fixedGeometry.dispose();
    }
    material.dispose(); reference.geometry.dispose();
    model.root.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
  });
}
