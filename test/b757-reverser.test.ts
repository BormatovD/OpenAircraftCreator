import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { B757_PW2037, B757_RB211 } from "../src/aircraft/b757.ts";
import { applyReverserMotion, nacelleSegments, nacelleStyleFor } from "../web/scene/shapes.ts";
import { max757Raise, max757ReversePercent } from "../web/scene/aircraft.ts";

test("757 reverser opens the cascade window, keeps the exhaust fixed and returns to its datum", () => {
  const identity = new THREE.Matrix4();
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  for (const style of ["rb211", "pw2037"] as const) {
    const origin = new THREE.Vector3(18, -2, -6);
    const parts = nacelleSegments(style, 1, 1);
    const meshes = parts.map(p => new THREE.Mesh(p.geometry.translate(origin.x, origin.y, origin.z), material));
    const sleeves = meshes.filter(m => m.geometry.userData.reverserMotion?.role === "sleeve");
    const doors = meshes.filter(m => m.geometry.userData.reverserMotion?.role === "blocker");
    const cascade = meshes.find(m => m.geometry.userData.reverserMotion?.role === "cascade")!;
    const nozzle = meshes[parts.findIndex(p => p.id === "nozzle")]!;
    assert.equal(sleeves.length, 2);
    if (style === "pw2037") assert.equal(doors.length, 12);
    assert.ok(doors.length > 0);
    cascade.geometry.computeBoundingBox();
    const centre = cascade.geometry.boundingBox!.getCenter(new THREE.Vector3());
    const ray = new THREE.Raycaster(new THREE.Vector3(centre.x, origin.y, origin.z + 2), new THREE.Vector3(0, 0, -1));
    for (const fraction of [0, .5, 1, .5, 0]) {
      for (const m of meshes) {
        applyReverserMotion(m, fraction, origin);
        m.updateMatrixWorld();
      }
      assert.ok(nozzle.matrix.equals(identity) && cascade.matrix.equals(identity));
      if (fraction === 0) {
        assert.ok(meshes.every(m => m.matrix.equals(identity)));
        assert.ok(ray.intersectObjects(sleeves).length > 0);
      } else {
        assert.ok(doors.every(m => m.quaternion.angleTo(new THREE.Quaternion()) > 0));
        assert.ok(sleeves.every(m => m.position.x > 0 && !m.position.y && !m.position.z));
        for (const door of doors) {
          const hinge = new THREE.Vector3().fromArray(door.geometry.userData.reverserMotion.pivot).add(origin);
          const moved = hinge.clone().applyMatrix4(door.matrix);
          assert.ok(moved.distanceTo(hinge.add(sleeves[0].position)) < 1e-6);
        }
        if (fraction === 1) assert.equal(ray.intersectObjects(sleeves).length, 0);
      }
    }
    meshes.forEach(m => m.geometry.dispose());
  }
  material.dispose();
});

test("757 reverser travel is available at the reference mount and limited at the raised mount", () => {
  for (const def of [B757_RB211, B757_PW2037]) {
    assert.equal(max757ReversePercent(def), 100);
    assert.equal(nacelleStyleFor({ ...def.engine, bypassRatio: 12 }), def.engine.nacelleProfile);
    assert.equal(nacelleStyleFor({ ...def.engine, nacelleProfile: undefined, bypassRatio: 12 }), def.engine.nacelleProfile);
    const raise = Math.floor(max757Raise(def) * 100) / 100;
    const raised = { ...def, engine: { ...def.engine, nacelleRaiseM: raise } };
    const allowed = max757ReversePercent(raised);
    assert.ok(allowed >= 0 && allowed < 100);
    assert.ok(max757Raise(raised, allowed / 100) >= raise);
    assert.ok(max757Raise(raised, (allowed + 1) / 100) < raise);
  }
});
