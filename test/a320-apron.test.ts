import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { AIRCRAFT } from "../web/aircraftCatalog.ts";
import { airbusMainDoors } from "../web/scene/airbusGear.ts";
import { useShapes } from "../web/scene/shapeSet.ts";

for (const id of ["a319ceo", "a320ceo", "a321ceo"] as const) test(`${id}: fixed apron has a round physical feather and coherent underside normals`, () => {
  const gear = useShapes(AIRCRAFT[id]).gear;
  const lower = (x: number, z: number) => -.9 + .025 * x + .04 * z;
  const skin = { lower, roof: () => 10, trailingEdge: () => 100 };
  const parts = airbusMainDoors(gear, 1, new THREE.Vector3(0, -.2, gear.mainZ), lower, -3.867, skin);
  const apron = parts.find(g => g.name === "main-well-sill")!, body = parts.find(g => g.name === "main-body-door")!;
  assert.equal(apron.userData.smoothApron, true);
  assert.ok(apron.index, "the infill and feather must share indexed surface vertices");
  const p = apron.getAttribute("position"), n = apron.getAttribute("normal"), ix = apron.index!;
  const a = new THREE.Vector3(), b = a.clone(), c = a.clone(), normal = a.clone();
  for (let i = 0; i < p.count; i++) {
    assert.ok(n.getY(i) < 0, "a fixed underside normal points into the airframe");
    assert.ok(Math.abs(normal.fromBufferAttribute(n, i).length() - 1) < 1e-6);
    assert.ok(p.getY(i) <= lower(p.getX(i), p.getZ(i)) - .004 + 1e-6, "apron penetrates its supporting skin");
  }
  for (let i = 0; i < ix.count; i += 3) {
    a.fromBufferAttribute(p, ix.getX(i)); b.fromBufferAttribute(p, ix.getX(i + 1)); c.fromBufferAttribute(p, ix.getX(i + 2));
    normal.copy(b).sub(a).cross(c.clone().sub(a));
    assert.ok(normal.y < -5e-9, "a vertical corner fan or float-resolution sliver remains");
  }
  const opening = body.userData.bayOpening;
  const cornerX = opening.x1 + .024 - .10 + .012;
  const cornerZ = opening.z1 + .024 + .012;
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), mesh = new THREE.Mesh(apron, material);
  mesh.updateMatrixWorld(true);
  const present = (dx: number, dz: number) => new THREE.Raycaster(new THREE.Vector3(cornerX + dx, -10, cornerZ + dz),
    new THREE.Vector3(0, 1, 0)).intersectObject(mesh).length > 0;
  assert.ok(present(.27, .20), "the rounded feather is missing outside a rectangular strip");
  assert.ok(!present(.245, .245), "the outside corner is a square miter rather than a physical radius");
  material.dispose();
  for (const g of parts) g.dispose();
});
