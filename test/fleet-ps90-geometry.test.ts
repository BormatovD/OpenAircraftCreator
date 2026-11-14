import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { ps90a } from "../web/scene/fleetPs90.ts";
import { applyReverserMotion } from "../web/scene/reverser757.ts";

test("PS-90A Tu-214 cascade window and blockers move at 0/50/100 percent on both sides", () => {
  const kx = 5.7 / ps90a.referenceLength;
  const kr = 2.36 / (2 * ps90a.radius);
  const parts = ps90a.nacelle(kx,kr);
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const travel = .42 * kx; // explicitly schematic, not a cited maintenance stroke
  const xWindow = (2.55 + .25 * .42) * kx;
  const cascadeParts = parts.filter(p => p.geometry.userData.reverserMotion?.role === "cascade");
  assert.equal(cascadeParts.length,6,"the six source grid assemblies must be six fixed meshes");
  assert.ok(cascadeParts.every(p => p.geometry.getAttribute("position").count > 0));
  const blockerParts = parts.filter(p => p.geometry.userData.reverserMotion?.role === "blocker");
  assert.equal(blockerParts.length,36,"18 linked units should each have two leaf meshes");
  const links = new Map<number,typeof blockerParts>();
  for (const part of blockerParts) {
    const index = part.geometry.userData.linkIndex as number;
    links.set(index,[...(links.get(index) ?? []),part]);
    assert.ok(part.geometry.getAttribute("position").count > 0);
    part.geometry.computeBoundingBox();
  }
  assert.equal(links.size,18);
  for (const [index,leaves] of links) {
    assert.equal(leaves.length,2,`link ${index} must have two leaf meshes`);
    assert.deepEqual(leaves.map(p=>p.geometry.userData.leaf).sort(),["large","small"]);
    const sorted = [...leaves].sort((a,b)=>a.geometry.boundingBox!.min.x-b.geometry.boundingBox!.min.x);
    const gap = sorted[1].geometry.boundingBox!.min.x - sorted[0].geometry.boundingBox!.max.x;
    assert.ok(Math.abs(gap - .008*kx) < 1e-6,`link ${index} seam should remain visible`);
  }

  for (const side of [-1,1] as const) {
    const origin = new THREE.Vector3(14.25,-2.84,side * 6.52);
    const meshes = parts.filter(p => p.id === "reverser").map(p => {
      const geometry = p.geometry.clone().translate(origin.x,origin.y,origin.z);
      return new THREE.Mesh(geometry,material);
    });
    const sleeves = meshes.filter(m => m.geometry.userData.reverserMotion?.role === "sleeve");
    const blockers = meshes.filter(m => m.geometry.userData.reverserMotion?.role === "blocker");
    const cascades = meshes.filter(m => m.geometry.userData.reverserMotion?.role === "cascade");
    assert.equal(cascades.length,6);
    assert.equal(sleeves.length,5);
    assert.equal(sleeves.filter(m => m.geometry.name.includes("forward")).length,2);
    assert.equal(sleeves.filter(m => m.geometry.name.includes("aft")).length,2);
    assert.ok(sleeves.some(m => m.geometry.name.endsWith("lower")));
    assert.equal(blockers.length,36);

    for (const fraction of [0,.5,1]) {
      for (const mesh of meshes) {
        applyReverserMotion(mesh,fraction,origin);
        mesh.updateMatrixWorld(true);
      }
      const ray = new THREE.Raycaster(new THREE.Vector3(origin.x+xWindow,origin.y,origin.z+side*2),
        new THREE.Vector3(0,0,-side));
      const sleeveHits = ray.intersectObjects(sleeves).length;
      const cascadeHits = ray.intersectObjects(cascades).length;
      assert.ok(cascadeHits > 0, `cascade should remain in the exposed window at ${fraction*100}% side ${side}`);
      assert.equal(sleeveHits > 0,fraction === 0,
        `only the stowed sleeve closes the sampled window; fraction=${fraction}, side=${side}`);
      if (fraction === 0) {
        assert.ok(blockers.every(m => m.quaternion.angleTo(new THREE.Quaternion()) < 1e-9));
      } else {
        assert.ok(blockers.every(m => m.quaternion.angleTo(new THREE.Quaternion()) > 0.1));
        assert.ok(sleeves.every(m => Math.abs(m.position.x-travel*fraction) < 1e-8));
      }
    }
    meshes.forEach(m => m.geometry.dispose());
  }
  parts.forEach(p => p.geometry.dispose());
  material.dispose();
});

test("PS-90A cutaway preserves 12 flame tubes, 12 injectors and a connected mixing neck", () => {
  const L = 4.964 / 1.1;
  const rc = .95 * Math.sqrt(1.6 / (1+4.4));
  const chamber = ps90a.combustor(L,rc);
  assert.equal(ps90a.injectorCount,12);
  assert.equal(chamber.find(p => p.label?.includes("flame-tubes"))?.geometry.userData.componentCount,12);
  assert.equal(chamber.find(p => p.label?.includes("injectors"))?.geometry.userData.componentCount,12);

  const lengthK = 1, radiusK = 2.36 / (2 * ps90a.radius);
  const spinnerX = ps90a.fanFaceX * lengthK - .1 * L;
  const exhaust = ps90a.exhaust(L,rc,{spinnerX,lengthK,radiusK});
  const neck = exhaust.find(p => p.label === "PS-90A-mixing-duct")!;
  neck.geometry.computeBoundingBox();
  assert.ok(neck.geometry.boundingBox!.min.x <= .86 * L + 1e-6);
  assert.ok(neck.geometry.boundingBox!.max.x >= .94 * L - 1e-6);
  const all = exhaust.map(p => p.geometry);
  all.forEach(g => g.computeBoundingBox());
  const bounds = all.reduce((box,g) => box.union(g.boundingBox!),new THREE.Box3());
  assert.ok(Math.abs(bounds.max.x - 4.964) < .01,
    `Tu-214 common exhaust tip should preserve the scene's 4.964 m datum; got ${bounds.max.x}`);
  chamber.forEach(p => p.geometry.dispose());
  exhaust.forEach(p => p.geometry.dispose());
});
