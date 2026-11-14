// Мелкие выступающие детали по AC 2-10-0 (огни) и 2-11-0 (антенны и датчики). Положения по длине —
// по виду сбоку AC, с точностью ~0,3 м (лист схематичный); при удлинении фюзеляжа сдвигаются вместе со вставками.

import * as THREE from "three";
import { type FuselageShape, fuselageHalfWidthAt, fuselagePlugs, fuselageSection, modelX } from "./shapes.ts";

/** Лопаточная антенна (VHF, TCAS, ATC): стреловидная пластина высотой h. */
function blade(h: number, chord: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(chord, 0);
  s.lineTo(chord * 0.95, h);
  s.lineTo(chord * 0.6, h);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.035, bevelEnabled: false });
  g.translate(0, 0, -0.0175);
  return g;
}

/** Плоская антенна-«таблетка» (GPS, TCAS сверху). */
function patch(r: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r * 1.1, 0.04, 20);
  g.translate(0, 0.02, 0);
  return g;
}

export interface Fitting {
  geometry: THREE.BufferGeometry;
  /** Тон материала: антенна, огонь (с цветом) или датчик. */
  tone: "antenna" | "nav-red" | "nav-green" | "strobe" | "beacon" | "landing" | "exhaust";
}

/** The assembled fixed exterior, so a belly fitting cannot be buried in a fairing. */
interface FittingInstallation {
  aircraftId: string;
  lowerBeaconSkins: THREE.BufferGeometry[];
}

interface LowerBeaconLocation {
  nominalLengthM: number;
  stationM: number;
  lateralM: number;
  /** Published schematic/photo estimate, not an installation drawing tolerance. */
  uncertaintyM: number;
  source: string;
}

/** Nominal nose stations are independent for each airframe; engine variants share their shell. */
export function lowerBeaconLocation(aircraftId: string): LowerBeaconLocation | undefined {
  if (/^a320/.test(aircraftId)) return { nominalLengthM: 37.57, stationM: 14.6, lateralM: 0, uncertaintyM: .3,
    source: "https://www.aircraft.airbus.com/sites/g/files/jlcbta126/files/2025-01/AC_A320_0624.pdf#page=109" };
  // Airbus AC Jul 2026 2-10-0: A319 Fig007, A321 Fig015, item10 (red).
  // Measured along the actual nose/tail outline, excluding all light beams:
  // A319 (16012.05-9001.05)/(28473.05-9001.05)=.3601; A321 .4035.
  // Both plan views put item10 on the centreline and cover ceo + neo.
  if (/^a319/.test(aircraftId)) return { nominalLengthM: 33.84, stationM: 12.18, lateralM: 0, uncertaintyM: .35,
    source: "https://mediaassets.airbus.com/pm_38_916_916263-0hxcf0237y.pdf#page=106" };
  if (/^a321/.test(aircraftId)) return { nominalLengthM: 44.51, stationM: 17.96, lateralM: 0, uncertaintyM: .4,
    source: "https://aircraft.airbus.com/sites/g/files/jlcbta126/files/2025-07/AC_A321_20250715.pdf" };
  // Boeing FCOM D6-27370-400E-TBCE 1.40.3 (Dec2000), lower red strobe:
  // nose307, lamp505, tail754 => .443. The shell omits the aft tail overhang.
  if (aircraftId === "b737-300") return { nominalLengthM: 32.18, stationM: 14.25, lateralM: 0, uncertaintyM: .5,
    source: "https://www.flickr.com/photos/wbaiv/5652956722" };
  // Curimedia EI-EKB underside photo: red lens on centreline, ahead of paired
  // pack outlets/wheel apertures. Independent of MAX's later fairing layout.
  if (aircraftId === "b737-800") return { nominalLengthM: 39.12, stationM: 17.45, lateralM: 0, uncertaintyM: .6,
    source: "https://commons.wikimedia.org/wiki/File:From_the_belly_of_the_Boeing_737-8AS_Ryanair_EI-EKB_(7033118775).jpg" };
  // N8831L direct underside (4300streetcar, Jan2025): physical lens .477 from
  // nose to tail; centred between the paired pack openings and wheel apertures.
  if (aircraftId === "b737-8") return { nominalLengthM: 39.12, stationM: 18.66, lateralM: 0, uncertaintyM: .4,
    source: "https://commons.wikimedia.org/wiki/File:Southwest_Boeing_737-8_MAX_N8831L_planform.jpg" };
  // Boeing 757 FCOM D632N001-55NRW 1.40.3 (May2014): nose234, lower
  // red-light point487, tail752 => .4884 (~22.94m); the point lies on the centreline.
  // Within the ±.5m schematic uncertainty, seat at22.70m so the .145m foot
  // remains wholly on the fixed skin ahead of the modeled door jamb at22.8805m.
  if (/^b757-200-/.test(aircraftId)) return { nominalLengthM: 46.97, stationM: 22.70, lateralM: 0, uncertaintyM: .5,
    source: "https://www.electronicsandbooks.com/edt/manual/Hardware/B/Boeing/757/757_GUI_FIM_D633N632_TD/PDF/33___060.PDF" };
  // Tu-214 passenger RA-64518 port profile: lamp at x/L~.59, aft of the
  // left gear bay on its fixed fairing. Lateral offset is a photo estimate
  // (~1.25m left), not a measured buttock-line coordinate. Red is corroborated
  // separately by Qiuming Li's RA-64532 photograph (Tu-214PU), not by the
  // unlit appearance of RA-64518. Lamp type/part number is unconfirmed.
  // Red reference: https://www.planespotters.net/photo/1682422/ra-64532-rossiya-special-flight-detachment-tupolev-tu-214pu
  // Do not transfer the white MSL-4 specified for Tu-204-300 to this airframe.
  if (/^tu214-ps90a/.test(aircraftId)) return { nominalLengthM: 45.22, stationM: 26.6, lateralM: -1.25, uncertaintyM: .9,
    source: "https://commons.wikimedia.org/wiki/File:RA-64518_(8005881407).jpg" };
  return undefined;
}

