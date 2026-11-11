import assert from "node:assert/strict";
import { test } from "node:test";
import D from "../data/ac/a321-doors.json" with { type: "json" };

const standard = D.variants.standard;
const acf = D.variants.acfXlr;
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-4, `${a} != ${b}`);

test("A321: текущие ceo и neo используют собственную обычную схему четырёх пар", () => {
  assert.deepEqual(D.defaults, { a321ceo: "standard", a321neo: "standard" });
  assert.deepEqual(standard.appliesTo, ["A321-100", "A321-200", "A321neo"]);
  assert.deepEqual(standard.cabinOpenings.map(d => d.id), ["door1", "forwardEmergency", "aftEmergency", "door4"]);
  assert.deepEqual(standard.cabinOpenings.map(d => d.locationFromNoseM), [5.02, 13.84, 24.79, 36.58]);
  assert.deepEqual(standard.cabinOpenings.map(d => d.kind), ["door", "exit", "exit", "door"]);
  assert.equal(standard.cabinOpenings.flatMap(d => d.sides).length, 8);
  assert.equal(standard.layouts.singleClass220.pdfPage, 96);
  assert.equal(standard.identificationPdfPage, 113);
  assert.ok(standard.cabinOpenings.every(d => d.sourcePages.location === 114));
});

test("A321 ACF/XLR: две надкрыльевые пары и опциональность только в указанной компоновке", () => {
  assert.deepEqual(acf.appliesTo, ["A321neo-ACF", "A321neo-XLR"]);
  assert.deepEqual(acf.cabinOpenings.map(d => d.locationFromNoseM), [5.04, 18.7, 19.54, 26.82, 36.47]);
  assert.equal(acf.cabinOpenings.flatMap(d => d.sides).length, 10);
  const overwing = acf.cabinOpenings.filter(d => d.id.includes("Overwing"));
  assert.equal(overwing.length, 2);
  close(overwing[1].locationFromNoseM - overwing[0].locationFromNoseM, 0.84);
  assert.deepEqual(acf.layouts.singleClass244.optionalOpeningIds, []);
  assert.deepEqual(acf.layouts.singleClass244.appliesTo, ["A321neo-ACF"]);
  assert.deepEqual(acf.layouts.twoClass206.optionalOpeningIds, ["aftOverwing"]);
  assert.equal(acf.layouts.twoClass206.pdfPage, 99);
  assert.deepEqual(overwing[1].optionalInLayouts, ["twoClass206"]);
  assert.ok(!("optionalInLayouts" in overwing[0]));
});

test("A321: свободный проход не подменяет внешний контур и сохраняет единицы метров", () => {
  for (const variant of Object.values(D.variants)) {
    for (const d of variant.cabinOpenings) {
      const b = d.exteriorBBox;
      assert.ok(b.x1 - b.x0 > d.clearOpening.widthM);
      assert.ok(b.y1 - b.y0 > d.clearOpening.heightM);
      if (d.kind === "door") {
        assert.deepEqual(d.clearOpening, { widthM: 0.81, heightM: 1.85, dimensionKind: "clear-opening" });
      } else if (d.id.includes("Overwing")) {
        assert.equal(d.clearOpening.widthM, 0.57);
        assert.equal(d.clearOpening.heightM, 1.04);
      } else {
        assert.equal(d.clearOpening.widthM, 0.76);
        assert.equal(d.clearOpening.heightM, 1.52);
      }
    }
  }
  assert.equal(D.coordinateSystem.lengthM, 44.51);
  assert.equal(D.coordinateSystem.fuselageHeightM, 4.14);
  assert.equal(D.coordinateSystem.unit, "m");
});

