import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { AIRCRAFT } from "../web/aircraftCatalog.ts";
import { airbusMainDoors } from "../web/scene/airbusGear.ts";
import { useShapes } from "../web/scene/shapeSet.ts";
import { buildAircraft } from "../web/scene/aircraft.ts";
import { applyGearBayPose, gearLegTravel } from "../web/scene/gearBay.ts";

const families = ["a319ceo", "a319neo", "a320ceo", "a320neo", "a321ceo", "a321neo"] as const;
const lower = (x: number, z: number) => -1.2 + .1 * x + .04 * z;
const skin = {
  lower,
  roof: (x: number, z: number) => -.65 + .02 * x + .06 * z,
  trailingEdge: (z: number) => .62 - .03 * z,
};

test("Airbus: connected lining and fixed apron follow the installed wing envelope", () => {
  const shape = useShapes(AIRCRAFT.a320ceo);
  for (const side of [-1, 1] as const) {
    const pivot = new THREE.Vector3(0, -.2, side * shape.gear.mainZ);
    const parts = airbusMainDoors(shape.gear, side, pivot, lower, -3.867, skin);
    const uncapped = airbusMainDoors(shape.gear, side, pivot, lower, -3.867, {
      ...skin, roof: () => 10, trailingEdge: () => 100,
    });
    const wells = parts.filter(g => g.userData.gearWell);
    assert.equal(wells.length, 1, "wheel and leg apertures share one unpartitioned chamber");
    for (const well of wells) {
      const p = well.getAttribute("position");
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), z = Math.abs(p.getZ(i));
        if (x <= skin.trailingEdge(z)) assert.ok(p.getY(i) <= skin.roof(x, z) + 1e-6, `${well.name}: roof penetrates the wing`);
      }
    }
    const sill = parts.find(g => g.name === "main-well-sill")!;
    assert.equal(sill.userData.fixedWingBody, true);
    assert.equal(sill.userData.bellyPaint, true);
    assert.ok(!("tone" in sill.userData));
    const p = sill.getAttribute("position");
    assert.ok(p.count > 0);
    let installedEdge = 0;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = Math.abs(p.getZ(i)), y = p.getY(i);
      assert.ok(x <= skin.trailingEdge(z) - .012 + 1e-6, "apron forms a shelf beyond the trailing edge");
      assert.ok(y <= lower(x, z) - .004 + 1e-6, "apron penetrates the installed lower skin");
      assert.ok(side * p.getZ(i) > 0, "apron crosses the centre seam");
      if (Math.abs(y - lower(x, z) + .004) < 1e-6) installedEdge++;
    }
    assert.ok(installedEdge > 50, "missing supported outside edge");
    // Fitting the stationary surfaces must preserve all three moving panels,
    // their closed gaps, pivots, and complete kinematic drive definitions.
    for (let i = 0; i < 3; i++) {
      assert.deepEqual(parts[i].getAttribute("position").array, uncapped[i].getAttribute("position").array);
      assert.deepEqual(parts[i].userData, uncapped[i].userData);
    }
    for (const g of [...parts, ...uncapped]) g.dispose();
  }
});

function edges(geometry: THREE.BufferGeometry) {
  const p = geometry.getAttribute("position"), index = geometry.getIndex();
  const seen = new Set<string>(), result: [THREE.Vector3, THREE.Vector3][] = [];
  for (let i = 0; i < (index?.count ?? p.count); i += 3) {
    const triangle = [0, 1, 2].map(j => new THREE.Vector3().fromBufferAttribute(p, index ? index.getX(i + j) : i + j));
    for (let j = 0; j < 3; j++) {
      const a = triangle[j], b = triangle[(j + 1) % 3];
      if (a.distanceToSquared(b) < 1e-12) continue;
      const key = [a, b].map(v => v.toArray().map(n => n.toFixed(6)).join(",")).sort().join("/");
      if (!seen.has(key)) { seen.add(key); result.push([a, b]); }
    }
  }
  return result;
}

