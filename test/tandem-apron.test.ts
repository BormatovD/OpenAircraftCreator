import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { AIRCRAFT } from "../web/aircraftCatalog.ts";
import { mainDoors } from "../web/scene/gearBay.ts";
import { useShapes } from "../web/scene/shapeSet.ts";

for (const id of ["b757-200-pw", "b757-200-rb", "tu214-ps90a", "tu214-ps90a-factory"] as const) {
  test(`${id}: fixed apron has round corners, shared smooth normals and a flush supported feather`, () => {
    const shape = useShapes(AIRCRAFT[id]), gear = shape.gear;
    const lower = (x: number, z: number) => -.9 + .025 * x + .04 * z;
    const skin = { lower, roof: () => 10, trailingEdge: () => 100 };
    const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    for (const side of [-1, 1] as const) {
      const parts = mainDoors(shape.id, gear, side, new THREE.Vector3(0, -.2, side * gear.mainZ), lower, -4, skin);
      const apron = parts.find(g => g.name === "main-well-sill")!;
      assert.equal(apron.userData.smoothApron, true);
      assert.equal(apron.userData.fixedWingBody, true);
      assert.equal(apron.userData.gearDoor, undefined);
      assert.equal(apron.userData.retract, undefined);
      assert.ok(apron.index, "surface vertices must be shared across the clipped cells");
      const p = apron.getAttribute("position"), n = apron.getAttribute("normal"), ix = apron.index!;
      const a = new THREE.Vector3(), b = a.clone(), c = a.clone(), normal = a.clone();
      for (let i = 0; i < p.count; i++) {
        assert.ok(n.getY(i) < 0, "the fixed underside normal points into the airframe");
        assert.ok(Math.abs(normal.fromBufferAttribute(n, i).length() - 1) < 1e-6);
        assert.ok(p.getY(i) <= lower(p.getX(i), Math.abs(p.getZ(i))) - .004 + 1e-6,
          "apron penetrates its supporting skin");
        assert.ok(side * p.getZ(i) > 0, "apron crosses the centre seam");
      }
      for (let i = 0; i < ix.count; i += 3) {
        a.fromBufferAttribute(p, ix.getX(i)); b.fromBufferAttribute(p, ix.getX(i + 1)); c.fromBufferAttribute(p, ix.getX(i + 2));
        normal.copy(b).sub(a).cross(c.clone().sub(a));
        assert.ok(normal.y < -5e-9, "a miter fan or float-resolution sliver remains");
      }
      const mesh = new THREE.Mesh(apron, material); mesh.updateMatrixWorld(true);
      const reach = (gear.axleSpacingM ?? 1) / 2 + gear.mainR + .22, edge = shape.id === "b757" ? 1.65 : 1.73;
      const present = (dx: number, dz: number) => new THREE.Raycaster(
        new THREE.Vector3(reach + .012 + dx, -10, side * (edge + .012 + dz)),
        new THREE.Vector3(0, 1, 0)).intersectObject(mesh).length > 0;
      assert.ok(present(.20, .20), "rounded feather is missing beyond the old rectangular strip");
      assert.ok(!present(.23, .23), "the outer corner is still a square miter");
      for (const door of parts.filter(g => g.userData.bayOpening)) {
        assert.ok(door.userData.doorGrid.nx >= 24, "the compound closed face remains visibly faceted");
      }
      parts.forEach(g => g.dispose());
    }
    material.dispose();
  });
}
