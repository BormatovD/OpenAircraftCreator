import { type Object3D, Vector3 } from "three";

export interface HighLiftHinge {
  kind: "flap" | "slat" | "krueger";
  pivot: Vector3;
  axis: Vector3;
  angle: number;
  slide: Vector3;
}

const rotatedPivot = new Vector3();

/** The caller resets position to the assembled/exploded datum before posing a panel. */
export function applyHighLiftHinge(mesh: Object3D, h: HighLiftHinge, extension: number): void {
  const f = Math.max(0, Math.min(1, extension));
  let turn = Math.sqrt(f);
  let travel = turn;
  if (h.kind === "krueger") {
    // A two-position device already fully extended in our takeoff configuration.
    turn = Math.min(1, f / .45);
  } else if (h.kind === "flap") {
    turn = f ** 1.6;
    travel = f ** .6;
  }
  mesh.quaternion.setFromAxisAngle(h.axis, h.angle * turn);
  rotatedPivot.copy(h.pivot).applyQuaternion(mesh.quaternion);
  mesh.position.add(h.pivot).sub(rotatedPivot).addScaledVector(h.slide, travel);
}
