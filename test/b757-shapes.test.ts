import assert from "node:assert/strict";
import { test } from "node:test";
import B757 from "../data/ac/b757-shapes.json" with { type: "json" };

const near = (actual: number, reference: number, tolerance: number) =>
  assert.ok(Math.abs(actual - reference) <= tolerance, `${actual} differs from ${reference} by more than ${tolerance}`);

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
