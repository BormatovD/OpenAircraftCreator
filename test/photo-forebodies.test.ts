import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { AIRCRAFT } from "../web/aircraftCatalog.ts";
import { useShapes } from "../web/scene/shapeSet.ts";
import { fuselageGeometry, fuselageSection, fuselageHalfWidthAt, cockpitHullFacets } from "../web/scene/shapes.ts";
import { cockpitGlazing } from "../web/scene/cockpit.ts";
import { facetWidth } from "../web/scene/cockpitSurfaces.ts";

for (const id of ["tu214-ps90a", "b757-200-rb", "b757-200-pw"] as const) {
  test(`${id}: photo forebody removes the long crown and belly step without changing the barrel`, () => {
    const def=AIRCRAFT[id], f=def.fuselage, shape=useShapes(def);
    const g=fuselageGeometry(f), p=g.getAttribute("position"), n=g.getAttribute("normal");
    assert.ok(p.array.every(Number.isFinite) && n.array.every(Number.isFinite));
    g.computeBoundingBox(); const size=g.boundingBox!.getSize(new THREE.Vector3());
    assert.ok(Math.abs(size.x-f.lengthM)<1e-5);
    assert.ok(Math.abs(size.z-f.widthM)<1e-5);
    if (id === "tu214-ps90a") {
      // Visible roof landmarks on the owner's 880 × 440 RA-64549 photograph.
      // Map once with the nose/body length and straight barrel; compare the
      // rendered mesh rather than the source spline, which the glazing can clip.
      const roof = new Map<number, number>();
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i);
        if (x < 6) roof.set(x, Math.max(roof.get(x) ?? -Infinity, p.getY(i)));
      }
      const rows = [...roof];
      for (let i = 1; i < rows.length; i++) {
        assert.ok(rows[i][1] >= rows[i-1][1] - 1e-5, "no dip at the windscreen sill");
      }
      const outlinePx = [[37,263], [44,258.5], [49,256], [58,249], [68,239.5],
        [77,234.5], [84,232], [90,230.5], [105,228.5]];
      for (const [px, py] of outlinePx) {
        const x = (px - 28.5) * 45.22 / (834 - 28.5);
        const i = rows.findIndex(([station]) => station >= x);
        assert.ok(i > 0);
        const [x0, y0] = rows[i-1], [x1, y1] = rows[i];
        const height = y0 + (y1 - y0) * (x - x0) / (x1 - x0);
        const projectedY = 263 - height * 72 / 4.10;
        assert.ok(Math.abs(projectedY - py) <= 2, `photo roof at x=${px} px`);
      }
    } else {
      // Upper outline digitised independently from Boeing D6-58327 Rev H,
      // §2.2.1. Read the crown of the final mesh at the published side-view scale.
      const row = g.userData.radialSegments + 1;
      const crownVertex = (rowIndex: number) => rowIndex * row + g.userData.radialSegments / 4;
      for (const [x, upper] of [[1, 0.06], [1.5, 0.60], [2, 0.99], [2.5, 1.27],
        [3, 1.49], [3.5, 1.64], [4, 1.72], [5, 1.85], [6, 1.95]]) {
        let i = 1;
        while (p.getX(crownVertex(i)) < x) i++;
        const lo = crownVertex(i - 1), hi = crownVertex(i);
        const t = (x - p.getX(lo)) / (p.getX(hi) - p.getX(lo));
        const height = THREE.MathUtils.lerp(p.getY(lo), p.getY(hi), t);
        assert.ok(Math.abs(height - upper) < 0.05, `757 crown at ${x} metres`);
      }
    }
    for(let x=3.1;x<4.5;x+=.01) {
      const a=fuselageSection(f,x), b=fuselageSection(f,x+.01);
      assert.ok(Math.abs((a.cy-a.hh)-(b.cy-b.hh))<.002,"no inherited belly step");
    }
    const join=id==="tu214-ps90a" ? 6.5 : 8.5;
    for(const x of [join-.1,join,join+.1]) {
      const s=fuselageSection(f,x);
      assert.ok(Math.abs(s.hw-f.widthM/2)<1e-6);
      assert.ok(Math.abs(s.hh-f.heightM/2)<1e-6 && Math.abs(s.cy)<1e-6);
    }
    const tip=shape.fuselage.tipBlendM!, e=1e-5;
    for(const key of ["hw","hh"] as const) {
      const a=fuselageSection(f,tip-e)[key], b=fuselageSection(f,tip)[key], c=fuselageSection(f,tip+e)[key];
      assert.ok(Math.abs((b-a)/e-(c-b)/e)<.02,"round apex joins without a tangent jump");
    }
    const row=g.userData.radialSegments+1;
    for(let i=0;i<p.count;i+=row) {
      const a=new THREE.Vector3().fromBufferAttribute(n,i), b=new THREE.Vector3().fromBufferAttribute(n,i+row-1);
      assert.ok(a.distanceTo(b)<1e-6,"UV seam has shared normals");
      assert.ok(Math.abs(a.length()-1)<1e-6);
    }
    g.dispose();
  });

  test(`${id}: skin behind the side panes rounds smoothly into the fuselage`, () => {
    const def = AIRCRAFT[id];
    useShapes(def);
    const hull = fuselageGeometry(def.fuselage);
    const p = hull.getAttribute("position"), row = hull.userData.radialSegments + 1;
    // Cross-section four metres aft of the nose, through the former crease.
    let start = 0;
    for (let i = 0; i < p.count; i += row)
      if (Math.abs(p.getX(i) - 4) < Math.abs(p.getX(start) - 4)) start = i;
    const at = (j: number) => new THREE.Vector3().fromBufferAttribute(p, start + j);
    for (let j = 5; j < 35; j++) {
      const v = at(j);
      const before = v.clone().sub(at(j - 1)), after = at(j + 1).sub(v);
      assert.ok(before.angleTo(after) < THREE.MathUtils.degToRad(5), "no hard corner on a 2.5° mesh");
      assert.ok(Math.abs(fuselageHalfWidthAt(def.fuselage, v.x, v.y) - v.z) < 0.001,
        "fittings use the same surface as the mesh");
    }
    hull.dispose();
  });

  test(`${id}: six flat panes share pillars and sit on the actual hull mesh`, () => {
    const def=AIRCRAFT[id], f=def.fuselage;
    useShapes(def);
    const panels=cockpitHullFacets(f);
    assert.equal(panels.length,3);
    for(const [a,b,edge] of [[panels[0],panels[1],[panels[0].polygon[2],panels[0].polygon[3]]],
      [panels[1],panels[2],[panels[1].polygon[2],panels[1].polygon[3]]]] as const) {
      for(const [x,y] of edge) assert.ok(Math.abs(facetWidth(a,x,y)-facetWidth(b,x,y))<1e-9);
    }
    const hull=new THREE.Mesh(fuselageGeometry(f),new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
    hull.updateMatrixWorld();
    const panes=cockpitGlazing(f), glass=panes.filter(g=>g.userData.tone==="glass");
    assert.equal(glass.length,6);
    assert.equal(panes.filter(g=>g.userData.tone==="glassFrame").length,6);
    const ray=new THREE.Raycaster();
    for(const g of glass) {
      const p=g.getAttribute("position"), n=g.getAttribute("normal");
      const origin=new THREE.Vector3().fromBufferAttribute(p,0), normal=new THREE.Vector3().fromBufferAttribute(n,0);
      for(let i=0;i<p.count;i++) {
        const v=new THREE.Vector3().fromBufferAttribute(p,i), ni=new THREE.Vector3().fromBufferAttribute(n,i);
        assert.ok(v.toArray().every(Number.isFinite) && ni.toArray().every(Number.isFinite));
        assert.ok(Math.abs(v.clone().sub(origin).dot(normal))<1e-5,"pane is planar, not a curved decal");
        assert.ok(normal.distanceTo(ni)<1e-5);
        if(i%39===0) {
          ray.set(v.clone().addScaledVector(normal,.05),normal.clone().negate());
          const hit=ray.intersectObject(hull)[0];
          assert.ok(hit,"glass is backed by the hull");
          const gap=hit.distance-.05;
          assert.ok(gap>.009 && gap<.04,`glass neither buried nor floating: gap=${gap}`);
        }
      }
    }
    for(const g of panes)g.dispose();
    hull.geometry.dispose();hull.material.dispose();
  });
}

