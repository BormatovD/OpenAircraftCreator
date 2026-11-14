import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { AIRCRAFT } from "../web/aircraftCatalog.ts";
import { buildAircraft } from "../web/scene/aircraft.ts";
import { fuselageGeometry } from "../web/scene/shapes.ts";
import { applyGearBracePose } from "../web/scene/landingGear.ts";
import { gearLegTravel, applyGearBayPose } from "../web/scene/gearBay.ts";

const tandemTypes = ["b757-200-rb", "tu214-ps90a"] as const;
const v = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const near = (a: number, b: number, tol = 1e-5) => assert.ok(Math.abs(a - b) < tol, `${a} vs ${b}`);
function pose(mesh: THREE.Mesh, up: number, unloaded: number) {
  const g = mesh.geometry.userData;
  mesh.rotation.set(0, 0, 0);
  mesh.position.set(0, 0, 0);
  if (mesh.userData.basePos) mesh.position.copy(mesh.userData.basePos);
  const travel = gearLegTravel(g.gearProfile, up);
  if (g.retract) mesh.rotation[g.retract.axis as "x" | "z"] = g.retract.angle * travel;
  if (g.gearBrace) applyGearBracePose(mesh, travel);
  applyGearBayPose(mesh, up, unloaded);
  mesh.updateMatrixWorld(true);
}
// Intersect complete door triangles with the axial slab containing a tyre; project the
// clipped polygon onto the wheel plane and find its closest point to the axle. A full
// cylinder conservatively includes the rounded shoulders and tyre grooves.
function slab(poly: THREE.Vector3[], z: number, keep: number) {
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], da = keep * (a.z - z), db = keep * (b.z - z);
    if (da >= 0) out.push(a);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) out.push(a.clone().lerp(b, da / (da - db)));
  }
  return out;
}
function radialDistance(poly: THREE.Vector3[]) {
  if (!poly.length) return Infinity;
  let nearest = Infinity, positive = false, negative = false, area = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], x = b.x - a.x, y = b.y - a.y;
    const t = THREE.MathUtils.clamp(-(a.x * x + a.y * y) / (x * x + y * y || 1), 0, 1);
    nearest = Math.min(nearest, Math.hypot(a.x + x * t, a.y + y * t));
    const cross = a.x * b.y - b.x * a.y; area += cross;
    if (cross > 1e-9) positive = true; if (cross < -1e-9) negative = true;
  }
  return Math.abs(area) > 1e-8 && !(negative && positive) ? 0 : nearest;
}
function tyreClearance(door: THREE.Mesh, wheel: THREE.Mesh) {
  const b = wheel.geometry.boundingBox!, c = b.getCenter(v()), radius = (b.max.x - b.min.x) / 2, half = (b.max.z - b.min.z) / 2;
  const transform = new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z)
    .multiply(wheel.matrixWorld.clone().invert()).multiply(door.matrixWorld);
  const doorBox = door.geometry.boundingBox!.clone().applyMatrix4(transform);
  if (doorBox.max.z < -half || doorBox.min.z > half || doorBox.min.x > radius || doorBox.max.x < -radius ||
    doorBox.min.y > radius || doorBox.max.y < -radius) return Infinity;
  const vertices = door.geometry.getAttribute("position"), index = door.geometry.getIndex();
  const points = Array.from({ length: vertices.count }, (_, i) => v().fromBufferAttribute(vertices, i).applyMatrix4(transform));
  let result = Infinity;
  for (let i = 0; i < (index?.count ?? vertices.count); i += 3) {
    let poly = [i, i + 1, i + 2].map(j => points[index ? index.getX(j) : j]);
    poly = slab(slab(poly, -half, 1), half, -1);
    result = Math.min(result, radialDistance(poly) - radius);
  }
  return result;
}

