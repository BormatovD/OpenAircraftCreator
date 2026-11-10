import "./style.css";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { A319CEO, A319NEO, A321CEO, A321NEO } from "../src/aircraft/a320family.ts";
import { A320CEO, A320NEO } from "../src/aircraft/a320.ts";
import { B737_8 } from "../src/aircraft/b737max.ts";
import { contextFor } from "../src/aircraft/contextFor.ts";
import { type ConstraintResult } from "../src/constraints.ts";
import { type AircraftDefinition } from "../src/definition.ts";
import { DEFAULT_MISSION, type Evaluation, evaluate } from "../src/evaluate.ts";
import { type MassNode, NODES } from "../src/mass/massTree.ts";
import { designMissionOf, redesign } from "../src/redesign.ts";
import { engineCycle, tsfcFactor } from "../src/propulsion.ts";
import { renderMethod } from "./method.ts";
import { engineDiagram } from "./engineDiagram.ts";
import { coreRadiusFor, lptStagesFor } from "./scene/shapes.ts";
import { scenarioFamily, CONTROLS, type Control, type Mode, SCENARIOS, type Values, defaults, isChanged, leversFor } from "./controls.ts";
import { type AircraftModel, type Family, FAMILY, buildAircraft, partCenter } from "./scene/aircraft.ts";
import { Environment, PHASES, type Phase } from "./scene/environment.ts";
import { LIVERIES, NO_LIVERY, PLAIN_FIN, finLiveryTexture, liveryById } from "./scene/livery.ts";
import { fuselageTexture, htailTexture, wingTexture } from "./scene/textures.ts";

const AIRCRAFT: Record<string, AircraftDefinition> = {
  a319ceo: A319CEO,
  a319neo: A319NEO,
  a320ceo: A320CEO,
  a320neo: A320NEO,
  a321ceo: A321CEO,
  a321neo: A321NEO,
  "b737-8": B737_8,
};
const AIRCRAFT_LABEL: Record<string, string> = {
  a319ceo: "A319ceo",
  a319neo: "A319neo",
  a320ceo: "A320ceo",
  a320neo: "A320neo",
  a321ceo: "A321ceo",
  a321neo: "A321neo",
  "b737-8": "737-8",
};
/** id = тип + поколение: a321neo, b737-8. У 737 одно поколение — переключатель ceo/neo для него неактивен. */
const typeOf = (id: string) => (id.startsWith("b737") ? "b737" : id.slice(0, 4));
const genOf = (id: string) => id.slice(typeOf(id).length);
const gensOf = (type: string) => Object.keys(AIRCRAFT).filter((k) => typeOf(k) === type).map(genOf);
const FAMILY_LABEL: Record<Family, string> = {
  structure: "Конструкция",
  propulsion: "Силовая установка",
  systems: "Бортовые системы",
  cabin: "Салон и эксплуатант",
};
const FAMILY_ORDER: Family[] = ["structure", "propulsion", "systems", "cabin"];
/** Какие агрегаты подкрашивать, если ограничение не выполнено. */
const CONSTRAINT_PARTS: Record<string, string[]> = {
  "nacelle-clearance": ["nacelles", "engines"],
  "span-code": ["wingtips", "wing.box"],
  "tail-strike": ["gear.main"],
  "bpr-range": ["engines"],
  mzfw: ["furnishings"],
  "thrust-ceiling": ["engines"],
  "oei-climb": ["engines"],
  "takeoff-field": ["engines", "wing.highLift"],
  "approach-speed": ["wing.highLift"],
};
/** Цвета огней (AC 2-10-0): левый навигационный — красный, правый — зелёный, проблесковые — белые, маяки — красные. */
const LIGHTS: Record<string, string> = {
  "nav-red": "#ff2a2a",
  "nav-green": "#22ff66",
  strobe: "#ffffff",
  beacon: "#ff3b2a",
  landing: "#fff6d8",
};
const COMPOSITE_PARTS: Record<string, string> = { compositeBox: "wing.box", compositeHighLift: "wing.highLift" };

const state = {
  aircraftId: "a320ceo",
  mode: "fixed" as Mode,
  values: defaults(A320CEO),
  scenarioId: null as string | null,
  explode: 0,
  phase: "cruise" as Phase,
  /** Агрегаты, на которые сейчас указывает рычаг (наведение или перетаскивание), — остальные становятся «стеклом». */
  focus: null as Set<string> | null,
  selected: null as string | null,
  hovered: null as string | null,
  busy: false,
  spin: true,
  livery: NO_LIVERY as string,
  /** Нижняя панель: открыта ли и какая вкладка — группа рычагов или «Об агрегате». */
  drawerOpen: false,
  drawerTab: "" as string,
  rightTab: "pr" as string,
};
/** Разбор выбранного агрегата (0…1) — анимируется отдельно от общего ползунка. */
let selK = 0;
let selPart: string | null = null;
const ABOUT_TAB = "about";

/** Постоянные выноски — только у агрегатов тяжелее этой доли OEW; остальные — при наведении или изменении. */
const ALWAYS_LABEL_SHARE = 0.02;

const nf = (v: number, digits = 0) => v.toLocaleString("ru-RU", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const fmtKg = (kg: number) => `${nf(Math.round(kg))} кг`;
const fmtDeltaKg = (d: number) => (Math.abs(d) < 0.5 ? "" : `${d > 0 ? "+" : "−"}${nf(Math.abs(Math.round(d)))}`);
const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ——— Расчёт ———
const baseCache = new Map<string, Evaluation>();
function baseOf(id: string): Evaluation {
  let e = baseCache.get(id);
  if (!e) {
    e = evaluate(AIRCRAFT[id], [], contextFor(AIRCRAFT[id]));
    baseCache.set(id, e);
  }
  return e;
}

interface Result {
  ev: Evaluation;
  base: Evaluation;
  redesign?: { converged: boolean; iterations: number; designRangeNm: number };
}
let result: Result;

function compute(): Result {
  const def = AIRCRAFT[state.aircraftId];
  const base = baseOf(state.aircraftId);
  const levers = leversFor(def, state.values);
  const fixed = evaluate(def, levers, contextFor(def));
  if (state.mode === "fixed") return { ev: fixed, base };
  const mission = { ...designMissionOf(base), payloadKg: fixed.seats * DEFAULT_MISSION.massPerPaxKg };
  const rs = redesign(def, levers, contextFor(def), mission);
  return { ev: rs.evaluation, base, redesign: { converged: rs.converged, iterations: rs.iterations, designRangeNm: mission.rangeNm } };
}

let pending = 0;
let frame = 0;
/** Режим «та же геометрия» считается за кадр; перепроектирование (~0,4 с) — после паузы в движении ползунка. */
function schedule(): void {
  cancelAnimationFrame(frame);
  clearTimeout(pending);
  if (state.mode === "fixed") {
    frame = requestAnimationFrame(run);
  } else {
    state.busy = true;
    document.body.classList.add("busy");
    pending = window.setTimeout(run, 160);
  }
}
const timing = { compute: 0, scene: 0, panels: 0 };
function run(): void {
  let t = performance.now();
  result = compute();
  timing.compute = performance.now() - t;
  t = performance.now();
  state.busy = false;
  document.body.classList.remove("busy");
  buildScene();
  timing.scene = performance.now() - t;
  t = performance.now();
  renderMetrics();
  renderPayloadRange();
  renderDrag();
  renderThrust();
  renderTakeoffLanding();
  renderConstraints();
  renderLevers();
  timing.panels = performance.now() - t;
}

// ——— Сцена ———
const viewport = $("viewport");
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
viewport.appendChild(renderer.domElement);
const labelRenderer = new CSS2DRenderer();
labelRenderer.domElement.style.position = "absolute";
labelRenderer.domElement.style.inset = "0";
labelRenderer.domElement.style.pointerEvents = "none";
viewport.appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, 1, 0.5, 2500);
camera.position.set(-42, 16, 56);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(18, -1.5, 0);
controls.enableDamping = !reduceMotion;
controls.update();

scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(-20, 40, 25);
scene.add(sun);

const env = new Environment(scene);
env.setPhase(state.phase);
let model: AircraftModel | null = null;
const callouts = new Map<string, { el: HTMLDivElement; obj: CSS2DObject; line: THREE.Line; want?: boolean; priority?: number }>();
/** Подкраска агрегата: композит или нарушенное ограничение. */
const tint = new Map<string, "composite" | "warn" | "bad">();

function materialFor(family: Family, ghost: boolean, t?: "composite" | "warn" | "bad"): THREE.MeshStandardMaterial {
  const composite = t === "composite";
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(css(composite ? "--composite" : `--${family}`)),
    roughness: composite ? 0.4 : family === "structure" ? 0.55 : 0.7,
    metalness: composite ? 0.15 : family === "structure" ? 0.35 : 0.1,
    transparent: ghost,
    opacity: ghost ? 0.32 : 1,
    depthWrite: !ghost,
    side: THREE.DoubleSide,
    emissive: new THREE.Color(0x000000),
  });
}

function edgeMaterial(): THREE.LineBasicMaterial {
  const c = new THREE.Color();
  const raw = css("--edge");
  const m = raw.match(/rgba?\(([^)]+)\)/);
  let opacity = 0.35;
  if (m) {
    const [r, g, b, a] = m[1].split(",").map((x) => parseFloat(x));
    c.setRGB(r / 255, g / 255, b / 255);
    opacity = a ?? 1;
  } else if (/^#[0-9a-f]{8}$/i.test(raw)) {
    // Сборщик может переписать rgba() в #rrggbbaa.
    c.set(raw.slice(0, 7));
    opacity = parseInt(raw.slice(7, 9), 16) / 255;
  } else c.set(raw);
  return new THREE.LineBasicMaterial({ color: c, transparent: true, opacity });
}

