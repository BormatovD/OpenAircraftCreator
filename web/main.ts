import "./style.css";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { isSuspensionHardware } from "./scene/pylonGeometry.ts";
import { pylonFor } from "./scene/pylonPackages.ts";
import { AIRCRAFT, AIRCRAFT_LABEL } from "./aircraftCatalog.ts";
import { bindAircraftPickers } from "./aircraftPickers.ts";
import { contextFor } from "../src/aircraft/contextFor.ts";
import { type ConstraintResult } from "../src/constraints.ts";
import { constraintsForPart, constraintTints, isReferenceConstraint } from "./constraintPresentation.ts";
import { type AircraftDefinition } from "../src/definition.ts";
import { DEFAULT_MISSION, type Evaluation, evaluate } from "../src/evaluate.ts";
import { type MassNode, NODES } from "../src/mass/massTree.ts";
import { evaluateConfiguration } from "../src/integration/configuration.ts";
import { engineCycle, tsfcFactor } from "../src/propulsion.ts";
import { renderMethod } from "./method.ts";
import { fetchPassport, passportRows, passportSnapshotDate, savedPassports, type Passport } from "./passport.ts";
import { fleetPackages, isFleetStyle } from "./scene/fleetPackages.ts";
import { COMBUSTORS } from "./scene/combustor.ts";
import { engineDiagram } from "./engineDiagram.ts";
import { applyReverserMotion, coreRadiusFor, lptStagesFor, nacelleStyleFor, type Spool } from "./scene/shapes.ts";
import { scenarioFamily, CONTROLS, type Control, type Mode, SCENARIOS, type Values, controlsFor, defaults, isChanged, leversFor } from "./controls.ts";
import { type AircraftModel, type Family, FAMILY, buildAircraft, installedGroundClearance, installationLimits, partCenter } from "./scene/aircraft.ts";
import { applyGearBracePose } from "./scene/landingGear.ts";
import { applyGearBayPose, gearLegTravel } from "./scene/gearBay.ts";
import { applyHighLiftHinge, type HighLiftHinge } from "./scene/highLiftHinge.ts";
import { Environment, PHASES, type Phase } from "./scene/environment.ts";
import { LIVERIES, NO_LIVERY, PLAIN_FIN, finLiveryTexture, liveryById } from "./scene/livery.ts";
import { fuselageTexture, htailTexture, wingTexture } from "./scene/textures.ts";
import { finishForTone, technicalRelief, TECHNICAL_RELIEF_SCALE_M } from "./scene/technicalFinish.ts";
import { FRA_BCN_NM, flightCostRoute } from "../src/integration/flightcostRoute.ts";
import { FC_ORIGIN, FC_PROTOCOL, FC_VERSION, PRESETS, flightCostDesign, layoutFor, presetFor, resolveFlightCostAircraft, withCabinLayout, routeModelFor } from "../src/integration/flightcost.ts";
import { SELECTED_EXPLODE_FRACTION, fitAircraftFrame, meshFramePoints, type SceneFrameArea } from "./scene/framing.ts";

const FAMILY_LABEL: Record<Family, string> = {
  structure: "Конструкция",
  propulsion: "Силовая установка",
  systems: "Бортовые системы",
  cabin: "Салон и эксплуатант",
};
const FAMILY_ORDER: Family[] = ["structure", "propulsion", "systems", "cabin"];
/** Цвета огней (AC 2-10-0): левый навигационный — красный, правый — зелёный, проблесковые — белые, маяки — красные. */
const LIGHTS: Record<string, string> = {
  "nav-red": "#ff2a2a",
  "nav-green": "#22ff66",
  strobe: "#ffffff",
  beacon: "#ff3b2a",
  landing: "#fff6d8",
};
const COMPOSITE_PARTS: Record<string, string> = { compositeBox: "wing.box", compositeHighLift: "wing.highLift" };

const launchParams = new URLSearchParams(window.location.search);
const flightCostOrigin = import.meta.env.VITE_FLIGHTCOST_ORIGIN || FC_ORIGIN;
const cardPreview = launchParams.get("view") === "aircraft-preview";
if (cardPreview) document.documentElement.classList.add("aircraft-preview");
const isFlightCostEmbed = launchParams.get("embed") === "flightcost" && window.parent !== window;
const hasFlightCostParams = ["ac", "aircraft", "engine", "layout"].some((key) => launchParams.has(key));
const requested = hasFlightCostParams ? resolveFlightCostAircraft(launchParams) : null;
const launchError = requested && "error" in requested ? requested.error : null;
// On an unsupported engine, keep the ICAO airframe visible but disable export
// and display the error; the visible engine is NOT claimed to be a match.
const localModel = launchParams.get("model");
const isLocalReview = !hasFlightCostParams && localModel !== null && Object.hasOwn(AIRCRAFT, localModel);
const initialId = isLocalReview ? localModel : requested && "preset" in requested ? requested.preset.aircraftId
  : (hasFlightCostParams ? PRESETS.find((p) => p.icao === (launchParams.get("ac") ?? "").toUpperCase())?.aircraftId : undefined) ?? "a320ceo";