test("Tu-214: side sections turn gradually under the cockpit sills", () => {
  const aircraft = AIRCRAFT["tu214-ps90a"];
  useShapes(aircraft);
  const hull = fuselageGeometry(aircraft.fuselage);
  const p = hull.getAttribute("position");
  const segments = hull.userData.radialSegments, stride = segments + 1;
  for (const x of [2.25, 2.65, 3, 3.35]) {
    let start = 0;
    for (let i = stride; i < p.count; i += stride)
      if (Math.abs(p.getX(i) - x) < Math.abs(p.getX(start) - x)) start = i;
    let checked = 0;
    for (let j = 0; j < segments / 4; j++) {
      const v = new THREE.Vector3().fromBufferAttribute(p, start + j);
      if (v.y < -0.15 || v.y > 0.43) continue;
      const prev = new THREE.Vector3().fromBufferAttribute(p, start + (j + segments - 1) % segments);
      const next = new THREE.Vector3().fromBufferAttribute(p, start + j + 1);
      assert.ok(v.clone().sub(prev).angleTo(next.sub(v)) < THREE.MathUtils.degToRad(6.5),
        `sill curvature at x=${x}, y=${v.y}`);
      checked++;
    }
    assert.ok(checked >= 5);
  }
  hull.dispose();
});

test("757-200: glazing follows the TF-FIW side-photo outline on both engine variants", () => {
  for (const id of ["b757-200-rb", "b757-200-pw"] as const) {
    const def = AIRCRAFT[id];
    useShapes(def);
    const panes = cockpitGlazing(def.fuselage);
    const bounds = new THREE.Box3();
    for (const g of panes) {
      if (g.userData.tone === "glass") {
        g.computeBoundingBox();
        bounds.union(g.boundingBox!);
      }
      g.dispose();
    }
    // Visible glass extremities digitised in metres after registering the full fuselage.
    assert.ok(Math.abs(bounds.min.x - 1.18) < 0.15);
    assert.ok(Math.abs(bounds.max.x - 3.05) < 0.09);
    assert.ok(Math.abs(bounds.min.y - 0.04) < 0.08);
    assert.ok(Math.abs(bounds.max.y - 0.69) < 0.08);
  }
});
