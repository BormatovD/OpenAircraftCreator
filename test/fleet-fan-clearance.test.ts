import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { A320CEO, A320NEO } from "../src/aircraft/a320.ts";
import { B737_300 } from "../src/aircraft/b737.ts";
import { B737_8 } from "../src/aircraft/b737max.ts";
import { TU214_PS90A } from "../src/aircraft/tu214.ts";
import { applyDefinition, bypassRatio } from "../src/levers.ts";
import { buildAircraft } from "../web/scene/aircraft.ts";

const cases = [
  ["CFM56-5B / A320ceo", A320CEO],
  ["CFM56-3B2 / 737-300", B737_300],
  ["LEAP-1A / A320neo", A320NEO],
  ["LEAP-1B / 737-8", B737_8],
  ["PS-90A / Tu-214", TU214_PS90A],
] as const;

test("installed fan tips clear the actual inlet/lip meshes at BPR 4, stock, and 15", () => {
  for (const [name, base] of cases) {
    for (const bpr of [4, base.engine.bypassRatio, 15]) {
      const def = bpr === base.engine.bypassRatio ? base : applyDefinition(base, [bypassRatio(bpr)]);
      const model = buildAircraft(def);
      model.root.updateMatrixWorld(true);
      const fans = model.parts.get("engines")!.group.children.filter((mesh): mesh is THREE.Mesh =>
        mesh instanceof THREE.Mesh && mesh.userData.tone === "fanBlade");
      const lips = model.parts.get("nacelles")!.group.children.filter((mesh): mesh is THREE.Mesh => mesh instanceof THREE.Mesh &&
        (mesh.geometry.name.includes("inlet") || mesh.geometry.name.includes("lip")) &&
        (mesh.userData.side === -1 || mesh.userData.side === 1));
      assert.ok(fans.length >= 2, `${name}, BPR ${bpr}: expected installed fan meshes on both sides`);
      assert.ok(lips.length >= 2, `${name}, BPR ${bpr}: expected actual inlet/lip meshes on both sides`);
      for (const lip of lips) {
        lip.material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
        lip.updateMatrixWorld(true);
      }

      const seenSides = new Set<number>();
      for (const fan of fans) {
        const side = fan.userData.side as number;
        assert.ok(side === -1 || side === 1, `${name}, BPR ${bpr}: fan side metadata missing`);
        seenSides.add(side);
        const sideLips = lips.filter(lip => lip.userData.side === side);
        assert.ok(sideLips.length > 0, `${name}, BPR ${bpr}, side ${side}: no corresponding inlet/lip mesh`);

        const axis = fan.getWorldPosition(new THREE.Vector3());
        const position = fan.geometry.getAttribute("position");
        const radius = def.engine.fanDiameterM / 2;
        const origin = new THREE.Vector3(), direction = new THREE.Vector3(), point = new THREE.Vector3();
        const raycaster = new THREE.Raycaster();
        raycaster.near = 0;
        raycaster.far = radius * 2.2;
        let tested = 0, misses = 0, collisions = 0, minimumGap = Infinity;

        for (let i = 0; i < position.count; i++) {
          point.fromBufferAttribute(position, i).applyMatrix4(fan.matrixWorld);
          const dy = point.y - axis.y, dz = point.z - axis.z;
          const radial = Math.hypot(dy, dz);
          if (radial < .95 * radius) continue;
          tested++;
          origin.set(point.x, axis.y, axis.z);
          direction.set(0, dy / radial, dz / radial);
          raycaster.set(origin, direction);
          const intersections = raycaster.intersectObjects(sideLips, false);
          if (intersections.length === 0) { misses++; continue; }
          const gap = intersections[0].distance - radial;
          minimumGap = Math.min(minimumGap, gap);
          if (gap <= 1e-5) collisions++;
        }

        assert.ok(tested > 0, `${name}, BPR ${bpr}, side ${side}: no fan-tip vertices tested`);
        assert.equal(misses, 0, `${name}, BPR ${bpr}, side ${side}: some tip rays missed the inlet/lip surface`);
        assert.equal(collisions, 0, `${name}, BPR ${bpr}, side ${side}: fan tips intersect the inlet/lip`);
        assert.ok(Number.isFinite(minimumGap) && minimumGap > 0,
          `${name}, BPR ${bpr}, side ${side}: expected positive radial clearance`);
      }
      assert.deepEqual([...seenSides].sort(), [-1, 1], `${name}, BPR ${bpr}: both mounted sides must be checked`);
      model.root.traverse(object => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          if (object.material instanceof THREE.Material) object.material.dispose();
        }
      });
    }
  }
});
