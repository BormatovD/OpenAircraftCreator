// Рычаги — данные, а не код. Каждый рычаг описывает эффекты четырёх видов:
//  • definition — правка определения самолёта (размах, длина фюзеляжа, двигатель, законцовки);
//    массы и аэродинамика затем пересчитываются по формулам;
//  • mass — множитель или добавка к узлу дерева масс (композитное крыло, облегчённые жгуты);
//  • aero — CD0, Освальд или общий множитель сопротивления («повышение аэродинамического качества»);
//  • engine — множитель TSFC (позже — модель двухконтурности).
// Новый рычаг — это новая запись в каталоге, а не новый код в расчёте.

import { type AircraftDefinition } from "./definition.ts";
import { BPR_VALID_RANGE, dryMassForBpr, fanDiameterForBpr } from "./propulsion.ts";
import { DOUBLE_SLOTTED_MASS, HIGHLIFT_MASS_SHARES } from "./highlift.ts";

export type Effect =
  | { kind: "definition"; apply: (def: AircraftDefinition) => AircraftDefinition }
  | { kind: "massFactor"; node: string; factor: number }
  | { kind: "massDelta"; node: string; kg: number }
  | { kind: "aero"; cd0Factor?: number; cd0Delta?: number; oswaldDelta?: number; dragFactor?: number }
  | { kind: "engine"; tsfcFactor: number }
  | { kind: "mission"; cruiseMach?: number };

export interface Lever {
  id: string;
  label: string;
  /** Что именно меняет и почему такие числа — показывается в инженерном режиме. */
  rationale: string;
  effects: Effect[];
}

export interface AeroModifiers {
  cd0Factor: number;
  cd0Delta: number;
  oswaldDelta: number;
  dragFactor: number;
}

export function collectAero(levers: Lever[]): AeroModifiers {
  const m: AeroModifiers = { cd0Factor: 1, cd0Delta: 0, oswaldDelta: 0, dragFactor: 1 };
  for (const l of levers)
    for (const e of l.effects)
      if (e.kind === "aero") {
        m.cd0Factor *= e.cd0Factor ?? 1;
        m.cd0Delta += e.cd0Delta ?? 0;
        m.oswaldDelta += e.oswaldDelta ?? 0;
        m.dragFactor *= e.dragFactor ?? 1;
      }
  return m;
}

/** Правки допущений миссии (крейсерское число Маха). */
export function collectMission(levers: Lever[]): { cruiseMach?: number } {
  const out: { cruiseMach?: number } = {};
  for (const l of levers) for (const e of l.effects) if (e.kind === "mission" && e.cruiseMach !== undefined) out.cruiseMach = e.cruiseMach;
  return out;
}

export function collectTsfcFactor(levers: Lever[]): number {
  let f = 1;
  for (const l of levers) for (const e of l.effects) if (e.kind === "engine") f *= e.tsfcFactor;
  return f;
}

export function applyDefinition(def: AircraftDefinition, levers: Lever[]): AircraftDefinition {
  let d = structuredClone(def);
  for (const l of levers) for (const e of l.effects) if (e.kind === "definition") d = e.apply(d);
  return d;
}

// ——— Каталог рычагов. Числа помечены как допущения; уточняются по мере появления источников. ———

/** Композитный кессон крыла: −20% массы кессона и панелей (типичный диапазон в литературе 15–25%). */
export const compositeWing = (savingPct = 20): Lever => ({
  id: "composite-wing",
  label: "Композитный кессон крыла",
  rationale: `Масса кессона и панелей × ${(1 - savingPct / 100).toFixed(2)}. Допущение: отраслевой диапазон экономии 15–25%. Механизация — отдельный рычаг.`,
  effects: [{ kind: "massFactor", node: "wing.box", factor: 1 - savingPct / 100 }],
});

/**
 * Композитная механизация: закрылки, предкрылки, элероны, интерцепторы. У A320 элероны и интерцепторы
 * уже из углепластика, поэтому реальный выигрыш меньше, чем у полностью металлической механизации.
 */
