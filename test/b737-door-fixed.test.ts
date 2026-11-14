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
  test(`${id}: main door surfaces are smooth and clear fixed skins and each other at 101 positions`, () => {
    const model = buildAircraft(AIRCRAFT[id]); model.root.updateMatrixWorld(true);
    const main = model.parts.get("gear.main")!.group.children as THREE.Mesh[];
    const doors = main.filter(m => /-door$|main-inner-fairing-lap/.test(m.geometry.name));
    const fixed = ["fuselage", "wing.box", "wing.highLift"].flatMap(k => model.parts.get(k)!.group.children) as THREE.Mesh[];
    fixed.push(...main.filter(m => m.geometry.userData.gearWell));
    const reports: string[] = [];
    for (const door of doors.filter(m => m.geometry.name.endsWith("-door"))) {
      const p = door.geometry.getAttribute("position"), ix = door.geometry.index!;
      const { nx, nz } = door.geometry.userData.doorGrid;
      // Each two-sided panel grid stores twelve indices per quad. The actual
      // surface, not only the vertex shading, must avoid the render's 28°
      // hard-edge threshold on its triangulation diagonals.
      for (let i = 0; i < nx * nz * 12; i += 12) {
        const faceNormal = (offset: number) => {
          const points = [0, 1, 2].map(k => v().fromBufferAttribute(p, ix.getX(offset + k)));
          return points[1].sub(points[0]).cross(points[2].sub(points[0])).normalize();
        };
        assert.ok(THREE.MathUtils.radToDeg(faceNormal(i).angleTo(faceNormal(i + 3))) < 28,
          `${door.geometry.name}: false diagonal crease`);
      }
    }
    for (const door of doors) {
      const faces = triangles(door, false), doorEdges = edges(faces), doorTree = tree(faces);
      const swept = new THREE.Box3(); door.geometry.computeBoundingBox();
      for (let step = 0; step <= 100; step++) { pose(door, step / 100); swept.union(door.geometry.boundingBox!.clone().applyMatrix4(door.matrixWorld)); }
      const box = new THREE.Box3();
      for (const skin of fixed) {
        const faces = triangles(skin).filter(t => box.setFromPoints([t.a, t.b, t.c]).intersectsBox(swept));
        if (!faces.length) continue;
        const skinTree = tree(faces);
        let report = "";
        for (let step = 0; step <= 100 && !report; step++) {
          pose(door, step / 100);
          for (const [aa, bb] of doorEdges) {
            const a = aa.clone().applyMatrix4(door.matrixWorld), b = bb.clone().applyMatrix4(door.matrixWorld);
            if (crosses(a, b, skinTree)) { report = `${door.geometry.name} crosses ${skin.geometry.name || fixed.indexOf(skin)} at ${step}% ${a.toArray()} -> ${b.toArray()}`; break; }
          }
          if (!report) {
            const inverse = door.matrixWorld.clone().invert(), bounds = door.geometry.boundingBox!.clone().applyMatrix4(door.matrixWorld);
            const nearby: THREE.Triangle[] = []; skinTree.getBoxTriangles(bounds, nearby);
            for (const [aa, bb] of edges(nearby.filter(t => box.setFromPoints([t.a, t.b, t.c]).intersectsBox(bounds)))) {
              if (crosses(aa.clone().applyMatrix4(inverse), bb.clone().applyMatrix4(inverse), doorTree)) { report = `${skin.geometry.name || fixed.indexOf(skin)} crosses ${door.geometry.name} at ${step}%`; break; }
            }
          }
        }
        if (report) reports.push(report);
      }
    }
    // Independent panels must not cut each other while their two linkages
    // follow different paths. The MAX lap is a fastened overlap on the inner
    // panel, not an independent moving panel.
    const panels = doors.filter(m => m.geometry.name.endsWith("-door"));
    const local = panels.map(m => { const faces = triangles(m, false); return { edges: edges(faces), tree: tree(faces) }; });
    for (let step = 0; step <= 100; step++) {
      panels.forEach(m => pose(m, step / 100));
      for (let i = 0; i < panels.length; i++) for (let j = i + 1; j < panels.length; j++) {
        if (panels[i].userData.side !== panels[j].userData.side) continue;
        for (const [from, to] of [[i, j], [j, i]]) {
          const transform = panels[to].matrixWorld.clone().invert().multiply(panels[from].matrixWorld);
          const crossing = local[from].edges.find(([a, b]) => crosses(a.clone().applyMatrix4(transform), b.clone().applyMatrix4(transform), local[to].tree));
          assert.ok(!crossing, `${panels[from].geometry.name} crosses ${panels[to].geometry.name} at ${step}% ${crossing?.map(p => p.clone().applyMatrix4(panels[from].matrixWorld).toArray())}`);
        }
      }
    }
    assert.deepEqual(reports, []);
    model.root.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
  });
}
