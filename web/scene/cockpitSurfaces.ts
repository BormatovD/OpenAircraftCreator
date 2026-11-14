// Flat glazing and its mounting surfaces. Both the hull and the glass use these
// planes, so straight photographed frames do not become curved decals.
type P2 = [number, number];
type P3 = [number, number, number];
export interface CockpitFacet {
  polygon: P2[];
  /** z = ax + by + c on the starboard side; port is its mirror. */
  a: number; b: number; c: number;
  /** Half-width of the rounded junction between the side pane and the loft, metres. */
  sillBlendM?: number;
}
interface Layout {
  windscreen: P2[];
  side: P2[][];
  sideJunction?: { top: P2; bottom: P2 };
  sideSlopeX?: number[];
  sillBlendM?: number;
}
export const facetWidth = (p: CockpitFacet, x: number, y: number) => p.a * x + p.b * y + p.c;

export function cockpitFacets(layout: Layout, widthAt: (x: number, y: number) => number): CockpitFacet[] {
  const { top, bottom } = layout.sideJunction!;
  const upper: P3 = [top[0], top[1], widthAt(...top)];
  const lower: P3 = [bottom[0], bottom[1], widthAt(...bottom)];
  const [innerTop, , , innerBottom] = layout.windscreen;
  let lo = 0.01, hi = 6;
  for (let i = 0; i < 40; i++) {
    const x = (lo + hi) / 2;
    if (widthAt(x, innerTop[1]) >= innerTop[0]) hi = x;
    else lo = x;
  }
  const centre: P3 = [hi, innerTop[1], innerTop[0]];
  const u = upper.map((v, i) => v - centre[i]);
  const v = lower.map((w, i) => w - centre[i]);
  const nx = u[1] * v[2] - u[2] * v[1];
  const ny = u[2] * v[0] - u[0] * v[2];
  const nz = u[0] * v[1] - u[1] * v[0];
  const a = -nx / nz, b = -ny / nz;
  const c = centre[2] - a * centre[0] - b * centre[1];
  const centreBottomX = (innerBottom[0] - b * innerBottom[1] - c) / a;
  const front: CockpitFacet = {
    polygon: [[centreBottomX, innerBottom[1]], [centre[0], centre[1]], top, bottom], a, b, c,
  };
  const out = [front];
  let edgeTop = upper, edgeBottom = lower;
  for (const [i, polygon] of layout.side.entries()) {
    const a = layout.sideSlopeX![i];
    const b = (edgeTop[2] - edgeBottom[2] - a * (edgeTop[0] - edgeBottom[0])) / (edgeTop[1] - edgeBottom[1]);
    const c = edgeTop[2] - a * edgeTop[0] - b * edgeTop[1];
    const panel = { polygon, a, b, c, sillBlendM: layout.sillBlendM };
    out.push(panel);
    const [, , nextTop, nextBottom] = polygon;
    edgeTop = [...nextTop, facetWidth(panel, ...nextTop)];
    edgeBottom = [...nextBottom, facetWidth(panel, ...nextBottom)];
  }
  return out;
}

export function cockpitSurfaceWidth(panels: CockpitFacet[], x: number, y: number, original: number): number {
  let width = original;
  for (const panel of panels) {
    const bottom = Math.min(...panel.polygon.map(p => p[1]));
    if (panel.sillBlendM && y < bottom) {
      // Let the flat mounting plane run tangentially below the sill until
      // it meets the round side. Round their intersection over a finite band.
      const plane = Math.max(0, facetWidth(panel, x, y));
      const band = Math.min(panel.sillBlendM, 0.7 * (bottom - y));
      const inside = Math.max(0, band - Math.abs(original - plane));
      const joined = Math.min(original, plane) - inside * inside / (4 * band);
      width = Math.min(width, joined);
      continue;
    }
    const t = Math.max(0, Math.min(1, (y - bottom + 0.25) / 0.25));
    const weight = t * t * (3 - 2 * t);
    width = Math.min(width, original + weight * (Math.max(0, facetWidth(panel, x, y)) - original));
  }
  // Intersect the upper loft with the three common cabin planes. Unlike a
  // local recessed decal, this convex envelope cannot form pockets over the
  // frames. Only the short fairing below the sill returns to the round nose.
  return Math.max(0, width);
}
