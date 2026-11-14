// Параметрические формы: фюзеляж по сечениям, несущие поверхности с профилем, тела вращения.
// Система координат: x — вдоль фюзеляжа назад от носа, y — вверх, z — по размаху вправо. Метры.

import * as THREE from "three";
import { B737_800_NACELLE } from "../../src/aircraft/b737ng.ts";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { buildCockpitFairing, insideCockpitFairing } from "./cockpitFairing.ts";
import { combustorPieces } from "./combustor.ts";
import type { EngineArchitecture, EngineDef } from "../../src/definition.ts";
import { S } from "./shapeSet.ts";
import { cockpitFacets, cockpitSurfaceWidth, type CockpitFacet } from "./cockpitSurfaces.ts";
import { fleetPackages, isFleetStyle, type FleetStyle } from "./fleetPackages.ts";
import { reverser757Layout, reverser757Segments } from "./reverser757.ts";
export { applyReverserMotion, reverser757Layout, type ReverserMotion } from "./reverser757.ts";

/** Толщина симметричного профиля NACA 00xx в точке x ∈ [0, 1] (доля хорды), полутолщина в долях хорды. */
export function nacaHalfThickness(x: number, t: number): number {
  return 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
}

/**
 * Фюзеляж — по таблицам набора контуров (shapeSet.ts): у A320 — Airbus AC (2-2-0, виды сбоку и сверху; 2-5-0, сечение),
 * у 737 — сетка 737-800. Таблицы заданы для длины чертежа; удлинение — две цилиндрические вставки: перед крылом
 * и за ним. У вариантов семейства сохраняется их собственное соотношение вставок;
 * дополнительное удлинение рычагом делится пополам.
 */
export interface FuselageShape {
  lengthM: number;
  widthM: number;
  heightM: number;
}

function interp(xs: number[], ys: number[], x: number): number {
  if (x <= xs[0]) return ys[0];
  const n = xs.length - 1;
  if (x >= xs[n]) return ys[n];
  // Таблица неравномерная (нос — шаг 0,05 м, дальше 0,25 м): двоичный поиск.
  let lo = 0;
  let hi = n;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (xs[m] <= x) lo = m;
    else hi = m;
  }
  const i = lo;
  const t = (x - xs[i]) / (xs[i + 1] - xs[i]);
  return ys[i] + (ys[i + 1] - ys[i]) * t;
}

const contourTangents = new WeakMap<number[], WeakMap<number[], number[]>>();
/** Shape-preserving cubic Hermite contour: continuous tangents without overshoot
 * at a cylinder join or a small-radius nose. Unlike Catmull-Rom it cannot create
 * a bulge outside the measured section envelope. */
export function contourAt(xs: number[], ys: number[], x: number): number {
  if (x <= xs[0]) return ys[0];
  const n = xs.length - 1;
  if (x >= xs[n]) return ys[n];
  let byValues = contourTangents.get(xs);
  if (!byValues) { byValues = new WeakMap(); contourTangents.set(xs, byValues); }
  let slopes = byValues.get(ys);
  if (!slopes) {
    const h = xs.slice(1).map((v, i) => v - xs[i]);
    const delta = h.map((v, i) => (ys[i + 1] - ys[i]) / v);
    slopes = [delta[0]];
    for (let i = 1; i < n; i++) {
      const a = delta[i - 1], b = delta[i];
      const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1];
      slopes.push(a * b <= 0 ? 0 : (w1 + w2) / (w1 / a + w2 / b));
    }
    slopes.push(delta[n - 1]);
    byValues.set(ys, slopes);
  }
  let lo = 0, hi = n;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xs[mid] <= x) lo = mid; else hi = mid; }
  const h = xs[hi] - xs[lo], t = (x - xs[lo]) / h;
  return (2 * t ** 3 - 3 * t ** 2 + 1) * ys[lo] + (t ** 3 - 2 * t ** 2 + t) * h * slopes[lo]
    + (-2 * t ** 3 + 3 * t ** 2) * ys[hi] + (t ** 3 - t ** 2) * h * slopes[hi];
}

/** Координата на чертеже AC для точки модели: вставки удлинения повторяют цилиндрическое сечение. */
export function acX(lengthM: number, x: number): number {
  const plugs = fuselagePlugs(lengthM);
  let xa = x;
  for (const [station, delta] of [[plugs.forward, plugs.forwardM], [plugs.aft, plugs.aftM]])
    if (xa >= station) xa = delta >= 0 && xa < station + delta ? station : xa - delta;
  return xa;
}

/** Обратно: где на удлинённом фюзеляже оказывается точка чертежа AC. */
export function modelX(lengthM: number, xa: number): number {
  const plugs = fuselagePlugs(lengthM);
  const offset = (station: number, delta: number) => xa < station ? 0 : Math.max(delta, station - xa);
  // При укорочении удалённый участок схлопывается в одну станцию, без обратного хода координаты.
  return xa + offset(plugs.forward, plugs.forwardM) + offset(plugs.aft, plugs.aftM);
}
/** Вставки удлинения текущего набора контуров. */
export function fuselagePlugs(lengthM = S().baseLengthM) {
  const shape = S();
  const ref = shape.stretchReference;
  const forwardM = (ref?.forwardM ?? 0) + (lengthM - (ref?.referenceLengthM ?? shape.baseLengthM)) / 2;
  return { forward: shape.plugFwd, aft: shape.plugAft, baseLengthM: shape.baseLengthM, forwardM, aftM: lengthM - shape.baseLengthM - forwardM };
}

// Сечение: радиус по углу (0° — правый борт, 90° — верх). У A320 — верхняя половина по 2-5-0, нижняя зеркальна;
// у 737 — полный оборот (нижний «пузырь» уже верхнего).
function sectionUnit(a: number): [number, number] {
  const { section, halfW, halfH } = S();
  let d = ((a * 180) / Math.PI) % 360;
  if (d < 0) d += 360;
  const dd = section.fullTurn || d <= 180 ? d : 360 - d;
  const r = interp(section.deg, section.r, dd);
  return [(r * Math.cos(a)) / halfW, (r * Math.sin(a)) / halfH];
}
/** Угол сечения, на котором нормированная высота равна s ∈ [−1, 1] (правый борт). */
function sectionAngleForHeight(s: number): number {
  let lo = -Math.PI / 2;
  let hi = Math.PI / 2;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (sectionUnit(mid)[1] < s) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Полуширина сечения на высоте y. */
export function fuselageHalfWidthAt(f: FuselageShape, x: number, y: number): number {
  const panels = cockpitHullFacets(f);
  const { hw, hh, cy } = clippedFuselageSection(f, x);
  if (panels.length && insideCockpitFairing(x)) {
    const offset = cockpitFairing(f, panels);
    let lo = -Math.PI / 2, hi = Math.PI / 2;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      const height = cy + hh * sectionUnit(mid)[1] + offset(x, mid)[0];
      if (height < y) lo = mid;
      else hi = mid;
    }
    const a = (lo + hi) / 2, [cx, sy] = sectionUnit(a);
    return Math.max(0, cockpitSurfaceWidth(panels, x, cy + hh * sy, hw * cx) + offset(x, a)[1]);
  }
  const s = Math.max(-1, Math.min(1, (y - cy) / hh));
  const width = hw * Math.max(0, sectionUnit(sectionAngleForHeight(s))[0]);
  return cockpitSurfaceWidth(panels, x, y, width);
}
function rawFuselageHalfWidthAt(f: FuselageShape, x: number, y: number): number {
  const { hw, hh, cy } = rawFuselageSection(f, x);
  const s = Math.max(-1, Math.min(1, (y - cy) / hh));
  return hw * Math.max(0, sectionUnit(sectionAngleForHeight(s))[0]);
}

