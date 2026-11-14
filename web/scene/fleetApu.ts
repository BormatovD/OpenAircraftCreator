import * as THREE from "three";
import type { AircraftDefinition } from "../../src/definition.ts";
import { useShapes } from "./shapeSet.ts";
import { type FuselageShape, fuselageHalfWidthAt, fuselageSection, tubeGeometry } from "./shapes.ts";

export interface FleetApuVariant {
  id: "131-9a" | "85-129" | "131-9b" | "331-200er";
  name: string;
  referenceConfiguration: string;
  inspectionSide: string;
  alternatives: string[];
  sources: { title: string; url: string }[];
  limitations: string;
}

export interface ApuHullOpening {
  x0: number; x1: number;
  /** Same azimuth as fuselageGeometry: 0 = +Z (port), π/2 = up, π = starboard. */
  angle0: number; angle1: number;
}

export interface FleetApuPackage {
  internal: THREE.BufferGeometry[];
  external: THREE.BufferGeometry[];
  variant: FleetApuVariant;
  openings: ApuHullOpening[];
  camera: { target: THREE.Vector3; direction: THREE.Vector3; distanceM: number };
  intake: { point: THREE.Vector3; outward: THREE.Vector3 };
  bounds: { startX: number; endX: number };
}

const sources = {
  honeywell131: { title: "Honeywell · 131 Series", url: "https://www.honeywellaerospace.com/us/en/products-and-services/products/power-and-propulsion/auxiliary-power-units/131-series-auxiliary-power-units.view-all" },
  honeywellNeo: { title: "Honeywell · 131-9A: A320 / A320neo", url: "https://www.honeywellaerospace.com/us/en/products-and-services/products/power-and-propulsion/auxiliary-power-units/131-9a-apu-ignition-exciter-upgrade" },
  airbus: { title: "Airbus AC A320 · 2-12-0, installation", url: "https://www.aircraft.airbus.com/sites/g/files/jlcbta126/files/2024-06/AC_A320_0624.pdf" },
  airbus319: { title: "Airbus AC A319 · 2-12-0, installation", url: "https://mediaassets.airbus.com/pm_38_916_916263-0hxcf0237y.pdf#page=110" },
  airbus321: { title: "Airbus AC A321 · 2-12-0, installation", url: "https://aircraft.airbus.com/sites/g/files/jlcbta126/files/2025-07/AC_A321_20250715.pdf" },
  classic: { title: "Boeing AFM 737-300 · D6-8730, 1/11", url: "https://www.portail-navigabilite.online/espace_inspecteurs/uploads/afm_b737_d6-8730-b-3301-s.pdf" },
  classicNoise: { title: "EASA · 737 Classic TCDSN, Volume 1", url: "https://www.easa.europa.eu/en/downloads/16980/en" },
  boeing131: { title: "Honeywell · 131-9B on NG and MAX", url: "https://www.honeywell.com/us/en/news/press-releases/2023/06/honeywell-upgrade-for-aircraft-auxiliary-power-unit-lowers-fuel-consumption-and-co2-emissions" },
  boeing737: { title: "Boeing 737 FCOM · 7.30.1, APU location", url: "https://toulouse747.com/wp-content/uploads/2018/12/Boeing-B737-700-800-900-Operations-Manual.pdf" },
  boeing757: { title: "Boeing 757 AMM · 49-15-00, inlet", url: "https://electronicsandbooks.com/edt/manual/Hardware/B/Boeing/757/757_GUI_AMM_D633N132_TD/PDF/49___060.pdf" },
  easa757: { title: "EASA · 757 TCDS, III.6", url: "https://www.easa.europa.eu/en/downloads/7246/en" },
};