function changedParts(): Set<string> {
  const def = AIRCRAFT[state.aircraftId];
  const out = new Set<string>();
  for (const c of CONTROLS) if (isChanged(c, def, state.values[c.id])) c.parts.forEach((p) => out.add(p));
  // Перепроектирование меняет всё, что масштабируется под MTOW.
  if (state.mode === "redesign" && result.ev.definition.weights.mtowKg !== AIRCRAFT[state.aircraftId].weights.mtowKg)
    ["wing.box", "wing.highLift", "htail", "vtail", "engines", "nacelles"].forEach((p) => out.add(p));
  return out;
}

/** Освобождает видеопамять старой модели — при движении ползунка сцена пересобирается десятки раз. */
function disposeModel(m: AircraftModel): void {
  m.root.traverse((o) => {
    if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments || o instanceof THREE.Line) {
      o.geometry.dispose();
      const mat = o.material as THREE.Material | THREE.Material[];
      for (const x of Array.isArray(mat) ? mat : [mat]) {
        const map = (x as THREE.MeshStandardMaterial).map;
        if (map && !map.userData.cached) map.dispose();
        x.dispose();
      }
    }
  });
}

function buildScene(): void {
  if (model) {
    scene.remove(model.root);
    disposeModel(model);
  }
  for (const { obj } of callouts.values()) obj.removeFromParent();
  callouts.clear();

  const { ev, base } = result;
  const masses = ev.masses;
  const baseHarness = baseOf("a320ceo").masses.byId.get("electrical.harness")!.kg;
  model = buildAircraft(ev.definition, { harnessShare: masses.byId.get("electrical.harness")!.kg / baseHarness });
  scene.add(model.root);

  tint.clear();
  for (const [ctrl, part] of Object.entries(COMPOSITE_PARTS)) if (state.values[ctrl]) tint.set(part, "composite");
  for (const c of ev.constraints)
    if (c.status !== "ok") for (const p of CONSTRAINT_PARTS[c.id] ?? []) tint.set(p, c.status === "violation" ? "bad" : "warn");

  const edgeMat = edgeMaterial();
  for (const part of model.parts.values()) {
    const mat = materialFor(part.family, !!part.ghost, tint.get(part.id));
    const toned = new Map<string, THREE.MeshStandardMaterial>();
    part.group.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const tone = o.userData.tone as string | null;
      // Детали двигателя красятся по валам: НД, ВД, камера сгорания; кожух — цветом группы.
      if (tone === "casing") {
        if (!toned.has(tone)) {
          const m = mat.clone();
          m.transparent = true;
          m.opacity = 0.45;
          m.depthWrite = false;
          toned.set(tone, m);
        }
        o.material = toned.get(tone)!;
      } else if (tone) {
        if (!toned.has(tone)) {
          const m = mat.clone();
          const light = LIGHTS[tone];
          m.color = new THREE.Color(light ?? css(`--${tone}`));
          if (tone === "hot") m.emissive = new THREE.Color(css("--hot"));
          if (light) {
            m.emissive = new THREE.Color(light);
            m.emissiveIntensity = 1;
            m.map = null;
          }
          if (tone === "glass") {
            m.roughness = 0.15;
            m.metalness = 0.6;
          }
          toned.set(tone, m);
        }
        o.material = toned.get(tone)!;
      } else o.material = mat;
    });
    // Детали из чертежей AC — текстурами поверх формы.
    const detail: Record<string, () => THREE.Texture> = {
      fuselage: () => cachedTexture(`fus|${ev.definition.shapeSet ?? "a320"}|${ev.definition.fuselage.lengthM}|none`, () => fuselageTexture(ev.definition)),
      "wing.box": () => cachedTexture(`wing|${ev.definition.shapeSet ?? "a320"}`, wingTexture),
      "wing.highLift": () => cachedTexture(`wing|${ev.definition.shapeSet ?? "a320"}`, wingTexture),
      htail: () => cachedTexture(`htail|${ev.definition.shapeSet ?? "a320"}`, htailTexture),
      vtail: () => cachedTexture(`fin|${ev.definition.shapeSet ?? "a320"}|${ev.definition.vtail.areaM2}|${ev.definition.vtail.spanM}|plain`, () => finLiveryTexture(PLAIN_FIN, model!.finXY)),
    };
    if (detail[part.id]) {
      const tex = detail[part.id]();
      part.group.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          const m = o.material as THREE.MeshStandardMaterial;
          if (!m.map && !o.userData.tone) {
            m.map = tex;
            m.needsUpdate = true;
          }
        }
      });
    }
    // Исходная прозрачность — чтобы режим «стекла» можно было снять.
    part.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        const m = o.material as THREE.MeshStandardMaterial;
        if (!m.userData.base) m.userData.base = { opacity: m.opacity, transparent: m.transparent, depthWrite: m.depthWrite };
      }
    });
    const node = masses.byId.get(part.id);
    if (!node || node.kg < 1) continue;
    const center = partCenter(part);
    const labelPos = center.clone().add(part.labelOffset);
    const el = document.createElement("div");
    el.className = "callout";
    el.style.setProperty("--fam", css(`--${part.family}`));
    const d = fmtDeltaKg(node.kg - (base.masses.byId.get(part.id)?.kg ?? node.kg));
    el.innerHTML = `<b>${node.label}</b><span>${fmtKg(node.kg)}${d ? ` <em class="${d.startsWith("−") ? "good" : "bad"}">${d}</em>` : ""}${node.ata ? `   ATA ${node.ata}` : ""}</span>`;
    el.addEventListener("click", (ev) => {
      ev.stopPropagation();
      select(part.id);
    });
    const obj = new CSS2DObject(el);
    obj.position.copy(labelPos);
    part.group.add(obj);
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([center, labelPos]), edgeMat);
    part.group.add(line);
    callouts.set(part.id, { el, obj, line });
  }

  applySelection();
  renderTree();
  // Контурные линии — самая дорогая часть сборки сцены; пока тянут ползунок, их не строим.
  clearTimeout(edgesTimer);
  const built = model;
  edgesTimer = window.setTimeout(() => addEdges(built, edgeMat), 220);
}

let edgesTimer = 0;
function addEdges(m: AircraftModel, mat: THREE.LineBasicMaterial): void {
  if (m !== model) return;
  for (const part of m.parts.values()) {
    // Фюзеляж гладкий — контурные линии на стыках таблицы дают ложные «кольца»; кресла и жгуты — слишком мелкие.
    if (part.id === "furnishings" || part.id === "electrical.harness" || part.id === "fuselage") continue;
    for (const o of part.group.children) {
      if (!(o instanceof THREE.Mesh)) continue;
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(o.geometry, 28), mat);
      edges.userData.isEdge = true;
      edges.userData.baseMat = mat;
      o.add(edges);
    }
  }
  paintEdges();
}

