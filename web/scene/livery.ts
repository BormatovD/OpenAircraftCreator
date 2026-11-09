// Окраска в стиле FlightCost (собственный бренд проекта): фюзеляж с полосой, киль с логотипом —
// траектория от точки по дуге внутри пунктирной окружности — и надписью вдоль руля направления.
// Логотип рисуется в метрах вида сбоку, поэтому ложится на киль любой формы через его развёртку.

import * as THREE from "three";
import AC from "../../data/ac/a320-shapes.json" with { type: "json" };

export interface Livery {
  id: string;
  label: string;
  fuselage: string;
  fuselageShade: string;
  belly: string;
  stripe: string;
  stripeThin: string;
  fin: [string, string];
  logoArc: string;
  logoRing: string;
  logoDot: string;
  logoHalo: string;
  text: string;
  hinge: string;
  nacelle: string;
  wing: string;
  seam: string;
  panel: string;
  /** false — только линии рулей (для режима без окраски). */
  logo?: boolean;
}

export const LIVERIES: Livery[] = [
  {
    id: "night",
    label: "Ночная",
    fuselage: "#3d4959",
    fuselageShade: "#2c3542",
    belly: "#323d4b",
    stripe: "#22d3e6",
    stripeThin: "#1fb8c9",
    fin: ["#f4f7fa", "#e3e9ef"],
    logoArc: "#1a5fe0",
    logoRing: "#22d3e6",
    logoDot: "#2440e0",
    logoHalo: "rgba(34,211,230,0.35)",
    text: "#1a5fe0",
    hinge: "#9aa6b2",
    nacelle: "#3d4959",
    wing: "#c3ccd4",
    seam: "rgba(200,215,230,0.35)",
    panel: "rgba(200,215,230,0.12)",
  },
  {
    id: "blue",
    label: "Синий киль",
    fuselage: "#f2f5f8",
    fuselageShade: "#dfe5eb",
    belly: "#d7dee5",
    stripe: "#1e6fd9",
    stripeThin: "#1e6fd9",
    fin: ["#1aa0f0", "#1a62d6"],
    logoArc: "#ffffff",
    logoRing: "rgba(255,255,255,0.7)",
    logoDot: "#ffffff",
    logoHalo: "rgba(255,255,255,0.35)",
    text: "#ffffff",
    hinge: "#0d3f8f",
    nacelle: "#1a62d6",
    wing: "#c8d0d8",
    seam: "rgba(20,30,40,0.5)",
    panel: "rgba(20,30,40,0.12)",
  },
  {
    id: "white",
    label: "Белая",
    fuselage: "#f6f8fa",
    fuselageShade: "#e3e8ed",
    belly: "#dfe5ea",
    stripe: "#1d4ed8",
    stripeThin: "#1d4ed8",
    fin: ["#f6f8fa", "#e6ebf0"],
    logoArc: "#1d3fc4",
    logoRing: "#38bdf8",
    logoDot: "#2440e0",
    logoHalo: "rgba(56,189,248,0.35)",
    text: "#1d3fc4",
    hinge: "#a3adb8",
    nacelle: "#eef2f5",
    wing: "#c8d0d8",
    seam: "rgba(20,30,40,0.5)",
    panel: "rgba(20,30,40,0.12)",
  },
  {
    id: "graphite",
    label: "Графит",
    fuselage: "#5b6571",
    fuselageShade: "#4a535e",
    belly: "#4f5864",
    stripe: "#1ea0e8",
    stripeThin: "#1ea0e8",
    fin: ["#3a4655", "#283240"],
    logoArc: "#f4f7fa",
    logoRing: "#1ea0e8",
    logoDot: "#f4f7fa",
    logoHalo: "rgba(255,255,255,0.25)",
    text: "#f4f7fa",
    hinge: "#1b222b",
    nacelle: "#3a4655",
    wing: "#b9c2ca",
    seam: "rgba(15,20,26,0.55)",
    panel: "rgba(15,20,26,0.18)",
  },
];

export const NO_LIVERY = "none";

/** Киль без окраски: белая подложка (цвет даёт материал) и линии рулей. */
export const PLAIN_FIN: Livery = {
  ...LIVERIES[2],
  id: "plain",
  fin: ["#ffffff", "#ffffff"],
  hinge: "rgba(20,30,40,0.38)",
  logo: false,
};

export function liveryById(id: string): Livery | null {
  return LIVERIES.find((l) => l.id === id) ?? null;
}

/** Высота полосы на борту: прямая в цилиндре, к хвосту плавно поднимается к оси хвостового конуса. */
export function stripeY(x: number, L: number): number {
  const rise = Math.max(0, (x - (L - 13)) / 13);
  return -0.78 + 1.45 * rise * rise;
}

// ——— Киль ———
// Область рисования логотипа в координатах вида сбоку AC (x — от носа базового A320, y — от оси фюзеляжа).
const FIN_BOX = { x0: 27.5, x1: 37.5, y0: 1.4, y1: 8.2 };
const PPM = 110;

