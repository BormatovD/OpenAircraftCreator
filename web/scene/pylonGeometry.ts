import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { NacelleSegment } from "./shapes.ts";

type MountStation = readonly [x: number, caseRadius: number, spread: number];
export interface PylonSpec {
  fairingProfile?: "ps90a";
  noseX: number;
  shoulderX: number;
  noseRise: number;
  shoulderRise: number;
  halfWidth: number;
  aftWingFraction: number;
  upperWingFraction?: number;
  frontMount: MountStation;
  middleMount?: MountStation;
  rearMount: MountStation;
  frontLinks?: number;
  rearLinks?: number;
  rearRocker?: boolean;
  rearStandby?: boolean;
  raisedRearBracket?: boolean;
  frontCaseContact?: number;
  rearCaseContact?: number;
  wingAttachment?: "airbus" | "airbusNeo" | "boeing737" | "boeing757";
  thrustLinks: "paired" | "single" | "none";
  thrustCase?: MountStation;
  thrustTo?: "front" | "middle" | "rear";
  latchStations: readonly number[];
  hingeStations: readonly number[];
  cowlTieBarX?: number;
  cowlHingeBeam?: boolean;
  cowlPanels?: "halves" | "quarters" | "undivided";
  coreHingeStations?: readonly number[];
  coreLatchStations?: readonly number[];
  forwardMountLabel: string;
  rearMountLabel: string;
  middleMountLabel?: string;
  cowlLabel: string;
}

const { lerp, clamp, smoothstep } = THREE.MathUtils;
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const suspensionRoles = new Set(["beam", "frontMount", "middleMount", "rearMount", "thrustLinks", "wingAttachment"]);
export function isSuspensionHardware(role: string | undefined) {
  return role !== undefined && suspensionRoles.has(role);
}
type SkinRing = { x: number; points: { angle: number; radius: number }[] };

// Read the installed fan-cowl skin itself. In particular, the Classic crown and
// belly have different radii; using the nominal fan diameter floats the latches.
function fanRings(g: THREE.BufferGeometry): SkinRing[] {
  const p = g.getAttribute("position");
  const rings = new Map<number, Map<number, number>>();
  for (let i = 0; i < p.count; i++) {
    const x = Math.round(p.getX(i) * 1e5) / 1e5;
    const y = p.getY(i), z = p.getZ(i);
    const angle = Math.round(Math.atan2(z, y) * 1e5) / 1e5;
    const ring = rings.get(x) ?? new Map<number, number>();
    ring.set(angle, Math.max(ring.get(angle) ?? 0, Math.hypot(y, z)));
    rings.set(x, ring);
  }
  return Array.from(rings, ([x, ring]) => ({ x, points: Array.from(ring, ([angle, radius]) => ({ angle, radius })).sort((a, b) => a.angle - b.angle) })).sort((a, b) => a.x - b.x);
}

function radiusAt(ring: SkinRing, angle: number) {
  const points = ring.points;
  const right = points.findIndex(p => p.angle >= angle);
  const a = points[(right <= 0 ? points.length : right) - 1];
  const b = points[Math.max(0, right)];
  let delta = b.angle - a.angle, along = angle - a.angle;
  if (delta <= 0) delta += 2 * Math.PI;
  if (along < 0) along += 2 * Math.PI;
  return lerp(a.radius, b.radius, clamp(along / delta, 0, 1));
}

function skinDatum(g: THREE.BufferGeometry) {
  const rings = fanRings(g);
  return (x: number, angle: number) => {
    const right = rings.findIndex(r => r.x >= x);
    const b = rings[right < 0 ? rings.length - 1 : right];
    const a = rings[right <= 0 ? (right < 0 ? rings.length - 1 : 0) : right - 1];
    return lerp(radiusAt(a, angle), radiusAt(b, angle), a === b ? 0 : (x - a.x) / (b.x - a.x));
  };
}

