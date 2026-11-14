import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { AIRCRAFT } from "../web/aircraftCatalog.ts";
import { buildAircraft } from "../web/scene/aircraft.ts";

for (const id of Object.keys(AIRCRAFT)) {
  test(id + ": separate root panels cover the clean wing and the aft edge of the wheel well", () => {
    const model = buildAircraft(AIRCRAFT[id]);
    const body = model.parts.get("fuselage")!.group.children as THREE.Mesh[];
    const wing = model.parts.get("wing.box")!.group.children as THREE.Mesh[];
    const wells = (model.parts.get("gear.main")!.group.children as THREE.Mesh[]).filter(m => m.geometry.userData.gearWell);
    const fairings = body.filter(m => m.geometry.name === "wing-root-fairing");
    assert.equal(fairings.length, 2);
    const exterior = [body[0], ...fairings, ...wing];
    const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    for (const m of [...exterior, ...wells]) m.material = material;
    const ray = new THREE.Raycaster();
    const leg = model.parts.get("gear.main")!.group.children.find(o => (o as THREE.Mesh).geometry.name === "main-strut")!;
    const pivotX = (leg.userData.basePos as THREE.Vector3).x;
    for (const side of [-1, 1]) {
      const fairing = fairings.find(m => m.geometry.userData.side === side)!;
      assert.ok(fairing.geometry.userData.fixedWingBody && fairing.geometry.userData.bellyPaint);
      assert.equal(fairing.geometry.userData.retract, undefined);
      // Measure over the main bay on this specific planform. The clean wing
      // can have a cut under the fairing, so check the upper skin that is there.
      const sideZ = AIRCRAFT[id].fuselage.widthM / 2;
      ray.set(new THREE.Vector3(pivotX, 2, side * (sideZ + .10)), new THREE.Vector3(0, -1, 0));
      const top = ray.intersectObject(fairing)[0], cleanWing = ray.intersectObjects(wing)[0];
      assert.ok(top && (!cleanWing || top.point.y > cleanWing.point.y + .035));
      let sampled = 0;
      for (let x = pivotX - .55; x <= pivotX + .85; x += .07) {
        for (let z = sideZ - .18; z < sideZ + .46; z += .04) {
          ray.set(new THREE.Vector3(x, 3, side * z), new THREE.Vector3(0, -1, 0));
          const liner = ray.intersectObjects(wells)[0];
          if (!liner) continue;
          const skin = ray.intersectObjects(exterior)[0];
          assert.ok(skin && skin.distance + .002 < liner.distance,
            `wheel well visible from above, x=${x}, z=${z}`);
          sampled++;
        }
      }
      assert.ok(sampled > 40);
      if (id.startsWith("a320")) {
        // View the A320 aft jamb obliquely past the sidewall as in the original report.
        const direction = new THREE.Vector3(-.18, -.62, -side).normalize();
        let oblique = 0;
        for (let x = pivotX + .51; x < pivotX + .84; x += .035) {
          for (let y = -.76; y < -.44; y += .029) {
            ray.set(new THREE.Vector3(x, y, side * 1.93).addScaledVector(direction, -2), direction);
            const liner = ray.intersectObjects(wells)[0];
            if (!liner) continue;
            const skin = ray.intersectObjects(exterior)[0];
            assert.ok(skin && skin.distance + .005 < liner.distance, "wheel well visible through the upper fairing");
            oblique++;
          }
        }
        assert.ok(oblique > 40);
      }
    }
    material.dispose();
    model.root.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
  });
}
