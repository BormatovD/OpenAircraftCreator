// Панель рычагов и сценарии — тоже данные. Каждая строка панели знает своё значение по умолчанию
// (из определения выбранного самолёта) и как превратить положение ползунка в рычаг расчётного ядра.

import { type AircraftDefinition } from "../src/definition.ts";
import {
  type Lever,
  aeroQuality,
  cruiseMach,
  wingThickness,
  bypassRatio,
  compositeHighLift,
  compositeWing,
  pressureRatio,
  turbineTemperature,
  coolingAir,
  fanEfficiency,
  compressorEfficiency,
  turbineEfficiency,
  gearedFan,
  airfoilKappa,
  engineInstallation,
  thrustRating,
  fuselageStretch,
  lighterHarness,
  nacelleRaise,
  wingSpan,
  wingTip,
  doubleSlottedFlaps,
  flapChord,
  slats,
} from "../src/levers.ts";
import { BPR_VALID_RANGE } from "../src/propulsion.ts";

export type Mode = "fixed" | "redesign";

interface Common {
  id: string;
  group: string;
  label: string;
  hint: string;
  /** Узлы дерева масс, которые рычаг меняет напрямую, — подсвечиваются в 3D. */
  parts: string[];
  /** Что показывать в «рентгене», если отличается от parts (например, кресла без обшивки). */
  focus?: string[];
}
export interface RangeControl extends Common {
  kind: "range";
  min: number;
  max: number;
  step: number;
  base: (d: AircraftDefinition) => number;
  format: (v: number) => string;
  toLever: (v: number) => Lever;
}
export interface ToggleControl extends Common {
  kind: "toggle";
  base: (d: AircraftDefinition) => boolean;
  toLever: (on: boolean) => Lever;
}
export type Control = RangeControl | ToggleControl;
export type Values = Record<string, number | boolean>;

