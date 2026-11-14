import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { installationGeometry } from "../web/scene/pylonGeometry.ts";
import { pylon757Tu } from "../web/scene/pylon757Tu.ts";
import { nacelleSegments } from "../web/scene/shapes.ts";

// A sloping installed wing datum exercises the aft saddle without supplying
// the retired vertical wing/trapezoid mesh from aircraft.ts.
const wing = (u: number) => new THREE.Vector3(4.8 + 6 * u, 2.0 + .14 * u, 0);
const wingUpper = (u: number) => wing(u).add(new THREE.Vector3(0, .24 * Math.sin(Math.PI * u) ** .5, 0));

test("PS-90A pylon has a rounded complete body, a straight high roof and short upper-wing saddle and no inlet-duct intrusion", () => {
  const segments = nacelleSegments("ps90a", 1, 1);
  const { fairing, hardware } = installationGeometry(pylon757Tu.ps90a, segments, 1, 1, wing, undefined, wingUpper);
  assert.equal(fairing.userData.fairingProfile, "ps90a");
  const p = fairing.getAttribute("position"), n = fairing.getAttribute("normal"), ix = fairing.index!;
  const { count, sides, nose, fore, seated, aft } = fairing.userData.pylonLoft;
  assert.ok(aft[0] > wing(.30).x && aft[0] < wing(.40).x, "the lower fairing must extend aft into the wing box");
  assert.ok(nose < 1 && nose > .2, "the rounded foot must reach forward along the outer inlet crown");
  const edges = new Map<string, number>();
  const a = new THREE.Vector3(), b = a.clone(), c = a.clone();
  let volume = 0;
  for (let i = 0; i < p.count; i++) {
    assert.ok(Number.isFinite(p.getX(i) + p.getY(i) + p.getZ(i)));
    assert.ok(Math.abs(a.fromBufferAttribute(n, i).length() - 1) < 1e-5);
    if (p.getX(i) < 1.15) assert.ok(Math.hypot(p.getY(i), p.getZ(i)) > 1.0,
      "the forward fairing enters the inlet duct");
  }
  for (let i = 0; i < ix.count; i += 3) {
    const ids = [ix.getX(i), ix.getX(i + 1), ix.getX(i + 2)];
    a.fromBufferAttribute(p, ids[0]); b.fromBufferAttribute(p, ids[1]); c.fromBufferAttribute(p, ids[2]);
    volume += a.dot(b.clone().cross(c)) / 6;
    assert.ok(b.clone().sub(a).cross(c.clone().sub(a)).lengthSq() > 1e-18, "a collapsed loft triangle remains");
    for (let k = 0; k < 3; k++) {
      const key = [ids[k], ids[(k + 1) % 3]].sort((a, b) => a - b).join("/");
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  assert.ok(volume > 0, "the physical pylon is inside out");
  assert.ok([...edges.values()].every(n => n === 2), "the pylon is not a closed two-manifold solid");
  const row = Math.round(count * .30), x = p.getX(row * sides), top = p.getY(row * sides);
  const floor = p.getY(row * sides + sides / 2), quarter = p.getY(row * sides + sides / 4);
  assert.ok(top - floor > .25, "the pylon has collapsed to a thin triangular web");
  assert.ok(Math.abs(quarter - (top + floor) / 2) < .02, "the section is a sloping triangle");
  assert.ok(x > fore && x < seated[0]);
  assert.ok((fore - nose) / (wing(0).x - nose) < .18, "the nose rounding occupies too much of the exposed fairing");
  const last = count * sides;
  assert.ok(p.getY(last) < wingUpper(.38).y && p.getY(last + sides / 2) > wing(.38).y,
    "the aft end must close inside the wing box");
  const { upperSeat } = fairing.userData.pylonLoft;
  const straightRows = Array.from({ length: count + 1 }, (_, i) => i * sides)
    .filter(i => p.getX(i) >= fore && p.getX(i) <= wing(0).x);
  for (let j = 1; j < straightRows.length - 1; j++) {
    const i = straightRows[j], a = straightRows[0], b = straightRows.at(-1)!;
    const expected = THREE.MathUtils.lerp(p.getY(a), p.getY(b), (p.getX(i) - p.getX(a)) / (p.getX(b) - p.getX(a)));
    assert.ok(Math.abs(p.getY(i) - expected) < 1e-6, "the high roof has regained a shoulder bend");
  }
  assert.ok(Math.abs(p.getY(straightRows.at(-1)!) - upperSeat[1]) < .09, "the roof must reach the wing leading-edge datum");
  const ia = straightRows[0], ib = straightRows.at(-1)!;
  const slope = (p.getY(ib) - p.getY(ia)) / (p.getX(ib) - p.getX(ia));
  for (let i = ib; i < p.count - 2 && p.getX(i) < wing(.08).x; i += sides) {
    const line = p.getY(ib) + slope * (p.getX(i) - p.getX(ib));
    assert.ok(p.getY(i) <= line + .018, "an exposed ridge rises above the fairing at the wing nose");
  }
  for (const role of ["beam", "frontMount", "middleMount", "rearMount", "thrustLinks"]) {
    assert.equal(hardware.filter(g => g.userData.installationRole === role).length, 1);
  }
  [...segments.map(s => s.geometry), fairing, ...hardware].forEach(g => g.dispose());
});

test("both Tu-214 variants retain the PS-90A body at BPR and mounting-height endpoints", async () => {
  const { AIRCRAFT } = await import("../web/aircraftCatalog.ts");
  const { buildAircraft, installationLimits } = await import("../web/scene/aircraft.ts");
  const { applyDefinition, bypassRatio, nacelleRaise } = await import("../src/levers.ts");
  for (const id of ["tu214-ps90a", "tu214-ps90a-factory"]) for (const bpr of [4, 15]) {
    const resized = applyDefinition(AIRCRAFT[id], [bypassRatio(bpr)]);
    const limit = Math.min(.4, Math.floor(installationLimits(resized).raise * 100) / 100);
    for (const height of new Set([0, limit])) {
      const model = buildAircraft(applyDefinition(resized, [nacelleRaise(height)]));
      const nacelles = model.parts.get("nacelles")!.group.children as THREE.Mesh[];
      const fairings = nacelles.filter(m => m.geometry.userData.installationRole === "fairing");
      assert.equal(fairings.length, 2);
      const wings = model.parts.get("wing.box")!.group.children as THREE.Mesh[];
      for (const fairing of fairings) {
        assert.equal(fairing.geometry.userData.fairingProfile, "ps90a", "the legacy triangular pylon has returned");
        const p = fairing.geometry.getAttribute("position");
        const side = fairing.userData.side;
        const axis = nacelles.find(m => m.userData.side === side && m.geometry.userData.reverserOrigin)!.geometry.userData.reverserOrigin;
        for (let i = 0; i < p.count; i++) {
          const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
          assert.ok(Number.isFinite(x + y + z));
          if (i % 40 !== 0) continue;
          // The saddle may enter the lower wing skin. It must never emerge
          // through the real upper wing surface at any accepted lever endpoint.
          const hits = new THREE.Raycaster(new THREE.Vector3(x, 10, z + .001), new THREE.Vector3(0, -1, 0))
            .intersectObjects(wings.filter(w => w.userData.side === side));
          if (x > axis.x + fairing.geometry.userData.pylonLoft.upperSeat[0] + .15) {
            assert.ok(hits.length > 0, "the upper saddle is exposed when the movable slats leave wing.box");
          }
          if (hits.length) assert.ok(y < hits[0].point.y + .004,
            `${id} bpr=${bpr} raise=${height}: pylon emerges above the wing i=${i} x=${x} y=${y} skin=${hits[0]?.point.y}`);
        }
        assert.ok(axis, "the original engine/reverser installation datum is retained");
      }
      model.root.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    }
  }
});
