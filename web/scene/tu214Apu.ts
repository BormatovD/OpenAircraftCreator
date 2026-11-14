// Passenger Tu-214 / TA-12-60 inspection envelope. See docs/aggregates/tu214-apu.md.
// The package is deliberately independent of the aircraft mass estimator.
import * as THREE from "three";
import { type FuselageShape, fuselageHalfWidthAt, fuselageSection } from "./shapes.ts";

export interface ApuDoorMotion {
  pivot: THREE.Vector3;
  axis: THREE.Vector3;
  /** Full inspection opening, radians; not a certified actuator limit. */
  angle: number;
}

export interface Tu214ApuOpening {
  x0: number; x1: number; y0: number; y1: number; side: -1 | 1;
}

export interface Tu214ApuPackage {
  internal: THREE.BufferGeometry[];
  external: THREE.BufferGeometry[];
  variant: string;
  intakeOpenings: Tu214ApuOpening[];
  exhaustX: number;
  camera: { target: THREE.Vector3; direction: THREE.Vector3; distanceM: number };
}

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
/** Published legacy TA-12-60 delivery envelope; contour and installed plumbing are estimates. */
export const TU214_APU_ENVELOPE = { lengthM: 1.588, widthM: .682, heightM: .718 } as const;

function tagged(g: THREE.BufferGeometry, role: string, layer: "internal" | "external", tone = "detailSteel") {
  g.name = `tu214-apu-${role}`;
  Object.assign(g.userData, { apuRole: role, apuLayer: layer, apuVariant: "TA-12-60", tone });
  return g;
}

function cylinder(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1 = r0, open = false) {
  const delta = b.clone().sub(a), center = a.clone().lerp(b, .5);
  const g = new THREE.CylinderGeometry(r1, r0, delta.length(), 32, 1, open);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(v(0, 1, 0), delta.normalize()));
  return g.translate(center.x, center.y, center.z);
}

function box(center: THREE.Vector3, x: number, y: number, z: number) {
  return new THREE.BoxGeometry(x, y, z).translate(center.x, center.y, center.z);
}

function faces(points: THREE.Vector3[][]) {
  const coords: number[] = [];
  for (const q of points) for (let i = 1; i + 1 < q.length; i++) coords.push(...q[0].toArray(), ...q[i].toArray(), ...q[i + 1].toArray());
  const g = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(coords, 3));
  g.computeVertexNormals();
  return g;
}

function layout(f: FuselageShape) {
  // Both barrel inserts precede this complete, unscaled tail package.
  const startX = f.lengthM - 3.35, endX = startX + TU214_APU_ENVELOPE.lengthM;
  const axisY = fuselageSection(f, startX + .8).cy;
  const x0 = startX + .10, x1 = startX + .94;
  const y0 = axisY + .10, y1 = axisY + .61;
  return { startX, endX, axisY, exhaustX: f.lengthM - .32,
    openings: ([-1, 1] as const).map(side => ({ x0, x1, y0, y1, side })) };
}

function skinPoint(f: FuselageShape, x: number, y: number, side: number, offset = 0) {
  return v(x, y, side * (fuselageHalfWidthAt(f, x, y) + offset));
}

/** A curved closed panel, with its real fuselage surface in the closed pose. */
function intakePanel(f: FuselageShape, o: Tu214ApuOpening, inset = .012) {
  const quads: THREE.Vector3[][] = [];
  const point = (i: number, j: number, offset: number) => skinPoint(f,
    THREE.MathUtils.lerp(o.x0 + inset, o.x1 - inset, i / 12),
    THREE.MathUtils.lerp(o.y0 + inset, o.y1 - inset, j / 8), o.side, offset);
  for (let i = 0; i < 12; i++) for (let j = 0; j < 8; j++) {
    quads.push([point(i, j, .008), point(i + 1, j, .008), point(i + 1, j + 1, .008), point(i, j + 1, .008)]);
    quads.push([point(i, j, -.012), point(i, j + 1, -.012), point(i + 1, j + 1, -.012), point(i + 1, j, -.012)]);
  }
  for (const i of [0, 12]) for (let j = 0; j < 8; j++)
    quads.push([point(i, j, .008), point(i, j + 1, .008), point(i, j + 1, -.012), point(i, j, -.012)]);
  for (const j of [0, 8]) for (let i = 0; i < 12; i++)
    quads.push([point(i, j, .008), point(i + 1, j, .008), point(i + 1, j, -.012), point(i, j, -.012)]);
  return faces(quads);
}

