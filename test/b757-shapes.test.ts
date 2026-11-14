import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import B757 from "../data/ac/b757-shapes.json" with { type: "json" };
import { B757_PW2037, B757_RB211 } from "../src/aircraft/b757.ts";
import { contextFor } from "../src/aircraft/contextFor.ts";
import { evaluate } from "../src/evaluate.ts";
import { bypassRatio, nacelleRaise } from "../src/levers.ts";
import { buildAircraft, max757Raise } from "../web/scene/aircraft.ts";
import { coreRadiusFor, engineCutaway, nacelleSegments } from "../web/scene/shapes.ts";

const near = (actual: number, reference: number, tolerance: number) =>
  assert.ok(Math.abs(actual - reference) <= tolerance, `${actual} differs from ${reference} by more than ${tolerance}`);

// Count separate blade rows by their actual axial gaps, independently of the preset.
function axialIntervals(g: THREE.BufferGeometry, ignoreShroud = false): [number, number][] {
  const pos = g.getAttribute("position");
  const index = g.getIndex()!;
  const intervals: [number, number][] = [];
  for (let i = 0; i < index.count; i += 3) {
    const verts = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
    // Exclude cylindrical walls, including the shrouds that span the gaps.
    const radii = verts.map(v => Math.hypot(pos.getY(v), pos.getZ(v)));
    if (ignoreShroud && Math.max(...radii) - Math.min(...radii) < 1e-5) continue;
    const xs = verts.map(v => pos.getX(v));
    intervals.push([Math.min(...xs), Math.max(...xs)]);
  }
  intervals.sort((a, b) => a[0] - b[0]);
  const rows: [number, number][] = [];
  for (const [start, stop] of intervals) {
    const last = rows.at(-1);
    if (!last || start > last[1] + 1e-5) rows.push([start, stop]);
    else last[1] = Math.max(last[1], stop);
  }
  return rows;
}

// Each foil has one root leading-edge vertex at the front of the row.
function turbineRows(g: THREE.BufferGeometry) {
  const pos = g.getAttribute("position");
  return axialIntervals(g).map(([start, end]) => {
    let blades = 0;
    for (let i = 0; i < pos.count; i++) if (Math.abs(pos.getX(i) - start) < 1e-6) blades++;
    return { start, end, blades };
  });
}

test("757: каждый ротор, статор и вал соответствуют схеме своего двигателя", () => {
  for (const base of [B757_RB211, B757_PW2037]) {
    const rb = base === B757_RB211;
    const frontSpool = rb ? "ip" : "lp";
    for (const bypassRatio of [base.engine.bypassRatio, 8]) {
      const pieces = engineCutaway({ ...base.engine.architecture, fanStyle: rb ? "rb211" : "pw2037",
        fanDiameterM: base.engine.fanDiameterM, lengthM: 3.2, bypassRatio });
      for (const [spool, rows] of [[frontSpool, rb ? 6 : 4], ["hp", rb ? 6 : 12]] as const) {
        const rotor = pieces.find(p => p.geometry.name === spool + "-compressor")!;
        assert.equal(rotor.spin, spool);
        assert.equal(axialIntervals(rotor.geometry).length, rows);
        const guides = pieces.find(p => p.geometry.name === spool + "-stator")!;
        assert.equal(axialIntervals(guides.geometry, true).length, rows);
        assert.equal(guides.spin, null);
        assert.equal(guides.tone, "stator");
      }
      const shafts = pieces.filter(p => p.geometry.type === "CylinderGeometry");
      assert.deepEqual(shafts.map(p => p.spin).sort(), rb ? ["hp", "ip", "lp"] : ["hp", "lp"]);
      const expected = rb ? { hp: [102], ip: [112], lp: [78, 64, 64] }
        : { hp: [48, 64], lp: [158, 138, 102, 90, 94] };
      const turbinePieces = pieces.filter(p => p.geometry.name.includes("-turbine-"));
      assert.equal(turbinePieces.length, 2 * Object.keys(expected).length);
      let previousEnd = 0;
      for (const [spool, counts] of Object.entries(expected)) {
        const rotor = turbinePieces.find(p => p.geometry.name === spool + "-turbine-rotor")!;
        const guide = turbinePieces.find(p => p.geometry.name === spool + "-turbine-guide")!;
        assert.equal(rotor.spin, spool);
        assert.equal(guide.spin, null);
        const blades = turbineRows(rotor.geometry), vanes = turbineRows(guide.geometry);
        assert.deepEqual(blades.map(row => row.blades), counts);
        assert.equal(vanes.length, counts.length);
        if (!rb && spool === "hp") assert.deepEqual(vanes.map(row => row.blades), [36, 40]);
        for (let i = 0; i < counts.length; i++) {
          assert.ok(vanes[i].blades > 1 && previousEnd < vanes[i].start && vanes[i].end < blades[i].start);
          previousEnd = blades[i].end;
        }
      }
      pieces.forEach(p => p.geometry.dispose());
    }
  }
});

