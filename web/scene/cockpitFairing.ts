import { cockpitSurfaceWidth, type CockpitFacet } from "./cockpitSurfaces.ts";

type SectionPoint = [number, number]; // height and starboard half-width in metres
type Section = { hw: number; hh: number; cy: number };
type Ring = SectionPoint[];

const stepX = 0.05;
const stepsAroundHalf = 72;
const stepA = Math.PI / stepsAroundHalf;
const startX = 0.14;
const endX = 6.4;
export const insideCockpitFairing = (x: number) => x > startX && x < endX;
const ramp = (x: number) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};

function gaussianWeights(sigma: number, step: number): number[] {
  const count = Math.ceil(3 * sigma / step);
  const weights = Array.from({ length: 2 * count + 1 }, (_, i) => Math.exp(-0.5 * ((i - count) * step / sigma) ** 2));
  const sum = weights.reduce((a, b) => a + b);
  return weights.map(w => w / sum);
}

/** Blend changes into the shell outside the frames. Inside each pane its
 * mounting plane is held fixed. The polygons are convex in side projection. */
function paneDistance(panels: CockpitFacet[]) {
  const outlines = panels.map(({ polygon }) => {
    const area = polygon.reduce((a, [x, y], i) => {
      const next = polygon[(i + 1) % polygon.length];
      return a + x * next[1] - y * next[0];
    }, 0);
    return polygon.map(([x, y], i) => {
      const [xx, yy] = polygon[(i + 1) % polygon.length];
      const k = Math.sign(area) / Math.hypot(xx - x, yy - y);
      return { x, y, nx: (yy - y) * k, ny: (x - xx) * k };
    });
  });
  return (x: number, y: number) => Math.min(...outlines.map(edges =>
    Math.max(0, ...edges.map(p => (x - p.x) * p.nx + (y - p.y) * p.ny))));
}

/** Local fairing of the clipped cockpit shell. The metric/angle grid is
 * independent of the display mesh, so fittings and low-detail meshes can
 * sample the same surface. Returns displacements from the original loft. */
export function buildCockpitFairing(panels: CockpitFacet[], sectionAt: (x: number) => Section,
  unitAt: (a: number) => SectionPoint) {
  const wx = gaussianWeights(0.29, stepX);
  const wa = gaussianWeights(0.24, stepA);
  const rx = (wx.length - 1) / 2, ra = (wa.length - 1) / 2;
  // The weighted cosine is the exact radius loss for a circular section.
  const radiusScale = 1 / wa.reduce((sum, w, k) => sum + w * Math.cos((k - ra) * stepA), 0);
  const last = Math.round(endX / stepX);
  const distance = paneDistance(panels);
  const unit = Array.from({ length: stepsAroundHalf + 1 }, (_, j) => unitAt(j * stepA - Math.PI / 2));
  const raw: Ring[] = [], around: Ring[] = [], offsets: Ring[] = [];

  for (let i = 0; i <= last + rx; i++) {
    const x = i * stepX;
    const section = sectionAt(Math.max(x, 0.0005));
    const ring = unit.map(([cx, sy]): SectionPoint => {
      const y = section.cy + section.hh * sy;
      return i === 0 ? [section.cy, 0] : [y, cockpitSurfaceWidth(panels, x, y, section.hw * Math.max(0, cx))];
    });
    raw.push(ring);
    around.push(ring.map((_, j): SectionPoint => {
      let y = 0, z = 0;
      for (let k = 0; k < wa.length; k++) {
        const m = j + k - ra;
        // Mirror the starboard samples across the crown and keel.
        const mirror = m < 0 || m > stepsAroundHalf;
        const index = m < 0 ? -m : m > stepsAroundHalf ? 2 * stepsAroundHalf - m : m;
        y += wa[k] * ring[index][0];
        z += wa[k] * ring[index][1] * (mirror ? -1 : 1);
      }
      return [section.cy + (y - section.cy) * radiusScale, z * (1 + 0.75 * (radiusScale - 1))];
    }));
  }
  for (let i = 0; i <= last; i++) {
    const x = i * stepX;
    const fade = ramp((x - startX) / 0.9) * ramp((endX - x) / 1.4);
    offsets.push(raw[i].map(([y, z], j): SectionPoint => {
      const weight = fade * ramp((y + 0.8) / 0.8) * ramp(distance(x, y) / 0.50);
      let meanY = 0, meanZ = 0;
      for (let k = 0; k < wx.length; k++) {
        const point = around[Math.max(0, i + k - rx)][j];
        meanY += wx[k] * point[0];
        meanZ += wx[k] * point[1];
      }
      // Moderate the vertical change to retain the photographic roof profile.
      return [0.65 * weight * (meanY - y), weight * (meanZ - z)];
    }));
  }
  return (x: number, a: number): SectionPoint => {
    if (!insideCockpitFairing(x)) return [0, 0];
    const xf = x / stepX, i = Math.min(last - 1, Math.floor(xf)), u = xf - i;
    const af = Math.max(0, Math.min(stepsAroundHalf, (a + Math.PI / 2) / stepA));
    const j = Math.min(stepsAroundHalf - 1, Math.floor(af)), v = af - j;
    const p = offsets[i], q = offsets[i + 1];
    const at = (c: number) => {
      const left = p[j][c] + v * (p[j + 1][c] - p[j][c]);
      const right = q[j][c] + v * (q[j + 1][c] - q[j][c]);
      return left + u * (right - left);
    };
    return [at(0), at(1)];
  };
}