for (const id of Object.keys(AIRCRAFT)) {
  test(`${id}: installed doors clear the complete tyre envelopes throughout the normal stroke`, () => {
    const model = buildAircraft(AIRCRAFT[id]);
    for (const assembly of ["gear.main", "gear.nose"]) {
      const parts = model.parts.get(assembly)!.group.children as THREE.Mesh[];
      const wheels = parts.filter(m => m.geometry.name === "tyre");
      const doors = parts.filter(m => m.geometry.userData.gearDoor || (m.userData.retract && m.geometry.name.endsWith("-door")));
      assert.ok(doors.length >= (id.startsWith("b737") && assembly === "gear.nose" ? 2 : 4), `${id} ${assembly}: ${doors.length} doors`);
      for (const m of [...wheels, ...doors]) m.geometry.computeBoundingBox();
      const worst = new Map<string, [number, number]>();
      for (let i = 0; i <= 100; i++) {
        const up = i / 100;
        for (const m of [...wheels, ...doors]) pose(m, up, 1);
        for (const door of doors) for (const w of wheels) {
          const d = tyreClearance(door, w);
          if (d < (worst.get(door.geometry.name)?.[0] ?? Infinity)) worst.set(door.geometry.name, [d, up]);
        }
      }
      assert.ok([...worst.values()].every(([gap]) => gap > .003), JSON.stringify([id, assembly, ...worst]));
    }
    model.root.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
  });
}

function sortedPoint(mesh: THREE.Mesh, index: number) {
  return v().fromBufferAttribute(mesh.geometry.getAttribute("position"), index).applyMatrix4(mesh.matrixWorld);
}

test("737 MAX 8: continuous fuselage sidewall and fixed wing skin above the main well", () => {
  const def = AIRCRAFT["b737-8"], model = buildAircraft(def);
  const main = model.parts.get("gear.main")!.group.children as THREE.Mesh[];
  const body = model.parts.get("fuselage")!.group.children as THREE.Mesh[];
  const [hull] = body;
  const fairings = body.filter(m => m.geometry.userData.fixedWingBody);
  const wing = model.parts.get("wing.box")!.group.children as THREE.Mesh[];
  const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const reference = new THREE.Mesh(fuselageGeometry(def.fuselage), mat);
  const shell = [...fairings, ...wing];
  for (const mesh of [hull, ...shell]) mesh.material = mat;
  for (const side of [-1, 1]) {
    const leg = main.find(m => m.geometry.name === "main-strut" && m.userData.side === side)!;
    const cut = main.find(m => m.geometry.name === "main-inner-door" && m.userData.side === side)!.geometry.userData.bayOpening;
    for (const frac of [.05, .35, .5, .85, .95]) {
      const x = THREE.MathUtils.lerp(cut.x0, cut.x1, frac);
      for (const y of [-.80, -.56, -.29, -.06]) {
        const ray = new THREE.Raycaster(v(x, y, side * 5), v(0, 0, -side));
        const expected = ray.intersectObject(reference)[0].distance;
        const cover = ray.intersectObjects(shell)[0];
        if (!cover || cover.distance > expected) near(ray.intersectObject(hull)[0]?.distance, expected);
      }
      // Fixed panels alone must cover the hinge even when the flaps leave the wing.
      for (const z of [1.98, 2.2, 2.5, 2.86, 3.02]) {
        const hits = new THREE.Raycaster(v(x, 3, side * z), v(0, -1, 0)).intersectObjects(shell);
        assert.ok(hits[0] && hits[0].point.y > leg.userData.basePos.y - .015, "missing roof over the strut");
      }
    }
    for (const up of [0, .25, .5, .75, 1]) {
      pose(leg, up, 1);
      const p = leg.geometry.getAttribute("position");
      for (let i = 0; i < p.count; i += 3) {
        const point = sortedPoint(leg, i);
        if (side * point.z < 1.95 || point.y < leg.userData.basePos.y - .2) continue;
        const roof = new THREE.Raycaster(v(point.x, 3, point.z), v(0, -1, 0)).intersectObjects(wing)[0];
        assert.ok(roof && roof.point.y > point.y + .005, "trunnion projects through the fixed upper skin");
      }
    }
  }
  mat.dispose();
  reference.geometry.dispose();
  model.root.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
});

