// Окружение: земля, полоса и облака, которые «пролетают» под самолётом, и фаза полёта.
// Самолёт стоит на месте, движется мир: земля и облака сдвигаются вдоль +x (нос смотрит в −x).
// Масштаб высот условный — на реальных 11 км земли не было бы видно; цель — ощущение движения.

import * as THREE from "three";

export type Phase = "parked" | "takeoff" | "cruise" | "landing";

export interface PhaseSpec {
  label: string;
  /** Выпуск шасси 0…1. */
  gear: number;
  /** Выпуск механизации 0…1 (1 — посадочная конфигурация). */
  flaps: number;
  /** Где земля относительно колёс, м (0 — самолёт стоит на ней). */
  groundDrop: number;
  /** Скорость прокрутки земли и облаков, м/с сцены. */
  groundSpeed: number;
  cloudSpeed: number;
  runway: boolean;
  clouds: number;
}

export const PHASES: Record<Phase, PhaseSpec> = {
  parked: { label: "Стоянка", gear: 1, flaps: 0, groundDrop: 0, groundSpeed: 0, cloudSpeed: 1.5, runway: true, clouds: 0.35 },
  takeoff: { label: "Взлёт", gear: 1, flaps: 0.45, groundDrop: 0.3, groundSpeed: 70, cloudSpeed: 8, runway: true, clouds: 0.35 },
  cruise: { label: "Крейсер", gear: 0, flaps: 0, groundDrop: 140, groundSpeed: 24, cloudSpeed: 60, runway: false, clouds: 1 },
  landing: { label: "Посадка", gear: 1, flaps: 1, groundDrop: 28, groundSpeed: 60, cloudSpeed: 20, runway: true, clouds: 0.6 },
};

interface Colors {
  sky: string;
  field: string[];
  road: string;
  asphalt: string;
  grass: string;
  marking: string;
  cloud: number;
}

