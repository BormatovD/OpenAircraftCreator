import * as THREE from "three";
import type { GearProfile } from "./gearBay.ts";

type Side = -1 | 1;
export type DoorDrive = "sequence" | "nose-link-front" | "nose-link-aft" | "nose-link-737" | "wing-link";
export type DoorMotion = { axis: THREE.Vector3; angle: number; drive: DoorDrive };

export type Surface = (x: number, absZ: number) => number;
// A rigid two-sided shell follows the closed skin, with a narrow return around its perimeter.
// The shell has thickness; both the interior and the outside remain visible with back-face culling.
export function panel(name: string, profile: GearProfile, side: Side,
  x0: number, x1: number, hingeZ: number, edgeZ: number, lower: Surface,
  drive: DoorDrive, degrees: number) {
  const origin = new THREE.Vector3(x0, lower(x0, hingeZ), side * hingeZ);
  const axis = new THREE.Vector3(x1 - x0, lower(x1, hingeZ) - origin.y, 0).normalize();
  const g = panelShell(name, side, x0, x1, hingeZ, edgeZ, lower);
  g.translate(-origin.x, -origin.y, -origin.z);
  Object.assign(g.userData, {
    basePos: origin, side, gearProfile: profile, gearDoor: {
      axis, drive, angle: THREE.MathUtils.degToRad(degrees) * side * Math.sign(edgeZ - hingeZ)
    } satisfies DoorMotion
  });
  return g;
}
export function panelShell(name: string, side: Side, x0: number, x1: number, z0: number, z1: number, lower: Surface) {
  const pos: number[] = [], idx: number[] = [];
  const nx = 6, nz = 8, span = (nx + 1) * (nz + 1), row = nz + 1;
  for (let face = 0; face < 2; face++) {
    for (let ix = 0; ix <= nx; ix++) {
      for (let iz = 0; iz <= nz; iz++) {
        const x = THREE.MathUtils.lerp(x0, x1, ix / nx), z = THREE.MathUtils.lerp(z0, z1, iz / nz);
        pos.push(x, lower(x, z) + face * .026, side * z);
      }
    }
  }
  const quad = (a: number, b: number, c: number, d: number) => { idx.push(a, b, c, a, c, d); };
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const a = i * row + j, b = a + row;
      quad(a, b, b + 1, a + 1);
      quad(a + span, a + 1 + span, b + 1 + span, b + span);
    }
  }
  for (let i = 0; i < nx; i++) {
    const a = i * row, b = a + row;
    quad(a, a + span, b + span, b);
    quad(a + nz, b + nz, b + nz + span, a + nz + span);
  }
  for (let j = 0; j < nz; j++) {
    const a = nx * row + j;
    quad(j, j + 1, j + 1 + span, j + span);
    quad(a, a + span, a + 1 + span, a + 1);
  }
  if (side * (z1 - z0) < 0) for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Static rim is slightly inset under the door; the hinge side and centre seam stay supported.
  const margin = .024;
  g.userData.bayOpening = {
    x0: x0 + margin, x1: x1 - margin,
    z0: Math.min(side * z0, side * z1) + margin, z1: Math.max(side * z0, side * z1) - margin
  };
  g.name = name;
  g.userData.tone = "detailPanel";
  return g;
}
