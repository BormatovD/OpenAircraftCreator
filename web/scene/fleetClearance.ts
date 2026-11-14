import * as THREE from "three";
import { applyReverserMotion } from "./reverser757.ts";
import { nacaHalfThickness, type NacelleSegment, type SurfaceShape } from "./shapes.ts";

const cell = .08;
const gridSize = 512;
const cellKey = (ix:number, iz:number) => ix*gridSize + iz;

// Project both limits and intermediate flap-track poses onto a horizontal grid.
// The lowest triangle corner is a conservative lower bound for its occupied cells.
function trackUndersides(tracks:THREE.BufferGeometry[]) {
  const grid = new Map<number,number>();
  const quaternion = new THREE.Quaternion(), shift = new THREE.Vector3();
  const points = [new THREE.Vector3(),new THREE.Vector3(),new THREE.Vector3()];
  for (const geometry of tracks) {
    const h = geometry.userData.hinge, pos = geometry.getAttribute("position"), index = geometry.getIndex()!;
    for (const f of [0,.25,.5,.75,1]) {
      quaternion.setFromAxisAngle(h.axis,h.angle*f**1.6);
      shift.copy(h.pivot).applyQuaternion(quaternion).negate().add(h.pivot).addScaledVector(h.slide,f**.6);
      for (let t=0; t<index.count; t+=3) {
        for (let k=0; k<3; k++) points[k].fromBufferAttribute(pos,index.getX(t+k)).applyQuaternion(quaternion).add(shift);
        const [a,b,c] = points;
        const ix0 = Math.floor(Math.min(a.x,b.x,c.x)/cell), ix1 = Math.floor(Math.max(a.x,b.x,c.x)/cell);
        const iz0 = Math.floor(Math.min(a.z,b.z,c.z)/cell), iz1 = Math.floor(Math.max(a.z,b.z,c.z)/cell);
        const y = Math.min(a.y,b.y,c.y);
        for(let ix=ix0; ix<=ix1; ix++) for(let iz=iz0; iz<=iz1; iz++) {
          const key = cellKey(ix,iz);
          grid.set(key,Math.min(y,grid.get(key) ?? Infinity));
        }
      }
    }
  }
  return grid;
}

/** Vertical room above the reference engine axis in the assembled installation.
 * Use the same profiles/hinges as the renderer. Spacing is in metres; sample the
 * triangle interiors as well as their edges to catch the swept wing leading edge. */
export function fleetMountTravel(parts: NacelleSegment[], wing: SurfaceShape, inletX: number, axisY: number, axisZ: number, tracks: THREE.BufferGeometry[]) {
  const underside = trackUndersides(tracks);
  const gaps = Array<number>(21).fill(Infinity);
  const d = THREE.MathUtils.degToRad(wing.dihedralDeg), sin = Math.sin(d), cos = Math.cos(d);
  const allowance = .09; // 8 cm nominal model clearance, 1 cm mesh sampling margin
  function gapAt(x: number, y: number, z: number): number {
    const track = (underside.get(cellKey(Math.floor(x/cell),Math.floor(z/cell))) ?? Infinity) - y - allowance;
    // Invert the lower surface's normal offset to recover its span station.
    let u = z / (cos * wing.semiSpanM), half = 0;
    for (let pass = 0; pass < 3; pass++) {
      if (u < 0 || u > 1) return track;
      const { le, chord } = wing.planform!(u);
      const fraction = (x - wing.root.x - le) / chord;
      if (fraction < -.006 || fraction > 1) return track;
      half = chord * nacaHalfThickness(Math.max(.0001, fraction), THREE.MathUtils.lerp(wing.thicknessRoot, wing.thicknessTip, u));
      u = (z - sin * half) / (cos * wing.semiSpanM);
    }
    return Math.min(track, wing.root.y + wing.semiSpanM * u * sin - half * cos - y - allowance);
  }

  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), v = new THREE.Vector3();
  const origin = new THREE.Vector3();
  let fixed = Infinity;
  for (const { id, geometry } of parts) {
    const motion = geometry.userData.reverserMotion;
    if (motion?.role === "cascade" || id === "bypassLiner") continue;
    const moving = motion?.role === "sleeve" || motion?.role === "blocker";
    const mesh = new THREE.Mesh(geometry);
    const pos = geometry.getAttribute("position"), idx = geometry.getIndex();
    const points = new Map<string,THREE.Vector3>();
    for (let j = 0; j < (idx?.count ?? pos.count); j += 3) {
      a.fromBufferAttribute(pos,idx?.getX(j) ?? j);
      b.fromBufferAttribute(pos,idx?.getX(j+1) ?? j+1);
      c.fromBufferAttribute(pos,idx?.getX(j+2) ?? j+2);
      if (Math.max(a.y,b.y,c.y) < 0) continue;
      // Thin rings have short azimuthal edges and relatively long axial edges.
      const steps = Math.max(1, Math.ceil(Math.max(a.distanceTo(b),a.distanceTo(c),b.distanceTo(c))/.12));
      for (let k=0;k<=steps;k++) for(let q=0;q<=steps-k;q++) {
        v.copy(a).multiplyScalar(1-(k+q)/steps).addScaledVector(b,k/steps).addScaledVector(c,q/steps);
        const key = Math.round(v.x*60)+","+Math.round(v.y*60)+","+Math.round(v.z*60);
        if (!points.has(key)) points.set(key,v.clone());
      }
    }
    for(let f=0; f<=(moving ? 20 : 0); f++) {
      if (moving) applyReverserMotion(mesh,f/20,origin);
      let gap = Infinity;
      for(const point of points.values()) {
        v.copy(point).applyQuaternion(mesh.quaternion).add(mesh.position);
        gap = Math.min(gap, gapAt(inletX+v.x,axisY+v.y,axisZ+v.z));
      }
      if (moving) gaps[f]=Math.min(gaps[f],gap);
      else fixed=Math.min(fixed,gap);
    }
    (mesh.material as THREE.Material).dispose();
  }
  for(let f=0; f<gaps.length; f++) gaps[f]=Math.min(gaps[f],fixed, f ? gaps[f-1] : Infinity);
  return gaps;
}