/** An explicit reference fit, never inferred from the main engine manufacturer. */
export function fleetApuVariantFor(def: AircraftDefinition): FleetApuVariant | null {
  const limitations = "Эскиз установки: размеры корпусов, станции и угол открытия требуют установочного чертежа ATA 49. Масса ВСУ берётся из расчётной модели самолёта.";
  if (/^a(319|320|321)(ceo|neo)$/.test(def.id)) {
    const neo = def.id.endsWith("neo");
    return { id: "131-9a", name: "Honeywell 131-9A", referenceConfiguration: `${def.id.slice(0, 4).toUpperCase()}${neo ? "neo" : "ceo"} · 131-9A · традиционный нижний вход (до Cobra Duct)`,
      inspectionSide: "снизу справа", alternatives: neo ? [] : ["Pratt & Whitney APS3200 (проверять effectivity самолёта)"],
      sources: [sources.honeywell131, sources.honeywellNeo, def.id.startsWith("a319") ? sources.airbus319 : def.id.startsWith("a321") ? sources.airbus321 : sources.airbus], limitations };
  }
  if (def.id === "b737-300") return { id: "85-129", name: "Garrett / Honeywell GTCP85-129",
    referenceConfiguration: "737-300 Classic · GTCP85-129 · правый бортовой вход", inspectionSide: "справа",
    alternatives: ["Honeywell GTCP36-280(B)", "Hamilton Sundstrand APS2000"], sources: [sources.classic, sources.classicNoise], limitations };
  if (["b737-800", "b737-8"].includes(def.id)) return { id: "131-9b", name: "Honeywell 131-9B",
    referenceConfiguration: `${def.id === "b737-8" ? "737 MAX 8" : "737-800 NG"} · 131-9B · правый бортовой вход`, inspectionSide: "справа",
    alternatives: [], sources: [sources.boeing131, sources.boeing737], limitations };
  if (/^b757-200-(rb|pw)$/.test(def.id)) return { id: "331-200er", name: "Garrett / Honeywell GTCP331-200ER",
    referenceConfiguration: "757-200 · GTCP331-200ER · вход справа над стабилизатором", inspectionSide: "сверху справа",
    alternatives: ["Garrett GTCP331-200A (TCDS, проверить конфигурацию самолёта)"], sources: [sources.easa757, sources.boeing757], limitations };
  return null;
}

function piece(g: THREE.BufferGeometry, name: string, role: string, tone: "detailSteel" | "detailDark" | "detailPanel" = "detailSteel") {
  g.name = name;
  g.userData.apuRole = role;
  g.userData.tone = tone;
  return g;
}

function cylinder(x: number, y: number, z: number, length: number, r0: number, r1 = r0, open = false) {
  return new THREE.CylinderGeometry(r1, r0, length, 32, 1, open).rotateZ(-Math.PI / 2).translate(x, y, z);
}

/** Physical starboard is forward (−X) × up (+Y) = −Z. Reflect the
 * construction convention once, including winding and the axial hinge vector. */
function reflectToStarboard(g: THREE.BufferGeometry) {
  g.scale(1, 1, -1);
  if (!g.index) g.setIndex(Array.from({ length: g.getAttribute("position").count }, (_, i) => i));
  const index = g.index!;
  for (let i = 0; i < index.count; i += 3) {
    const b = index.getX(i + 1); index.setX(i + 1, index.getX(i + 2)); index.setX(i + 2, b);
  }
  index.needsUpdate = true;
  const door = g.userData.apuDoor;
  if (door) {
    door.pivot.z *= -1;
    // Rotation axes are axial vectors: under reflection a' = det(M) M a.
    door.axis.x *= -1; door.axis.y *= -1;
  }
}

/** Prevent an internal schematic fitting piercing a resized, tapered tail. */
function insideHull(g: THREE.BufferGeometry, f: FuselageShape, clearance = .035) {
  const p = g.getAttribute("position");
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), s = fuselageSection(f, x);
    const y = THREE.MathUtils.clamp(p.getY(i), s.cy - s.hh + clearance, s.cy + s.hh - clearance);
    const hw = Math.max(.001, fuselageHalfWidthAt(f, x, y) - clearance);
    p.setXYZ(i, x, y, THREE.MathUtils.clamp(p.getZ(i), -hw, hw));
  }
  p.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