const glazingSurfaces = new WeakMap<object, { dimensions: string; panels: CockpitFacet[] }>();
export function cockpitHullFacets(f: FuselageShape): CockpitFacet[] {
  const layout = S().cockpit;
  if (!layout.planarGlazing) return [];
  const dimensions = `${f.lengthM}/${f.widthM}/${f.heightM}`;
  let cached = glazingSurfaces.get(layout);
  if (!cached || cached.dimensions !== dimensions) {
    cached = { dimensions, panels: cockpitFacets(layout, (x, y) => rawFuselageHalfWidthAt(f, x, y)) };
    glazingSurfaces.set(layout, cached);
  }
  return cached.panels;
}

// Facets are already cached by shape set and fuselage dimensions.
const fairings = new WeakMap<CockpitFacet[], ReturnType<typeof buildCockpitFairing>>();
function cockpitFairing(f: FuselageShape, panels: CockpitFacet[]) {
  let fairing = fairings.get(panels);
  if (!fairing) {
    fairing = buildCockpitFairing(panels, x => clippedFuselageSection(f, x), sectionUnit);
    fairings.set(panels, fairing);
  }
  return fairing;
}

/** Полуширина, полувысота и смещение центра сечения по длине фюзеляжа. */
export function fuselageSection(f: FuselageShape, x: number): { hw: number; hh: number; cy: number } {
  const section = clippedFuselageSection(f, x);
  const panels = cockpitHullFacets(f);
  if (!panels.length || !insideCockpitFairing(x)) return section;
  const offset = cockpitFairing(f, panels);
  const top = offset(x, Math.PI / 2)[0], bottom = offset(x, -Math.PI / 2)[0];
  return { hw: section.hw, hh: section.hh + (top - bottom) / 2, cy: section.cy + (top + bottom) / 2 };
}

function clippedFuselageSection(f: FuselageShape, x: number) {
  const section = rawFuselageSection(f, x);
  const front = cockpitHullFacets(f)[0];
  if (!front) return section;
  const cap = -(front.a * x + front.c) / front.b;
  const sill = Math.min(...front.polygon.map(p => p[1]));
  const top = section.cy + section.hh, bottom = section.cy - section.hh;
  // Extend the screen plane smoothly below its sill. Its slope fades towards
  // the radome without reversing or making a notch at the lower glass edge.
  const blendHeight = 0.12;
  const roof = cap >= sill ? cap : sill + blendHeight * Math.expm1((cap - sill) / blendHeight);
  if (roof < top) return { hw: section.hw, hh: (roof - bottom) / 2, cy: (roof + bottom) / 2 };
  return section;
}

function rawFuselageSection(f: FuselageShape, x: number): { hw: number; hh: number; cy: number } {
  const xa = acX(f.lengthM, x);
  const { fuselage: FUS, halfH, halfW } = S();
  const kH = f.heightM / 2 / halfH;
  const kW = f.widthM / 2 / halfW;
  const sample = FUS.tipBlendM === undefined ? interp : contourAt;
  const top = sample(FUS.x, FUS.top, xa) * kH;
  const bot = sample(FUS.x, FUS.bottom, xa) * kH;
  let hw = sample(FUS.x, FUS.half_width, xa) * kW;
  let hh = (top - bot) / 2;
  // Малое скругление вершины обтекателя: размеры растут как √x, длина зависит от типа.
  const TIP = FUS.tipBlendM ?? 0.1;
  if (xa < TIP) {
    const t = Math.max(0, xa / TIP);
    const widthAt = (x: number) => sample(FUS.x, FUS.half_width, x) * kW;
    const heightAt = (x: number) => (sample(FUS.x, FUS.top, x) - sample(FUS.x, FUS.bottom, x)) * kH * 0.5;
    const blend = (at: (x: number) => number) => {
      const end = at(TIP);
      if (FUS.tipBlendM === undefined) return end * Math.sqrt(t);
      // Preserve the measured contour's tangent at the join while rounding
      // the apex. Plain sqrt(x) leaves a kink where it meets the loft.
      const e = 1e-5;
      const q = Math.max(0, Math.min(1.5, (at(TIP + e) - at(TIP - e)) / (2 * e) * TIP / end));
      return end * Math.sqrt(t) * (1.5 - q + (q - 0.5) * t);
    };
    hw = blend(widthAt);
    hh = blend(heightAt);
  }
  return { hw: Math.max(0.01, hw), hh: Math.max(0.01, hh), cy: (top + bot) / 2 };
}