/** Выбранный агрегат обводится контуром цвета акцента — окраска и цвета деталей остаются как есть. */
const selectEdgeMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.6, depthTest: true });
function paintEdges(): void {
  if (!model) return;
  selectEdgeMat.color.set(css("--accent"));
  for (const part of model.parts.values()) {
    const on = part.id === state.selected || !!state.focus?.has(part.id);
    part.group.traverse((o) => {
      if (o instanceof THREE.LineSegments && o.userData.isEdge) o.material = on ? selectEdgeMat : (o.userData.baseMat as THREE.Material);
    });
  }
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * Положение каждой детали: разбор (k), выпуск механизации и уборка шасси по фазе полёта.
 * Вызывается каждый кадр — фаза меняется плавно.
 */
function pose(): void {
  if (!model) return;
  const k = ease(state.explode);
  const gearUp = (1 - env.current.gear) * (1 - k);
  const flaps = env.current.flaps;
  for (const part of model.parts.values()) {
    // Выбранный агрегат раскладывается сам, даже когда самолёт собран.
    const kp = part.id === selPart ? Math.max(k, ease(selK)) : k;
    part.group.position.copy(part.explode).multiplyScalar(kp);
    for (const o of part.group.children) {
      if (!(o instanceof THREE.Mesh)) continue;
      const off = o.userData.offset as THREE.Vector3 | null;
      const b = o.userData.basePos as THREE.Vector3 | null;
      const d = o.userData.deploy as THREE.Vector3 | null;
      o.position.set(
        (b?.x ?? 0) + (off?.x ?? 0) * kp + (d?.x ?? 0) * flaps,
        (b?.y ?? 0) + (off?.y ?? 0) * kp + (d?.y ?? 0) * flaps,
        (b?.z ?? 0) + (o.userData.side ?? 0) * part.sideSpread * kp + (off?.z ?? 0) * kp,
      );
      // Механизация: выдвижение и поворот вокруг шарнира. Взлёт (≈0,45) — закрылки ≈10–15°, предкрылки ≈18°;
      // посадка — 40° и 27°. Каретка выдвигается быстрее, чем растёт угол (так устроен Фаулер).
      const h = o.userData.hinge as { kind: "flap" | "slat"; pivot: THREE.Vector3; axis: THREE.Vector3; angle: number; slide: THREE.Vector3 } | null;
      if (h) {
        const f = flaps * (1 - kp);
        const ang = h.angle * (h.kind === "flap" ? Math.pow(f, 1.6) : Math.sqrt(f));
        const sl = h.kind === "flap" ? Math.pow(f, 0.6) : Math.sqrt(f);
        o.quaternion.setFromAxisAngle(h.axis, ang);
        const rotated = h.pivot.clone().applyQuaternion(o.quaternion);
        o.position.add(h.pivot).sub(rotated).addScaledVector(h.slide, sl);
      }
      // Подкосы складываются при уборке — в модели их просто убираем, пока стойка не выпущена.
      if (o.userData.hideRetracted) o.visible = gearUp < 0.08;
      const r = o.userData.retract as { axis: "x" | "z"; angle: number } | null;
      if (r) {
        o.rotation[r.axis] = r.angle * gearUp;
        // Передняя стойка у A320 закрывается створками полностью — в убранном положении её не видно.
        if (r.axis === "z") o.visible = gearUp < 0.97;
      }
    }
  }
  env.setGround(model.groundY, 11 * k);
}

/** Наружные системные агрегаты (ПОС на передней кромке) в собранном виде окрашены как обшивка — цвета групп
 * показываются в разборе, при выборе и в «рентгене». */
const NATURAL_WHEN_ASSEMBLED = ["antiIce", "flightControls"];
// ——— Окраска ———
const textureCache = new Map<string, THREE.Texture>();
function cachedTexture(key: string, make: () => THREE.Texture): THREE.Texture {
  let t = textureCache.get(key);
  if (!t) {
    t = make();
    t.userData.cached = true;
    textureCache.set(key, t);
    // Кеш небольшой: окраски × длины фюзеляжа; старые записи вытесняем.
    if (textureCache.size > 24) {
      const first = textureCache.keys().next().value!;
      textureCache.get(first)!.dispose();
      textureCache.delete(first);
    }
  }
  return t;
}

/**
 * В собранном виде (без разбора, выбора и «рентгена») самолёт показан в окраске; в остальных режимах —
 * цветами групп масс, чтобы читалась раскладка.
 */
function applyLivery(natural: boolean): void {
  if (!model || !result) return;
  const l = natural ? liveryById(state.livery) : null;
  const def = result.ev.definition;
  const L = def.fuselage.lengthM;
  const paint = (id: string, color: string | null, map?: THREE.Texture) => {
    const p = model!.parts.get(id);
    if (!p) return;
    p.group.traverse((o) => {
      // Полупрозрачный кожух двигателя — тоже в цвет окраски гондолы.
      if (!(o instanceof THREE.Mesh) || (o.userData.tone && o.userData.tone !== "casing")) return;
      const m = o.material as THREE.MeshStandardMaterial;
      m.color.set(color ?? css(`--${p.family}`));
      if (o.userData.tone === "casing") return;
      if (map !== undefined && m.map !== map) {
        m.map = map;
        m.needsUpdate = true;
      }
    });
  };
  if (l) {
    paint("fuselage", "#ffffff", cachedTexture(`fus|${def.shapeSet ?? "a320"}|${L}|${l.id}|${def.shortName}`, () => fuselageTexture(def, l)));
    const fin = model.finXY;
    paint("vtail", "#ffffff", cachedTexture(`fin|${def.shapeSet ?? "a320"}|${def.vtail.areaM2}|${def.vtail.spanM}|${l.id}`, () => finLiveryTexture(l, fin)));
    paint("nacelles", l.nacelle);
    paint("wingtips", l.fin[1]);
    for (const id of ["wing.box", "wing.highLift", "htail"]) paint(id, l.wing);
  } else {
    paint("fuselage", null, cachedTexture(`fus|${def.shapeSet ?? "a320"}|${L}|none`, () => fuselageTexture(def)));
    paint("vtail", null, cachedTexture(`fin|${def.shapeSet ?? "a320"}|${def.vtail.areaM2}|${def.vtail.spanM}|plain`, () => finLiveryTexture(PLAIN_FIN, model!.finXY)));
    for (const id of ["nacelles", "wingtips", "wing.box", "wing.highLift", "htail"]) paint(id, null);
  }
}

function applyNaturalColors(): void {
  if (!model) return;
  const natural = state.explode < 0.12 && !state.focus;
  // Окраска остаётся в разборе и при выборе агрегата; цвета групп — только в «рентгене».
  applyLivery(!state.focus);
  for (const id of NATURAL_WHEN_ASSEMBLED) {
    const p = model.parts.get(id);
    if (!p) continue;
    const c = new THREE.Color(css(natural ? "--structure" : `--${p.family}`));
    p.group.traverse((o) => {
      if (o instanceof THREE.Mesh && !o.userData.tone) (o.material as THREE.MeshStandardMaterial).color.copy(c);
    });
  }
}

function applyExplode(): void {
  if (!model) return;
  pose();
  applyNaturalColors();
  const changed = changedParts();
  const masses = result.ev.masses;
  for (const [id, c] of callouts) {
    const node = masses.byId.get(id)!;
    const major = node.kg / masses.oewKg >= ALWAYS_LABEL_SHARE;
    const show = (state.explode > 0.25 && (major || changed.has(id))) || id === state.selected || id === state.hovered;
    c.want = show;
    // Приоритет при наложении: выбранный и наведённый, затем изменённые рычагами, затем по массе.
    c.priority = (id === state.selected || id === state.hovered ? 1e9 : 0) + (changed.has(id) ? 1e7 : 0) + node.kg;
    c.obj.visible = show;
    c.line.visible = show;
    c.el.classList.toggle("changed", changed.has(id));
  }
}

/**
 * Выноски не должны перекрываться: раз в ~150 мс проходим по видимым от важных к менее важным и прячем
 * те, что накладываются на уже показанные (они появятся при наведении на агрегат).
 */
let declutterAt = 0;
function declutter(now: number): void {
  if (now - declutterAt < 150) return;
  declutterAt = now;
  const placed: DOMRect[] = [];
  const list = [...callouts.values()].filter((c) => c.want).sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  for (const c of list) {
    // Прячем через visibility: элемент остаётся в раскладке, и его прямоугольник можно мерить каждый проход.
    const r = c.el.getBoundingClientRect();
    const pad = 4;
    const hit = r.width > 0 && placed.some((p) => r.left < p.right + pad && r.right + pad > p.left && r.top < p.bottom + pad && r.bottom + pad > p.top);
    const keep = !hit || (c.priority ?? 0) >= 1e9;
    c.el.classList.toggle("clutter", !keep);
    c.line.visible = keep;
    if (keep && r.width > 0) placed.push(r);
  }
}

function applySelection(): void {
  if (!model) return;
  const accent = new THREE.Color(css("--accent"));
  const warn = new THREE.Color(css("--warn"));
  const bad = new THREE.Color(css("--bad"));
  const focus = state.focus;
  for (const part of model.parts.values()) {
    const on = part.id === state.selected || !!focus?.has(part.id);
    const t = tint.get(part.id);
    const glass = !!focus && !focus.has(part.id);
    part.group.traverse((o) => {
      if (o instanceof THREE.LineSegments && o.userData.isEdge) o.visible = !glass;
      if (o instanceof THREE.Mesh && !o.userData.isEdge) {
        const m = o.material as THREE.MeshStandardMaterial;
        const base = m.userData.base as { opacity: number; transparent: boolean; depthWrite: boolean } | undefined;
        if (base) {
          m.transparent = glass || base.transparent;
          m.opacity = glass ? Math.min(base.opacity, 0.09) : base.opacity;
          m.depthWrite = glass ? false : base.depthWrite;
        }
        if (on) {
          // Лёгкое свечение акцентом поверх собственного цвета детали; основное выделение — контур.
          m.emissive.copy(accent);
          m.emissiveIntensity = 0.07;
        } else if (t === "warn" || t === "bad") {
          m.emissive.copy(t === "bad" ? bad : warn);
          m.emissiveIntensity = 0.4;
        } else if (LIGHTS[o.userData.tone as string]) {
          // Огни — своим цветом; яркость ведёт анимация.
          m.emissive.set(LIGHTS[o.userData.tone as string]);
        } else if (o.userData.tone === "hot") {
          m.emissive.set(css("--hot"));
          m.emissiveIntensity = 0.5;
        } else {
          m.emissive.setRGB(0, 0, 0);
          m.emissiveIntensity = 0;
        }
      }
    });
  }
  for (const [id, c] of callouts) {
    c.el.classList.toggle("selected", id === state.selected || !!focus?.has(id));
    c.el.classList.toggle("dim", (state.selected !== null && id !== state.selected) || (!!focus && !focus.has(id)));
  }
  paintEdges();
  markLinkedLevers();
  for (const b of document.querySelectorAll<HTMLButtonElement>(".tree button")) b.setAttribute("aria-pressed", String(b.dataset.id === state.selected));
  if (state.drawerTab === ABOUT_TAB) renderDetail();
  applyExplode();
}

function select(id: string | null): void {
  state.selected = state.selected === id ? null : id;
  if (state.selected) {
    // Агрегат раскладывается, камера переводит взгляд на него, снизу открываются его рычаги.
    if (selPart !== state.selected) selK = 0;
    selPart = state.selected;
    const groups = linkedGroups(state.selected);
    state.drawerOpen = true;
    state.drawerTab = groups[0] ?? ABOUT_TAB;
  } else state.drawerOpen = false;
  aimCamera();
  applySelection();
  renderLevers();
}

/** Плавный перевод точки обзора: на выбранный агрегат в разобранном виде или обратно на самолёт. */
const HOME_TARGET = new THREE.Vector3(18, -1.5, 0);
let aim: { from: THREE.Vector3; to: THREE.Vector3; t: number } | null = null;
function aimCamera(): void {
  let to = HOME_TARGET.clone();
  if (state.selected && model) {
    const part = model.parts.get(state.selected);
    if (part) to = partCenter(part).add(part.explode);
  }
  aim = { from: controls.target.clone(), to, t: 0 };
}
/** Открытая нижняя панель закрывает низ сцены — центр изображения поднимается на половину её высоты. */
let viewShift = 0;
function shiftView(dt: number): void {
  const d = $("drawer");
  const want = state.drawerOpen && getComputedStyle(d).position === "absolute" ? d.offsetHeight / 2 : 0;
  const next = reduceMotion ? want : viewShift + (want - viewShift) * Math.min(1, dt * 8);
  if (Math.abs(next - viewShift) < 0.3 && Math.abs(want - next) < 0.3 && viewShift === want) return;
  viewShift = Math.abs(want - next) < 0.3 ? want : next;
  const { clientWidth: w, clientHeight: h } = viewport;
  if (viewShift > 0.5) camera.setViewOffset(w, h, 0, viewShift, w, h);
  else camera.clearViewOffset();
  camera.updateProjectionMatrix();
}
function stepCamera(dt: number): void {
  shiftView(dt);
  // Разбор выбранного агрегата: 0,6 с туда и обратно.
  const want = state.selected ? 1 : 0;
  const was = selK;
  selK = reduceMotion ? want : Math.max(0, Math.min(1, selK + Math.sign(want - selK) * dt / 0.6));
  if (selK === 0 && !state.selected) selPart = null;
  if (was !== selK) applyExplode();
  if (!aim) return;
  aim.t = reduceMotion ? 1 : Math.min(1, aim.t + dt / 0.7);
  const p = aim.from.clone().lerp(aim.to, ease(aim.t));
  // Камера смещается вместе с точкой обзора — ракурс и расстояние сохраняются.
  camera.position.add(p.clone().sub(controls.target));
  controls.target.copy(p);
  if (aim.t >= 1) aim = null;
}

/** Рычаги, которые действуют на выбранный агрегат. */
function linkedControls(id: string | null): Control[] {
  return id ? CONTROLS.filter((c) => c.parts.includes(id)) : [];
}
/** Группы рычагов агрегата — вкладки нижней панели. */
function linkedGroups(id: string | null): string[] {
  return [...new Set(linkedControls(id).map((c) => c.group))];
}
function markLinkedLevers(): void {
  const ids = new Set(linkedControls(state.selected).map((c) => c.id));
  for (const row of document.querySelectorAll<HTMLElement>(".lever[data-row]")) row.classList.toggle("linked", ids.has(row.dataset.row!));
}

/** Наведение на рычаг: его агрегаты светятся, остальные становятся «стеклом» (как рентген в роликах ОДК). */
let focusCtrl: string | null = null;
function setFocusCtrl(id: string | null): void {
  if (id === focusCtrl) return;
  focusCtrl = id;
  const c = CONTROLS.find((x) => x.id === id);
  const parts = c?.focus ?? c?.parts ?? [];
  state.focus = parts.length ? new Set(parts) : null;
  applySelection();
}

// ——— Левая панель: сценарии, режим, рычаги ———
function renderScenarios(): void {
  const box = $("scenarios");
  const fam = scenarioFamily(state.aircraftId);
  box.innerHTML = SCENARIOS.filter((s) => scenarioFamily(s.aircraft) === fam).map(
    (s) => `<button class="chip" data-scenario="${s.id}" aria-pressed="${s.id === state.scenarioId}">${s.title}</button>`,
  ).join("");
  for (const b of box.querySelectorAll<HTMLButtonElement>("button"))
    b.addEventListener("click", () => applyScenario(b.dataset.scenario === state.scenarioId ? null : b.dataset.scenario!));
  const s = SCENARIOS.find((x) => x.id === state.scenarioId);
  const text = $("scenario-text");
  text.textContent = s?.text ?? (fam === "boeing" ? "Сценарии про решения самого 737: что дал бы больший вентилятор, старое крыло, пилон." : "Сценарии — готовые наборы рычагов с объяснением. Нажмите ещё раз, чтобы снять.");
  text.classList.toggle("idle", !s);
  text.title = s ? "Нажмите, чтобы развернуть" : "";
  text.classList.remove("open");
}

$("scenario-text").addEventListener("click", (e) => (e.currentTarget as HTMLElement).classList.toggle("open"));

function applyScenario(id: string | null): void {
  state.scenarioId = id;
  const s = SCENARIOS.find((x) => x.id === id);
  if (s) {
    state.aircraftId = s.aircraft;
    state.mode = s.mode;
    state.values = { ...defaults(AIRCRAFT[s.aircraft]), ...s.values };
  } else {
    state.values = defaults(AIRCRAFT[state.aircraftId]);
  }
  syncHeader();
  renderScenarios();
  schedule();
}

function syncHeader(): void {
  for (const o of document.querySelectorAll<HTMLButtonElement>("[data-aircraft]")) o.setAttribute("aria-checked", String(o.dataset.aircraft === state.aircraftId));
  const nameNow = AIRCRAFT[state.aircraftId].shortName ?? AIRCRAFT_LABEL[state.aircraftId];
  document.querySelector(".brand h1")!.textContent = `${nameNow} в разборе`;
  document.title = `${nameNow} в разборе`;
  const type = typeOf(state.aircraftId);
  for (const o of document.querySelectorAll<HTMLButtonElement>("[data-type]")) o.setAttribute("aria-checked", String(o.dataset.type === type));
  for (const o of document.querySelectorAll<HTMLButtonElement>("[data-gen]")) {
    o.setAttribute("aria-checked", String(genOf(state.aircraftId) === o.dataset.gen));
    o.disabled = !gensOf(type).includes(o.dataset.gen!);
  }
  for (const o of document.querySelectorAll<HTMLButtonElement>("[data-mode]")) o.setAttribute("aria-checked", String(o.dataset.mode === state.mode));
}

function controlRow(c: Control, def: AircraftDefinition): string {
  const v = state.values[c.id];
  const changed = isChanged(c, def, v);
  if (c.kind === "toggle")
    return `<label class="lever toggle${changed ? " changed" : ""}" data-row="${c.id}">
      <input type="checkbox" data-ctrl="${c.id}" ${v ? "checked" : ""} />
      <span class="lever-text"><span class="lever-label">${c.label}</span><span class="lever-hint">${c.hint}</span></span>
    </label>`;
  const baseV = c.base(def);
  return `<div class="lever range${changed ? " changed" : ""}" data-row="${c.id}">
    <div class="lever-top"><label class="lever-label" for="ctrl-${c.id}">${c.label}</label><output id="out-${c.id}">${c.format(v as number)}</output></div>
    <input id="ctrl-${c.id}" type="range" data-ctrl="${c.id}" min="${c.min}" max="${c.max}" step="${c.step}" value="${v}"
      style="--base:${((baseV - c.min) / (c.max - c.min)) * 100}%" />
    <span class="lever-hint">${c.hint}${changed ? ` · база ${c.format(baseV)}` : ""}</span>
  </div>`;
}

let leversBuilt = "";
/**
 * Нижняя панель. Выбран агрегат — его рычаги по группам и вкладка «Об агрегате»; ничего не выбрано —
 * все рычаги по группам (панель открывается кнопкой «Рычаги»).
 */
function renderLevers(): void {
  const def = AIRCRAFT[state.aircraftId];
  const allGroups = [...new Set(CONTROLS.map((c) => c.group))];
  const sel = state.selected;
  const groups = sel ? linkedGroups(sel) : allGroups;
  const tabs = sel ? [...groups, ABOUT_TAB] : groups;
  if (!tabs.includes(state.drawerTab)) state.drawerTab = tabs[0];
  const drawer = $("drawer");
  drawer.dataset.open = String(state.drawerOpen);
  drawer.dataset.mode = sel ? "part" : "all";
  $("drawer-toggle").setAttribute("aria-expanded", String(state.drawerOpen));
  const anyChanged = CONTROLS.some((c) => isChanged(c, def, state.values[c.id]));
  const nChanged = CONTROLS.filter((c) => isChanged(c, def, state.values[c.id])).length;
  $("drawer-toggle").innerHTML = state.drawerOpen ? "Рычаги ▾" : `Рычаги ▴${nChanged ? ` <span class="badge">${nChanged}</span>` : ""}`;
  ($("reset") as HTMLButtonElement).disabled = !anyChanged;
  const n = sel ? result?.ev.masses.byId.get(sel) : null;
  if (n && result) {
    const d = fmtDeltaKg(n.kg - (result.base.masses.byId.get(n.id)?.kg ?? n.kg));
    $("drawer-title").innerHTML = `<span class="swatch" style="background:var(--${familyOf(n.id)})"></span><b>${n.label}</b>
      <span class="muted">${fmtKg(n.kg)}${d ? ` <em class="${d.startsWith("−") ? "good" : "bad"}">${d}</em>` : ""}${n.ata ? ` · ATA ${n.ata}` : ""}</span>`;
  } else $("drawer-title").innerHTML = state.drawerOpen ? `<b>Все рычаги</b><span class="muted">нажмите на агрегат — останутся только его</span>` : "";
  const changedIn = (g: string) => CONTROLS.some((c) => c.group === g && isChanged(c, def, state.values[c.id]));
  $("drawer-tabs").innerHTML = tabs
    .map(
      (t) =>
        `<button role="tab" data-dtab="${t}" aria-selected="${t === state.drawerTab}">${t === ABOUT_TAB ? "Об агрегате" : t}${t !== ABOUT_TAB && changedIn(t) ? '<i class="dot"></i>' : ""}</button>`,
    )
    .join("");
  for (const b of $("drawer-tabs").querySelectorAll<HTMLButtonElement>("button"))
    b.onclick = () => {
      state.drawerTab = b.dataset.dtab!;
      renderLevers();
    };
  const about = state.drawerTab === ABOUT_TAB;
  $("detail").hidden = !about;
  $("levers").hidden = about;
  if (about) {
    renderDetail();
    return;
  }
  const list = CONTROLS.filter((c) => c.group === state.drawerTab && (!sel || c.parts.includes(sel)));
  const html = list.map((c) => controlRow(c, def)).join("");
  // Пока ползунок тянут, разметку не пересобираем — иначе он потеряет захват.
  const active = document.activeElement as HTMLInputElement | null;
  if (active?.dataset.ctrl && active.type === "range" && leversBuilt === state.drawerTab + "|" + list.map((c) => c.id).join()) {
    for (const c of list) {
      const out = document.getElementById(`out-${c.id}`);
      if (out && c.kind === "range") out.textContent = c.format(state.values[c.id] as number);
    }
    return;
  }
  leversBuilt = state.drawerTab + "|" + list.map((c) => c.id).join();
  const box = $("levers");
  box.innerHTML = html;
  for (const input of box.querySelectorAll<HTMLInputElement>("input[data-ctrl]")) {
    const c = CONTROLS.find((x) => x.id === input.dataset.ctrl)!;
    input.addEventListener(c.kind === "toggle" ? "change" : "input", () => {
      state.values = { ...state.values, [c.id]: c.kind === "toggle" ? input.checked : parseFloat(input.value) };
      if (c.kind === "range") $(`out-${c.id}`).textContent = c.format(state.values[c.id] as number);
      state.scenarioId = null;
      renderScenarios();
      schedule();
    });
    // После отпускания ползунка обновляем подписи «база …».
    if (c.kind === "range") input.addEventListener("change", () => requestAnimationFrame(() => (input.blur(), renderLevers())));
  }
}
$("drawer-toggle").addEventListener("click", () => {
  state.drawerOpen = !state.drawerOpen;
  renderLevers();
});
$("drawer-close").addEventListener("click", () => {
  if (state.selected) select(state.selected);
  else {
    state.drawerOpen = false;
    renderLevers();
  }
});

// ——— Правая панель ———
/** Всплывающая подсказка: одна на страницу, позиция — у значка, прижата к краям окна. */
const tipPop = document.createElement("div");
tipPop.className = "tip-pop";
tipPop.hidden = true;
document.body.append(tipPop);
function showTip(el: HTMLElement): void {
  tipPop.textContent = el.dataset.tip ?? "";
  tipPop.hidden = false;
  const r = el.getBoundingClientRect();
  const w = tipPop.offsetWidth;
  const h = tipPop.offsetHeight;
  const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
  const below = r.bottom + 6 + h < window.innerHeight;
  tipPop.style.left = `${left}px`;
  tipPop.style.top = `${below ? r.bottom + 6 : r.top - h - 6}px`;
}
const hideTip = () => (tipPop.hidden = true);
document.addEventListener("pointerover", (e) => {
  const t = (e.target as HTMLElement).closest?.(".tip") as HTMLElement | null;
  if (t) showTip(t);
});
document.addEventListener("pointerout", (e) => {
  if ((e.target as HTMLElement).closest?.(".tip")) hideTip();
});
document.addEventListener("focusin", (e) => {
  const t = (e.target as HTMLElement).closest?.(".tip") as HTMLElement | null;
  if (t) showTip(t);
});
document.addEventListener("focusout", hideTip);
document.addEventListener("scroll", hideTip, true);

/** Подсказка при наведении (и по фокусу/касанию). */
function tip(text: string): string {
  return `<span class="tip" tabindex="0" role="note" aria-label="${text}" data-tip="${text}">?</span>`;
}

function deltaPct(cur: number, base: number, lowerIsBetter = true, digits = 1): string {
  const p = ((cur - base) / base) * 100;
  if (Math.abs(p) < 0.05) return `<span class="delta zero">как у базы</span>`;
  const good = lowerIsBetter ? p < 0 : p > 0;
  return `<span class="delta ${good ? "good" : "bad"}">${p > 0 ? "+" : "−"}${nf(Math.abs(p), digits)}%</span>`;
}

/** Главные показатели — полоса сверху по центру сцены. */
function renderMetrics(): void {
  const { ev, base, redesign: rd } = result;
  const km = DEFAULT_MISSION.distanceNm * 1.852;
  const scenario = SCENARIOS.find((s) => s.id === state.scenarioId);
  const cmp = scenario?.compareWith ? baseOf(scenario.compareWith) : null;
  const seatsNote = ev.payloadLimitedByMzfw ? `${ev.seatsCarried} из ${ev.seats} мест — упор в MZFW` : `${ev.seats} мест`;
  const name = AIRCRAFT_LABEL[state.aircraftId];
  const same = Math.abs(ev.fuelPerSeatPer100KmKg / base.fuelPerSeatPer100KmKg - 1) < 5e-4;
  const tile = (label: string, value: string, delta: string, note: string) =>
    `<div class="kpi-tile" title="${note}"><div class="kpi-label">${label}</div><div class="kpi-value">${value}</div><div class="kpi-delta">${delta}</div></div>`;
  const bad = ev.constraints.filter((c) => c.status === "violation").length;
  const warn = ev.constraints.filter((c) => c.status === "warning").length;
  $("metrics").innerHTML = `
    <div class="kpi-main" title="Рейс ${nf(Math.round(km))} км, ${seatsNote}">
      <div class="kpi-label">Топливо на место · ${nf(Math.round(km))} км</div>
      <div class="kpi-big">${nf(ev.fuelPerSeatPer100KmKg, 3)}<small> кг/100 км</small></div>
      <div class="kpi-delta">${same ? `как у ${name}` : `${deltaPct(ev.fuelPerSeatPer100KmKg, base.fuelPerSeatPer100KmKg)} к ${name}`} · ${seatsNote}</div>
    </div>
    ${tile("Топливо на рейс", fmtKg(ev.tripFuelKg), deltaPct(ev.tripFuelKg, base.tripFuelKg), "без резервов")}
    ${tile("Пустой снаряжённый", fmtKg(ev.oewKg), deltaPct(ev.oewKg, base.oewKg), "OEW")}
    ${tile("MTOW", fmtKg(ev.definition.weights.mtowKg), deltaPct(ev.definition.weights.mtowKg, base.definition.weights.mtowKg), rd ? "под ту же миссию" : "максимальная взлётная масса")}
    ${tile("Дальность, все места", `${nf(Math.round(ev.rangeWithMissionPayloadNm))} nm`, deltaPct(ev.rangeWithMissionPayloadNm, base.rangeWithMissionPayloadNm, false), `${nf(Math.round(ev.rangeWithMissionPayloadNm * 1.852))} км`)}
    <button class="kpi-tile kpi-limits ${bad ? "bad" : warn ? "warn" : "ok"}" id="kpi-limits" title="Открыть список ограничений">
      <div class="kpi-label">Ограничения</div>
      <div class="kpi-value">${bad ? `✕ ${bad}` : warn ? `! ${warn}` : "✓"}</div>
      <div class="kpi-delta">${bad ? "нарушено" : warn ? "на грани" : "в норме"}</div>
    </button>
    ${cmp ? `<div class="kpi-compare">${AIRCRAFT_LABEL[scenario!.compareWith!]}: ${nf(cmp.fuelPerSeatPer100KmKg, 3)} кг/100 км, OEW ${fmtKg(cmp.oewKg)}</div>` : ""}`;
  $("kpi-limits").onclick = () => setRightTab("constraints");
  const d = result.ev.definition;
  $("mode-hint").innerHTML =
    state.mode === "fixed"
      ? "Геометрия, MTOW и MZFW выбранного самолёта. Меняются массы, расход и дальность."
      : `Самолёт масштабируется под ту же нагрузку и ${nf(Math.round(rd!.designRangeNm))} nm: площадь крыла ${nf(d.wing.areaM2, 1)} м², размах ${nf(d.wing.spanM, 2)} м, тяга ×${nf(d.engine.thrustScale, 3)}.${rd!.converged ? "" : " <b>Итерации не сошлись.</b>"}`;
}

/** Правая панель — вкладки вместо длинной прокрутки. */
function setRightTab(tab: string): void {
  state.rightTab = tab;
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-rtab]")) b.setAttribute("aria-selected", String(b.dataset.rtab === tab));
  for (const p of document.querySelectorAll<HTMLElement>("[data-rpanel]")) p.hidden = p.dataset.rpanel !== tab;
  try {
    localStorage.setItem("oac-rtab", tab);
  } catch {
    /* без сохранения */
  }
}
for (const b of document.querySelectorAll<HTMLButtonElement>("[data-rtab]")) b.addEventListener("click", () => setRightTab(b.dataset.rtab!));
{
  let saved: string | null = null;
  try {
    saved = localStorage.getItem("oac-rtab");
  } catch {
    /* без сохранения */
  }
  setRightTab(saved && document.querySelector(`[data-rtab="${saved}"]`) ? saved : "pr");
}