/** Rectangular-to-round duct wall; open at both ends so the inlet is inspectable. */
function intakeDuct(f: FuselageShape, o: Tu214ApuOpening, end: THREE.Vector3) {
  const corners = [[o.x0, o.y0], [o.x1, o.y0], [o.x1, o.y1], [o.x0, o.y1]];
  const lip = corners.map(([x, y]) => skinPoint(f, x, y, o.side, -.025));
  const inner = corners.map(([x, y], i) => v(x, y, lip[i].z * .77));
  const round = corners.map((_, i) => v(end.x + .19 * (i === 0 || i === 3 ? -1 : 1), end.y + .17 * (i < 2 ? -1 : 1), end.z));
  return faces(lip.flatMap((p, i) => {
    const j = (i + 1) % 4;
    return [[p, lip[j], inner[j], inner[i]], [inner[i], inner[j], round[j], round[i]]];
  }));
}

/** Build only with the Tu-214 shape set selected, as with fuselageGeometry(). */
export function tu214Apu(f: FuselageShape): Tu214ApuPackage {
  const { startX: x, endX, axisY: y, exhaustX, openings } = layout(f);
  const internal: THREE.BufferGeometry[] = [], external: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, role: string, tone = "detailSteel") => internal.push(tagged(g, role, "internal", tone));
  // The outside casing shows the sequence of the supported TA-12-60 architecture.
  // No invented blade count, accessory part number, or wiring loom is asserted.
  add(cylinder(v(x + .29, y, 0), v(x + .76, y, 0), .225, .245), "compressor-case");
  add(cylinder(v(x + .76, y, 0), v(x + 1.16, y, 0), .278), "combustor-case", "detailPanel");
  add(cylinder(v(x + 1.16, y, 0), v(endX, y, 0), .245, .19), "turbine-case");
  add(cylinder(v(x + .04, y - .03, 0), v(x + .32, y - .03, 0), .21, .225), "accessory-gearbox", "detailPanel");
  add(cylinder(v(x, y - .225, .155), v(x + .54, y - .225, .155), .112), "generator");
  add(cylinder(v(x + .05, y - .135, -.19), v(x + .42, y - .135, -.19), .09), "starter");
  // Generic supported oil service volume; not a named oil-tank installation.
  add(box(v(x + .57, y + .235, -.09), .24, .18, .21), "oil-service-volume", "detailPanel");
  for (const dx of [.31, .74, 1.16, 1.51])
    add(cylinder(v(x + dx - .016, y, 0), v(x + dx + .016, y, 0), dx === .74 || dx === 1.16 ? .285 : .24), "case-flange");
  for (const dx of [.38, 1.32]) for (const side of [-1, 1]) {
    const base = v(x + dx, y - .42, side * .37);
    add(cylinder(base, v(x + dx, y - .14, side * .18), .022), "mount-link");
    add(box(base, .16, .045, .12), "mount-foot", "detailPanel");
  }
  // Air extraction and service lines are short, generic interface runs.
  add(cylinder(v(x + .82, y + .25, 0), v(x + .82, y + .41, .10), .055), "bleed-interface");
  add(cylinder(v(x + .82, y + .41, .10), v(x + .19, y + .41, .10), .055), "bleed-duct");
  add(cylinder(v(x + .21, y - .18, -.15), v(x + .88, y - .21, -.20), .012), "service-line");
  for (const o of openings) {
    const side = o.side;
    add(intakeDuct(f, o, v(x + .34, y + .08, side * .22)), `intake-duct-${side}` , "detailDark");
    const door = tagged(intakePanel(f, o), `intake-door-${side}`, "external", "detailPanel");
    const motion: ApuDoorMotion = { pivot: skinPoint(f, o.x1 - .012, (o.y0 + o.y1) / 2, side), axis: v(0, 1, 0), angle: side * Math.PI / 3 };
    door.userData.apuDoor = motion;
    external.push(door);
    // A thin visible reveal follows the aperture; no black decal over intact skin.
    const rim = faces([[skinPoint(f, o.x0, o.y0, side, .006), skinPoint(f, o.x1, o.y0, side, .006), skinPoint(f, o.x1, o.y0, side, -.035), skinPoint(f, o.x0, o.y0, side, -.035)],
      [skinPoint(f, o.x0, o.y1, side, .006), skinPoint(f, o.x1, o.y1, side, .006), skinPoint(f, o.x1, o.y1, side, -.035), skinPoint(f, o.x0, o.y1, side, -.035)],
      [skinPoint(f, o.x0, o.y0, side, .006), skinPoint(f, o.x0, o.y1, side, .006), skinPoint(f, o.x0, o.y1, side, -.035), skinPoint(f, o.x0, o.y0, side, -.035)],
      [skinPoint(f, o.x1, o.y0, side, .006), skinPoint(f, o.x1, o.y1, side, .006), skinPoint(f, o.x1, o.y1, side, -.035), skinPoint(f, o.x1, o.y0, side, -.035)]]);
    external.push(tagged(rim, `intake-reveal-${side}`, "external"));
  }
  const outletY = fuselageSection(f, exhaustX).cy, r = .175;
  add(cylinder(v(endX, y, 0), v(endX + .23, y + .04, 0), .19, .23, true), "exhaust-transition");
  // Open wall, with its opposite inner surface: no solid cylinder across the gas path.
  const pipeA = v(endX + .23, y + .04, 0), pipeB = v(exhaustX + .018, outletY, 0);
  add(cylinder(pipeA, pipeB, .23, r, true), "exhaust-pipe", "detailDark");
  const innerPipe = cylinder(pipeA, pipeB, .22, r - .009, true);
  // Reverse the inner wall normals so it remains visible through the open lip.
  const ix = innerPipe.getIndex()!;
  for (let i = 0; i < ix.count; i += 3) { const a = ix.getX(i); ix.setX(i, ix.getX(i + 1)); ix.setX(i + 1, a); }
  innerPipe.computeVertexNormals();
  add(innerPipe, "exhaust-inner-wall", "detailDark");
  // The final hull nose is replaced with an annular aft face around the outlet.
  const sec = fuselageSection(f, exhaustX), annulus: THREE.Vector3[][] = [];
  for (let i = 0; i < 64; i++) {
    const a = 2 * Math.PI * i / 64, b = 2 * Math.PI * (i + 1) / 64;
    const outer = (t: number) => v(exhaustX, sec.cy + sec.hh * Math.sin(t), sec.hw * Math.cos(t));
    const inner = (t: number) => v(exhaustX + .02, outletY + r * Math.sin(t), r * Math.cos(t));
    annulus.push([outer(a), outer(b), inner(b), inner(a)]);
  }
  external.push(tagged(faces(annulus), "exhaust-lip", "external"));
  const throat = faces(Array.from({ length: 48 }, (_, i) => {
    const a = Math.PI * 2 * i / 48, b = Math.PI * 2 * (i + 1) / 48;
    return [v(exhaustX - .20, outletY, 0), v(exhaustX - .20, outletY + (r - .01) * Math.sin(a), (r - .01) * Math.cos(a)), v(exhaustX - .20, outletY + (r - .01) * Math.sin(b), (r - .01) * Math.cos(b))];
  }));
  external.push(tagged(throat, "exhaust-depth", "external", "detailDark"));
  return { internal, external, variant: "ТА-12-60 · пассажирский Ту-214", intakeOpenings: openings, exhaustX,
    camera: { target: v(x + 1.25, y + .12, 0), direction: v(1, .35, 1).normalize(), distanceM: 5.7 } };
}