test("757: обе камеры имеют открытый кольцевой канал и одну форсунку в каждом гнезде", () => {
  for (const [def, count, radialFraction] of [[B757_RB211, 18, .60], [B757_PW2037, 24, .70]] as const) {
    const e = def.engine;
    const lengthM = e.fanDiameterM * (1.7 + .09 * Math.max(0, e.bypassRatio - 5.7) / 5.3);
    const pieces = engineCutaway({ ...e.architecture, fanStyle: count === 18 ? "rb211" : "pw2037",
      fanDiameterM: e.fanDiameterM, bypassRatio: e.bypassRatio, lengthM });
    const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    const mesh = (name: string) => {
      const part = pieces.find(p => p.geometry.name === "combustor-" + name)!;
      assert.equal(part.spin, null);
      return new THREE.Mesh(part.geometry, material);
    };
    const liner = mesh("liner"), injectors = mesh("injectors"), cups = mesh("cups");
    const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(1, 0, 0));
    const hits = (object: THREE.Mesh, r: number, a: number) => {
      ray.ray.origin.set(0, r * Math.cos(a), r * Math.sin(a));
      return ray.intersectObject(object, false);
    };
    const core = coreRadiusFor(e.fanDiameterM / 2, e.bypassRatio);
    const radius = core * radialFraction, pitch = Math.PI * 2 / count;
    for (let i = 0; i < count; i++) {
      const angle = i * pitch;
      // Axial sightlines through a real nozzle position and halfway to its neighbour.
      const bore = hits(liner, radius, angle), web = hits(liner, radius, angle + pitch / 2);
      assert.ok(web.length && (!bore.length || bore[0].distance > web[0].distance + .01));
      assert.ok(hits(injectors, core * .89, angle).length);
      assert.equal(hits(injectors, core * .89, angle + pitch / 2).length, 0);
      assert.ok(hits(cups, radius, angle + .32 * Math.sin(pitch / 2)).length);
    }
    assert.equal(hits(liner, 0, 0).length, 0);
    pieces.forEach(p => p.geometry.dispose());
    material.dispose();
  }
});

test("757: подсветка клиренса учитывает установленный двигатель, ширину гондолы и подъём пилона", () => {
  for (const [def, expected] of [[B757_RB211, "0.86 м"], [B757_PW2037, "0.74 м"]] as const) {
    const clearance = (aircraft = def, raise = 0) => evaluate(aircraft, [nacelleRaise(raise)], contextFor(aircraft))
      .constraints.find(c => c.id === "nacelle-clearance")!;
    assert.equal(clearance().value, expected);
    assert.equal(clearance().status, "info");
    const wider = { ...def, engine: { ...def.engine, nacelleWidthM: def.engine.nacelleWidthM + 1.0 } };
    assert.equal(clearance(wider).status, "warning");
    assert.equal(clearance(wider, 0.5).value, expected);
    assert.equal(clearance(wider, 0.5).status, "info");
  }
});