export const compositeHighLift = (savingPct = 15): Lever => ({
  id: "composite-high-lift",
  label: "Композитная механизация",
  rationale: `Масса механизации × ${(1 - savingPct / 100).toFixed(2)}. Допущение: у A320 элероны и интерцепторы уже композитные, выигрыш даёт в основном закрылки и предкрылки.`,
  effects: [{ kind: "massFactor", node: "wing.highLift", factor: 1 - savingPct / 100 }],
});

// ——— Механизация ———
// Массы — через долю узла «механизация»: закрылки с каретками ≈60%, предкрылки ≈20% (допущение, highlift.ts).
// Опорная механизация — A320: однощелевые закрылки Фаулера на 26% хорды и предкрылки.
const A320_FLAP_CHORD = 0.26;

/** Двухщелевые закрылки, как у A321: больше прирост CLmax, тяжелее каретки. */
export const doubleSlottedFlaps = (on: boolean): Lever => ({
  id: "flap-type",
  label: on ? "Двухщелевые закрылки" : "Однощелевые закрылки",
  rationale: on
    ? `Прирост Cl профиля 1,6 вместо 1,3 (Raymer, табл. 12.2), выдвижение 0,8 хорды закрылка; масса закрылков × ${DOUBLE_SLOTTED_MASS} (допущение).`
    : "Однощелевые закрылки Фаулера, как у A320.",
  effects: [
    { kind: "definition", apply: (d) => ({ ...d, wing: { ...d.wing, highLift: { ...d.wing.highLift, flapType: on ? "double" : "single" } } }) },
    ...(on ? [{ kind: "massFactor" as const, node: "wing.highLift", factor: 1 + HIGHLIFT_MASS_SHARES.flaps * (DOUBLE_SLOTTED_MASS - 1) }] : []),
  ],
});

/** Хорда закрылков в долях хорды крыла: прирост CLmax ∝ выдвижению, масса закрылков ∝ площади. */
export const flapChord = (pct: number): Lever => ({
  id: "flap-chord",
  label: "Хорда закрылков",
  rationale: `${pct}% хорды крыла (A320 — 26%). Масса закрылков пропорциональна их площади; кессон между лонжеронами не меняется.`,
  effects: [
    { kind: "definition", apply: (d) => ({ ...d, wing: { ...d.wing, highLift: { ...d.wing.highLift, flapChordFraction: pct / 100 } } }) },
    { kind: "massFactor", node: "wing.highLift", factor: 1 + HIGHLIFT_MASS_SHARES.flaps * (pct / 100 / A320_FLAP_CHORD - 1) },
  ],
});

/** Без предкрылков: легче, но меньше CLmax и выше скорости взлёта и захода. */
export const slats = (on: boolean): Lever => ({
  id: "slats",
  label: on ? "Предкрылки" : "Без предкрылков",
  rationale: on ? "Предкрылки по всему размаху, как у A320." : `Масса механизации × ${(1 - HIGHLIFT_MASS_SHARES.slats).toFixed(1)}; прирост CLmax от предкрылков теряется.`,
  effects: [
    { kind: "definition", apply: (d) => ({ ...d, wing: { ...d.wing, highLift: { ...d.wing.highLift, slats: on } } }) },
    ...(on ? [] : [{ kind: "massFactor" as const, node: "wing.highLift", factor: 1 - HIGHLIFT_MASS_SHARES.slats }]),
  ],
});

/** Тип законцовок: шарклеты (размах 35,8 м, ≈200 кг на пару) или «заборчики» A320ceo. */
export const wingTip = (tip: "fence" | "sharklet"): Lever => ({
  id: "wing-tip",
  label: tip === "sharklet" ? "Шарклеты" : "Законцовки-«заборчики»",
  rationale:
    tip === "sharklet"
      ? "Законцовки как у A320neo: размах 35,8 м для индуктивного сопротивления, масса пары ≈200 кг (оценка по графикам AC)."
      : "Законцовки как у A320ceo: размах 34,1 м.",
  effects: [{ kind: "definition", apply: (d) => ({ ...d, wing: { ...d.wing, tip } }) }],
});

