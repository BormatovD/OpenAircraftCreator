import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { Octree } from "three/examples/jsm/math/Octree.js";
import { AIRCRAFT } from "../web/aircraftCatalog.ts";
import { buildAircraft } from "../web/scene/aircraft.ts";
import { applyGearBayPose, gearLegTravel } from "../web/scene/gearBay.ts";
import { applyGearBracePose } from "../web/scene/landingGear.ts";

const v = () => new THREE.Vector3();
function pose(mesh: THREE.Mesh, up: number) {
  const g = mesh.geometry.userData;
  mesh.position.copy(mesh.userData.basePos ?? v());
  mesh.rotation.set(0, 0, 0);
  const travel = gearLegTravel(g.gearProfile, up);
  if (g.retract) mesh.rotation[g.retract.axis as "x" | "z"] = g.retract.angle * travel;
  if (g.gearBrace) applyGearBracePose(mesh, travel);
  applyGearBayPose(mesh, up, 1);
  mesh.updateMatrixWorld(true);
}
function triangleData(mesh: THREE.Mesh) {
  const p = mesh.geometry.getAttribute("position"), index = mesh.geometry.index;
  const tree = new Octree(), edges: [THREE.Vector3, THREE.Vector3][] = [], seen = new Set<string>();
  for (let i = 0; i < (index?.count ?? p.count); i += 3) {
    const points = [0, 1, 2].map(k => v().fromBufferAttribute(p, index ? index.getX(i + k) : i + k));
    tree.addTriangle(new THREE.Triangle(...points as [THREE.Vector3, THREE.Vector3, THREE.Vector3]));
    for (let k = 0; k < 3; k++) {
      const a = points[k], b = points[(k + 1) % 3];
      const key = [a, b].map(q => q.toArray().map(n => n.toFixed(7)).join(",")).sort().join("/");
      if (!seen.has(key) && a.distanceToSquared(b) > 1e-14) { seen.add(key); edges.push([a, b]); }
    }
  }
  tree.build(); mesh.geometry.computeBoundingBox();
  return { mesh, tree, edges };
}
function intersects(a: ReturnType<typeof triangleData>, b: ReturnType<typeof triangleData>) {
  const bounds = (d: typeof a) => d.mesh.geometry.boundingBox!.clone().applyMatrix4(d.mesh.matrixWorld);
  if (!bounds(a).intersectsBox(bounds(b))) return false;
  const transform = b.mesh.matrixWorld.clone().invert().multiply(a.mesh.matrixWorld), ray = new THREE.Ray(), hit = v();
  for (const [aa, bb] of a.edges) {
    const start = aa.clone().applyMatrix4(transform), end = bb.clone().applyMatrix4(transform), length = start.distanceTo(end);
    ray.set(start, end.sub(start).divideScalar(length));
    const candidates: THREE.Triangle[] = [];
    b.tree.getRayTriangles(ray, candidates);
    for (const triangle of candidates) if (ray.intersectTriangle(triangle.a, triangle.b, triangle.c, false, hit)) {
      const distance = hit.distanceTo(start);
      if (distance > 1e-6 && distance < length - 1e-6) return true;
    }
  }
  return false;
}