test("757: при допустимом подъёме гондола остаётся на своей продольной станции и проходит под крылом", () => {
  for (const def of [B757_RB211, B757_PW2037]) {
    const mount = def === B757_RB211 ? B757.nacelleByEngine.RB211 : B757.nacelleByEngine.PW2000;
    const limitAt = (b: number) => max757Raise(evaluate(def, [bypassRatio(b)], contextFor(def)).definition);
    assert.ok(limitAt(15) < 0, "BPR 15 does not fit even with zero raise");
    const stockMaxCm = Math.floor(limitAt(def.engine.bypassRatio) * 100);
    assert.equal(stockMaxCm, def === B757_RB211 ? 17 : 35);
    for (const bpr of [4, def.engine.bypassRatio, 8]) {
      const max = Math.min(0.4, Math.floor(limitAt(bpr) * 100) / 100);
      assert.ok(max >= 0);
      for (const raise of [0, max]) {
        const changed = evaluate(def, [bypassRatio(bpr), nacelleRaise(raise)], contextFor(def)).definition;
        const model = buildAircraft(changed);
        model.root.updateMatrixWorld(true);
        for (const side of [-1, 1]) {
          const meshes = (id: string) => model.parts.get(id)!.group.children.filter(o => o.userData.side === side) as THREE.Mesh[];
          const cowl = meshes("nacelles").filter(o => o.userData.offset);
          const wing = [...meshes("wing.box"), ...meshes("wing.highLift")];
          for (const mesh of [...wing, ...cowl]) (mesh.material as THREE.Material).side = THREE.DoubleSide;
          const bounds = cowl.reduce((box, mesh) => box.expandByObject(mesh), new THREE.Box3());
          near(bounds.min.x, mount.inlet_x, 1e-5);
          near((bounds.min.y + bounds.max.y) / 2, mount.axis_y + raise, 1e-5);
          const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
          let gap = Infinity;
          for (let z = -1.2; z <= 1.2; z += 0.2) {
            for (let x = bounds.min.x; x <= bounds.max.x; x += 0.12) {
              ray.ray.origin.set(x, 10, side * (mount.axis_z + z));
              const top = ray.intersectObjects(cowl, false)[0], underside = ray.intersectObjects(wing, false).at(-1);
              if (top && underside) gap = Math.min(gap, underside.point.y - top.point.y);
            }
          }
          assert.ok(Number.isFinite(gap) && gap >= 0.078, `${def.id}: B=${bpr}, raise=${raise}, side=${side}, gap=${gap}`);
        }
        model.root.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
      }
    }
  }
});

test("757: нос пилона входит в стенку воздухозаборника и оставляет канал свободным", () => {
  for (const [def, mount] of [[B757_RB211, B757.nacelleByEngine.RB211], [B757_PW2037, B757.nacelleByEngine.PW2000]] as const) {
    const model = buildAircraft(def);
    model.root.updateMatrixWorld(true);
    for (const side of [-1, 1]) {
      const parts = model.parts.get("nacelles")!.group.children.filter(o => o.userData.side === side) as THREE.Mesh[];
      const pylon = parts.find(o => !o.userData.offset)!;
      for (const mesh of parts) (mesh.material as THREE.Material).side = THREE.DoubleSide;
      for (const x of [0.68, 0.72, 0.76]) {
        const origin = new THREE.Vector3(mount.inlet_x + x, mount.axis_y, side * mount.axis_z);
        for (const angle of [-0.07, 0, 0.07]) {
          const ray = new THREE.Raycaster(origin, new THREE.Vector3(0, Math.cos(angle), Math.sin(angle)));
          const hits = ray.intersectObjects(parts, false);
          const shell = hits.filter(hit => hit.object !== pylon);
          const foot = hits.find(hit => hit.object === pylon);
          assert.ok(foot && shell.length >= 2, `${def.engine.name}, side ${side}, x ${x}`);
          assert.ok(shell[0].distance < foot.distance && foot.distance < shell.at(-1)!.distance);
        }
      }
    }
    model.root.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
  }
});