const DRAG_COLORS: Record<string, string> = {
  wing: "#8fa3b4",
  fuselage: "#6f8597",
  htail: "#a9b8c5",
  vtail: "#c2ced8",
  nacelles: "var(--propulsion)",
  misc: "#56697a",
  induced: "var(--accent)",
  wave: "var(--hot)",
};
/** Раскладка сопротивления: трение и форма по агрегатам, индуктивное и волновое — в каунтах (×10⁴). */
function renderDrag(): void {
  const d = result.ev.cruiseDrag;
  const b = result.base.cruiseDrag;
  const seg = d.parts
    .map((p) => `<span style="flex:${Math.max(0.001, p.counts)};background:${DRAG_COLORS[p.id]}" title="${p.label}: ${nf(p.counts, 1)}"></span>`)
    .join("");
  const rows = d.parts
    .map((p) => {
      const bp = b.parts.find((x) => x.id === p.id)?.counts ?? 0;
      const dd = p.counts - bp;
      return `<li><i style="background:${DRAG_COLORS[p.id]}"></i><span>${p.label}</span><span class="kg">${nf(p.counts, 1)}${
        Math.abs(dd) >= 0.05 ? ` <em class="${dd < 0 ? "good" : "bad"}">${dd > 0 ? "+" : "−"}${nf(Math.abs(dd), 1)}</em>` : ""
      }</span></li>`;
    })
    .join("");
  const cdTip =
    "Коэффициент лобового сопротивления всего самолёта в крейсере. В авиации его удобно считать в «каунтах»: 1 каунт = 0,0001 CD, у A320 это ≈0,35% всего сопротивления. Числа ниже — вклады агрегатов в каунтах.";
  const ldTip =
    "Аэродинамическое качество: во сколько раз подъёмная сила больше сопротивления в середине крейсера. Если рычаг облегчил самолёт, падают и нужная подъёмная сила, и индуктивное сопротивление — качество может не измениться, хотя топлива уходит меньше.";
  $("drag").innerHTML = `
    <div class="drag-head"><span>C<sub>D</sub> <b>${nf(d.total / 1e4, 4)}</b> ${deltaPct(d.total, b.total)}${tip(cdTip)}</span><span>Качество L/D <b>${nf(d.ld, 1)}</b> ${deltaPct(d.ld, b.ld, false)}${tip(ldTip)}</span></div>
    <div class="drag-bar">${seg}</div>
    <ul class="drag-list">${rows}</ul>
    <p class="drag-note">Вклады — в каунтах (0,0001 C<sub>D</sub>). M ${nf(d.mach, 2)}, C<sub>L</sub> ${nf(d.cl, 2)} в середине крейсера на FL350; число Маха, после которого резко растёт волновое сопротивление, — ${nf(d.mdd, 3)}.</p>`;
}

