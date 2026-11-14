import { test } from "node:test";
import assert from "node:assert/strict";
import { Mesh, Vector3 } from "three";
import { AIRCRAFT } from "../web/aircraftCatalog.ts";
import { buildAircraft } from "../web/scene/aircraft.ts";
import { applyHighLiftHinge } from "../web/scene/highLiftHinge.ts";

function lowerFreeEdge(mesh: Mesh) {
  const pos = mesh.geometry.getAttribute("position");
  const pivot = mesh.userData.hinge.pivot as Vector3;
  // The stowed Krueger aft edge is farthest aft in the root cross-section.
  let best = -Infinity;
  const vertex = new Vector3();
  const point = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    point.fromBufferAttribute(pos, i);
    if (Math.abs(point.z - pivot.z) < .1 && point.x > best) {
      best = point.x;
      vertex.copy(point);
    }
  }
  assert.ok(Number.isFinite(best));
  return vertex;
}

for (const [id, count] of [["b737-300", 3], ["b737-800", 4], ["b737-8", 4]] as const) {
  test(id + " leading edge deploys separate lower panels and slats on each side", () => {
    const base = AIRCRAFT[id];
    const model = buildAircraft(base);
    const group = model.parts.get("wing.highLift")!.group;
    const extension = (m: Mesh, f: number, witness: Vector3) => {
      m.position.set(0, 0, 0);
      applyHighLiftHinge(m, m.userData.hinge, f);
      m.updateMatrix();
      return witness.clone().applyMatrix4(m.matrix);
    };
    for (const side of [-1, 1]) {
      const devices = group.children.filter(m => m.userData.side === side) as Mesh[];
      const kruegers = devices.filter(m => m.geometry.name.startsWith("krueger-"));
      const slats = devices.filter(m => m.geometry.name.startsWith("slat-"));
      assert.equal(kruegers.length, 2);
      assert.equal(slats.length, count);
      const sideZ = (m: Mesh) => Math.abs(m.userData.hinge.pivot.z);
      assert.ok(Math.max(...kruegers.map(sideZ)) < Math.min(...slats.map(sideZ)));
      for (const m of kruegers) {
        const aft = lowerFreeEdge(m);
        const takeoff = extension(m, .45, aft), landing = extension(m, 1, aft);
        assert.ok(takeoff.distanceTo(landing) < 1e-7);
        assert.ok(landing.x < aft.x - .1 && landing.y < m.userData.hinge.pivot.y - .1);
        assert.ok(extension(m, .2, aft).y < aft.y - .1, "swings below the lower wing surface");
        assert.ok(extension(m, 1, m.userData.hinge.pivot).distanceTo(m.userData.hinge.pivot) < 1e-6);
        assert.ok(extension(m, 0, aft).distanceTo(aft) < 1e-6);
      }
      for (const m of slats) {
        m.geometry.computeBoundingBox();
        const witness = m.geometry.boundingBox!.getCenter(new Vector3());
        const takeoff = extension(m, .45, witness), landing = extension(m, 1, witness);
        assert.ok(landing.x < takeoff.x && takeoff.x < witness.x);
        assert.ok(landing.y < takeoff.y && takeoff.y < witness.y);
        assert.ok(extension(m, 0, witness).distanceTo(witness) < 1e-6);
      }
    }
    const disabled = buildAircraft({ ...base, wing: { ...base.wing, highLift: { ...base.wing.highLift, slats: false } } });
    for (const part of ["wing.box", "wing.highLift"])
      assert.ok(disabled.parts.get(part)!.group.children.every(m => !/^(slat-|krueger-)/.test((m as Mesh).geometry.name)));
    for (const aircraft of [model, disabled]) aircraft.root.traverse(obj => { if (obj instanceof Mesh) obj.geometry.dispose(); });
  });
}
