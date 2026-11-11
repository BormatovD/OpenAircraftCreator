import * as THREE from "three";

/** Выбор агрегата — небольшой разбор; полный разлёт остаётся отдельным ползунком. */
export const SELECTED_EXPLODE_FRACTION = 0.22;

export interface SceneFrameArea {
  width: number;
  height: number;
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** Учитываем геометрию самолёта и её позу, но не выноски, линии, землю или облака. */
export function meshFramePoints(root: THREE.Object3D): THREE.Vector3[] {
  root.updateWorldMatrix(true, true);
  const points: THREE.Vector3[] = [];
  root.traverseVisible((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    const box = o.geometry.boundingBox;
    if (!box || box.isEmpty()) return;
    for (const x of [box.min.x, box.max.x])
      for (const y of [box.min.y, box.max.y])
        for (const z of [box.min.z, box.max.z]) points.push(new THREE.Vector3(x, y, z).applyMatrix4(o.matrixWorld));
  });
  return points;
}

/**
 * Дистанция перспективной камеры для свободной области между плашками.
 * Ракурс сохраняется. Габариты берутся от каждой сетки, чтобы пустые углы общей
 * коробки длинного самолёта не заставляли чрезмерно отдалять камеру.
 */
export function fitAircraftFrame(
  points: readonly THREE.Vector3[],
  direction: THREE.Vector3,
  up: THREE.Vector3,
  verticalFovDeg: number,
  zoom: number,
  near: number,
  area: SceneFrameArea,
) {
  const width = area.width - area.left - area.right;
  const height = area.height - area.top - area.bottom;
  if (!points.length || width <= 0 || height <= 0 || area.width <= 0 || area.height <= 0) return undefined;
  const back = direction.clone().normalize();
  const right = new THREE.Vector3().crossVectors(up, back).normalize();
  if (back.lengthSq() < 0.5 || right.lengthSq() < 0.5) return undefined;
  const vertical = new THREE.Vector3().crossVectors(back, right).normalize();
  const target = new THREE.Box3().setFromPoints([...points]).getCenter(new THREE.Vector3());
  const tan = Math.tan(THREE.MathUtils.degToRad(verticalFovDeg) / 2) / zoom;
  let distance = near * 2;
  const local = new THREE.Vector3();
  for (const point of points) {
    local.copy(point).sub(target);
    const z = local.dot(back);
    distance = Math.max(distance, z + near * 2,
      z + Math.abs(local.dot(right)) * area.height / (tan * width),
      z + Math.abs(local.dot(vertical)) * area.height / (tan * height));
  }
  if (!Number.isFinite(distance)) return undefined;
  // Малый запас на сглаживание позы и округление размеров DOM до физических пикселей.
  distance *= 1.035;
  return {
    target,
    direction: back,
    distance,
    position: target.clone().addScaledVector(back, distance),
    offsetX: (area.right - area.left) / 2,
    offsetY: (area.bottom - area.top) / 2,
  };
}