export function cowlDoors(source: THREE.BufferGeometry, quarters: boolean) {
  const p = source.getAttribute("position");
  const ix = source.getIndex();
  const n = quarters ? 4 : 2;
  const faces: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < (ix?.count ?? p.count); i += 3) {
    const ids = [0, 1, 2].map(j => ix ? ix.getX(i + j) : i + j);
    const z = ids.reduce((a, k) => a + p.getZ(k), 0);
    const y = ids.reduce((a, k) => a + p.getY(k), 0);
    faces[(z < 0 ? 1 : 0) + (quarters && y < 0 ? 2 : 0)].push(...ids);
  }
  return faces.filter(face => face.length).map((face, i) => {
    const door = source.clone();
    door.clearGroups();
    const ids = [...new Set(face)];
    const remap = new Map(ids.map((id, j) => [id, j]));
    for (const [name, attr] of Object.entries(source.attributes)) {
      const values = new Float32Array(ids.length * attr.itemSize);
      ids.forEach((id, j) => {
        for (let k = 0; k < attr.itemSize; k++) values[j * attr.itemSize + k] = attr.getComponent(id, k);
      });
      door.setAttribute(name, new THREE.BufferAttribute(values, attr.itemSize, attr.normalized));
    }
    door.setIndex(face.map(id => remap.get(id)!));
    door.boundingBox = null;
    door.boundingSphere = null;
    door.name = i === 0 ? source.name : source.name + "-opposite";
    door.userData.installationRole = "cowlDoor";
    return door;
  });
}

function rod(a: THREE.Vector3, b: THREE.Vector3, radius: number, endRadius = radius) {
  const delta = b.clone().sub(a);
  const g = new THREE.CylinderGeometry(endRadius, radius, Math.max(.001, delta.length()), 10);
  const center = a.clone().lerp(b, .5);
  return g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(v(0, 1, 0), delta.normalize())).translate(center.x, center.y, center.z);
}

function join(geoms: THREE.BufferGeometry[], role: string, tone: string, name = role) {
  const joined = mergeGeometries(geoms)!;
  geoms.forEach(g => g.dispose());
  joined.name = name;
  joined.userData = { installationRole: role, tone };
  return joined;
}