for (const id of ["b737-300", "b737-800", "b737-8"]) {
  test(`${id}: both outboard wheel faces remain exposed in their own openings after retraction`, () => {
    const model = buildAircraft(AIRCRAFT[id]);
    const main = model.parts.get("gear.main")!.group.children as THREE.Mesh[];
    const exterior = ["fuselage", "wing.box", "wing.highLift"].flatMap(key => model.parts.get(key)!.group.children) as THREE.Mesh[];
    const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    for (const mesh of [...main, ...exterior]) mesh.material = material;
    for (const mesh of main) pose(mesh, 1, 1);
    for (const side of [-1, 1]) {
      const tyres = main.filter(o => o.geometry.name === "tyre" && o.userData.side === side);
      assert.equal(tyres.length, 2);
      const wheels = tyres.map(mesh => {
        mesh.geometry.computeBoundingBox();
        const local = mesh.geometry.boundingBox!.getCenter(v());
        return { local, mesh, center: local.clone().applyMatrix4(mesh.matrixWorld) };
      }).sort((a, b) => b.local.z * side - a.local.z * side);
      const { mesh, center } = wheels[0];
      const normal = v(0, 0, side).applyQuaternion(mesh.quaternion);
      const axialRay = new THREE.Raycaster(center.clone().addScaledVector(normal, 2), normal.clone().negate());
      const first = axialRay.intersectObjects([...main, ...exterior], false)[0]?.object as THREE.Mesh | undefined;
      assert.ok(first && /hub|cap/i.test(first.geometry.name), `wheel face covered by ${first?.geometry.name || first?.parent?.name}`);
      assert.equal(first.userData.side, side);
      for (const tyre of tyres) {
        const positions = tyre.geometry.getAttribute("position");
        for (let i = 0; i < positions.count; i++) {
          assert.ok(side * sortedPoint(tyre, i).z > 0, "the tyre crosses the centreline into the opposite gear");
        }
      }
    }
    const nose = model.parts.get("gear.nose")!.group.children as THREE.Mesh[];
    const pair = nose.filter(o => o.geometry.userData.gearDoor);
    assert.equal(pair.length, 2);
    for (const door of pair) {
      pose(door, 0, 1);
      const down = door.quaternion.clone();
      assert.ok(down.angleTo(new THREE.Quaternion()) > 1);
      if (id === "b737-300") {
        pose(door, .8, 1);
        near(door.quaternion.angleTo(down), 0);
      }
      pose(door, 1, 1);
      near(door.quaternion.angleTo(new THREE.Quaternion()), 0);
    }
    material.dispose();
    model.root.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
  });
}

