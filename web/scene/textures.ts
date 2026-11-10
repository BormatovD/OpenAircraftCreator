// Детали поверх формы — по линиям Airbus AC 2-2-0 (векторный вид сбоку и сверху):
// окна, двери, аварийные выходы, остекление кабины на фюзеляже; границы механизации, рулей,
// обтекатели кареток на крыле и оперении. Линии хранятся в относительных координатах
// (длина фюзеляжа, доли размаха и хорды), поэтому следуют за рычагами. Окраска — livery.ts.

import * as THREE from "three";
import { type AircraftDefinition } from "../../src/definition.ts";
import { type Livery, stripeY } from "./livery.ts";
import { S } from "./shapeSet.ts";
import { type FuselageShape, fuselagePlugs, modelX, sectionV } from "./shapes.ts";

const WINDOW = "#1b2733";
const SEAM_DEFAULT = "rgba(20,30,40,0.6)";
const PANEL = "rgba(20,30,40,0.38)";

function canvasTexture(cv: HTMLCanvasElement, anisotropy = 8): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = anisotropy;
  // Холст рисуется сверху вниз по v, без переворота.
  t.flipY = false;
  return t;
}

export function fuselageTexture(def: AircraftDefinition, livery: Livery | null = null): THREE.CanvasTexture {
  const W = 4096;
  const H = 1024;
  const f: FuselageShape = { lengthM: def.fuselage.lengthM, widthM: def.fuselage.widthM, heightM: def.fuselage.heightM };
  const L = f.lengthM;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const g = cv.getContext("2d")!;
  g.fillStyle = livery?.fuselage ?? "#ffffff";
  g.fillRect(0, 0, W, H);
  const px = (x: number) => (x / L) * W;
  const SEAM = livery?.seam ?? SEAM_DEFAULT;
  const PANEL_LINE = livery?.panel ?? "rgba(20,30,40,0.16)";
  // Высота y → доля оборота v на правом (side = 1) или левом борту; правый борт держим непрерывным через шов.
  const vOf = (y: number, side: 1 | -1) => {
    const v = sectionV(f, y, side);
    return side === 1 && v > 0.5 ? v - 1 : v;
  };
  const shape = (pts: [number, number][], side: 1 | -1, fill: string | null, stroke: string | null, close = true) => {
    for (const shift of [0, 1]) {
      g.beginPath();
      pts.forEach(([x, y], i) => {
        const X = px(x);
        const Y = (vOf(y, side) + shift) * H;
        if (i === 0) g.moveTo(X, Y);
        else g.lineTo(X, Y);
      });
      if (close) g.closePath();
      if (fill) {
        g.fillStyle = fill;
        g.fill();
      }
      if (stroke) {
        g.strokeStyle = stroke;
        g.lineWidth = 3;
        g.stroke();
      }
    }
  };
  const roundRect = (x0: number, x1: number, y0: number, y1: number, side: 1 | -1, fill: string | null, stroke: string | null) => {
    const r = Math.min((x1 - x0) / 2, 0.08);
    const pts: [number, number][] = [];
    const steps = 6;
    const corner = (cx: number, cy: number, a0: number) => {
      for (let k = 0; k <= steps; k++) {
        const a = a0 + (k / steps) * (Math.PI / 2);
        pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
      }
    };
    corner(x1 - r, y1 - r, 0);
    corner(x0 + r, y1 - r, Math.PI / 2);
    corner(x0 + r, y0 + r, Math.PI);
    corner(x1 - r, y0 + r, (3 * Math.PI) / 2);
    shape(pts, side, fill, stroke);
  };

  const feats = S().features;
  const drawn = feats.filter((w) => w.kind === "window");
  const FUSELAGE_PLUGS = fuselagePlugs();
  // Шаг окон — медиана по чертежу.
  const steps = drawn.slice(1).map((w, i) => w.x0 - drawn[i].x0).sort((p, q) => p - q);
  const pitch = steps.length ? steps[Math.floor(steps.length / 2)] : 0.5334;
  // На виде сбоку AC A320 крыло закрывает три окна за ним (20,1–22,3 м) — дорисовываем пропуски с тем же шагом,
  // если между окнами нет двери или выхода.
  const openings = feats.filter((q) => q.kind === "door" || q.kind === "exit");
  const windows: typeof drawn = [];
  for (const [i, w] of drawn.entries()) {
    windows.push(w);
    const nx = drawn[i + 1];
    if (!nx || nx.x0 - w.x0 < 1.6 * pitch) continue;
    if (openings.some((o) => o.x1 > w.x1 && o.x0 < nx.x0)) continue;
    for (let x = w.x0 + pitch; x < nx.x0 - 0.6 * pitch; x += pitch) windows.push({ ...w, x0: x, x1: x + (w.x1 - w.x0) });
  }
  const half = (L - FUSELAGE_PLUGS.baseLengthM) / 2;
  const extra: { x0: number; x1: number; y0: number; y1: number }[] = [];
  if (half > 0)
    for (const plug of [FUSELAGE_PLUGS.forward, FUSELAGE_PLUGS.aft]) {
      const before = windows.filter((w) => w.x0 < plug).at(-1);
      if (!before) continue;
      const start = modelX(L, before.x0 - 1e-6);
      // Начало вставки в координатах модели (до неё сдвиг только от предыдущих вставок).
      const plugStart = modelX(L, plug - 1e-6);
      for (let x = start + pitch; x < plugStart + half - 0.05; x += pitch)
        extra.push({ x0: x, x1: x + (before.x1 - before.x0), y0: before.y0, y1: before.y1 });
    }
  // Панели обшивки: кольцевые стыки (каждые ~2,1 м, как стыки секций и обшивочных листов) и продольные
  // нахлёсты на четырёх уровнях — тонкие, едва заметные линии.
  // Окраска: низ фюзеляжа чуть темнее, полоса вдоль борта поднимается к хвосту.
  if (livery) {
    for (const side of [1, -1] as const) {
      const belly: [number, number][] = [];
      for (let x = 0.3; x <= L; x += 0.25) belly.push([x, -1.35]);
      for (let x = L; x >= 0.3; x -= 0.25) belly.push([x, -2.3]);
      shape(belly, side, livery.belly, null);
      const band = (dy0: number, dy1: number, color: string, from: number) => {
        const pts: [number, number][] = [];
        for (let x = from; x <= L - 0.25; x += 0.2) pts.push([x, stripeY(x, L) + dy1]);
        for (let x = L - 0.25; x >= from; x -= 0.2) pts.push([x, stripeY(x, L) + dy0]);
        shape(pts, side, color, null);
      };
      band(-0.09, 0.09, livery.stripe, 3.2);
      band(-0.3, -0.25, livery.stripeThin, 5.0);
    }
    // Название типа крупно на борту — между первой дверью и аварийными выходами над крылом, поверх линии окон
    // (окна рисуются позже и остаются видны сквозь буквы). На левом борту нос справа — строку зеркалим по длине,
    // чтобы надпись читалась слева направо с обоих бортов.
    const name = def.shortName ?? "";
    if (name) {
      const tc = document.createElement("canvas");
      const tg = tc.getContext("2d")!;
      const fontPx = 220;
      const font = `700 ${fontPx}px 'IBM Plex Sans', 'Segoe UI', system-ui, sans-serif`;
      tg.font = font;
      const tw = Math.ceil(tg.measureText(name).width);
      tc.width = tw + 20;
      tc.height = Math.round(fontPx * 1.0);
      tg.font = font;
      tg.fillStyle = livery.title;
      tg.textBaseline = "middle";
      tg.fillText(name, 10, tc.height / 2 + fontPx * 0.04);
      const hM = 1.45; // высота строки, м
      const xA = modelX(L, S().titleX[0]);
      const xB = modelX(L, S().titleX[1]);
      const wM = Math.min(xB - xA, (hM * tc.width) / tc.height);
      const xc = (xA + xB) / 2;
      const yTop = 1.28;
      const yBot = yTop - hM;
      for (const side of [1, -1] as const) {
        const mirror = side === -1;
        for (const shift of [0, 1]) {
          const X0 = px(xc - wM / 2);
          const X1 = px(xc + wM / 2);
          const Y0 = (vOf(yTop, side) + shift) * H;
          const Y1 = (vOf(yBot, side) + shift) * H;
          g.save();
          g.translate(mirror ? X1 : X0, Y0);
          g.scale(((X1 - X0) / tc.width) * (mirror ? -1 : 1), (Y1 - Y0) / tc.height);
          g.drawImage(tc, 0, 0);
          g.restore();
        }
      }
    }
  }
  g.strokeStyle = PANEL_LINE;
  g.lineWidth = 2;
  for (let x = 2.1; x < L - 2; x += 2.1) {
    g.beginPath();
    g.moveTo(px(x), 0);
    g.lineTo(px(x), H);
    g.stroke();
  }
  for (const side of [1, -1] as const)
    for (const y of [1.55, 0.05, -1.25]) shape([[0.8, y], [L - 1.0, y]], side, null, PANEL_LINE, false);
  // Грузовые люки — на правом борту (AC 2-6-0): передний и задний 1,81 м, багажный 0,86 м.
  const cargo = S().cargo;
  for (const [x0, w, y0, y1] of cargo) roundRect(modelX(L, x0), modelX(L, x0) + w, y0, y1, 1, null, SEAM);
  // Лючки обслуживания: кислород и наземное питание слева у носа, вода и дренаж сзади.
  for (const [x0, w, y0, y1, sd] of [
    [3.6, 0.35, -1.3, -1.0, -1],
    [6.2, 0.4, -1.75, -1.45, 1],
    [L - 9.5, 0.35, -1.6, -1.35, 1],
    [L - 9.0, 0.35, -1.6, -1.35, -1],
  ] as [number, number, number, number, 1 | -1][])
    roundRect(x0, x0 + w, y0, y1, sd, null, "rgba(20,30,40,0.4)");
  // Копоть у выхлопа ВСУ на кончике хвоста.
  const soot = g.createLinearGradient(px(L - 1.6), 0, px(L), 0);
  soot.addColorStop(0, "rgba(40,40,40,0)");
  soot.addColorStop(1, "rgba(40,40,40,0.55)");
  g.fillStyle = soot;
  g.fillRect(px(L - 1.6), 0, px(L) - px(L - 1.6), H);

  // Окна в координатах модели. При укорочении (A319) вырезанный участок стягивает соседние окна — оставляем окно,
  // только если до предыдущего не меньше 0,8 шага, иначе получается «гармошка».
  const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
  for (const w of [...windows.map((q) => ({ ...q, x0: modelX(L, q.x0), x1: modelX(L, q.x0) + (q.x1 - q.x0) })), ...extra].sort((p, q) => p.x0 - q.x0))
    if (!placed.length || w.x0 - placed.at(-1)!.x0 >= 0.8 * pitch) placed.push(w);
  for (const side of [1, -1] as const) {
    // Ширину берём с чертежа, а не сдвигаем оба края: иначе окно на границе вставки растягивается на всю вставку.
    const at = (q: { x0: number; x1: number }) => [modelX(L, q.x0), modelX(L, q.x0) + (q.x1 - q.x0)] as const;
    for (const w of placed) roundRect(w.x0, w.x1, w.y0, w.y1, side, WINDOW, null);
    for (const d of feats.filter((q) => q.kind === "door" || q.kind === "exit"))
      roundRect(...at(d), d.y0, d.y1, side, null, SEAM);
    // Остекление кабины: на виде сбоку AC окна нарисованы незамкнутыми линиями — собираем стёкла
    // из их узлов (лобовое боковое, боковое, открываемая форточка).
    // Остекление кабины — отдельная геометрия (cockpit.ts), на текстуре его нет.
  }
  return canvasTexture(cv);
}

/** Детали несущей поверхности: u — доля размаха (по ширине холста), v — доля хорды (по высоте). */
function surfaceTexture(lines: number[][][], mapU: (u: number) => number = (u) => u): THREE.CanvasTexture {
  const W = 2048;
  const H = 512;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const g = cv.getContext("2d")!;
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, W, H);
  g.strokeStyle = PANEL;
  g.lineWidth = 2.5;
  for (const pl of lines) {
    g.beginPath();
    pl.forEach(([u, v], i) => {
      const X = mapU(u) * W;
      const Y = v * H;
      if (i === 0) g.moveTo(X, Y);
      else g.lineTo(X, Y);
    });
    g.stroke();
  }
  return canvasTexture(cv, 4);
}

export function wingTexture(): THREE.CanvasTexture {
  return surfaceTexture(S().wing.lines);
}
export function htailTexture(): THREE.CanvasTexture {
  return surfaceTexture(S().htail.lines);
}
export function vtailTexture(): THREE.CanvasTexture {
  const tip = S().vtail.tipY;
  const base = S().halfH;
  return surfaceTexture(S().vtail.lines, (u) => (u * tip - base) / (tip - base));
}
