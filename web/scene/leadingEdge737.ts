import { BufferGeometry, Float32BufferAttribute, MathUtils, ShapeUtils, Vector2, Vector3 } from "three";
import { surfacePoint, type SurfaceShape } from "./shapes.ts";
import type { HighLiftHinge } from "./highLiftHinge.ts";

// A section point is a chord fraction and a fraction of the local distance from
// the lower to the upper wing skin. Both assemblies use the installed airfoil.
type Section = [chord: number, height: number][];
const hingeChord = .025;
const aft = .11;
const nose: Section = [[0, .5], [.003, 1], [.01, 1], [hingeChord, 1], [.05, 1], [.08, 1], [aft, 1]];
const innerBody: Section = [...nose, [aft, .12], [.08, .12], [.05, .12],
  [hingeChord, .12], [hingeChord, 0], [.01, 0], [.003, 0]];
const krueger: Section = [[hingeChord, .04], [.045, .065], [.075, .06], [aft, .03],
  [aft, 0], [.075, 0], [.045, 0], [hingeChord, 0]];
const slat: Section = [...nose, [.09, .89], [.065, .70], [.041, .38], [.045, 0],
  [hingeChord, 0], [.01, 0], [.003, 0]];
// The fixed nose of the outer panel fits in the hollow cove of the slat.
const outerBody: Section = [[.043, .38], [.067, .68], [.094, .87], [aft, .96],
  [aft, 0], [.075, 0], [.045, 0]];

function sectionGeometry(wing: SurfaceShape, u0: number, u1: number, section: Section) {
  const segments = Math.max(3, Math.ceil((u1 - u0) * 50));
  const positions: number[] = [], uv: number[] = [], index: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const u = MathUtils.lerp(u0, u1, i / segments);
    for (const [v, h] of section) {
      const p = surfacePoint(wing, u, v, false).lerp(surfacePoint(wing, u, v, true), h);
      positions.push(p.x, p.y, p.z);
      uv.push(u, v);
    }
  }
  const n = section.length;
  function triangle(a: number, b: number, c: number) {
    if (wing.side === -1) index.push(a, c, b);
    else index.push(a, b, c);
  }
  for (let i = 0; i < segments; i++) for (let j = 0; j < n; j++) {
    const a = i * n + j, b = i * n + (j + 1) % n;
    triangle(a, a + n, b);
    triangle(b, a + n, b + n);
  }
  // A slat cove is concave; triangulate the section rather than fanning its cap.
  const profile = section.map(([v, h]) => {
    const p = surfacePoint(wing, u0, v, false).lerp(surfacePoint(wing, u0, v, true), h);
    return new Vector2(p.x, p.y);
  });
  for (const [a, b, c] of ShapeUtils.triangulateShape(profile, [])) {
    triangle(c, b, a);
    triangle(a + segments * n, b + segments * n, c + segments * n);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(positions, 3));
  g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

export function leadingEdge737(wing: SurfaceShape, bodyEdge: number, pylonIn: number, pylonOut: number, tip: number, slatCount: number) {
  const fixed: BufferGeometry[] = [], moving: BufferGeometry[] = [];
  const side = wing.side!;
  function panels(kind: "krueger" | "slat", from: number, to: number, count: number) {
    if (to <= from) return;
    const inboard = kind === "krueger";
    const backing = sectionGeometry(wing, from, to, inboard ? innerBody : outerBody);
    backing.name = inboard ? "krueger-recess" : "slat-fixed-nose";
    fixed.push(backing);
    for (let i = 0; i < count; i++) {
      // Small joints distinguish adjacent panels in their stowed position.
      const margin = .008 / wing.semiSpanM;
      const u0 = MathUtils.lerp(from, to, i / count) + margin;
      const u1 = MathUtils.lerp(from, to, (i + 1) / count) - margin;
      if (u1 <= u0) continue;
      const g = sectionGeometry(wing, u0, u1, inboard ? krueger : slat);
      const hinge = inboard ? hingeChord : aft;
      const pivot = surfacePoint(wing, u0, hinge, false);
      const axis = surfacePoint(wing, u1, hinge, false).sub(pivot).normalize();
      const chord = wing.planform!((u0 + u1) / 2).chord;
      g.name = kind + "-" + (i + 1);
      g.userData.hinge = { kind, pivot, axis, angle: MathUtils.degToRad(side * (inboard ? -130 : 25)),
        slide: inboard ? new Vector3() : new Vector3(-.072 * chord, -.052 * chord, 0) } satisfies HighLiftHinge;
      g.userData.side = side;
      g.userData.offset = new Vector3(-2.2, -.3, 0);
      moving.push(g);
    }
  }
  panels("krueger", bodyEdge, pylonIn, 2);
  panels("slat", pylonOut, tip, slatCount);
  return { fixed, moving };
}
