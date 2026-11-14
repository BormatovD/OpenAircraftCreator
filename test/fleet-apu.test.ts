import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { AIRCRAFT } from "../web/aircraftCatalog.ts";
import { useShapes } from "../web/scene/shapeSet.ts";
import { fuselageGeometry, fuselageHalfWidthAt, fuselageSection } from "../web/scene/shapes.ts";
import { cutFleetApuOpenings, fleetApu, fleetApuVariantFor } from "../web/scene/fleetApu.ts";

const ids = ["a319ceo", "a319neo", "a320ceo", "a320neo", "a321ceo", "a321neo", "b737-300", "b737-800", "b737-8", "b757-200-rb", "b757-200-pw"];

test("APU reference selection follows airframe variant independently of main engine", () => {
  for (const id of ids) {
    const def = AIRCRAFT[id], variant = fleetApuVariantFor(def)!;
    assert.ok(variant.sources.length >= 2);
    assert.equal(fleetApuVariantFor({ ...def, engine: AIRCRAFT["b757-200-pw"].engine })!.id, variant.id);
    assert.match(variant.limitations, /Эскиз/);
  }
  assert.equal(fleetApuVariantFor(AIRCRAFT["b737-300"])!.id, "85-129");
  assert.equal(fleetApuVariantFor(AIRCRAFT["b737-800"])!.id, "131-9b");
  assert.equal(fleetApuVariantFor(AIRCRAFT["b737-8"])!.id, "131-9b");
  assert.equal(fleetApuVariantFor(AIRCRAFT["b757-200-rb"])!.id, "331-200er");
  assert.equal(fleetApuVariantFor(AIRCRAFT["b757-200-pw"])!.id, "331-200er");
  assert.ok(!fleetApuVariantFor(AIRCRAFT.a320neo)!.referenceConfiguration.includes("neoneo"));
  assert.equal(fleetApu(AIRCRAFT["tu214-ps90a"]), null);
});

test("all fleet APU assemblies stay in the tail and inside the shell at length/section extremes", () => {
  for (const id of ids) for (const delta of [-6, 0, 8]) for (const scale of [.85, 1, 1.15]) {
    const base = AIRCRAFT[id], def = { ...base, fuselage: { ...base.fuselage,
      lengthM: base.fuselage.lengthM + delta, widthM: base.fuselage.widthM * scale, heightM: base.fuselage.heightM * scale } };
    const f = def.fuselage, pack = fleetApu(def)!;
    const names = new Set<string>();
    for (const g of [...pack.internal, ...pack.external]) {
      assert.ok(!names.has(g.name), `${id}: unique name ${g.name}`); names.add(g.name);
      assert.ok(["detailSteel", "detailDark", "detailPanel"].includes(g.userData.tone));
      const p = g.getAttribute("position");
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        assert.ok(Number.isFinite(x + y + z));
        assert.ok(x > f.lengthM - 7 && x < f.lengthM + .012, `${id}: tail station ${g.name}`);
        if (g.userData.apuLayer !== "internal") continue;
        const s = fuselageSection(f, x);
        assert.ok(y < s.cy + s.hh + 1e-5 && y > s.cy - s.hh - 1e-5, `${id}: vertical fit ${g.name}`);
        assert.ok(Math.abs(z) <= fuselageHalfWidthAt(f, x, y) + 1e-5, `${id}: lateral fit ${g.name}`);
      }
    }
    assert.ok(pack.internal.some(g => g.userData.apuRole === "generator"));
    assert.ok(pack.internal.some(g => g.userData.apuRole === "intake-duct"));
    assert.ok(pack.internal.some(g => g.userData.apuRole === "exhaust-duct"));
    [...pack.internal, ...pack.external].forEach(g => g.dispose());
  }
});

