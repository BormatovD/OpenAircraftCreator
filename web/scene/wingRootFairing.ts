import * as THREE from "three";
import { surfacePoint, type SurfaceShape } from "./shapes.ts";

/** Upper wing/body fairing. The panel follows the local planform and dihedral, and
 * feathers into the fixed wing inboard of the main leg. The transverse
 * curvature is illustrative; the planform comes from each aircraft’s ShapeSet. */
export function wingRootFairing(wing: SurfaceShape, wingWidth: number, sideZ: number, legZ: number,
  tandem: boolean, bodyWidthAt: (x: number, y: number) => number) {
  const root = wing.planform!(sideZ / wingWidth);
  const leading = wing.root.x + root.le, chord = root.chord;
  const chordFraction = (x: number) => (x - leading) / chord;
  const fullness = (v: number) => THREE.MathUtils.smoothstep(v, 0, .15)
    * (1 - THREE.MathUtils.smoothstep(v, tandem ? .94 : .85, 1));
  // The lip is narrow at the nose and wider over the aft part of the root.
  // Scale the blend with the installed root chord, clipped to the available
  // fixed span. The 737 trunnion lies considerably closer to the sidewall.
  const scale = Math.min(chord / 6.03, (legZ - sideZ - .12) / 1.1);
  const outerEdge = (v: number) => sideZ + scale * (.42 + .68 * THREE.MathUtils.smoothstep(v, .1, .78)) * fullness(v);
  const rise = (x: number, z: number) => {
    const v = chordFraction(x), height = fullness(v);
    const width = outerEdge(v) - sideZ;
    if (width < .001) return 0;
    const t = THREE.MathUtils.clamp((z - sideZ) / width, -.22, 1);
    // Steeper at the fuselage, tangent at the wing, with the aft shoulder
    // nearly constant along the chord. This is an offset on the fairing only.
    const shoulder = tandem ? .75 : .53;
    const crown = THREE.MathUtils.lerp(.36, shoulder, THREE.MathUtils.smoothstep(v, .16, .72));
    return height * Math.sqrt(scale) * crown * (1 - t) ** 2;
  };
  const geometry = (side: 1 | -1) => {
    const pos: number[] = [], index: number[] = [];
    const nx = 64, nz = 22;
    for (let i = 0; i <= nx; i++) {
      const v = i / nx;
      const inner = sideZ - .25;
      // Seat the lap inside the actual local sidewall. In the outer row the
      // clean wing takes over where the two surfaces become tangent.
      const inboardWing = surfacePoint(wing, inner / wingWidth, v, true);
      const innerY = inboardWing.y + rise(inboardWing.x, Math.abs(inboardWing.z));
      const start = Math.min(inner, bodyWidthAt(inboardWing.x, innerY) - .025);
      for (let j = 0; j <= nz; j++) {
        const z = THREE.MathUtils.lerp(start, outerEdge(v) + .025, j / nz);
        const u = z / wingWidth;
        const base = surfacePoint(wing, u, v, true);
        // Bury the last millimetres of the lap in the clean upper skin. The
        // inboard edge disappears behind the barrel on all fuselage sections.
        pos.push(base.x, base.y + rise(base.x, Math.abs(base.z)) - .004, side * base.z);
      }
    }
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const a = i * (nz + 1) + j, b = a + nz + 1;
      if (side === 1) index.push(a, a + 1, b, a + 1, b + 1, b);
      else index.push(a, b, a + 1, a + 1, b, b + 1);
    }
    const mesh = new THREE.BufferGeometry();
    mesh.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    mesh.setIndex(index);
    mesh.computeVertexNormals();
    mesh.name = "wing-root-fairing";
    Object.assign(mesh.userData, { side, fixedWingBody: true, bellyPaint: true });
    return mesh;
  };
  return { geometry, rise };
}