/** Open annular exhaust, with every station following the tail rise/taper. */
function exhaustDuct(f: FuselageShape, start: number, end: number, radius: number, yOffset: number, endOffset = 0, endRadius = radius) {
  const pos: number[] = [], idx: number[] = [], rings = 28, sides = 40;
  for (let wall = 0; wall < 2; wall++) for (let i = 0; i <= rings; i++) {
    const x = THREE.MathUtils.lerp(start, end, i / rings), s = fuselageSection(f, x);
    const r = Math.min(THREE.MathUtils.lerp(radius, endRadius, i / rings), s.hw * .72, (s.hh - Math.abs(endOffset)) * .64) - wall * .014;
    const cy = s.cy + yOffset * (1 - i / rings) + endOffset * i / rings;
    for (let j = 0; j <= sides; j++) {
      const a = j / sides * Math.PI * 2;
      pos.push(x, cy + r * Math.sin(a), r * Math.cos(a));
    }
  }
  const row = sides + 1, wallSize = (rings + 1) * row;
  for (let wall = 0; wall < 2; wall++) for (let i = 0; i < rings; i++) for (let j = 0; j < sides; j++) {
    const a = wall * wallSize + i * row + j, b = a + row;
    if (wall) idx.push(a, a + 1, b, b, a + 1, b + 1);
    else idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  // Only the annular lip is capped; the gas passage stays visibly open.
  for (let j = 0; j < sides; j++) {
    const a = rings * row + j, b = a + wallSize;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}

/** Family-specific reference installation, coordinates in aircraft axes (x aft). */
export function fleetApu(def: AircraftDefinition, f: FuselageShape = def.fuselage,
  variant = fleetApuVariantFor(def)): FleetApuPackage | null {
  if (!variant) return null;
  const shape = useShapes(def), L = f.lengthM, airbus = variant.id === "131-9a", classic = variant.id === "85-129", b757 = variant.id === "331-200er", max = def.id === "b737-8", ng = def.id === "b737-800";
  const tag = `apu-${def.id}`;
  // Offsets are tied to the unchanged rear section, not a percentage of total length.
  const bodyX = L - (airbus ? 3.2 : b757 ? 3.5 : 3.9);
  const sec = fuselageSection(f, bodyX), y = sec.cy - .03;
  const radius = b757 ? .39 : classic ? .29 : .34, length = b757 ? 1.34 : classic ? .96 : 1.10;
  const internal: THREE.BufferGeometry[] = [], external: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, suffix: string, role: string, tone: "detailSteel" | "detailDark" | "detailPanel" = "detailSteel") => {
    internal.push(piece(insideHull(g, f), `${tag}-${suffix}`, role, tone));
  };
  // Compressor/load-compressor casing, hot section, forward accessory gearbox and generator.
  add(cylinder(bodyX - length * .22, y, 0, length * .56, radius, radius * .90), "compressor-case", "compressor-case", "detailPanel");
  add(cylinder(bodyX + length * .24, y, 0, length * .38, radius * .90, radius * .66), "hot-section", "turbine-case");
  add(cylinder(bodyX + length * .46, y, 0, length * .13, radius * .66, radius * .61), "exhaust-transition", "exhaust-transition", "detailDark");
  const gearboxX = bodyX - length * .65;
  add(new THREE.BoxGeometry(.23, radius * 1.65, radius * 1.30).translate(gearboxX, y - .02, 0), "gearbox", "accessory-gearbox", "detailPanel");
  add(cylinder(gearboxX - .25, y - .07, .09, .38, radius * .47), "generator", "generator");
  add(cylinder(gearboxX - .20, y + .15, -.15, .26, .073), "fuel-accessory", "fuel-accessory", "detailDark");
  for (let i = 0; i < 4; i++) {
    const x = bodyX + length * (-.36 + i * .20);
    const r = radius * (i < 2 ? .99 : .81);
    add(cylinder(x, y, 0, .025, r + .013), `case-flange-${i}`, "case-flange");
  }
  add(new THREE.BoxGeometry(.34, .22, .22).translate(gearboxX + .08, y - radius * .7, -.22), "oil-accessory", "oil-accessory", "detailDark");
  // Schematic support rods terminate well inside the skin; no fabricated mass entries.
  const mountStations = airbus ? [[-.40, -1], [-.40, 1], [0, -1], [0, 1], [.38, -1], [.38, 1], [.48, -1]] : [[-.40, -1], [-.40, 1], [.38, -1], [.38, 1]];
  for (const [dx, side] of mountStations) {
    add(tubeGeometry([new THREE.Vector3(bodyX + dx, y + radius * .55, side * radius * .65),
      new THREE.Vector3(bodyX + dx - .12, y + radius + .18, side * (radius + .16))], .018), `mount-${side}-${dx}`, "mount");
  }
  const exitStart = bodyX + length * .5, exitEnd = L - .006;
  const tailSec = fuselageSection(f, L - .02), tailOffset = ng ? -tailSec.hh * .28 : 0;
  const outletR = Math.min(b757 ? .27 : classic ? .19 : .23, tailSec.hw * .72, (tailSec.hh - Math.abs(tailOffset)) * .64);
  const tailDuct = exhaustDuct(f, exitStart, exitEnd, b757 ? .27 : classic ? .19 : .23, -.025, tailOffset, outletR);
  add(tailDuct, "exhaust-duct", "exhaust-duct");
  // End ring is visible at the existing open fuselage end, never a long protruding pipe.
  const lip = exhaustDuct(f, L - .07, L + .009, outletR, tailOffset, tailOffset, outletR);
  external.push(piece(lip, `${tag}-exhaust-lip`, "exhaust-outlet"));

  const intakeX = L - (airbus ? 4.52 : b757 ? 5.4 : max ? 6.12 : 6.15);
  const angle = (airbus ? -67 : b757 ? 49 : max ? 14 : 8) * Math.PI / 180;
  const doorLength = airbus ? .68 : b757 ? .70 : max ? .64 : .56;
  const span = (airbus ? 32 : b757 ? 26 : max ? 23 : 25) * Math.PI / 180;
  const opening = { x0: intakeX - doorLength / 2, x1: intakeX + doorLength / 2, angle0: angle - span / 2, angle1: angle + span / 2 };
  const unit = (a: number) => {
    let d = ((a * 180 / Math.PI) % 360 + 360) % 360;
    if (!shape.section.fullTurn && d > 180) d = 360 - d;
    const xs = shape.section.deg, rs = shape.section.r;
    let i = 1; while (i < xs.length - 1 && xs[i] < d) i++;
    const r = THREE.MathUtils.lerp(rs[i - 1], rs[i], THREE.MathUtils.clamp((d - xs[i - 1]) / (xs[i] - xs[i - 1]), 0, 1));
    return [r * Math.sin(a) / shape.halfH, r * Math.cos(a) / shape.halfW];
  };
  const surface = (x: number, a: number, inset = 0) => {
    const s = fuselageSection(f, Math.min(L - .02, x)), [sy, cz] = unit(a);
    return new THREE.Vector3(x, s.cy + (s.hh + inset) * sy, (s.hw + inset) * cz);
  };
  // Close the tail around the exhaust. NG has a second, upper cooling aperture;
  // Classic and MAX must not inherit that unmistakable NG exterior feature.
  const tailShape = new THREE.Shape();
  for (let j = 0; j <= 72; j++) {
    const p = surface(L, j / 72 * Math.PI * 2);
    if (j === 0) tailShape.moveTo(p.z, p.y); else tailShape.lineTo(p.z, p.y);
  }
  const exhaustHole = new THREE.Path();
  exhaustHole.absarc(0, tailSec.cy + tailOffset, outletR - .014, 0, Math.PI * 2, true);
  tailShape.holes.push(exhaustHole);
  const coolingR = Math.min(tailSec.hw * .28, tailSec.hh * .23), coolingY = tailSec.cy + tailSec.hh * .53;
  if (ng) {
    const cooling = new THREE.Path(); cooling.absarc(0, coolingY, coolingR, 0, Math.PI * 2, true); tailShape.holes.push(cooling);
    const coolingDuct = cylinder(L - .10, coolingY, 0, .20, coolingR, coolingR, true);
    add(coolingDuct, "cooling-inlet-duct", "cooling-inlet-duct", "detailDark");
  }
  const tailFace = new THREE.ShapeGeometry(tailShape, 48), facePos = tailFace.getAttribute("position");
  for (let i = 0; i < facePos.count; i++) facePos.setXYZ(i, L + .006, facePos.getY(i), facePos.getX(i));
  const tailIndex = tailFace.index!;
  for (let i = 0; i < tailIndex.count; i += 3) {
    const b = tailIndex.getX(i + 1); tailIndex.setX(i + 1, tailIndex.getX(i + 2)); tailIndex.setX(i + 2, b);
  }
  tailFace.computeVertexNormals();
  external.push(piece(tailFace, `${tag}-tail-face`, "tail-face"));
  const patch = (o: ApuHullOpening, inset: number) => {
    const pos: number[] = [], idx: number[] = [], nx = 8, na = 8;
    for (let i = 0; i <= nx; i++) for (let j = 0; j <= na; j++) pos.push(...surface(THREE.MathUtils.lerp(o.x0, o.x1, i / nx), THREE.MathUtils.lerp(o.angle0, o.angle1, j / na), inset).toArray());
    for (let i = 0; i < nx; i++) for (let j = 0; j < na; j++) {
      const a = i * (na + 1) + j, b = a + na + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
  };
  const mouth = surface(intakeX + .16, angle, -.28), outward = surface(intakeX, angle, .1).sub(surface(intakeX, angle)).normalize();
  const intakeCurve = new THREE.CatmullRomCurve3([mouth, surface(intakeX + .40, angle, -.44), new THREE.Vector3(gearboxX + .1, y - .1, .15)]);
  const inletSegments = 24;
  const intakeDuct = new THREE.TubeGeometry(intakeCurve, 36, airbus ? .14 : .16, inletSegments, false);
  add(intakeDuct, "intake-duct", "intake-duct", "detailDark");
  // Open rectangular-to-round transition: the inner ring reuses the already
  // fitted duct vertices, so neither a cap nor a slit remains at the joint.
  const ductPoints = intakeDuct.getAttribute("position"), tangent = surface(intakeX, angle + .02).sub(surface(intakeX, angle - .02)).normalize();
  const ring = Array.from({ length: inletSegments }, (_, i) => new THREE.Vector3().fromBufferAttribute(ductPoints, i));
  const local = ring.map(p => p.clone().sub(mouth));
  let signedArea = 0, first = 0, cornerMatch = -Infinity;
  for (let i = 0; i < inletSegments; i++) {
    const a = local[i], b = local[(i + 1) % inletSegments];
    signedArea += a.x * b.dot(tangent) - b.x * a.dot(tangent);
    const score = a.x + a.dot(tangent);
    if (score > cornerMatch) { cornerMatch = score; first = i; }
  }
  const corners = [[opening.x1, opening.angle1], [opening.x0, opening.angle1], [opening.x0, opening.angle0], [opening.x1, opening.angle0]];
  const throatPos: number[] = [], throatIndex: number[] = [], row = inletSegments + 1;
  for (let i = 0; i <= inletSegments; i++) {
    const edge = Math.floor(i / (inletSegments / 4)) % 4, t = (i % (inletSegments / 4)) / (inletSegments / 4);
    const a = corners[edge], b = corners[(edge + 1) % 4];
    throatPos.push(...surface(THREE.MathUtils.lerp(a[0], b[0], t), THREE.MathUtils.lerp(a[1], b[1], t), -.003).toArray());
  }
  for (let i = 0; i <= inletSegments; i++) {
    const index = (first + (signedArea > 0 ? i : -i) + inletSegments * 2) % inletSegments;
    throatPos.push(...ring[index].toArray());
  }
  for (let i = 0; i < inletSegments; i++) throatIndex.push(i, row + i, i + 1, i + 1, row + i, row + i + 1);
  const throat = new THREE.BufferGeometry();
  throat.setAttribute("position", new THREE.Float32BufferAttribute(throatPos, 3)); throat.setIndex(throatIndex); throat.computeVertexNormals();
  throat.userData.transitionRingVertices = row;
  external.push(piece(throat, `${tag}-intake-throat`, "intake-throat", "detailDark"));
  const frameWidth = .025, frameAngle = .024;
  for (const [i, strip] of [
    { ...opening, x1: opening.x0 + frameWidth }, { ...opening, x0: opening.x1 - frameWidth },
    { ...opening, angle1: opening.angle0 + frameAngle }, { ...opening, angle0: opening.angle1 - frameAngle },
  ].entries()) external.push(piece(patch(strip, .012), `${tag}-intake-frame-${i}`, "intake-frame"));
  const door = piece(patch(opening, .009), `${tag}-intake-door`, "intake-door", "detailPanel");
  const pivot = surface(opening.x1, angle, .009);
  const hinge = surface(opening.x1, opening.angle1).sub(surface(opening.x1, opening.angle0)).normalize();
  // An outward-opening reference pose. Angle is an illustration assumption, not an AMM limit.
  door.userData.apuDoor = { pivot, axis: hinge, angle: .85 };
  external.push(door);
  [...internal, ...external].forEach(reflectToStarboard);
  const physicalOpening = { ...opening, angle0: Math.PI - opening.angle1, angle1: Math.PI - opening.angle0 };
  const intakePoint = surface(intakeX, angle); intakePoint.z *= -1; outward.z *= -1;
  const target = new THREE.Vector3((intakeX + bodyX) / 2, y, airbus ? -.12 : -.16);
  const direction = new THREE.Vector3(-.75, airbus ? -.78 : b757 ? .62 : .20, -1).normalize();
  internal.forEach(g => { g.userData.apuLayer = "internal"; });
  external.forEach(g => { g.userData.apuLayer = "external"; });
  return { internal, external, variant, openings: [physicalOpening], camera: { target, direction, distanceM: b757 ? 6 : 5.5 },
    intake: { point: intakePoint, outward }, bounds: { startX: intakeX - .6, endX: L + .01 } };
}

/** Cut at exact x/azimuth boundaries, interpolating hull position, normal and UV.
 * Splitting intersected triangles avoids coarse quarter-metre sawtooth edges. */
export function cutFleetApuOpenings(hull: THREE.BufferGeometry, f: FuselageShape, openings: ApuHullOpening[]): THREE.BufferGeometry {
  if (!openings.length) return hull;
  const uv = hull.getAttribute("uv");
  if (!uv) throw new Error("APU hull cut requires fuselage UV coordinates");
  const attributes = Object.entries(hull.attributes), offsets: Record<string, number> = {};
  let stride = 0;
  for (const [name, attr] of attributes) { offsets[name] = stride; stride += attr.itemSize; }
  const u = offsets.uv, v = u + 1, vertices: number[][] = [];
  for (let i = 0; i < uv.count; i++) {
    const vertex: number[] = [];
    for (const [, attr] of attributes) for (let k = 0; k < attr.itemSize; k++) vertex.push(attr.getComponent(i, k));
    vertices.push(vertex);
  }
  type Polygon = number[][];
  const split = (polygon: Polygon, component: number, threshold: number, sign: number): [Polygon, Polygon] => {
    const inside: Polygon = [], outside: Polygon = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length];
      const da = sign * (a[component] - threshold), db = sign * (b[component] - threshold);
      (da >= -1e-10 ? inside : outside).push(a);
      if ((da > 1e-10 && db < -1e-10) || (da < -1e-10 && db > 1e-10)) {
        const t = da / (da - db), point = a.map((x, k) => THREE.MathUtils.lerp(x, b[k], t));
        inside.push(point); outside.push(point);
      }
    }
    return [inside, outside];
  };
  const rectangles = openings.flatMap(o => {
    const v0 = ((o.angle0 / (2 * Math.PI)) % 1 + 1) % 1;
    const v1 = v0 + (o.angle1 - o.angle0) / (2 * Math.PI);
    const longitudinal = { u0: o.x0 / f.lengthM, u1: o.x1 / f.lengthM };
    return v1 > 1 ? [{ ...longitudinal, v0, v1: 1 }, { ...longitudinal, v0: 0, v1: v1 - 1 }] : [{ ...longitudinal, v0, v1 }];
  });
  // Reuse the original indexed vertices everywhere except the clipped boundary.
  const output = attributes.map(([name, attr]) => vertices.flatMap(p => p.slice(offsets[name], offsets[name] + attr.itemSize)));
  const vertexIndices = new Map(vertices.map((p, i) => [p, i])), outputIndices: number[] = [], index = hull.index;
  let nextVertex = vertices.length;
  const count = index?.count ?? uv.count;
  for (let i = 0; i < count; i += 3) {
    let polygons: Polygon[] = [[0, 1, 2].map(j => vertices[index ? index.getX(i + j) : i + j])];
    for (const r of rectangles) {
      const kept: Polygon[] = [];
      for (const poly of polygons) {
        if (Math.max(...poly.map(p => p[u])) <= r.u0 || Math.min(...poly.map(p => p[u])) >= r.u1 ||
          Math.max(...poly.map(p => p[v])) <= r.v0 || Math.min(...poly.map(p => p[v])) >= r.v1) { kept.push(poly); continue; }
        let remaining = poly;
        for (const [axis, value, sign] of [[u, r.u0, 1], [u, r.u1, -1], [v, r.v0, 1], [v, r.v1, -1]]) {
          if (remaining.length < 3) break;
          const [inside, outside] = split(remaining, axis, value, sign);
          if (outside.length >= 3) kept.push(outside);
          remaining = inside;
        }
      }
      polygons = kept;
    }
    for (const poly of polygons) for (let j = 1; j < poly.length - 1; j++) for (const p of [poly[0], poly[j], poly[j + 1]]) {
      let vertexIndex = vertexIndices.get(p);
      if (vertexIndex === undefined) {
        vertexIndex = nextVertex++; vertexIndices.set(p, vertexIndex);
        for (const [k, [name, attr]] of attributes.entries()) output[k].push(...p.slice(offsets[name], offsets[name] + attr.itemSize));
      }
      outputIndices.push(vertexIndex);
    }
  }
  const cut = new THREE.BufferGeometry();
  attributes.forEach(([name, attr], k) => cut.setAttribute(name, new THREE.Float32BufferAttribute(output[k], attr.itemSize, attr.normalized)));
  cut.setIndex(outputIndices);
  cut.name = hull.name;
  cut.userData = { ...hull.userData, apuOpenings: openings };
  cut.normalizeNormals();
  return cut;
}