type Vertex = { index: number; p: THREE.Vector3; n: THREE.Vector3; uv: THREE.Vector2 };
type Plane = (p: THREE.Vector3) => number;
function split(poly: Vertex[], plane: Plane): [Vertex[], Vertex[]] {
  const inside: Vertex[] = [], outside: Vertex[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], da = plane(a.p), db = plane(b.p);
    if (da >= 0) inside.push(a);
    if (da <= 0) outside.push(a);
    if (da * db < 0) {
      const t = da / (da - db), cut = { index: -1, p: a.p.clone().lerp(b.p, t), n: a.n.clone().lerp(b.n, t).normalize(), uv: a.uv.clone().lerp(b.uv, t) };
      inside.push(cut); outside.push(cut);
    }
  }
  return [inside, outside];
}

/** Cut only this package's paired side apertures and terminal aft opening.
 * Clip triangles instead of deleting entire faces; preserve the original vertex
 * indices/radial-ring layout and append only the intersections with interpolated UVs.
 * Call once after fuselageGeometry(), before material assignment. */
export function cutTu214ApuOpenings(hull: THREE.BufferGeometry, f: FuselageShape) {
  const { openings, exhaustX } = layout(f);
  const p = hull.getAttribute("position"), n = hull.getAttribute("normal"), uv = hull.getAttribute("uv"), index = hull.getIndex();
  const pos: number[] = [], normals: number[] = [], tex: number[] = [], indices: number[] = [];
  const read = (i: number): Vertex => ({ index: i, p: v(p.getX(i), p.getY(i), p.getZ(i)), n: v(n.getX(i), n.getY(i), n.getZ(i)), uv: new THREE.Vector2(uv?.getX(i) ?? 0, uv?.getY(i) ?? 0) });
  const id = (vertex: Vertex) => {
    if (vertex.index >= 0) return vertex.index;
    vertex.index = p.count + pos.length / 3;
    pos.push(...vertex.p.toArray()); normals.push(...vertex.n.toArray()); tex.push(...vertex.uv.toArray());
    return vertex.index;
  };
  for (let i = 0; i < (index?.count ?? p.count); i += 3) {
    let polys = [[0, 1, 2].map(j => read(index ? index.getX(i + j) : i + j))];
    polys = polys.map(poly => split(poly, pt => exhaustX - pt.x)[0]).filter(poly => poly.length >= 3);
    for (const o of openings) {
      const planes: Plane[] = [pt => pt.x - o.x0, pt => o.x1 - pt.x, pt => pt.y - o.y0, pt => o.y1 - pt.y, pt => o.side * pt.z - .5];
      polys = polys.flatMap(poly => {
        if (planes.some(plane => poly.every(vertex => plane(vertex.p) <= 0))) return [poly];
        const remain: Vertex[][] = [];
        let portion = poly;
        for (const plane of planes) {
          const [inside, outside] = split(portion, plane);
          if (outside.length >= 3) remain.push(outside);
          portion = inside;
          if (inside.length < 3) break;
        }
        return remain;
      });
    }
    for (const poly of polys) for (let j = 1; j + 1 < poly.length; j++) indices.push(id(poly[0]), id(poly[j]), id(poly[j + 1]));
  }
  hull.setIndex(indices);
  hull.setAttribute("position", new THREE.Float32BufferAttribute([...p.array, ...pos], 3));
  hull.setAttribute("normal", new THREE.Float32BufferAttribute([...n.array, ...normals], 3));
  if (uv) hull.setAttribute("uv", new THREE.Float32BufferAttribute([...uv.array, ...tex], 2));
  hull.clearGroups(); hull.computeBoundingBox(); hull.computeBoundingSphere();
  hull.userData.tu214ApuOpenings = true;
}
