import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { AIRCRAFT } from "../web/aircraftCatalog.ts";
import { buildAircraft } from "../web/scene/aircraft.ts";
import { pylonFor } from "../web/scene/pylonPackages.ts";
import { nacelleSegments, nacelleStyleFor } from "../web/scene/shapes.ts";

test("installed suspension and service cowls follow each engine on both wings", () => {
  for (const [id, def] of Object.entries(AIRCRAFT)) {
    const style = nacelleStyleFor(def.engine);
    const spec = pylonFor(style);
    if (id === "b737-800") {
      assert.equal(style, "cfm56-7b");
      assert.equal(spec, undefined);
      continue;
    }
    assert.ok(spec, id);
    const model = buildAircraft(def);
    const n = model.parts.get("nacelles")!.group.children as THREE.Mesh[];
    for (const side of [-1, 1]) {
      const parts = n.filter(m => m.userData.side === side);
      const role = (name: string) => parts.filter(m => m.geometry.userData.installationRole === name);
      const doors = role("cowlDoor");
      assert.ok(role("fairing").every(m => m.visible));
      assert.ok([...role("beam"), ...role("frontMount"), ...role("rearMount"), ...role("thrustLinks")].every(m => !m.visible));
      const expectedDoors = style === "ps90a" ? 0 : style === "pw2037" ? 4 : 2;
      assert.equal(doors.length, expectedDoors, id);
      for (const m of doors) assert.ok(m.geometry.index!.count > 0);
      for (const r of ["fairing", "beam", "frontMount", "rearMount"]) assert.equal(role(r).length, 1, id);
      assert.equal(role("middleMount").length, style === "ps90a" ? 1 : 0, id);
      assert.equal(role("thrustLinks").length, style === "rb211" ? 0 : 1, id);
      assert.equal(role("wingAttachment").length, spec.wingAttachment ? 1 : 0, id);
      for (const m of [...role("frontMount"), ...role("rearMount"), ...role("wingAttachment"), ...doors]) {
        m.geometry.computeBoundingBox();
        const b = m.geometry.boundingBox!;
        assert.ok(Number.isFinite(b.min.x + b.max.x + b.min.y + b.max.y + b.min.z + b.max.z));
        assert.ok(b.max.x > b.min.x && b.max.y > b.min.y && b.max.z > b.min.z);
        assert.equal(m.geometry.userData.reverserMotion, undefined);
      }
    }
    // Latches and hinges belong to their own fixed service panel. A station
    // projected onto the radius of a different casing can float in mid-air.
    const segments = nacelleSegments(style, 1, 1);
    for (const [section, stations] of [
      ["fanCowl", [...spec.hingeStations, ...spec.latchStations]],
      ["coreCowl", [...(spec.coreHingeStations ?? []), ...(spec.coreLatchStations ?? [])]],
    ] as const) {
      if (!stations.length) continue;
      const geometry = segments.find(s => s.id === section)!.geometry;
      geometry.computeBoundingBox();
      for (const x of stations) assert.ok(x > geometry.boundingBox!.min.x && x < geometry.boundingBox!.max.x, id + " " + section + " " + x);
    }
    segments.forEach(s => s.geometry.dispose());
    model.root.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
  }
});