function lowerBeacon(f: FuselageShape, installation: FittingInstallation): Fitting[] {
  const location = lowerBeaconLocation(installation.aircraftId);
  if (!location) return [];
  // Preserve each nominal station when a supported live lever adds forward/aft plugs.
  const x = location.stationM + fuselagePlugs(f.lengthM).forwardM - fuselagePlugs(location.nominalLengthM).forwardM;
  const lateralM = location.lateralM * f.widthM / 3.8;
  const skins = installation.lowerBeaconSkins;
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const exterior = skins.map(g => new THREE.Mesh(g, material));
  const ray = new THREE.Raycaster();
  const skinAt = (xx: number, z: number) => {
    ray.set(new THREE.Vector3(xx, -f.heightM * 2, z), new THREE.Vector3(0, 1, 0));
    const hit = ray.intersectObjects(exterior, false)[0];
    if (!hit) throw new Error(`${installation.aircraftId} lower beacon has no fixed exterior mounting surface`);
    return hit;
  };
  const hit = skinAt(x, lateralM);
  const normal = hit.face!.normal.clone();
  if (normal.y > 0) normal.negate();
  // The centreline crosses a tessellation seam: average the mirrored face normals.
  if (lateralM === 0) normal.z = 0;
  normal.normalize();
  const mount = new THREE.CylinderGeometry(1, 1, 1, 32, 1);
  const p = mount.getAttribute("position");
  for (let i = 0; i < p.count; i++) {
    const xx = x + p.getX(i) * .145, z = lateralM + p.getZ(i) * .105;
    // Upper face overlaps the real tessellated skin by 3 mm; the exposed rim is 24 mm deep.
    p.setXYZ(i, xx, skinAt(xx, z).point.y + (p.getY(i) > 0 ? .003 : -.024), z);
  }
  mount.computeVertexNormals();
  mount.name = "lower-beacon-mount";
  mount.userData.lowerBeacon = { ...location, role: "mount", x, lateralM };
  const lens = new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  lens.scale(.115, .08, .09);
  lens.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal));
  lens.translate(x + normal.x * .024, hit.point.y + normal.y * .024, lateralM + normal.z * .024);
  lens.name = "lower-beacon-lens";
  lens.userData.lowerBeacon = { ...location, role: "lens", x, lateralM, surface: hit.point.toArray(), normal: normal.toArray() };
  material.dispose();
  return [{ geometry: mount, tone: "antenna" }, { geometry: lens, tone: "beacon" }];
}