// Spatial batches retain every original triangle whole. Their bounding volumes
// reject distant rays before Three.js runs the exact triangle intersection.
function collisionPatches(mesh: THREE.Mesh, material: THREE.Material) {
  const p = mesh.geometry.getAttribute("position"), ix = mesh.geometry.getIndex();
  const cells = new Map<string, number[]>();
  for (let i = 0; i < (ix?.count ?? p.count); i += 3) {
    const points = [0, 1, 2].map(j => new THREE.Vector3().fromBufferAttribute(p, ix ? ix.getX(i + j) : i + j));
    const center = points.reduce((sum, p) => sum.add(p), new THREE.Vector3()).divideScalar(3);
    const key = center.toArray().map(n => Math.floor(n / .3)).join(",");
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key)!.push(...points.flatMap(p => p.toArray()));
  }
  return [...cells.values()].map(vertices => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    g.computeBoundingSphere(); g.computeBoundingBox();
    const part = new THREE.Mesh(g, material);
    part.matrixAutoUpdate = false;
    part.matrixWorld.copy(mesh.matrixWorld);
    return part;
  });
}

for (const id of families) test(`${id}: complete main tyres clear the real connected well throughout 101 installed poses`, () => {
  const model = buildAircraft(AIRCRAFT[id]);
  const parts = model.parts.get("gear.main")!.group.children as THREE.Mesh[];
  const wells = parts.filter(m => m.geometry.userData.gearWell);
  const tyres = parts.filter(m => m.geometry.name === "tyre");
  assert.equal(wells.length, 2);
  assert.equal(tyres.length, 4);
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  for (const m of [...wells, ...tyres]) { m.material = material; m.updateMatrixWorld(true); }
  const fixed = wells.flatMap(w => collisionPatches(w, material));
  const fixedBoxes = fixed.map(m => m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld));
  const rim = wells.flatMap(w => edges(w.geometry).map(([a, b]) => {
    const points = [a.clone().applyMatrix4(w.matrixWorld), b.clone().applyMatrix4(w.matrixWorld)] as const;
    return { points, box: new THREE.Box3().setFromPoints([...points]) };
  }));
  const ray = new THREE.Raycaster();
  const crosses = (a: THREE.Vector3, b: THREE.Vector3, meshes: THREE.Mesh[]) => {
    const length = a.distanceTo(b);
    ray.set(a, b.clone().sub(a).divideScalar(length));
    ray.near = 1e-6; ray.far = length - 1e-6;
    return ray.intersectObjects(meshes, false)[0];
  };
  for (const tyre of tyres) {
    const tread = edges(tyre.geometry);
    const moving = collisionPatches(tyre, material);
    tyre.geometry.computeBoundingBox();
    for (let i = 0; i <= 100; i++) {
      const up = i / 100, data = tyre.geometry.userData;
      tyre.position.copy(tyre.userData.basePos);
      tyre.rotation.set(data.retract.angle * gearLegTravel(data.gearProfile, up), 0, 0);
      applyGearBayPose(tyre, up, 1);
      tyre.updateMatrixWorld(true);
      for (const part of moving) part.matrixWorld.copy(tyre.matrixWorld);
      const box = tyre.geometry.boundingBox!.clone().applyMatrix4(tyre.matrixWorld);
      const candidates = fixed.filter((_, i) => fixedBoxes[i].intersectsBox(box));
      for (const [a, b] of tread) {
        const hit = crosses(a.clone().applyMatrix4(tyre.matrixWorld), b.clone().applyMatrix4(tyre.matrixWorld), candidates);
        assert.ok(!hit, `tyre crosses a well at stroke=${up}, side=${data.side}, point=${hit?.point.toArray()}`);
      }
      // Check the reverse edges too: a liner corner can enter the middle of a
      // tread triangle without crossing any of that triangle's three edges.
      for (const edge of rim) {
        if (!edge.box.intersectsBox(box)) continue;
        assert.ok(!crosses(edge.points[0], edge.points[1], moving), `well crosses a tyre face at stroke=${up}, side=${data.side}`);
      }
    }
    for (const part of moving) part.geometry.dispose();
  }
  for (const part of fixed) part.geometry.dispose();
  material.dispose();
  model.root.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
});