function renderPayloadRange(): void {
  const { ev, base } = result;
  const W = 300;
  const H = 180;
  const P = { l: 34, r: 10, t: 10, b: 28 };
  const maxX = Math.max(...ev.payloadRange.map((p) => p.rangeNm), ...base.payloadRange.map((p) => p.rangeNm)) * 1.05;
  const maxY = (Math.max(...ev.payloadRange.map((p) => p.payloadKg), ...base.payloadRange.map((p) => p.payloadKg)) / 1000) * 1.15;
  const sx = (nm: number) => P.l + (nm / maxX) * (W - P.l - P.r);
  const sy = (t: number) => H - P.b - (t / maxY) * (H - P.t - P.b);
  const pts = (pr: Evaluation["payloadRange"]) => pr.map((p) => `${sx(p.rangeNm).toFixed(1)},${sy(p.payloadKg / 1000).toFixed(1)}`).join(" ");
  const xt: string[] = [];
  for (let x = 0; x <= maxX; x += 1000)
    xt.push(`<line x1="${sx(x)}" x2="${sx(x)}" y1="${P.t}" y2="${H - P.b}" class="grid"/><text x="${sx(x)}" y="${H - P.b + 14}" text-anchor="middle">${nf(x)}</text>`);
  const yt: string[] = [];
  for (let y = 0; y <= maxY; y += 5)
    yt.push(`<line x1="${P.l}" x2="${W - P.r}" y1="${sy(y)}" y2="${sy(y)}" class="grid"/><text x="${P.l - 6}" y="${sy(y) + 4}" text-anchor="end">${y}</text>`);
  const mx = sx(DEFAULT_MISSION.distanceNm);
  const my = sy(ev.payloadKg / 1000);
  $("pr").innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Диаграмма нагрузка — дальность: база и текущий вариант">
      ${xt.join("")}${yt.join("")}
      <polyline points="${pts(base.payloadRange)}" class="pr-base"/>
      <polyline points="${pts(ev.payloadRange)}" class="pr-cur"/>
      <circle cx="${mx}" cy="${my}" r="3.5" class="pr-mission"/>
      <text x="${W - P.r}" y="${H - 4}" text-anchor="end">nm</text>
      <text x="4" y="${P.t + 4}">т</text>
    </svg>
    <div class="pr-legend"><span><i class="k-cur"></i>сейчас</span><span><i class="k-base"></i>${AIRCRAFT_LABEL[state.aircraftId]}</span><span><i class="k-mission"></i>рейс ${nf(Math.round(DEFAULT_MISSION.distanceNm * 1.852))} км</span></div>`;
}

/** Механизация: CLmax по конфигурациям и что из них следует на взлёте и посадке. */
function renderTakeoffLanding(): void {
  const { ev, base } = result;
  const h = ev.highLift;
  const hb = base.highLift;
  const tofl = (e: Evaluation) => parseFloat(e.constraints.find((c) => c.id === "takeoff-field")!.value.replace(/\s/g, ""));
  const row = (label: string, v: string, delta: string, t?: string) => `<tr><th>${label}${t ? tip(t) : ""}</th><td>${v}</td><td>${delta}</td></tr>`;
  const kt = (cur: number, b: number) => (Math.abs(cur - b) < 0.5 ? `<span class="delta zero">как у базы</span>` : `<span class="delta ${cur < b ? "good" : "bad"}">${cur > b ? "+" : "−"}${nf(Math.abs(cur - b), 0)} уз</span>`);
  $("tol").innerHTML = `
    <table class="tol">
      ${row("C<sub>L max</sub> чистое крыло", nf(h.clMaxClean, 2), deltaPct(h.clMaxClean, hb.clMaxClean, false), "Максимальный коэффициент подъёмной силы без механизации. Чем он выше, тем медленнее может лететь самолёт без сваливания.")}
      ${row("C<sub>L max</sub> взлёт", nf(h.clMaxTakeoff, 2), deltaPct(h.clMaxTakeoff, hb.clMaxTakeoff, false), "Взлётная конфигурация (CONF 1+F): предкрылки 18°, закрылки 10°.")}
      ${row("C<sub>L max</sub> посадка", nf(h.clMaxLanding, 2), deltaPct(h.clMaxLanding, hb.clMaxLanding, false), "Посадочная конфигурация (CONF FULL): предкрылки 27°, закрылки 40°. Привязано к A320 по скорости захода 134 уз.")}
      ${row("V2 при MTOW", `${nf(h.v2Kt, 0)} уз`, kt(h.v2Kt, hb.v2Kt), "Безопасная скорость взлёта: 1,13 скорости сваливания во взлётной конфигурации.")}
      ${row("Заход при MLW", `${nf(h.vAppKt, 0)} уз`, kt(h.vAppKt, hb.vAppKt), "1,23 скорости сваливания в посадочной конфигурации. По ней ИКАО делит самолёты на категории: C — до 140 уз.")}
      ${row("ВПП при MTOW", `${nf(tofl(ev))} м`, deltaPct(tofl(ev), tofl(base)))}
      ${row("Набор с отказом двигателя", `${nf(ev.oei.gradient * 100, 1)}%`, `<span class="delta ${ev.oei.gradient >= base.oei.gradient - 1e-4 ? (Math.abs(ev.oei.gradient - base.oei.gradient) < 5e-4 ? "zero" : "good") : "bad"}">${Math.abs(ev.oei.gradient - base.oei.gradient) < 5e-4 ? "как у базы" : `${ev.oei.gradient > base.oei.gradient ? "+" : "−"}${nf(Math.abs(ev.oei.gradient - base.oei.gradient) * 100, 1)} п.п.`}</span>`, "Второй сегмент взлёта: шасси убрано, один двигатель. Норма — не меньше 2,4%. Больше CLmax — ниже V2, но выше индуктивное сопротивление, поэтому мощная механизация градиент слегка снижает.")}
    </table>`;
}

/** Тяга на верху набора: располагаемая (две двигателя, максимальный режим) и потребная по эшелонам. */
function renderThrust(): void {
  const { ev, base } = result;
  const W = 300;
  const H = 190;
  const P = { l: 40, r: 12, t: 10, b: 28 };
  const all = [...ev.thrust.points, ...base.thrust.points].flatMap((p) => [p.availableN, p.requiredN]);
  const minX = Math.floor(Math.min(...all) / 10000) * 10;
  const maxX = Math.ceil(Math.max(...all) / 10000) * 10;
  const fl0 = ev.thrust.points[0].fl;
  const fl1 = ev.thrust.points[ev.thrust.points.length - 1].fl;
  const sx = (kn: number) => P.l + ((kn - minX) / (maxX - minX)) * (W - P.l - P.r);
  const sy = (fl: number) => H - P.b - ((fl - fl0) / (fl1 - fl0)) * (H - P.t - P.b);
  const line = (c: Evaluation["thrust"], key: "availableN" | "requiredN") => c.points.map((p) => `${sx(p[key] / 1000).toFixed(1)},${sy(p.fl).toFixed(1)}`).join(" ");
  const grid: string[] = [];
  for (let x = minX; x <= maxX; x += 10)
    grid.push(`<line x1="${sx(x)}" x2="${sx(x)}" y1="${P.t}" y2="${H - P.b}" class="grid"/><text x="${sx(x)}" y="${H - P.b + 14}" text-anchor="middle">${x}</text>`);
  for (let fl = fl0; fl <= fl1; fl += 40)
    grid.push(`<line x1="${P.l}" x2="${W - P.r}" y1="${sy(fl)}" y2="${sy(fl)}" class="grid"/><text x="${P.l - 6}" y="${sy(fl) + 4}" text-anchor="end">FL${fl}</text>`);
  const ceil = ev.thrust.ceilingFl;
  const cy = sy(Math.min(ceil, fl1));
  $("thrust").innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Располагаемая и потребная тяга по эшелонам на верху набора">
      ${grid.join("")}
      <polyline points="${line(base.thrust, "availableN")}" class="th-base"/>
      <polyline points="${line(base.thrust, "requiredN")}" class="th-base"/>
      <polyline points="${line(ev.thrust, "requiredN")}" class="th-req"/>
      <polyline points="${line(ev.thrust, "availableN")}" class="th-avail"/>
      <line x1="${P.l}" x2="${W - P.r}" y1="${cy}" y2="${cy}" class="th-ceil"/>
      <text x="${W - P.r - 2}" y="${cy - 4}" text-anchor="end" class="th-ceil-t">потолок FL${Math.min(ceil, 398)}</text>
      <text x="${W - P.r}" y="${H - 4}" text-anchor="end">кН</text>
    </svg>
    <div class="pr-legend"><span><i class="k-avail"></i>располагаемая</span><span><i class="k-req"></i>потребная + 300 фут/мин</span><span><i class="k-base"></i>${AIRCRAFT_LABEL[state.aircraftId]}</span></div>
    <p class="drag-note">Масса ${nf(Math.round(ev.thrust.massKg / 100) / 10, 1)} т (MTOW − 2% на набор), M ${nf(ev.thrust.mach, 2)}. Тяга на FL350 — ${nf(
      Math.round((ev.thrust.points.find((p) => p.fl === 350)!.availableN / ev.definition.engine.count / 4.448 / 100)) * 100,
    )} lbf на двигатель, ${nf(Math.round((ev.thrust.points.find((p) => p.fl === 350)!.availableN / (ev.definition.engine.takeoffThrustKn * 1000 * ev.definition.engine.thrustScale * ev.definition.engine.count)) * 100))}% взлётной.</p>`;
}

