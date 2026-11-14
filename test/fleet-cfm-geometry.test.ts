import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { cfm5b, cfm3b2 } from "../web/scene/fleetCfm.ts";
import { applyReverserMotion } from "../web/scene/reverser757.ts";

const near = (a: number, b: number, tolerance = 1e-5) => assert.ok(Math.abs(a - b) <= tolerance, `${a} ≠ ${b}`);

test("CFM: independent separate-flow profiles preserve fan circles and fixed primary nozzles", () => {
  for (const pkg of [cfm5b, cfm3b2]) {
    const parts = pkg.nacelle(1, 1), bounds = new THREE.Box3();
    for (const p of parts) { p.geometry.computeBoundingBox(); bounds.union(p.geometry.boundingBox!); }
    near(bounds.min.x, 0); near(bounds.max.x, pkg.referenceLength);
    near(bounds.max.z - bounds.min.z, pkg.radius * 2, .001);
    const nozzle = parts.find(p => p.id === "nozzle")!;
    const sleeve = parts.find(p => p.geometry.userData.reverserMotion?.role === (pkg === cfm5b ? "blocker" : "sleeve"))!;
    assert.ok(sleeve.geometry.boundingBox!.max.x < nozzle.geometry.boundingBox!.min.x);
    assert.equal(nozzle.geometry.userData.reverserMotion, undefined);
    if (pkg === cfm3b2) {
      assert.ok(bounds.min.y > -.84 && bounds.max.y > 1.02, "Classic lower cowl is flattened");
      near(bounds.min.y, -.781, .0001);
      const lip = parts.find(p => p.id === "lip")!.geometry.getAttribute("position");
      const fanFaceRadii: number[] = [];
      for (let i = 0; i < lip.count; i++) if (Math.abs(lip.getX(i) - pkg.fanFaceX) < 1e-5)
        fanFaceRadii.push(Math.hypot(lip.getY(i), lip.getZ(i)));
      assert.ok(fanFaceRadii.length > 16);
      fanFaceRadii.forEach(r => near(r, .76));
    }
    parts.forEach(p => p.geometry.dispose());
  }
});

test("CFM: A320 four pivot doors differ from Classic translating cascade reverser", () => {
  for (const [pkg, style] of [[cfm5b, "cfm5b"], [cfm3b2, "cfm3b2"]] as const) {
    const parts = pkg.nacelle(1, 1);
    const motion = parts.map(p => p.geometry.userData.reverserMotion).filter(Boolean);
    assert.ok(motion.every(m => m.style === style));
    if (pkg === cfm5b) {
      assert.equal(motion.filter(m => m.role === "blocker").length, 4);
      assert.equal(motion.filter(m => m.role === "sleeve" || m.role === "cascade").length, 0);
      assert.ok(motion.every(m => m.slide.every((n: number) => n === 0)));
    } else {
      assert.equal(motion.filter(m => m.role === "sleeve").length, 2);
      assert.equal(motion.filter(m => m.role === "blocker").length, 10);
      assert.ok(motion.some(m => m.role === "cascade"));
      assert.ok(motion.filter(m => m.role === "blocker").every(m => m.slide[0] > 0));
    }
    parts.forEach(p => p.geometry.dispose());
  }
});

test("CFM: deployed openings have no remaining wall across the fan discharge", () => {
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  for (const pkg of [cfm5b, cfm3b2]) {
    const parts = pkg.nacelle(1, 1), meshes = parts.map(p => new THREE.Mesh(p.geometry, material));
    const theta = pkg === cfm5b ? Math.PI / 4 : Math.PI / 2;
    const ray = new THREE.Raycaster(new THREE.Vector3(pkg === cfm5b ? 2.40 : 2.18, .7 * Math.cos(theta), .7 * Math.sin(theta)),
      new THREE.Vector3(0, Math.cos(theta), Math.sin(theta)), 0, 2);
    meshes.forEach(m => m.updateMatrixWorld(true));
    assert.ok(ray.intersectObjects(meshes).length > 0, "stowed shell closes discharge");
    meshes.forEach(m => { applyReverserMotion(m, 1, new THREE.Vector3()); m.updateMatrixWorld(true); });
    const walls = meshes.filter(m => !["cascade", "blocker"].includes(m.geometry.userData.reverserMotion?.role) || pkg === cfm5b);
    assert.equal(ray.intersectObjects(walls).length, 0, "deployed door/sleeve really uncovers a hole");
    parts.forEach(p => p.geometry.dispose());
  }
  material.dispose();
});

