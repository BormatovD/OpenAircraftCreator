import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { EngineArchitecture } from "../../src/definition.ts";
import type { EnginePiece } from "./shapes.ts";

type Combustor = NonNullable<EngineArchitecture["combustor"]>;

// Axial fraction from the dome to the turbine, radius relative to the core.
// The sections describe the liner metal, leaving the annular gas passage open.
export const COMBUSTORS = {
  "rb211-phase2": {
    label: "Phase II", injectors: 18, headRadius: 0.60,
    outer: [[0, .69], [.08, .73], [.30, .74], [.66, .73], [.87, .68], [1, .63]],
    inner: [[0, .51], [.11, .43], [.31, .41], [.68, .40], [.87, .41], [1, .43]],
  },
  "pw2037-rolled-ring": {
    label: "Кольцевая с вальцованными кольцами", injectors: 24, headRadius: 0.70,
    outer: [[0, .78], [.10, .85], [.32, .86], [.63, .78], [1, .63]],
    inner: [[0, .62], [.12, .54], [.38, .52], [.72, .46], [1, .43]],
  },
} satisfies Record<Combustor, { label: string; injectors: number; headRadius: number; outer: number[][]; inner: number[][] }>;

const tau = 2 * Math.PI;

function lathe(profile: THREE.Vector2[], angle = tau, segments = 96) {
  const geometry = new THREE.LatheGeometry(profile, segments, 0, angle);
  return geometry.rotateZ(-Math.PI / 2);
}