const STATUS_ICON = { ok: "✓", warning: "!", violation: "✕" } as const;
function renderConstraints(): void {
  const cs: ConstraintResult[] = result.ev.constraints;
  $("constraints").innerHTML = cs
    .map(
      (c) => `<li class="c-${c.status}"><span class="c-icon" aria-hidden="true">${STATUS_ICON[c.status]}</span>
        <div><div class="c-head"><span>${c.label}</span><span class="c-value">${c.value}</span></div>
        <div class="c-msg">${c.message}</div></div></li>`,
    )
    .join("");
}

function familyOf(id: string): Family {
  return FAMILY[id] ?? "systems";
}

function leaves(): MassNode[] {
  return NODES.filter((n) => n.estimate).map((n) => result.ev.masses.byId.get(n.id)!).filter((n) => n.kg > 0.5);
}

function renderTree(): void {
  const masses = result.ev.masses;
  const baseMasses = result.base.masses;
  const byFamily = new Map<Family, number>();
  for (const n of leaves()) byFamily.set(familyOf(n.id), (byFamily.get(familyOf(n.id)) ?? 0) + n.kg);
  $("legend").innerHTML =
    FAMILY_ORDER.map(
      (f) => `<li><span class="swatch" style="background:var(--${f})"></span>${FAMILY_LABEL[f]}<span class="kg">${Math.round(((byFamily.get(f) ?? 0) / masses.oewKg) * 100)}%</span></li>`,
    ).join("") +
    (tint.size
      ? `<li><span class="swatch" style="background:var(--composite)"></span>Композит</li><li><span class="swatch" style="background:var(--warn)"></span>Ограничение</li>`
      : "");

  const max = Math.max(...leaves().map((n) => n.kg));
  $("tree").innerHTML = FAMILY_ORDER.map((f) => {
    const items = leaves()
      .filter((n) => familyOf(n.id) === f)
      .sort((a, b) => b.kg - a.kg)
      .map((n) => {
        const d = fmtDeltaKg(n.kg - (baseMasses.byId.get(n.id)?.kg ?? 0));
        return `<li><button data-id="${n.id}" aria-pressed="false"><span class="swatch" style="background:var(--${f})"></span><span>${n.label}</span><span class="kg">${fmtKg(n.kg)}${
          d ? ` <em class="${d.startsWith("−") ? "good" : "bad"}">${d}</em>` : ""
        }</span><span class="bar-fill" style="width:${(n.kg / max) * 100}%;background:var(--${f})"></span></button></li>`;
      })
      .join("");
    return `<li><div class="group-row"><span>${FAMILY_LABEL[f]}</span><span>${fmtKg(byFamily.get(f) ?? 0)}</span></div><ol class="tree">${items}</ol></li>`;
  }).join("");
  for (const b of $("tree").querySelectorAll<HTMLButtonElement>("button")) b.addEventListener("click", () => select(b.dataset.id!));
  applySelection();
}

