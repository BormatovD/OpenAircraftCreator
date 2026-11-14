import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { AIRCRAFT } from "../web/aircraftCatalog.ts";
import { mainDoors, applyGearBayPose, gearLegTravel } from "../web/scene/gearBay.ts";
import { useShapes } from "../web/scene/shapeSet.ts";
import { buildAircraft } from "../web/scene/aircraft.ts";
import { applyGearBracePose } from "../web/scene/landingGear.ts";

// Deliberately use a thin sloping wing: a constant offset from its lower skin
// used to put the well ceiling outside the upper surface near the trailing edge.
const lower = (x: number, z: number) => -.80 + .015 * x + .035 * z;
const roof = (x: number, z: number) => lower(x, z) + .13 - .004 * x;
const skin = { lower, roof, trailingEdge: () => 12 };

for (const id of ["b757-200-rb", "b757-200-pw", "tu214-ps90a", "tu214-ps90a-factory"]) {
  test(`${id}: wing well stays below its installed roof and fixed shoulders leave both apertures open`, () => {
    const shape = useShapes(AIRCRAFT[id]);
    const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    for (const side of [-1, 1] as const) {
      const pivot = new THREE.Vector3(6, -.20, side * shape.gear.mainZ);
      const parts = mainDoors(shape.id, shape.gear, side, pivot, lower, -4, skin);
      const well = parts.find(g => g.name === "main-wheel-well")!;
      const positions = well.getAttribute("position");
      for (let i = 0; i < positions.count; i++) {
        if (Math.abs(positions.getZ(i)) < 1.9) continue;
        const y = positions.getY(i), ceiling = roof(positions.getX(i), Math.abs(positions.getZ(i)));
        assert.ok(y <= ceiling + 1e-6, `${well.name}: ${y} exceeds ${ceiling}`);
      }
      const shoulder = parts.find(g => g.name === "main-well-sill")!;
      assert.equal(shoulder.userData.fixedWingBody, true);
      assert.equal(shoulder.userData.bellyPaint, true);
      assert.equal(shoulder.userData.tone, undefined);
      assert.equal(shoulder.userData.retract, undefined);
      assert.equal(shoulder.userData.gearDoor, undefined);
      const mesh = new THREE.Mesh(shoulder, material);
      mesh.updateMatrixWorld(true);
      const probe = (x: number, z: number) => new THREE.Raycaster(
        new THREE.Vector3(x, -5, side * z), new THREE.Vector3(0, 1, 0)).intersectObject(mesh);
      // Truck and strut opening centres must remain unobstructed when doors open.
      assert.equal(probe(pivot.x, .8).length, 0);
      assert.equal(probe(pivot.x, (1.73 + shape.gear.mainZ) / 2).length, 0);
      // A fixed shoulder remains on both sides of the narrower leg opening.
      for (const direction of [-1, 1]) {
        const reach = direction < 0 ? .67 : 1.20;
        assert.ok(probe(pivot.x + direction * (reach + .10), 2.35).length > 0);
      }
      parts.forEach(g => g.dispose());
    }
    material.dispose();
  });
}