export function fuselageGeometry(f: FuselageShape, segR = S().cockpit.planarGlazing ? 144 : 72): THREE.BufferGeometry {
  // Шаг по длине: у носа и кабины мелкий (форма меняется быстро), в цилиндре крупный.
  const xsArr: number[] = [];
  const noseSegments = S().fuselage.noseSegments ?? 40;
  for (let k = 0; k <= noseSegments; k++) xsArr.push(6 * (k / noseSegments) ** 1.8);
  for (let x = 6.25; x < f.lengthM - 0.01; x += 0.25) xsArr.push(x);
  xsArr.push(f.lengthM);
  const segX = xsArr.length - 1;
  const pos: number[] = [];
  const idx: number[] = [];
  const panels = cockpitHullFacets(f);
  const fairing = panels.length ? cockpitFairing(f, panels) : undefined;
  for (let i = 0; i <= segX; i++) {
    const x = xsArr[i];
    // Нос сходится в точку (без «дырки» на кончике), хвост оставляем открытым — там выхлоп ВСУ.
    const { hw, hh, cy } = clippedFuselageSection(f, Math.max(0.0005, Math.min(f.lengthM - 0.02, x)));
    for (let j = 0; j <= segR; j++) {
      const a = (j / segR) * Math.PI * 2;
      // Сечение — по таблице набора контуров.
      const [cx, sy] = sectionUnit(a);
      const y = cy + (panels.length && i === 0 ? 0 : hh * sy);
      const z = panels.length ? Math.sign(cx) * cockpitSurfaceWidth(panels, x, y, Math.abs(hw * cx)) : hw * cx;
      if (fairing && insideCockpitFairing(x)) {
        const [dy, dz] = fairing(x, Math.asin(Math.sin(a)));
        pos.push(x, y + dy, z + Math.sign(cx) * dz);
      } else pos.push(x, y, panels.length && i === 0 ? 0 : z);
    }
  }
  const row = segR + 1;
  for (let i = 0; i < segX; i++)
    for (let j = 0; j < segR; j++) {
      const a = i * row + j;
      const b = a + row;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  // Развёртка для текстуры окон и дверей: u — доля длины, v — угол сечения (0 — правый борт, 0,25 — верх).
  const uv: number[] = [];
  for (let i = 0; i <= segX; i++) for (let j = 0; j <= segR; j++) uv.push(xsArr[i] / f.lengthM, j / segR);
  const g = new THREE.BufferGeometry();
  g.userData.radialSegments = segR;
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  if (!panels.length) return g;
  // The UV seam duplicates positions at 0/360°. Average their normals so the
  // texture seam does not become a false crease along the whole fuselage.
  const normals = g.getAttribute("normal");
  const normal = new THREE.Vector3(), other = new THREE.Vector3();
  for (let i = 1; i <= segX; i++) {
    const first = i * row, last = first + segR;
    normal.fromBufferAttribute(normals, first).add(other.fromBufferAttribute(normals, last)).normalize();
    normals.setXYZ(first, normal.x, normal.y, normal.z);
    normals.setXYZ(last, normal.x, normal.y, normal.z);
  }
  // All apex vertices occupy one point; they also need one shared normal.
  normal.set(0, 0, 0);
  for (let j = 0; j < segR; j++) normal.add(other.fromBufferAttribute(normals, j));
  normal.normalize();
  for (let j = 0; j <= segR; j++) normals.setXYZ(j, normal.x, normal.y, normal.z);
  return g;
}

/** Угол сечения (доля оборота v), на котором обшивка цилиндрической части проходит через высоту y. */
export function sectionV(f: FuselageShape, y: number, side: 1 | -1): number {
  const H = f.heightM / 2;
  const a = sectionAngleForHeight(Math.max(-1, Math.min(1, y / H)));
  const ang = side === 1 ? a : Math.PI - a;
  return (((ang / (Math.PI * 2)) % 1) + 1) % 1;
}

export interface SurfaceShape {
  /** Положение передней кромки корневой хорды. */
  root: THREE.Vector3;
  rootChordM: number;
  tipChordM: number;
  /** Длина консоли (полуразмах для крыла, высота для киля). */
  semiSpanM: number;
  leadingEdgeSweepDeg: number;
  /** Угол наклона консоли к горизонтали: 0 — горизонтально, 90 — вертикально (киль). */
  dihedralDeg: number;
  thicknessRoot: number;
  thicknessTip: number;
  /** Доли хорды/размаха, чтобы вырезать часть поверхности (рули, механизация). */
  chordFrom?: number;
  chordTo?: number;
  spanFrom?: number;
  spanTo?: number;
  side?: 1 | -1;
  /**
   * Произвольная форма в плане (крыло с изломом задней кромки): по доле размаха u
   * возвращает смещение передней кромки от корня по x и хорду. Если не задана — трапеция.
   */
  /** Optional curved centreline in the span plane, with its local inclination (radians). */
  spanPath?: (u: number) => { rise: number; run: number; angle: number };
  planform?: (u: number) => { le: number; chord: number; thickness?: number };
  /** Local height of the upper wing/body fillet above the clean wing skin (m). */
  upperFillet?: (x: number, z: number) => number;
  /** Абсолютная полутолщина в точке (u, v), м — для поверхностей с наплывом (форкиль), где профиль не подобен. */
  halfThickness?: (u: number, v: number) => number;
  /** Граница руля в доле хорды как функция u (прямая ось руля на поверхности с наплывом). */
  hingeAt?: (u: number) => number;
  /** Какую часть брать относительно hingeAt: до оси или после. */
  hingeSide?: "fixed" | "control";
  /** Развёртка раздельно по бортам: верхняя сторона — v ∈ [0; 0,5], нижняя — [0,5; 1] (для надписей на киле). */
  uvSides?: boolean;
}

/** Точка на поверхности: доля размаха u, доля хорды v, верх/низ. */
export function surfacePoint(s: SurfaceShape, u: number, v: number, upper: boolean): THREE.Vector3 {
  const side = s.side ?? 1;
  const span = s.semiSpanM * u;
  const pf = s.planform?.(u);
  const t = pf?.thickness ?? s.thicknessRoot + (s.thicknessTip - s.thicknessRoot) * u;
  const chord = pf ? pf.chord : s.rootChordM + (s.tipChordM - s.rootChordM) * u;
  const le = pf ? pf.le : span * Math.tan((s.leadingEdgeSweepDeg * Math.PI) / 180);
  const path = s.spanPath?.(u);
  const d = path?.angle ?? (s.dihedralDeg * Math.PI) / 180;
  const half = (s.halfThickness ? s.halfThickness(u, v) : nacaHalfThickness(Math.max(1e-4, v), t) * chord) * (upper ? 1 : -1);
  // Базис консоли: вдоль размаха и по нормали к её плоскости (для киля нормаль — вдоль z).
  const rise = path?.rise ?? span * Math.sin(d);
  const run = path?.run ?? span * Math.cos(d);
  const normal = new THREE.Vector3(0, Math.cos(d), -side * Math.sin(d));
  const point = new THREE.Vector3(s.root.x + le + v * chord, s.root.y + rise, s.root.z + side * run)
    .addScaledVector(normal, half);
  if (upper && s.upperFillet) point.y += s.upperFillet(point.x, Math.abs(point.z));
  return point;
}

export function surfaceGeometry(s: SurfaceShape, segU = 24, segV = 28): THREE.BufferGeometry {
  const u0 = s.spanFrom ?? 0;
  const u1 = s.spanTo ?? 1;
  const v0 = s.chordFrom ?? 0;
  const v1 = s.chordTo ?? 1;
  const pos: number[] = [];
  const idx: number[] = [];
  // Обход профиля: по верху от задней кромки к передней, затем по низу обратно.
  // t — доля внутри выбранного участка хорды; границы участка могут зависеть от u (ось руля).
  const ring: { t: number; upper: boolean }[] = [];
  for (let k = segV; k >= 0; k--) ring.push({ t: (1 - Math.cos((Math.PI * k) / segV)) / 2, upper: true });
  for (let k = 1; k <= segV; k++) ring.push({ t: (1 - Math.cos((Math.PI * k) / segV)) / 2, upper: false });
  // Развёртка: u — доля размаха, v — доля хорды (одинаково сверху и снизу) — для текстур деталей AC.
  const uv: number[] = [];
  for (let i = 0; i <= segU; i++) {
    const u = u0 + ((u1 - u0) * i) / segU;
    let a = v0;
    let b = v1;
    if (s.hingeAt) {
      const h = s.hingeAt(u);
      if (s.hingeSide === "control") a = h;
      else b = h;
    }
    for (const r of ring) {
      const v = a + (b - a) * r.t;
      const p = surfacePoint(s, u, v, r.upper);
      pos.push(p.x, p.y, p.z);
      uv.push(u, s.uvSides ? (r.upper ? 0 : 0.5) + v * 0.5 : v);
    }
  }
  const n = ring.length;
  for (let i = 0; i < segU; i++)
    for (let j = 0; j < n - 1; j++) {
      const a = i * n + j;
      const b = a + n;
      if ((s.side ?? 1) === 1) idx.push(a, a + 1, b, b, a + 1, b + 1);
      else idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  // Торцы консоли.
  const cap = (i: number) => {
    const base = i * n;
    for (let j = 1; j < n - 1; j++) idx.push(base, base + j, base + j + 1);
  };
  cap(0);
  cap(segU);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Стреловидность передней кромки по стреловидности четверти хорды. */
export function leadingEdgeSweep(quarterDeg: number, aspectRatio: number, taper: number): number {
  const t = Math.tan((quarterDeg * Math.PI) / 180) + (1 - taper) / (aspectRatio * (1 + taper));
  return (Math.atan(t) * 180) / Math.PI;
}

/** Гондола: тело вращения вдоль оси x. Профиль задан долями длины и диаметра. */
export function nacelleGeometry(lengthM: number, diameterM: number): THREE.BufferGeometry {
  const R = diameterM / 2;
  const L = lengthM;
  const pts = [
    [0.86, 0.0],
    [0.96, 0.03],
    [1.0, 0.18],
    [0.97, 0.45],
    [0.84, 0.72],
    [0.7, 0.82],
    [0.5, 0.86],
    [0.47, 0.97],
    [0.3, 1.0],
  ].map(([r, x]) => new THREE.Vector2(r * R, x * L));
  const g = new THREE.LatheGeometry(pts, 48);
  g.rotateZ(-Math.PI / 2);
  return g;
}

export function engineCoreGeometry(lengthM: number, fanDiameterM: number): THREE.BufferGeometry {
  const R = fanDiameterM / 2;
  const L = lengthM;
  const pts = [
    [0.0, 0.0],
    [0.98, 0.0],
    [0.98, 0.06],
    [0.42, 0.12],
    [0.4, 0.55],
    [0.32, 0.8],
    [0.22, 0.98],
    [0.0, 1.06],
  ].map(([r, x]) => new THREE.Vector2(r * R, x * L));
  const g = new THREE.LatheGeometry(pts, 40);
  g.rotateZ(-Math.PI / 2);
  return g;
}

// ——— Продольный разрез ТРДД ———
export type Spool = "lp" | "ip" | "hp";
export type Tone = Spool | "hot" | "casing" | "fanBlade" | "fanSpinner" | "stator" | "detailSteel" | "detailDark" | "detailFuel";
export interface EnginePiece {
  geometry: THREE.BufferGeometry;
  tone: Tone;
  /** Какой вал вращает деталь; у неподвижных — null. */
  spin: Spool | null;
  /** Смещение при разборе двигателя, м (вдоль оси x и вверх). */
  offset: THREE.Vector3;
  label?: string;
}

export type EngineSpec = EngineArchitecture & {
  fanDiameterM: number;
  bypassRatio: number;
  lengthM: number;
  fanStyle?: "rb211" | "pw2037" | FleetStyle;
  /** Редуктор вентилятора: быстроходная ТНД из трёх ступеней. */
  gearbox?: boolean;
};

/** Ступени ТНД: больше вентилятор → медленнее вал НД → больше ступеней турбины (CFM56 4, LEAP 7). */
export function lptStagesFor(bpr: number, gearbox = false, installed?: number): number {
  if (installed !== undefined) return installed;
  if (gearbox) return 3;
  return Math.max(3, Math.min(9, Math.round(4 + 0.57 * (bpr - 5.7))));
}

/** Радиус входа в ядро: площадь ядра ∝ 1/(1+B) от площади вентилятора (коэффициент подобран по CFM56/LEAP). */
export function coreRadiusFor(fanRadiusM: number, bpr: number): number {
  return fanRadiusM * Math.sqrt(1.6 / (1 + bpr));
}

const axisX = (g: THREE.BufferGeometry) => {
  g.rotateZ(-Math.PI / 2);
  return g;
};

/** Диск ступени: цилиндр вдоль оси x. */
function stageDisc(x: number, r: number, w: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, w, 36);
  axisX(g);
  g.translate(x + w / 2, 0, 0);
  return g;
}

// Axisymmetric web, with a bore for its own shaft and room for the inner spools.
function rotorDisc(x: number, radius: number, width: number, bore: number, segments = 36): THREE.BufferGeometry {
  const profile = [[bore, x], [radius, x], [radius, x + width], [bore, x + width], [bore, x]];
  return axisX(new THREE.LatheGeometry(profile.map(([r, station]) => new THREE.Vector2(r, station)), segments));
}

function stagesAlong(n: number, x0: number, x1: number, r0: number, r1: number, bore = 0): THREE.BufferGeometry {
  const gap = (x1 - x0) / n;
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1);
    const x = x0 + i * gap, r = r0 + (r1 - r0) * t;
    parts.push(bore ? rotorDisc(x, r, gap * 0.55, bore) : stageDisc(x, r, gap * 0.55));
  }
  return mergeGeometries(parts)!;
}