/** Подъём двигателя (пилон, установка): возвращает клиренс, съеденный большим вентилятором. */
export const nacelleRaise = (m: number): Lever => ({
  id: "nacelle-raise",
  label: "Подъём двигателя",
  rationale: `Двигатель выше на ${Math.round(m * 100)} см. Влияние на массу пилона и шасси не учитывается.`,
  effects: [{ kind: "definition", apply: (d) => ({ ...d, engine: { ...d.engine, nacelleRaiseM: m } }) }],
});

/** Облегчённые электрожгуты (например, алюминий вместо меди, оптимизация трасс). */
export const lighterHarness = (savingPct = 15): Lever => ({
  id: "lighter-harness",
  label: "Облегчение кабельной сети",
  rationale: `Масса бортовой кабельной сети × ${(1 - savingPct / 100).toFixed(2)}. Ориентиры: алюминиевые жилы вместо медных — до −30% массы проводников, проекты ЕС по сокращению проводки — ≈−350 кг на самолёт; больше −30…40% — уже смена архитектуры (шины данных, распределённое питание).`,
  effects: [{ kind: "massFactor", node: "electrical.harness", factor: 1 - savingPct / 100 }],
});

/** Общее повышение аэродинамического качества: сопротивление делится на (1 + x). */
export const aeroQuality = (ldGainPct = 2): Lever => ({
  id: "aero-quality",
  label: "Повышение аэродинамического качества",
  rationale: `Полное сопротивление / ${(1 + ldGainPct / 100).toFixed(3)}: L/D растёт на ${ldGainPct}% при той же подъёмной силе.`,
  effects: [{ kind: "aero", dragFactor: 1 / (1 + ldGainPct / 100) }],
});

/** Изменение размаха: пересчитываются и масса крыла (через удлинение), и индуктивное сопротивление. */
export const wingSpan = (deltaM: number): Lever => ({
  id: "wing-span",
  label: "Удлинение крыла",
  rationale: `Размах ${deltaM >= 0 ? "+" : ""}${deltaM} м при той же площади.`,
  effects: [
    {
      kind: "definition",
      apply: (d) => ({ ...d, wing: { ...d.wing, spanM: d.wing.spanM + deltaM, sharkletSpanM: d.wing.sharkletSpanM + deltaM } }),
    },
  ],
});

/**
 * Двухконтурность при той же тяге: диаметр вентилятора и масса двигателя — по линии реальных
 * двигателей (CFM56 → LEAP), гондола масштабируется по диаметру, TSFC — через пропульсивный КПД.
 */
export const bypassRatio = (bpr: number): Lever => ({
  id: "bypass-ratio",
  label: "Двухконтурность",
  rationale: `Степень двухконтурности ${bpr}. Действует в диапазоне ${BPR_VALID_RANGE[0]}–${BPR_VALID_RANGE[1]}, за его пределами — экстраполяция.`,
  effects: [
    {
      kind: "definition",
      apply: (d) => {
        const fan = fanDiameterForBpr(bpr);
        const ratio = fan / d.engine.fanDiameterM;
        return {
          ...d,
          engine: {
            ...d.engine,
            bypassRatio: bpr,
            fanDiameterM: fan,
            dryMassKg: dryMassForBpr(bpr),
            nacelleLengthM: d.engine.nacelleLengthM * ratio,
            nacelleWidthM: d.engine.nacelleWidthM * ratio,
          },
        };
      },
    },
  ],
});

/**
 * Взлётная тяга двигателя (тот же цикл, другой размер): тяга × k, сухая масса × k (линейно по CFM56/LEAP
 * в узком диапазоне), диаметр вентилятора и гондола × √k (тяга ∝ расходу ∝ площади). TSFC не меняется.
 */
export const thrustRating = (pct: number): Lever => ({
  id: "thrust-rating",
  label: "Тяга двигателя",
  rationale: `Взлётная тяга ${pct}% от базовой. Масса двигателя пропорциональна тяге, диаметр — корню из тяги.`,
  effects: [
    {
      kind: "definition",
      apply: (d) => {
        const k = pct / 100;
        const r = Math.sqrt(k);
        return {
          ...d,
          engine: {
            ...d.engine,
            thrustScale: d.engine.thrustScale * k,
            dryMassKg: d.engine.dryMassKg * k,
            fanDiameterM: d.engine.fanDiameterM * r,
            nacelleLengthM: d.engine.nacelleLengthM * r,
            nacelleWidthM: d.engine.nacelleWidthM * r,
          },
        };
      },
    },
  ],
});