function renderDetail(): void {
  const box = $("detail");
  if (!state.selected || !result || state.drawerTab !== ABOUT_TAB) {
    box.hidden = true;
    return;
  }
  const masses = result.ev.masses;
  const n = masses.byId.get(state.selected);
  if (!n) {
    box.hidden = true;
    return;
  }
  const factor = masses.factors.get(n.id);
  queueMicrotask(() => {
    for (const b of box.querySelectorAll<HTMLButtonElement>("[data-goto]"))
      b.onclick = () => {
        state.drawerTab = b.dataset.goto!;
        renderLevers();
      };
  });
  const baseKg = result.base.masses.byId.get(n.id)?.kg ?? n.kg;
  const spec = NODES.find((s) => s.id === n.id)!;
  box.hidden = false;
  box.innerHTML = `
    <div class="detail-main">
    <dl>
      <dt>Масса</dt><dd>${fmtKg(n.kg)}</dd>
      ${Math.abs(n.kg - baseKg) > 0.5 ? `<dt>У ${AIRCRAFT_LABEL[state.aircraftId]}</dt><dd>${fmtKg(baseKg)}</dd>` : ""}
      <dt>Доля пустого снаряжённого</dt><dd>${nf((n.kg / masses.oewKg) * 100, 1)}%</dd>
      ${factor !== undefined ? `<dt>Оценка по формуле</dt><dd>${fmtKg(n.rawKg)}</dd><dt>Поправка по аналогу</dt><dd>×${nf(factor, 2)}</dd>` : ""}
    </dl>
    <p class="source">${spec.source}</p>
    ${
      linkedGroups(n.id).length
        ? `<div class="linked-levers"><span>Рычаги:</span>${linkedGroups(n.id)
            .map((g) => `<button class="chip small" data-goto="${g}">${g}</button>`)
            .join("")}</div>`
        : `<p class="source">Рычагов у этого агрегата нет — его масса меняется вслед за другими.</p>`
    }
    <a class="method-link" href="#${METHOD_ANCHOR[n.id] ?? "m-mass"}">Как рассчитано →</a>
    </div>
    ${n.id === "engines" ? engineExplainer() : ""}`;
}

const METHOD_ANCHOR: Record<string, string> = { engines: "m-engine", nacelles: "m-engine", "wing.highLift": "m-mass", fuel: "m-mission" };

/** Суть двухконтурного двигателя: деление потока, два вала, КПД — по текущему варианту. */
function engineExplainer(): string {
  const e = result.ev.definition.engine;
  const be = result.base.definition.engine;
  const B = e.bypassRatio;
  const cy = engineCycle(e);
  const ep = cy.etaPropulsive;
  const et = cy.etaThermal;
  const dT = (tsfcFactor(be, e) - 1) * 100;
  const rc = coreRadiusFor(1, B);
  // С редуктором ТНД быстроходная — три ступени, как у PW1100G.
  const lpt = e.cycle.gearbox ? 3 : lptStagesFor(B);
  const v0 = 0.78 * 296.5;
  const bypassShare = B / (1 + B);
  return `
  <div class="engine-explainer">
    <h4>Как это работает</h4>
    ${engineDiagram({
      bypassRatio: B,
      coreRadius: rc,
      boosterStages: e.architecture.boosterStages,
      hpcStages: e.architecture.hpcStages,
      hptStages: e.architecture.hptStages,
      lptStages: lpt,
      separateFlow: B >= 8,
    })}
    <div class="flow-split" aria-label="Деление потока">
      <span class="cold" style="flex:${bypassShare}">наружный контур ${nf(bypassShare * 100, 0)}%</span>
      <span class="hot" style="flex:${1 - bypassShare}">${nf((1 - bypassShare) * 100, 0)}%</span>
    </div>
    <p>Из каждых ${nf(1 + B, 1)} кг воздуха за вентилятором ${nf(B, 1)} кг идут в наружный контур и только 1 кг — в ядро, где горит топливо.
    Работы ядра хватает, чтобы разогнать большой поток немного, а не маленький сильно: в крейсере (${nf(v0)} м/с) струя наружного контура ${nf(cy.bypassJetMs)} м/с,
    ядра — ${nf(cy.coreJetMs)} м/с; вентилятор сжимает воздух в ${nf(cy.fanPressureRatio, 2)} раза.</p>
    <ul class="spools">
      <li><i class="lp"></i>Вал НД: вентилятор, подпорный компрессор (${e.architecture.boosterStages} ст.) ← турбина НД (${lpt} ст.)</li>
      <li><i class="hp"></i>Вал ВД: компрессор ВД (${e.architecture.hpcStages} ст.) ← турбина ВД (${e.architecture.hptStages} ст.)</li>
      <li><i class="hot"></i>Камера сгорания между ними</li>
    </ul>
    <dl>
      <dt>Двухконтурность</dt><dd>${nf(B, 1)}</dd>
      <dt>Вентилятор</dt><dd>${nf(e.fanDiameterM, 2)} м, ${e.architecture.fanBlades} лопаток</dd>
      <dt>Ядро на входе</dt><dd>${nf(rc * 100, 0)}% радиуса вентилятора</dd>
      <dt>Пропульсивный КПД η<sub>p</sub></dt><dd>${nf(ep, 3)}</dd>
      <dt>Тепловой КПД η<sub>th</sub></dt><dd>${nf(et, 3)}</dd>
      <dt>Перед турбиной</dt><dd>${nf(e.cycle.t4K)} К, охлаждение ${nf(e.cycle.coolingFrac * 100, 0)}%</dd>
      <dt>КПД вентилятора / компрессоров / турбин</dt><dd>${nf(e.cycle.fanEff, 3)} / ${nf(e.cycle.compEff, 3)} / ${nf(e.cycle.hptEff, 3)}–${nf(e.cycle.lptEff, 3)}</dd>${e.cycle.gearbox ? "<dt>Привод вентилятора</dt><dd>через редуктор</dd>" : ""}
      <dt>Расход TSFC к ${AIRCRAFT_LABEL[state.aircraftId]}</dt><dd>${Math.abs(dT) < 0.05 ? "как у базы" : `${dT > 0 ? "+" : "−"}${nf(Math.abs(dT), 1)}%`}</dd>
    </dl>
  </div>`;
}

// ——— Взаимодействие ———
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downAt: { x: number; y: number } | null = null;
renderer.domElement.addEventListener("pointerdown", (e) => (downAt = { x: e.clientX, y: e.clientY }));
renderer.domElement.addEventListener("pointerup", (e) => {
  if (!downAt || !model) return;
  const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
  downAt = null;
  if (moved > 4) return;
  const r = renderer.domElement.getBoundingClientRect();
  pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(model.root.children, true).find((h) => h.object.userData.partId);
  select(hit ? (hit.object.userData.partId as string) : null);
});

