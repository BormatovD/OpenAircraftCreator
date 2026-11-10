// Страница «Как рассчитано»: формулы, допущения и источники. Числа в таблицах не вписаны руками —
// они считаются тем же ядром, что и модель, поэтому страница не расходится с расчётом.

import katex from "katex";
import { A320CEO, A320NEO, AC_OEW_KG } from "../src/aircraft/a320.ts";
import { A320_CONTEXT as CTX } from "../src/aircraft/a320Context.ts";
import { aspectRatio, maxLiftToDrag } from "../src/aero.ts";
import { flightLevelToM, isa } from "../src/atmosphere.ts";
import { tsfcToImperial } from "../src/calibrate.ts";
import { type AircraftDefinition } from "../src/definition.ts";
import { type Evaluation, aeroFor, evaluate } from "../src/evaluate.ts";
import { KORN_KAPPA, MISC_SHARE, dragBuildup, waveDrag, waveParams } from "../src/drag.ts";
import { cruiseMach as cruiseMachLever } from "../src/levers.ts";
import { NODES, computeMasses } from "../src/mass/massTree.ts";
import { DEFAULT_ASSUMPTIONS as AS, LHV_JET_A } from "../src/mission.ts";
import { dryMassForBpr, engineCycle, fanDiameterForBpr, tsfcFactor, tsfcMachFactor } from "../src/propulsion.ts";
import { runCycle } from "../src/cycle.ts";
import { B737_300 } from "../src/aircraft/b737.ts";
import { CONTROLS } from "./controls.ts";
import { relativeOewErrorPct, validateFamily } from "../src/validation.ts";
import vb from "../data/validation-boeing.json" with { type: "json" };
import { boeingCases } from "../src/validation.ts";
import { MAX_CERT_FL, TAKEOFF_POLAR, TOC_MASS_FRACTION, thrustLapse } from "../src/thrust.ts";
import { AIRFOIL_CLMAX, DOUBLE_SLOTTED_MASS, FLAP_DCL, HIGHLIFT_MASS_SHARES, LANDING_FLAP_DEG, SLAT_DCL, TAKEOFF_SHARE, VAPP_FACTOR, highLiftPerf, highLiftRaw } from "../src/highlift.ts";
import { coreRadiusFor, lptStagesFor } from "./scene/shapes.ts";

const tex = (s: string, display = true) => katex.renderToString(s, { output: "mathml", displayMode: display, throwOnError: false });
const t = (s: string) => tex(s, false);
const nf = (v: number, d = 0) => v.toLocaleString("ru-RU", { minimumFractionDigits: d, maximumFractionDigits: d }).replace("-", "−");
/** Число для формулы: запятая — в фигурных скобках, разряды — тонкой шпацией. */
const L = (v: number, d = 0) => nf(v, d).replace(/\s/g, "\\,").replace(",", "{,}");
/** Подстановка значений текущего варианта под формулой — мелко и серым, рядом с теорией. */
let NOW = "";
const now = (latex: string, note = "") =>
  `<div class="subst"><span class="subst-tag">${NOW}</span>${tex(latex, false)}${note ? `<span class="subst-note">${note}</span>` : ""}</div>`;

interface Source {
  id: string;
  title: string;
  url?: string;
  note: string;
}

export const SOURCES: Source[] = [
  {
    id: "ac-a320",
    title: "Airbus. A320 Aircraft Characteristics — Airport and Maintenance Planning (июнь 2024)",
    url: "https://aircraft.airbus.com/sites/g/files/jlcbta126/files/2024-06/AC_A320_0624.pdf",
    note: "Размеры, массы (MTOW, MZFW, OEW), топливо, клиренсы, диаграммы нагрузка–дальность 3-2-1",
  },
  {
    id: "ac-a319",
    title: "Airbus. A319 Aircraft Characteristics — Airport and Maintenance Planning (июль 2026)",
    url: "https://aircraft.airbus.com/en/customer-care/fleet-wide-care/airport-operations-and-aircraft-characteristics/aircraft-characteristics",
    note: "Массы, топливо, места, диаграммы нагрузка–дальность A319ceo и A319neo (2-1-1, 2-4-1, 3-2-1)",
  },
  {
    id: "b737",
    title: "Boeing. D6-58325-6 737 Airplane Characteristics for Airport Planning, ред. E (ноябрь 2023)",
    url: "https://www.boeing.com/commercial/airports/plan-manuals",
    note: "737-300: массы, OEW, топливо, размеры (2.1.6, 2.2.3), нагрузка–дальность (3.2.6)",
  },
  {
    id: "b737max",
    title: "Boeing. D6-38A004 737 MAX Airplane Characteristics for Airport Planning, ред. K (июль 2025)",
    url: "https://www.boeing.com/commercial/airports/plan-manuals",
    note: "737-8: массы, топливо, размеры (2.1.2, 2.2.2), нагрузка–дальность (3.2.3)",
  },
  {
    id: "b757",
    title: "Boeing. D6-58327 757 Airplane Characteristics for Airport Planning, ред. H (декабрь 2024)",
    url: "https://www.boeing.com/commercial/airports/plan-manuals",
    note: "757-200: массы, OEW, топливо, размеры (2.1.1–2.2.1), нагрузка–дальность для RB211-535E4 и PW2037 (3.2.2–3.2.3)",
  },
  {
    id: "ac-a321",
    title: "Airbus. A321 Aircraft Characteristics — Airport and Maintenance Planning (июнь 2024)",
    url: "https://aircraft.airbus.com/sites/g/files/jlcbta126/files/2024-06/AC_A321_0624.pdf",
    note: "Удлинение фюзеляжа A321; массы, топливо, места, диаграммы нагрузка–дальность A321ceo и A321neo (2-1-1, 2-4-1, 3-2-1)",
  },
  {
    id: "raymer",
    title: "Raymer D. P. Aircraft Design: A Conceptual Approach. 6-е изд., AIAA, 2018",
    url: "https://search.worldcat.org/title/1048659355",
    note: "Групповые формулы масс транспортных самолётов (гл. 15), параметр взлёта",
  },
  {
    id: "nasa-737",
    title: "NASA TM 20190000431 — сводка масс Boeing 737-200 (FLOPS, колонка Actual)",
    url: "https://ntrs.nasa.gov/citations/20190000431",
    note: "Фактические доли групп масс узкофюзеляжного самолёта — база калибровки",
  },
  {
    id: "poll-1",
    title: "Poll D. I. A., Schumann U. An estimation method for the fuel burn … of civil transport aircraft in the cruise. Part 1",
    url: "https://elib.dlr.de/135592/",
    note: "Поляра, оптимальный CL, общий КПД двигателя — независимая проверка TSFC",
  },
  {
    id: "poll-2",
    title: "Poll, Schumann. Part 2: determining the aircraft's characteristic parameters",
    url: "https://www.cambridge.org/core/services/aop-cambridge-core/content/view/4DA8F322C2CFD62D9BB8C3A4BD4C2E12/S0001924020001244a.pdf/div-class-title-an-estimation-method-for-the-fuel-burn-and-other-performance-characteristics-of-civil-transport-aircraft-during-cruise-part-2-determining-the-aircraft-s-characteristic-parameters-div.pdf",
    note: "CD0 и коэффициент Освальда для A320",
  },
  {
    id: "poll-3",
    title: "Poll, Schumann. Part 3: full flight profile",
    url: "https://elib.dlr.de/212199/",
    note: "Набор, снижение, расход на взлёте",
  },
  {
    id: "torenbeek",
    title: "Torenbeek E. Synthesis of Subsonic Airplane Design — формулы масс механизации (реализация в AeroSandbox)",
    url: "https://aerosandbox.readthedocs.io/en/master/_modules/aerosandbox/library/weights/torenbeek_weights.html",
    note: "Масса закрылков (ур. C-10) и интерцепторов — доля механизации в массе крыла",
  },
  {
    id: "mattingly",
    title: "Mattingly J. D., Heiser W. H., Pratt D. T. Aircraft Engine Design. 2-е изд., AIAA, 2002",
    url: "https://search.worldcat.org/title/49821935",
    note: "Падение тяги ТРДД с высотой и скоростью (гл. 2), параметрический расчёт цикла (гл. 4); типичные КПД узлов и температуры по годам — Mattingly «Elements of Propulsion», табл. 4.4",
  },
  {
    id: "cs25",
    title: "EASA CS-25 Large Aeroplanes, п. 25.107 и 25.121",
    url: "https://www.easa.europa.eu/en/document-library/certification-specifications/group/cs-25-large-aeroplanes",
    note: "V2 ≥ 1,13·V_SR; градиент второго сегмента с отказавшим двигателем ≥ 2,4% для двух двигателей",
  },
  {
    id: "cfm",
    title: "Aircraft Commerce. Owner's & Operator's Guide: CFM56-5A/-5B (выпуск 50)",
    url: "https://www.aircraft-commerce.com/wp-content/uploads/aircraft-commerce-docs1/Aircraft%20guides/CFM56-5A-5B/ISSUE%2050-CFM56-5A-5B%20GUIDE.pdf",
    note: "CFM56-5B4: взлётная тяга 27 000 lbf, плоский режим до 45 °C",
  },
  {
    id: "fcom-7378",
    title: "Boeing 737 MAX Flight Crew Operations Manual, 737-8 LEAP-1B27 (KG), Performance Inflight PI.11 «Long Range Cruise», ред. 26.10.2021 (копия на archive.org)",
    url: "https://archive.org/details/b-737-max-8-fcom",
    note: "таблица Long Range Cruise Control: расход на двигатель при 40–85 т, FL250–410 — data/fcom/b737-8-lrc.json",
  },
  {
    id: "howe",
    title: "Howe D. Aircraft Conceptual Design Synthesis. Professional Engineering Publishing, 2000",
    note: "Зависимость удельного расхода ТРДД от числа Маха и двухконтурности",
  },
  {
    id: "jenkinson",
    title: "Jenkinson L., Simpkin P., Rhodes D. Civil Jet Aircraft Design. Данные самолётов (Elsevier)",
    url: "https://booksite.elsevier.com/9780340741528/appendices/default.htm",
    note: "Площади оперения и закрылков, гондолы, длина ВПП, скорость захода",
  },
  {
    id: "safety-first",
    title: "Airbus Safety First. A320 tail strike at take-off",
    url: "https://safetyfirst.airbus.com/app/themes/mh_newsdesk/documents/archives/a320-tail-strike-at-take-off.pdf",
    note: "Угол касания хвостом A320: 11,7° при обжатых стойках",
  },
  {
    id: "aaib",
    title: "AAIB Bulletin 5/2001, Airbus A321 D-AIRE (со ссылкой на FCOM Bulletin 22/2)",
    url: "https://assets.publishing.service.gov.uk/media/5422f33a40f0b613420003fb/dft_avsafety_pdf_501655.pdf",
    note: "Угол касания хвостом A321: 9,7° — калибровка плеча точки касания",
  },
  {
    id: "icao",
    title: "SKYbrary. ICAO Aerodrome Reference Code",
    url: "https://skybrary.aero/articles/icao-aerodrome-reference-code",
    note: "Код C — размах до 36 м, код D — 36–52 м",
  },
  {
    id: "leap",
    title: "planefyi: CFM LEAP-1A (вторичный справочник)",
    url: "https://planefyi.com/engines/cfm-leap-1a/",
    note: "Сухая масса и степень сжатия LEAP-1A",
  },
  {
    id: "engines-text",
    title: "Данные CFM56-5B и диаметры вентиляторов: Purdue AAE (масса), Aircraft Commerce (68,3 и 78 дюймов)",
    note: "Без прямой ссылки: значения сверены по нескольким вторичным источникам",
  },
];