test("inlet faces the documented side and intake doors move outward at half travel", () => {
  const moved = new THREE.Vector3();
  const forward = new THREE.Vector3(-1, 0, 0), up = new THREE.Vector3(0, 1, 0);
  const starboard = forward.clone().cross(up).normalize();
  assert.deepEqual(starboard.toArray(), [0, 0, -1]);
  for (const id of ids) {
    const pack = fleetApu(AIRCRAFT[id])!, door = pack.external.find(g => g.userData.apuDoor)!;
    assert.ok(pack.intake.point.dot(starboard) > 0, `${id}: inlet on physical right`);
    assert.ok(pack.intake.outward.dot(starboard) > .2, `${id}: outward points to physical right`);
    assert.ok(pack.camera.direction.dot(starboard) > .5, `${id}: camera on physical right`);
    if (id.startsWith("a")) assert.ok(pack.intake.outward.y < -.7, id);
    else assert.ok(pack.intake.outward.dot(starboard) > .5, id);
    if (id.startsWith("b757")) assert.ok(pack.intake.outward.y > .6, id);
    const { pivot, axis, angle } = door.userData.apuDoor;
    const q = new THREE.Quaternion().setFromAxisAngle(axis, angle * .5);
    const p = door.getAttribute("position"), front = new THREE.Vector3().fromBufferAttribute(p, 0);
    moved.copy(front).sub(pivot).applyQuaternion(q).add(pivot).sub(front);
    assert.ok(moved.dot(pack.intake.outward) > .1, `${id}: door opens toward outside`);
    assert.ok(pack.camera.direction.dot(pack.intake.outward) > .5, `${id}: inlet camera visibility`);
    const n = door.getAttribute("normal"), doorIndex = door.index!;
    const a = new THREE.Vector3().fromBufferAttribute(p, doorIndex.getX(0));
    const b = new THREE.Vector3().fromBufferAttribute(p, doorIndex.getX(1));
    const c = new THREE.Vector3().fromBufferAttribute(p, doorIndex.getX(2));
    const faceNormal = b.sub(a).cross(c.sub(a)).normalize();
    assert.ok(faceNormal.dot(pack.intake.outward) > .8, `${id}: reflected winding stays outward`);
    assert.ok(new THREE.Vector3().fromBufferAttribute(n, doorIndex.getX(0)).dot(faceNormal) > .98, `${id}: reflected normal matches winding`);
    [...pack.internal, ...pack.external].forEach(g => g.dispose());
  }
});

function uvArea(g: THREE.BufferGeometry) {
  const p = g.getAttribute("uv"), ix = g.index;
  let area = 0;
  for (let i = 0; i < (ix?.count ?? p.count); i += 3) {
    const a = ix ? ix.getX(i) : i, b = ix ? ix.getX(i + 1) : i + 1, c = ix ? ix.getX(i + 2) : i + 2;
    area += Math.abs((p.getX(b) - p.getX(a)) * (p.getY(c) - p.getY(a)) - (p.getX(c) - p.getX(a)) * (p.getY(b) - p.getY(a))) / 2;
  }
  return area;
}

test("APU intake throats are open wall transitions joined to the duct inlet", () => {
  const point = new THREE.Vector3(), other = new THREE.Vector3();
  for (const id of ids) {
    const pack = fleetApu(AIRCRAFT[id])!;
    const throat = pack.external.find(g => g.userData.apuRole === "intake-throat")!;
    const duct = pack.internal.find(g => g.userData.apuRole === "intake-duct")!;
    const p = throat.getAttribute("position"), d = duct.getAttribute("position"), index = throat.index!;
    const row = throat.userData.transitionRingVertices as number;
    assert.ok(row > 4);
    assert.equal(p.count, row * 2, `${id}: two open transition rings`);
    for (let i = 0; i < index.count; i += 3) {
      const ringIds = [0, 1, 2].map(j => Math.floor(index.getX(i + j) / row));
      assert.ok(ringIds.includes(0) && ringIds.includes(1), `${id}: wall triangle, no end cap`);
    }
    for (let i = row; i < p.count; i++) {
      point.fromBufferAttribute(p, i);
      let gap = Infinity;
      for (let j = 0; j < row; j++) gap = Math.min(gap, point.distanceTo(other.fromBufferAttribute(d, j)));
      assert.ok(gap < 1e-6, `${id}: transition meets actual duct ring`);
    }
    [...pack.internal, ...pack.external].forEach(g => g.dispose());
  }
});

test("inlet clips remove exactly their UV aperture area without dropping coarse hull quads", () => {
  for (const id of ["a320ceo", "b737-300", "b737-8", "b757-200-rb"]) {
    const def = AIRCRAFT[id], pack = fleetApu(def)!;
    useShapes(def);
    const hull = fuselageGeometry(def.fuselage), cut = cutFleetApuOpenings(hull, def.fuselage, pack.openings);
    const expected = pack.openings.reduce((sum, o) => sum + (o.x1 - o.x0) / def.fuselage.lengthM * (o.angle1 - o.angle0) / (2 * Math.PI), 0);
    assert.ok(Math.abs(uvArea(hull) - uvArea(cut) - expected) < 2e-8, `${id}: exact aperture area`);
    assert.ok(cut.index, `${id}: indexed hull preserved`);
    assert.ok(cut.getAttribute("position").count < hull.getAttribute("position").count + 300, `${id}: only clipped boundary adds vertices`);
    assert.equal(cut.getAttribute("position").count, cut.getAttribute("uv").count);
    const p = cut.getAttribute("position"), n = cut.getAttribute("normal");
    for (let i = 0; i < p.count; i++) assert.ok(Number.isFinite(n.getX(i) + n.getY(i) + n.getZ(i)));
    hull.dispose(); cut.dispose(); [...pack.internal, ...pack.external].forEach(g => g.dispose());
  }
});