const compressorSection = [[-0.46, 0], [-0.10, 0.12], [0.48, 0.16], [0.12, -0.02], [-0.20, -0.04]];
// Normalised axial chord and section thickness. Turbine camber is applied below.
const turbineSection = [[-0.48, 0], [-0.36, 0.10], [-0.08, 0.13], [0.26, 0.07], [0.48, 0.01],
  [0.26, -0.03], [-0.08, -0.07], [-0.36, -0.06]];

function bladeRow(x: number, hub: number, tip: number, pitch: number, stator: boolean,
  count = stator ? 27 : 24, turbine = false): THREE.BufferGeometry {
  const pos: number[] = [], idx: number[] = [];
  const section = turbine ? turbineSection : compressorSection;
  for (let i = 0; i < count; i++) {
    const start = pos.length / 3;
    for (let level = 0; level <= 2; level++) {
      const u = level / 2;
      const r = hub + (tip - hub) * u;
      const sweep = (stator ? -1 : 1) * (0.65 + u * 0.5);
      for (const [chord, camber] of section) {
        const spacing = 2 * Math.PI * r / count;
        const tangent = turbine
          ? spacing * (sweep * (chord + 0.45 * (1 - 4 * chord * chord)) + camber)
          : (sweep * chord + camber) * pitch;
        const theta = (i + (stator ? 0.5 : 0)) * Math.PI * 2 / count + tangent / r;
        pos.push(x + chord * pitch * (0.93 - 0.15 * u), r * Math.cos(theta), r * Math.sin(theta));
      }
    }
    const n = section.length;
    for (let level = 0; level < 2; level++) for (let j = 0; j < n; j++) {
      const a = start + level * n + j, b = start + level * n + (j + 1) % n;
      idx.push(a, b, b + n, a, b + n, a + n);
    }
    for (let j = 1; j < n - 1; j++) idx.push(start + 2 * n, start + 2 * n + j, start + 2 * n + j + 1);
  }
  const row = new THREE.BufferGeometry();
  row.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  row.setIndex(idx);
  row.computeVertexNormals();
  return row;
}

function compressorRows(stages: number, spool: Spool, x0: number, x1: number, r0: number, r1: number,
  bore: number, offset: THREE.Vector3, bladeCounts?: readonly number[]): EnginePiece[] {
  const pitch = (x1 - x0) / stages;
  const rotors: THREE.BufferGeometry[] = [], stators: THREE.BufferGeometry[] = [];
  for (let i = 0; i < stages; i++) {
    const t = i / Math.max(1, stages - 1);
    const tip = THREE.MathUtils.lerp(r0, r1, t);
    const hub = tip * THREE.MathUtils.lerp(0.58, 0.79, t);
    const x = x0 + i * pitch;
    const drum = rotorDisc(x + pitch * 0.10, hub, pitch * 0.32, bore);
    drum.deleteAttribute("uv");
    rotors.push(drum, bladeRow(x + 0.25 * pitch, hub, tip, pitch * 0.46, false, bladeCounts?.[i]));
    const rim = [new THREE.Vector2(tip * 1.012, x), new THREE.Vector2(tip * 1.012, x + pitch)];
    const shroud = axisX(new THREE.LatheGeometry(rim, 32, Math.PI * 0.5, Math.PI * 1.5));
    shroud.deleteAttribute("uv");
    stators.push(shroud, bladeRow(x + 0.75 * pitch, hub * 1.02, tip * 1.012, pitch * 0.46, true));
  }
  const rotor = mergeGeometries(rotors)!;
  rotor.name = spool + "-compressor";
  const guide = mergeGeometries(stators)!;
  guide.name = spool + "-stator";
  return [
    { geometry: rotor, spin: spool, tone: spool, offset },
    { geometry: guide, spin: null, tone: "stator", offset },
  ];
}

