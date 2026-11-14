// Rectangular wheel-well boundaries in plan. Only rigid lower skins are trimmed;
// keep the original vertex layout and UVs elsewhere, including the cockpit and wing tips.
import * as THREE from "three";

export type BayOpening = { x0: number; x1: number; z0: number; z1: number };
/** A blind well has sidewalls and a ceiling, so an open bay is not a window into the cabin.
 * The lower edge follows its installed skin, and sits behind the narrow hinge sill. */
export function wellLiner(name: string, x0: number, x1: number, halfWidth: number, roof: (x: number, z: number) => number,
  lower: (x: number, z: number) => number, side: -1 | 0 | 1, innerWidth = 0) {
  const positions: number[] = [], z0 = side === 0 ? -halfWidth : Math.min(side * innerWidth, side * halfWidth);
  const z1 = side === 0 ? halfWidth : Math.max(side * innerWidth, side * halfWidth);
  type Point = [number, number, number];
  const quad = (a: Point, b: Point, c: Point, d: Point) => {
    const triangles = [a, b, c, a, c, d];
    for (const vertex of triangles) positions.push(...vertex);
  };
  for (let i = 0; i < 12; i++) {
    const a = THREE.MathUtils.lerp(z0, z1, i / 12), b = THREE.MathUtils.lerp(z0, z1, (i + 1) / 12);
    quad([x0, roof(x0, a), a], [x0, roof(x0, b), b], [x1, roof(x1, b), b], [x1, roof(x1, a), a]);
  }
  for (const z of [z0, z1]) {
    if (innerWidth > 0 && Math.abs(z) === innerWidth) continue;
    for (let i = 0; i < 8; i++) {
      const a = THREE.MathUtils.lerp(x0, x1, i / 8), b = THREE.MathUtils.lerp(x0, x1, (i + 1) / 8);
      quad([a, lower(a, Math.abs(z)) + .025, z], [b, lower(b, Math.abs(z)) + .025, z], [b, roof(b, z), z], [a, roof(a, z), z]);
    }
  }
  for (const x of [x0, x1]) {
    for (let i = 0; i < 8; i++) {
      const a = THREE.MathUtils.lerp(z0, z1, i / 8), b = THREE.MathUtils.lerp(z0, z1, (i + 1) / 8);
      quad([x, lower(x, Math.abs(a)) + .025, a], [x, lower(x, Math.abs(b)) + .025, b], [x, roof(x, b), b], [x, roof(x, a), a]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.computeVertexNormals();
  g.name = name;
  g.userData.gearWell = true;
  g.userData.tone = "detailDark";
  g.userData.side = side;
  g.userData.basePos = new THREE.Vector3();
  return g;
}

type Vertex = { index: number; x: number; y: number; z: number; nx: number; ny: number; nz: number; u: number; v: number };
type Axis = "x" | "z";

function slice(polygon: Vertex[], axis: Axis, at: number, sign: number): [Vertex[], Vertex[]] {
  const inside: Vertex[] = [], outside: Vertex[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const da = (a[axis] - at) * sign, db = (b[axis] - at) * sign;
    (da >= 0 ? inside : outside).push(a);
    if (da * db >= 0) continue;
    const t = da / (da - db), mix = (a: number, b: number) => a + t * (b - a);
    const cut = {
      index: -1, x: mix(a.x, b.x), y: mix(a.y, b.y), z: mix(a.z, b.z),
      nx: mix(a.nx, b.nx), ny: mix(a.ny, b.ny), nz: mix(a.nz, b.nz), u: mix(a.u, b.u), v: mix(a.v, b.v)
    };
    inside.push(cut);
    outside.push(cut);
  }
  return [inside, outside];
}

function removeOpening(polygon: Vertex[], opening: BayOpening): Vertex[][] {
  const { x0, x1, z0, z1 } = opening;
  if (polygon.every(p => p.x <= x0) || polygon.every(p => p.x >= x1) ||
    polygon.every(p => p.z <= z0) || polygon.every(p => p.z >= z1)) return [polygon];
  const remains: Vertex[][] = [];
  let portion = polygon;
  for (const [axis, at, sign] of [["x", x0, 1], ["x", x1, -1], ["z", z0, 1], ["z", z1, -1]] as const) {
    const [inner, outer] = slice(portion, axis, at, sign);
    if (outer.length >= 3) remains.push(outer);
    if (inner.length < 3) break;
    portion = inner;
  }
  return remains;
}

export function cutBayOpenings(g: THREE.BufferGeometry, openings: BayOpening[], keepUpper: boolean) {
  const p = g.getAttribute("position"), n = g.getAttribute("normal"), uv = g.getAttribute("uv"), index = g.getIndex();
  if (!index || !uv || !n) return;
  const pos: number[] = [], normals: number[] = [], tex: number[] = [], faces: number[] = [];
  const read = (i: number): Vertex => ({
    index: i, x: p.getX(i), y: p.getY(i), z: p.getZ(i),
    nx: n.getX(i), ny: n.getY(i), nz: n.getZ(i), u: uv.getX(i), v: uv.getY(i)
  });
  const id = (pt: Vertex) => {
    if (pt.index >= 0) return pt.index;
    pt.index = p.count + pos.length / 3;
    pos.push(pt.x, pt.y, pt.z);
    const length = Math.hypot(pt.nx, pt.ny, pt.nz) || 1;
    normals.push(pt.nx / length, pt.ny / length, pt.nz / length);
    tex.push(pt.u, pt.v);
    return pt.index;
  };
  let cut = false;
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
    const candidates = openings.filter(o =>
      Math.max(p.getX(a), p.getX(b), p.getX(c)) > o.x0 && Math.min(p.getX(a), p.getX(b), p.getX(c)) < o.x1 &&
      Math.max(p.getZ(a), p.getZ(b), p.getZ(c)) > o.z0 && Math.min(p.getZ(a), p.getZ(b), p.getZ(c)) < o.z1);
    if (!candidates.length || (keepUpper && n.getY(a) + n.getY(b) + n.getY(c) >= 0)) {
      faces.push(a, b, c);
      continue;
    }
    cut = true;
    let polygons = [[read(a), read(b), read(c)]];
    for (const opening of candidates) polygons = polygons.flatMap(poly => removeOpening(poly, opening));
    for (const poly of polygons) for (let j = 1; j + 1 < poly.length; j++) faces.push(id(poly[0]), id(poly[j]), id(poly[j + 1]));
  }
  if (!cut) return;
  g.setAttribute("position", new THREE.Float32BufferAttribute([...p.array, ...pos], 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute([...n.array, ...normals], 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute([...uv.array, ...tex], 2));
  g.setIndex(faces);
}