test("CFM: both installed sides scale, clear the core, and return exactly to stowed", () => {
  const p = new THREE.Vector3();
  for (const pkg of [cfm5b, cfm3b2]) for (const scale of [1, 1.55]) for (const side of [-1, 1]) {
    const parts = pkg.nacelle(scale, scale), origin = new THREE.Vector3(11.76, -1.8, side * 5.75);
    for (const part of parts) {
      part.geometry.translate(origin.x, origin.y, origin.z);
      const mesh = new THREE.Mesh(part.geometry), motion = part.geometry.userData.reverserMotion;
      for (const f of [0, .25, .5, .75, 1, 0]) {
        applyReverserMotion(mesh, f, origin); mesh.updateMatrixWorld(true);
        const position = part.geometry.getAttribute("position");
        for (let i = 0; i < position.count; i++) {
          p.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld).sub(origin).divideScalar(scale);
          assert.ok(p.toArray().every(Number.isFinite));
          if (motion?.role === "blocker" && pkg === cfm3b2) assert.ok(Math.hypot(p.y, p.z) >= .6599);
          if (motion?.role === "blocker" && pkg === cfm5b && p.x >= 2.75 && p.x <= 3.75)
            assert.ok(Math.hypot(p.y, p.z) > .62 - .12 * (p.x - 2.75), "pivot door stays outside the core cowl");
        }
      }
      near(mesh.position.length(), 0); near(mesh.quaternion.angleTo(new THREE.Quaternion()), 0);
      part.geometry.dispose();
    }
  }
});

test("CFM: SAC injector row contains twenty separate circumferential positions", () => {
  for (const pkg of [cfm5b, cfm3b2]) {
    const pieces = pkg.combustor(3, .45), injectors = pieces.find(p => p.geometry.name.endsWith("injectors"))!;
    assert.equal(pkg.injectorCount, 20);
    const positions = injectors.geometry.getAttribute("position"), sectors = new Set<number>();
    for (let i = 0; i < positions.count; i++) {
      const angle = Math.atan2(positions.getZ(i), positions.getY(i));
      sectors.add((Math.round(angle * 20 / (2 * Math.PI)) + 20) % 20);
    }
    assert.equal(sectors.size, 20);
    assert.equal(injectors.spin, null);
    pieces.forEach(p => p.geometry.dispose());
  }
});

test("CFM: spinner-local exhaust joins the fixed primary nozzle and separate centrebody tip", () => {
  for (const pkg of [cfm5b, cfm3b2]) for (const scale of [1, 1.5]) {
    const classic = pkg === cfm3b2, L = (classic ? 1.52 : 1.73) * 1.7 * scale;
    const spinnerX = pkg.fanFaceX * scale - .14 * L;
    const parts = pkg.nacelle(scale, scale), pieces = pkg.exhaust(L, .45 * scale, { spinnerX, lengthK: scale, radiusK: scale });
    const bounds = (geometry: THREE.BufferGeometry) => { geometry.computeBoundingBox(); return geometry.boundingBox!; };
    const duct = pieces.find(p => p.geometry.name.endsWith("primary-exhaust-duct"))!;
    const centrebody = pieces.find(p => p.geometry.name.endsWith("exhaust-centrebody"))!;
    const nozzle = parts.find(p => p.id === "nozzle")!, plug = parts.find(p => p.id === "plug")!;
    near(bounds(duct.geometry).max.x + spinnerX, bounds(nozzle.geometry).min.x);
    near(bounds(centrebody.geometry).max.x + spinnerX, bounds(plug.geometry).min.x);
    if (classic) assert.ok(bounds(plug.geometry).max.x > bounds(nozzle.geometry).max.x, "Classic centrebody protrudes past hot nozzle");
    pieces.forEach(p => { assert.equal(p.spin, null); p.geometry.dispose(); });
    parts.forEach(p => p.geometry.dispose());
  }
});