function turbineRows(e: EngineSpec, spool: Spool, stages: number, x0: number, x1: number,
  r0: number, r1: number, bore: number, offset: THREE.Vector3): EnginePiece[] {
  const pitch = (x1 - x0) / stages;
  const rotors: THREE.BufferGeometry[] = [], guides: THREE.BufferGeometry[] = [];
  const shrouded = e.spools === 3 || spool === "lp";
  for (let i = 0; i < stages; i++) {
    const counts = e.turbineBlading?.[spool]?.[i];
    const x = x0 + i * pitch;
    const radius = (fraction: number) => THREE.MathUtils.lerp(r0, r1, (i + fraction) / stages);
    const vaneTip = radius(0.23), bladeTip = radius(0.72);
    const hub = r0 * (spool === "lp" ? 0.64 : 0.70);
    // Unknown counts are representative only. Use opposed camber to distinguish
    // the upstream nozzle from the working row that follows on the spool.
    guides.push(bladeRow(x + 0.23 * pitch, hub * 1.01, vaneTip, 0.45 * pitch, true, counts?.vanes ?? 36, true));
    const outerBand = rotorDisc(x + 0.12 * pitch, vaneTip * 1.018, 0.21 * pitch, vaneTip * 0.996, 96);
    outerBand.deleteAttribute("uv");
    guides.push(outerBand);
    rotors.push(bladeRow(x + 0.72 * pitch, hub, bladeTip, 0.49 * pitch, false, counts?.rotor ?? 48, true));
    // A narrow web links the shaft boss to the thicker blade platform.
    const webProfile = [[bore, 0.56], [hub * 0.40, 0.56], [hub * 0.52, 0.68],
      [hub * 0.77, 0.68], [hub * 0.87, 0.55], [hub, 0.55], [hub, 0.91],
      [hub * 0.87, 0.91], [hub * 0.77, 0.77], [hub * 0.52, 0.77],
      [hub * 0.40, 0.88], [bore, 0.88], [bore, 0.56]];
    const web = axisX(new THREE.LatheGeometry(webProfile.map(([r, station]) =>
      new THREE.Vector2(r, x + station * pitch)), 72));
    web.deleteAttribute("uv");
    rotors.push(web);
    if (shrouded) {
      const rim = rotorDisc(x + 0.64 * pitch, bladeTip * 1.008, 0.18 * pitch, bladeTip * 0.993, 96);
      rim.deleteAttribute("uv");
      rotors.push(rim);
    }
  }
  const rotor = mergeGeometries(rotors)!, guide = mergeGeometries(guides)!;
  rotor.name = spool + "-turbine-rotor";
  guide.name = spool + "-turbine-guide";
  return [{ geometry: guide, spin: null, tone: "stator", offset }, { geometry: rotor, spin: spool, tone: spool, offset }];
}

