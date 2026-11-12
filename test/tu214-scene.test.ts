// Three.js-level smoke tests for the visual-only Tu-214 cleanup.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { TU214_PS90A } from "../src/aircraft/tu214.ts";
import { buildAircraft } from "../web/scene/aircraft.ts";

test("Ту-214: собственные загнутые законцовки без нижних вертикальных пластин", () => {
  const model = buildAircraft(TU214_PS90A);
  model.root.updateMatrixWorld(true);
  const winglets = model.parts.get("wingtips");
  assert.ok(winglets, "winglet mesh missing");
  const bound = new THREE.Box3().setFromObject(winglets.group);
  assert.ok(bound.max.y - bound.min.y > 1.6, "winglet must rise above the wing tip");
  assert.ok(bound.max.z <= TU214_PS90A.wing.spanM / 2 + 0.2, "do not silently enlarge the published span");
  assert.ok(bound.min.y > -0.6, "a lower A320-style fence must not remain");
  model.root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      const verts = o.geometry.getAttribute("position");
      for (let i = 0; i < verts.count; i++)
        for (const coord of [verts.getX(i), verts.getY(i), verts.getZ(i)]) assert.ok(Number.isFinite(coord));
    }
  });
  model.root.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
});

test("Ту-214: шесть стёкол и шесть отдельных рам без изменения других типов", () => {
  const model = buildAircraft(TU214_PS90A);
  const tones: Record<string, number> = {};
  model.parts.get("fuselage")!.group.traverse((o) => {
    if (o instanceof THREE.Mesh && o.userData.tone) {
      tones[o.userData.tone] = (tones[o.userData.tone] || 0) + 1;
      const n = o.geometry.getAttribute("normal");
      for (let i = 0; i < n.count; i++) assert.ok(Number.isFinite(n.getX(i) + n.getY(i) + n.getZ(i)));
    }
  });
  assert.equal(tones.glass, 6);
  assert.equal(tones.glassFrame, 6);
  model.root.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
});