const initialLayoutId = requested && "layout" in requested ? requested.layout.id : presetFor(initialId)?.defaultLayoutId ?? "a320-180";
const state = {
  aircraftId: initialId,
  layoutId: initialLayoutId,
  flightCostError: launchError as string | null,
  mode: "fixed" as Mode,
  values: defaults(AIRCRAFT[initialId]),
  scenarioId: null as string | null,
  explode: 0,
  reverserDeployment: 0,
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
let selectedSide = 0;
const individualSideParts = new Set(["engines", "nacelles", "gear.main", "wing.box", "wing.highLift", "htail", "wingtips", "antiIce"]);
const ABOUT_TAB = "about";
const REVERSER_TAB = "Реверс";
const MOUNTS_TAB = "Подвеска";
const TRAVEL_TAB = "Ход механизма";
// The preview moves only the scene, independently of the flight calculation.
const inspectionTravel = { gear: 1, highLift: 1 };
function mechanismFor(id: string | null) {
  if (id === "gear.main" || id === "gear.nose") return "gear";
  if (id === "wing.highLift") return "highLift";
  return null;
}
let exposeMounts = false;

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

let result: ReturnType<typeof evaluateConfiguration>;

function compute() {
  const baseDef = AIRCRAFT[state.aircraftId];
  const layout = layoutFor(state.aircraftId, state.layoutId);
  const def = layout ? withCabinLayout(baseDef, layout) : baseDef;
  return evaluateConfiguration(def, leversFor(def, state.values), state.mode, baseOf(state.aircraftId));
}

// Keep the accepted controls, calculations and meshes together when an attempted
// configuration would require relocating the engine. Slider edits replace values.
function configurationState() {
  const { aircraftId, layoutId, values, scenarioId, mode, flightCostError } = state;
  return { aircraftId, layoutId, values, scenarioId, mode, flightCostError };
}
let accepted: ReturnType<typeof configurationState>;
let raiseLimit = Infinity;
let reverserLimit = 100;
let mountNotice = "";

function applyConfiguration(): void {
  const candidate = compute();
  const def = candidate.ev.definition;
  const limits = installationLimits(def);
  const limit = Math.floor(limits.raise * 100) / 100;
  mountNotice = "";
  if (def.engine.nacelleRaiseM > limit && accepted) {
    mountNotice = limit < 0
      ? "Изменение отклонено. При таком размере гондолы зазора до крыла недостаточно даже при нулевом подъёме."
      : `Изменение отклонено. Сначала опустите двигатель до ${Math.round(limit * 100)} см или ниже — иначе гондола окажется слишком близко к крылу.`;
    Object.assign(state, accepted);
    syncHeader();
    renderScenarios();
    return;
  }
  if (accepted && state.aircraftId !== accepted.aircraftId) state.reverserDeployment = 0;
  result = candidate;
  raiseLimit = limit;
  reverserLimit = limits.reverse;
  state.reverserDeployment = Math.min(state.reverserDeployment, reverserLimit / 100);
  accepted = configurationState();
}

let pending = 0;
let frame = 0;
function finishPendingCalculation(): void {
  if (!frame && !pending) return;
  cancelAnimationFrame(frame);
  clearTimeout(pending);
  run();
}
/** Режим «та же геометрия» считается за кадр; перепроектирование — после паузы в движении ползунка. */
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
  frame = 0;
  pending = 0;
  applyConfiguration();
  timing.compute = performance.now() - t;
  t = performance.now();
  state.busy = false;
  document.body.classList.remove("busy");
  buildScene();
  timing.scene = performance.now() - t;
  t = performance.now();
  if (cardPreview) return;
  renderMetrics();
  renderFlightCostRoute();
  renderPassport();
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
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: cardPreview, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
viewport.appendChild(renderer.domElement);
const labelRenderer = new CSS2DRenderer();
labelRenderer.domElement.style.position = "absolute";
labelRenderer.domElement.style.inset = "0";
labelRenderer.domElement.style.pointerEvents = "none";
viewport.appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, 1, 0.5, 2500);
// Только исходный ракурс: центр и расстояние определятся по геометрии выбранного типа.
if (cardPreview) camera.position.set(-36, 22, 70);
else camera.position.set(-60, 17.5, 56);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = !reduceMotion && !cardPreview;
if (cardPreview) {
  controls.enablePan = false;
  controls.enableZoom = false;
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute("aria-label", initialId);
  window.addEventListener("keydown", (event) => {
    const step = Math.PI / 18;
    switch (event.key) {
      case "Escape":
        if (window.parent !== window) window.parent.postMessage({ type: "aircraft-preview-close" }, flightCostOrigin);
        break;
      case "ArrowLeft": controls.rotateLeft(step); break;
      case "ArrowRight": controls.rotateLeft(-step); break;
      case "ArrowUp": controls.rotateUp(step); break;
      case "ArrowDown": controls.rotateUp(-step); break;
      default: return;
    }
    event.preventDefault();
  });
}
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
  for (const [part, severity] of constraintTints(ev.constraints)) tint.set(part, severity);

  const edgeMat = edgeMaterial();
  for (const part of model.parts.values()) {
    const mat = materialFor(part.family, !!part.ghost, tint.get(part.id));
    const toned = new Map<string, THREE.MeshStandardMaterial>();
    part.group.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const tone = o.userData.tone as string | null;
      // Детали двигателя красятся по валам: НД, ВД, камера сгорания; кожух — цветом группы.
      if (o.geometry.userData.bellyPaint) {
        o.material = mat.clone();
      } else if (tone === "casing") {
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
          // Корпус топливного бака остаётся полупрозрачным, но его насосы, шпангоуты
          // и магистрали должны быть видны внутри во время инженерного разбора.
          if (part.ghost && tone.startsWith("detail")) {
            m.opacity = 0.88;
            m.transparent = true;
            m.depthWrite = false;
          }
          if (tone === "hot") m.emissive = new THREE.Color(css("--hot"));
          if (light) {
            m.emissive = new THREE.Color(light);
            m.emissiveIntensity = 1;
            m.map = null;
          }
          // Техническая микрофактура только на внутреннем оборудовании. Карты
          // переиспользуются между перестроениями сцены и не меняют геометрию.
          const finish = finishForTone(tone);
          if (finish) {
            m.bumpMap = technicalRelief(finish);
            m.bumpScale = TECHNICAL_RELIEF_SCALE_M;
            m.roughness = tone === "detailSteel" ? .42 : tone === "detailPanel" ? .58 : .65;
            m.metalness = tone === "detailSteel" ? .55 : tone === "detailPanel" ? .33 : .20;
          }
          if (tone === "gearRubber") {
            m.roughness = .92;
            m.metalness = .02;
          }
          if (tone === "glassFrame") {
            // Одинаковая яркость на передних и боковых стёклах даже при разных нормалях.
            m.metalness = 0.04;
            m.roughness = 0.88;
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
      fuselage: () => cachedTexture(`fus|${ev.definition.id}|${ev.definition.fuselage.lengthM}|${ev.definition.fuselage.heightM}|none`, () => fuselageTexture(ev.definition)),
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
          if (!m.map && !o.userData.tone && !o.geometry.userData.bellyPaint) {
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
    if (cardPreview || !node || node.kg < 1) continue;
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

  if (cardPreview) {
    applyExplode();
    requestCameraFrame();
    edgeMat.dispose();
    return;
  }
  applySelection();
  renderTree();
  requestCameraFrame();
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
      // At blade pitch a per-edge overlay obscures the rotor and guide rows.
      if (part.id === "engines" && (/-(compressor|stator|turbine-rotor|turbine-guide)$/.test(o.geometry.name) || o.geometry.name.startsWith("combustor-"))) continue;
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
  const bay = inspectingGearBay();
  for (const part of model.parts.values()) {
    const on = part.id === state.selected || !!state.focus?.has(part.id);
    const glass = (!!state.focus && !state.focus.has(part.id)) || (bay && part.id !== state.selected);
    part.group.traverse((o) => {
      if (o instanceof THREE.LineSegments && o.userData.isEdge) {
        o.material = on ? selectEdgeMat : (o.userData.baseMat as THREE.Material);
        o.visible = !glass;
      }
    });
  }
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * Положение каждой детали: разбор (k), выпуск механизации и уборка шасси по фазе полёта.
 * Вызывается каждый кадр — фаза меняется плавно.
 */
function pose(phase: { gear: number; flaps: number } = env.current, groundDrop = env.current.drop): void {
  if (!model) return;
  const k = ease(state.explode);
  const inspecting = state.drawerTab === TRAVEL_TAB ? mechanismFor(state.selected) : null;
  const retraction = (1 - (inspecting === "gear" ? inspectionTravel.gear : phase.gear)) * (1 - k);
  const flaps = inspecting === "highLift" ? inspectionTravel.highLift : phase.flaps;
  // The truck levels under load on the runway. Blend to its free angle as the aircraft lifts.
  const unloaded = THREE.MathUtils.smoothstep(groundDrop, 0, PHASES.takeoff.groundDrop);
  const inspectingReverser = state.selected === "nacelles" && state.drawerTab === REVERSER_TAB;
  const inspectingMounts = state.selected === "nacelles" && state.drawerTab === MOUNTS_TAB;
  for (const part of model.parts.values()) {
    // Выбор слегка отделяет агрегат; полного разлёта добиваются общим ползунком.
    // Expose the selected landing gear for inspection even in cruise.
    const gearUp = retraction * (!inspecting && part.id === selPart ? 1 - ease(selK) : 1);
    const kp = part.id === selPart && !inspecting && !inspectingReverser && !inspectingMounts ? Math.max(k, ease(selK) * SELECTED_EXPLODE_FRACTION) : k;
    part.group.position.copy(part.explode).multiplyScalar(kp);
    for (const o of part.group.children) {
      if (!(o instanceof THREE.Mesh)) continue;
      const off = o.userData.offset as THREE.Vector3 | null;
      const b = o.userData.basePos as THREE.Vector3 | null;
      const d = o.userData.deploy as THREE.Vector3 | null;
      if (part.id === "nacelles") {
        const cut = inspectingMounts && exposeMounts && o.userData.side === selectedSide;
        const structural = isSuspensionHardware(o.geometry.userData.installationRole);
        o.visible = cut ? structural : !structural || k > .12;
      }
      const origin = o.geometry.userData.reverserOrigin as THREE.Vector3 | undefined;
      if (origin) applyReverserMotion(o, inspectingReverser ? state.reverserDeployment : 0, origin);
      else o.position.set(0, 0, 0);
      o.position.x += (b?.x ?? 0) + (off?.x ?? o.geometry.userData.panelOffset ?? 0) * kp + (d?.x ?? 0) * flaps;
      o.position.y += (b?.y ?? 0) + (off?.y ?? 0) * kp + (d?.y ?? 0) * flaps;
      o.position.z += (b?.z ?? 0) + (o.userData.side ?? 0) * part.sideSpread * kp + (off?.z ?? 0) * kp;
      // Механизация: выдвижение и поворот вокруг шарнира. Взлёт (≈0,45) — закрылки ≈10–15°, предкрылки ≈18°;
      // посадка — 40° и 27°. Каретка выдвигается быстрее, чем растёт угол (так устроен Фаулер).
      const h = o.userData.hinge as HighLiftHinge | null;
      if (h) applyHighLiftHinge(o, h, flaps * (1 - kp));
      if (o.userData.hideRetracted) o.visible = gearUp < 0.08;
      const profile = o.geometry.userData.gearProfile;
      const legTravel = profile ? gearLegTravel(profile, gearUp) : gearUp;
      const r = o.userData.retract as { axis: "x" | "z"; angle: number } | null;
      if (r) {
        if (profile) o.rotation.set(0, 0, 0);
        o.rotation[r.axis] = r.angle * legTravel;
        if (r.axis === "z") o.visible = !!o.geometry.userData.bayOpening || inspecting === "gear" || gearUp < 0.97;
      }
      if (o.geometry.userData.gearBrace) {
        applyGearBracePose(o, legTravel);
        if (inspecting === "gear") o.visible = true;
      }
      if (profile) applyGearBayPose(o, gearUp, unloaded);
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
      if (o.geometry.userData.bellyPaint) {
        m.color.set(l?.belly ?? css(`--${p.family}`));
        return;
      }
      m.color.set(color ?? css(`--${p.family}`));
      if (o.userData.tone === "casing") return;
      if (map !== undefined && m.map !== map) {
        m.map = map;
        m.needsUpdate = true;
      }
    });
  };
  if (l) {
    paint("fuselage", "#ffffff", cachedTexture(`fus|${def.id}|${L}|${def.fuselage.heightM}|${l.id}|${def.shortName}`, () => fuselageTexture(def, l)));
    const fin = model.finXY;
    paint("vtail", "#ffffff", cachedTexture(`fin|${def.shapeSet ?? "a320"}|${def.vtail.areaM2}|${def.vtail.spanM}|${l.id}`, () => finLiveryTexture(l, fin)));
    paint("nacelles", l.nacelle);
    paint("wingtips", l.fin[1]);
    for (const id of ["wing.box", "wing.highLift", "htail"]) paint(id, l.wing);
  } else {
    paint("fuselage", null, cachedTexture(`fus|${def.id}|${L}|${def.fuselage.heightM}|none`, () => fuselageTexture(def)));
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
  const part = state.selected && model?.parts.get(state.selected);
  let protectedRect: DOMRect | undefined;
  if (part && list.length) {
    const viewportRect = viewport.getBoundingClientRect();
    const bounds = new THREE.Box2();
    for (const p of meshFramePoints(part.group, selectedSide)) {
      p.project(camera);
      if (p.z < -1 || p.z > 1) continue;
      bounds.expandByPoint(new THREE.Vector2(viewportRect.left + (1 + p.x) * viewportRect.width / 2,
        viewportRect.top + (1 - p.y) * viewportRect.height / 2));
    }
    if (!bounds.isEmpty()) protectedRect = new DOMRect(bounds.min.x, bounds.min.y,
      bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y);
  }
  for (const c of list) {
    // Прячем через visibility: элемент остаётся в раскладке, и его прямоугольник можно мерить каждый проход.
    const r = c.el.getBoundingClientRect();
    const pad = 4;
    const hit = r.width > 0 && placed.some((p) => r.left < p.right + pad && r.right + pad > p.left && r.top < p.bottom + pad && r.bottom + pad > p.top);
    const coversPart = protectedRect && r.left < protectedRect.right + pad && r.right > protectedRect.left - pad
      && r.top < protectedRect.bottom + pad && r.bottom > protectedRect.top - pad;
    const keep = !coversPart && (!hit || (c.priority ?? 0) >= 1e9);
    c.el.classList.toggle("clutter", !keep);
    c.line.visible = keep;
    if (keep && r.width > 0) placed.push(r);
  }
}

function inspectingGearBay(): boolean {
  return state.drawerTab === TRAVEL_TAB && mechanismFor(state.selected) === "gear"
    && (state.selected !== "gear.main" || $<HTMLInputElement>("expose-gear-bay").checked);
}

function applySelection(): void {
  if (!model) return;
  const accent = new THREE.Color(css("--accent"));
  const warn = new THREE.Color(css("--warn"));
  const bad = new THREE.Color(css("--bad"));
  const focus = state.focus;
  const inspectingBay = inspectingGearBay();
  const assembledFan = !focus && state.selected !== "engines" && state.explode < 0.12;
  for (const part of model.parts.values()) {
    const on = part.id === state.selected || !!focus?.has(part.id);
    const t = tint.get(part.id);
    const glass = (!!focus && !focus.has(part.id)) || (inspectingBay && part.id !== state.selected);
    part.group.traverse((o) => {
      if (o instanceof THREE.Mesh && !o.userData.isEdge) {
        if (o.geometry.userData.gearWell) o.visible = !(inspectingBay && part.id === state.selected);
        const m = o.material as THREE.MeshStandardMaterial;
        const tone = o.userData.tone;
        const fanFace = tone === "fanBlade" || tone === "fanSpinner";
        if (fanFace) {
          m.color.set(css(assembledFan ? `--${tone}` : "--lp"));
          m.metalness = 0.45;
          m.roughness = 0.5;
        }
        const base = m.userData.base as { opacity: number; transparent: boolean; depthWrite: boolean } | undefined;
        if (base) {
          m.transparent = glass || base.transparent;
          m.opacity = glass ? Math.min(base.opacity, 0.09) : base.opacity;
          m.depthWrite = glass ? false : base.depthWrite;
        }
        if (LIGHTS[tone]) {
          // The selection outline identifies the part; its lamp keeps its signalling colour.
          m.emissive.set(LIGHTS[tone]);
        } else if (on) {
          // Лёгкое свечение акцентом поверх собственного цвета детали; основное выделение — контур.
          m.emissive.copy(accent);
          m.emissiveIntensity = 0.07;
        } else if ((t === "warn" || t === "bad") && !(fanFace && assembledFan)) {
          m.emissive.copy(t === "bad" ? bad : warn);
          m.emissiveIntensity = 0.4;
        } else if (o.userData.tone === "hot") {
          m.emissive.set(css("--hot"));
          m.emissiveIntensity = 0.5;
        } else if (o.userData.tone === "glassFrame") {
          m.emissive.set(css("--glassFrame"));
          m.emissiveIntensity = 0.48;
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

function select(id: string | null, hitSide = 0): void {
  const side = id && individualSideParts.has(id) ? hitSide : 0;
  const same = state.selected === id && (!side || side === selectedSide);
  state.selected = same ? null : id;
  selectedSide = 0;
  if (state.selected) {
    const group = model?.parts.get(state.selected)?.group;
    if (group && individualSideParts.has(state.selected)) {
      // A tree or callout selects the near instance of a paired assembly.
      const nearSide = group.worldToLocal(camera.position.clone()).z < 0 ? -1 : 1;
      selectedSide = side || (group.children.some(m => m.userData.side === nearSide) ? nearSide : 0);
    }
    if (selPart !== state.selected) selK = 0;
    selPart = state.selected;
    const family = $("tree").querySelector<HTMLDetailsElement>(`details[data-family="${familyOf(state.selected)}"]`);
    if (family) family.open = true;
    const groups = linkedGroups(state.selected);
    state.drawerOpen = true;
    state.drawerTab = groups[0] ?? ABOUT_TAB;
    // Approach the main strut from behind the nacelle. Keep this initial
    // inspection angle separate from framing so the user can orbit freely.
    if (state.selected === "gear.main" || state.selected === "gear.nose") {
      const side = selectedSide || (camera.position.z < controls.target.z ? -1 : 1);
      const direction = new THREE.Vector3(state.selected === "gear.main" ? .62 : -.42, state.selected === "gear.main" ? -.53 : .06, side).normalize();
      const distance = camera.position.distanceTo(controls.target);
      camera.position.copy(controls.target).addScaledVector(direction, distance);
      camera.lookAt(controls.target);
      controls.update();
    }
  } else state.drawerOpen = false;
  applySelection();
  renderLevers();
  requestCameraFrame();
}

/** Рамка считается только после изменения модели/выбора/макета, не на ручной zoom/orbit. */
let cameraFramePending = false;
let cameraFrameReady = false;
let cameraInteracting = false;
let frameLowerBeacon: THREE.Mesh | undefined;
let aim: {
  fromTarget: THREE.Vector3; toTarget: THREE.Vector3;
  direction: THREE.Vector3; fromDistance: number; toDistance: number; t: number;
} | null = null;
function requestCameraFrame(): void {
  cameraFramePending = true;
}
controls.addEventListener("start", () => {
  cameraInteracting = true;
  cameraFramePending = false;
  aim = null;
});
controls.addEventListener("end", () => { cameraInteracting = false; });

/** Свободная область сцены по реальным плашкам, включая закрытую панель и KPI compare. */
function sceneFrameArea(): SceneFrameArea {
  const rect = viewport.getBoundingClientRect();
  const inset = 14;
  let top = inset;
  let bottom = inset;
  const intersects = (r: DOMRect) => r.width > 0 && r.height > 0 && r.right > rect.left
    && r.left < rect.right && r.bottom > rect.top && r.top < rect.bottom;
  const metrics = $("metrics");
  if (getComputedStyle(metrics).position === "absolute") {
    for (const el of [metrics, ...metrics.querySelectorAll<HTMLElement>(".kpi-compare")]) {
      const r = el.getBoundingClientRect();
      if (intersects(r)) top = Math.max(top, r.bottom - rect.top + inset);
    }
  }
  const drawer = $("drawer");
  if (getComputedStyle(drawer).position === "absolute") {
    const r = drawer.getBoundingClientRect();
    if (intersects(r)) bottom = Math.max(bottom, rect.bottom - r.top + inset);
  }
  return { width: rect.width, height: rect.height, top, bottom, left: inset, right: inset };
}

function frameCamera(): void {
  if (!model || cameraInteracting) return;
  const area = sceneFrameArea();
  const selected = state.selected ? model.parts.get(state.selected) : undefined;
  const subject = selected?.group ?? model.root;
  let points = meshFramePoints(subject, selectedSide);
  // Центр вращения выбранного узла должен совпадать с его конечной позой.
  const previous = selK;
  const next = state.selected ? 1 : 0;
  const phase = PHASES[state.phase];
  if (next !== previous || phase.gear !== env.current.gear || phase.flaps !== env.current.flaps || phase.groundDrop !== env.current.drop) {
    selK = next;
    pose(phase, phase.groundDrop);
    const final = meshFramePoints(subject, selectedSide);
    if (selected && final.length) points = final;
    else points.push(...final);
    selK = previous;
    pose();
  }
  if (selected && state.drawerTab === TRAVEL_TAB && mechanismFor(selected.id) === "gear") {
    // Frame the sweep once, so the doors and truck stay in view while dragging the slider.
    const extension = inspectionTravel.gear;
    for (const sample of [0, .25, .5, .75, 1]) {
      if (extension === sample) continue;
      inspectionTravel.gear = sample;
      pose();
      points.push(...meshFramePoints(subject, selectedSide));
    }
    inspectionTravel.gear = extension;
    pose();
  }
  if (frameLowerBeacon) {
    points.push(...meshFramePoints(frameLowerBeacon));
    frameLowerBeacon = undefined;
  }
  if (!points.length) points = meshFramePoints(model.root);
  const frame = fitAircraftFrame(points, camera.position.clone().sub(controls.target), camera.up,
    camera.fov, camera.zoom, camera.near, area);
  if (!frame) return;
  cameraFramePending = false;
  camera.setViewOffset(area.width, area.height, frame.offsetX, frame.offsetY, area.width, area.height);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  const projected = new THREE.Vector3();
  const currentFits = points.every((point) => {
    projected.copy(point).project(camera);
    const x = (projected.x + 1) * area.width / 2;
    const y = (1 - projected.y) * area.height / 2;
    return x >= area.left && x <= area.width - area.right && y >= area.top
      && y <= area.height - area.bottom && projected.z > -1 && projected.z < 1;
  });
  // Если новая панель уже перекрывает самолёт, вписываем сразу. Плавное приближение
  // безопасно, когда весь самолёт помещается и в начальный, и в конечный кадр.
  if (cardPreview || !cameraFrameReady || reduceMotion || !currentFits) {
    controls.target.copy(frame.target);
    camera.position.copy(frame.position);
    aim = null;
  } else {
    aim = {
      fromTarget: controls.target.clone(), toTarget: frame.target,
      direction: frame.direction, fromDistance: camera.position.distanceTo(controls.target),
      toDistance: frame.distance, t: 0,
    };
  }
  cameraFrameReady = true;
}

function stepCamera(dt: number): void {
  if (cameraFramePending) frameCamera();
  // Разбор выбранного агрегата: 0,6 с туда и обратно.
  const want = state.selected ? 1 : 0;
  const was = selK;
  selK = reduceMotion ? want : Math.max(0, Math.min(1, selK + Math.sign(want - selK) * dt / 0.6));
  if (selK === 0 && !state.selected) selPart = null;
  if (was !== selK) applyExplode();
  if (!aim) return;
  aim.t = reduceMotion ? 1 : Math.min(1, aim.t + dt / 0.45);
  const k = ease(aim.t);
  const p = aim.fromTarget.clone().lerp(aim.toTarget, k);
  const distance = THREE.MathUtils.lerp(aim.fromDistance, aim.toDistance, k);
  controls.target.copy(p);
  camera.position.copy(p).addScaledVector(aim.direction, distance);
  if (aim.t >= 1) aim = null;
}

/** Рычаги, которые действуют на выбранный агрегат. */
function linkedControls(id: string | null): Control[] {
  return id ? controlsFor(AIRCRAFT[state.aircraftId]).filter((c) => c.parts.includes(id)) : [];
}
/** Группы рычагов агрегата — вкладки нижней панели. */
function linkedGroups(id: string | null): string[] {
  const groups: string[] = [...new Set(linkedControls(id).map((c) => c.group))];
  if (mechanismFor(id)) groups.unshift(TRAVEL_TAB);
  if (id === "nacelles" && model?.parts.get(id)?.group.children.some(o =>
    o instanceof THREE.Mesh && o.geometry.userData.reverserOrigin)) groups.unshift(REVERSER_TAB);
  if (id === "nacelles" && result && pylonFor(nacelleStyleFor(result.ev.definition.engine))) groups.splice(groups.includes(REVERSER_TAB) ? 1 : 0,0,MOUNTS_TAB);
  return groups;
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
  text.textContent = s?.text ?? (fam === "b737-800"
    ? "737-800 · CFM56-7B26. Для сравнения компоновок выберите салон."
    : fam === "b737-8"
    ? "Сценарии про решения самого 737: что дал бы больший вентилятор, старое крыло, пилон."
    : fam === "tu214"
      ? "Ту-214 / ПС-90А: предварительный инженерный прогноз, не подтверждён по графикам РЛЭ. Масса, дальность и цикл двигателя требуют независимой проверки."
    : fam === "b757"
      ? "757-200: выберите RB211 или PW2037 и сравните расчёт. Исходная масса пока недооценена; это контрольный тип для модели масс."
      : "Сценарии — готовые наборы рычагов с объяснением. Нажмите ещё раз, чтобы снять.");
  document.querySelector(".scenario-label")!.textContent = fam === "b757" ? "757-200" : fam === "tu214" ? "Ту-214" : "Сценарии";
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
    state.layoutId = presetFor(s.aircraft)?.defaultLayoutId ?? state.layoutId;
    state.flightCostError = null;
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
  const nameNow = AIRCRAFT[state.aircraftId].shortName ?? AIRCRAFT_LABEL[state.aircraftId];
  document.querySelector(".brand h1")!.textContent = `${nameNow} в разборе`;
  document.title = `${nameNow} в разборе`;
  syncPickers();
  for (const o of document.querySelectorAll<HTMLButtonElement>("[data-mode]")) o.setAttribute("aria-checked", String(o.dataset.mode === state.mode));
  const select = $("cabin-layout") as HTMLSelectElement;
  const preset = presetFor(state.aircraftId);
  select.hidden = !preset;
  document.querySelector<HTMLLabelElement>('label[for="cabin-layout"]')!.hidden = !preset;
  document.querySelector<HTMLElement>(".fc-exchange")!.hidden = !preset;
  select.replaceChildren();
  for (const layout of preset?.layouts ?? []) {
    const option = document.createElement("option");
    option.value = layout.id;
    option.textContent = layout.label;
    option.selected = layout.id === state.layoutId;
    select.appendChild(option);
  }
  const warning = $("fc-warning");
  warning.hidden = !state.flightCostError;
  warning.textContent = state.flightCostError ?? "";
  if (state.flightCostError) {
    // A FlightCost PW1100G link may show the A20N airframe as a preview,
    // but export stays blocked until the user explicitly selects LEAP-1A.
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.textContent = `Я выбираю модель ${preset?.engine ?? "этого двигателя"}`;
    confirm.addEventListener("click", () => {
      state.flightCostError = null;
      syncHeader();
      schedule();
    });
    warning.append(" ", confirm);
  }
}

function controlDisplay(c: Control, def: AircraftDefinition) {
  const v = state.values[c.id];
  const limitedRaise = c.kind === "range" && c.id === "raise" && raiseLimit <= c.max;
  const disabled = (c.id === "mach" && state.values.lrc === true) || (limitedRaise && raiseLimit <= 0);
  const changed = isChanged(c, def, v) && !(c.id === "mach" && disabled);
  const hint = limitedRaise
    ? `Предел по зазору до крыла — ${Math.round(raiseLimit * 100)} см.${v === raiseLimit ? " Выше поднять нельзя." : ""}`
    : disabled ? "Отключите LRC, чтобы задать постоянный Мах. Фактические скорости показаны справа."
    : `${c.hint}${changed && c.kind === "range" ? ` · база ${c.format(c.base(def) as number)}` : ""}`;
  return { v, disabled, changed, hint, max: c.kind === "range" ? (limitedRaise ? raiseLimit : c.max) : 0 };
}

function controlRow(c: Control, def: AircraftDefinition): string {
  const { v, disabled, changed, hint, max } = controlDisplay(c, def);
  const hintTitle = hint.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
  if (c.kind === "toggle")
    return `<label class="lever toggle${changed ? " changed" : ""}" data-row="${c.id}">
      <input type="checkbox" data-ctrl="${c.id}" ${v ? "checked" : ""} />
      <span class="lever-text"><span class="lever-label">${c.label}</span><span class="lever-hint" title="${hintTitle}">${hint}</span></span>
    </label>`;
  const baseV = c.base(def);
  return `<div class="lever range${changed ? " changed" : ""}" data-row="${c.id}">
    <div class="lever-top"><label class="lever-label" for="ctrl-${c.id}">${c.label}</label><output id="out-${c.id}">${disabled && c.id === "mach" ? "LRC" : c.format(v as number)}</output></div>
    <input id="ctrl-${c.id}" type="range" data-ctrl="${c.id}" min="${c.min}" max="${max}" step="${c.step}" value="${v}" aria-describedby="hint-${c.id}"
      ${disabled ? "disabled" : ""} style="--base:${((baseV - c.min) / (max - c.min || 1)) * 100}%" />
    <span class="lever-hint" id="hint-${c.id}" title="${hintTitle}">${hint}</span>
  </div>`;
}

let leversBuilt = "";
function updateReverserControl(): void {
  const input = $<HTMLInputElement>("reverser-deployment");
  const style = nacelleStyleFor(result.ev.definition.engine);
  const pct = Math.round(100 * state.reverserDeployment);
  const position = pct === 0 ? "Убран · 0%" : pct === 100 ? "Выпущен · 100%" : `${pct}% хода`;
  if (model) {
    const gap = installedGroundClearance(model, state.reverserDeployment);
    const ground = $("reverser-ground");
    ground.textContent = `До земли в этом положении: ${nf(gap * 100, 1)} см.`
      + (gap <= 0 ? " Расчётный контакт с землёй." : " Эксплуатационный допуск зависит от условий массы, CG и стоек.");
  }
  input.max = String(reverserLimit);
  input.disabled = reverserLimit === 0;
  input.value = String(pct);
  input.setAttribute("aria-valuetext", position);
  $("reverser-position").textContent = position;
  $("reverser-hint").textContent = reverserLimit < 100
    ? `При этой установке доступно ${reverserLimit}% хода по зазору до крыла. Для большего хода опустите двигатель или уменьшите диаметр гондолы.`
    : isFleetStyle(style) ? fleetPackages[style].reverserLabel : "Обечайки открывают решётки, створки поворачиваются в канал вентилятора. Ход в модели приближённый.";
}
$("reverser-deployment").addEventListener("input", (event) => {
  state.reverserDeployment = (event.currentTarget as HTMLInputElement).valueAsNumber / 100;
  updateReverserControl();
  pose();
});
/**
 * Нижняя панель. Выбран агрегат — его рычаги по группам и вкладка «Об агрегате»; ничего не выбрано —
 * все рычаги по группам (панель открывается кнопкой «Рычаги»).
 */
$("expose-mounts").addEventListener("change", event => {
  exposeMounts = (event.currentTarget as HTMLInputElement).checked;
  applyExplode();
});
$("expose-gear-bay").addEventListener("change", () => {
  applySelection();
  renderLevers();
});
$("travel-range").addEventListener("input", event => {
  const mechanism = mechanismFor(state.selected);
  if (!mechanism) return;
  const pct = (event.currentTarget as HTMLInputElement).valueAsNumber;
  inspectionTravel[mechanism] = pct / 100;
  $("travel-position").textContent = pct + "%";
  pose();
});
function renderLevers(): void {
  const def = AIRCRAFT[state.aircraftId];
  const notice = $("mount-notice");
  notice.hidden = !mountNotice;
  notice.textContent = mountNotice;
  const visible = controlsFor(def);
  const activeControls = visible.filter((c) => c.id !== "mach" || state.values.lrc !== true);
  const allGroups = [...new Set(visible.map((c) => c.group))];
  const sel = state.selected;
  const groups = sel ? linkedGroups(sel) : allGroups;
  const tabs = sel ? [...groups, ABOUT_TAB] : groups;
  if (!tabs.includes(state.drawerTab)) state.drawerTab = tabs[0];
  const drawer = $("drawer");
  drawer.dataset.open = String(state.drawerOpen);
  drawer.dataset.mode = sel ? "part" : "all";
  $("drawer-toggle").setAttribute("aria-expanded", String(state.drawerOpen));
  const anyChanged = activeControls.some((c) => isChanged(c, def, state.values[c.id]));
  const nChanged = activeControls.filter((c) => isChanged(c, def, state.values[c.id])).length;
  $("drawer-toggle").innerHTML = state.drawerOpen ? "Рычаги ▾" : `Рычаги ▴${nChanged ? ` <span class="badge">${nChanged}</span>` : ""}`;
  ($("reset") as HTMLButtonElement).disabled = !anyChanged;
  const n = sel ? result?.ev.masses.byId.get(sel) : null;
  if (n && result) {
    const d = fmtDeltaKg(n.kg - (result.base.masses.byId.get(n.id)?.kg ?? n.kg));
    $("drawer-title").innerHTML = `<span class="swatch" style="background:var(--${familyOf(n.id)})"></span><b>${n.label}</b>
      <span class="muted">${fmtKg(n.kg)}${d ? ` <em class="${d.startsWith("−") ? "good" : "bad"}">${d}</em>` : ""}${n.ata ? ` · ATA ${n.ata}` : ""}</span>`;
  } else $("drawer-title").innerHTML = state.drawerOpen ? `<b>Все рычаги</b><span class="muted">нажмите на агрегат — останутся только его</span>` : "";
  const changedIn = (g: string) => activeControls.some((c) => c.group === g && isChanged(c, def, state.values[c.id]));
  $("drawer-tabs").innerHTML = tabs
    .map(
      (t) =>
        `<button role="tab" data-dtab="${t}" aria-selected="${t === state.drawerTab}">${t === ABOUT_TAB ? "Об агрегате" : t}${t !== ABOUT_TAB && changedIn(t) ? '<i class="dot"></i>' : ""}</button>`,
    )
    .join("");
  for (const b of $("drawer-tabs").querySelectorAll<HTMLButtonElement>("button"))
    b.onclick = () => {
      state.drawerTab = b.dataset.dtab!;
      if (mechanismFor(state.selected) === "gear") applySelection();
      renderLevers();
      requestCameraFrame();
    };
  const about = state.drawerTab === ABOUT_TAB;
  const reverser = state.drawerTab === REVERSER_TAB;
  drawer.dataset.content = about ? "detail" : reverser ? "reverser" : "levers";
  $("reverser-panel").hidden = !reverser;
  $("detail").hidden = !about;
  const mechanism = state.drawerTab === TRAVEL_TAB ? mechanismFor(sel) : null;
  $("travel-panel").hidden = !mechanism;
  const inspectingMounts = state.drawerTab === MOUNTS_TAB;
  $("pylon-panel").hidden = !inspectingMounts;
  $("levers").hidden = about || reverser || inspectingMounts || !!mechanism;
  if (mechanism) {
    drawer.dataset.content = "travel";
    $("gear-bay-view").hidden = state.selected !== "gear.main";
    $("travel-label").textContent = mechanism === "gear" ? "Выпуск шасси" : "Выпуск механизации крыла";
    const pct = Math.round(100 * inspectionTravel[mechanism]);
    $<HTMLInputElement>("travel-range").value = String(pct);
    $("travel-position").textContent = pct + "%";
    $("travel-hint").textContent = inspectingGearBay()
      ? "0% — убрано, 100% — выпущено. Стенки выбранной ниши скрыты для осмотра."
      : "Ход в 3D: 0% — убрано, 100% — выпущено.";
    return;
  }
  if (inspectingMounts && result) {
    drawer.dataset.content = "mounts";
    const spec = pylonFor(nacelleStyleFor(result.ev.definition.engine));
    if (spec) {
      $("pylon-front").textContent = spec.forwardMountLabel;
      $("pylon-middle").textContent = spec.middleMountLabel ?? "";
      $("pylon-middle-row").hidden = !spec.middleMountLabel;
      $("pylon-rear").textContent = spec.rearMountLabel;
      $("pylon-cowls").textContent = spec.cowlLabel;
    }
    return;
  }
  if (reverser) {
    updateReverserControl();
    return;
  }
  if (about) {
    renderDetail();
    return;
  }
  const list = visible.filter((c) => c.group === state.drawerTab && (!sel || c.parts.includes(sel)));
  const contentKey = `${state.aircraftId}|${sel ?? ""}|${state.drawerTab}|${list.map((c) => c.id).join()}`;
  const box = $("levers");
  const scrollTop = leversBuilt === contentKey ? box.scrollTop : 0;
  // Пока ползунок тянут, разметку не пересобираем — иначе он потеряет захват.
  const active = document.activeElement as HTMLInputElement | null;
  if (active?.dataset.ctrl && active.type === "range" && leversBuilt === contentKey) {
    for (const c of list) {
      if (c.kind !== "range") continue;
      const { v, max, disabled, changed, hint } = controlDisplay(c, def);
      const input = $<HTMLInputElement>(`ctrl-${c.id}`);
      input.max = String(max);
      input.value = String(v);
      input.disabled = disabled;
      input.closest(".lever")!.classList.toggle("changed", changed);
      const note = $(`hint-${c.id}`);
      note.title = note.textContent = hint;
      $(`out-${c.id}`).textContent = c.id === "mach" && disabled ? "LRC" : c.format(v as number);
    }
    return;
  }
  leversBuilt = contentKey;
  box.innerHTML = list.map((c) => controlRow(c, def)).join("");
  box.scrollTop = scrollTop;
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
  requestCameraFrame();
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
  const seatsNote = ev.seatsCarried < ev.seats ? `${ev.seatsCarried} из ${ev.seats} мест — лимит нагрузки` : `${ev.seats} мест`;
  const name = AIRCRAFT_LABEL[state.aircraftId];
  const same = Number.isFinite(ev.fuelPerSeatPer100KmKg) && Number.isFinite(base.fuelPerSeatPer100KmKg) &&
    Math.abs(ev.fuelPerSeatPer100KmKg / base.fuelPerSeatPer100KmKg - 1) < 5e-4;
  const tile = (label: string, value: string, delta: string, note: string) =>
    `<div class="kpi-tile" title="${note}"><div class="kpi-label">${label}</div><div class="kpi-value">${value}</div><div class="kpi-delta">${delta}</div></div>`;
  const actionable = ev.constraints.filter((c) => !isReferenceConstraint(c));
  const references = ev.constraints.filter(isReferenceConstraint).length;
  const uncertain = ev.constraints.filter(c => isReferenceConstraint(c) && (c.status === "warning" || c.status === "violation")).length;
  const bad = actionable.filter((c) => c.status === "violation").length;
  const warn = actionable.filter((c) => c.status === "warning").length;
  const metrics = $("metrics");
  const scrollLeft = metrics.querySelector<HTMLElement>(".kpi-strip")?.scrollLeft ?? 0;
  metrics.innerHTML = `
    <div class="kpi-strip" role="group" aria-label="Показатели рейса" tabindex="0">
    <div class="kpi-main" title="Рейс ${nf(Math.round(km))} км, ${seatsNote}">
      <div class="kpi-label">Топливо на место · ${nf(Math.round(km))} км</div>
      <div class="kpi-big">${nf(ev.fuelPerSeatPer100KmKg, 3)}<small> кг/100 км</small></div>
      <div class="kpi-delta">${same ? "как у базы" : deltaPct(ev.fuelPerSeatPer100KmKg, base.fuelPerSeatPer100KmKg)} · ${seatsNote}</div>
    </div>
    ${tile("Топливо на рейс", fmtKg(ev.tripFuelKg), deltaPct(ev.tripFuelKg, base.tripFuelKg), "без резервов")}
    ${tile("Пустой снаряжённый", fmtKg(ev.oewKg), deltaPct(ev.oewKg, base.oewKg), "OEW")}
    ${tile("MTOW", fmtKg(ev.definition.weights.mtowKg), deltaPct(ev.definition.weights.mtowKg, base.definition.weights.mtowKg), rd ? "под ту же миссию" : "максимальная взлётная масса")}
    ${tile("Дальность, все места", `${nf(Math.round(ev.rangeWithMissionPayloadNm))} nm`, deltaPct(ev.rangeWithMissionPayloadNm, base.rangeWithMissionPayloadNm, false), `${nf(Math.round(ev.rangeWithMissionPayloadNm * 1.852))} км`)}
    <button class="kpi-tile kpi-limits ${bad ? "bad" : warn || uncertain ? "warn" : "ok"}" id="kpi-limits" title="Открыть список ограничений">
      <div class="kpi-label">Ограничения</div>
      <div class="kpi-value">${bad ? `✕ ${bad}` : warn ? `! ${warn}` : uncertain ? `? ${uncertain}` : references ? `i ${references}` : "✓"}</div>
      <div class="kpi-delta">${bad ? "нарушено" : warn ? "на грани" : uncertain ? "нужна сверка модели" : references ? "справочные данные" : "в норме"}${references && (bad || warn) ? ` · ${references} справ.` : ""}</div>
    </button>
    </div>
    ${cmp ? `<div class="kpi-compare">${AIRCRAFT_LABEL[scenario!.compareWith!]}: ${nf(cmp.fuelPerSeatPer100KmKg, 3)} кг/100 км, OEW ${fmtKg(cmp.oewKg)}</div>` : ""}`;
  metrics.querySelector<HTMLElement>(".kpi-strip")!.scrollLeft = scrollLeft;
  // Невыполнимый рейс / ноль пассажиров: нельзя показывать NaN как реальный расход.
  if (!Number.isFinite(ev.fuelPerSeatPer100KmKg)) {
    const value = metrics.querySelector<HTMLElement>(".kpi-main .kpi-big");
    if (value) value.innerHTML = "—<small> кг/100 км</small>";
  }
  if (!Number.isFinite(ev.fuelPerSeatPer100KmKg) || !Number.isFinite(result.base.fuelPerSeatPer100KmKg)) {
    const delta = metrics.querySelector<HTMLElement>(".kpi-main .kpi-delta");
    if (delta) delta.textContent = ev.missionResult.feasible ? "нет сопоставимой базы / пассажиров" : "рейс недостижим — см. ограничения";
  }
  if (cmp && !Number.isFinite(cmp.fuelPerSeatPer100KmKg)) {
    const compare = metrics.querySelector<HTMLElement>(".kpi-compare");
    if (compare) compare.textContent = `${AIRCRAFT_LABEL[scenario!.compareWith!]}: — кг/100 км, OEW ${fmtKg(cmp.oewKg)}`;
  }
  $("kpi-limits").onclick = () => setRightTab("constraints");
  const d = result.ev.definition;
  $("mode-hint").innerHTML =
    state.mode === "fixed"
      ? "Геометрия, MTOW и MZFW выбранного самолёта. Меняются массы, расход и дальность."
      : `Самолёт масштабируется под ту же нагрузку и ${nf(Math.round(rd!.designRangeNm))} nm: площадь крыла ${nf(d.wing.areaM2, 1)} м², размах ${nf(d.wing.spanM, 2)} м, тяга ×${nf(d.engine.thrustScale, 3)}.${rd!.converged ? "" : " <b>Итерации не сошлись.</b>"}`;
}

// Both powerplant variants share the public passport for their ICAO type.
const livePassports = new Map<string, Passport>();
const passportRequests = new Map<string, number>();
function renderPassport(): void {
  const icao = presetFor(state.aircraftId)?.icao;
  if (!icao) return;
  const details = $<HTMLDetailsElement>("aircraft-passport");
  const source = $<HTMLAnchorElement>("passport-source");
  source.href = `${FC_ORIGIN}/ru/type/${encodeURIComponent(icao)}`;
  details.querySelector<HTMLElement>(".passport-name")!.textContent = icao;
  const live = livePassports.get(icao);
  const facts = live ?? savedPassports[icao];
  $("passport-status").textContent = live ? "" : facts ? ` · копия от ${passportSnapshotDate}` : " · данные недоступны";
  const rows = facts ? passportRows(facts) : [];
  if (layoutFor(state.aircraftId, state.layoutId)) {
    rows.unshift({ label: "Выбранный салон (3D и расчёт)", value: `${result.ev.seats} мест` });
  }
  $("passport-body").replaceChildren(...rows.flatMap(({ label, value }) => {
    const dt = document.createElement("dt"), dd = document.createElement("dd");
    dt.textContent = label;
    dd.textContent = value;
    return [dt, dd];
  }));

  if (!details.open || location.protocol === "file:" || live || Date.now() < (passportRequests.get(icao) ?? 0)) return;
  passportRequests.set(icao, Date.now() + 60_000);
  void fetchPassport(icao).then(passport => {
    livePassports.set(icao, passport);
    if (presetFor(state.aircraftId)?.icao === icao) renderPassport();
  }).catch(() => { /* Keep the dated FlightCost copy visible if the service is unavailable. */ });
}
$("aircraft-passport").addEventListener("toggle", renderPassport);

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
    <p class="drag-note">Вклады — в каунтах (0,0001 C<sub>D</sub>). Срез расчётной миссии: M ${nf(d.mach, 3)}, FL${nf(d.fl)}, C<sub>L</sub> ${nf(d.cl, 2)}; число Маха расходимости сопротивления — ${nf(d.mdd, 3)}.</p>
    ${missionProfileNote(result.ev)}`;
}

function missionProfileNote(ev: Evaluation): string {
  const a = ev.missionAssumptions;
  const m = ev.missionResult;
  const p = m.trip;
  const lrc = a.cruiseSpeedMode === "lrc";
  const machSpan = Math.abs(p.maxMach - p.minMach);
  const machDigits = machSpan < 0.001 ? 4 : 3;
  const speed = machSpan < 1e-6 ? `M ${nf(p.minMach, 3)}` : `M ${nf(p.minMach, machDigits)}–${nf(p.maxMach, machDigits)}`;
  const levels = p.initialFL === p.finalFL ? `FL${nf(p.initialFL)}` : `FL${nf(p.initialFL)} → FL${nf(p.finalFL)}`;
  return `<p class="drag-note"><b>Рейс ${nf(Math.round(DEFAULT_MISSION.distanceNm * 1.852))} км:</b> ${lrc ? "LRC" : "постоянный Мах"}, ${speed}; ${levels}.
    ${lrc ? "Используется таблица скоростей базового 737-8; оптимум изменённого самолёта заново не ищется." : ""}</p>
    ${p.lrcFallback || m.reserves.lrcFallback ? `<p class="drag-note"><b>Вне таблицы LRC:</b> на части рейса или резервной миссии применён постоянный M ${nf(a.cruiseMach, 2)}. Экстраполяция таблицы не выполняется.</p>` : ""}
    ${p.flightLevelLimited || m.reserves.flightLevelLimited ? '<p class="drag-note"><b>Ограничение высоты:</b> часть рейса или резервной миссии не проходит проверку модели по C<sub>L</sub> и тяге с запасом 300 фут/мин. Это диагностическое ограничение расчёта.</p>' : ""}
    ${!m.feasible ? `<p class="drag-note"><b>Недостаточный запас топлива:</b> дефицит резервов ${fmtKg(m.reserveShortfallKg)}.</p>` : ""}`;
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
    <div class="pr-legend"><span><i class="k-cur"></i>сейчас</span><span><i class="k-base"></i>${AIRCRAFT_LABEL[state.aircraftId]}</span><span><i class="k-mission"></i>рейс ${nf(Math.round(DEFAULT_MISSION.distanceNm * 1.852))} км</span></div>
    ${ev.definition.shapeSet === "tu214" ? `<p class="drag-note"><b>Ту-214 — инженерная оценка.</b> Дальность и взлётные характеристики требуют сверки по РЛЭ; ПС-90А с соплом смешения моделируется приближённо. Ограничение коммерческой нагрузки зависит от весовой комплектации.</p>` : ""}
    ${missionProfileNote(ev)}`;
}

/** Механизация: CLmax по конфигурациям и что из них следует на взлёте и посадке. */
function renderTakeoffLanding(): void {
  const { ev, base } = result;
  const h = ev.highLift;
  const hb = base.highLift;
  const tofl = (e: Evaluation) => parseFloat(e.constraints.find((c) => c.id === "takeoff-field")!.value.replace(/\s/g, ""));
  const oeiGradient = (normal: number, emergency?: number) => emergency === undefined
    ? `${nf(normal * 100, 1)}%`
    : `${nf(normal * 100, 1)}% штат. / ${nf(emergency * 100, 1)}% ЧР`;
  const row = (label: string, v: string, delta: string, t?: string) => `<tr><th>${label}${t ? tip(t) : ""}</th><td>${v}</td><td>${delta}</td></tr>`;
  const kt = (cur: number, b: number) => (Math.abs(cur - b) < 0.5 ? `<span class="delta zero">как у базы</span>` : `<span class="delta ${cur < b ? "good" : "bad"}">${cur > b ? "+" : "−"}${nf(Math.abs(cur - b), 0)} уз</span>`);
  $("tol").innerHTML = `
    <table class="tol">
      ${row("C<sub>L max</sub> чистое крыло", nf(h.clMaxClean, 2), deltaPct(h.clMaxClean, hb.clMaxClean, false), "Максимальный коэффициент подъёмной силы без механизации. Чем он выше, тем медленнее может лететь самолёт без сваливания.")}
      ${row("C<sub>L max</sub> взлёт", nf(h.clMaxTakeoff, 2), deltaPct(h.clMaxTakeoff, hb.clMaxTakeoff, false), "Взлётная конфигурация (CONF 1+F): предкрылки 18°, закрылки 10°.")}
      ${row("C<sub>L max</sub> посадка", nf(h.clMaxLanding, 2), deltaPct(h.clMaxLanding, hb.clMaxLanding, false), "Посадочная конфигурация (CONF FULL): предкрылки 27°, закрылки 40°. Привязано к A320 по скорости захода 134 уз.")}
      ${row("V₂MIN в рейсе", `${nf(ev.oei.v2Ms / 0.514444, 0)} уз`, kt(ev.oei.v2Ms / 0.514444, base.oei.v2Ms / 0.514444), "Расчётная нижняя оценка V₂ = 1,13·VSR при фактической массе рейса; это не выбранная или одобренная AFM V₂.")}
      ${row("V₂ при MTOW", `${nf(h.v2Kt, 0)} уз`, kt(h.v2Kt, hb.v2Kt), "Расчётная нижняя оценка V₂ = 1,13·VSR при MTOW; это не выбранная или одобренная AFM V₂.")}
      ${row("Заход при MLW", `${nf(h.vAppKt, 0)} уз`, kt(h.vAppKt, hb.vAppKt), "1,23 скорости сваливания в посадочной конфигурации. По ней ИКАО делит самолёты на категории: C — до 140 уз.")}
      ${row("ВПП при MTOW", `${nf(tofl(ev))} м`, deltaPct(tofl(ev), tofl(base)))}
      ${row("Набор OEI в рейсе", oeiGradient(ev.oei.gradient, ev.oeiEmergency?.gradient),
        `масса ${fmtKg(ev.oei.massKg)} · ${deltaPct(ev.oei.gradient, base.oei.gradient, false)}`,
        "Второй сегмент с одним двигателем, рассчитан при фактической взлётной массе и V₂MIN. Это оценка модели, не утверждённые AFM/РЛЭ данные.")}
      ${row("Набор OEI при MTOW", oeiGradient(ev.oeiAtMtow.gradient, ev.oeiEmergencyAtMtow?.gradient),
        `масса ${fmtKg(ev.oeiAtMtow.massKg)}`,
        "Отдельная точка при MTOW. V₂MIN = 1,13·VSR; для ПС-90А показан также расчёт на кратковременной ЧР, не более 3 минут. Не является выводом о сертификации.")}
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

const STATUS_ICON = { ok: "✓", info: "i", warning: "!", violation: "✕" } as const;
function renderConstraints(): void {
  const cs: ConstraintResult[] = result.ev.constraints;
  const renderRows = (items: ConstraintResult[]) => items.map(c => `<li class="c-${c.status}">
    <span class="c-icon" aria-hidden="true">${STATUS_ICON[c.status]}</span>
    <div><div class="c-head"><span>${c.label}</span><span class="c-value">${c.value}</span></div>
      <div class="c-msg">${c.message}</div>
      <details class="constraint-evidence"><summary>Условия и источник</summary>
        <div class="c-limit">${c.limit}</div>${c.source ? `<div class="c-source">${c.source}</div>` : ""}</details></div></li>`).join("");
  const active = cs.filter(c => !isReferenceConstraint(c));
  const references = cs.filter(isReferenceConstraint);
  $("constraints").innerHTML = `${active.length ? renderRows(active) : ""}${references.length ?
    `<li class="constraint-reference-group"><h3>Применимость расчёта и справочные данные</h3></li>${renderRows(references)}` : ""}`;
}

function familyOf(id: string): Family {
  return FAMILY[id] ?? "systems";
}

function leaves(): MassNode[] {
  return NODES.filter((n) => n.estimate).map((n) => result.ev.masses.byId.get(n.id)!).filter((n) => n.kg > 0.5);
}

function renderTree(): void {
  const tree = $("tree");
  const panel = $("left-panel");
  const scrollTop = panel.scrollTop;
  const expanded = new Map([...tree.querySelectorAll<HTMLDetailsElement>("details[data-family]")]
    .map((group) => [group.dataset.family!, group.open]));
  const active = document.activeElement as HTMLElement | null;
  const focusedFamily = active && tree.contains(active) && active.matches("summary")
    ? active.parentElement?.dataset.family : null;
  const focusedPart = active && tree.contains(active) ? active.dataset.id : null;
  const masses = result.ev.masses;
  const baseMasses = result.base.masses;
  const byFamily = new Map<Family, number>();
  for (const n of leaves()) byFamily.set(familyOf(n.id), (byFamily.get(familyOf(n.id)) ?? 0) + n.kg);
  $("legend").innerHTML =
    FAMILY_ORDER.map(
      (f) => `<li><span class="swatch" style="background:var(--${f})"></span><span class="legend-label">${FAMILY_LABEL[f]}</span><span class="kg">${Math.round(((byFamily.get(f) ?? 0) / masses.oewKg) * 100)}%</span></li>`,
    ).join("") +
    ([...tint.values()].some((v) => v === "composite")
      ? `<li><span class="swatch" style="background:var(--composite)"></span><span class="legend-label">Композит</span></li>`
      : "") +
    ([...tint.values()].some((v) => v === "warn" || v === "bad")
      ? `<li><span class="swatch" style="background:var(--warn)"></span><span class="legend-label">Ограничение</span></li>`
      : "");

  const max = Math.max(...leaves().map((n) => n.kg));
  tree.innerHTML = FAMILY_ORDER.map((f) => {
    const items = leaves()
      .filter((n) => familyOf(n.id) === f)
      .sort((a, b) => b.kg - a.kg)
      .map((n) => {
        const d = fmtDeltaKg(n.kg - (baseMasses.byId.get(n.id)?.kg ?? 0));
        return `<li><button data-id="${n.id}" aria-pressed="false"><span class="swatch" style="background:var(--${f})"></span><span class="part-label">${n.label}</span><span class="kg">${fmtKg(n.kg)}${
          d ? ` <em class="${d.startsWith("−") ? "good" : "bad"}">${d}</em>` : ""
        }</span><span class="bar-fill" style="width:${(n.kg / max) * 100}%;background:var(--${f})"></span></button></li>`;
      })
      .join("");
    return `<li><details class="family-card" data-family="${f}" style="--family:var(--${f})"${(expanded.get(f) ?? true) ? " open" : ""}>
      <summary class="group-row"><span>${FAMILY_LABEL[f]}</span><span class="group-mass">${fmtKg(byFamily.get(f) ?? 0)}</span></summary>
      <ol class="tree">${items}</ol>
    </details></li>`;
  }).join("");
  for (const b of tree.querySelectorAll<HTMLButtonElement>("button")) b.addEventListener("click", () => {
    select(b.dataset.id!);
    if (state.selected && window.matchMedia("(max-width: 980px)").matches)
      viewport.scrollIntoView({ block: "start", behavior: reduceMotion ? "instant" : "smooth" });
  });
  applySelection();
  if (focusedFamily) tree.querySelector<HTMLElement>(`details[data-family="${focusedFamily}"] > summary`)?.focus({ preventScroll: true });
  else if (focusedPart) tree.querySelector<HTMLElement>(`button[data-id="${focusedPart}"]`)?.focus({ preventScroll: true });
  panel.scrollTop = scrollTop;
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
  const causes = constraintsForPart(result.ev.constraints, n.id);
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
    ${n.id === "furnishings" ? "<p class=\"source\">Кресла, кухни и туалеты показаны условно для разбора массы. Это не точный план салона: проходы у промежуточных дверей и расстановка по классам пока не воспроизводятся.</p>" : ""}
    ${
      linkedGroups(n.id).length
        ? `<div class="linked-levers"><span>Рычаги:</span>${linkedGroups(n.id)
            .map((g) => `<button class="chip small" data-goto="${g}">${g}</button>`)
            .join("")}</div>`
        : `<p class="source">Рычагов у этого агрегата нет — его масса меняется вслед за другими.</p>`
    }
    <a class="method-link" href="#${METHOD_ANCHOR[n.id] ?? "m-mass"}">Как рассчитано →</a>
    </div>
    ${causes.length ? `<section class="aggregate-constraints"><h3>Проверки агрегата</h3><ul class="constraints">${causes.map(c => `<li class="c-${c.status}">
      <span class="c-icon" aria-hidden="true">${STATUS_ICON[c.status]}</span><div>
        <div class="c-head"><span>${c.label}</span><span class="c-value">${c.value}</span></div>
        ${c.limit ? `<div class="c-limit">Порог: ${c.limit}</div>` : ""}<div class="c-msg">${c.message}</div>
        ${c.source ? `<div class="c-source">Источник: ${c.source}</div>` : ""}</div></li>`).join("")}</ul></section>` : ""}
    ${n.id === "engines" ? engineExplainer() : ""}`;
}

const METHOD_ANCHOR: Record<string, string> = { engines: "m-engine", nacelles: "m-engine", "wing.highLift": "m-mass", fuel: "m-mission" };

/** Суть двухконтурного двигателя: деление потока, валы, КПД — по текущему варианту. */
function engineExplainer(): string {
  const e = result.ev.definition.engine;
  const be = result.base.definition.engine;
  const B = e.bypassRatio;
  const cy = engineCycle(e);
  const ep = cy.etaPropulsive;
  const et = cy.etaThermal;
  const dT = (tsfcFactor(be, e) - 1) * 100;
  const rc = coreRadiusFor(1, B);
  const arch = e.architecture;
  const lpt = lptStagesFor(B, e.cycle.gearbox, arch.lptStages);
  const style = nacelleStyleFor(e);
  const fleet = isFleetStyle(style) ? fleetPackages[style] : undefined;
  const combustor = arch.combustor ? COMBUSTORS[arch.combustor] : fleet && { label: fleet.combustorLabel, injectors: fleet.injectorCount };
  const bladeRows = (["hp", "ip", "lp"] as const).map(spool => {
    const stages = arch.turbineBlading?.[spool];
    if (!stages) return "";
    const name = { hp: "ТВД", ip: "ТСД", lp: "ТНД" }[spool];
    const rotors = stages.map(s => s.rotor ?? "—").join(" / ");
    const vanes = stages.every(s => s.vanes === undefined) ? "условно" : stages.map(s => s.vanes ?? "—").join(" / ");
    return `<dt>${name}</dt><dd>${rotors}<br><small>сопловые · ${vanes}</small></dd>`;
  }).join("");
  const v0 = 0.78 * 296.5;
  const bypassShare = B / (1 + B);
  return `
  <div class="engine-explainer">
    <h4>${e.name} · продольный разрез</h4>
    ${engineDiagram({
      ...arch,
      installation: isFleetStyle(style) ? style : undefined,
      coreRadius: rc,
      lptStages: lpt,
      separateFlow: arch.exhaust ? arch.exhaust === "separateNozzles" : nacelleStyleFor(e) === "separateFlow",
    })}
    <div class="flow-split" aria-label="Деление потока">
      <span class="cold" style="flex:${bypassShare}">наружный контур ${nf(bypassShare * 100, 0)}%</span>
      <span class="hot" style="flex:${1 - bypassShare}">${nf((1 - bypassShare) * 100, 0)}%</span>
    </div>
    <p>Из каждых ${nf(1 + B, 1)} кг воздуха за вентилятором ${nf(B, 1)} кг идут в наружный контур и только 1 кг — в ядро, где горит топливо.
    ${arch.exhaust === "annularMixer"
      ? `У ${e.name} потоки соединяются перед общим соплом. Расчёт цикла оценивает скорости контуров по отдельности. Вентилятор сжимает воздух в ${nf(cy.fanPressureRatio, 2)} раза.`
      : `Работы ядра хватает, чтобы разогнать большой поток немного, а не маленький сильно: в крейсере (${nf(v0)} м/с) струя наружного контура ${nf(cy.bypassJetMs)} м/с,
    ядра — ${nf(cy.coreJetMs)} м/с; вентилятор сжимает воздух в ${nf(cy.fanPressureRatio, 2)} раза.`}</p>
    <ul class="spools">
      <li><i class="lp"></i>Вал НД · вентилятор${arch.boosterStages ? `, компрессор НД (${arch.boosterStages} ст.)` : ""} ← турбина НД (${lpt} ст.)</li>
      ${arch.spools === 3 ? `<li><i class="ip"></i>Вал СД · компрессор СД (${arch.ipcStages} ст.) ← турбина СД (${arch.iptStages} ст.)</li>` : ""}
      <li><i class="hp"></i>Вал ВД · компрессор ВД (${e.architecture.hpcStages} ст.) ← турбина ВД (${e.architecture.hptStages} ст.)</li>
      <li><i class="hot"></i>Камера сгорания между ними</li>
    </ul>
    ${bladeRows ? `<details><summary>Лопатки турбин по ступеням</summary>
      <p>Число рабочих лопаток дано по ходу газа. Под каждым рядом указаны сопловые лопатки. Профили и осевые зазоры показаны схематично.</p>
      <dl>${bladeRows}</dl></details>` : ""}
    <dl>
      ${arch.exhaust ? `<dt>Выпускная система</dt><dd>${arch.exhaust === "annularMixer" ? "Смешение потоков и общее сопло" : "Переднее сопло вентилятора и заднее сопло ядра"}</dd>` : ""}
      ${combustor ? `<dt>Камера сгорания</dt><dd>${combustor.label}</dd>
      ${combustor.injectors ? `<dt>Топливные форсунки</dt><dd>${combustor.injectors} по окружности</dd>` : ""}` : ""}
      <dt>Двухконтурность</dt><dd>${nf(B, 1)}</dd>
      ${arch.compressorBlading ? `<dt>Рабочие лопатки КНД</dt><dd>${arch.compressorBlading.lp?.join(" / ")}</dd>
        <dt>Рабочие лопатки КВД</dt><dd>${arch.compressorBlading.hp?.join(" / ")}</dd>` : ""}
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
  if (cardPreview || !downAt || !model) return;
  const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
  downAt = null;
  if (moved > 4) return;
  const r = renderer.domElement.getBoundingClientRect();
  pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(model.root.children, true).find((h) => h.object.visible && h.object.userData.partId);
  select(hit ? (hit.object.userData.partId as string) : null, hit?.object.userData.side ?? 0);
});

let hoverFrame = 0;
renderer.domElement.addEventListener("pointermove", (e) => {
  if (cardPreview || !model || downAt) return;
  cancelAnimationFrame(hoverFrame);
  hoverFrame = requestAnimationFrame(() => {
    const r = renderer.domElement.getBoundingClientRect();
    pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(model!.root.children, true).find((h) => h.object.visible && h.object.userData.partId);
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
  const wasAssembled = state.explode < 0.12;
  state.explode = parseFloat((e.target as HTMLInputElement).value);
  if (wasAssembled !== (state.explode < 0.12)) applySelection();
  else applyExplode();
  requestCameraFrame();
});

// Выбор типа и поколения либо двигателя (у 757 — RB211 / PW2037).
const pickAircraft = (id: string) => {
  if (state.aircraftId === id || !AIRCRAFT[id]) return;
  state.aircraftId = id;
  state.layoutId = presetFor(id)?.defaultLayoutId ?? state.layoutId;
  state.flightCostError = null;
  state.scenarioId = null;
  state.values = defaults(AIRCRAFT[state.aircraftId]);
  if (state.selected) select(state.selected);
  syncHeader();
  renderScenarios();
  schedule();
};
const syncPickers = bindAircraftPickers(() => state.aircraftId, pickAircraft);
// Конфигурация салона общая для 3D, масс и FlightCost.
$("cabin-layout").addEventListener("change", (event) => {
  state.layoutId = (event.target as HTMLSelectElement).value;
  state.flightCostError = null;
  state.scenarioId = null;
  syncHeader();
  renderScenarios();
  schedule();
});

function renderFlightCostRoute(): void {
  const visible = !!routeModelFor(state.aircraftId) && !state.flightCostError;
  $("fc-route").hidden = !visible;
  if (!visible || !result) return;
  const percent = Number(($("fc-load") as HTMLInputElement).value);
  const pax = Math.floor(result.ev.seats * percent / 100 + 0.5 + 1e-9);
  const distance = Number(launchParams.get("routeNm"));
  const route = flightCostRoute(result, {
    pax, distanceNm: isFlightCostEmbed && distance > 0 && Number.isFinite(distance) ? distance : FRA_BCN_NM,
  });
  const output = $("fc-route-result");
  const reason = Object.values(route.limits).join(". ");
  output.textContent = percent + "% · " + pax + " пасс. · " + (reason || (
    nf(route.tripKg, 1) + " кг с рулением · " + nf(route.blockMin, 2) + " мин блок-время"));
  output.dataset.fuelKg = String(route.tripKg);
  output.dataset.blockMin = String(route.blockMin);
}
$("fc-load").addEventListener("input", renderFlightCostRoute);

function currentFlightCostDesign() {
  finishPendingCalculation();
  if (!result || state.flightCostError || !presetFor(state.aircraftId)) return null;
  const d = result.ev.definition;
  const fuelDensity = contextFor(d).fuelDensityKgL;
  return flightCostDesign(d, result.ev.oewKg, state.values, state.mode, state.aircraftId, state.layoutId, fuelDensity);
}
$("fc-copy").addEventListener("click", async () => {
  const design = currentFlightCostDesign();
  if (!design) return;
  try {
    await navigator.clipboard.writeText(JSON.stringify(design, null, 2));
    $("fc-status").textContent = "Конфигурация JSON скопирована";
  } catch {
    $("fc-status").textContent = "Буфер обмена недоступен; откройте конструктор в отдельной вкладке";
  }
});
let pendingRequest: string | null = null;
$("fc-send").hidden = !isFlightCostEmbed;
$("fc-send").addEventListener("click", () => {
  const design = currentFlightCostDesign();
  if (!design || !isFlightCostEmbed) return;
  pendingRequest = crypto.randomUUID();
  window.parent.postMessage({ protocol: FC_PROTOCOL, version: FC_VERSION, type: "DESIGN_EXPORT", requestId: pendingRequest, design,
    routeLoad: routeModelFor(state.aircraftId) ? Number(($("fc-load") as HTMLInputElement).value) : undefined }, flightCostOrigin);
  $("fc-status").textContent = "Конфигурация отправлена FlightCost; ожидаем подтверждения сохранения";
});
window.addEventListener("message", (event: MessageEvent) => {
  if (!isFlightCostEmbed || event.origin !== flightCostOrigin || event.source !== window.parent) return;
  const msg = event.data as { protocol?: string; version?: number; type?: string; requestId?: string; saved?: boolean; error?: string } | null;
  if (!msg || msg.protocol !== FC_PROTOCOL || msg.version !== FC_VERSION || msg.type !== "DESIGN_ACK" || msg.requestId !== pendingRequest) return;
  pendingRequest = null;
  $("fc-status").textContent = msg.saved ? "Сохранено в workspace FlightCost" : (msg.error || "FlightCost получил конфигурацию, но ещё не сохранил её");
});

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
      requestCameraFrame();
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
if (cardPreview) state.livery = "blue";
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
    finishPendingCalculation();
    if (!$("method").dataset.ready || $("method").dataset.for !== resultKey()) {
      $("method").innerHTML = renderMethod(result.ev, `${AIRCRAFT_LABEL[state.aircraftId]}${result.levers.length || state.mode === "redesign" ? " с рычагами" : ""}`);
      $("method").dataset.ready = "1";
      $("method").dataset.for = resultKey();
    }
    const target = h.length > 1 && h !== "#method" ? document.getElementById(h.slice(1)) : null;
    if (target) target.scrollIntoView({ block: "start" });
    else $("method").scrollTop = 0;
  } else resize();
}
function resultKey(): string {
  return JSON.stringify([state.aircraftId, state.layoutId, state.mode, state.values]);
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
  if (w <= 0 || h <= 0) return;
  renderer.setSize(w, h);
  labelRenderer.setSize(w, h);
  camera.aspect = w / h;
  camera.clearViewOffset();
  camera.updateProjectionMatrix();
  requestCameraFrame();
}
window.addEventListener("resize", resize);
// Перенос строк шапки, смена вкладки и открытие панели меняют сцену без window.resize.
if (!cardPreview) new ResizeObserver(resize).observe(viewport);
const panelObserver = new ResizeObserver(requestCameraFrame);
panelObserver.observe($("metrics"));
panelObserver.observe($("drawer"));

try {
  const saved = cardPreview ? "dark" : localStorage.getItem("oac-theme");
  if (saved === "light" || saved === "dark") {
    document.documentElement.dataset.theme = saved;
    themeBtn.textContent = saved === "dark" ? "Светлая тема" : "Тёмная тема";
  }
} catch {
  /* без сохранённой темы */
}
resize();
scene.background = new THREE.Color(css("--bg"));
if (cardPreview) {
  env.group.visible = false;
  scene.background = null;
} else env.setTheme(document.documentElement.dataset.theme !== "light");
syncHeader();
renderScenarios();
run();
route();
const reviewPart = launchParams.get("part");
if (isLocalReview && (reviewPart === "engines" || reviewPart === "nacelles" || reviewPart === "pylons" || mechanismFor(reviewPart))) {
  const extension = launchParams.get("extension");
  const mechanism = mechanismFor(reviewPart);
  if (mechanism && extension !== null && /^(?:100|[1-9]?\d)$/.test(extension)) {
    inspectionTravel[mechanism] = Number(extension) / 100;
  }
  select(reviewPart === "pylons" ? "nacelles" : reviewPart);
  if (reviewPart === "gear.main" && launchParams.get("view") === "underside") {
    const body = scene.getObjectByName("fuselage");
    frameLowerBeacon = body?.children.find((o): o is THREE.Mesh =>
      o instanceof THREE.Mesh && o.geometry.name === "lower-beacon-lens");
    camera.position.copy(controls.target).addScaledVector(
      new THREE.Vector3(-.37, -1, .64 * (selectedSide || 1)).normalize(), 12);
    camera.lookAt(controls.target);
    controls.update();
  }
  if (reviewPart === "pylons") {
    state.drawerTab = MOUNTS_TAB;
    renderLevers();
    applySelection();
    requestCameraFrame();
  }
  if (reviewPart === "engines") {
    state.drawerTab = ABOUT_TAB;
    renderLevers();
  }
}

// Для отладки и скриншотов.
(window as unknown as Record<string, unknown>).__oac = { camera, controls, state, applyScenario, schedule, timing, env, setFocusCtrl, select, scene };

// Роторы: вал ВД вращается примерно втрое быстрее вала НД (условное соотношение для наглядности).
const SPIN: Record<Spool, number> = { lp: 1.1, ip: 2.1, hp: 3.3 };
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
if (cardPreview) {
  // The card is a still scene. Draw only when the viewport or the orbit changes.
  const draw = () => renderer.render(scene, camera);
  const fit = () => {
    if (!viewport.clientWidth || !viewport.clientHeight) return;
    resize();
    frameCamera();
    controls.update();
    draw();
  };
  new ResizeObserver(fit).observe(viewport);
  controls.addEventListener("change", draw);
  fit();
  if (!launchError && window.parent !== window) {
    window.parent.postMessage({ type: "aircraft-preview-ready", aircraft: initialId, layout: initialLayoutId }, flightCostOrigin);
  }
} else {
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
}