test("757 RB211: пилон оставляет общее сопло открытым до его передней кромки", () => {
  for (const bpr of [4, B757_RB211.engine.bypassRatio, 8]) {
    const changed = evaluate(B757_RB211, [bypassRatio(bpr)], contextFor(B757_RB211)).definition;
    const lengthK = changed.engine.nacelleLengthM / B757_RB211.engine.nacelleLengthM;
    for (const raise of [0, Math.floor(max757Raise(changed) * 100) / 100]) {
      const model = buildAircraft({ ...changed, engine: { ...changed.engine, nacelleRaiseM: raise } });
      model.root.updateMatrixWorld(true);
      for (const side of [-1, 1]) {
        const parts = model.parts.get("nacelles")!.group.children.filter(m => m.userData.side === side) as THREE.Mesh[];
        const pylon = parts.find(m => !m.userData.offset)!;
        const nozzle = parts.find(m => m.userData.offset?.x === 1.2)!;
        for (const mesh of [pylon, nozzle]) (mesh.material as THREE.Material).side = THREE.DoubleSide;
        const mount = B757.nacelleByEngine.RB211;
        for (const station of [4.50, 4.52, 4.65, 4.85, 5.05, 5.25, 5.49]) for (const angle of [-0.12, 0, 0.12]) {
          const origin = new THREE.Vector3(mount.inlet_x + station * lengthK, mount.axis_y + raise, side * mount.axis_z);
          const ray = new THREE.Raycaster(origin, new THREE.Vector3(0, Math.cos(angle), Math.sin(angle)));
          const lip = ray.intersectObject(nozzle).at(-1);
          const support = ray.intersectObject(pylon)[0];
          // The coincident end ring can be missed at exactly the first station.
          if (station > 4.50) assert.ok(lip);
          if (lip && support) assert.ok(support.distance > lip.distance, `side=${side} station=${station} B=${bpr} raise=${raise}`);
        }
      }
      model.root.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    }
  }
});

test("757: обе гондолы RB211 имеют общее сопло и соответствуют установочным размерам", () => {
  const model = buildAircraft(B757_RB211);
  model.root.updateMatrixWorld(true);
  for (const side of [-1, 1]) {
    const parts = model.parts.get("nacelles")!.group.children.filter(o => o.userData.side === side);
    const rings = parts.filter(o => (o as THREE.Mesh).geometry.type === "LatheGeometry");
    const shell = rings.reduce((box, ring) => box.expandByObject(ring), new THREE.Box3());
    near(shell.min.x, 16.84, 1e-4);
    near(shell.max.x - shell.min.x, 5.50, 1e-4);
    near(shell.max.z - shell.min.z, 2.46, 1e-4);
    near((shell.min.z + shell.max.z) / 2, side * 6.48, 1e-4);
    near(shell.min.y - B757.groundY, 0.8575, 1e-4);
    const engine = model.parts.get("engines")!.group.children.filter(o => o.userData.side === side);
    const spinner = new THREE.Box3().setFromObject(engine[0]);
    near(shell.max.x - spinner.min.x, 5.0359, 1e-4);
    const nozzle = rings.find(o => new THREE.Box3().setFromObject(o).max.x === shell.max.x) as THREE.Mesh;
    const vertices = nozzle.geometry.getAttribute("position");
    const lipRadii = [];
    for (let i = 0; i < vertices.count; i++) {
      if (Math.abs(vertices.getX(i) - shell.max.x) < 1e-4)
        lipRadii.push(Math.hypot(vertices.getY(i) - B757.nacelle.axis_y, vertices.getZ(i) - side * 6.48));
    }
    near(Math.min(...lipRadii), 0.765, 1e-4);
    near(Math.max(...lipRadii), 0.80, 1e-4);
  }
  model.root.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
});