/** Visual loft of the installed fan blade. Chord, twist and section thickness are illustrative. */
function fanBladeGeometry(e: EngineSpec, hub: number): THREE.BufferGeometry {
  const radius = e.fanDiameterM / 2;
  const swept = e.fanStyle === "leap1a" || e.fanStyle === "leap1b";
  const installedFleet = e.fanStyle !== undefined && isFleetStyle(e.fanStyle);
  const wide = swept || e.fanStyle === "rb211";
  const position: number[] = [], indices: number[] = [];
  const spans = 8, section = 12;
  for (let i = 0; i <= spans; i++) {
    const t = i / spans;
    const y = hub + ((installedFleet ? 0.992 : 0.97) * radius - hub) * t;
    const chord = radius * (wide ? 0.17 + 0.14 * t : 0.10 + 0.095 * t);
    const twist = THREE.MathUtils.degToRad(24 + 36 * t);
    for (let j = 0; j < section; j++) {
      const angle = 2 * Math.PI * j / section;
      const u = (1 - Math.cos(angle)) / 2;
      const normal = chord * (0.075 * Math.sin(Math.PI * u) + 0.045 * Math.sin(angle));
      const along = chord * (u - 0.5);
      // Sweep and chord extend circumferentially along the fan cylinder.
      // A tangential straight-line offset would enlarge the swept tip radius.
      const arc = radius * (swept ? .23 : .07) * t * t + along * Math.sin(twist) + normal * Math.cos(twist);
      position.push(
        0.14 * e.lengthM + along * Math.cos(twist) - normal * Math.sin(twist),
        installedFleet ? y * Math.cos(arc/y) : y,
        installedFleet ? y * Math.sin(arc/y) : arc,
      );
    }
  }
  for (let i = 0; i < spans; i++) {
    for (let j = 0; j < section; j++) {
      const a = i * section + j, b = i * section + (j + 1) % section;
      indices.push(a, b, a + section, b, b + section, a + section);
    }
  }
  const tip = spans * section;
  for (let j = 1; j < section - 1; j++) indices.push(0, j + 1, j, tip, tip + j, tip + j + 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(position, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

// The nozzle stations use the intake lip as datum. Turbine dimensions use the
// spinner as datum and track the core radius when the bypass lever moves.
interface ExhaustMount { spinnerX: number; lengthK: number; radiusK: number }

function exhaust757(style: "rb211" | "pw2037", L: number, rc: number, mount: ExhaustMount): EnginePiece[] {
  const rb = style === "rb211";
  const x = (station: number) => station * mount.lengthK - mount.spinnerX;
  const r = (radius: number) => radius * mount.radiusK;
  const turbineExit = 0.86 * L;
  const outer = 1.06 * rc, hub = 0.48 * rc;
  const offset = new THREE.Vector3(1.5, 0, 0);
  const pieces: EnginePiece[] = [];
  type Profile = [number, number][];
  let strutBase: Profile, strutTip: Profile;
  function wall(name: string, stations: [number, number][], tone: Tone) {
    const geometry = axisX(new THREE.LatheGeometry(stations.map(([station, radius]) =>
      new THREE.Vector2(radius, station)), 64));
    geometry.name = name;
    pieces.push({ geometry, tone, spin: null, offset });
  }
  if (rb) {
    // RR installation section, Fig. 5.27: the annular splitter ends first,
    // then the centrebody, then the single common lip.
    strutBase = [[turbineExit, outer], [x(3.75), r(.55)], [x(4.04), r(.54)],
      [x(4.36), r(.51)], [x(4.44), r(.50)]];
    strutTip = NACELLE_PROFILES.rb211.segs.bypassLiner.map(([station, radius]) => [x(station), r(radius)] as [number, number]).reverse();
    wall("rb-annular-mixer", [...strutBase, [x(4.44), r(.489)], [x(4.04), r(.528)],
      [x(3.75), r(.538)], [turbineExit, outer * .98]], "detailSteel");
    wall("rb-exhaust-cone", [[turbineExit, hub], [x(3.57), r(.256)], [x(3.85), r(.228)],
      [x(4.49), r(.095)], [x(4.78), r(.029)], [x(4.83), 0]], "detailDark");
  } else {
    // The forward part of the primary duct and centrebody meet the nozzle
    // liner and plug of the installed PW nacelle without a second tip.
    strutTip = [[turbineExit, outer], [x(3.91), r(.65)], [x(4.30), r(.705)],
      [x(4.58), r(.718)], [x(4.92), r(.692)]];
    strutBase = [[turbineExit, hub], [x(3.91), r(.30)], [x(4.33), r(.355)],
      [x(4.85), r(.384)], [x(5.20), r(.378)], [x(5.48), r(.34)]];
    wall("pw-primary-duct", strutTip, "detailSteel");
    wall("pw-exhaust-centrebody", strutBase, "detailDark");
    wall("pw-bypass-inner-wall", [[.55 * L, 1.28 * rc], [x(2.78), r(.96)],
      [x(3.04), r(.988)], [x(3.30), r(.98)]], "detailSteel");
  }
  // On the RB the collector stays span the bypass annulus. The PW exhaust
  // case has fifteen radial struts *inside* the primary duct (ATA 72).
  const struts: THREE.BufferGeometry[] = [];
  const count = rb ? 4 : 15;
  const sample = (profile: Profile) => {
    const stations = profile.map(p => p[0]), radii = profile.map(p => p[1]);
    return (at: number) => interp(stations, radii, at);
  };
  const rootRadius = sample(strutBase), tipRadius = sample(strutTip);
  for (let i = 0; i < count; i++) {
    const xMiddle = rb ? x(4.04) : x(3.91);
    const chord = (rb ? .40 : .15) * mount.lengthK;
    const thick = r(rb ? (i === 0 ? .085 : .027) : .014);
    const foil = new THREE.Shape();
    foil.moveTo(-chord / 2, 0);
    foil.quadraticCurveTo(-chord / 2, thick, 0, thick * .66);
    foil.lineTo(chord / 2, 0);
    foil.quadraticCurveTo(0, -thick, -chord * .40, -thick * .6);
    foil.quadraticCurveTo(-chord / 2, -thick * .45, -chord / 2, 0);
    const strut = new THREE.ExtrudeGeometry(foil, { depth: 1, bevelEnabled: false, curveSegments: 6 });
    const pos = strut.getAttribute("position");
    for (let j = 0; j < pos.count; j++) {
      const at = xMiddle + pos.getX(j);
      const onRoot = pos.getZ(j) < .5;
      const inset = .001 * mount.radiusK;
      const radius = onRoot ? rootRadius(at) + inset : tipRadius(at) - inset;
      pos.setZ(j, Math.sqrt(radius ** 2 - pos.getY(j) ** 2));
    }
    strut.computeVertexNormals();
    strut.rotateX(-Math.PI / 2).translate(xMiddle, 0, 0).rotateX(2 * Math.PI * i / count);
    struts.push(strut);
  }
  const geometry = mergeGeometries(struts)!;
  geometry.name = rb ? "rb-collector-stays" : "pw-exhaust-case-struts";
  pieces.push({ geometry, tone: "detailSteel", spin: null, offset });
  return pieces;
}

export function engineCutaway(e: EngineSpec, mount?: ExhaustMount): EnginePiece[] {
  const R = e.fanDiameterM / 2;
  const L = e.lengthM;
  const rc = coreRadiusFor(R, e.bypassRatio);
  const hub = 0.28 * R;
  const fleet = e.fanStyle && isFleetStyle(e.fanStyle) ? fleetPackages[e.fanStyle] : undefined;
  const lpt = lptStagesFor(e.bypassRatio, e.gearbox, e.lptStages);
  const v = (x: number, y = 0) => new THREE.Vector3(x, y, 0);
  const out: EnginePiece[] = [];

  // Кок вентилятора.
  const spinner = new THREE.LatheGeometry(
    [0, 0.25, 0.5, 0.75, 1].map((t) => new THREE.Vector2(hub * Math.sqrt(t), 0.1 * L * t)),
    32,
  );
  out.push({ geometry: axisX(spinner), tone: e.fanStyle ? "fanSpinner" : "lp", spin: "lp", offset: v(-1.6) });

  // Лопатки вентилятора: широкая хорда, закрутка ~35°.
  const blades: THREE.BufferGeometry[] = [];
  const chord = 0.09 * L;
  let blade: THREE.BufferGeometry;
  if (e.fanStyle) {
    blade = fanBladeGeometry(e, hub);
    if (e.fanStyle === "pw2037" || e.fanStyle === "cfm3b2" || e.fanStyle === "cfm5b") {
      const y = (hub + 0.97 * R) / 2;
      const shroud = new THREE.BoxGeometry(0.048 * R, 0.019 * R, 2 * y * Math.tan(Math.PI / e.fanBlades));
      shroud.deleteAttribute("uv");
      shroud.translate(0.14 * L, y, 0);
      blade = mergeGeometries([blade, shroud])!;
    }
  } else {
    blade = new THREE.BoxGeometry(chord, 0.97 * R - hub, Math.max(0.012, 0.6 / e.fanBlades));
    blade.translate(0, hub + (0.97 * R - hub) / 2, 0);
    blade.rotateY((-35 * Math.PI) / 180);
    blade.translate(0.1 * L + chord / 2, 0, 0);
  }
  for (let i = 0; i < e.fanBlades; i++) {
    const b = blade.toNonIndexed();
    b.rotateX((i / e.fanBlades) * Math.PI * 2);
    blades.push(b);
  }
  const hubDisc = stageDisc(0.09 * L, hub, 0.07 * L).toNonIndexed();
  if (e.fanStyle) hubDisc.deleteAttribute("uv");
  out.push({ geometry: mergeGeometries([...blades, hubDisc])!, tone: e.fanStyle ? "fanBlade" : "lp", spin: "lp", offset: v(-1.2) });

  const detailed = !!e.fanStyle || e.spools === 3;
  const shaftRadius = { lp: rc * 0.07, ip: rc * 0.11, hp: rc * 0.15 };
  if (detailed) {
    const middle = e.spools === 3;
    const split = (middle ? 0.36 : 0.30) * L;
    out.push(...compressorRows(middle ? e.ipcStages : e.boosterStages, middle ? "ip" : "lp",
      0.20 * L, split, rc, rc * 0.85, middle ? shaftRadius.ip : shaftRadius.lp, v(-0.6), e.compressorBlading?.[middle ? "ip" : "lp"]));
    // Leave room for the feed arms ahead of the annular dome.
    const compressorEnd = (e.combustor || fleet ? 0.517 : 0.53) * L;
    out.push(...compressorRows(e.hpcStages, "hp", split + 0.02 * L, compressorEnd, rc * 0.83, rc * 0.65,
      shaftRadius.hp, v(-0.15), e.compressorBlading?.hp));
  } else {
    out.push({ geometry: stagesAlong(e.boosterStages, 0.2 * L, 0.29 * L, rc * 0.95, rc * 0.88), tone: "lp", spin: "lp", offset: v(-0.6) });
    out.push({ geometry: stagesAlong(e.hpcStages, 0.32 * L, 0.52 * L, rc * 0.78, rc * 0.5), tone: "hp", spin: "hp", offset: v(-0.15) });
  }
  if (fleet) out.push(...fleet.combustor(L, rc));
  else if (e.combustor) out.push(...combustorPieces(e.combustor, L, rc));
  else {
    const comb = new THREE.TorusGeometry(rc * 0.56, rc * 0.13, 16, 48);
    comb.rotateY(Math.PI / 2);
    comb.translate(0.56 * L, 0, 0);
    out.push({ geometry: comb, tone: "hot", spin: null, offset: v(0.25) });
  }
  if (e.turbineBlading || fleet) {
    out.push(...turbineRows(e, "hp", e.hptStages, 0.60 * L, (e.spools === 3 ? 0.647 : 0.675) * L,
      rc * 0.62, rc * 0.69, shaftRadius.hp, v(0.6)));
    if (e.spools === 3) out.push(...turbineRows(e, "ip", e.iptStages, 0.650 * L, 0.687 * L,
      rc * 0.69, rc * 0.75, shaftRadius.ip, v(0.82)));
    out.push(...turbineRows(e, "lp", lpt, (e.spools === 3 ? 0.695 : 0.682) * L, 0.86 * L,
      rc * 0.75, rc * 1.03, shaftRadius.lp, v(1.05)));
  } else {
    out.push({ geometry: stagesAlong(e.hptStages, 0.61 * L, 0.61 * L + 0.03 * L * e.hptStages, rc * 0.62, rc * 0.64, detailed ? shaftRadius.hp : 0), tone: "hp", spin: "hp", offset: v(0.6) });
    if (e.spools === 3) out.push({ geometry: stagesAlong(e.iptStages, 0.655 * L, 0.687 * L, rc * 0.68, rc * 0.70, shaftRadius.ip), tone: "ip", spin: "ip", offset: v(0.82) });
    out.push({ geometry: stagesAlong(lpt, (e.spools === 3 ? 0.71 : 0.69) * L, 0.88 * L, rc * 0.72, rc * 0.98, detailed ? shaftRadius.lp : 0), tone: "lp", spin: "lp", offset: v(1.05) });
  }
  if (e.spools === 3) {
    const ipShaft = new THREE.CylinderGeometry(shaftRadius.ip, shaftRadius.ip, 0.48 * L, 16, 1, true);
    axisX(ipShaft).translate(0.44 * L, 0, 0);
    out.push({ geometry: ipShaft, tone: "ip", spin: "ip", offset: v(0.10) });
  }

  // Валы: НД проходит внутри полого вала ВД от вентилятора до ТНД.
  const lpShaft = new THREE.CylinderGeometry(shaftRadius.lp, shaftRadius.lp, 0.8 * L, 12);
  axisX(lpShaft).translate(0.5 * L, 0, 0);
  out.push({ geometry: lpShaft, tone: "lp", spin: "lp", offset: v(0) });
  const hpStart = (e.spools === 3 ? 0.38 : 0.31) * L;
  const hpLen = (0.63 + 0.03 * e.hptStages) * L - hpStart;
  const hpShaft = new THREE.CylinderGeometry(shaftRadius.hp, shaftRadius.hp, hpLen, 16, 1, true);
  axisX(hpShaft).translate(hpStart + hpLen / 2, 0, 0);
  out.push({ geometry: hpShaft, tone: "hp", spin: "hp", offset: v(0.2) });

  // Кожух ядра с вырезом четверти — видно внутренности; сопло внутреннего контура и центральное тело.
  const cowl = [
    [1.05, 0.17],
    [1.2, 0.3],
    [1.28, 0.55],
    [1.18, 0.82],
    e.fanStyle ? [1.06, 0.86] : [0.95, 0.95],
  ].map(([r, x]) => new THREE.Vector2(r * rc, x * L));
  const casing = new THREE.LatheGeometry(cowl, 40, Math.PI * 0.5, Math.PI * 1.5);
  out.push({ geometry: axisX(casing), tone: "casing", spin: null, offset: v(0.1, 1.4) });
  if (fleet) {
    const fans = { cfm3b2: 1.52, cfm5b: 1.73, leap1a: 1.98, leap1b: 1.76, ps90a: 1.9 };
    const radialScale = e.fanDiameterM / fans[e.fanStyle as FleetStyle];
    const datum = mount ?? { spinnerX: fleet.fanFaceX * radialScale - .14 * L, lengthK: radialScale, radiusK: radialScale };
    return [...out, ...fleet.exhaust(L, rc, datum)];
  }
  if (e.fanStyle === "rb211" || e.fanStyle === "pw2037") {
    const rb = e.fanStyle === "rb211";
    const scale = e.fanDiameterM / (rb ? 1.88 : 1.99);
    const datum = mount ?? { lengthK: scale, radiusK: scale, spinnerX: rb ? (5.50 - 5.0359) * scale : .90 * scale - .10 * L };
    return [...out, ...exhaust757(e.fanStyle, L, rc, datum)];
  }
  const plug = new THREE.LatheGeometry(
    [
      [0.5, 0.86],
      [0.48, 0.95],
      [0.3, 1.04],
      [0.02, 1.1],
    ].map(([r, x]) => new THREE.Vector2(r * rc, x * L)),
    28,
  );
  out.push({ geometry: axisX(plug), tone: "lp", spin: null, offset: v(1.5) });
  return out;
}

// Installed profiles use the aircraft and engine variant. The two generic
// contours below remain fallbacks for older custom aircraft definitions.

export type NacelleStyle = NonNullable<EngineDef["nacelleProfile"]>;
export interface NacelleSegment {
  id: "inlet" | "lip" | "fanCowl" | "reverser" | "nozzle" | "coreCowl" | "plug" | "bypassLiner";
  geometry: THREE.BufferGeometry;
}

const NACELLE_PROFILES: Record<Exclude<NacelleStyle, FleetStyle>, { referenceLength: number; radius: number; fanFaceX: number; segs: Record<string, [number, number][]> }> = {
  // 737-800 template, axial sections of the lip, cowls and exhaust in metres.
  // The separate core and unscalloped fan nozzle are visible behind the reverser.
  "cfm56-7b": {
    referenceLength: B737_800_NACELLE.lengthM, radius: B737_800_NACELLE.widthM / 2, fanFaceX: 0.86,
    segs: {
      lip: [[0.86, 0.79], [0.35, 0.82], [0.12, 0.86], [0.02, 0.93],
        [0, 0.98], [0.06, 1.08], [0.26, 1.19], [0.51, 1.24]],
      fanCowl: [[0.51, 1.24], [0.80, 1.265], [1.40, 1.265], [2.12, 1.24]],
      reverser: [[2.12, 1.24], [2.43, 1.22], [2.98, 1.14], [3.38, 1.04], [3.58, 0.97], [3.58, 0.92]],
      coreCowl: [[3.15, 0.80], [3.58, 0.68], [3.78, 0.61], [4.03, 0.56]],
      nozzle: [[4.03, 0.56], [4.22, 0.48], [4.22, 0.44]],
      plug: [[4.04, 0.29], [4.47, 0.22], [4.96, 0.07], [5.16, 0]],
    },
  },
  longDuct: {
    referenceLength: 4.44,
    radius: 1.15,
    fanFaceX: 0.75,
    segs: {
      inlet: [[0.75, 0.865], [0.35, 0.83], [0.12, 0.8], [0.02, 0.81], [0, 0.84], [0.04, 0.95], [0.2, 1.06], [0.5, 1.12], [0.93, 1.15]],
      fanCowl: [[0.93, 1.15], [1.5, 1.16], [2.23, 1.13]],
      reverser: [[2.23, 1.13], [2.8, 1.06], [3.43, 0.93]],
      nozzle: [[3.43, 0.93], [3.76, 0.88], [4.96, 0.62]],
      plug: [[4.55, 0.4], [4.96, 0.28], [5.25, 0.04]],
    },
  },
  // 757-200 / RB211-535E4. Boeing 2.2.1 gives the installation and width.
  // The cowl and single mixed nozzle follow the near engine in the TF-FIW side photo.
  rb211: {
    referenceLength: 5.50,
    radius: 1.23,
    fanFaceX: 0.78,
    segs: {
      lip: [[0.78, 0.95], [0.37, 0.91], [0.12, 0.92], [0.035, 0.95], [0, 0.99],
        [0.015, 1.025], [0.08, 1.055], [0.23, 1.095]],
      inlet: [[0.23, 1.095], [0.50, 1.145], [0.80, 1.19], [1.05, 1.21]],
      fanCowl: [[1.05, 1.21], [1.40, 1.225], [1.72, 1.23], [2.08, 1.226], [2.55, 1.205]],
      reverser: [[2.55, 1.205], [3.05, 1.17], [3.65, 1.105], [4.15, 1.045], [4.50, 1.00], [4.50, 0.94]],
      nozzle: [[4.50, 0.94], [4.83, 0.90], [5.17, 0.85], [5.50, 0.80], [5.50, 0.765],
        [5.20, 0.81], [4.83, 0.86], [4.50, 0.905]],
      bypassLiner: [[4.50, 0.905], [4.04, 0.989], [3.65, 1.046], [3.05, 1.10],
        [2.35, 1.095], [1.55, 1.035], [0.78, 0.95]],
    },
  },
  // 757/PW2037: the large fan duct ends well ahead of the exposed core cowl.
  // Boeing 2.2.1 sets width and inlet station; axial stations follow Delta N6706Q.
  pw2037: {
    referenceLength: 6.05,
    radius: 1.345,
    fanFaceX: 0.90,
    segs: {
      lip: [[0.90, 1.015], [0.48, 1.005], [0.16, 0.995], [0.05, 1.015], [0, 1.055],
        [0.015, 1.09], [0.07, 1.135], [0.20, 1.18]],
      inlet: [[0.20, 1.18], [0.38, 1.225], [0.66, 1.275], [0.98, 1.31]],
      fanCowl: [[0.98, 1.31], [1.33, 1.335], [1.63, 1.345], [1.97, 1.34], [2.18, 1.33]],
      reverser: [[2.18, 1.33], [2.58, 1.30], [3.02, 1.25], [3.45, 1.185], [3.78, 1.12],
        [3.78, 1.09], [3.60, 1.115], [3.35, 1.15], [3.02, 1.19], [2.58, 1.23]],
      bypassLiner: [[2.58, 1.23], [2.12, 1.21], [1.54, 1.13], [0.90, 1.015]],
      coreCowl: [[3.30, 0.98], [3.78, 0.92], [4.35, 0.83], [4.92, 0.73]],
      nozzle: [[4.92, 0.73], [5.36, 0.65], [5.78, 0.575], [6.05, 0.54], [6.05, 0.51],
        [5.84, 0.537], [5.65, 0.57], [5.30, 0.626], [4.92, 0.692]],
      plug: [[5.48, 0.34], [5.70, 0.27], [5.86, 0.14], [5.94, 0]],
    },
  },
  separateFlow: {
    referenceLength: 4.44 * (1.98 / 1.73),
    radius: 1.3,
    fanFaceX: 0.75,
    segs: {
      inlet: [[0.75, 0.99], [0.35, 0.95], [0.12, 0.93], [0.02, 0.94], [0, 0.97], [0.05, 1.1], [0.3, 1.24], [0.66, 1.29]],
      fanCowl: [[0.66, 1.29], [1.3, 1.31], [2.12, 1.29]],
      reverser: [[2.12, 1.29], [2.9, 1.2], [3.65, 1.0], [3.62, 0.9]],
      coreCowl: [[3.3, 0.7], [3.65, 0.66], [4.1, 0.55], [4.4, 0.47]],
      plug: [[4.4, 0.36], [4.75, 0.22], [5.09, 0.02]],
    },
  },
};

export function nacelleStyleFor(engine: EngineDef): NacelleStyle {
  if (engine.nacelleProfile && engine.nacelleProfile !== "longDuct" && engine.nacelleProfile !== "separateFlow") return engine.nacelleProfile;
  // Definitions saved before installation profiles were recorded.
  if (engine.name.startsWith("RB211")) return "rb211";
  if (engine.name === "PW2037") return "pw2037";
  if (engine.name === "ПС-90А") return "ps90a";
  if (engine.name.startsWith("LEAP-1A")) return "leap1a";
  if (engine.name.startsWith("LEAP-1B")) return "leap1b";
  if (engine.name.startsWith("CFM56-5B")) return "cfm5b";
  if (engine.name.startsWith("CFM56-7B")) return "cfm56-7b";
  if (engine.name.startsWith("CFM56-3")) return "cfm3b2";
  if (engine.nacelleProfile) return engine.nacelleProfile;
  return engine.bypassRatio >= 8 ? "separateFlow" : "longDuct";
}

/** Сегменты гондолы вдоль оси +x от среза воздухозаборника; lengthK и radiusK — масштаб относительно базовой. */
export function nacelleSegments(style: NacelleStyle, lengthK: number, radiusK: number): NacelleSegment[] {
  if (isFleetStyle(style)) return fleetPackages[style].nacelle(lengthK, radiusK);
  const P = NACELLE_PROFILES[style];
  return Object.entries(P.segs).flatMap(([id, pts]): NacelleSegment[] => {
    if (style === "rb211" || style === "pw2037") {
      if (id === "bypassLiner") return [];
      if (id === "reverser") return reverser757Segments(style, pts, P.segs.bypassLiner, lengthK, radiusK);
    }
    const g = new THREE.LatheGeometry(
      pts.map(([x, r]) => new THREE.Vector2(r * radiusK, x * lengthK)),
      style === "rb211" || style === "pw2037" ? 64 : 48,
    );
    g.rotateZ(-Math.PI / 2);
    if (style === "cfm56-7b") {
      // The accessories widen the lower fan cowl. Keep the fan bore circular
      // and smoothly flatten the underside of the outer lip and reverser.
      const flattening = 1 - 2 * B737_800_NACELLE.lowerRadiusPerWidth;
      const points = g.getAttribute("position");
      for (let i = 0; i < points.count; i++) {
        const y = points.getY(i), z = points.getZ(i);
        const radius = Math.hypot(y, z) / radiusK;
        const shell = THREE.MathUtils.smoothstep(radius, 0.79, 1.07);
        const bottom = Math.max(0, -y / (P.radius * radiusK));
        points.setY(i, y * (1 - flattening * shell * bottom * bottom));
      }
      g.computeVertexNormals();
    }
    g.name = "nacelle-" + id;
    return [{ id: id as NacelleSegment["id"], geometry: g }];
  });
}

export function nacelleFanFace(style: NacelleStyle, lengthK: number): number {
  return (isFleetStyle(style) ? fleetPackages[style] : NACELLE_PROFILES[style]).fanFaceX * lengthK;
}

/** Vertical clearance at the fixed inlet station. Sample each linear cowl segment
 * separately so the fan-duct step and the wing leading edge are both included. */
export function clearance757(style: "pw2037" | "rb211", inletX: number, axisY: number, axisZ: number,
  lengthK: number, radiusK: number, wing: SurfaceShape, reverserTravel?: number): number {
  const profile = NACELLE_PROFILES[style];
  const radius = profile.radius * radiusK;
  let lines = Object.values(profile.segs);
  let sleeveHeight = 1;
  if (reverserTravel !== undefined) {
    const { front, sleeveEnd, travel, topBridge } = reverser757Layout(style);
    const offset = travel * reverserTravel;
    // The outer radius decreases aft. Its envelope over the entire stroke is
    // a cylinder at the front radius followed by the shifted outer contour.
    const outer: [number, number][] = [[front, profile.segs.reverser[0][1]]];
    for (const [x, r] of profile.segs.reverser) {
      outer.push([x + offset, r]);
      if (x >= sleeveEnd) break;
    }
    lines = [outer];
    sleeveHeight = Math.cos(topBridge);
  }
  const spanWidth = wing.semiSpanM * Math.cos(THREE.MathUtils.degToRad(wing.dihedralDeg));
  let gap = Infinity;
  for (let i = 0; i <= 48; i++) {
    const u = (axisZ + radius * (i / 24 - 1)) / spanWidth;
    if (u < 0 || u > 1) continue;
    const { le, chord } = wing.planform!(u);
    const leadingX = wing.root.x + le;
    for (const line of lines) {
      for (let j = 1; j < line.length; j++) {
        const [a, ra] = line[j - 1], [b, rb] = line[j];
        const lo = Math.max(leadingX, inletX + Math.min(a, b) * lengthK);
        const hi = Math.min(leadingX + chord, inletX + Math.max(a, b) * lengthK);
        if (hi < lo) continue;
        const steps = Math.max(1, Math.ceil((hi - lo) / 0.04));
        for (let k = 0; k <= steps; k++) {
          const x = lo + (hi - lo) * k / steps;
          const r = radiusK * (a === b ? Math.max(ra, rb) : ra + (rb - ra) * ((x - inletX) / lengthK - a) / (b - a));
          const pt = surfacePoint(wing, u, (x - leadingX) / chord, false);
          const dy2 = r * r - (pt.z - axisZ) ** 2;
          if (dy2 >= 0) gap = Math.min(gap, pt.y - axisY - Math.min(Math.sqrt(dy2), sleeveHeight * r));
        }
      }
    }
  }
  // For moving panels also allow 5 mm for the difference between the sampled
  // analytic wing and the triangles used for the leading edge in the scene.
  return gap - 0.08 - (reverserTravel === undefined ? 0 : 0.005);
}

export function nacelleScale(style: NacelleStyle, lengthM: number, widthM: number) {
  const profile = isFleetStyle(style) ? fleetPackages[style] : NACELLE_PROFILES[style];
  return { lengthK: lengthM / profile.referenceLength, radiusK: widthM / (2 * profile.radius) };
}

export function nacelleBaseRadius(style: NacelleStyle): number {
  return (isFleetStyle(style) ? fleetPackages[style] : NACELLE_PROFILES[style]).radius;
}

/** Труба по точкам — для трасс электрожгутов. */
export function tubeGeometry(points: THREE.Vector3[], radius: number): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points);
  return new THREE.TubeGeometry(curve, Math.max(16, points.length * 12), radius, 6, false);
}