export function combustorPieces(style: Combustor, length: number, rc: number): EnginePiece[] {
  const spec = COMBUSTORS[style];
  const pw = style === "pw2037-rolled-ring";
  const pitch = tau / spec.injectors;
  const faceRadius = spec.headRadius * rc;
  const nozzleRadius = 0.32 * faceRadius * Math.sin(pitch / 2);
  // P&W CR-191066, fig. 3-2: 229 mm from nozzle face to first turbine vane at stock scale.
  const stockPwLength = 1.99 * (1.7 + 0.09 * 0.3 / 5.3);
  const burnLength = pw ? 0.229 * length / stockPwLength : 0.064 * length;
  const exit = 0.60 * length;
  const face = exit - burnLength;
  const start = face + 0.025 * burnLength;
  const at = (u: number) => start + (exit - start) * u;

  // Unroll a strip of liner, pierce a dilution port, then wrap repeated sectors
  // back onto the cone. The size and spacing of the ports are illustrative.
  function perforatedStrip(a: THREE.Vector2, b: THREE.Vector2, angle: number, outside: boolean) {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0); shape.lineTo(1, 0); shape.lineTo(1, 1); shape.lineTo(0, 1); shape.closePath();
    const hole = new THREE.Path();
    hole.absellipse(.5, .5, .30, .20, 0, tau, true, 0);
    shape.holes.push(hole);
    const template = new THREE.ShapeGeometry(shape, 10);
    const tiles: THREE.BufferGeometry[] = [];
    const slots = 24;
    const normal = new THREE.Vector3();
    const sign = outside ? 1 : -1;
    for (let k = 0; k < Math.round(slots * angle / tau); k++) {
      const tile = template.clone(), pos = tile.getAttribute("position");
      const normals = tile.getAttribute("normal");
      for (let i = 0; i < pos.count; i++) {
        const u = pos.getX(i), phi = (k + pos.getY(i)) * tau / slots;
        const r = THREE.MathUtils.lerp(a.x, b.x, u);
        pos.setXYZ(i, THREE.MathUtils.lerp(a.y, b.y, u), -r * Math.sin(phi), r * Math.cos(phi));
        normal.set(-(b.x - a.x) / (b.y - a.y), -Math.sin(phi), Math.cos(phi)).normalize().multiplyScalar(sign);
        normals.setXYZ(i, normal.x, normal.y, normal.z);
      }
      if (outside) {
        const idx = tile.getIndex()!;
        for (let i = 0; i < idx.count; i += 3) {
          const second = idx.getX(i + 1);
          idx.setX(i + 1, idx.getX(i + 2));
          idx.setX(i + 2, second);
        }
      }
      tiles.push(tile);
    }
    return mergeGeometries(tiles)!;
  }

  function wall(stations: number[][], outside: boolean) {
    const profile: THREE.Vector2[] = [];
    for (let i = 0; i < stations.length; i++) {
      const [u, r] = stations[i];
      if (pw && i > 0) {
        // Overlapping rolled-ring lips on both walls, facing downstream.
        const [prevU, prevR] = stations[i - 1];
        const radius = THREE.MathUtils.lerp(prevR, r, 0.5);
        const sign = outside ? 1 : -1;
        profile.push(new THREE.Vector2(radius * rc, at((u + prevU) / 2)),
          new THREE.Vector2((radius + sign * .012) * rc, at((u + prevU) / 2 + .012)));
      }
      profile.push(new THREE.Vector2(r * rc, at(u)));
    }
    // Leave one quadrant of the outer wall open in the inspection model.
    const angle = outside ? 1.5 * Math.PI : tau;
    const portIndex = pw ? 6 : 2;
    const strip = (section: THREE.Vector2[]) => lathe(outside ? section : section.reverse(), angle);
    return mergeGeometries([strip(profile.slice(0, portIndex + 1)),
      perforatedStrip(profile[portIndex], profile[portIndex + 1], angle, outside),
      strip(profile.slice(portIndex + 1))])!;
  }

  const dome = new THREE.Shape();
  dome.absarc(0, 0, spec.outer[0][1] * rc, 0, tau, false);
  function hole(y: number, z: number, radius: number) {
    const h = new THREE.Path();
    h.absarc(-z, y, radius, 0, tau, true);
    dome.holes.push(h);
  }
  hole(0, 0, spec.inner[0][1] * rc);

  // Feed arm enters from the outer case. The cup and nozzle open axially into the liner.
  const nozzleAngle = pw ? -.19 : -.09;
  function nozzleSurface(section: number[][]) {
    return lathe(section.map(([u,r]) => new THREE.Vector2(r * nozzleRadius, u * burnLength)), tau, 16)
      .rotateZ(nozzleAngle).translate(face, faceRadius, 0);
  }
  const cup = nozzleSurface([[-.12, 1.10], [-.045, 1.15], [0, .89], [.035, .89], [.09, 1.45]]);
  const barrel = nozzleSurface([[-.21, .61], [-.09, .78], [-.014, .80], [0, .48], [-.05, .48]]);
  const feedEnd = new THREE.Vector3(-.16 * burnLength, 0, 0)
    .applyAxisAngle(new THREE.Vector3(0, 0, 1), nozzleAngle).add(new THREE.Vector3(face, faceRadius, 0));
  const stem = new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(face + .18 * burnLength, .99 * rc, 0),
    new THREE.Vector3(face - .23 * burnLength, .91 * rc, 0), feedEnd), 8, nozzleRadius * .45, 8, false);
  const flange = new THREE.CylinderGeometry(nozzleRadius * 1.08, nozzleRadius * 1.08, .019 * rc, 12)
    .translate(face + .18 * burnLength, .99 * rc, 0);
  const injector = mergeGeometries([barrel, stem, flange])!;
  const cups: THREE.BufferGeometry[] = [], injectors: THREE.BufferGeometry[] = [];
  for (let i = 0; i < spec.injectors; i++) {
    const angle = i * pitch;
    hole(faceRadius * Math.cos(angle), faceRadius * Math.sin(angle), nozzleRadius * 1.12);
    cups.push(cup.clone().rotateX(angle));
    injectors.push(injector.clone().rotateX(angle));
  }
  const panel = new THREE.ShapeGeometry(dome, 32).rotateY(Math.PI / 2).translate(start, 0, 0);
  const liner = mergeGeometries([wall(spec.outer, true), wall(spec.inner, false), panel])!;
  const manifold = new THREE.TorusGeometry(.99 * rc, .022 * rc, 8, 96)
    .rotateY(Math.PI / 2).translate(face + .18 * burnLength, 0, 0);
  const offset = new THREE.Vector3(.25, 0, 0);
  function piece(name: string, geometry: THREE.BufferGeometry, tone: EnginePiece["tone"]): EnginePiece {
    geometry.name = "combustor-" + name;
    return { geometry, tone, spin: null, offset };
  }
  return [piece("liner", liner, "hot"), piece("cups", mergeGeometries(cups)!, "detailSteel"),
    piece("injectors", mergeGeometries(injectors)!, "detailSteel"), piece("manifold", manifold, "detailFuel")];
}