for (const id of ["a319ceo", "a319neo", "a320ceo", "a320neo", "a321ceo", "a321neo"]) {
  test(`${id}: shaped body shoulders and straight leg fairing retain symmetric reversible motion`, () => {
    const model = buildAircraft(AIRCRAFT[id]), main = model.parts.get("gear.main")!.group.children as THREE.Mesh[];
    const doors = main.filter(m => m.geometry.name.endsWith("-door"));
    const keel = (model.parts.get("fuselage")!.group.children as THREE.Mesh[]).find(m =>
      m.geometry.type === "SphereGeometry" && m.geometry.userData.bellyPaint)!;
    assert.equal(doors.length, 6);
    for (const side of [-1, 1]) {
      const strut = doors.find(m => m.geometry.name === "main-strut-door" && m.userData.side === side)!;
      const p = strut.geometry.getAttribute("position");
      const { nx, nz } = strut.geometry.userData.doorGrid;
      // Every spanwise generator has one parked offset from the leg axis.
      // Check both shell faces, including their complete length.
      for (let row = 0; row < 2 * (nx + 1); row++) for (let j = 1; j <= nz; j++) {
        assert.ok(Math.abs(p.getZ(row * (nz + 1) + j) - p.getZ(row * (nz + 1))) < 1e-5,
          "leg fairing bows away from the deployed strut");
      }
      const body = doors.find(m => m.geometry.name === "main-body-door" && m.userData.side === side)!;
      assert.equal(body.geometry.userData.roundedBodyDoor, true);
      const outline = body.geometry.getAttribute("position");
      const grid = body.geometry.userData.doorGrid, last = grid.nx * (grid.nz + 1);
      assert.ok(outline.getX(grid.nz) > outline.getX(0) + .095, "forward outer shoulder is square");
      assert.ok(outline.getX(last + grid.nz) < outline.getX(last) - .095, "aft outer shoulder is square");
      // Verify the rendered profile, since smooth formulas can still produce
      // a near-vertical step when sampled on a coarse mesh.
      for (let row = 0; row <= grid.nx; row++) {
        let previous: number | undefined;
        for (let j = 0; j < grid.nz; j++) {
          const a = row * (grid.nz + 1) + j, b = a + 1;
          const angle = Math.atan2(outline.getY(b) - outline.getY(a), Math.abs(outline.getZ(b) - outline.getZ(a)));
          assert.ok(Math.abs(angle) < THREE.MathUtils.degToRad(70), "body door has a near-vertical step");
          if (previous !== undefined) assert.ok(Math.abs(angle - previous) < THREE.MathUtils.degToRad(26),
            "body door has a hard crease between adjacent profile cells");
          previous = angle;
        }
      }
      const wing = doors.find(m => m.geometry.name === "main-wing-door" && m.userData.side === side)!;
      for (const door of [body, strut, wing]) pose(door, 1);
      const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
      const opening = body.geometry.userData.bayOpening;
      for (let i = 0; i <= 20; i++) {
        const x = THREE.MathUtils.lerp(opening.x0, opening.x1, i / 20);
        ray.ray.origin.set(x, -8, side * .020);
        const fixedRim = ray.intersectObject(keel)[0];
        ray.ray.origin.z = side * .040;
        const movingRim = ray.intersectObject(body)[0];
        assert.ok(fixedRim && movingRim && Math.abs(fixedRim.point.y - movingRim.point.y) < .003,
          "closed body door must lie flush with the fixed centre strip along its whole hinge");
      }
      const rim = (door: THREE.Mesh, outer: boolean) => {
        const opening = door.geometry.userData.bayOpening;
        return outer ? Math.max(Math.abs(opening.z0), Math.abs(opening.z1)) + .024
          : Math.min(Math.abs(opening.z0), Math.abs(opening.z1)) - .024;
      };
      for (const [inner, outer] of [[body, strut], [strut, wing]]) {
        const a = rim(inner, true) - .0001, b = rim(outer, false) + .0001;
        for (const offset of [-.2, 0, .2]) {
          const x = strut.userData.basePos.x + offset;
          const y = (door: THREE.Mesh, z: number) => new THREE.Raycaster(new THREE.Vector3(x, -10, side * z),
            new THREE.Vector3(0, 1, 0)).intersectObject(door)[0]?.point.y;
          const ya = y(inner, a), yb = y(outer, b);
          assert.ok(ya !== undefined && yb !== undefined, "missing closed door rim");
          const tangent = (b - a) / Math.tan(Math.abs(strut.geometry.userData.retract.angle));
          assert.ok(Math.abs(yb - ya - tangent) < .003, "closed adjoining rims have a vertical step");
        }
      }
    }
    for (let step = 0; step <= 100; step++) {
      for (const door of doors) pose(door, step / 100);
      for (const right of doors.filter(m => m.userData.side === 1)) {
        const left = doors.find(m => m.userData.side === -1 && m.geometry.name === right.geometry.name)!;
        const p = right.geometry.getAttribute("position");
        for (let j = 0; j < p.count; j++) {
          const a = v().fromBufferAttribute(p, j).applyMatrix4(right.matrixWorld);
          const b = v().fromBufferAttribute(left.geometry.getAttribute("position"), j).applyMatrix4(left.matrixWorld);
          assert.ok(Math.hypot(a.x - b.x, a.y - b.y, a.z + b.z) < 1e-5);
          assert.ok(a.z > .002, `opposite ${right.geometry.name} panels cross at ${step}% travel`);
        }
        const expected = right.matrixWorld.clone();
        pose(right, 1); pose(right, 0); pose(right, step / 100);
        right.matrixWorld.elements.forEach((value, j) => assert.ok(Math.abs(value - expected.elements[j]) < 1e-10));
      }
    }
    model.root.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
  });

  test(`${id}: shaped doors clear the complete gear and each other at each percent of travel`, () => {
    const model = buildAircraft(AIRCRAFT[id]), main = model.parts.get("gear.main")!.group.children as THREE.Mesh[];
    for (const side of [-1, 1]) {
      const doors = main.filter(m => m.geometry.name.endsWith("-door") && m.userData.side === side).map(triangleData);
      const mechanism = main.filter(m => m.userData.side === side && !m.geometry.name.endsWith("-door") &&
        (m.geometry.userData.gearBrace || m.geometry.userData.retract)).map(triangleData);
      assert.equal(mechanism.filter(m => m.mesh.geometry.userData.gearBrace).length, 2);
      for (let step = 0; step <= 100; step++) {
        for (const data of [...doors, ...mechanism]) pose(data.mesh, step / 100);
        for (let i = 0; i < doors.length; i++) for (const other of [...mechanism, ...doors.slice(i + 1)]) {
          assert.ok(!intersects(doors[i], other) && !intersects(other, doors[i]),
            `${doors[i].mesh.geometry.name} intersects ${other.mesh.geometry.name}, side=${side}, travel=${step}%`);
        }
      }
    }
    model.root.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
  });
}
