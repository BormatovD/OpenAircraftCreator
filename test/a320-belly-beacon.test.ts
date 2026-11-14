import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { fuselageStretch } from "../src/levers.ts";
import { AIRCRAFT } from "../web/aircraftCatalog.ts";
import { buildAircraft } from "../web/scene/aircraft.ts";
import { applyGearBayPose, gearLegTravel } from "../web/scene/gearBay.ts";
import { applyGearBracePose } from "../web/scene/landingGear.ts";

function pose(mesh: THREE.Mesh, up: number) {
  const data = mesh.geometry.userData;
  mesh.position.copy(mesh.userData.basePos ?? new THREE.Vector3());
  mesh.rotation.set(0, 0, 0);
  const travel = gearLegTravel(data.gearProfile, up);
  if (data.retract) mesh.rotation[data.retract.axis as "x" | "z"] = data.retract.angle * travel;
  if (data.gearBrace) applyGearBracePose(mesh, travel);
  applyGearBayPose(mesh, up, 1);
}

function checkBeacon(id: string, definition = AIRCRAFT[id], steps = 100) {
    const model = buildAircraft(definition);
    const body = model.parts.get("fuselage")!.group.children as THREE.Mesh[];
    const lens = body.find(m => m.geometry.name === "lower-beacon-lens")!;
    const mount = body.find(m => m.geometry.name === "lower-beacon-mount")!;
    assert.ok(lens && mount);
    assert.equal(lens.userData.partId, "fuselage", "lamp must participate in normal picking/highlighting");
    assert.equal(lens.userData.tone, "beacon", "lamp must use the existing red flash material");
    for (const mesh of [lens, mount]) {
      assert.equal(mesh.geometry.userData.retract, undefined);
      const mat = mesh.material as THREE.Material;
      assert.ok(mat.depthTest && mat.depthWrite && !mat.transparent, "no X-ray rendering workaround");
    }
    const data = lens.geometry.userData.lowerBeacon;
    assert.ok(data.stationM > 0 && data.stationM < data.nominalLengthM);
    assert.ok(data.source.startsWith("https://"), "installation must retain its evidence");
    if (id.startsWith("a320")) assert.equal(data.stationM, 14.6, "preserve approved A320 station");
    assert.ok(Math.abs(data.surface[2] - data.lateralM) < 1e-6, "preserve lateral station");
    if (id.startsWith("tu214")) assert.ok(data.lateralM < -1, "Tu lamp belongs to the left fairing");
    else assert.equal(data.lateralM, 0, "published plan views put this lamp on the centreline");
    const surface = new THREE.Vector3().fromArray(data.surface);
    const normal = new THREE.Vector3().fromArray(data.normal);
    assert.ok(normal.y < -.7, "lens faces out through the belly");
    const lensNormal = new THREE.Vector3().fromBufferAttribute(lens.geometry.getAttribute("normal"), 0);
    assert.ok(lensNormal.dot(normal) > .99, "cover winding must face the external viewer");
    const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    const exterior: THREE.Mesh[] = [];
    for (const part of model.parts.values()) if (!part.ghost) part.group.traverse(o => {
      if (o instanceof THREE.Mesh && o.visible) { o.material = material; exterior.push(o); }
    });
    const gear = ["gear.main", "gear.nose"].flatMap(id => model.parts.get(id)!.group.children as THREE.Mesh[]);
    const openings = gear.flatMap(m => m.geometry.userData.bayOpening ? [m.geometry.userData.bayOpening] : []);
    lens.geometry.computeBoundingBox();
    const bounds = lens.geometry.boundingBox!;
    const mainDoorFront = Math.min(...gear.filter(m => m.geometry.name.startsWith("main-") && m.geometry.userData.bayOpening)
      .map(m => m.geometry.userData.bayOpening.x0));
    if (id.startsWith("a320")) assert.ok(bounds.max.x < mainDoorFront - 1.5, "approved A320 beacon station remains ahead of the MLG doors and braces");
    for (const o of openings) assert.ok(bounds.max.x < o.x0 || bounds.min.x > o.x1 || bounds.max.z < o.z0 || bounds.min.z > o.z1,
      "beacon cannot be mounted on a moving bay footprint");
    const ray = new THREE.Raycaster();
    // Check the mount against the actual final cut meshes, not the analytic ellipsoid.
    model.root.updateMatrixWorld(true);
    const skin = body.filter(m => m === body[0] || m.geometry.userData.bellyPaint);
    const p = mount.geometry.getAttribute("position");
    for (let i = 0; i < p.count; i++) {
      ray.set(new THREE.Vector3(p.getX(i), -8, p.getZ(i)), new THREE.Vector3(0, 1, 0));
      const hit = ray.intersectObjects(skin, false)[0];
      assert.ok(hit, "mount has no intact fixed skin behind it");
      const gap = p.getY(i) - hit.point.y;
      assert.ok(Math.abs(gap - .003) < 2e-5 || Math.abs(gap + .024) < 2e-5, "mount floats above or is buried in skin");
    }
    const target = surface.clone().addScaledVector(normal, .075);
    const views = [new THREE.Vector3(0, -1, 0), new THREE.Vector3(-.5, -1, 0),
      new THREE.Vector3(.5, -1, 0), new THREE.Vector3(0, -1, -.5), new THREE.Vector3(0, -1, .5)];
    for (let step = 0; step <= steps; step++) {
      for (const mesh of gear) pose(mesh, step / steps);
      model.root.updateMatrixWorld(true);
      for (const view of views) {
        const origin = target.clone().addScaledVector(view, 4);
        ray.set(origin, target.clone().sub(origin).normalize());
        assert.equal(ray.intersectObjects(exterior, false)[0]?.object, lens,
          `lower red cover is occluded from beneath, gear=${step / steps * 100}%, view=${view.toArray()}`);
      }
    }
    material.dispose();
    model.root.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
}

for (const id of Object.keys(AIRCRAFT)) {
  test(`${id}: lower beacon is seated on fixed skin and visible through 101 gear poses`, () => checkBeacon(id));
  for (const rows of [-6, 12]) test(`${id}: lower beacon remains on fixed skin at ${rows} live fuselage rows`, () => {
    const effect = fuselageStretch(rows).effects.find(e => e.kind === "definition")!;
    if (effect.kind !== "definition") throw new Error("missing fuselage lever");
    checkBeacon(id, effect.apply(AIRCRAFT[id]), 2);
  });
}