/** Профиль крыла: константа Корна — обычный 0,87, с нагруженной хвостовой частью ≈0,91, суперкритический 0,95. */
export const airfoilKappa = (kappa: number): Lever => ({
  id: "airfoil",
  label: "Профиль крыла",
  rationale: `κ = ${kappa} в уравнении Корна: чем выше, тем позже начинается волновое сопротивление (обычный 0,87, суперкритический 0,95).`,
  effects: [
    {
      kind: "definition",
      apply: (d) => ({
        ...d,
        wing: { ...d.wing, airfoil: { kind: kappa >= 0.93 ? "supercritical" : kappa >= 0.9 ? "aft-loaded" : "conventional", kornKappa: kappa } },
      }),
    },
  ],
});

/** Установка двигателя: на пилоне впереди крыла или вплотную под крылом (как у 737) — интерференция гондолы 1,3 / 1,5. */
export const engineInstallation = (closeCoupled: boolean): Lever => ({
  id: "installation",
  label: closeCoupled ? "Гондола вплотную под крылом" : "Гондола на пилоне",
  rationale: closeCoupled ? "Интерференция гондолы с крылом Q = 1,5 вместо 1,3 (Raymer, табл. 12.6) — так ставят двигатели на низкий 737." : "Пилон выносит гондолу вперёд от крыла: Q = 1,3.",
  effects: [{ kind: "definition", apply: (d) => ({ ...d, engine: { ...d.engine, installation: closeCoupled ? "close-coupled" : "pylon" } }) }],
});

// ——— Двигатель: конкретные инженерные решения, каждое — параметр цикла (cycle.ts) ———
const cycleLever = (id: string, label: string, rationale: string, patch: (c: AircraftDefinition["engine"]["cycle"]) => Partial<AircraftDefinition["engine"]["cycle"]>): Lever => ({
  id,
  label,
  rationale,
  effects: [{ kind: "definition", apply: (d) => ({ ...d, engine: { ...d.engine, cycle: { ...d.engine.cycle, ...patch(d.engine.cycle) } } }) }],
});

/** Степень сжатия: больше ступеней и/или выше напор на ступень. */
export const pressureRatio = (opr: number): Lever => ({
  id: "pressure-ratio",
  label: "Степень сжатия",
  rationale: `Суммарная степень сжатия ${opr}. Выше — выше тепловой КПД, но при той же температуре перед турбиной выигрыш затухает.`,
  effects: [{ kind: "definition", apply: (d) => ({ ...d, engine: { ...d.engine, overallPressureRatio: opr } }) }],
});

/** Температура газа перед турбиной: монокристаллические лопатки, термобарьерные покрытия, керамика (CMC). */
export const turbineTemperature = (k: number): Lever =>
  cycleLever("t4", "Температура перед турбиной", `${k} К в крейсере. Позволяют материалы лопаток ТВД: монокристаллы, покрытия, CMC.`, () => ({ t4K: k }));

/** Доля воздуха на охлаждение турбины: каналы охлаждения, покрытия, CMC вместо охлаждаемого металла. */
export const coolingAir = (pct: number): Lever =>
  cycleLever("cooling", "Воздух на охлаждение турбины", `${pct}% воздуха ядра идёт мимо камеры сгорания на охлаждение.`, () => ({ coolingFrac: pct / 100 }));

/** КПД вентилятора: широкохордные лопатки без полок, 3D-профилирование, композиты. */
export const fanEfficiency = (eff: number): Lever =>
  cycleLever("fan-eff", "КПД вентилятора", `Политропный КПД ${eff}. Широкохордные лопатки без антивибрационных полок, 3D-профиль.`, () => ({ fanEff: eff }));

/** КПД компрессоров: 3D-аэродинамика лопаток, моноколёса (блиски), меньшие зазоры. */
export const compressorEfficiency = (eff: number): Lever =>
  cycleLever("comp-eff", "КПД компрессоров", `Политропный КПД ${eff}. 3D-аэродинамика лопаток, блиски, активное управление зазорами.`, () => ({ compEff: eff }));

