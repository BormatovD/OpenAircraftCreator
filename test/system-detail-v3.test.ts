import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { avionicsRack, electricalBay, hydraulicBay, fuelDetails, engineAccessories } from "../web/scene/systemDetails.ts";
import { finishForTone, technicalRelief } from "../web/scene/technicalFinish.ts";
import { type SurfaceShape } from "../web/scene/shapes.ts";

const wing = (side: 1|-1): SurfaceShape => ({
  root: new THREE.Vector3(14, -1.1, 0), rootChordM: 7.4, tipChordM: 1.8,
  semiSpanM: 20.9, leadingEdgeSweepDeg: 29, dihedralDeg: 4,
  thicknessRoot: .14, thicknessTip: .09, side,
});

test("release v1: internal ATA components stay finite and merged by material", () => {
  for (const geoms of [avionicsRack(3), electricalBay(5), hydraulicBay(15), fuelDetails(wing, 14), engineAccessories(4.5,.65)]) {
    assert.ok(geoms.length >= 2 && geoms.length < 30, "material batches stay bounded");
    for (const g of geoms) {
      const p = g.getAttribute("position");
      assert.ok(p && p.count > 12, "visible geometry");
      assert.match(g.userData.tone, /^detail/, "retains mass-tree tone");
      for (let i = 0; i < p.count; i++) {
        assert.ok(Number.isFinite(p.getX(i) + p.getY(i) + p.getZ(i)), "finite vertex");
      }
      g.computeBoundingBox();
      assert.ok(g.boundingBox && !g.boundingBox.isEmpty(), "non-degenerate component");
      g.dispose();
    }
  }
});

test("release v1: micro-relief is cached, tiny and never substituted for geometry", () => {
  for (const pattern of ["machined", "cabinet", "hoses"] as const) {
    const a = technicalRelief(pattern);
    assert.equal(a, technicalRelief(pattern));
    assert.equal(a.image.width, 128);
    assert.equal(a.image.height, 128);
    assert.equal(a.userData.cached, true);
  }
  assert.equal(finishForTone("glass"), null);
  assert.equal(finishForTone("detailSteel"), "machined");
});
