// Параметрические формы: фюзеляж по сечениям, несущие поверхности с профилем, тела вращения.
// Система координат: x — вдоль фюзеляжа назад от носа, y — вверх, z — по размаху вправо. Метры.

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { buildCockpitFairing, insideCockpitFairing } from "./cockpitFairing.ts";
import { S } from "./shapeSet.ts";
import { cockpitFacets, cockpitSurfaceWidth, type CockpitFacet } from "./cockpitSurfaces.ts";

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
  planform?: (u: number) => { le: number; chord: number; thickness?: number };
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
  const d = (s.dihedralDeg * Math.PI) / 180;
  const half = (s.halfThickness ? s.halfThickness(u, v) : nacaHalfThickness(Math.max(1e-4, v), t) * chord) * (upper ? 1 : -1);
  // Базис консоли: вдоль размаха и по нормали к её плоскости (для киля нормаль — вдоль z).
  const spanDir = new THREE.Vector3(0, Math.sin(d), side * Math.cos(d));
  const normal = new THREE.Vector3(0, Math.cos(d), -side * Math.sin(d));
  return new THREE.Vector3(s.root.x + le + v * chord, s.root.y, s.root.z)
    .addScaledVector(spanDir, span)
    .addScaledVector(normal, half);
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

// ——— Разрез двухвального ТРДД ———
// Суть, которую должна показывать модель: вентилятор делит поток на наружный контур (B частей) и
// внутренний (1 часть); ядро тем меньше относительно вентилятора, чем выше B; вентилятор и подпорный
// компрессор вращает турбина низкого давления (вал НД), компрессор высокого давления — турбина высокого
// давления (вал ВД), и валы вращаются с разной скоростью.

export type Tone = "lp" | "hp" | "hot" | "casing";
export interface EnginePiece {
  geometry: THREE.BufferGeometry;
  tone: Tone;
  /** Какой вал вращает деталь; у неподвижных — null. */
  spin: "lp" | "hp" | null;
  /** Смещение при разборе двигателя, м (вдоль оси x и вверх). */
  offset: THREE.Vector3;
  label?: string;
}

export interface EngineSpec {
  fanDiameterM: number;
  bypassRatio: number;
  lengthM: number;
  fanBlades: number;
  boosterStages: number;
  hpcStages: number;
  hptStages: number;
  /** Редуктор вентилятора: быстроходная ТНД из трёх ступеней. */
  gearbox?: boolean;
}

/** Ступени ТНД: больше вентилятор → медленнее вал НД → больше ступеней турбины (CFM56 4, LEAP 7). */
export function lptStagesFor(bpr: number): number {
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

function stagesAlong(n: number, x0: number, x1: number, r0: number, r1: number): THREE.BufferGeometry {
  const gap = (x1 - x0) / n;
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1);
    parts.push(stageDisc(x0 + i * gap, r0 + (r1 - r0) * t, gap * 0.55));
  }
  return mergeGeometries(parts)!;
}

