// Остекление кабины — отдельной геометрией поверх обшивки, по контурам типа (A320 — Airbus AC 2-2-0, 737 — сетка).
// Лобовые стёкла берутся с вида спереди (z, y) и проецируются на обшивку вдоль оси самолёта;
// боковые окна и форточка — с вида сбоку (x, y) и проецируются поперёк. Так стёкла ложатся
// на кривую поверхность носа без искажений, которые давала текстура по развёртке.

import * as THREE from "three";
import { S } from "./shapeSet.ts";
import { type FuselageShape, fuselageHalfWidthAt, fuselageSection } from "./shapes.ts";

type P2 = [number, number];

// Контуры стёкол — из набора контуров типа (shapeSet.ts): вид спереди (z, y) для лобовых, вид сбоку (x, y) для боковых.
/** Ширина рамы между стёклами, м. */
const FRAME = 0.045;

/** Сдвиг выпуклого многоугольника внутрь на d (рамы между стёклами). */
function inset(poly: P2[], d: number): P2[] {
  const n = poly.length;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % n];
    area += x0 * y1 - x1 * y0;
  }
  const sgn = area > 0 ? 1 : -1;
  const lines = poly.map((p, i) => {
    const q = poly[(i + 1) % n];
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * sgn;
    const ny = (dx / len) * sgn;
    return { p: [p[0] + nx * d, p[1] + ny * d] as P2, d: [dx, dy] as P2 };
  });
  return lines.map((l, i) => {
    const m = lines[(i + n - 1) % n];
    const den = m.d[0] * l.d[1] - m.d[1] * l.d[0];
    if (Math.abs(den) < 1e-9) return l.p;
    const t = ((l.p[0] - m.p[0]) * l.d[1] - (l.p[1] - m.p[1]) * l.d[0]) / den;
    return [m.p[0] + m.d[0] * t, m.p[1] + m.d[1] * t] as P2;
  });
}

/** Плоский многоугольник → мелкая сетка треугольников (чтобы стекло повторяло кривизну). */
function tessellate(poly: P2[], levels = 3): P2[][] {
  const tris = THREE.ShapeUtils.triangulateShape(
    poly.map(([a, b]) => new THREE.Vector2(a, b)),
    [],
  ).map((t) => t.map((k) => poly[k]) as P2[]);
  let out = tris;
  for (let l = 0; l < levels; l++) {
    const next: P2[][] = [];
    for (const [a, b, c] of out) {
      const ab: P2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const bc: P2 = [(b[0] + c[0]) / 2, (b[1] + c[1]) / 2];
      const ca: P2 = [(c[0] + a[0]) / 2, (c[1] + a[1]) / 2];
      next.push([a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]);
    }
    out = next;
  }
  return out;
}

function decal(
  poly: P2[],
  map: (a: number, b: number) => THREE.Vector3,
  axisOf: (p: THREE.Vector3) => THREE.Vector3,
  border = FRAME / 2,
  offset = 0.012,
): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const e = 1e-3;
  for (const tri of tessellate(inset(poly, border))) {
    for (const [a, b] of tri) {
      const p = map(a, b);
      const n = map(a + e, b).sub(p).cross(map(a, b + e).sub(p)).normalize();
      // Нормаль — наружу от оси фюзеляжа; она же — нормаль вершины (гладкое стекло без граней).
      if (n.dot(p.clone().sub(axisOf(p))) < 0) n.negate();
      p.addScaledVector(n, offset);
      pos.push(p.x, p.y, p.z);
      nor.push(n.x, n.y, n.z);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

export function cockpitGlazing(f: FuselageShape): THREE.BufferGeometry[] {
  const axis = (p: THREE.Vector3) => new THREE.Vector3(Math.max(p.x, 3), fuselageSection(f, Math.max(p.x, 3)).cy, 0);
  // Где на обшивке носа точка (z, y) вида спереди: первая станция x, на которой ширина на высоте y достигает |z|.
  const front = (side: 1 | -1) => (z: number, y: number) => {
    let lo = 0.01;
    let hi = 6;
    for (let i = 0; i < 40; i++) {
      const m = (lo + hi) / 2;
      if (fuselageHalfWidthAt(f, m, y) >= Math.abs(z)) hi = m;
      else lo = m;
    }
    return new THREE.Vector3(hi, y, side * z);
  };
  const sideMap = (side: 1 | -1) => (x: number, y: number) => new THREE.Vector3(x, y, side * fuselageHalfWidthAt(f, x, y));
  const out: THREE.BufferGeometry[] = [];
  const ownCockpit = S().id === "tu214" || S().id === "b757";
  const window = (poly: P2[], mapping: (a: number, b: number) => THREE.Vector3) => {
    if (ownCockpit) {
      // Обод плотно прилегает к форме обшивки; стекло внутри рамы чуть выше по нормали.
      // A320/737 retain their existing glazing and material settings.
      const rim = decal(poly, mapping, axis, 0.006, 0.011);
      rim.userData.tone = "glassFrame";
      out.push(rim);
      const glass = decal(poly, mapping, axis, 0.065, 0.018);
      glass.userData.tone = "glass";
      out.push(glass);
    } else out.push(decal(poly, mapping, axis));
  };
  for (const side of [1, -1] as const) {
    window(S().cockpit.windscreen, front(side));
    for (const w of S().cockpit.side) window(w, sideMap(side));
  }
  return out;
}