for (const id of tandemTypes) {
  test(`${id}: parked and airborne truck angles, mirrored hinges and reversible normal sequence`, () => {
    const model = buildAircraft(AIRCRAFT[id]);
    for (const key of ["gear.main", "gear.nose"]) {
      const meshes = model.parts.get(key)!.group.children as THREE.Mesh[];
      const skins = meshes.filter(m => m.geometry.userData.bayOpening);
      for (const d of skins) {
        d.geometry.computeBoundingBox();
        if (d.geometry.name !== "main-strut-door") continue;
        // Each shell quad is triangulated. The render uses a 28° hard-edge overlay:
        // a diagonal above that on the face creates a spurious crease at the fairing.
        const geom = d.geometry, idx = geom.getIndex()!, positions = geom.getAttribute("position");
        for (let j = 0; j < idx.count; j += 12) {
          const normal = (k: number) => {
            const p = (offset: number) => v().fromBufferAttribute(positions, idx.getX(k + offset));
            return p(1).sub(p(0)).cross(p(2).sub(p(0))).normalize();
          };
          assert.ok(THREE.MathUtils.radToDeg(normal(j).angleTo(normal(j + 3))) < 28,
            "false diagonal across a rigid door panel");
        }
      }
      for (const step of [0, .08, .17, .3, .5, .7, .83, .92, 1]) {
        const history = skins.map(d => {
          pose(d, step, 1);
          return d.matrixWorld.clone();
        });
        // Approach the same position from the opposite end; transforms may not accumulate.
        skins.forEach((d, j) => {
          pose(d, 1, 1); pose(d, 0, 0); pose(d, step, 1);
          d.matrixWorld.elements.forEach((value, k) => near(value, history[j].elements[k], 1e-9));
        });
        for (const door of skins.filter(d => d.userData.side === 1)) {
          const left = skins.find(d => d.userData.side === -1 && d.geometry.name === door.geometry.name)!;
          const at = sortedPoint(door, 24), mirrored = sortedPoint(left, 24);
          near(at.x, mirrored.x); near(at.y, mirrored.y); near(at.z, -mirrored.z);
          const motion = door.geometry.userData.gearDoor;
          if (motion?.drive === "sequence") {
            const angle = door.quaternion.angleTo(new THREE.Quaternion());
            if (step === 0 || step === 1) near(angle, 0);
            if (step >= .17 && step <= .83) near(angle, Math.abs(motion.angle));
            if (step < .17 || step > .83) near(gearLegTravel(id.startsWith("b757") ? "b757" : "tu214", step), step < .17 ? 0 : 1);
          }
        }
      }
      if (key === "gear.main") {
        const axles = meshes.filter(m => m.geometry.name === "axle" && m.userData.side === 1);
        for (const load of [0, 1]) {
          const pts = axles.map(m => {
            pose(m, 0, load); m.geometry.computeBoundingBox();
            return m.geometry.boundingBox!.getCenter(v()).applyMatrix4(m.matrixWorld);
          }).sort((a, b) => a.x - b.x);
          const foreUp = THREE.MathUtils.radToDeg(Math.atan2(pts[0].y - pts[1].y, pts[1].x - pts[0].x));
          if (load === 0) near(foreUp, 0);
          else if (id.startsWith("b757")) near(foreUp, 9.6);
          else assert.ok(foreUp < 0);
        }
      }
    }
    model.root.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
  });

  test(`${id}: extended wells have depth; closed panels cover each cut and stay outside the stowed braces`, () => {
    const model = buildAircraft(AIRCRAFT[id]);
    const rigid = [...model.parts.get("fuselage")!.group.children.slice(0, 2),
    ...model.parts.get("wing.box")!.group.children] as THREE.Mesh[];
    const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    for (const skin of rigid) skin.material = material;
    for (const key of ["gear.main", "gear.nose"]) {
      const pieces = model.parts.get(key)!.group.children as THREE.Mesh[];
      const doors = pieces.filter(m => m.geometry.userData.bayOpening);
      const liners = pieces.filter(m => m.geometry.name.endsWith("-well"));
      for (const part of pieces) { pose(part, 1, 1); part.material = material; }
      const ray = (x: number, z: number) => new THREE.Raycaster(v(x, -10, z), v(0, 1, 0));
      for (const door of doors) {
        const cut = door.geometry.userData.bayOpening;
        for (const frac of [.25, .5, .75]) {
          const probe = ray(THREE.MathUtils.lerp(cut.x0, cut.x1, frac), THREE.MathUtils.lerp(cut.z0, cut.z1, frac));
          const closed = probe.intersectObject(door)[0], inside = probe.intersectObjects([...rigid, ...liners])[0];
          assert.ok(closed && inside && inside.distance > closed.distance + .12, door.geometry.name);
        }
      }
      let checked = 0;
      for (const brace of pieces.filter(p => p.geometry.userData.gearBrace)) {
        const pos = brace.geometry.getAttribute("position");
        for (let j = 0; j < pos.count; j += 5) {
          const pt = sortedPoint(brace, j);
          const surface = ray(pt.x, pt.z).intersectObjects([...doors, ...rigid])[0];
          if (surface) { assert.ok(pt.y > surface.point.y - .008, `${brace.name}/${key}: brace y=${pt.y}; outer y=${surface.point.y}`); checked++; }
        }
      }
      assert.ok(checked > 30);
    }
    model.root.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    material.dispose();
  });
}
