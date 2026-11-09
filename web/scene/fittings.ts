// Мелкие выступающие детали по AC 2-10-0 (огни) и 2-11-0 (антенны и датчики). Положения по длине —
// по виду сбоку AC, с точностью ~0,3 м (лист схематичный); при удлинении фюзеляжа сдвигаются вместе со вставками.

import * as THREE from "three";
import { type FuselageShape, fuselageHalfWidthAt, fuselageSection, modelX } from "./shapes.ts";

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

export function fuselageFittings(f: FuselageShape): Fitting[] {
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
  out.push({ geometry: place(beacon(), bottom(17.4), true), tone: "beacon" });
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