const DARK: Colors = {
  sky: "#142230",
  field: ["#1d3326", "#22392a", "#2a3a25", "#1f3130", "#2c3528", "#253a33"],
  road: "#3a4652",
  asphalt: "#2b3238",
  grass: "#1e3326",
  marking: "#c9d3da",
  cloud: 0.32,
};
const LIGHT: Colors = {
  sky: "#e7ecef",
  field: ["#c9d8b4", "#bfd1a5", "#d6dcae", "#b8cfb0", "#cdd6a0", "#c3d5bb"],
  road: "#e9ecee",
  asphalt: "#7c858c",
  grass: "#b9cfa3",
  marking: "#ffffff",
  cloud: 0.75,
};

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** Лоскутное одеяло полей с дорогами — бесшовная плитка. */
function terrainTexture(c: Colors): THREE.CanvasTexture {
  const n = 512;
  const cv = document.createElement("canvas");
  cv.width = cv.height = n;
  const g = cv.getContext("2d")!;
  const r = rng(7);
  g.fillStyle = c.field[0];
  g.fillRect(0, 0, n, n);
  // Поля — прямоугольники, повёрнутые на небольшой угол; рисуем с переносом через края, чтобы плитка была бесшовной.
  for (let i = 0; i < 70; i++) {
    const w = 40 + r() * 140;
    const h = 30 + r() * 110;
    const x = r() * n;
    const y = r() * n;
    g.fillStyle = c.field[Math.floor(r() * c.field.length)];
    for (const dx of [-n, 0, n])
      for (const dy of [-n, 0, n]) {
        g.save();
        g.translate(x + dx, y + dy);
        g.rotate((r() - 0.5) * 0.15);
        g.fillRect(-w / 2, -h / 2, w, h);
        g.restore();
      }
  }
  g.strokeStyle = c.road;
  g.lineWidth = 2;
  for (let i = 0; i < 3; i++) {
    const y = r() * n;
    g.beginPath();
    g.moveTo(0, y);
    g.bezierCurveTo(n * 0.3, y + 40, n * 0.6, y - 40, n, y);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Полоса: асфальт с осевой и краевыми линиями, трава по бокам. Плитка вдоль x. */
function runwayTexture(c: Colors): THREE.CanvasTexture {
  const w = 256;
  const h = 512;
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const g = cv.getContext("2d")!;
  g.fillStyle = c.grass;
  g.fillRect(0, 0, w, h);
  // По высоте текстуры — поперёк полосы (z), по ширине — вдоль (x).
  const top = h * 0.36;
  const bot = h * 0.64;
  g.fillStyle = c.asphalt;
  g.fillRect(0, top, w, bot - top);
  g.fillStyle = c.marking;
  g.fillRect(0, top + 4, w, 3);
  g.fillRect(0, bot - 7, w, 3);
  g.fillRect(w * 0.1, h / 2 - 2, w * 0.45, 4);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Облако — несколько мягких кругов на прозрачном фоне. */
function cloudTexture(): THREE.CanvasTexture {
  const n = 256;
  const cv = document.createElement("canvas");
  cv.width = n;
  cv.height = n / 2;
  const g = cv.getContext("2d")!;
  const r = rng(3);
  for (let i = 0; i < 14; i++) {
    const x = n * (0.2 + r() * 0.6);
    const y = (n / 2) * (0.45 + r() * 0.25);
    const rad = 18 + r() * 34;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, "rgba(255,255,255,0.9)");
    grd.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grd;
    g.beginPath();
    g.arc(x, y, rad, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const SPAN = 1600;

export class Environment {
  readonly group = new THREE.Group();
  private terrain: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private runway: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private clouds: THREE.Sprite[] = [];
  private cloudMat: THREE.SpriteMaterial;
  private phase: PhaseSpec = PHASES.cruise;
  /** Текущие (сглаженные) значения, чтобы смена фазы шла плавно. */
  current = { gear: 0, flaps: 0, drop: PHASES.cruise.groundDrop, speed: 0, cloudSpeed: 0, runway: 0, clouds: 1 };
  private wheelY = 0;
  private explodeDrop = 0;

  private scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    const tGeo = new THREE.PlaneGeometry(SPAN * 2, SPAN * 2);
    tGeo.rotateX(-Math.PI / 2);
    this.terrain = new THREE.Mesh(tGeo, new THREE.MeshBasicMaterial({ fog: true }));
    const rGeo = new THREE.PlaneGeometry(SPAN * 2, 260);
    rGeo.rotateX(-Math.PI / 2);
    this.runway = new THREE.Mesh(rGeo, new THREE.MeshBasicMaterial({ fog: true, transparent: true, depthWrite: false }));
    this.cloudMat = new THREE.SpriteMaterial({ map: cloudTexture(), transparent: true, depthWrite: false, fog: true });
    const r = rng(11);
    for (let i = 0; i < 46; i++) {
      const s = new THREE.Sprite(this.cloudMat);
      const w = 40 + r() * 90;
      s.scale.set(w, w * 0.5, 1);
      // Большинство облаков — ниже самолёта, несколько — на уровне и выше.
      const layer = r() < 0.75 ? -(30 + r() * 70) : 12 + r() * 40;
      s.position.set((r() - 0.5) * SPAN, layer, (r() - 0.5) * 900);
      s.userData.baseY = layer;
      this.clouds.push(s);
      this.group.add(s);
    }
    this.group.add(this.terrain, this.runway);
    scene.add(this.group);
  }

  setTheme(dark: boolean): void {
    const c = dark ? DARK : LIGHT;
    this.terrain.material.map?.dispose();
    this.runway.material.map?.dispose();
    const tt = terrainTexture(c);
    tt.repeat.set(16, 16);
    this.terrain.material.map = tt;
    this.terrain.material.needsUpdate = true;
    const rt = runwayTexture(c);
    rt.repeat.set(30, 1);
    this.runway.material.map = rt;
    this.runway.material.needsUpdate = true;
    this.baseCloud = c.cloud;
    this.scene.fog = new THREE.Fog(new THREE.Color(c.sky), 180, 900);
  }

  setPhase(p: Phase): void {
    this.phase = PHASES[p];
  }

  /** Уровень колёс модели и смещение при разборе (детали «падают» вниз). */
  setGround(wheelY: number, explodeDrop: number): void {
    this.wheelY = wheelY;
    this.explodeDrop = explodeDrop;
  }

  update(dt: number, motion: boolean): void {
    const p = this.phase;
    const k = 1 - Math.exp(-dt * 2.2);
    const c = this.current;
    c.gear += (p.gear - c.gear) * k;
    c.flaps += (p.flaps - c.flaps) * k;
    c.drop += (p.groundDrop - c.drop) * k;
    c.speed += ((motion ? p.groundSpeed : 0) - c.speed) * k;
    c.cloudSpeed += ((motion ? p.cloudSpeed : 0) - c.cloudSpeed) * k;
    c.runway += ((p.runway ? 1 : 0) - c.runway) * k;
    c.clouds += (p.clouds - c.clouds) * k;

    const y = this.wheelY - c.drop - this.explodeDrop;
    this.terrain.position.y = y - 0.05;
    this.runway.position.y = y;
    this.runway.material.opacity = c.runway;
    this.runway.visible = c.runway > 0.02;
    const tm = this.terrain.material.map;
    if (tm) tm.offset.x -= (c.speed * dt) / ((SPAN * 2) / tm.repeat.x);
    const rm = this.runway.material.map;
    if (rm) rm.offset.x -= (c.speed * dt) / ((SPAN * 2) / rm.repeat.x);
    for (const s of this.clouds) {
      s.position.x += c.cloudSpeed * dt;
      if (s.position.x > SPAN / 2) s.position.x -= SPAN;
      // Облака держатся относительно самолёта; у земли слой прижимается.
      s.position.y = (s.userData.baseY as number) * Math.max(0.2, Math.min(1, c.drop / 140)) + 2;
      s.visible = s.position.y > y + 4;
    }
    this.cloudMat.opacity = this.baseCloud * c.clouds;
  }

  private baseCloud = DARK.cloud;
}