let hoverFrame = 0;
renderer.domElement.addEventListener("pointermove", (e) => {
  if (!model || downAt) return;
  cancelAnimationFrame(hoverFrame);
  hoverFrame = requestAnimationFrame(() => {
    const r = renderer.domElement.getBoundingClientRect();
    pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(model!.root.children, true).find((h) => h.object.userData.partId);
    const id = hit ? (hit.object.userData.partId as string) : null;
    if (id !== state.hovered) {
      state.hovered = id;
      renderer.domElement.style.cursor = id ? "pointer" : "";
      applyExplode();
    }
  });
});

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && state.selected) select(state.selected);
});
$("explode").addEventListener("input", (e) => {
  state.explode = parseFloat((e.target as HTMLInputElement).value);
  applyExplode();
});

// Выбор типа и поколения двигателей: id = тип + поколение (a321neo).
const pickAircraft = (id: string) => {
  if (state.aircraftId === id || !AIRCRAFT[id]) return;
  state.aircraftId = id;
  state.scenarioId = null;
  state.values = defaults(AIRCRAFT[state.aircraftId]);
  if (state.selected) select(state.selected);
  syncHeader();
  renderScenarios();
  renderScenarios();
  schedule();
};
for (const b of document.querySelectorAll<HTMLButtonElement>("[data-type]"))
  b.addEventListener("click", () => {
    // Поколение сохраняется, если у типа оно есть; с 737-8 на Airbus — neo (то же поколение двигателей).
    const t = b.dataset.type!;
    const gens = gensOf(t);
    const g = genOf(state.aircraftId);
    pickAircraft(t + (gens.includes(g) ? g : gens.includes("neo") ? "neo" : gens[0]));
  });
for (const b of document.querySelectorAll<HTMLButtonElement>("[data-gen]")) b.addEventListener("click", () => pickAircraft(typeOf(state.aircraftId) + b.dataset.gen!));
for (const b of document.querySelectorAll<HTMLButtonElement>("[data-aircraft]")) {
  b.addEventListener("click", () => {
    if (state.aircraftId === b.dataset.aircraft) return;
    state.aircraftId = b.dataset.aircraft!;
    state.scenarioId = null;
    state.values = defaults(AIRCRAFT[state.aircraftId]);
    syncHeader();
    renderScenarios();
    schedule();
  });
}
for (const b of document.querySelectorAll<HTMLButtonElement>("[data-mode]")) {
  b.addEventListener("click", () => {
    state.mode = b.dataset.mode as Mode;
    syncHeader();
    schedule();
  });
}
$("reset").addEventListener("click", () => applyScenario(null));
{
  const box = $("levers");
  const rowOf = (e: Event) => (e.target as HTMLElement).closest<HTMLElement>(".lever[data-row]")?.dataset.row ?? null;
  let dragging = false;
  box.addEventListener("pointerover", (e) => setFocusCtrl(rowOf(e)));
  box.addEventListener("pointerdown", () => (dragging = true));
  window.addEventListener("pointerup", () => {
    if (!dragging) return;
    dragging = false;
    if (!box.matches(":hover")) setFocusCtrl(null);
  });
  box.addEventListener("pointerleave", () => {
    if (!dragging) setFocusCtrl(null);
  });
  box.addEventListener("focusin", (e) => setFocusCtrl(rowOf(e)));
  box.addEventListener("focusout", () => setFocusCtrl(null));
}
function renderPhases(): void {
  const box = $("phases");
  box.innerHTML = (Object.keys(PHASES) as Phase[])
    .map((p) => `<button role="radio" data-phase="${p}" aria-checked="${p === state.phase}">${PHASES[p].label}</button>`)
    .join("");
  for (const b of box.querySelectorAll<HTMLButtonElement>("button"))
    b.addEventListener("click", () => {
      state.phase = b.dataset.phase as Phase;
      env.setPhase(state.phase);
      renderPhases();
    });
}
renderPhases();
($("spin") as HTMLInputElement).checked = !reduceMotion;
state.spin = !reduceMotion;
$("spin").addEventListener("change", (e) => (state.spin = (e.target as HTMLInputElement).checked));
try {
  state.livery = localStorage.getItem("oac-livery") ?? (document.documentElement.dataset.theme === "light" ? "blue" : "night");
} catch {
  state.livery = "night";
}
function renderLiveries(): void {
  const box = $<HTMLSelectElement>("livery");
  const opts = [...LIVERIES.map((l) => [l.id, l.label]), [NO_LIVERY, "Без окраски"]];
  box.innerHTML = opts.map(([id, label]) => `<option value="${id}" ${id === state.livery ? "selected" : ""}>${label}</option>`).join("");
}
$<HTMLSelectElement>("livery").addEventListener("change", (e) => {
  state.livery = (e.target as HTMLSelectElement).value;
  try {
    localStorage.setItem("oac-livery", state.livery);
  } catch {
    /* без сохранения */
  }
  applyNaturalColors();
});
renderLiveries();

// ——— Разделы: модель и «Как рассчитано» (одна страница, переключение по #) ———
function route(): void {
  const h = location.hash;
  const method = h.startsWith("#method") || h.startsWith("#m-") || h.startsWith("#src-");
  document.body.classList.toggle("method-mode", method);
  $("method").hidden = !method;
  $("nav-model").toggleAttribute("aria-current", !method);
  $("nav-method").toggleAttribute("aria-current", method);
  if (method) {
    if (!$("method").dataset.ready || $("method").dataset.for !== resultKey()) {
      $("method").innerHTML = renderMethod(result.ev, `${AIRCRAFT_LABEL[state.aircraftId]}${CONTROLS.some((c) => isChanged(c, AIRCRAFT[state.aircraftId], state.values[c.id])) || state.mode === "redesign" ? " с рычагами" : ""}`);
      $("method").dataset.ready = "1";
      $("method").dataset.for = resultKey();
    }
    const target = h.length > 1 && h !== "#method" ? document.getElementById(h.slice(1)) : null;
    if (target) target.scrollIntoView({ block: "start" });
    else $("method").scrollTop = 0;
  } else resize();
}
function resultKey(): string {
  return JSON.stringify([state.aircraftId, state.mode, state.values]);
}
window.addEventListener("hashchange", route);

const themeBtn = $("theme-toggle");
themeBtn.addEventListener("click", () => {
  const html = document.documentElement;
  const next = html.dataset.theme === "dark" ? "light" : "dark";
  html.dataset.theme = next;
  themeBtn.textContent = next === "dark" ? "Светлая тема" : "Тёмная тема";
  try {
    localStorage.setItem("oac-theme", next);
  } catch {
    /* хранилище недоступно — тема просто не запомнится */
  }
  applyTheme();
});

function applyTheme(): void {
  scene.background = new THREE.Color(css("--bg"));
  env.setTheme(document.documentElement.dataset.theme !== "light");
  if (result) buildScene();
}

function resize(): void {
  const { clientWidth: w, clientHeight: h } = viewport;
  renderer.setSize(w, h);
  labelRenderer.setSize(w, h);
  camera.aspect = w / h;
  if (viewShift > 0.5) camera.setViewOffset(w, h, 0, viewShift, w, h);
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);

try {
  const saved = localStorage.getItem("oac-theme");
  if (saved === "light" || saved === "dark") {
    document.documentElement.dataset.theme = saved;
    themeBtn.textContent = saved === "dark" ? "Светлая тема" : "Тёмная тема";
  }
} catch {
  /* без сохранённой темы */
}
resize();
scene.background = new THREE.Color(css("--bg"));
env.setTheme(document.documentElement.dataset.theme !== "light");
syncHeader();
renderScenarios();
run();
route();

// Для отладки и скриншотов.
(window as unknown as Record<string, unknown>).__oac = { camera, controls, state, applyScenario, schedule, timing, env, setFocusCtrl, select, scene };

// Роторы: вал ВД вращается примерно втрое быстрее вала НД (условное соотношение для наглядности).
const SPIN = { lp: 1.1, hp: 3.3 };
let lightClock = 0;
/**
 * Огни по фазе полёта: аэронавигационные и маяки горят всегда (маяки мигают ~1 Гц), белые проблесковые —
 * двойная вспышка раз в 1,2 с вне стоянки, посадочные фары — на взлёте и посадке.
 */
function animateLights(dt: number): void {
  if (!model) return;
  lightClock += dt;
  const t = lightClock;
  const beacon = t % 1 < 0.12 ? 2.2 : 0.15;
  const ph = t % 1.2;
  const strobeOn = state.phase !== "parked" && (ph < 0.05 || (ph > 0.12 && ph < 0.17));
  const landingOn = state.phase === "takeoff" || state.phase === "landing";
  const level: Record<string, number> = {
    "nav-red": 1.2,
    "nav-green": 1.2,
    beacon,
    strobe: strobeOn ? 3 : 0.1,
    landing: landingOn ? 2.5 : 0.05,
  };
  for (const id of ["fuselage", "wing.box"]) {
    const p = model.parts.get(id);
    if (!p) continue;
    for (const o of p.group.children) {
      const tone = o.userData.tone as string | null;
      if (tone && tone in level && o instanceof THREE.Mesh) (o.material as THREE.MeshStandardMaterial).emissiveIntensity = reduceMotion ? 1 : level[tone];
    }
  }
}
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (document.body.classList.contains("method-mode")) return;
  env.update(dt, state.spin && !reduceMotion);
  stepCamera(dt);
  pose();
  animateLights(dt);
  if (model && !reduceMotion && state.spin) {
    const eng = model.parts.get("engines");
    if (eng)
      for (const o of eng.group.children) {
        const sp = o.userData.spin as "lp" | "hp" | null;
        if (sp) o.rotation.x += SPIN[sp] * dt;
      }
  }
  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
  declutter(performance.now());
});
