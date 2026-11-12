/**
 * Lightweight procedural surface relief for detailed ATA equipment.
 * This is a reusable micro-finish, NOT an AO/normal bake of a specific machine.
 * A genuine per-part AO bake requires stable UVs and reviewed component CAD.
 * One 128² grayscale texture per pattern, shared across all model rebuilds.
 */
import * as THREE from "three";

export type TechnicalFinish = "machined" | "cabinet" | "hoses";
const maps = new Map<TechnicalFinish, THREE.DataTexture>();

function hash(x: number, y: number): number {
  let v = Math.imul(x + 7, 374761393) ^ Math.imul(y + 13, 668265263);
  v = Math.imul(v ^ (v >>> 13), 1274126177);
  return ((v ^ (v >>> 16)) >>> 0) / 4294967295;
}

export function technicalRelief(pattern: TechnicalFinish): THREE.DataTexture {
  const previous = maps.get(pattern);
  if (previous) return previous;
  const n = 128;
  const bytes = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const noise = (hash(x, y) - .5) * 12;
      const lines = pattern === "machined"
        ? (x % 8 < 2 ? 13 : -3)
        : pattern === "cabinet"
          ? ((x % 32 < 2 || y % 32 < 2) ? -22 : 5)
          : (y % 16 < 3 ? 12 : -2);
      const gray = Math.max(24, Math.min(230, Math.round(128 + noise + lines)));
      const i = (y * n + x) * 4;
      bytes[i] = gray;
      bytes[i + 1] = gray;
      bytes[i + 2] = gray;
      bytes[i + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(bytes, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 2);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.flipY = false;
  texture.userData.cached = true;
  texture.needsUpdate = true;
  maps.set(pattern, texture);
  return texture;
}

export function finishForTone(tone: string): TechnicalFinish | null {
  if (tone === "detailSteel" || tone === "detailHydraulic") return "machined";
  if (tone === "detailPanel" || tone === "detailDark" || tone === "detailElectrical") return "cabinet";
  if (tone === "detailFuel" || tone === "detailAir") return "hoses";
  return null;
}

export const TECHNICAL_RELIEF_SCALE_M = 0.012;