test("757: PW2037 имеет два раздельных среза на обеих установленных гондолах", () => {
  const model = buildAircraft(B757_PW2037);
  model.root.updateMatrixWorld(true);
  for (const side of [-1, 1]) {
    const parts = model.parts.get("nacelles")!.group.children.filter(o => o.userData.side === side);
    const rings = parts.filter(o => (o as THREE.Mesh).geometry.type === "LatheGeometry");
    const shell = rings.reduce((box, ring) => box.expandByObject(ring), new THREE.Box3());
    near(shell.min.x, 16.61, 1e-4);
    near(shell.max.x - shell.min.x, 6.05, 1e-4);
    near(shell.max.z - shell.min.z, 2.69, 1e-4);
    near((shell.min.z + shell.max.z) / 2, side * 6.48, 1e-4);
    near(shell.min.y - B757.groundY, .7425, 1e-4);
  }
  const segments = nacelleSegments("pw2037", 1, 1);
  for (const [id, end] of [["reverser", 3.78], ["coreCowl", 4.92], ["nozzle", 6.05], ["plug", 5.94]] as const) {
    const geometry = segments.find(s => s.id === id)!.geometry;
    geometry.computeBoundingBox();
    near(geometry.boundingBox!.max.x, end, 1e-4);
  }
  segments.forEach(s => s.geometry.dispose());
  model.root.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
});

test("757: смеситель, выпускные каналы и опоры состыкованы в установленном масштабе", () => {
  for (const base of [B757_RB211, B757_PW2037]) {
    const rb = base === B757_RB211;
    const mount = rb ? B757.nacelleByEngine.RB211 : B757.nacelleByEngine.PW2000;
    for (const bpr of [4, base.engine.bypassRatio, 15]) {
      const def = evaluate(base, [bypassRatio(bpr)], contextFor(base)).definition;
      const model = buildAircraft(def);
      model.root.updateMatrixWorld(true);
      const kx = def.engine.nacelleLengthM / base.engine.nacelleLengthM;
      const kr = def.engine.nacelleWidthM / base.engine.nacelleWidthM;
      const origin = new THREE.Vector3(mount.inlet_x, mount.axis_y, mount.axis_z);
      const part = (id: string, name: string) => {
        const mesh = model.parts.get(id)!.group.children.find(o =>
          o instanceof THREE.Mesh && o.userData.side === 1 && o.geometry.name === name) as THREE.Mesh;
        assert.ok(mesh, name);
        (mesh.material as THREE.Material).side = THREE.DoubleSide;
        return mesh;
      };
      const bounds = (mesh: THREE.Mesh) => new THREE.Box3().setFromObject(mesh).translate(origin.clone().negate());
      const nozzle = part("nacelles", "nacelle-nozzle");
      const duct = part("engines", rb ? "rb-annular-mixer" : "pw-primary-duct");
      const cone = part("engines", rb ? "rb-exhaust-cone" : "pw-exhaust-centrebody");
      const stays = part("engines", rb ? "rb-collector-stays" : "pw-exhaust-case-struts");
      assert.equal(stays.userData.spin, null);
      const ray = new THREE.Raycaster();
      const count = rb ? 4 : 15;
      const probe = (rb ? .74 : .45) * kr;
      for (let i = 0; i < count; i++) {
        for (const halfway of [false, true]) {
          const angle = 2 * Math.PI * (i + (halfway ? .5 : 0)) / count;
          ray.set(origin.clone().add(new THREE.Vector3(6.2 * kx, probe * Math.cos(angle), probe * Math.sin(angle))), new THREE.Vector3(-1, 0, 0));
          assert.equal(ray.intersectObject(stays).length > 0, !halfway);
        }
      }
      if (rb) {
        assert.ok(bounds(duct).max.x < bounds(cone).max.x);
        assert.ok(bounds(cone).max.x < bounds(nozzle).max.x);
        // Between the splitter and the cone tip the two streams share the duct.
        ray.set(origin.clone().add(new THREE.Vector3(4.62 * kx, .15 * kr, 0)), new THREE.Vector3(0, 1, 0));
        assert.equal(ray.intersectObject(duct).length, 0);
        assert.ok(ray.intersectObject(nozzle).length > 0);
      } else {
        const tip = part("nacelles", "nacelle-plug");
        const sleeve = part("nacelles", "nacelle-coreCowl");
        const inner = part("engines", "pw-bypass-inner-wall");
        // Every circular joint shares its actual vertices on both parts.
        for (const [a, b, station, radius] of [[cone, tip, 5.48, .34], [duct, nozzle, 4.92, .692],
          [inner, sleeve, 3.30, .98]] as const) {
          near(bounds(a).max.x, station * kx, 1e-5);
          const point = origin.clone().add(new THREE.Vector3(station * kx, radius * kr, 0));
          for (const m of [a, b]) {
            const pos = m.geometry.getAttribute("position");
            const vertex = new THREE.Vector3();
            assert.ok(Array.from({ length: pos.count }, (_, j) =>
              vertex.fromBufferAttribute(pos, j).applyMatrix4(m.matrixWorld).distanceTo(point)).some(dist => dist < 1e-5));
          }
        }
      }
      model.root.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    }
  }
});