/** КПД турбин: 3D-профили, уплотнения, управление зазорами. Задаёт КПД ТВД, ТНД сдвигается на ту же величину. */
export const turbineEfficiency = (hpt: number): Lever =>
  cycleLever("turb-eff", "КПД турбин", `Политропный КПД ТВД ${hpt}, ТНД — на ту же разницу. 3D-профили, уплотнения, управление зазорами.`, (c) => ({
    hptEff: hpt,
    lptEff: c.lptEff + (hpt - c.hptEff),
  }));

/**
 * Редуктор вентилятора: ТНД вращается быстрее и работает с более высоким КПД (+0,015 — допущение), в редукторе
 * теряется ≈0,5% мощности. Масса редуктора и сэкономленных ступеней ТНД в модели не учитывается — открытых данных нет.
 */
export const gearedFan = (on: boolean): Lever =>
  cycleLever(
    "gearbox",
    on ? "Редуктор вентилятора" : "Прямой привод вентилятора",
    on ? "ТНД быстроходная: КПД +0,015 (допущение), потери в редукторе 0,5%. Масса редуктора не учитывается." : "Вентилятор на одном валу с ТНД.",
    (c) => (on === c.gearbox ? {} : { gearbox: on, lptEff: c.lptEff + (on ? 0.015 : -0.015) }),
  );

/**
 * Удлинение фюзеляжа: целые ряды кресел в цилиндрической части. Растут масса фюзеляжа (Raymer),
 * объём гермокабины, салон и плечи оперения (половина вставки — перед крылом, половина — за ним).
 * MTOW и MZFW в режиме «та же геометрия» не меняются — как у A321 без усиления это и упрётся в массы.
 */
export const fuselageStretch = (rows: number): Lever => ({
  id: "fuselage-stretch",
  label: "Длина фюзеляжа",
  rationale: `${rows >= 0 ? "+" : ""}${rows} рядов кресел.`,
  effects: [
    {
      kind: "definition",
      apply: (d) => {
        const dl = rows * d.systems.seatPitchM;
        const cabinLength = 27.5; // AC: длина салона A320 ≈ 27,5 м
        return {
          ...d,
          fuselage: {
            ...d.fuselage,
            lengthM: d.fuselage.lengthM + dl,
            pressurizedVolumeM3: d.fuselage.pressurizedVolumeM3 * (1 + dl / cabinLength),
          },
          htail: { ...d.htail, armM: d.htail.armM + dl / 2 },
          vtail: { ...d.vtail, armM: d.vtail.armM + dl / 2 },
          systems: {
            ...d.systems,
            seats: d.systems.seats + rows * d.systems.seatsAbreast,
            cargoMassKg: d.systems.cargoMassKg * (1 + dl / cabinLength),
          },
        };
      },
    },
  ],
});

/** Относительная толщина крыла у корня: тоньше — легче волновое сопротивление, но тяжелее крыло (Raymer: (t/c)^−0,4). */
export const wingThickness = (rootPct: number): Lever => ({
  id: "wing-thickness",
  label: "Толщина профиля крыла",
  rationale: `Относительная толщина у корня ${rootPct}% (средняя по размаху — ×0,75). Меняет волновое сопротивление (Корн), массу крыла (Raymer) и объём баков в крыле (≈80% топлива).`,
  effects: [
    {
      kind: "definition",
      // Баки в крыле (≈80% топлива A320) — объём ∝ толщине профиля.
      apply: (d) => {
        const r = rootPct / d.wing.thicknessRootPct;
        return {
          ...d,
          wing: { ...d.wing, thicknessRootPct: rootPct },
          systems: { ...d.systems, fuelVolumeL: d.systems.fuelVolumeL * (1 - 0.8 * (1 - r)) },
        };
      },
    },
  ],
});

/** Крейсерское число Маха: быстрее — больше волновое сопротивление и расход, но короче рейс (время не стоит в модели). */
export const cruiseMach = (mach: number): Lever => ({
  id: "cruise-mach",
  label: "Крейсерское число Маха",
  rationale: `M ${mach}. TSFC от числа Маха не зависит (допущение); растут волновое сопротивление и скоростной напор.`,
  effects: [{ kind: "mission", cruiseMach: mach }],
});