export function engineCutaway(e: EngineSpec): EnginePiece[] {
  const R = e.fanDiameterM / 2;
  const L = e.lengthM;
  const rc = coreRadiusFor(R, e.bypassRatio);
  const hub = 0.28 * R;
  const lpt = e.gearbox ? 3 : lptStagesFor(e.bypassRatio);
  const v = (x: number, y = 0) => new THREE.Vector3(x, y, 0);
  const out: EnginePiece[] = [];

  // Кок вентилятора.
  const spinner = new THREE.LatheGeometry(
    [0, 0.25, 0.5, 0.75, 1].map((t) => new THREE.Vector2(hub * Math.sqrt(t), 0.1 * L * t)),
    32,
  );
  out.push({ geometry: axisX(spinner), tone: "lp", spin: "lp", offset: v(-1.6) });

  // Лопатки вентилятора: широкая хорда, закрутка ~35°.
  const blades: THREE.BufferGeometry[] = [];
  const chord = 0.09 * L;
  for (let i = 0; i < e.fanBlades; i++) {
    const b = new THREE.BoxGeometry(chord, 0.97 * R - hub, Math.max(0.012, 0.6 / e.fanBlades));
    b.translate(0, hub + (0.97 * R - hub) / 2, 0);
    b.rotateY((-35 * Math.PI) / 180);
    b.rotateX((i / e.fanBlades) * Math.PI * 2);
    b.translate(0.1 * L + chord / 2, 0, 0);
    blades.push(b.toNonIndexed());
  }
  const hubDisc = stageDisc(0.09 * L, hub, 0.07 * L).toNonIndexed();
  out.push({ geometry: mergeGeometries([...blades, hubDisc])!, tone: "lp", spin: "lp", offset: v(-1.2) });

  // Подпорный компрессор (на валу НД), КВД, камера сгорания, ТВД, ТНД.
  out.push({ geometry: stagesAlong(e.boosterStages, 0.2 * L, 0.29 * L, rc * 0.95, rc * 0.88), tone: "lp", spin: "lp", offset: v(-0.6) });
  out.push({ geometry: stagesAlong(e.hpcStages, 0.32 * L, 0.52 * L, rc * 0.78, rc * 0.5), tone: "hp", spin: "hp", offset: v(-0.15) });
  const comb = new THREE.TorusGeometry(rc * 0.56, rc * 0.13, 16, 48);
  comb.rotateY(Math.PI / 2);
  comb.translate(0.56 * L, 0, 0);
  out.push({ geometry: comb, tone: "hot", spin: null, offset: v(0.25) });
  out.push({ geometry: stagesAlong(e.hptStages, 0.61 * L, 0.61 * L + 0.03 * L * e.hptStages, rc * 0.62, rc * 0.64), tone: "hp", spin: "hp", offset: v(0.6) });
  out.push({ geometry: stagesAlong(lpt, 0.69 * L, 0.88 * L, rc * 0.72, rc * 0.98), tone: "lp", spin: "lp", offset: v(1.05) });

  // Валы: НД проходит внутри полого вала ВД от вентилятора до ТНД.
  const lpShaft = new THREE.CylinderGeometry(rc * 0.07, rc * 0.07, 0.8 * L, 12);
  axisX(lpShaft).translate(0.5 * L, 0, 0);
  out.push({ geometry: lpShaft, tone: "lp", spin: "lp", offset: v(0) });
  const hpLen = 0.32 * L + 0.03 * L * e.hptStages;
  const hpShaft = new THREE.CylinderGeometry(rc * 0.15, rc * 0.15, hpLen, 16, 1, true);
  axisX(hpShaft).translate(0.31 * L + hpLen / 2, 0, 0);
  out.push({ geometry: hpShaft, tone: "hp", spin: "hp", offset: v(0.2) });

  // Кожух ядра с вырезом четверти — видно внутренности; сопло внутреннего контура и центральное тело.
  const cowl = [
    [1.05, 0.17],
    [1.2, 0.3],
    [1.28, 0.55],
    [1.18, 0.82],
    [0.95, 0.95],
  ].map(([r, x]) => new THREE.Vector2(r * rc, x * L));
  const casing = new THREE.LatheGeometry(cowl, 40, Math.PI * 0.5, Math.PI * 1.5);
  out.push({ geometry: axisX(casing), tone: "casing", spin: null, offset: v(0.1, 1.4) });
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

// ——— Гондолы по AC 2-12-0 ———
// CFM56-5B (A320ceo): длинный канал со смешением потоков — воздухозаборник 0,93 м, капоты вентилятора 1,3 м,
// реверс 1,2 м, затем общее сопло 1,2 м и центральное тело; высота 2,3 м, ширина 2,1 м.
// LEAP-1A (A320neo): раздельные потоки — воздухозаборник, капоты 1,46 м, реверс 1,53 м (срез сопла наружного
// контура), открытый кожух ядра, сопло внутреннего контура и конус — 1,44 м; высота 2,60 м.
// Профили — радиус по длине в метрах для базовой гондолы; модель масштабирует их по рычагам.

export type NacelleStyle = "longDuct" | "separateFlow" | "ps90a" | "rb211" | "pw2037";
export interface NacelleSegment {
  id: "inlet" | "lip" | "fanCowl" | "reverser" | "nozzle" | "coreCowl" | "plug";
  geometry: THREE.BufferGeometry;
}

const NACELLE_PROFILES: Record<NacelleStyle, { referenceLength: number; radius: number; fanFaceX: number; segs: Record<string, [number, number][]> }> = {
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
      nozzle: [[4.50, 0.94], [4.83, 0.90], [5.17, 0.85], [5.50, 0.80], [5.50, 0.765], [5.20, 0.81]],
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
        [3.78, 1.09], [3.35, 1.15]],
      coreCowl: [[3.30, 0.98], [3.78, 0.92], [4.35, 0.83], [4.92, 0.73]],
      nozzle: [[4.92, 0.73], [5.36, 0.65], [5.78, 0.575], [6.05, 0.54], [6.05, 0.51], [5.65, 0.57]],
      plug: [[5.48, 0.34], [5.70, 0.27], [5.86, 0.14], [5.94, 0]],
    },
  },
  // Tu-204-200 side view. Distances from the inlet to the four cowl seams
  // are 1.30, 2.55, 4.10 and 5.20 m. The common exhaust has an open lip.
  ps90a: {
    referenceLength: 6.15,
    radius: 1.18,
    fanFaceX: 1.15,
    segs: {
      inlet: [[1.15, 0.96], [0.55, 0.91], [0.18, 0.85], [0.05, 0.84], [0, 0.87],
        [0, 0.90], [0.05, 0.96], [0.20, 1.04], [0.50, 1.12], [0.90, 1.16], [1.30, 1.18]],
      fanCowl: [[1.30, 1.18], [1.55, 1.18], [2.00, 1.15], [2.55, 1.08]],
      reverser: [[2.55, 1.08], [3.20, 0.99], [4.10, 0.84], [4.62, 0.75], [5.20, 0.60]],
      nozzle: [[5.20, 0.60], [5.68, 0.59], [6.15, 0.57], [6.15, 0.54], [5.83, 0.55]],
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

export function nacelleStyleFor(bypassRatio: number): NacelleStyle {
  return bypassRatio >= 8 ? "separateFlow" : "longDuct";
}

/** Сегменты гондолы вдоль оси +x от среза воздухозаборника; lengthK и radiusK — масштаб относительно базовой. */
export function nacelleSegments(style: NacelleStyle, lengthK: number, radiusK: number): NacelleSegment[] {
  const P = NACELLE_PROFILES[style];
  return Object.entries(P.segs).map(([id, pts]) => {
    const g = new THREE.LatheGeometry(
      pts.map(([x, r]) => new THREE.Vector2(r * radiusK, x * lengthK)),
      48,
    );
    g.rotateZ(-Math.PI / 2);
    return { id: id as NacelleSegment["id"], geometry: g };
  });
}

export function nacelleFanFace(style: NacelleStyle, lengthK: number): number {
  return NACELLE_PROFILES[style].fanFaceX * lengthK;
}
export function nacelleScale(style: NacelleStyle, lengthM: number, widthM: number) {
  return { lengthK: lengthM / NACELLE_PROFILES[style].referenceLength, radiusK: widthM / (2 * nacelleBaseRadius(style)) };
}

export function nacelleBaseRadius(style: NacelleStyle): number {
  return NACELLE_PROFILES[style].radius;
}

/** Труба по точкам — для трасс электрожгутов. */
export function tubeGeometry(points: THREE.Vector3[], radius: number): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points);
  return new THREE.TubeGeometry(curve, Math.max(16, points.length * 12), radius, 6, false);
}