test("A321: носовая система координат и стрелка центра прохода хранятся раздельно", () => {
  for (const variant of Object.values(D.variants)) {
    for (const d of [...variant.cabinOpenings, ...variant.cargoOpenings]) {
      const b = d.measuredExteriorBBox;
      close((b.x0 + b.x1) / 2 - d.locationFromNoseM, d.geometry.measuredCenterMinusLocationReferenceM);
      assert.equal(d.geometry.longitudinalAlignment, "unshifted-nose-based-vector-view");
      // No silent per-door recentering to a different reference datum.
      assert.equal(d.exteriorBBox.x0, b.x0);
      assert.equal(d.exteriorBBox.x1, b.x1);
    }
  }
  const aft = standard.cabinOpenings[3];
  assert.ok(Math.abs(aft.geometry.measuredCenterMinusLocationReferenceM) > 0.09);
  assert.equal(standard.cabinOpenings[1].locationReference, "center-of-free-aisle");
});

test("A321: скрытые края отмечены реконструкцией, видимые края не сдвигаются", () => {
  const reconstructed = [...standard.cabinOpenings, ...acf.cabinOpenings]
    .filter(d => d.geometry.method !== "vector-outline");
  assert.deepEqual(reconstructed.map(d => d.id), ["aftEmergency", "door3"]);
  assert.ok(reconstructed.every(d => "reconstruction" in d.geometry && d.geometry.approximate));
  const [normalAft, acfDoor3] = reconstructed;
  assert.equal(normalAft.exteriorBBox.y1, normalAft.measuredExteriorBBox.y1);
  assert.equal(acfDoor3.exteriorBBox.y0, acfDoor3.measuredExteriorBBox.y0);
  const reference = standard.cabinOpenings[1].exteriorBBox;
  for (const d of reconstructed) close(d.exteriorBBox.y1 - d.exteriorBBox.y0, reference.y1 - reference.y0);
});

test("A321: грузовые двери только справа, разница подписей ACF не скрыта", () => {
  assert.deepEqual(standard.cargoOpenings.map(d => d.locationFromNoseM), [8.16, 29.62, 33.22]);
  assert.deepEqual(acf.cargoOpenings.map(d => d.locationFromNoseM), [8.56, 30.02, 33.22]);
  for (const variant of Object.values(D.variants)) {
    assert.deepEqual(variant.cargoOpenings.map(d => d.clearOpening.widthM), [1.82, 1.82, 0.95]);
    assert.deepEqual(variant.cargoOpenings.map(d => d.clearOpening.heightM), [1.24, 1.23, 0.77]);
    assert.ok(variant.cargoOpenings.every(d => d.kind === "cargo" && d.sides.join() === "R"));
  }
  // The ACF drawing and the dimension text disagree by about 0.4 m. Keep
  // both readings rather than presenting a corrected schematic as source data.
  assert.ok(acf.cargoOpenings.slice(0, 2).every(d => d.geometry.measuredCenterMinusLocationReferenceM < -0.4));
});

test("A321: все контуры конечны, внутри фюзеляжа, без наложений дверей одного ряда", () => {
  const pages = new Set(Object.keys(D.source.pages).map(Number));
  assert.equal(D.source.pdfPageCount, 471);
  assert.match(D.source.sha256, /^[0-9a-f]{64}$/);
  for (const variant of Object.values(D.variants)) {
    const all = [...variant.cabinOpenings, ...variant.cargoOpenings];
    assert.equal(new Set(all.map(d => d.id)).size, all.length);
    for (const d of all) {
      const b = d.exteriorBBox;
      assert.ok(Object.values(b).every(Number.isFinite));
      assert.ok(0 < b.x0 && b.x0 < b.x1 && b.x1 < D.coordinateSystem.lengthM);
      assert.ok(-2.07 < b.y0 && b.y0 < b.y1 && b.y1 < 2.07);
      assert.ok(Object.values(d.sourcePages).every(p => pages.has(p)));
    }
    for (const row of [variant.cabinOpenings, variant.cargoOpenings]) {
      for (let i = 1; i < row.length; i++) assert.ok(row[i - 1].exteriorBBox.x1 < row[i].exteriorBBox.x0);
    }
  }
});