export function installationGeometry(spec: PylonSpec, segments: NacelleSegment[], kx: number, kr: number,
  wing: (chord: number) => THREE.Vector3, existingFairing?: THREE.BufferGeometry,
  wingUpper: (chord: number) => THREE.Vector3 = wing) {
  // Work in installed metres about the inlet centre, +X aft, +Y up.
  const skin = skinDatum(segments.find(s => s.id === "fanCowl")!.geometry);
  const le = wing(0), aft = wing(spec.aftWingFraction);
  const nose = spec.noseX * kx;
  const seated = wing(Math.min(.08, spec.aftWingFraction * .55));
  // Wing-area/span changes can bring the leading edge forward. Keep room
  // between the two control stations for a continuous sweep into the wing.
  const shoulder = Math.min(spec.shoulderX * kx, lerp(nose, seated.x, .68));
  const inlet = segments.find(s => s.id === "inlet");
  const fanStart = segments.find(s => s.id === "fanCowl")!.geometry;
  fanStart.computeBoundingBox();
  const inletSkin = inlet ? skinDatum(inlet.geometry) : skin;
  const crownY = (x: number) => x < fanStart.boundingBox!.min.x ? inletSkin(x, 0) : skin(x, 0);
  const startY = crownY(nose), shoulderY = crownY(shoulder);
  const topNose = startY + spec.noseRise * kr;
  const topShoulder = shoulderY + spec.shoulderRise * kr;
  function top(x: number) {
    if (x < shoulder) return lerp(topNose, topShoulder, smoothstep(x, nose, shoulder));
    if (x < seated.x) return lerp(topShoulder, seated.y + .07, smoothstep(x, shoulder, seated.x));
    return lerp(seated.y + .07, aft.y + .10, clamp((x - seated.x) / Math.max(.01, aft.x - seated.x), 0, 1));
  }
  // Draw the keel across the closed fan/reverser crown, lifting it towards the
  // wing at the trailing end. Only the upper fixed sector touches the fairing.
  const exhaust = segments.filter(s => s.id === "nozzle" || s.id === "reverser");
  const crowns = new Map<number, number>();
  for (const seg of exhaust) {
    const motion = seg.geometry.userData.reverserMotion;
    if (motion?.role && motion.role !== "frame" && motion.role !== "sleeve") continue;
    const p = seg.geometry.getAttribute("position");
    for (let i = 0; i < p.count; i++) {
      const x = Math.round(p.getX(i) * 1000) / 1000;
      crowns.set(x, Math.max(crowns.get(x) ?? 0, p.getY(i)));
    }
  }
  const crown = [...crowns].sort((a, b) => a[0] - b[0]);
  function bottom(x: number) {
    let y = crownY(x);
    if (crown.length && x >= crown[0][0]) {
      const j = crown.findIndex(p => p[0] >= x);
      const [xa, ya] = crown[j <= 0 ? (j < 0 ? crown.length - 1 : 0) : j - 1];
      const [xb, yb] = crown[j < 0 ? crown.length - 1 : j];
      y = lerp(ya, yb, xa === xb ? 0 : (x - xa) / (xb - xa));
    }
    return lerp(y - .025 * kr, aft.y + .026, smoothstep(x, Math.max(shoulder, le.x - .16 * kx), aft.x));
  }
  const halfWidth = spec.halfWidth * kr;
  function loft() {
    const points: number[] = [], indices: number[] = [];
    const count = 60, sides = 20;
    for (let i = 0; i <= count; i++) {
      const t = i / count, x = lerp(nose, aft.x, t);
      const rise = top(x), floor = Math.min(rise - .018 * kr, bottom(x));
      const width = halfWidth * (.035 + .965 * Math.sin(Math.PI / 2 * clamp((x - nose) / Math.max(.01, shoulder - nose), 0, 1))) * (1 - .87 * smoothstep(t, .61, 1));
      for (let j = 0; j < sides; j++) {
        const a = 2 * Math.PI * j / sides, cy = Math.cos(a), sz = Math.sin(a);
        points.push(x, lerp(floor, rise, .5 + .5 * Math.sign(cy) * Math.abs(cy) ** .7), width * Math.sign(sz) * Math.abs(sz) ** .76);
        if (i < count) {
          const a0 = i * sides + j, a1 = i * sides + (j + 1) % sides;
          indices.push(a0, a1, a1 + sides, a0, a1 + sides, a0 + sides);
        }
      }
    }
    for (let j = 1; j < sides - 1; j++) indices.push(0, j + 1, j, count * sides, count * sides + j, count * sides + j + 1);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
    g.setIndex(indices);
    g.computeVertexNormals();
    return g;
  }
  function ps90Loft() {
    // Photos establish the external silhouette, not wing-to-pylon fittings:
    // a short rounded nose, a nearly straight high roof and a short upper saddle.
    const points: number[] = [], indices: number[] = [];
    const count = 112, sides = 40;
    // The inlet has inner and outer branches at different x stations. A
    // radius interpolated through all profile rings can incorrectly follow
    // the duct branch. Sample the rendered outer skin from above instead.
    const crownMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    const crownMeshes = segments.filter(s => !s.geometry.userData.reverserMotion ||
      ["frame", "sleeve"].includes(s.geometry.userData.reverserMotion.role))
      .map(s => new THREE.Mesh(s.geometry, crownMaterial));
    const crownRay = new THREE.Raycaster(v(0, 20 * kr, .001 * kr), v(0, -1, 0));
    const crownCache = new Map<number, number>();
    const outerCrown = (x: number) => {
      let y = crownCache.get(x);
      if (y !== undefined) return y;
      crownRay.ray.origin.x = x;
      y = crownRay.intersectObjects(crownMeshes).find(hit => hit.point.y > 0)?.point.y ?? crownY(x);
      crownCache.set(x, y);
      return y;
    };
    const upperFraction = spec.upperWingFraction ?? spec.aftWingFraction;
    const upperSeat = wingUpper(0), upperAft = wingUpper(upperFraction);
    const fore = Math.min(nose + .78 * kx, lerp(nose, upperSeat.x, .16));
    const noseTop = outerCrown(nose) + .018 * kr;
    const seatY = upperSeat.y - .018 * kr;
    const foreTop = Math.max(noseTop + .025 * kr, lerp(noseTop, seatY, .63));
    const roofSlope = (seatY - foreTop) / (upperSeat.x - fore);
    const fractionAt = (x: number) => clamp((x - upperSeat.x) / (aft.x - upperSeat.x), 0, 1) * spec.aftWingFraction;
    const buried = (f: number) => lerp(wingUpper(f).y, wing(f).y, .55);
    const upper = (x: number) => {
      if (x < fore) {
        const t = clamp((x - nose) / (fore - nose), 0, 1);
        // Enter the straight line tangentially, without a vertical nose wall.
        const rise = foreTop - noseTop, endTangent = roofSlope * (fore - nose);
        return noseTop + t * ((2 - t) * rise - (1 - t) * endTangent);
      }
      const line = foreTop + roofSlope * (x - fore);
      if (x <= upperSeat.x) return line;
      // Carry the same tangent through the wing nose. Following the rapid
      // rise of the airfoil here exposes a pointed ridge on the swept wing.
      const f = fractionAt(x);
      return Math.min(line, wingUpper(f).y - .018 * kr,
        lerp(line, buried(f), smoothstep(f, 0, upperFraction)));
    };
    const lower = (x: number) => {
      const liftStart = Math.max(spec.rearMount[0] * kx, shoulder);
      const endFloor = buried(spec.aftWingFraction) - .016 * kr;
      return lerp(outerCrown(x) - .018 * kr, endFloor, smoothstep(x, liftStart, aft.x));
    };
    for (let i = 0; i <= count; i++) {
      // Cosine station spacing resolves both rounded leading and trailing ends.
      const t = .5 - .5 * Math.cos(Math.PI * i / count), x = lerp(nose, aft.x, t);
      const roof = upper(x), floor = Math.min(roof - .012 * kr, lower(x));
      const noseBlend = Math.sqrt(Math.max(0, 1 - (1 - clamp((x - nose) / (.70 * kx), 0, 1)) ** 2));
      const tailBlend = 1 - .92 * smoothstep(x, seated.x, aft.x);
      const width = halfWidth * (.045 + .955 * noseBlend) * tailBlend;
      for (let j = 0; j < sides; j++) {
        const a = 2 * Math.PI * j / sides, cy = Math.cos(a), sz = Math.sin(a);
        const z = width * Math.sign(sz) * Math.abs(sz) ** .72;
        const across = Math.sqrt(Math.max(0, outerCrown(x) ** 2 - z ** 2)) - outerCrown(x);
        const y = lerp(floor + across * (1 - smoothstep(x, seated.x, aft.x)), roof,
          .5 + .5 * Math.sign(cy) * Math.abs(cy) ** .72);
        points.push(x, y, z);
        if (i < count) {
          const a0 = i * sides + j, a1 = i * sides + (j + 1) % sides;
          indices.push(a0, a1, a1 + sides, a0, a1 + sides, a0 + sides);
        }
      }
    }
    // Separate centre vertices close the two small rounded end sections.
    for (const end of [0, count]) {
      const base = end * sides, center = points.length / 3;
      let centerY = 0;
      for (let j = 0; j < sides; j++) centerY += points[3 * (base + j) + 1] / sides;
      points.push(points[3 * base], centerY, 0);
      for (let j = 0; j < sides; j++) {
        const a = base + j, b = base + (j + 1) % sides;
        if (end === 0) indices.push(center, b, a); else indices.push(center, a, b);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.userData.fairingProfile = "ps90a";
    geometry.userData.pylonLoft = { nose, fore, shoulder, seated: seated.toArray(), upperSeat: upperSeat.toArray(), upperAft: upperAft.toArray(), aft: aft.toArray(), count, sides };
    crownMaterial.dispose();
    return geometry;
  }
  const fairing = existingFairing ?? (spec.fairingProfile === "ps90a" ? ps90Loft() : loft());
  // Recompute after changes in plan and translation into inlet coordinates.
  // Raycaster uses the bounding sphere as well as the vertex buffer.
  fairing.computeBoundingSphere();
  fairing.name = "pylon-fairing";
  fairing.userData.installationRole = "fairing";

  // A narrow structural beam remains when the aerodynamic fairing is removed.
  const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const shell = new THREE.Mesh(fairing, mat);
  const ray = new THREE.Raycaster(v(0, 10, .001 * kr), v(0, -1, 0));
  const frameCache = new Map<number, { y: number; depth: number }>();
  const frameSection = (x: number) => {
    const cached = frameCache.get(x);
    if (cached) return cached;
    ray.ray.origin.x = x;
    const hits = ray.intersectObject(shell);
    const ceiling = hits[0]?.point.y ?? top(x), keel = hits.at(-1)?.point.y ?? ceiling - .12 * kr;
    const section = { y: hits.length ? ceiling - Math.min(.09 * kr, (ceiling - keel) * .45) : top(x) - .055 * kr,
      depth: ceiling - keel };
    frameCache.set(x, section);
    return section;
  };
  const frameY = (x: number) => frameSection(x).y;
  const beamStart = spec.frontMount[0] * kx, beamEnd = Math.max(aft.x - .09, spec.rearMount[0] * kx);
  const beam: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 8; i++) {
    const x0 = lerp(beamStart, beamEnd, i / 8), x1 = lerp(beamStart, beamEnd, (i + 1) / 8);
    const a = v(x0, frameY(x0), 0), b = v(x1, frameY(x1), 0);
    // At a raised or enlarged PS-90A the available web can become shallow.
    // Preserve a continuous beam inside that actual body instead of leaving
    // its fixed-height box protruding through the external fairing.
    const depth = spec.fairingProfile === "ps90a" ? Math.min(.092 * kr,
      .55 * Math.min(frameSection(x0).depth, frameSection(x1).depth, frameSection((x0 + x1) / 2).depth)) : .092 * kr;
    const beamSection = new THREE.BoxGeometry(a.distanceTo(b) + .004 * kr, depth, Math.min(.18 * kr, halfWidth * .92));
    const center = a.clone().lerp(b, .5);
    beam.push(beamSection.rotateZ(Math.atan2(b.y - a.y, b.x - a.x)).translate(center.x, center.y, 0));
  }
  const hardware = [join(beam, "beam", "detailDark")];
  if (spec.wingAttachment) {
    // Schematic fittings at the wing underside. The longer diagonal stays
    // under the closed wing skin and terminates inside the local wing box.
    const fitting: THREE.BufferGeometry[] = [];
    const wingEnd = (f: number, z: number) => {
      const p = wing(f);
      return v(p.x, p.y + .055 * kr, z);
    };
    const airbus = spec.wingAttachment === "airbus" || spec.wingAttachment === "airbusNeo";
    const leStation = wing(.025).x;
    const y = frameY(leStation);
    if (airbus) {
      // Spigot at the forward wing interface, with lateral attachments.
      const p = wingEnd(.07, 0);
      fitting.push(rod(v(p.x - .065 * kx, frameY(p.x), 0), p, .064 * kr));
    } else {
      const x = leStation - .23 * kx;
      fitting.push(rod(v(x, frameY(x) - .06 * kr, 0), wingEnd(.065, 0), .047 * kr));
    }
    for (const sign of [-1, 1]) {
      const end = wingEnd(airbus ? .07 : .13, sign * halfWidth * .85);
      if (spec.wingAttachment === "airbus") {
        // Twin links at each inboard/outboard fork on the ceo front spar.
        for (const dz of [-.025 * kr, .025 * kr]) {
          const base = v(leStation, y - .055 * kr, sign * halfWidth * .64 + dz);
          fitting.push(rod(base, end.clone().add(v(0, 0, dz)), .021 * kr));
        }
      } else {
        fitting.push(rod(v(leStation, y - .055 * kr, sign * halfWidth * .32), end, .039 * kr));
      }
      if (spec.wingAttachment === "boeing757") {
        fitting.push(rod(v(leStation + .045 * kx, y, sign * halfWidth * .52), wingEnd(.12, sign * (halfWidth + .12 * kr)), .025 * kr));
      }
    }
    if (airbus) {
      const aftX = aft.x - .26 * kx;
      for (const z of spec.wingAttachment === "airbus" ? [-halfWidth * .25, halfWidth * .25] : [0]) {
        fitting.push(rod(v(aftX, frameY(aftX) - .035 * kr, z), wingEnd(spec.aftWingFraction, z), .040 * kr));
      }
    } else {
      const jointX = wing(.06).x;
      fitting.push(rod(v(jointX, frameY(jointX) - .10 * kr, 0), wingEnd(spec.aftWingFraction, 0), .051 * kr));
    }
    hardware.push(join(fitting, "wingAttachment", "detailSteel"));
  }
  function seat(station: MountStation) {
    const [x, r, z] = station;
    return v(x * kx, Math.sqrt(Math.max(0, r * r - z * z)) * kr, z * kr);
  }
  function mount(station: MountStation, count: number, role: string, contact?: number) {
    const foot = seat(station), x = foot.x;
    const staged = role === "rearMount" && spec.raisedRearBracket;
    const headY = staged ? lerp(station[1] * kr, frameY(x), .49) : frameY(x);
    const w = Math.max(.09 * kr, Math.min(halfWidth * .80, foot.z * .68));
    const pieces: THREE.BufferGeometry[] = [rod(v(x, headY, -w), v(x, headY, w), .057 * kr)];
    if (role === "middleMount" && spec.raisedRearBracket) {
      const radii = [station[1] * kr - .012 * kr, station[1] * kr + .013 * kr];
      const section = [new THREE.Vector2(radii[0], x - .027 * kx), new THREE.Vector2(radii[1], x - .027 * kx),
      new THREE.Vector2(radii[1], x + .027 * kx), new THREE.Vector2(radii[0], x + .027 * kx)];
      pieces.push(new THREE.LatheGeometry([...section, section[0]], 56).rotateZ(-Math.PI / 2));
    }
    if (contact && contact < station[1]) {
      // Represent the local case flange beneath the mount, bridging only the
      // difference between the simplified case and the reference fitting.
      const lateralPad = role === "frontMount" && spec.thrustTo === "front" && spec.thrustCase
        ? Math.max(station[2], spec.thrustCase[2]) : station[2];
      const angle = Math.asin(clamp(lateralPad / station[1], 0, .97)) + .08;
      const r0 = contact * kr, r1 = station[1] * kr;
      const section = [new THREE.Vector2(r0, x - .036 * kx), new THREE.Vector2(r1, x - .035 * kx),
      new THREE.Vector2(r1, x + .035 * kx), new THREE.Vector2(r0, x + .036 * kx), new THREE.Vector2(r0, x - .036 * kx)];
      const flange = new THREE.LatheGeometry(section, 14, -Math.PI / 2 - angle, 2 * angle).rotateZ(-Math.PI / 2);
      pieces.push(flange);
      // LatheGeometry leaves both sector ends open. Close with the actual
      // end vertices so the support land is also visible in strict side view.
      const vertices = flange.getAttribute("position");
      for (const end of [0, 14]) {
        const first = end * section.length;
        const cap = new THREE.BufferGeometry();
        const corners = Array.from({ length: 4 }, (_, i) => [vertices.getX(first + i), vertices.getY(first + i), vertices.getZ(first + i)]);
        cap.setAttribute("position", new THREE.Float32BufferAttribute(corners.flat(), 3));
        cap.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
        cap.setIndex(end === 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]);
        cap.computeVertexNormals();
        pieces.push(cap);
      }
    }
    for (let i = 0; i < count; i++) {
      const s = count === 1 ? 0 : 2 * i / (count - 1) - 1;
      const z = s * foot.z;
      const rocker = role === "rearMount" && spec.rearRocker;
      const headZ = staged || rocker ? -s * w : s * w;
      const pad = v(x, Math.sqrt(Math.max(0, (station[1] * kr) ** 2 - z * z)), z), head = v(x, headY, headZ);
      pieces.push(rod(pad, head, .037 * kr, .048 * kr), rod(pad.clone().add(v(-.044 * kr, 0, 0)), pad.clone().add(v(.044 * kr, 0, 0)), .056 * kr));
    }
    if (role === "rearMount" && spec.rearRocker) {
      pieces.push(rod(v(x, headY, -w), v(x, headY, w), .074 * kr),
        rod(v(x - .070 * kx, headY, 0), v(x + .070 * kx, headY, 0), .051 * kr));
    }
    if (role === "rearMount" && spec.thrustLinks === "paired" && spec.thrustTo === undefined) {
      const evenerY = lerp(station[1] * kr, frameY(x), .40);
      pieces.push(rod(v(x, evenerY, -w), v(x, evenerY, w), .047 * kr));
    }
    if (role === "rearMount" && spec.rearStandby) {
      // Standby centre pin in its clevis, distinct from the two working links.
      pieces.push(rod(v(x - .048 * kx, headY - .07 * kr, 0), v(x + .048 * kx, headY - .07 * kr, 0), .043 * kr));
    }
    hardware.push(join(pieces, role, "detailSteel"));
  }
  mount(spec.frontMount, spec.frontLinks ?? (spec.frontMount[2] ? 2 : 1), "frontMount", spec.frontCaseContact);
  if (spec.middleMount) mount(spec.middleMount, spec.middleMount[2] === 0 ? 1 : 2, "middleMount");
  mount(spec.rearMount, spec.rearLinks ?? (spec.rearMount[2] ? 2 : 1), "rearMount", spec.rearCaseContact);
  if (spec.thrustLinks !== "none" && spec.thrustCase) {
    const foot = seat(spec.thrustCase);
    const target = spec.thrustTo === "front" ? spec.frontMount : spec.thrustTo === "middle" && spec.middleMount ? spec.middleMount : spec.rearMount;
    const destX = target[0] * kx, rods: THREE.BufferGeometry[] = [];
    for (const sign of spec.thrustLinks === "paired" ? [-1, 1] : [0]) {
      const staged = spec.raisedRearBracket && spec.thrustTo === "rear";
      const lowY = staged ? lerp(target[1] * kr, frameY(destX), .49) : foot.y;
      const lowZ = staged ? Math.min(halfWidth * .8, foot.z * .68) : foot.z;
      const beamX = staged ? destX - .18 * kx : destX;
      const lower = v(foot.x, lowY, sign * lowZ);
      // Long thrust links meet the lower evener on the aft hanger. Aiming at
      // the crown of the fairing would route them through the exterior skin.
      const upperY = spec.thrustTo === undefined && !staged
        ? lerp(target[1] * kr, frameY(beamX), .40) : frameY(beamX);
      const upper = v(beamX, upperY, sign * halfWidth * .60);
      rods.push(rod(lower, upper, .032 * kr), rod(lower.clone().lerp(upper, .28), lower.clone().lerp(upper, .70), .045 * kr));
    }
    hardware.push(join(rods, "thrustLinks", "detailSteel"));
  }
  const fan = segments.find(s => s.id === "fanCowl")!.geometry;
  hardware.push(...cowlFittings(fan, kx, kr, halfWidth, spec.hingeStations, spec.latchStations, spec.cowlPanels, spec.cowlTieBarX, spec.cowlHingeBeam));
  const core = segments.find(s => s.id === "coreCowl");
  if (core && spec.coreHingeStations) {
    const fittings = cowlFittings(core.geometry, kx, kr, halfWidth, spec.coreHingeStations, spec.coreLatchStations ?? [], "halves");
    for (const g of fittings) g.userData.panelSection = "core";
    hardware.push(...fittings);
  }
  mat.dispose();
  return { fairing, hardware };
}