const num = (v: number, digits = 1) => v.toLocaleString("ru-RU", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const signed = (v: number, digits = 1) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${num(Math.abs(v), digits)}`;

export const CONTROLS: Control[] = [
  {
    id: "compositeBox",
    group: "Крыло",
    kind: "toggle",
    label: "Композитный кессон",
    hint: "−20% массы кессона и панелей",
    parts: ["wing.box"],
    base: () => false,
    toLever: () => compositeWing(20),
  },
  {
    id: "compositeHighLift",
    group: "Крыло",
    kind: "toggle",
    label: "Композитная механизация",
    hint: "−15% массы закрылков, предкрылков, элеронов",
    parts: ["wing.highLift"],
    base: () => false,
    toLever: () => compositeHighLift(15),
  },
  {
    id: "span",
    group: "Крыло",
    kind: "range",
    label: "Размах",
    hint: "при той же площади: меньше индуктивное сопротивление, тяжелее крыло",
    parts: ["wing.box", "wing.highLift", "wingtips"],
    min: -2,
    max: 5,
    step: 0.1,
    base: () => 0,
    format: (v) => `${signed(v)} м`,
    toLever: (v) => wingSpan(v),
  },
  {
    id: "thickness",
    group: "Крыло",
    kind: "range",
    label: "Толщина профиля",
    hint: "у корня; тоньше — меньше волновое сопротивление, но тяжелее крыло и меньше баки",
    parts: ["wing.box", "fuel"],
    min: 10,
    max: 18,
    step: 0.5,
    base: (d) => d.wing.thicknessRootPct,
    format: (v) => `${num(v)}%`,
    toLever: (v) => wingThickness(v),
  },
  {
    id: "sharklets",
    group: "Крыло",
    kind: "toggle",
    label: "Шарклеты",
    hint: "вместо «заборчиков»: размах 35,8 м, +200 кг",
    parts: ["wingtips"],
    base: (d) => d.wing.tip === "sharklet",
    toLever: (on) => wingTip(on ? "sharklet" : "fence"),
  },
  {
    id: "airfoil",
    group: "Крыло",
    kind: "range",
    label: "Профиль крыла (κ Корна)",
    hint: "обычный 0,87 — суперкритический 0,95; выше — позже волновое сопротивление",
    parts: ["wing.box"],
    min: 0.85,
    max: 0.97,
    step: 0.005,
    base: (d) => d.wing.airfoil.kornKappa,
    format: (v) => num(v, 3),
    toLever: (v) => airfoilKappa(v),
  },
  {
    id: "doubleFlaps",
    group: "Механизация",
    kind: "toggle",
    label: "Двухщелевые закрылки",
    hint: "как у A321: выше CLmax — ниже скорости взлёта и захода; тяжелее",
    parts: ["wing.highLift"],
    base: (d) => d.wing.highLift.flapType === "double",
    toLever: (on) => doubleSlottedFlaps(on),
  },
  {
    id: "flapChord",
    group: "Механизация",
    kind: "range",
    label: "Хорда закрылков",
    hint: "доля хорды крыла; больше — выше CLmax, тяжелее закрылки",
    parts: ["wing.highLift"],
    min: 18,
    max: 36,
    step: 1,
    base: (d) => Math.round(d.wing.highLift.flapChordFraction * 100),
    format: (v) => `${num(v, 0)}%`,
    toLever: (v) => flapChord(v),
  },
  {
    id: "slats",
    group: "Механизация",
    kind: "toggle",
    label: "Предкрылки",
    hint: "по всему размаху; без них легче, но быстрее взлёт и заход",
    parts: ["wing.highLift"],
    base: (d) => d.wing.highLift.slats,
    toLever: (on) => slats(on),
  },
  {
    id: "bpr",
    group: "Двигатель",
    kind: "range",
    label: "Двухконтурность",
    hint: `больше вентилятор и гондола, выше пропульсивный КПД; данные — ${BPR_VALID_RANGE[0]}–${BPR_VALID_RANGE[1]}`,
    parts: ["engines", "nacelles"],
    min: 4,
    max: 15,
    step: 0.1,
    base: (d) => d.engine.bypassRatio,
    format: (v) => num(v),
    toLever: (v) => bypassRatio(v),
  },
  {
    id: "opr",
    group: "Двигатель",
    kind: "range",
    label: "Степень сжатия",
    hint: "больше ступеней и напор на ступень; выше — выше тепловой КПД",
    parts: ["engines"],
    min: 20,
    max: 60,
    step: 0.5,
    base: (d) => d.engine.overallPressureRatio,
    format: (v) => num(v),
    toLever: (v) => pressureRatio(v),
  },
  {
    id: "t4",
    group: "Двигатель",
    kind: "range",
    label: "Температура перед турбиной",
    hint: "в крейсере, К; позволяют монокристаллические лопатки, покрытия, керамика (CMC)",
    parts: ["engines"],
    min: 1350,
    max: 1900,
    step: 10,
    base: (d) => d.engine.cycle.t4K,
    format: (v) => `${num(v, 0)} К`,
    toLever: (v) => turbineTemperature(v),
  },
  {
    id: "cooling",
    group: "Двигатель",
    kind: "range",
    label: "Воздух на охлаждение турбины",
    hint: "% воздуха ядра мимо камеры сгорания; меньше — лучше материалы и каналы",
    parts: ["engines"],
    min: 6,
    max: 24,
    step: 1,
    base: (d) => Math.round(d.engine.cycle.coolingFrac * 100),
    format: (v) => `${num(v, 0)}%`,
    toLever: (v) => coolingAir(v),
  },
  {
    id: "fanEff",
    group: "Двигатель",
    kind: "range",
    label: "КПД вентилятора",
    hint: "политропный; широкохордные лопатки без полок, 3D-профиль, композит",
    parts: ["engines"],
    min: 0.82,
    max: 0.94,
    step: 0.005,
    base: (d) => d.engine.cycle.fanEff,
    format: (v) => num(v, 3),
    toLever: (v) => fanEfficiency(v),
  },
  {
    id: "compEff",
    group: "Двигатель",
    kind: "range",
    label: "КПД компрессоров",
    hint: "политропный; 3D-аэродинамика лопаток, блиски, управление зазорами",
    parts: ["engines"],
    min: 0.83,
    max: 0.93,
    step: 0.005,
    base: (d) => d.engine.cycle.compEff,
    format: (v) => num(v, 3),
    toLever: (v) => compressorEfficiency(v),
  },
  {
    id: "turbEff",
    group: "Двигатель",
    kind: "range",
    label: "КПД турбин",
    hint: "политропный КПД ТВД (ТНД — на ту же разницу); 3D-профили, уплотнения",
    parts: ["engines"],
    min: 0.83,
    max: 0.93,
    step: 0.005,
    base: (d) => d.engine.cycle.hptEff,
    format: (v) => num(v, 3),
    toLever: (v) => turbineEfficiency(v),
  },
  {
    id: "gearbox",
    group: "Двигатель",
    kind: "toggle",
    label: "Редуктор вентилятора",
    hint: "как у PW1100G: быстрая ТНД с высоким КПД, потери в редукторе 0,5%",
    parts: ["engines"],
    base: (d) => d.engine.cycle.gearbox,
    toLever: (on) => gearedFan(on),
  },
  {
    id: "thrust",
    group: "Двигатель",
    kind: "range",
    label: "Взлётная тяга",
    hint: "% от базовой; больше — выше потолок и запас на взлёте, но тяжелее и крупнее двигатель",
    parts: ["engines", "nacelles"],
    min: 85,
    max: 125,
    step: 1,
    base: () => 100,
    format: (v) => `${num(v, 0)}%`,
    toLever: (v) => thrustRating(v),
  },
  {
    id: "installation",
    group: "Двигатель",
    kind: "toggle",
    label: "Гондола вплотную под крылом",
    hint: "как у 737: больше интерференция с крылом (Q 1,5 вместо 1,3)",
    parts: ["nacelles"],
    base: (d) => d.engine.installation === "close-coupled",
    toLever: (on) => engineInstallation(on),
  },
  {
    id: "raise",
    group: "Двигатель",
    kind: "range",
    label: "Подъём двигателя",
    hint: "возвращает клиренс под большим вентилятором",
    parts: ["nacelles"],
    min: 0,
    max: 0.4,
    step: 0.01,
    base: (d) => d.engine.nacelleRaiseM,
    format: (v) => `${Math.round(v * 100)} см`,
    toLever: (v) => nacelleRaise(v),
  },
  {
    id: "rows",
    group: "Фюзеляж и системы",
    kind: "range",
    label: "Длина фюзеляжа",
    hint: "ряды по 6 кресел; MTOW и MZFW — по режиму пересчёта",
    parts: ["fuselage", "furnishings"],
    focus: ["furnishings", "operatorItems"],
    min: -6,
    max: 12,
    step: 1,
    base: () => 0,
    format: (v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v)} ряд${ruRows(Math.abs(v))}`,
    toLever: (v) => fuselageStretch(v),
  },
  {
    id: "harness",
    group: "Фюзеляж и системы",
    kind: "range",
    label: "Облегчение кабельной сети",
    hint: "алюминиевые жилы, тонкая изоляция, шины данных вместо отдельных линий; меньше дублирующих жгутов",
    parts: ["electrical.harness"],
    min: 0,
    max: 50,
    step: 5,
    base: () => 0,
    format: (v) => (v ? `−${v}%` : "0%"),
    toLever: (v) => lighterHarness(v),
  },
  {
    id: "aero",
    group: "Аэродинамика",
    kind: "range",
    label: "Аэродинамическое качество",
    hint: "общее снижение сопротивления: риблеты, зализы, герметизация щелей",
    parts: [],
    min: 0,
    max: 6,
    step: 0.5,
    base: () => 0,
    format: (v) => `+${num(v)}%`,
    toLever: (v) => aeroQuality(v),
  },
  {
    id: "mach",
    group: "Аэродинамика",
    kind: "range",
    label: "Крейсерское число Маха",
    hint: "быстрее — растут волновое сопротивление и удельный расход; медленнее — растёт индуктивное",
    parts: [],
    min: 0.7,
    max: 0.84,
    step: 0.01,
    base: () => 0.78,
    format: (v) => `M ${num(v, 2)}`,
    toLever: (v) => cruiseMach(v),
  },
];