function finArtwork(l: Livery, mirrorText: boolean): HTMLCanvasElement {
  const W = Math.round((FIN_BOX.x1 - FIN_BOX.x0) * PPM);
  const H = Math.round((FIN_BOX.y1 - FIN_BOX.y0) * PPM);
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const g = cv.getContext("2d")!;
  // Метры → пиксели (y вверх).
  g.setTransform(PPM, 0, 0, -PPM, -FIN_BOX.x0 * PPM, FIN_BOX.y1 * PPM);
  const grad = g.createLinearGradient(0, FIN_BOX.y1, 0, FIN_BOX.y0);
  grad.addColorStop(0, l.fin[0]);
  grad.addColorStop(1, l.fin[1]);
  g.fillStyle = grad;
  g.fillRect(FIN_BOX.x0, FIN_BOX.y0, FIN_BOX.x1 - FIN_BOX.x0, FIN_BOX.y1 - FIN_BOX.y0);
  if (l.logo !== false) drawLogo(g, l, mirrorText);
  drawHinges(g, l);
  return cv;
}

function drawLogo(g: CanvasRenderingContext2D, l: Livery, mirrorText: boolean): void {
  // Пунктирная окружность, дуга-траектория и точка вылета.
  const cx = 33.2;
  const cy = 4.45;
  const r = 1.45;
  g.lineCap = "round";
  g.strokeStyle = l.logoRing;
  g.lineWidth = 0.11;
  g.setLineDash([0.26, 0.2]);
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.stroke();
  g.setLineDash([]);
  const a0 = (215 * Math.PI) / 180;
  const a1 = (28 * Math.PI) / 180;
  const p0 = [cx + r * Math.cos(a0), cy + r * Math.sin(a0)];
  const p1 = [cx + r * Math.cos(a1), cy + r * Math.sin(a1)];
  g.strokeStyle = l.logoArc;
  g.lineWidth = 0.14;
  g.beginPath();
  g.moveTo(p0[0], p0[1]);
  g.quadraticCurveTo(cx - 0.55, cy + 1.05, p1[0], p1[1]);
  g.stroke();
  g.fillStyle = l.logoHalo;
  g.beginPath();
  g.arc(p0[0], p0[1], 0.36, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = l.logoDot;
  g.beginPath();
  g.arc(p0[0], p0[1], 0.24, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.arc(p1[0], p1[1], 0.08, 0, Math.PI * 2);
  g.fillStyle = l.logoArc;
  g.fill();
  // Надпись вдоль руля направления, снизу вверх.
  // На одном борту развёртка зеркальна для зрителя, поэтому там надпись зеркалим поперёк строки.
  g.save();
  g.translate(35.55, 3.0);
  if (mirrorText) g.scale(-1, 1);
  g.rotate(Math.PI / 2);
  g.scale(1, -1);
  g.fillStyle = l.text;
  g.font = "600 0.62px 'IBM Plex Sans', system-ui, sans-serif";
  g.textBaseline = "middle";
  g.fillText("FlightCost", 0, 0);
  g.restore();
}

function drawHinges(g: CanvasRenderingContext2D, l: Livery): void {
  // Линии рулей и стыков с чертежа AC — тонко поверх окраски.
  g.strokeStyle = l.hinge;
  g.lineWidth = 0.035;
  const vt = AC.ceo.vtail;
  const tip = vt.tip_y;
  for (const pl of vt.lines) {
    g.beginPath();
    pl.forEach(([u, v], i) => {
      const y = u * tip;
      const le = vt.le.slope * y + vt.le.x0;
      const te = vt.te.slope * y + vt.te.x0;
      const x = le + v * (te - le);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    });
    g.stroke();
  }
}

/**
 * Текстура киля: верхняя половина — правый борт, нижняя — левый. finXY переводит (u, v) развёртки киля
 * в координаты вида сбоку AC.
 */
export function finLiveryTexture(l: Livery, finXY: (u: number, v: number) => [number, number]): THREE.CanvasTexture {
  const W = 1024;
  const H = 1024;
  const out = document.createElement("canvas");
  out.width = W;
  out.height = H;
  const og = out.getContext("2d")!;
  const img = og.createImageData(W, H);
  for (const [half, mirror] of [
    [0, true],
    [1, false],
  ] as const) {
    const art = finArtwork(l, mirror);
    const src = art.getContext("2d")!.getImageData(0, 0, art.width, art.height).data;
    for (let j = 0; j < H / 2; j++) {
      const v = j / (H / 2 - 1);
      for (let i = 0; i < W; i++) {
        const u = i / (W - 1);
        const [x, y] = finXY(u, v);
        const px = Math.round((x - FIN_BOX.x0) * PPM);
        const py = Math.round((FIN_BOX.y1 - y) * PPM);
        const cxp = Math.min(art.width - 1, Math.max(0, px));
        const cyp = Math.min(art.height - 1, Math.max(0, py));
        const s = (cyp * art.width + cxp) * 4;
        const d = ((j + half * (H / 2)) * W + i) * 4;
        img.data[d] = src[s];
        img.data[d + 1] = src[s + 1];
        img.data[d + 2] = src[s + 2];
        img.data[d + 3] = 255;
      }
    }
  }
  og.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(out);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.flipY = false;
  return t;
}