// An edge can cross a sloping roof between two clear vertices. Split each
// moving edge at every crossed roof-grid boundary and triangle diagonal;
// clearance varies linearly between those points, so checking them is exact
// for the rendered triangular meshes at each of the 101 sampled positions.
for (const id of ["b757-200-rb", "b757-200-pw", "tu214-ps90a", "tu214-ps90a-factory"]) {
  test(`${id}: complete main-gear edges clear the communicating well throughout retraction`, () => {
    const model = buildAircraft(AIRCRAFT[id]);
    const main = model.parts.get("gear.main")!.group.children as THREE.Mesh[];
    for (const side of [-1, 1]) {
      const well = main.find(m => m.geometry.name === "main-wheel-well" && m.userData.side === side)!;
      const roofVertices = well.geometry.getAttribute("position");
      const { nx, nz } = well.geometry.userData.roofGrid;
      const pocket = well.geometry.userData.wingPocket;
      const outer = Math.max(Math.abs(pocket.z0), Math.abs(pocket.z1));
      const project = (p: THREE.Vector3) => [
        (p.x - pocket.x0) / (pocket.x1 - pocket.x0) * nx, Math.abs(p.z) / outer * nz,
      ];
      const ceiling = (u: number, v: number) => {
        const i = Math.min(nx - 1, Math.max(0, Math.floor(u))), j = Math.min(nz - 1, Math.max(0, Math.floor(v)));
        const a = (i * nz + j) * 6, tx = u - i, tz = v - j;
        const y0 = roofVertices.getY(a), y1 = roofVertices.getY(a + 1), y2 = roofVertices.getY(a + 2), y3 = roofVertices.getY(a + 5);
        return tz >= tx ? y0 + tz * (y1 - y0) + tx * (y2 - y1) : y0 + tx * (y3 - y0) + tz * (y2 - y3);
      };
      const moving = main.filter(m => m.userData.side === side &&
        /^(tyre|main-strut|oleo-piston|torque-links|upper-stay|lower-stay|bogie-beam|axle|main-.*-door)$/.test(m.geometry.name));
      const outerWallStart = nx * nz * 6 + 2 * nz * 6;
      const wallBottom = (u: number) => {
        const i = Math.min(nx - 1, Math.max(0, Math.floor(u))), t = u - i;
        return THREE.MathUtils.lerp(roofVertices.getY(outerWallStart + i * 6),
          roofVertices.getY(outerWallStart + i * 6 + 1), t);
      };
      for (const mesh of moving) {
        const p = mesh.geometry.getAttribute("position"), index = mesh.geometry.getIndex();
        const points = Array.from({ length: p.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(p, i));
        const edges: [number, number][] = [], seen = new Set<string>();
        for (let i = 0; i < (index?.count ?? p.count); i += 3) for (let k = 0; k < 3; k++) {
          const a = index ? index.getX(i + k) : i + k, b = index ? index.getX(i + (k + 1) % 3) : i + (k + 1) % 3;
          const key = [points[a].toArray().join(","), points[b].toArray().join(",")].sort().join("/");
          if (!seen.has(key)) { seen.add(key); edges.push([a, b]); }
        }
        for (let step = 0; step <= 100; step++) {
          const up = step / 100, data = mesh.geometry.userData, travel = gearLegTravel(data.gearProfile, up);
          mesh.position.copy(mesh.userData.basePos);
          mesh.rotation.set(0, 0, 0);
          if (data.retract) mesh.rotation[data.retract.axis as "x" | "z"] = data.retract.angle * travel;
          if (data.gearBrace) applyGearBracePose(mesh, travel);
          applyGearBayPose(mesh, up, 1);
          mesh.updateMatrixWorld(true);
          const world = points.map(p => p.clone().applyMatrix4(mesh.matrixWorld));
          const grid = world.map(project);
          for (const [a, b] of edges) {
            const [u0, v0] = grid[a], [u1, v1] = grid[b];
            for (const wallU of [0, nx]) if ((u0 - wallU) * (u1 - wallU) < 0) {
              const t = (wallU - u0) / (u1 - u0), v = THREE.MathUtils.lerp(v0, v1, t);
              if (v < 0 || v > nz) continue;
              const j = Math.min(nz - 1, Math.floor(v));
              const wallStart = nx * nz * 6 + (wallU === 0 ? 0 : nz * 6);
              const lower = THREE.MathUtils.lerp(roofVertices.getY(wallStart + j * 6),
                roofVertices.getY(wallStart + j * 6 + 1), v - j);
              const y = THREE.MathUtils.lerp(world[a].y, world[b].y, t);
              assert.ok(y < lower - .004, `${mesh.geometry.name}: chordwise well wall crosses its edge, up=${up}, y=${y}, lip=${lower}`);
            }
            // Moving geometry may be outside the outboard wall while hanging
            // below the wing; every crossing of that wall must be below its lip.
            if ((v0 - nz) * (v1 - nz) < 0) {
              const t = (nz - v0) / (v1 - v0), u = THREE.MathUtils.lerp(u0, u1, t);
              const y = THREE.MathUtils.lerp(world[a].y, world[b].y, t);
              assert.ok(y < wallBottom(u) - .004,
                `${mesh.geometry.name}: outboard well wall intersects its edge, up=${up}, y=${y}, lip=${wallBottom(u)}`);
            }
            const parameters = [0, 1];
            for (const [start, end] of [[u0, u1], [v0, v1], [u0 - v0, u1 - v1]]) {
              for (let boundary = Math.ceil(Math.min(start, end)); boundary < Math.max(start, end); boundary++) {
                const t = (boundary - start) / (end - start);
                if (t > 0 && t < 1) parameters.push(t);
              }
            }
            for (const t of parameters) {
              const u = THREE.MathUtils.lerp(u0, u1, t), v = THREE.MathUtils.lerp(v0, v1, t);
              if (u < 0 || u > nx || v < 0 || v > nz) continue;
              const y = THREE.MathUtils.lerp(world[a].y, world[b].y, t);
              const roofY = ceiling(u, v);
              const clearance = mesh.geometry.name.endsWith("-door") ? .001 : .004;
              assert.ok(y < roofY - clearance, `${mesh.geometry.name}, side=${side}, up=${up}: ${y} above roof=${roofY}`);
            }
          }
        }
      }
    }
    model.root.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
  });
}
