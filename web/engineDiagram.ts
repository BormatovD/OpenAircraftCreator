// Верхняя половина продольного разреза. Каждой ступени компрессора
// соответствует рабочий ряд и следующий за ним направляющий аппарат.
import { COMBUSTORS } from "./scene/combustor.ts";
import type { FleetStyle } from "./scene/fleetPackages.ts";
import type { EngineArchitecture } from "../src/definition.ts";

export type DiagramInput = EngineArchitecture & {
  coreRadius: number;
  lptStages: number;
  separateFlow: boolean;
  installation?: FleetStyle;
};

export function engineDiagram(p: DiagramInput): string {
  const W = 340;
  const H = 170;
  const ax = 156;
  const R = 128;
  const rc = R * p.coreRadius;
  const y = (r: number) => (ax - r).toFixed(1);
  const shafts = { lp: 0.12 * rc, ip: 0.20 * rc, hp: 0.28 * rc };
  const parts: string[] = [];
  const poly = (pts: [number, number][], cls: string) =>
    parts.push(`<polygon points="${pts.map(([x, r]) => `${x.toFixed(1)},${y(r)}`).join(" ")}" class="${cls}"/>`);
  const path = (d: string, cls: string, extra = "") => parts.push(`<path d="${d}" class="${cls}" ${extra}/>`);

  // Гондола: воздухозаборник с губой, наружный контур.
  const mixed = p.exhaust === "annularMixer";
  const twin = p.exhaust === "separateNozzles";
  const nacEnd = mixed ? 314 : p.separateFlow ? 210 : 262;
  if (p.exhaust) {
    const lip = (mixed ? .65 : .81) * R;
    path(`M14,${y(R+3)} Q10,${y(R+12)} 26,${y(R+13)} Q88,${y(R+17)} 122,${y(R+11)}
      Q${nacEnd-54},${y(R+4)} ${nacEnd},${y(lip)} L${nacEnd},${y(lip-3)}
      Q${nacEnd-61},${y(R-6)} 122,${y(R+2)} L26,${y(R+3)} Z`, "d-nacelle");
  } else path(
    `M14,${y(R + 3)} Q10,${y(R + 9)} 22,${y(R + 13)} L${nacEnd - 30},${y(R + 12)} L${nacEnd},${y(R - (p.separateFlow ? 6 : 26))} L${nacEnd - 4},${y(R - (p.separateFlow ? 10 : 30))} L${nacEnd - 34},${y(R + 2)} L26,${y(R + 3)} Z`,
    "d-nacelle",
  );
  // Кок.
  poly([[30, 0], [46, 30], [58, 36], [58, 0]], "d-lp");
  // Лопатка вентилятора (широкая хорда, стреловидная законцовка).
  poly([[58, 36], [70, 36], [76, R - 2], [64, R], [58, R * 0.6]], "d-lp");
  // Спрямляющий аппарат наружного контура.
  poly([[96, rc * 1.35], [102, rc * 1.35], [104, R], [98, R]], "d-stator");
  // Разделитель и кожух ядра.
  const coreEnd = mixed ? 278 : twin ? 314 : p.separateFlow ? 282 : 252;
  if (p.exhaust) {
    const exitRadius = mixed ? R * .40 : R * .39;
    path(`M82,${y(rc*1.08)} L96,${y(rc*1.32)} Q153,${y(rc*1.42)} 191,${y(rc*1.38)}
      Q248,${y(rc*1.32)} ${coreEnd},${y(exitRadius)} L${coreEnd},${y(exitRadius-2)}
      Q249,${y(rc*1.12)} 191,${y(rc*1.10)} L96,${y(rc*1.16)} Z`, "d-cowl");
  } else path(`M82,${y(rc * 1.08)} L96,${y(rc * 1.32)} L190,${y(rc * 1.28)} L${coreEnd},${y(rc * 0.95)} L${coreEnd},${y(rc * 0.8)} L190,${y(rc * 1.12)} L96,${y(rc * 1.16)} Z`, "d-cowl");
  const front = p.spools === 3 ? p.ipcStages : p.boosterStages;
  const hx0 = 84 + front * 6 + 6;
  const hx1 = 176;
  function compressor(n: number, x0: number, x1: number, spool: keyof typeof shafts, tip0: number, tip1: number) {
    const pitch = (x1 - x0) / n;
    for (let i = 0; i < n; i++) {
      const x = x0 + i * pitch;
      const t = i / Math.max(1, n - 1);
      const tip = rc * (tip0 + (tip1 - tip0) * t);
      const hub = tip * (0.58 + 0.21 * t);
      poly([[x, shafts[spool]], [x + pitch * 0.24, shafts[spool]], [x + pitch * 0.35, hub], [x, hub]], `d-drum-${spool}`);
      poly([[x, hub], [x + pitch * 0.35, hub], [x + pitch * 0.44, tip], [x + pitch * 0.15, tip]], `d-${spool}`);
      poly([[x + pitch * 0.64, hub], [x + pitch * 0.90, hub], [x + pitch * 0.80, tip], [x + pitch * 0.56, tip]], "d-stator");
    }
  }
  compressor(front, 84, hx0 - 6, p.spools === 3 ? "ip" : "lp", 1.05, 0.88);
  compressor(p.hpcStages, hx0, hx1, "hp", 0.83, 0.65);
  // Камера сгорания: жаровая труба, форсунка, пламя.
  const cx0 = hx1 + 4;
  const cx1 = cx0 + 28;
  const cr = rc * 0.62;
  if (p.combustor) {
    const liner = COMBUSTORS[p.combustor];
    const station = (u: number) => cx0 + 2 + u * (cx1 - cx0 - 2);
    const outline = [...liner.outer, ...[...liner.inner].reverse()];
    poly(outline.map(([u,r]) => [station(u), r * rc]), "d-liner");
    const head = liner.headRadius * rc;
    path(`M${cx0},${y(rc * .98)} L${cx0 - 1},${y(head)} L${station(.09)},${y(head)}`, "d-feed");
    path(`M${station(.09)},${y(head)} Q${station(.26)},${y(head + 5)} ${station(.82)},${y(rc * .55)}
      Q${station(.28)},${y(head - 5)} ${station(.09)},${y(head)} Z`, "d-flame");
  } else if (p.installation) {
    const ps = p.installation === "ps90a";
    const taps = p.installation === "leap1a" || p.installation === "leap1b";
    const head = (ps ? .51 : .63) * rc;
    const top = (ps ? .625 : .80) * rc;
    const bottom = (ps ? .395 : .44) * rc;
    // A longitudinal section through one PS flame tube terminates at the
    // common collector. The annular CFM liners enclose a continuous annulus.
    path(`M${cx0+2},${y(head)} Q${cx0+2},${y(top)} ${cx0+6},${y(top)}
      L${cx1-6},${y(top)} L${cx1},${y(.64*rc)} M${cx1},${y(.44*rc)}
      L${cx1-6},${y(bottom)} L${cx0+6},${y(bottom)} Q${cx0+2},${y(bottom)} ${cx0+2},${y(head)}`, "d-feed");
    if (ps) poly([[cx1-5,.63*rc],[cx1,.63*rc],[cx1,.65*rc],[cx1-5,.65*rc]],"d-liner");
    path(`M${cx0},${y(.97*rc)} V${y(head)} H${cx0+6}`, "d-feed");
    if (taps) path(`M${cx0+3},${y(head+2)} L${cx0+8},${y(head+3)}
      M${cx0+3},${y(head-2)} L${cx0+8},${y(head-3)}`, "d-feed");
    path(`M${cx0+5},${y(head)} Q${cx0+12},${y(head+4)} ${cx1-2},${y(.55*rc)}
      Q${cx0+12},${y(head-4)} ${cx0+5},${y(head)} Z`, "d-flame");
  } else {
    path(`M${cx0},${y(cr - 10)} Q${cx0 + 8},${y(cr + 12)} ${cx1},${y(cr + 8)} L${cx1},${y(cr - 14)} Q${cx0 + 8},${y(cr - 18)} ${cx0},${y(cr - 10)} Z`, "d-liner");
    path(`M${cx0 + 4},${y(cr)} Q${cx0 + 16},${y(cr + 7)} ${cx1 - 2},${y(cr)} Q${cx0 + 16},${y(cr - 8)} ${cx0 + 4},${y(cr)} Z`, "d-flame");
    parts.push(`<circle cx="${cx0 + 2}" cy="${y(cr)}" r="2.2" class="d-hp"/>`);
  }
  const tx0 = cx1 + 4;
  const ix0 = tx0 + p.hptStages * 7;
  const ipt = p.iptStages ?? 0;
  const lx0 = ix0 + ipt * 7 + 3;
  const lx1 = p.exhaust ? 255 : (p.separateFlow ? coreEnd : nacEnd) - 8;
  function turbine(n: number, x0: number, x1: number, spool: keyof typeof shafts, tip0: number, tip1: number) {
    const pitch = (x1 - x0) / n;
    const hub = rc * tip0 * (spool === "lp" ? 0.64 : 0.70);
    for (let i = 0; i < n; i++) {
      const x = x0 + i * pitch;
      const tip = rc * (tip0 + (tip1 - tip0) * (i + 0.5) / n);
      poly([[x + pitch * 0.63, shafts[spool]], [x + pitch * 0.85, shafts[spool]],
        [x + pitch * 0.90, hub], [x + pitch * 0.60, hub]], `d-drum-${spool}`);
      poly([[x, hub], [x + pitch * 0.24, hub], [x + pitch * 0.42, tip], [x + pitch * 0.17, tip]], "d-stator");
      poly([[x + pitch * 0.68, hub], [x + pitch * 0.95, hub], [x + pitch * 0.78, tip], [x + pitch * 0.51, tip]], `d-${spool}`);
    }
  }
  turbine(p.hptStages, tx0, ix0, "hp", 0.62, 0.69);
  if (ipt) turbine(ipt, ix0, lx0 - 3, "ip", 0.69, 0.75);
  turbine(p.lptStages, lx0, lx1, "lp", 0.75, 1.03);
  // Центральное тело (конус) за турбиной.
  if (p.exhaust) {
    const tip = mixed ? 296 : 309;
    path(`M${lx1},${y(rc*.48)} Q${lx1+11},${y(rc*(mixed ? .48 : .64))} ${tip-13},${y(rc*(mixed ? .16 : .41))}
      Q${tip-3},${y(rc*.14)} ${tip},${ax} H${lx1} Z`, "d-cowl");
  } else poly([[lx1, rc * 0.36], [lx1 + 34, 4], [lx1 + 34, 0], [lx1, 0]], "d-cowl");
  // Coaxial shafts and turbine webs end at the corresponding rotor.
  const shaft = (spool: keyof typeof shafts, start: number, end: number) => {
    const r = shafts[spool];
    parts.push(`<rect x="${start}" y="${y(r)}" width="${end - start}" height="${(rc * 0.045).toFixed(1)}" class="d-${spool}"/>`);
  };
  shaft("hp", hx0, ix0);
  if (p.spools === 3) shaft("ip", 84, lx0 - 3);
  shaft("lp", 58, lx1);
  // Потоки.
  const yb = (R + rc * 1.3) / 2;
  if (p.exhaust) {
    const corePath = `M2,${y(rc*.85)} H78 Q92,${y(rc*.72)} ${hx1},${y(rc*.6)} L${lx1},${y(rc*.80)}`;
    const coldPath = `M2,${y(yb)} H140`;
    if (mixed) {
      const join = `306,${y(R*.39)}`;
      path(coldPath + ` Q253,${y(yb)} ${join}`, "d-cold");
      path(corePath + ` Q278,${y(rc*.60)} ${join}`, "d-hotflow");
      path(`M${join} H336`, "d-mixed", 'marker-end="url(#d-am)"');
    } else {
      path(coldPath + ` Q182,${y(yb)} 214,${y(R*.73)} L251,${y(R*.69)}`, "d-cold", 'marker-end="url(#d-ac)"');
      path(corePath + ` Q281,${y(rc*.84)} 312,${y(R*.23)} H336`, "d-hotflow", 'marker-end="url(#d-ah)"');
    }
  } else {
    parts.push(`<path d="M2,${y(yb)} L${nacEnd + 30},${y(yb - (p.separateFlow ? 4 : 20))}" class="d-cold" marker-end="url(#d-ac)"/>`);
    parts.push(`<path d="M2,${y(rc * 0.85)} L78,${y(rc * 0.85)} Q90,${y(rc * 0.75)} ${hx1},${y(rc * 0.6)} L${lx1 + 20},${y(rc * 0.6)} L${W - 4},${y(rc * 0.45)}" class="d-hotflow" marker-end="url(#d-ah)"/>`);
  }
  // Подписи.
  const lbl = (x: number, r: number, t: string, anchor = "middle") => parts.push(`<text x="${x}" y="${y(r)}" text-anchor="${anchor}">${t}</text>`);
  lbl(67, R + 22, "вентилятор");
  lbl(150, R - 14, "наружный контур");
  lbl((hx0 + hx1) / 2, -12, "КВД");
  lbl(cx0 + 14, -12, "КС");
  lbl((lx0 + lx1) / 2, -12, "ТНД");
  lbl(tx0 + 4, -24, "ТВД");
  if (ipt) lbl(ix0 + 3, -12, "ТСД");
  lbl((84 + hx0 - 6) / 2, -12, p.spools === 3 ? "КСД" : "КНД");
  return `<svg viewBox="0 0 ${W} ${H + 18}" class="engine-diagram" role="img" aria-label="Схема двухконтурного двигателя: верхняя половина разреза">
    <defs>
      <linearGradient id="d-hotgrad" x1="0" x2="1"><stop offset="0" stop-color="#7fd3ff"/><stop offset="0.5" stop-color="#ffb347"/><stop offset="0.62" stop-color="#ff5a2a"/><stop offset="1" stop-color="#ff8a4a"/></linearGradient>
      <marker id="d-ac" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#6fd3e8"/></marker>
      <marker id="d-ah" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#ff7a3d"/></marker>
      <marker id="d-am" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#ebc690"/></marker>
    </defs>
    <line x1="4" x2="${W - 4}" y1="${ax}" y2="${ax}" class="d-axis"/>
    ${parts.join("\n    ")}
  </svg>`;
}