export function fuselageFittings(f: FuselageShape, installation?: FittingInstallation): Fitting[] {
  const L = f.lengthM;
  const out: Fitting[] = [];
  const top = (xa: number) => {
    const x = modelX(L, xa);
    const s = fuselageSection(f, x);
    return new THREE.Vector3(x, s.cy + s.hh - 0.01, 0);
  };
  const bottom = (xa: number) => {
    const x = modelX(L, xa);
    const s = fuselageSection(f, x);
    return new THREE.Vector3(x, s.cy - s.hh + 0.01, 0);
  };
  const place = (g: THREE.BufferGeometry, p: THREE.Vector3, down = false) => {
    if (down) g.rotateX(Math.PI);
    g.translate(p.x, p.y, p.z);
    return g;
  };
  // Сверху: VHF1, TCAS, GPS1/2, VHF3 (A320 — антенны по осевой линии).
  out.push({ geometry: place(blade(0.32, 0.45), top(9.6)), tone: "antenna" });
  out.push({ geometry: place(patch(0.16), top(11.4)), tone: "antenna" });
  out.push({ geometry: place(patch(0.09), top(7.6)), tone: "antenna" });
  out.push({ geometry: place(patch(0.09), top(8.1)), tone: "antenna" });
  out.push({ geometry: place(blade(0.32, 0.45), top(24.6)), tone: "antenna" });
  out.push({ geometry: place(blade(0.2, 0.3), top(27.2)), tone: "antenna" });
  // Снизу: ATC, DME, маркер, TCAS, VHF2, радиовысотомеры.
  out.push({ geometry: place(blade(0.14, 0.2), bottom(6.4), true), tone: "antenna" });
  out.push({ geometry: place(blade(0.14, 0.2), bottom(7.0), true), tone: "antenna" });
  out.push({ geometry: place(patch(0.15), bottom(11.8), true), tone: "antenna" });
  out.push({ geometry: place(blade(0.3, 0.45), bottom(23.6), true), tone: "antenna" });
  out.push({ geometry: place(patch(0.12), bottom(25.4), true), tone: "antenna" });
  out.push({ geometry: place(patch(0.12), bottom(26.1), true), tone: "antenna" });
  // Приёмники давления и датчики угла атаки по бортам носа.
  for (const side of [1, -1] as const)
    for (const [xa, y, len] of [
      [3.05, 0.0, 0.22],
      [3.05, -0.45, 0.22],
      [3.9, 0.35, 0.12],
    ]) {
      const x = modelX(L, xa);
      const z = side * fuselageHalfWidthAt(f, x, y);
      const g = new THREE.CylinderGeometry(0.012, 0.02, len, 8);
      g.rotateZ(Math.PI / 2 + 0.25);
      g.translate(x + len / 2, y, z + side * 0.04);
      out.push({ geometry: g, tone: "antenna" });
    }
  // Проблесковые маяки (красные) сверху и снизу над центропланом; белый огонь на конце хвоста.
  const beacon = () => new THREE.SphereGeometry(0.09, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  out.push({ geometry: place(beacon(), top(16.6)), tone: "beacon" });
  if (installation) out.push(...lowerBeacon(f, installation));
  else out.push({ geometry: place(beacon(), bottom(17.4), true), tone: "beacon" });
  const tail = new THREE.SphereGeometry(0.07, 12, 8);
  const ts = fuselageSection(f, L - 0.05);
  tail.translate(L - 0.02, ts.cy + ts.hh * 0.6, 0);
  out.push({ geometry: tail, tone: "strobe" });
  // Срез хвостового конуса — сопло выхлопа ВСУ (тёмный диск вместо открытого торца).
  const cap = new THREE.CircleGeometry(1, 28);
  cap.rotateY(Math.PI / 2);
  cap.scale(1, ts.hh, ts.hw);
  cap.translate(L - 0.02, ts.cy, 0);
  out.push({ geometry: cap, tone: "exhaust" });
  return out;
}

/** Огни на законцовках: аэронавигационные (правый — зелёный, левый — красный) и белые проблесковые. */
export function wingtipLights(tipLe: THREE.Vector3, tipChord: number): { side: 1 | -1; fit: Fitting }[] {
  const out: { side: 1 | -1; fit: Fitting }[] = [];
  for (const side of [1, -1] as const) {
    const nav = new THREE.SphereGeometry(0.08, 12, 8);
    nav.translate(tipLe.x + 0.15, tipLe.y, side * (tipLe.z + 0.05));
    out.push({ side, fit: { geometry: nav, tone: side === 1 ? "nav-green" : "nav-red" } });
    const strobe = new THREE.SphereGeometry(0.06, 12, 8);
    strobe.translate(tipLe.x + tipChord * 0.85, tipLe.y + 0.02, side * (tipLe.z + 0.03));
    out.push({ side, fit: { geometry: strobe, tone: "strobe" } });
  }
  return out;
}