const ref = (id: string) => {
  const i = SOURCES.findIndex((s) => s.id === id);
  return `<a class="ref" href="#src-${id}">[${i + 1}]</a>`;
};

const table = (head: string[], rows: (string | number)[][], cls = "") =>
  `<div class="table-wrap"><table class="${cls}"><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`)
    .join("")}</tbody></table></div>`;

function massSection(current: Evaluation): string {
  const cm = current.masses;
  const wb = cm.byId.get("wing.box")!;
  const wh = cm.byId.get("wing.highLift")!;
  const kw = cm.factors.get("wing.box") ?? 1;
  const m = computeMasses(A320CEO, CTX.calibration);
  const rows = NODES.filter((n) => n.estimate)
    .map((n) => m.byId.get(n.id)!)
    .filter((n) => n.kg > 0.5)
    .map((n) => [n.label, n.ata ?? "—", nf(n.rawKg), m.factors.has(n.id) ? `×${nf(m.factors.get(n.id)!, 2)}` : "—", nf(n.kg)]);
  rows.push(["<b>Итого OEW</b>", "", nf(m.rawOewKg), "", `<b>${nf(m.oewKg)}</b>`]);
  const neo = computeMasses(A320NEO, CTX.calibration).oewKg;
  return `
  <section id="m-mass">
    <h2>Массы агрегатов</h2>
    <p>Каждый агрегат оценивается групповой формулой Raymer для транспортных самолётов ${ref("raymer")}. Формулы — статистика по самолётам
    1960–90-х, поэтому сами по себе дают завышенную массу; их задача — <b>чувствительность</b>: как масса меняется при изменении размаха,
    площади, MTOW. Пример — крыло (фунты и футы, как в оригинале):</p>
    ${tex(String.raw`W_{\text{крыло}} = 0{,}0051\,(W_{dg} N_z)^{0{,}557}\, S_w^{0{,}649}\, A^{0{,}5}\, (t/c)_{\text{корень}}^{-0{,}4}\,(1+\lambda)^{0{,}1}\,(\cos\Lambda)^{-1}\, S_{csw}^{0{,}1}`)}
    ${now(String.raw`W^R_{\text{кессон}} = ${L(wb.rawKg)}\ \text{кг},\quad W^R_{\text{мех}} = ${L(wh.rawKg)}\ \text{кг}\qquad (MTOW = ${L(current.definition.weights.mtowKg)}\ \text{кг},\ S = ${L(current.definition.wing.areaM2, 1)}\ \text{м}^2,\ b = ${L(current.definition.wing.spanM, 2)}\ \text{м})`)}
    <p>${t(String.raw`W_{dg}`)} — расчётная масса (MTOW), ${t(String.raw`N_z = 1{,}5 \cdot 2{,}5`)} — расчётная перегрузка, ${t("S_w")} — площадь,
    ${t("A")} — удлинение, ${t(String.raw`\lambda`)} — сужение, ${t(String.raw`\Lambda`)} — стреловидность по ¼ хорды, ${t("S_{csw}")} — площадь механизации.</p>

    <h3>Калибровка по аналогу</h3>
    <p>Публичной групповой сводки масс A320 нет. Поэтому доли групп берутся у ближайшего узкофюзеляжника с фактическими данными —
    Boeing 737-200 ${ref("nasa-737")}, — а итог приводится к OEW A320ceo из Airbus AC ${ref("ac-a320")}: ${nf(AC_OEW_KG.a320ceo)} кг.
    Для группы ${t("g")} аналога множитель один на все её узлы:</p>
    ${tex(String.raw`k_g = \frac{\left(OEW_{AC} - W_{\text{фикс}}\right)\, s_g / \sum_h s_h}{\sum_{j \in g} W^{R}_j},\qquad W_i = k_{g(i)}\, W^{R}_i \cdot f_i + \Delta_i`)}
    ${now(String.raw`k_{\text{кессон}} = ${L(kw, 3)}\ \Rightarrow\ W_{\text{кессон}} = ${L(wb.kg)}\ \text{кг},\quad OEW = ${L(current.oewKg)}\ \text{кг}`)}
    <p>${t(String.raw`W_{\text{фикс}}`)} — узлы с собственными данными (двигатели, оборудование эксплуатанта), ${t("s_g")} — доля группы у 737-200,
    ${t("W^R_i")} — оценка Raymer, ${t("f_i")} и ${t(String.raw`\Delta_i`)} — множители и добавки рычагов. Множители считаются один раз для A320ceo
    и дальше не меняются: A320neo получает OEW <b>${nf(neo)} кг</b> без подгонки при ${nf(AC_OEW_KG.a320neo)} кг по AC
    (${nf(((neo - AC_OEW_KG.a320neo) / AC_OEW_KG.a320neo) * 100, 1)}%).</p>

    <h3>Механизация крыла</h3>
    <p>Крыло делится на кессон и механизацию: ${t(String.raw`W_{\text{мех}} = \varphi\, W_{\text{крыло}}`)}, ${t(String.raw`\varphi = ${nf(A320CEO.wing.movablesShareOfWing, 2)}`)}.
    Долю дают закрылки по Torenbeek ${ref("torenbeek")}:</p>
    ${tex(String.raw`m_{\text{закр}} = S_f \cdot 2{,}706\, k_f\, (S_f b_s)^{3/16} \left[\frac{(V_f/100)^2 \sin\delta_f \cos\Lambda_{100}}{(t/c)_{\text{корень}}}\right]^{3/4}`)}
    <p>Для A320 (${t(String.raw`S_f = 21{,}1`)} м² ${ref("jenkinson")}, однощелевые закрылки Фаулера ${t(String.raw`k_f = 1{,}15`)}, 215 уз, 40°) — около 0,78 т,
    с кареткой и обтекателями ×1,2 — 0,94 т; интерцепторы — 1,5% крыла; предкрылки и элероны ≈0,3 т — <b>допущение</b>.
    Итого ≈1,3 т из ≈7,3 т, отсюда 18%.</p>

    <h3>Массы A320ceo</h3>
    ${table(["Агрегат", "ATA", "Raymer, кг", "Поправка", "Итог, кг"], rows, "num")}
  </section>`;
}

function aeroSection(def: AircraftDefinition, current: Evaluation): string {
  const a = aeroFor(def, CTX.aero, []);
  const b = dragBuildup(def);
  const k = CTX.aero.cd0Factor ?? 1;
  const rows = b.components.map((c) => [
    c.label,
    nf(c.swetM2, 0),
    nf(c.reynolds / 1e6, 0),
    nf(c.cf * 1000, 2),
    nf(c.ff, 2),
    nf(c.q, 2),
    nf(c.cd0 * k * 1e4, 1),
  ]);
  rows.push(["Прочее (протуберанцы, щели, пилоны)", "", "", "", "", "", nf(b.misc * k * 1e4, 1)]);
  rows.push(["<b>Итого CD0</b>", "", "", "", "", "", `<b>${nf(b.cd0 * k * 1e4, 1)}</b>`]);
  const cd = current.cruiseDrag;
  const indc = cd.parts.find((x) => x.id === "induced")?.counts ?? 0;
  const wavec = cd.parts.find((x) => x.id === "wave")?.counts ?? 0;
  const cd0c = cd.total - indc - wavec;
  const ca = current.aero;
  const arNow = (ca.spanM * ca.spanM) / ca.wingAreaM2;
  const w = waveParams(def);
  const machRows = [0.74, 0.76, 0.78, 0.8, 0.82].map((m) => {
    const ev = evaluate(def, [cruiseMachLever(m)], CTX);
    return [`M ${nf(m, 2)}`, nf(waveDrag(w, ev.cruiseDrag.cl, m) * 1e4, 1), nf(tsfcMachFactor(def.engine.bypassRatio, m), 3), nf(ev.cruiseDrag.ld, 1), nf(ev.fuelPerSeatPer100KmKg, 3)];
  });
  return `
  <section id="m-aero">
    <h2>Аэродинамика</h2>
    <p>Сопротивление складывается из трёх частей: сопротивление при нулевой подъёмной силе (трение и форма по агрегатам),
    индуктивное (цена подъёмной силы) и волновое (сжимаемость на больших числах Маха):</p>
    ${tex(String.raw`C_D = C_{D0} + \frac{C_L^2}{\pi A e} + C_{D,w}(M, C_L)`)}
    ${now(String.raw`C_D = ${L(cd0c / 1e4, 4)} + ${L(indc / 1e4, 4)} + ${L(wavec / 1e4, 4)} = ${L(cd.total / 1e4, 4)},\qquad C_L = ${L(cd.cl, 3)},\ L/D = ${L(cd.ld, 1)}`, `середина крейсера, M ${nf(cd.mach, 2)}, FL350`)}

    <h3>C<sub>D0</sub> по агрегатам</h3>
    <p>Метод Raymer «component buildup» ${ref("raymer")}: каждый агрегат — турбулентная пластина с поправками на форму и интерференцию:</p>
    ${tex(String.raw`C_{D0} = \frac{\sum_i C_{f,i}\,FF_i\,Q_i\,S_{wet,i}}{S_{ref}}\,(1 + k_{\text{пр}}),\qquad C_f = \frac{0{,}455}{(\lg Re)^{2{,}58}\,(1 + 0{,}144M^2)^{0{,}65}}`)}
    ${tex(String.raw`FF_{\text{несущ}} = \Bigl(1 + \frac{0{,}6}{0{,}35}\frac{t}{c} + 100\Bigl(\frac{t}{c}\Bigr)^4\Bigr)\,1{,}34M^{0{,}18}(\cos\Lambda)^{0{,}28},\quad FF_{\text{фюз}} = 1 + \frac{60}{f^3} + \frac{f}{400},\quad FF_{\text{гонд}} = 1 + \frac{0{,}35}{f}`)}
    ${now(String.raw`C_{D0} = ${L(cd0c / 1e4, 4)}`, cd.parts.filter((x) => x.id !== "induced" && x.id !== "wave").map((x) => `${x.label.toLowerCase()} ${nf(x.counts, 0)}`).join(" · ") + " каунтов")}
    <p>${t("Re")} — по характерной длине агрегата на FL350, M 0,78; ${t("f")} — удлинение тела; ${t("Q")} — интерференция: у гондол — по типу установки (Raymer, табл. 12.6): на пилоне впереди крыла, как у A320 и 757, — 1,3;
    вплотную под крылом, как у всех 737, — 1,5;
    ${t(String.raw`k_{\text{пр}} = ${nf(MISC_SHARE * 100, 0)}\%`)} — допущение. Без всякой подгонки сумма для A320 даёт ${t(String.raw`C_{D0} = ${nf(b.cd0, 4)}`)} против
    0,019 у Poll & Schumann ${ref("poll-2")}: расхождение ${nf((b.cd0 / 0.019 - 1) * 100, 1)}%. Уровень привязан одним множителем ×${nf(k, 3)}, формулы дают
    чувствительность: длиннее фюзеляж, больше гондола, толще профиль — выше ${t("C_{D0}")}.</p>
    ${table(["Агрегат", "S<sub>wet</sub>, м²", "Re, млн", "C<sub>f</sub>×1000", "FF", "Q", "Каунты"], rows, "num")}

    <h3>Индуктивное</h3>
    ${tex(String.raw`C_{D,i} = \frac{C_L^2}{\pi A e},\qquad e = \frac{1}{1{,}05 + 0{,}007\,\pi A}\cdot k_e`)}
    ${now(String.raw`C_{D,i} = \frac{${L(cd.cl, 3)}^2}{\pi \cdot ${L(arNow, 2)} \cdot ${L(ca.oswald, 3)}} = ${L(indc / 1e4, 4)}`)}
    <p>Коэффициент Освальда — по Оберту для транспортных самолётов; ${t("k_e")} = ${nf(CTX.aero.oswaldFactor ?? 1, 3)} привязывает его к e = 0,78 у A320
    с шарклетами. Удлинение ${t("A = b^2/S")} считается по аэродинамическому размаху (с шарклетами — 35,8 м). Сейчас: ${t("A")} = ${nf(aspectRatio(a), 2)},
    ${t("e")} = ${nf(a.oswald, 3)}.</p>

    <h3>Волновое</h3>
    ${tex(String.raw`M_{dd} = \frac{\kappa_A}{\cos\Lambda} - \frac{t/c}{\cos^2\Lambda} - \frac{C_L}{10\cos^3\Lambda},\qquad M_{cr} = M_{dd} - \sqrt[3]{0{,}1/80},\qquad C_{D,w} = 20\,(M - M_{cr})^4`)}
    ${now(String.raw`\kappa_A = ${L(def.wing.airfoil.kornKappa, 3)},\ C_L = ${L(cd.cl, 3)}\ \Rightarrow\ M_{dd} = ${L(cd.mdd, 3)},\ M_{cr} = ${L(cd.mdd - Math.cbrt(0.1 / 80), 3)};\quad M = ${L(cd.mach, 2)}\ \Rightarrow\ C_{D,w} = ${L(wavec / 1e4, 4)}`)}
    <p>Уравнение Корна и закон Локка; ${t(String.raw`\kappa_A`)} — тип профиля крыла: обычный (NACA 6-й серии, крыло 737 Classic) 0,87,
    суперкритический 0,95 (Raymer); A320 — ${nf(KORN_KAPPA, 3)} (так, чтобы ${t("M_{dd}")} ≈ MMO), 757 — 0,91 (профиль с нагруженной хвостовой частью, допущение),
    737NG/MAX — как A320. Сейчас: ${t(String.raw`\kappa_A = ${nf(def.wing.airfoil.kornKappa, 3)}`)}. ${t("t/c")} — средняя по размаху
    (корневая ×0,75, допущение), ${t(String.raw`\Lambda`)} — стреловидность по ¼ хорды. Для текущего самолёта в середине крейсера: ${t("C_L")} = ${nf(cd.cl, 2)},
    ${t("M_{dd}")} = ${nf(cd.mdd, 3)} (у A320 MMO = 0,82). Привязка: на A320 с шарклетами при ${t("C_L")} 0,55 и M 0,78 сумма ${t(String.raw`C_{D0} + C_{D,w}`)} = 0,019.</p>

    <h3>Число Маха, эшелон и расход</h3>
    <p>Две поправки появились после проверки по таблице «Long Range Cruise Control» FCOM 737-8 (LEAP-1B27) ${ref("fcom-7378")}: 80 точек
    расхода топлива на двигатель при массах 40–85 т, эшелонах FL250–410 и числах Маха 0,53–0,80. Модель сравнивалась с ней в тех же условиях.</p>
    <p><b>1. Удельный расход не зависит от числа Маха в крейсере.</b> По Howe ${ref("howe")} ${t(String.raw`TSFC \propto 1 + 0{,}28\,(1 + 0{,}063B^2)\,M`)} —
    это двигатель на постоянном режиме. В крейсере режим следует за сопротивлением: медленнее — двигатель дросселирован, и выигрыш от меньшего входного импульса
    съедает рост удельного расхода на частичном режиме. С формулой Howe модель занижала расход на 1–22%, и ошибка росла к малым Махам (у FCOM при малых массах
    режим максимальной дальности — M 0,53–0,73). С постоянным TSFC зависимость от Маха из ошибки уходит.</p>
    <p><b>2. Трение — по числу Рейнольдса на эшелоне.</b> ${t("C_{D0}")} считается на FL350; выше воздух реже, число Рейнольдса меньше, коэффициент трения больше
    (≈+4% к ${t("C_{D0}")} на FL410, ≈−7% на FL250). Без этого ошибка росла с высотой.</p>
    <p>С обеими поправками расход модели в таблице FCOM — в среднем −4,7% при разбросе ±1,6% (от −2 до −10%) во всех 80 точках, против −1…−22% до них.
    Оставшиеся ≈−5% — общий уровень:
    отбор воздуха и мощности на системы (они в FCOM учтены) или технология LEAP-1B, которая взята у LEAP-1A. Калибровка A320 после поправок: TSFC CFM56-5B
    ${nf(0.586, 3)} lb/(lbf·ч) вместо 0,588. Оптимум расхода A320 по Маху теперь ≈0,78 — медленнее не дешевле; это и есть режим максимальной дальности.</p>
    <p>Форма поляры по FCOM. Если по 80 точкам подобрать ${t("C_{D0}")} и индуктивный множитель ${t("k")} (при TSFC модели), их отношение ${t("C_{D0}/k")}
    = 0,457 против 0,471 у модели — форма поляры совпадает в пределах 3%. Уровень: качество модели на ≈5% выше (или TSFC на столько же ниже);
    разделить сопротивление и удельный расход по одному расходу топлива нельзя. Волновое сопротивление в режиме максимальной дальности FCOM требует в ≈4 раза меньше, чем
    даёт формула Корна, — но на этих скоростях оно мало в абсолютном выражении.</p>
    <p>Для текущего самолёта:</p>
    ${table(["", "Волновое, каунты", "TSFC к M 0,78", "L/D", "Топливо на место"], machRows, "num")}
    <p>Рычаг «Аэродинамическое качество» делит полное сопротивление на ${t("(1+x)")}. Крейсерский ${t("C_L")} по-прежнему ограничен ${nf(AS.cruiseClMax, 2)}
    (оптимум A320 по ${ref("poll-1")} — запас по тряске).</p>
  </section>`;
}

function engineSection(current: Evaluation): string {
  const ce = A320CEO.engine;
  const ne = A320NEO.engine;
  const c3 = B737_300.engine;
  const cur = current.definition.engine;
  const cyc = engineCycle(cur);
  const imp = (x: number) => nf(tsfcToImperial(x), 3);
  const engines: [string, typeof ce][] = [["CFM56-3 (737-300)", c3], ["CFM56-5B (A320ceo)", ce], ["LEAP-1A (A320neo)", ne], ["Текущий вариант", cur]];
  const cy = engines.map(([, e]) => engineCycle(e));
  const anchor = CTX.tsfcCruise / engineCycle(ce).tsfc;
  const col = (f: (e: typeof ce, i: number) => string) => engines.map(([, e], i) => f(e, i));
  const prow = (label: string, f: (e: typeof ce, i: number) => string) => [label, ...col(f)];
  const params = [
    prow("Двухконтурность B", (e) => nf(e.bypassRatio, 1)),
    prow("Степень сжатия Π", (e) => nf(e.overallPressureRatio, 1)),
    prow("Температура перед турбиной, К", (e) => nf(e.cycle.t4K)),
    prow("Воздух на охлаждение", (e) => `${nf(e.cycle.coolingFrac * 100, 0)}%`),
    prow("КПД вентилятора e<sub>f</sub>", (e) => nf(e.cycle.fanEff, 3)),
    prow("КПД компрессоров e<sub>c</sub>", (e) => nf(e.cycle.compEff, 3)),
    prow("КПД ТВД / ТНД", (e) => `${nf(e.cycle.hptEff, 3)} / ${nf(e.cycle.lptEff, 3)}`),
    prow("Редуктор", (e) => (e.cycle.gearbox ? "да" : "нет")),
    prow("π вентилятора (оптимум)", (_, i) => nf(cy[i].fanPressureRatio, 2)),
    prow("Струи: наружная / ядра, м/с", (_, i) => `${nf(cy[i].bypassJetMs)} / ${nf(cy[i].coreJetMs)}`),
    prow("η<sub>th</sub> / η<sub>p</sub> / η<sub>0</sub>", (_, i) => `${nf(cy[i].etaThermal, 3)} / ${nf(cy[i].etaPropulsive, 3)} / ${nf(cy[i].etaOverall, 3)}`),
    prow("TSFC цикла, lb/(lbf·h)", (_, i) => imp(cy[i].tsfc)),
    prow("TSFC в расчёте", (e) => imp(CTX.tsfcCruise * tsfcFactor(ce, e))),
  ];
  // Водопад CEO → NEO: параметры LEAP подставляются по одному.
  const steps: [string, (c: typeof ce) => typeof ce][] = [
    ["Степень сжатия 32,6 → 40 (больше ступеней КВД, 3D-лопатки)", (e) => ({ ...e, overallPressureRatio: ne.overallPressureRatio })],
    [`Температура перед турбиной ${ce.cycle.t4K} → ${ne.cycle.t4K} К (монокристалл 2-го поколения, CMC-бандажи)`, (e) => ({ ...e, cycle: { ...e.cycle, t4K: ne.cycle.t4K } })],
    [`Охлаждение ${nf(ce.cycle.coolingFrac * 100, 0)} → ${nf(ne.cycle.coolingFrac * 100, 0)}% (CMC не нужно охлаждать так сильно)`, (e) => ({ ...e, cycle: { ...e.cycle, coolingFrac: ne.cycle.coolingFrac } })],
    ["КПД компрессоров (3D-аэродинамика, блиски)", (e) => ({ ...e, cycle: { ...e.cycle, compEff: ne.cycle.compEff } })],
    ["КПД турбин (3D-профили, зазоры)", (e) => ({ ...e, cycle: { ...e.cycle, hptEff: ne.cycle.hptEff, lptEff: ne.cycle.lptEff } })],
    ["КПД вентилятора (широкохордные лопатки из 3D-плетёного углепластика без полок)", (e) => ({ ...e, cycle: { ...e.cycle, fanEff: ne.cycle.fanEff } })],
    ["Двухконтурность 5,7 → 11 (вентилятор 1,73 → 1,98 м)", (e) => ({ ...e, bypassRatio: ne.bypassRatio })],
  ];
  let e0 = ce;
  let prev = runCycle({ bypassRatio: e0.bypassRatio, overallPressureRatio: e0.overallPressureRatio, ...e0.cycle }).tsfc;
  const waterfall = steps.map(([label, f]) => {
    e0 = f(e0);
    const x = runCycle({ bypassRatio: e0.bypassRatio, overallPressureRatio: e0.overallPressureRatio, ...e0.cycle }).tsfc;
    const d = (x / prev - 1) * 100;
    prev = x;
    return [label, `${d > 0 ? "+" : "−"}${nf(Math.abs(d), 1)}%`];
  });
  const total = (tsfcFactor(ce, ne) - 1) * 100;
  const pw = runCycle({ bypassRatio: 12.5, overallPressureRatio: ne.overallPressureRatio, ...ne.cycle, gearbox: true, lptEff: ne.cycle.lptEff + 0.015 }).tsfc / engineCycle(ne).tsfc;
  return `
  <section id="m-engine">
    <h2>Двигатель</h2>
    <p>Удельный расход топлива ${t("TSFC")} считается по реальному циклу двухконтурного двигателя с раздельными соплами — параметрический расчёт
    Mattingly ${ref("mattingly")} в точке крейсера (M 0,78, FL350). Каждый параметр цикла — физическая величина, за которой стоит конкретное
    инженерное решение; «уровня технологий» или множителя «новизны» в модели нет.</p>
    ${tex(String.raw`\tau_f = \pi_f^{\frac{\gamma-1}{\gamma e_f}},\quad \tau_c = \pi_c^{\frac{\gamma-1}{\gamma e_c}},\quad f = \frac{c_{pt}T_4 - c_{pc}T_3}{\eta_b H - c_{pt}T_4},\quad \pi_t = \tau_t^{\frac{\gamma_t}{(\gamma_t-1)e_t}}`)}
    ${tex(String.raw`c_{pc}(T_3 - T_{25}) = \dot m_{41} c_{pt} T_{41}(1-\tau_{tH})\,\eta_m,\qquad (1+B)\,c_{pc}(T_{25} - T_2) = \dot m_{45} c_{pt} T_{45}(1-\tau_{tL})\,\eta_m\eta_{\text{ред}}`)}
    ${tex(String.raw`F = \dot m_9 V_9 - V_0 + B\,(V_{19} - V_0),\qquad TSFC = \frac{(1-\beta) f}{F}`)}
    ${now(String.raw`\pi_f = ${L(cyc.fanPressureRatio, 2)},\ f = ${L(cyc.fuelAirRatio, 4)},\ V_{19} = ${L(cyc.bypassJetMs)},\ V_9 = ${L(cyc.coreJetMs)}\ \text{м/с},\ \eta_0 = ${L(cyc.etaOverall, 3)}\ \Rightarrow\ TSFC = ${L(tsfcToImperial(current.tsfcCruise), 3)}\ \text{lb/(lbf}\cdot\text{ч)}`, `${cur.name}: B ${nf(cur.bypassRatio, 1)}, Π ${nf(cur.overallPressureRatio, 1)}, T₄ ${nf(cur.cycle.t4K)} К; TSFC — после привязки ×${nf(CTX.tsfcCruise / engineCycle(ce).tsfc, 3)}`)}
    <p>Вентилятор и компрессоры — политропные КПД ${t("e_f, e_c")}; камера — температура газа ${t("T_4")}; доля ${t(String.raw`\beta`)} воздуха ядра идёт мимо камеры
    на охлаждение (половина смешивается перед ротором ТВД, половина — после); ТВД вращает компрессор, ТНД — вентилятор, с редуктором — с потерей 0,5%.
    Сопла — полное расширение с коэффициентом скорости 0,985. Степень повышения давления вентилятора ${t(String.raw`\pi_f`)} выбирается оптимальной для заданной
    двухконтурности — минимум ${t("TSFC")}, как при проектировании реальных двигателей. Модель отдаёт ${t("TSFC")} без гондолы: её сопротивление — в аэродинамике.</p>
    ${table(["", ...engines.map(([n]) => n)], params, "num")}
    <p class="caveat"><b>Откуда числа.</b> Двухконтурность, степень сжатия, конструкция (число и материал лопаток, ступени) — из данных CFM ${ref("cfm")} ${ref("leap")}.
    Температура, охлаждение и КПД узлов производитель не публикует: это допущения в диапазонах учебной литературы для двигателей своего времени
    (Mattingly, табл. 4.4), согласованные с конструкцией — у LEAP широкохордный вентилятор без полок, керамика в турбине, у CFM56-3 — узкохордный вентилятор
    с полками и более холодная турбина. Каждое можно менять рычагом.</p>
    <p><b>Уровень.</b> Упрощённый цикл (без отборов воздуха и мощности на самолёт, с грубым охлаждением) даёт CFM56-5B ${imp(engineCycle(ce).tsfc)} lb/(lbf·h),
    а диаграммы A320 — ${imp(CTX.tsfcCruise)}. Один множитель ${nf(anchor, 3)} — общий для всех двигателей, как привязка поляры; разница между двигателями
    идёт только от параметров цикла.</p>
    <h3>Из чего складывается выигрыш LEAP-1A против CFM56-5B</h3>
    ${table(["Изменение", "TSFC"], [...waterfall, ["Итого", `${total > 0 ? "+" : "−"}${nf(Math.abs(total), 1)}%`]], "num")}
    <p>Порядок шагов влияет на долю каждого (эффекты не складываются линейно), итог — нет. Двухконтурность даёт больше всего, но работает только вместе с
    горячим и эффективным ядром: без него вентилятору не хватило бы мощности. Сопротивление большой гондолы LEAP (≈5 каунтов) считается в аэродинамике.
    Проверка по диаграммам A320neo — в разделе «Проверка»: модель недооценивает дальность NEO в среднем на 2% — то есть выигрыш двигателя
    в действительности чуть больше, чем дают принятые числа.</p>
    <p>Редуктор (PW1100G): та же LEAP с редуктором, быстрой ТНД и двухконтурностью 12,5 — ${nf((pw - 1) * 100, 1)}% по ${t("TSFC")}.</p>

    <h3>Размер и масса при другой двухконтурности</h3>
    <p>Линии через CFM56-5B и LEAP-1A ${ref("engines-text")} ${ref("leap")}; PW1100G (${t(String.raw`B \approx 12{,}5`)}, ≈2,05 м) ложится на линию диаметра с точностью ±0,02 м:</p>
    ${tex(String.raw`D_{\text{вент}} = 1{,}73 + 0{,}0472\,(B - 5{,}7)\ \text{м},\qquad m_{\text{сух}} = 2380 + 115\,(B - 5{,}7)\ \text{кг}`)}
    <p>Гондола масштабируется по диаметру вентилятора. Линия массы — для прямоприводных двигателей; масса редуктора и сэкономленных ступеней ТНД не учитывается.
    Вне ${t(String.raw`B = 5\ldots13`)} это экстраполяция, о чём предупреждает ограничение. Сейчас: ${t(String.raw`B = ${nf(cur.bypassRatio, 1)}`)} → ${nf(fanDiameterForBpr(cur.bypassRatio), 2)} м, ${nf(dryMassForBpr(cur.bypassRatio))} кг.</p>

    <h3>Что показывает разрез</h3>
    <p>Вентилятор, подпорный компрессор и турбина низкого давления сидят на одном валу (НД), компрессор и турбина высокого давления — на другом (ВД),
    вал НД проходит внутри полого вала ВД. Радиус входа в ядро на модели: ${t(String.raw`r_{\text{ядро}} = R\sqrt{1{,}6/(1+B)}`)} — площадь ядра
    обратно пропорциональна ${t("1+B")}. Число ступеней ТНД — ${t(String.raw`\mathrm{round}(4 + 0{,}57(B-5{,}7))`)}: больший вентилятор вращается медленнее, и турбине
    нужно больше ступеней (CFM56 — 4, LEAP — 7); с редуктором ТНД быстроходная — 3 ступени. Сейчас ядро ${nf(coreRadiusFor(1, cur.bypassRatio) * 100, 0)}% радиуса вентилятора,
    ТНД — ${cur.cycle.gearbox ? 3 : lptStagesFor(cur.bypassRatio)} ступ. Скорости вращения на модели условные (ВД ≈ втрое быстрее НД).</p>
  </section>`;
}

function thrustSection(current: Evaluation): string {
  const d = current.definition;
  const rows = [0, 100, 200, 300, 350, 390].map((fl) => {
    const m = fl === 0 ? 0.2 : current.thrust.mach;
    const l = thrustLapse(flightLevelToM(fl), m);
    return [fl === 0 ? "Уровень моря (V2)" : `FL${fl}`, nf(m, 2), nf(l, 3), nf(Math.round((l * d.engine.takeoffThrustKn * d.engine.thrustScale * 1000) / 4.448 / 100) * 100)];
  });
  const p = TAKEOFF_POLAR;
  const o = current.oei;
  return `
  <section id="m-thrust">
    <h2>Двигатель вне расчётного режима</h2>
    <p>Взлётная тяга задаётся данными: CFM56-5B4 — 27 000 lbf ${ref("cfm")}, LEAP-1A26 — 27 120 lbf ${ref("leap")}. На высоте и скорости доступна её доля —
    формула Mattingly для ТРДД большой двухконтурности ${ref("mattingly")}:</p>
    ${tex(String.raw`\frac{T}{T_{\text{взл}}} = \delta_0\,(1 - 0{,}49\sqrt{M}),\qquad \delta_0 = \frac{p}{p_0}\left(1 + 0{,}2M^2\right)^{3{,}5}`)}
    ${now(String.raw`\text{FL350},\ M = ${L(current.thrust.mach, 2)}:\ \frac{T}{T_{\text{взл}}} = ${L(thrustLapse(flightLevelToM(350), current.thrust.mach), 3)},\quad T_{\text{взл}} = ${L(d.engine.takeoffThrustKn * d.engine.thrustScale, 1)}\ \text{кН на двигатель}`)}
    <p>${t(String.raw`\delta_0`)} — полное давление на входе в двигатель: на высоте воздух реже, скоростной напор частично это возвращает.
    Формула справедлива до температуры торможения стандартного дня на уровне моря (${t(String.raw`\theta_0 \le 1`)}) — это весь крейсер; жаркий день у земли модель не считает.</p>
    ${table(["", "M", "T / T<sub>взл</sub>", "lbf на двигатель"], rows, "num")}
    <p>Для базового CFM56-5B4 на FL350 модель даёт ≈5 400 lbf — порядок опубликованных крейсерских тяг двигателей этого класса (≈5 000–5 900 lbf).</p>
    <p class="caveat"><b>Почему нет зависимости от двухконтурности.</b> По теории импульса при той же мощности ядра двигатель с ${t("B = 11")} терял бы к верху набора
    ≈14% тяги больше, чем с ${t(String.raw`B = 5{,}7`)}, и A320neo не поднимался бы выше FL320. В жизни он занимает те же эшелоны: двигатели проектируют на точку
    верха набора, и ядро LEAP больше и горячее. Цена этого уже сидит в массе и диаметре — рычаг двухконтурности берёт их с линии реальных двигателей.
    Поэтому формула одна для всех ${t("B")}.</p>

    <h3>Потолок по тяге</h3>
    ${tex(String.raw`T_{\text{распол}}(h) \ge D(h) + W\,\frac{V_y}{V},\qquad V_y = 300\ \text{фут/мин}`)}
    ${now(String.raw`m = ${L(current.thrust.massKg)}\ \text{кг}\ \Rightarrow\ \text{потолок FL${current.thrust.ceilingFl}}`)}
    <p>Сопротивление — полное (с волновым) при ${t(String.raw`C_L`)} для данной массы и эшелона. Масса на верху набора — MTOW × ${nf(TOC_MASS_FRACTION, 2)}
    (руление, взлёт и набор — допущение). Потолок — самый высокий эшелон, где неравенство выполняется, не выше сертифицированного FL${MAX_CERT_FL}.
    Сейчас — FL${current.thrust.ceilingFl}. В полёте то же условие ограничивает ступенчатый набор вместе с пределом ${t(String.raw`C_L \le ${nf(AS.cruiseClMax, 2).replace(",", "{,}")}`)}.
    Пороги ограничения FL330 и FL310 — условные: ниже авиакомпания теряет экономичные эшелоны.</p>

    <h3>Набор с отказавшим двигателем</h3>
    ${tex(String.raw`\gamma = \frac{T_{n-1}}{W} - \frac{C_D}{C_L},\qquad C_L = \frac{C_{L\max,\text{взл}}}{1{,}13^2},\qquad C_D = C_{D0} + \Delta C_{D,\text{мех}} + \Delta C_{D,\text{отказ}} + \frac{C_L^2}{\pi A e}`)}
    ${now(String.raw`T_{n-1} = ${L(o.thrustN / 1000, 1)}\ \text{кН},\ W = ${L((d.weights.mtowKg * 9.80665) / 1000, 0)}\ \text{кН},\ L/D = ${L(o.ld, 1)}\ \Rightarrow\ \gamma = ${L(o.gradient * 100, 1)}\%`)}
    <p>Второй сегмент: шасси убрано, закрылки во взлётном положении, скорость V2 ${ref("cs25")}. Норма для двух двигателей — ${t(String.raw`\gamma \ge 2{,}4\%`)}.
    Механизация даёт ${t(String.raw`C_{L\max,\text{взл}} = ${nf(current.highLift.clMaxTakeoff, 2).replace(",", "{,}")}`)} (см. «Механизация»); допущения: ${t(String.raw`\Delta C_{D,\text{мех}} = ${nf(p.flapCd0, 3).replace(",", "{,}")}`)}, ${t(String.raw`\Delta C_{D,\text{отказ}} = ${nf(p.oeiCd0, 3).replace(",", "{,}")}`)}
    (авторотация и отклонённый руль направления). МСА, уровень моря, MTOW. Сейчас: V2 = ${nf(o.v2Ms * 1.944, 0)} уз, L/D = ${nf(o.ld, 1)}, ${t(String.raw`\gamma = ${nf(o.gradient * 100, 1).replace(",", "{,}")}\%`)}.
    </p>

    <h3>Рычаг тяги</h3>
    <p>Тот же цикл, другой размер: тяга × ${t("k")}, сухая масса × ${t("k")}, диаметр вентилятора и гондола × ${t(String.raw`\sqrt{k}`)} (тяга пропорциональна расходу воздуха, расход — площади).
    Меньший двигатель легче и чуть экономичнее на рейсе, но теряет потолок, запас на взлёте и удлиняет разбег — это и есть компромисс выбора размера двигателя.</p>
  </section>`;
}

function highLiftSection(current: Evaluation): string {
  const hl = (flapType: "single" | "double", chord: number, sl: boolean) => ({ ...A320CEO, wing: { ...A320CEO.wing, highLift: { flapType, flapChordFraction: chord, slats: sl } } });
  const variants: [string, typeof A320CEO][] = [
    ["A320: однощелевые, 26%, предкрылки", A320CEO],
    ["Двухщелевые, 26%, предкрылки", hl("double", 0.26, true)],
    ["Однощелевые, 26%, без предкрылков", hl("single", 0.26, false)],
    ["Текущий вариант (масса A320)", { ...A320CEO, wing: { ...A320CEO.wing, highLift: current.definition.wing.highLift } }],
  ];
  const rows = variants.map(([n, d]) => {
    const p = highLiftPerf(d, CTX.highLiftAnchor);
    return [n, nf(p.clMaxClean, 2), nf(p.clMaxTakeoff, 2), nf(p.clMaxLanding, 2), `${nf(p.v2Kt, 0)} уз`, `${nf(p.vAppKt, 0)} уз`];
  });
  const raw = highLiftRaw(A320CEO);
  const c = (x: number, d = 2) => nf(x, d).replace(",", "{,}");
  return `
  <section id="m-highlift">
    <h2>Механизация</h2>
    <p>Максимальный коэффициент подъёмной силы крыла — сумма чистого крыла и приростов от закрылков и предкрылков, по Raymer ${ref("raymer")}:</p>
    ${tex(String.raw`C_{L\max} = 0{,}9\,C_{l\max}\cos\Lambda_{1/4} \;+\; 0{,}9\,\Delta C_{l\max}\,\frac{S_{\text{мех}}}{S}\cos\Lambda_{\text{шарн}}`)}
    ${now(String.raw`C_{L\max}:\ ${L(current.highLift.clMaxClean, 2)}\ /\ ${L(current.highLift.clMaxTakeoff, 2)}\ /\ ${L(current.highLift.clMaxLanding, 2)}\ \Rightarrow\ V_S = ${L(current.highLift.vStallKt)},\ V_{app} = ${L(current.highLift.vAppKt)},\ V_2 = ${L(current.highLift.v2Kt)}\ \text{уз}`, "чистое / взлёт / посадка; скорости при MLW и MTOW")}
    <p>${t(String.raw`C_{l\max} = ${c(AIRFOIL_CLMAX, 1)}`)} — профиль без механизации (допущение). Прирост профиля: однощелевой закрылок Фаулера ${t(String.raw`${c(FLAP_DCL.single, 1)}\,c'/c`)},
    двухщелевой ${t(String.raw`${c(FLAP_DCL.double, 1)}\,c'/c`)}, предкрылок ${t(String.raw`${c(SLAT_DCL, 1)}\,c'/c`)}; ${t("c'/c")} — удлинение хорды при выпуске (Фаулер выезжает назад на ≈0,6 своей хорды,
    двухщелевой — на ≈0,8). Закрылки занимают ${nf(raw.flappedShare * 100, 0)}% площади крыла (от борта до 77% полуразмаха), предкрылки — до 97%.</p>
    <p>Привязка: посадочный ${t(String.raw`C_{L\max}`)} A320 — из скорости захода 134 уз при MLW ${ref("jenkinson")}, ${t(String.raw`V_{app} = ${c(VAPP_FACTOR)}\,V_S`)} ${ref("cs25")}.
    Формулы без подгонки дают на ${nf((CTX.highLiftAnchor - 1) * 100, 0)}% меньше — один множитель ${nf(CTX.highLiftAnchor, 2)} на все конфигурации.
    Взлётная конфигурация (CONF 1+F) берёт ${nf(TAKEOFF_SHARE.flaps * 100, 0)}% прироста закрылков и ${nf(TAKEOFF_SHARE.slats * 100, 0)}% предкрылков (Raymer: 60–80%, допущение).</p>
    ${table(["", "чистое", "взлёт", "посадка", "V2 (MTOW)", "заход (MLW)"], rows, "num")}
    <h3>Что это меняет</h3>
    <ul>
      <li><b>Длина ВПП</b> — ${t(String.raw`TOFL \propto W^2/(S\,C_{L\max,\text{взл}}\,T)`)}.</li>
      <li><b>Скорость захода</b> — ${t(String.raw`V_{app} = ${c(VAPP_FACTOR)}\sqrt{2W_{MLW}/(\rho S C_{L\max})}`)}; выше 140 уз — категория D по ИКАО (PANS-OPS): выше минимумы и длиннее посадка.</li>
      <li><b>Набор с отказом двигателя</b> — выше ${t(String.raw`C_{L\max}`)}, ниже V2, но больше индуктивное сопротивление: мощная механизация слегка снижает градиент.</li>
      <li><b>Размер крыла в режиме «под ту же миссию»</b> — ${t(String.raw`S \propto 1/C_{L\max}`)} при той же скорости захода. Это и есть главная выгода механизации.</li>
      <li><b>Масса</b> — доли узла механизации: закрылки с каретками ${nf(HIGHLIFT_MASS_SHARES.flaps * 100, 0)}%, предкрылки ${nf(HIGHLIFT_MASS_SHARES.slats * 100, 0)}%, остальное — элероны и интерцепторы (допущение).
      Масса закрылков ∝ их хорде; двухщелевые × ${nf(DOUBLE_SLOTTED_MASS, 2)} (допущение).</li>
    </ul>
    <p>Прирост сопротивления на посадке (Raymer 12.61): ${t(String.raw`\Delta C_{D0} = 0{,}0074\,(c_f/c)(S_{\text{мех}}/S)(\delta - 10^\circ)`)}, при ${LANDING_FLAP_DEG}° — ${nf(current.highLift.flapCd0Landing, 3)}.
    На взлёте — постоянные ${nf(TAKEOFF_POLAR.flapCd0, 3)} (допущение): при 10° формула Raymer даёт ноль, а предкрылки и обтекатели кареток всё равно добавляют сопротивление.</p>
  </section>`;
}

function missionSection(current: Evaluation): string {
  const a = AS;
  const km = 810 * 1.852;
  return `
  <section id="m-mission">
    <h2>Полёт и топливо</h2>
    <p>Профиль: руление, взлёт, набор, крейсер со ступенчатым набором, снижение, затем резервы. Скорость — M ${nf(a.cruiseMach, 2)}.</p>
    <h3>Набор высоты — энергетический метод</h3>
    ${tex(String.raw`E = m\left(g h + \frac{V^2}{2} + \frac{g\, d_{\text{наб}}}{(L/D)_{\text{наб}}}\right),\qquad m_{\text{т}} = \frac{E}{\eta_{\text{наб}}\, LHV}`)}
    <p>${t(String.raw`\eta_{\text{наб}} = ${nf(a.climbEfficiencyRatio, 1)}\,\eta_0`)}, ${t(String.raw`(L/D)_{\text{наб}} = ${nf(a.climbLdRatio, 1)}\,(L/D)`)}, ${t(String.raw`d_{\text{наб}}`)} = ${a.climbDistanceKm} км.</p>
    <h3>Крейсер — уравнение Бреге по шагам</h3>
    ${tex(String.raw`\Delta R_i = \frac{V\,(L/D)_i}{g\, TSFC}\,\ln\frac{m_i}{m_i - \Delta m}`)}
    ${now(String.raw`V = ${L(current.cruiseDrag.mach * 296.5)}\ \text{м/с},\ L/D = ${L(current.cruiseDrag.ld, 1)},\ TSFC = ${L(tsfcToImperial(current.tsfcCruise), 3)}\ \text{lb/(lbf}\cdot\text{ч)}\ \Rightarrow\ m_{\text{рейс}} = ${L(current.tripFuelKg)}\ \text{кг}`, `рейс ${nf(Math.round(km))} км; L/D — в середине крейсера`)}
    <p>Крейсерское топливо делится на ${a.cruiseSteps} шагов; ${t(String.raw`(L/D)_i`)} пересчитывается по текущей массе. Ступенчатый набор: самолёт летит на самом высоком эшелоне из
    FL${a.stepFLs.join(", FL")}, где ${t(String.raw`C_L \le ${nf(a.cruiseClMax, 2)}`)}; подъём стоит ${t(String.raw`m g \Delta h / (\eta\, LHV)`)} топлива.</p>
    <h3>Резервы</h3>
    ${tex(String.raw`m_{\text{рез}} = ${nf(a.contingencyFraction * 100, 0)}\%\, m_{\text{рейс}} + m_{\text{запасной}} + m\left(1 - e^{-t\, g\, TSFC_{\text{ож}} / (L/D)_{\max}}\right)`)}
    <p>Запасной аэродром — ${a.alternateDistanceNm} nm на FL${a.alternateFL}; ожидание ${a.finalReserveMin} мин при ${t(String.raw`TSFC_{\text{ож}} = ${nf(a.holdTsfcRatio, 1)}\,TSFC`)}.
    Взлёт ${a.takeoffFuelKg} кг ${ref("poll-3")}, снижение ${a.descentFuelKg} кг на ${a.descentDistanceKm} км, руление ${a.taxiFuelKg} кг — допущения.</p>
    <h3>Расход на место</h3>
    ${tex(String.raw`q = \frac{m_{\text{рейс}}}{n_{\text{мест}}\, d} \cdot 100\quad\text{кг на место на 100 км}`)}
    ${now(String.raw`q = \frac{${L(current.tripFuelKg)}}{${current.seatsCarried} \cdot ${L(km)}} \cdot 100 = ${L(current.fuelPerSeatPer100KmKg, 3)}`)}
    <p>Рейс ${nf(810 * 1.852)} км, пассажир с багажом 95 кг, все места. Резервы в ${t("q")} не входят. Если все места не помещаются в MZFW,
    считается только то число мест, что помещается.</p>
  </section>`;
}

let familyCache: ReturnType<typeof validateFamily> | null = null;

function checkSection(): string {
  // Проверка по всему семейству считается тем же ядром (≈0,3 с) — один раз за сессию.
  familyCache ??= validateFamily(CTX);
  const fam = familyCache;
  const corner = { maxPayload: "макс. нагрузка", fullTank: "полные баки", ferry: "перегон" } as const;
  const sg = (x: number, d = 1) => (Math.abs(x) < 0.5 * 10 ** -d ? nf(0, d) : `${x > 0 ? "+" : "−"}${nf(Math.abs(x), d)}`);
  const summary = fam.map((r) => [
    r.c.name,
    r.c.role,
    `${nf(r.rmsPct, 1)}%`,
    `${sg(r.biasPct)}%`,
    `${nf(r.maxAbsPct, 1)}%`,
    `${sg(relativeOewErrorPct(r, fam))}%`,
  ]);
  const rows = fam.flatMap((r) => r.rows.map((c) => [r.c.name, c.curve, corner[c.corner], nf(c.chartNm), nf(c.modelNm), `${sg(c.errorPct)}%`]));
  const ceo = evaluate(A320CEO, [], CTX);
  const neo = evaluate(A320NEO, [], CTX);
  const tsfcPoll = (0.753 * isa(flightLevelToM(AS.cruiseFL)).speedOfSoundMs) / (0.309 * LHV_JET_A);
  const sv = vb as unknown as Record<
    string,
    { blindRmsPct: number; blindBiasPct: number; points: number; oewModelKg: number; residualFactor: number; fittedRmsPct: number; cruisePct: number; fixedKg: number; fixedChartKg: number }
  >;
  const boeingRows = boeingCases().map((c) => {
    const r = sv[c.def.id];
    return [
      c.name,
      String(r.points),
      `${nf(r.blindRmsPct, 1)}%`,
      `${sg(r.blindBiasPct)}%`,
      c.oewKg ? `${sg(((r.oewModelKg - c.oewKg) / c.oewKg) * 100)}%` : "нет в документе",
      `×${nf(r.residualFactor, 3)} (СКО ${nf(r.fittedRmsPct, 1)}%)`,
    ];
  });
  const splitRows = boeingCases().map((c) => {
    const r = sv[c.def.id];
    return [c.name, `${sg(r.cruisePct)}%`, `${sg(r.fixedKg, 0)} кг`, `${nf(Math.round(r.fixedChartKg / 10) * 10)} кг`];
  });
  const steps737 = (vb as unknown as { b737Steps: [string, number][] }).b737Steps.map(([n, b]) => [n, `${sg(b)}%`]);
  return `
  <section id="m-check">
    <h2>Проверка по данным Airbus и Boeing</h2>
    <p>Углы диаграмм нагрузка–дальность — из AC 3-2-1 A319, A320 и A321 ${ref("ac-a320")} ${ref("ac-a319")} ${ref("ac-a321")}: у A319 и A321 они извлечены из векторных графиков
    (точность ≈±0,05 т и ±5 nm), у A320 — оцифрованы (±0,2 т, ±30 nm). Массы в углах берутся из самих графиков, поэтому сравнение дальности проверяет
    аэродинамику, двигатель и профиль полёта. Подгоняется один параметр — ${t("TSFC")} A320ceo по кривым с шарклетами; всё остальное — прогноз:
    A319 и A321 строятся из A320 заменой длины, мест, топлива, масс, тяги и механизации по AC и считаются с калибровкой A320 как есть.</p>
    ${table(["Вариант", "Роль", "Дальность: СКО", "среднее", "макс.", "OEW к A320"], summary, "num")}
    <p>«OEW к A320» — насколько модель масс ошибается в OEW относительно A320 того же поколения. OEW, «зашитый» в графики AC, на ≈4% тяжелее OEW из 2-3-0,
    по которому откалиброваны массы, поэтому сравнивается масштабирование с длиной и MTOW, а не абсолютный уровень.
    Большие максимальные ошибки у A319neo и A319 с шарклетами — это угол «макс. нагрузка» на кривой 64 т при дальности 600–770 nm: там ошибка в несколько
    десятков миль уже даёт 8–18%.</p>
    <details><summary>Все углы диаграмм</summary>${table(["Вариант", "Кривая", "Угол", "AC, nm", "Модель, nm", "Ошибка"], rows, "num")}</details>
    <h3>Boeing: 737-300, 737-8, 757-200</h3>
    <p>Графики Boeing устроены иначе: ось — ZFW (OEW + нагрузка), линии — взлётные массы. Каждая точка (взлётная масса, ZFW, дальность) — проверка
    аэродинамики, двигателя и профиля полёта, независимо от массовой сводки. Из векторных графиков (737-300, 757) линии взяты автоматически, растровый
    график 737-8 оцифрован подбором прямых по пикселям (точность ≈±25 nm, ±0,3 т). Определения — из документов Boeing ${ref("b737")} ${ref("b737max")} ${ref("b757")}:
    размеры, массы, топливо, двигатели; плечи оперения сняты с общих видов, параметры циклов двигателей — допущения в диапазонах литературы.
    Правила резервов — ATA для внутренних рейсов США: запасной 200 nm и 45 мин крейсера (у 737-8 «typical mission rules» не расписаны — приняты те же).</p>
    ${table(["Самолёт", "Точек", "Дальность: СКО", "среднее", "OEW: модель к Boeing", "Не объяснено (множитель расхода)"], boeingRows, "num")}
    <p>Пустая масса 757-200 по модели на 6–7% легче, чем у Boeing: модель масс с A320 переносится на самолёт в полтора раза тяжелее хуже, чем на 737
    (−1%). Множитель расхода — только мера того, сколько осталось объяснить; в расчёт он не входит.</p>

    <h3>Разложение ошибки: крейсер и постоянное топливо</h3>
    <p>Ошибка в процентах дальности смешивает две разные вещи. На каждой линии взлётной массы топливо почти линейно по дальности:
    ${t(String.raw`m_{\text{т}} = a + b\,R`)}. Наклон ${t("b")} (кг на милю) — экономичность крейсера: сопротивление × удельный расход.
    Отрезок ${t("a")} — топливо, не зависящее от дальности: резервы, взлёт, набор, снижение. Прямые строятся отдельно по точкам графика и по дальностям модели
    при тех же массах, затем усредняются по линиям.</p>
    ${table(["Самолёт", "Крейсер: кг/nm модели к графику", "Постоянное топливо: модель − график", "Постоянное по графику"], splitRows, "num")}
    <p>Что это показывает. <b>757:</b> крейсер совпадает с графиком в пределах ±1% — поляра и цикл двигателя переносятся на самолёт
    в полтора раза тяжелее без подгонки; ошибка — лишние 0,5–0,7 т постоянного топлива. Совпадает и профиль: график 757 построен для M 0,80 на FL350/390 —
    ровно так модель и летит. <b>737-8 и 737-300:</b> крейсер в модели на 10–14% экономичнее, постоянное топливо больше на 0,4–0,7 т; у 737-8 ошибки
    противоположны по знаку и в среднем гасят друг друга — отсюда обманчиво хорошее среднее −2%.</p>
    <p>Где это видно по FCOM 737-8 (раздел «Аэродинамика»): в одинаковых условиях модель экономичнее на ≈5% — это половина ошибки крейсера 737-8.
    Ещё ≈3% — в модели резервы уменьшаются вместе с посадочной массой (чем дальше рейс, тем легче самолёт на посадке и меньше запас), и наклон
    «топливо — дальность» от этого меньше, чем расход в крейсере; у Boeing наклон графика совпадает с расходом по FCOM, то есть его резервы почти не зависят от массы.
    У 737-300 FCOM нет; его график построен для режима максимальной дальности на FL310/350, а не на оптимальном эшелоне.</p>
    <p>Что уже проверено и не объясняет: подъём хвостовой части фюзеляжа (у 737 и A320 одинаковый — ≈5° по оси, ≈11° по нижней линии,
    по контурам из чертежей); замена правила финального резерва (45 мин крейсера ↔ 30 мин ожидания) и укороченный запасной — сдвигают постоянное топливо,
    но у разных типов в разные стороны. Набор без потерь на нём (качество и КПД ×1,0 вместо ×0,9) сокращает лишнее постоянное топливо у всех четырёх
    на 0,3–0,5 т, но тогда меняется и калибровка A320 — проверять только вместе с ней.</p>
    <p>Что дали конкретные отличия 737-300 от A320 (среднее завышение дальности):</p>
    ${table(["Шаг", "Среднее"], steps737, "num")}
    <p>Эти шаги улучшили среднее, но разложение выше показывает, что у 737-300 остаётся экономичность крейсера, переоценённая на 12–19%.</p>
    <p>Вывод: внутри семейства A320 модель переносится без подгонки — дальность ceo в пределах 1–3%, OEW в пределах ≈2%. На самолёты другого
    производителя — с ошибкой в среднем до 6%, кроме 737-300 (+10%): разница поколений объясняется конкретными решениями — циклом двигателя, профилем
    крыла, установкой гондолы, правилом резервов. Остаток у 737-300 — крейсерская экономичность, которую модель всё ещё переоценивает.</p>
    <p>Независимая проверка ${t("TSFC")}: общий КПД ${t(String.raw`\eta_0 = 0{,}309`)} при M 0,753 для A320ceo у Poll & Schumann ${ref("poll-1")} даёт
    ${nf(tsfcToImperial(tsfcPoll), 3)} lb/(lbf·h) против подобранных ${nf(tsfcToImperial(CTX.tsfcCruise), 3)} (${sg(((CTX.tsfcCruise - tsfcPoll) / tsfcPoll) * 100)}%).
    Итог по расходу: A320ceo ${nf(ceo.fuelPerSeatPer100KmKg, 3)}, A320neo ${nf(neo.fuelPerSeatPer100KmKg, 3)} кг на место на 100 км
    (${sg(((neo.fuelPerSeatPer100KmKg - ceo.fuelPerSeatPer100KmKg) / ceo.fuelPerSeatPer100KmKg) * 100)}%).</p>
  </section>`;
}

function leversSection(): string {
  const items = CONTROLS.map((c) => {
    const lever = c.kind === "toggle" ? c.toLever(true) : c.toLever(c.max);
    const kinds = [...new Set(lever.effects.map((e) => e.kind))]
      .map((k) => ({ definition: "определение самолёта → пересчёт по формулам", massFactor: "множитель массы узла", massDelta: "добавка массы", aero: "поляра", engine: "TSFC", mission: "допущения полёта" })[k])
      .join(", ");
    const text = c.kind === "toggle" ? lever.rationale : `${c.hint[0].toUpperCase()}${c.hint.slice(1)}. Диапазон ${c.format(c.min)} … ${c.format(c.max)}.`;
    return `<li><b>${c.label}</b> — ${text} <span class="kind">Как действует: ${kinds}.</span></li>`;
  }).join("");
  return `
  <section id="m-levers">
    <h2>Рычаги</h2>
    <p>Рычаг — запись данных, а не код. Он либо правит определение самолёта (размах, двигатель, длину), после чего массы и аэродинамика пересчитываются
    по формулам, либо умножает массу узла дерева, либо меняет поляру. Поэтому любой рычаг сразу виден во всех выходах.</p>
    <ul class="levers-list">${items}</ul>
  </section>`;
}

function redesignSection(): string {
  return `
  <section id="m-redesign">
    <h2>Режим «под ту же миссию»</h2>
    <p>В режиме «та же геометрия» облегчение превращается в дальность или нагрузку. В реальном проекте его превращают в меньший самолёт:
    меньше топлива → меньше MTOW → меньше крыло и двигатели → ещё легче. Держим постоянными нагрузку (все места × 95 кг), дальность базового самолёта
    с этой нагрузкой, скорость захода, удлинение и тяговооружённость. Скорость захода держится, если ${t(String.raw`W/(S\,C_{L\max})`)} постоянно:
    лучшая механизация позволяет меньшее крыло (см. «Механизация»).</p>
    ${tex(String.raw`S \propto \frac{MTOW}{C_{L\max}},\quad b \propto \sqrt{MTOW},\quad T \propto MTOW,\quad m_{\text{дв}} \propto T,\quad D_{\text{вент}} \propto \sqrt{T},\quad V_{\text{баков}} \propto S^{1{,}5}`)}
    ${tex(String.raw`MTOW_{n+1} = MTOW_n + 0{,}7\left(OEW(MTOW_n) + PL + m_{\text{т}}(MTOW_n) - MTOW_n\right)`)}
    <p>Итерации останавливаются, когда шаг меньше 1 кг; множитель 0,7 гасит колебания. Оперение масштабируется вместе с крылом (тот же коэффициент статического объёма).
    MZFW — расчётная нагрузка плюс тот же запас, что у базового самолёта. Удлинение крыла сохраняется, поэтому при росте площади растёт и размах —
    у A321 Airbus сохранил крыло A320 и поставил двухщелевые закрылки: рычаг «Двухщелевые закрылки» возвращает размах в код C.</p>
  </section>`;
}

function constraintsSection(): string {
  const r = CTX.constraintsRef;
  return `
  <section id="m-constraints">
    <h2>Ограничения</h2>
    <h3>Код аэродрома</h3>
    <p>${t(String.raw`b \le 36`)} м — код C, 36–52 м — код D ${ref("icao")}. С шарклетами считается их размах 35,8 м ${ref("ac-a320")}.</p>
    <h3>Клиренс под гондолой</h3>
    ${tex(String.raw`h = h_0 - \frac{D_{\text{гонд}} - D_{\text{гонд},0}}{2} + \Delta h_{\text{подъём}}`)}
    <p>${t(String.raw`h_0 = ${nf(r.nacelleClearanceM, 2)}`)} м — CFM56-5B при MRW ${ref("ac-a320")}. Норма — не меньше ${nf(r.provenMinClearanceM, 2)} м (A320neo по AC);
    чистая геометрия NEO даёт ≈0,40 м, поэтому подъём установки на ≈6 см выведен, а не взят из источника. Порог 0,30 м — условный.</p>
    <h3>Угол касания хвостом</h3>
    ${tex(String.raw`\theta = \arctan\frac{l \tan\theta_0}{l + \Delta L/2}`)}
    <p>${t(String.raw`\theta_0 = ${nf(r.tailStrikeDeg, 1)}^\circ`)} — A320 при обжатых стойках ${ref("safety-first")}; плечо ${t(String.raw`l = ${nf(r.tailContactArmM, 1)}`)} м подобрано так,
    чтобы удлинение A321 (${t(String.raw`\Delta L = 6{,}94`)} м ${ref("ac-a321")}) давало 9,7° ${ref("aaib")}. Половина вставки — за основными стойками.
    Предупреждение — если угол меньше базового, нарушение — если меньше угла тангажа на отрыве ≈${r.liftoffPitchDeg}° (допущение).</p>
    <h3>Длина ВПП</h3>
    ${tex(String.raw`TOFL = TOFL_0\,\frac{(W/W_0)^2}{(S/S_0)(T/T_0)}`)}
    <p>Параметр взлёта Raymer ${ref("raymer")} при той же механизации; ${t(String.raw`TOFL_0 = ${nf(r.takeoffFieldLengthM)}`)} м ${ref("jenkinson")}. Пороги +5% и +15% — условные.</p>
    <h3>Нагрузка и MZFW</h3>
    <p>Если ${t(String.raw`n_{\text{мест}} \cdot 95 > MZFW - OEW`)}, все места не помещаются: нужно усиливать конструкцию или летать с неполной загрузкой.</p>
  </section>`;
}

function geometrySection(): string {
  return `
  <section id="m-geometry">
    <h2>3D-модель</h2>
    <p>Модель — параметрическая: строится из того же определения самолёта, что и расчёт, поэтому рычаги меняют форму. Контуры взяты прямо из векторных чертежей AC ${ref("ac-a320")}
    (разделы 2-2-0 «размеры» — виды сбоку, сверху и спереди, и 2-5-0 «сечение салона»): офлайн-утилита <code>tools/ac_extract.py</code> читает линии
    из PDF, масштабирует по подписанным размерам (длина 37,57 м, размах 34,10 м — три вида сходятся по масштабу в пределах 0,3%) и отбрасывает
    размерные линии; <code>tools/ac_shapes.py</code> строит из них профили фюзеляжа (верх, низ, ширина в плане), сечение, план крыла и оперения,
    положения окон и дверей. Независимая проверка: площадь крыла по извлечённому плану — ≈122 м² при 122,4 м² у Jenkinson.
    Получилось: передняя кромка крыла у борта на 12,87 м от носа, стреловидность передней кромки 27,3°, излом задней кромки на 6,64 м от оси;
    ось двигателя на 5,75 м от оси самолёта; земля на 3,87 м ниже оси фюзеляжа; киль — стреловидность передней кромки ≈41°, высота 5,83 м над фюзеляжем. Окна, двери, аварийные выходы и остекление кабины — текстура из тех же линий AC (при удлинении фюзеляжа окна
    во вставках продолжают шаг 21 дюйм); границы механизации, рулей и обтекатели кареток на крыле и оперении — тоже из вида сверху; шасси — по 2-9-0 (основная стойка 2,869 м от шарнира до оси колёс, ход 0,47 м, уборка внутрь на 80°30′;
    передняя 1,957 м, наклон 9°, уборка вперёд на 92°); гондолы — по 2-12-0 (CFM56-5B с длинным каналом и общим соплом, LEAP-1A с раздельными
    потоками, открытым ядром и конусом; тип выбирается по двухконтурности), длина «голого» двигателя — 2,94 м и 3,55 м; ВСУ — в хвостовом конусе
    с каналом воздухозаборника и глушителем; салон — по 2-5-0 и 2-4-1 (пол на 0,52 м ниже оси, три кресла 1,50 м, проход 0,64 м, подушка на 0,43 м,
    наклон спинки 12°, кухни и туалеты у дверей). Антенны, огни и обвязка двигателя пока не моделируются. Фон с землёй и облаками и фазы полёта — иллюстрация:
    высоты условные, в убранном положении основные колёса A320 частично открыты, как у настоящего. Цвета групп — условные, композитные агрегаты темнее.</p>
    <p><b>737-8.</b> Контуры сняты с трёхмерной сетки 737-800 (шаблон SketchUp в формате Collada; у 737-8 тот же фюзеляж, крыло и оперение)
    утилитой <code>tools/mesh_shapes.py</code>: сечения сетки плоскостями дают профили фюзеляжа (через 5 см у носа, через 25 см дальше), сечение
    на полный оборот (у 737 нижняя часть уже верхней: 3,76 × 4,00 м), план крыла (передняя кромка — две прямые: наплыв у корня и основная,
    стреловидность 28,2°; излом задней кромки на 4,89 м от оси), стабилизатор и киль с форкилем, двери, выходы над крылом, стёкла кабины
    и место двигателя (срез воздухозаборника на 13,47 м от носа, ось на 5,03 м от оси самолёта). Масштаб — по общей длине 39,47 м
    ${ref("b737max")}, все размеры сжаты до длины фюзеляжа 39,12 м; база (15,60 м) и колея (5,72 м) шасси — из того же листа 2.2.2.
    Сама сетка в проект не входит — только снятые с неё таблицы. Гондола LEAP-1B, законцовки и шасси — параметрические, по определению;
    окна — с шагом 20 дюймов, линии панелей крыла и оперения — общий рисунок с A320.</p>
  </section>`;
}

function limitsSection(): string {
  return `
  <section id="m-limits">
    <h2>Чего модель не знает</h2>
    <ul>
      <li>Доли масс — от 737-200, а не A320; формулы Raymer — статистика прошлых поколений. Абсолютная масса узла может отличаться от реальной на 10–20%, изменения — точнее.</li>
      <li>Волновое сопротивление — по уравнению Корна, без расчёта обтекания; число Маха в крейсере постоянное (рычаг задаёт его на весь рейс).</li>
      <li>Тяга на высоте — обобщённая формула для класса двигателей, а не характеристика CFM56 или LEAP; жаркий день и высокогорные аэродромы не считаются.</li>
      <li>Разделение выигрыша двигателя на ядро и вентилятор — допущение (см. «Двигатель»).</li>
      <li>Экономия от композитов (кессон −20%, механизация −15%) — отраслевые диапазоны, не данные Airbus.</li>
      <li>CLmax механизации — статистика Raymer, привязанная к A320 одним числом; сопротивление механизации на взлёте — допущение; длина пробега при посадке не считается. Нет рычагов шасси при удлинении и редукторного вентилятора.</li>
      <li>Стоимость топлива в евро пока не считается — будет из справочника FlightCostApp.</li>
    </ul>
  </section>`;
}

function sourcesSection(): string {
  return `
  <section id="m-sources">
    <h2>Источники</h2>
    <ol class="sources">${SOURCES.map(
      (s) => `<li id="src-${s.id}">${s.url ? `<a href="${s.url}" target="_blank" rel="noopener">${s.title}</a>` : s.title}<span>${s.note}</span></li>`,
    ).join("")}</ol>
  </section>`;
}

export const METHOD_TOC: [string, string][] = [
  ["m-pipeline", "Схема расчёта"],
  ["m-mass", "Массы"],
  ["m-aero", "Аэродинамика"],
  ["m-engine", "Двигатель"],
  ["m-thrust", "Тяга на режимах"],
  ["m-highlift", "Механизация"],
  ["m-mission", "Полёт и топливо"],
  ["m-check", "Проверка: A319, A321, 737, 757"],
  ["m-levers", "Рычаги"],
  ["m-redesign", "Под ту же миссию"],
  ["m-constraints", "Ограничения"],
  ["m-geometry", "3D-модель"],
  ["m-limits", "Чего модель не знает"],
  ["m-sources", "Источники"],
];

export function renderMethod(current: Evaluation, name = "Сейчас"): string {
  NOW = name;
  const steps = ["Определение самолёта", "Рычаги", "Массы агрегатов", "Аэродинамика", "Двигатель", "Полёт и резервы", "Показатели", "Ограничения"];
  return `
  <nav class="toc" aria-label="Содержание">${METHOD_TOC.map(([id, l]) => `<a href="#${id}">${l}</a>`).join("")}</nav>
  <div class="method-body">
    <header class="method-head">
      <h1>Как рассчитано</h1>
      <p>Всё, что показывает модель, считается одним конвейером на TypeScript. Числа на этой странице не вписаны вручную — их считает то же ядро.
      Где значение не из источника, а допущение, это сказано прямо.</p>
    </header>
    <section id="m-pipeline">
      <h2>Схема расчёта</h2>
      <ol class="pipeline">${steps.map((s) => `<li>${s}</li>`).join("")}</ol>
      <p>Определение самолёта — чистые данные: размеры, двигатель, массы. Рычаги правят его или добавляют множители. Дальше: массы агрегатов → поляра →
      ${t("TSFC")} → моделирование полёта → расход на место, дальность, диаграмма нагрузка–дальность → проверка ограничений. В режиме «под ту же миссию»
      этот конвейер повторяется в цикле, пока не сойдётся MTOW.</p>
    </section>
    ${massSection(current)}
    ${aeroSection(current.definition, current)}
    ${engineSection(current)}
    ${thrustSection(current)}
    ${highLiftSection(current)}
    ${missionSection(current)}
    ${checkSection()}
    ${leversSection()}
    ${redesignSection()}
    ${constraintsSection()}
    ${geometrySection()}
    ${limitsSection()}
    ${sourcesSection()}
  </div>`;
}