test("757: собственные векторные контуры имеют источник и отдельные длины корпуса/самолёта", () => {
  assert.equal(B757._source.revision, "H");
  assert.match(B757._source.sha256, /^[a-f0-9]{64}$/);
  assert.ok(B757._source.pages.some((p) => p.pdfPage === 20 && p.section === "2.2.1"));
  assert.equal(B757.baseLengthM, 46.97);
  assert.equal(B757.dimensions.overallLengthM, 47.32);
  const f = B757.fuselage;
  near(f.x[0], 0, 1e-9);
  near(f.x.at(-1)!, 46.97, 1e-9);
  for (const k of ["top", "bottom", "half_width"] as const) {
    assert.equal(f[k].length, f.x.length);
    assert.ok(f[k].every(Number.isFinite));
  }
  assert.ok(f.x.every((x, i) => i === 0 || x > f.x[i - 1]));
  assert.ok(f.top.every((y, i) => y >= f.bottom[i]));
  assert.ok(f.half_width.every((z) => z >= 0 && z <= 1.88 + 1e-6));
  const barrel = f.x.findIndex((x) => x === 10);
  near(f.top[barrel] - f.bottom[barrel], 4.01, 1e-6);
  near(2 * f.half_width[barrel], 3.76, 1e-6);
  // A cargo-door gap must never turn the underside into the roof.
  assert.ok(f.x.every((x, i) => x < 8 || x > 33.5 || f.top[i] - f.bottom[i] > 3.9));
});

test("757: крыло и оперение согласованы с размерами и тремя проекциями Boeing", () => {
  near(2 * B757.wing.tip_z, 38.05, 1e-6);
  near(2 * B757.htail.tip_z, 15.21, 1e-6);
  near(B757.wing.le.sweep_deg, 28, 1);
  assert.ok(B757.wing.dihedral_deg > 4 && B757.wing.dihedral_deg < 6);
  assert.ok(B757.htail.dihedral_deg > 6 && B757.htail.dihedral_deg < 10);
  for (let z = B757.wing.side_z; z <= B757.wing.tip_z; z += .25) {
    const le = B757.wing.le.x0 + B757.wing.le.slope * z;
    const te = Math.max(B757.wing.te_inner.x0, B757.wing.te_outer.x0 + B757.wing.te_outer.slope * z);
    assert.ok(te > le, `non-positive wing chord at z=${z}`);
  }
  const vt = B757.vtail.table;
  assert.equal(vt.y.length, vt.le.length);
  assert.equal(vt.y.length, vt.te.length);
  assert.ok(vt.y.every((y, i) => Number.isFinite(y) && (i === 0 || y > vt.y[i - 1])));
  // The slightly sloping fin cap ends at one upper aft vertex: zero chord at
  // that final contour point is legitimate, while interior stations must be wide.
  assert.ok(vt.le.every((x, i) => Number.isFinite(x) && Number.isFinite(vt.te[i]) &&
    (i === vt.y.length - 1 ? vt.te[i] >= x : vt.te[i] > x)));
  // The fin, rather than a stretched fuselage, gives the 47.32 m overall length.
  near(Math.max(...vt.te), 47.32, .03);
  const height = B757.vtail.tip_y - B757.groundY;
  assert.ok(height >= 13.49 && height <= 13.74);
  const roof = B757.halfHeight - B757.groundY;
  assert.ok(roof >= 6.25 && roof <= 6.45);
});

