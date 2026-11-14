import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { applyDefinition, bypassRatio, nacelleRaise } from "../src/levers.ts";
import { AIRCRAFT } from "../web/aircraftCatalog.ts";
import { buildAircraft, installedGroundClearance, installationLimits } from "../web/scene/aircraft.ts";
import { contextFor } from "../src/aircraft/contextFor.ts";
import { evaluate } from "../src/evaluate.ts";
import { applyReverserMotion, nacelleStyleFor } from "../web/scene/shapes.ts";

const models = ["a320ceo", "b737-300", "a320neo", "b737-8", "tu214-ps90a"];

test("fleet installation remains tied to its variant when levers resize the nacelle", () => {
  for (const id of models) {
    const base = AIRCRAFT[id];
    const poses = [base, applyDefinition(base, [bypassRatio(4), nacelleRaise(.10)])].map(def => {
      const engine = def.engine;
      assert.equal(nacelleStyleFor({ ...engine, nacelleProfile: undefined }), base.engine.nacelleProfile);
      assert.equal(nacelleStyleFor(engine), base.engine.nacelleProfile);
      const model = buildAircraft(def);
      const mesh = model.parts.get("nacelles")!.group.children.find(m => m.userData.side === 1 &&
        m instanceof THREE.Mesh && m.geometry.userData.reverserOrigin) as THREE.Mesh;
      const origin = mesh.geometry.userData.reverserOrigin as THREE.Vector3;
      model.root.traverse(m => { if (m instanceof THREE.Mesh) m.geometry.dispose(); });
      return origin;
    });
    assert.equal(poses[0].x, poses[1].x, id + " longitudinal station");
    assert.equal(poses[0].z, poses[1].z, id + " lateral station");
    assert.ok(Math.abs(poses[1].y - poses[0].y - (.10 - base.engine.nacelleRaiseM)) < 1e-6);
  }
});

test("stock fleet reversers open fully and the raised Classic and MAX respect their wing clearance", () => {
  for (const id of models) assert.equal(installationLimits(AIRCRAFT[id]).reverse, 100, id);
  for (const id of ["b737-300", "b737-8"]) {
    const base = AIRCRAFT[id];
    const limit = installationLimits(base);
    const atLimit = applyDefinition(base, [nacelleRaise(Math.floor(limit.raise * 100) / 100)]);
    assert.ok(installationLimits(atLimit).reverse < 100, id);
    assert.ok(installationLimits(applyDefinition(base, [bypassRatio(15)])).raise < 0, id);
  }
});

test("installed ground and wing limits at the lever endpoints for all seven packages", () => {
  for (const [id, maxBpr] of Object.entries({
    a320ceo: 12.1, a320neo: 15, "b737-300": 9.2, "b737-8": 12.1,
    "b757-200-rb": 8.3, "b757-200-pw": 10.5, "tu214-ps90a": 15,
  })) {
    const base = AIRCRAFT[id];
    if (maxBpr < 15) {
      for (const bpr of [maxBpr + .1, 15])
        assert.ok(installationLimits(applyDefinition(base, [bypassRatio(bpr)])).raise < 0, id);
    }
    for (const bpr of [4, maxBpr]) {
      const resized = applyDefinition(base, [bypassRatio(bpr)]);
      const lift = Math.min(.4, Math.floor(installationLimits(resized).raise * 100) / 100);
      assert.ok(lift >= 0, id);
      for (const height of new Set([0, lift])) {
        const ev = evaluate(base, [bypassRatio(bpr), nacelleRaise(height)], contextFor(base));
        const model = buildAircraft(ev.definition);
        const nacelles = model.parts.get("nacelles")!.group.children as THREE.Mesh[];
        const skin = nacelles.filter(m => ["skin", "cowlDoor"].includes(m.geometry.userData.installationRole));
        const underside = Math.min(...skin.map(m => new THREE.Box3().setFromObject(m, true).min.y)) - model.groundY;
        const reported = ev.constraints.find(c => c.id === "nacelle-clearance")!;
        assert.ok(Math.abs(parseFloat(reported.value) - underside) <= .0051, id + " stowed cowl");
        const deployment = installationLimits(ev.definition).reverse / 100;
        for (const fraction of new Set([0, deployment / 2, deployment])) {
          const measured = installedGroundClearance(model, fraction);
          for (const side of [-1, 1]) {
            const installed = new THREE.Box3();
            for (const m of nacelles.filter(m => m.visible && m.userData.side === side)) {
              const origin = m.geometry.userData.reverserOrigin;
              if (origin) applyReverserMotion(m, fraction, origin);
              installed.expandByObject(m, true);
            }
            assert.ok(Math.abs(installed.min.y - model.groundY - measured) < 1e-5, id);
          }
          assert.ok(measured > 0, id + " ground contact");
          if (id === "tu214-ps90a" && bpr === 15 && height === 0) {
            assert.ok(measured < .01);
            assert.equal(reported.status, "violation");
          }
        }
        model.root.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
      }
    }
  }
});