function cowlFittings(fan: THREE.BufferGeometry, kx: number, kr: number, halfWidth: number, hingeStations: readonly number[],
  latchStations: readonly number[], layout: PylonSpec["cowlPanels"], tieBar?: number, continuousHinge?: boolean) {
  const parts: THREE.BufferGeometry[] = [];
  const skin = skinDatum(fan);

  fan.computeBoundingBox();
  const minX = fan.boundingBox!.min.x, maxX = fan.boundingBox!.max.x;
  function point(x: number, angle: number, offset = 0) {
    const r = skin(x, angle) + offset * kr;
    return v(x, Math.cos(angle) * r, Math.sin(angle) * r);
  }
  const seams: THREE.BufferGeometry[] = [];
  for (const x of [minX + .006 * kx, maxX - .006 * kx]) {
    // Use a continuous, low relief ring on the actual section, including the Classic belly.
    const pts = Array.from({ length: 65 }, (_, i) => point(x, -Math.PI + i * 2 * Math.PI / 64, .003));
    const curve = new THREE.CurvePath<THREE.Vector3>();
    for (let i = 1; i < pts.length; i++) curve.add(new THREE.LineCurve3(pts[i - 1], pts[i]));
    seams.push(new THREE.TubeGeometry(curve, 64, .006 * kr, 5, true));
  }
  for (const a of layout === "undivided" ? [] : layout === "quarters" ? [0, Math.PI, Math.PI / 2, -Math.PI / 2] : [0, Math.PI]) {
    const pts = Array.from({ length: 9 }, (_, i) => point(lerp(minX, maxX, i / 8), a, .004));
    seams.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, .006 * kr, 5, false));
  }
  parts.push(join(seams, "doorSeam", "detailDark"));
  const hinges: THREE.BufferGeometry[] = [];
  for (const x of hingeStations) for (const sign of [-1, 1]) {
    const ax = x * kx, ang = sign * Math.asin(clamp((halfWidth + .018 * kr) / skin(ax, 0), 0, .85));
    hinges.push(rod(point(ax - .05 * kx, ang, .013), point(ax + .05 * kx, ang, .013), .020 * kr));
  }
  if (continuousHinge) {
    const first = hingeStations[0] * kx, last = hingeStations[hingeStations.length - 1] * kx;
    for (const sign of [-1, 1]) {
      const a = sign * Math.asin(clamp(halfWidth / skin(first, 0), 0, .85));
      const path = Array.from({ length: 9 }, (_, i) => point(lerp(first, last, i / 8), a, -.009));
      hinges.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(path), 12, .023 * kr, 6, false));
    }
  }
  if (tieBar !== undefined) {
    const ax = tieBar * kx;
    hinges.push(rod(point(ax, -.20, -.018), point(ax, .20, -.018), .022 * kr));
  }
  if (hinges.length) parts.push(join(hinges, "doorHinge", "detailSteel"));
  const latches: THREE.BufferGeometry[] = [];
  for (const ax of latchStations) {
    const x = ax * kx;
    const center = point(x, Math.PI, .012);
    latches.push(new THREE.BoxGeometry(.080 * kx, .022 * kr, .125 * kr).translate(center.x, center.y, 0));
  }
  if (latches.length) parts.push(join(latches, "doorLatch", "detailSteel"));
  return parts;
}