test("757: тележка соответствует подписанным 45/34 дюймам и шинам H40", () => {
  const g = B757.gear;
  near(g.noseX, 5.89, 1e-6);
  near(g.wheelbaseM, 18.29, 1e-6);
  near(g.axleSpacingM, 45 * .0254, 1e-6);
  near(2 * g.mainWheelGap, 34 * .0254, 1e-6);
  near(2 * g.mainR, 40 * .0254, 1e-6);
  near(g.mainTireW, 14.5 * .0254, 1e-6);
  near(2 * g.noseWheelGap, 24 * .0254, 1e-6);
  near(2 * g.noseR, 31 * .0254, 1e-6);
  assert.equal(g.mainAxlesPerStrut, 2);
  assert.ok(g.axleSpacingM > 2 * g.mainR); // The two axles' tyres do not intersect.
  assert.ok(2 * g.mainWheelGap > g.mainTireW);
  // Independent dimension on the footprint sheet: outside-to-outside width 8.55 m.
  near(2 * g.mainZ + 2 * g.mainWheelGap + g.mainTireW, 8.55, .02);
});

test("757: собственные три двери и два надкрыльевых выхода, правая первая дверь отличается", () => {
  const left = B757.featuresBySide.left;
  const right = B757.featuresBySide.right;
  for (const side of [left, right]) {
    assert.equal(side.filter((f) => f.kind === "door").length, 3);
    const exits = side.filter((f) => f.kind === "exit");
    assert.equal(exits.length, 2);
    assert.ok(exits.every((f) => f.x0 > 19 && f.x1 < 23));
    assert.ok(side.every((f) => f.x0 >= 0 && f.x1 <= 46.97 && f.x1 > f.x0 && f.y1 > f.y0));
  }
  const ld = left.find((f) => f.kind === "door")!;
  const rd = right.find((f) => f.kind === "door")!;
  near((ld.x0 + ld.x1) / 2, 5.05, 1e-6);
  near((rd.x0 + rd.x1) / 2, 4.78, 1e-6);
  near(ld.x1 - ld.x0, .84, 1e-6);
  near(rd.x1 - rd.x0, .76, 1e-6);
  near(ld.y1 - ld.y0, 1.83, 1e-6);
  near(rd.y1 - rd.y0, 1.65, 1e-6);
  assert.equal(B757.cargo.length, 2); // No optional early-production bulk door.
});

test("757: RR/PW имеют собственные станции и диаметры гондол", () => {
  const rr = B757.nacelleByEngine.RB211;
  const pw = B757.nacelleByEngine.PW2000;
  near(rr.inlet_x, 16.84, 1e-6);
  near(pw.inlet_x, 16.61, 1e-6);
  near(rr.width_m, 2.46, 1e-6);
  near(pw.width_m, 2.69, 1e-6);
  for (const n of [rr, pw]) {
    near(n.axis_z, 6.48, 1e-6);
    const clearance = n.axis_y - n.width_m / 2 - B757.groundY;
    assert.ok(clearance >= .74 - 1e-6 && clearance <= .86 + 1e-6);
  }
});