function ruRows(n: number): string {
  const d = n % 10;
  const dd = n % 100;
  if (d === 1 && dd !== 11) return "";
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return "а";
  return "ов";
}

export function defaults(def: AircraftDefinition): Values {
  const v: Values = {};
  for (const c of CONTROLS) v[c.id] = c.base(def);
  return v;
}

export function isChanged(c: Control, def: AircraftDefinition, value: number | boolean): boolean {
  if (c.kind === "toggle") return value !== c.base(def);
  return Math.abs((value as number) - c.base(def)) > c.step / 2;
}

/** Рычаги для ядра — только те, что сдвинуты от значений выбранного самолёта. */
export function leversFor(def: AircraftDefinition, values: Values): Lever[] {
  const out: Lever[] = [];
  for (const c of CONTROLS) {
    const v = values[c.id];
    if (!isChanged(c, def, v)) continue;
    out.push(c.kind === "toggle" ? c.toLever(v as boolean) : c.toLever(v as number));
  }
  return out;
}

export interface Scenario {
  id: string;
  title: string;
  text: string;
  aircraft: string;
  mode: Mode;
  values: Values;
  /** С чем сравнить итог (другой самолёт без рычагов). */
  compareWith?: string;
}

export const SCENARIOS: Scenario[] = [
  {
    id: "ceo-neo",
    title: "CEO → NEO своими руками",
    text:
      "На A320ceo ставим то, что изменилось в LEAP: двухконтурность 11, степень сжатия 40, горячую турбину с керамикой и меньшим охлаждением, " +
      "углепластиковый вентилятор и 3D-лопатки компрессора и турбин, плюс шарклеты. Расход на место выходит как у A320neo. " +
      "Разница в нагрузке — Airbus ещё поднял MZFW на 2,3 т. Уберите подъём двигателя — клиренс станет жёлтым.",
    aircraft: "a320ceo",
    mode: "fixed",
    values: { bpr: 11, opr: 40, t4: 1700, cooling: 13, fanEff: 0.9, compEff: 0.9, turbEff: 0.89, sharklets: true, raise: 0.06 },
    compareWith: "a320neo",
  },
  {
    id: "composite",
    title: "Композитное крыло",
    text:
      "Кессон и механизация из углепластика. В режиме перепроектирования облегчение уменьшает топливо на ту же миссию, " +
      "а с ним — крыло, двигатели и MTOW: эффект снежного кома. Переключите режим, чтобы увидеть разницу.",
    aircraft: "a320ceo",
    mode: "redesign",
    values: { compositeBox: true, compositeHighLift: true },
  },
  {
    id: "ewis",
    title: "Лёгкая кабельная сеть",
    text:
      "Проводка — около 1,85 т на A320 (оценка для узкофюзеляжника — ≈2 т): её доля есть в каждой системе. " +
      "Облегчение на 40% — алюминиевые жилы, тонкая изоляция и шины данных вместо дублирующих линий — снимает ≈740 кг. " +
      "Наведите на рычаг: в «рентгене» видно, как в пучках становится меньше проводов.",
    aircraft: "a320ceo",
    mode: "fixed",
    values: { harness: 40 },
  },
  {
    id: "a321",
    title: "Путь к A321",
    text:
      "+9 рядов, +54 места. С той же геометрией самолёт упирается в MZFW и угол касания хвостом. " +
      "В режиме «под ту же миссию» (все места на ту же дальность) получается MTOW около 89 т — это класс A321, но крыло под ту же скорость захода " +
      "вырастает до ≈149 м², а размах — за код C. Включите двухщелевые закрылки: крыло нужно ≈134 м², размах снова в коде C. Так и сделал Airbus.",
    aircraft: "a320ceo",
    mode: "fixed",
    values: { rows: 9 },
  },
];
