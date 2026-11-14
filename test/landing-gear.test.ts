import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { AIRCRAFT } from "../web/aircraftCatalog.ts";
import { buildAircraft } from "../web/scene/aircraft.ts";
import { applyGearBracePose } from "../web/scene/landingGear.ts";

const close = (value: number, target: number, tol = 1e-4) =>
  assert.ok(Math.abs(value - target) < tol, `${value} differs from ${target}`);

// Published parked footprints. Tests read the installed tyre surfaces including
// pivots and instructions for fuselage barrel inserts, rather than input tables.
const wheelbases: Record<string, number> = {
  a319ceo: 11.039, a319neo: 11.039, a320ceo: 12.64, a320neo: 12.64,
  a321ceo: 16.906, a321neo: 16.906, "b737-300": 12.45, "b737-800": 15.60,
  "b737-8": 15.60, "b757-200-rb": 18.29, "b757-200-pw": 18.29,
  "tu214-ps90a": 16.967, "tu214-ps90a-factory": 16.967,
};

test("assembled nose and main tyres touch the pavement at the variant footprint", () => {
  for (const [id, base] of Object.entries(AIRCRAFT)) {
    const model = buildAircraft(base);
    const stations: number[] = [];
    for (const gear of ["gear.nose", "gear.main"]) {
      const pieces = model.parts.get(gear)!.group.children as THREE.Mesh[];
      const wheels = pieces.filter(m => m.geometry.name === "tyre");
      const count = gear === "gear.main" ? base.gear.mainWheels : base.gear.noseWheels;
      assert.equal(wheels.length, count, id);
      assert.equal(pieces.filter(m => m.geometry.name === "wheel-brake").length, gear === "gear.main" ? count : 0, id);
      const boxes = wheels.map(m => new THREE.Box3().setFromObject(m, true));
      const meanX = boxes.reduce((sum, b) => sum + (b.min.x + b.max.x) / 2, 0) / count;
      stations.push(meanX);
      for (const b of boxes) close(b.min.y, model.groundY);
      for (let i = 0; i < count; i++)for (let j = i + 1; j < count; j++)assert.ok(!boxes[i].intersectsBox(boxes[j]), id);
      if (gear === "gear.main" && id === "tu214-ps90a") {
        const fore = boxes.find(b => b.max.x < meanX)!, aft = boxes.find(b => b.min.x > meanX)!;
        close(aft.min.x - fore.max.x, .2);
      }
    }
    close(stations[1] - stations[0], wheelbases[id]);
    model.root.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
  }
});

test("rigid stay halves retain contact at the upper pin, knee and retracting leg throughout travel", () => {
  const a = new THREE.Vector3(), b = a.clone(), target = a.clone();
  for (const id of ["a320ceo", "b737-300", "b737-8", "b757-200-pw", "tu214-ps90a"]) {
    const m = buildAircraft(AIRCRAFT[id]);
    for (const part of ["gear.main", "gear.nose"]) {
      const meshes = m.parts.get(part)!.group.children as THREE.Mesh[];
      for (const up of meshes.filter(p => p.geometry.name === "upper-stay")) {
        const lo = meshes.find(p => p.geometry.name === "lower-stay" && p.userData.side === up.userData.side)!;
        const strut = meshes.find(p => p.geometry.name.endsWith("-strut") && p.userData.side === up.userData.side)!;
        const { anchor, downElbow, pin } = up.geometry.userData.gearBrace;
        for (const f of [0, .1, .25, .42, .68, .85, 1, .5, 0]) {
          for (const link of [up, lo]) {
            link.position.copy(link.userData.basePos);
            applyGearBracePose(link, f);
            link.updateMatrix();
          }
          strut.rotation[strut.userData.retract.axis as "x" | "z"] = f * strut.userData.retract.angle;
          strut.updateMatrix();
          a.copy(downElbow).applyMatrix4(up.matrix);
          b.copy(downElbow).applyMatrix4(lo.matrix);
          close(a.distanceTo(b), 0);
          a.copy(anchor).applyMatrix4(up.matrix);
          close(a.distanceTo(target.copy(anchor).add(up.userData.basePos)), 0);
          a.copy(pin).applyMatrix4(lo.matrix);
          close(a.distanceTo(target.copy(pin).applyMatrix4(strut.matrix)), 0);
        }
      }
    }
    m.root.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
  }
});
