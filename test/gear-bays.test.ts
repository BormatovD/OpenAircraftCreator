import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { AIRCRAFT } from "../web/aircraftCatalog.ts";
import { buildAircraft } from "../web/scene/aircraft.ts";
import { applyGearBracePose } from "../web/scene/landingGear.ts";
import { gearLegTravel, applyGearBayPose } from "../web/scene/gearBay.ts";

const families = ["b757-200-rb", "tu214-ps90a"] as const;
const v = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const near = (a: number, b: number, tol = 1e-5) => assert.ok(Math.abs(a - b) < tol, `${a} vs ${b}`);
function pose(mesh: THREE.Mesh, up: number, unloaded: number) {
  const g = mesh.geometry.userData;
  mesh.rotation.set(0, 0, 0);
  mesh.position.copy(mesh.userData.basePos);
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
  const vertices = door.geometry.getAttribute("position"), index = door.geometry.getIndex()!;
  const points = Array.from({ length: vertices.count }, (_, i) => v().fromBufferAttribute(vertices, i).applyMatrix4(transform));
  let result = Infinity;
  for (let i = 0; i < index.count; i += 3) {
    let poly = [points[index.getX(i)], points[index.getX(i + 1)], points[index.getX(i + 2)]];
    poly = slab(slab(poly, -half, 1), half, -1);
    result = Math.min(result, radialDistance(poly) - radius);
  }
  return result;
}

for (const id of families) {
  test(`${id}: installed doors clear the complete tyre envelopes throughout the normal stroke`, () => {
    const model = buildAircraft(AIRCRAFT[id]);
    for (const assembly of ["gear.main", "gear.nose"]) {
      const parts = model.parts.get(assembly)!.group.children as THREE.Mesh[];
      const wheels = parts.filter(m => m.geometry.name === "tyre"), doors = parts.filter(m => m.geometry.name.endsWith("-door"));
      assert.ok(doors.length >= 4);
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

for (const id of families) {
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
