import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { Octree } from "three/examples/jsm/math/Octree.js";
import { AIRCRAFT } from "../web/aircraftCatalog.ts";
import { buildAircraft } from "../web/scene/aircraft.ts";
import { applyGearBracePose } from "../web/scene/landingGear.ts";
import { applyGearBayPose, gearLegTravel } from "../web/scene/gearBay.ts";

const v = () => new THREE.Vector3();
type Edge = [THREE.Vector3, THREE.Vector3];
function pose(mesh: THREE.Mesh, up: number) {
  const g = mesh.geometry.userData;
  mesh.position.copy(g.basePos ?? v()); mesh.rotation.set(0, 0, 0);
  const travel = gearLegTravel(g.gearProfile, up);
  if (g.retract) mesh.rotation[g.retract.axis as "x" | "z"] = g.retract.angle * travel;
  if (g.gearBrace) applyGearBracePose(mesh, travel);
  applyGearBayPose(mesh, up, 1); mesh.updateMatrixWorld(true);
}
function triangles(mesh: THREE.Mesh, world = true) {
  const p = mesh.geometry.getAttribute("position"), ix = mesh.geometry.index;
  const result: THREE.Triangle[] = [];
  for (let i = 0; i < (ix?.count ?? p.count); i += 3) {
    const points = [0, 1, 2].map(k => {
      const pt = v().fromBufferAttribute(p, ix ? ix.getX(i + k) : i + k);
      return world ? pt.applyMatrix4(mesh.matrixWorld) : pt;
    });
    result.push(new THREE.Triangle(points[0], points[1], points[2]));
  }
  return result;
}
function edges(triangles: THREE.Triangle[]): Edge[] {
  const seen = new Set<string>(), result: Edge[] = [];
  for (const tri of triangles) {
    const points = [tri.a, tri.b, tri.c];
    for (let j = 0; j < 3; j++) {
      const a = points[j], b = points[(j + 1) % 3];
      if (a.distanceTo(b) < 1e-7) continue;
      const key = [a, b].map(p => p.toArray().map(n => n.toFixed(7)).join(",")).sort().join("/");
      if (!seen.has(key)) { seen.add(key); result.push([a, b]); }
    }
  }
  return result;
}
function tree(triangles: THREE.Triangle[]) {
  const t = new Octree(); t.maxLevel = 10; t.trianglesPerLeaf = 12;
  for (const triangle of triangles) t.addTriangle(triangle);
  t.build(); return t;
}
const ray = new THREE.Ray(), hit = v();
function crosses(a: THREE.Vector3, b: THREE.Vector3, tree: Octree) {
  const length = a.distanceTo(b);
  ray.set(a, b.clone().sub(a).normalize());
  const candidates: THREE.Triangle[] = []; tree.getRayTriangles(ray, candidates);
  return candidates.some(t => {
    if (!ray.intersectTriangle(t.a, t.b, t.c, false, hit)) return false;
    const distance = hit.distanceTo(a);
    return distance > 1e-6 && distance < length - 1e-6;
  });
}

for (const id of ["b737-300", "b737-800", "b737-8"]) {
  test(`${id}: complete tyre meshes clear the fixed well, wing root and opposite gear at 101 positions`, () => {
    const model = buildAircraft(AIRCRAFT[id]); model.root.updateMatrixWorld(true);
    const main = model.parts.get("gear.main")!.group.children as THREE.Mesh[];
    const body = model.parts.get("fuselage")!.group.children as THREE.Mesh[];
    const moving = main.filter(m => {
      const g = m.geometry.userData;
      return g.retract || g.gearDoor || g.gearBrace;
    });
    const tyres = main.filter(m => m.geometry.name === "tyre");
    assert.equal(tyres.length, 4);
    // The rubber lip intentionally touches the tyre shoulder. Check the rigid
    // liner and actual aircraft shells; exclude only this flexible port seal.
    const fixed = [body[0], body[1], ...body.filter(m => m.geometry.userData.fixedWingBody),
      ...model.parts.get("wing.box")!.group.children as THREE.Mesh[],
      ...main.filter(m => m.geometry.userData.gearWell)];
    const swept = new THREE.Box3();
    for (let step = 0; step <= 100; step++) for (const tyre of tyres) {
      pose(tyre, step / 100); tyre.geometry.computeBoundingBox();
      swept.union(tyre.geometry.boundingBox!.clone().applyMatrix4(tyre.matrixWorld));
    }
    swept.expandByScalar(.001);
    const box = new THREE.Box3();
    const fixedTriangles = fixed.flatMap(m => triangles(m)).filter(t => box.setFromPoints([t.a, t.b, t.c]).intersectsBox(swept));
    const fixedTree = tree(fixedTriangles);
    const rubber = tyres.map(m => {
      const faces = triangles(m, false);
      return { edges: edges(faces), tree: tree(faces) };
    });
    let minimumHalfGap = Infinity;
    for (let step = 0; step <= 100; step++) {
      const up = step / 100;
      for (const m of moving) {
        pose(m, up);
        const p = m.geometry.getAttribute("position");
        for (let i = 0; i < p.count; i++) {
          minimumHalfGap = Math.min(minimumHalfGap, v().fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld).z * m.userData.side);
        }
      }
      for (const [i, tyre] of tyres.entries()) {
        const { edges: tyreEdges, tree: tyreTree } = rubber[i];
        for (const [aa, bb] of tyreEdges) {
          const a = aa.clone().applyMatrix4(tyre.matrixWorld), b = bb.clone().applyMatrix4(tyre.matrixWorld);
          assert.ok(!crosses(a, b, fixedTree), `tyre ${i} penetrates the fixed well at ${up}`);
        }
        // Test the reverse edges too: a narrow stationary face can enter a tyre
        // triangle without intersecting any edge of that tyre triangle.
        const bounds = tyre.geometry.boundingBox!.clone().applyMatrix4(tyre.matrixWorld);
        const nearby: THREE.Triangle[] = []; fixedTree.getBoxTriangles(bounds, nearby);
        const relevant = nearby.filter(t => box.setFromPoints([t.a, t.b, t.c]).intersectsBox(bounds));
        const inverse = tyre.matrixWorld.clone().invert();
        for (const [aa, bb] of edges(relevant)) {
          const a = aa.clone().applyMatrix4(inverse), b = bb.clone().applyMatrix4(inverse);
          assert.ok(!crosses(a, b, tyreTree), `fixed well penetrates tyre ${i} at ${up}`);
        }
      }
    }
    // Every moving surface stays on its own side, which separates the complete
    // opposing assemblies throughout the stroke, including tyres and fairings.
    assert.ok(minimumHalfGap > .010, `opposite gears approach the centreline: ${minimumHalfGap}`);
    model.root.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
  });
}
