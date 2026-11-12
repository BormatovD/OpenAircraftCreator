import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { airConditioningPacks, avionicsRack, electricalBay, engineAccessories, fuelDetails, hydraulicBay } from "../web/scene/systemDetails.ts";

test("detailed system assemblies remain finite and grouped by material", () => {
  const wing = (side: 1 | -1): import("../web/scene/shapes.ts").SurfaceShape => ({
    root: new THREE.Vector3(13.7, -1.15, 0), rootChordM: 7.5, tipChordM: 1.8,
    semiSpanM: 20.9, leadingEdgeSweepDeg: 32, dihedralDeg: 4,
    thicknessRoot: .145, thicknessTip: .095, side,
  });
  const systems = [
    avionicsRack(2.95), electricalBay(5.4), hydraulicBay(16.5),
    airConditioningPacks(14.7), fuelDetails(wing, 13.7), engineAccessories(4.9,.58),
  ];
  for (const geoms of systems) {
    assert.ok(geoms.length >= 2 && geoms.length < 40, `merged mesh count ${geoms.length}`);
    for (const g of geoms) {
      const pos = g.getAttribute("position");
      assert.ok(pos && pos.count > 10);
      for (const n of pos.array) assert.ok(Number.isFinite(n));
      assert.match(g.userData.tone, /^detail/);
      g.dispose();
    }
  }
});
