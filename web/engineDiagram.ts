// Схема двухконтурного двигателя — верхняя половина продольного разреза, как на учебных плакатах:
// гондола с воздухозаборником, кок и лопатка вентилятора, разделитель потоков, подпорный компрессор,
// компрессор ВД (ступени сужаются), камера сгорания с форсункой и пламенем, турбины ВД и НД
// (ступени расширяются), сопло и центральное тело; два вала; холодный и горячий потоки.
// Размеры ядра и число ступеней берутся из текущего двигателя, поэтому рычаг двухконтурности виден и здесь.

export interface DiagramInput {
  bypassRatio: number;
  coreRadius: number; // доля радиуса вентилятора
  boosterStages: number;
  hpcStages: number;
  hptStages: number;
  lptStages: number;
  separateFlow: boolean;
}

export function engineDiagram(p: DiagramInput): string {
  const W = 340;
  const H = 170;
  const ax = 156;
  const R = 128;
  const rc = R * p.coreRadius;
  const y = (r: number) => (ax - r).toFixed(1);
  const parts: string[] = [];
  const poly = (pts: [number, number][], cls: string) =>
    parts.push(`<polygon points="${pts.map(([x, r]) => `${x.toFixed(1)},${y(r)}`).join(" ")}" class="${cls}"/>`);
  const path = (d: string, cls: string, extra = "") => parts.push(`<path d="${d}" class="${cls}" ${extra}/>`);

  // Гондола: воздухозаборник с губой, наружный контур.
  const nacEnd = p.separateFlow ? 210 : 262;
  path(
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
  const coreEnd = p.separateFlow ? 282 : 252;
  path(`M82,${y(rc * 1.08)} L96,${y(rc * 1.32)} L190,${y(rc * 1.28)} L${coreEnd},${y(rc * 0.95)} L${coreEnd},${y(rc * 0.8)} L190,${y(rc * 1.12)} L96,${y(rc * 1.16)} Z`, "d-cowl");
  // Подпорный компрессор (вал НД).
  for (let i = 0; i < p.boosterStages; i++) {
    const x = 84 + i * 6;
    poly([[x, rc * 0.55], [x + 3, rc * 0.55], [x + 3, rc * 1.05], [x, rc * 1.05]], i % 2 ? "d-stator" : "d-lp");
  }
  // Компрессор ВД: ступени сужаются.
  const hx0 = 84 + p.boosterStages * 6 + 6;
  const hx1 = 176;
  for (let i = 0; i < p.hpcStages; i++) {
    const t = i / Math.max(1, p.hpcStages - 1);
    const x = hx0 + (i * (hx1 - hx0)) / p.hpcStages;
    const r = rc * (0.95 - 0.3 * t);
    const hub = rc * (0.42 + 0.12 * t);
    poly([[x, hub], [x + 3.5, hub], [x + 3.5, r], [x, r]], i % 2 ? "d-stator" : "d-hp");
  }
  // Камера сгорания: жаровая труба, форсунка, пламя.
  const cx0 = hx1 + 4;
  const cx1 = cx0 + 28;
  const cr = rc * 0.62;
  path(`M${cx0},${y(cr - 10)} Q${cx0 + 8},${y(cr + 12)} ${cx1},${y(cr + 8)} L${cx1},${y(cr - 14)} Q${cx0 + 8},${y(cr - 18)} ${cx0},${y(cr - 10)} Z`, "d-liner");
  path(`M${cx0 + 4},${y(cr)} Q${cx0 + 16},${y(cr + 7)} ${cx1 - 2},${y(cr)} Q${cx0 + 16},${y(cr - 8)} ${cx0 + 4},${y(cr)} Z`, "d-flame");
  parts.push(`<circle cx="${cx0 + 2}" cy="${y(cr)}" r="2.2" class="d-hp"/>`);
  // Турбина ВД.
  const tx0 = cx1 + 4;
  for (let i = 0; i < p.hptStages; i++) poly([[tx0 + i * 7, rc * 0.45], [tx0 + i * 7 + 4, rc * 0.45], [tx0 + i * 7 + 4, rc * 0.7], [tx0 + i * 7, rc * 0.7]], "d-hp");
  // Турбина НД: ступени расширяются.
  const lx0 = tx0 + p.hptStages * 7 + 5;
  const lx1 = (p.separateFlow ? coreEnd : nacEnd) - 26;
  for (let i = 0; i < p.lptStages; i++) {
    const t = i / Math.max(1, p.lptStages - 1);
    const x = lx0 + (i * (lx1 - lx0)) / p.lptStages;
    poly([[x, rc * (0.4 - 0.05 * t)], [x + 3.5, rc * (0.4 - 0.05 * t)], [x + 3.5, rc * (0.72 + 0.2 * t)], [x, rc * (0.72 + 0.2 * t)]], i % 2 ? "d-stator" : "d-lp");
  }
  // Центральное тело (конус) за турбиной.
  poly([[lx1, rc * 0.36], [lx1 + 34, 4], [lx1 + 34, 0], [lx1, 0]], "d-cowl");
  // Барабаны роторов (диски) — от вала до корней лопаток.
  parts.push(`<rect x="${hx0}" y="${y(rc * 0.48)}" width="${hx1 - hx0}" height="${(rc * 0.48 - 20).toFixed(1)}" class="d-drum-hp"/>`);
  parts.push(`<rect x="${lx0}" y="${y(rc * 0.38)}" width="${lx1 - lx0}" height="${(rc * 0.38 - 9).toFixed(1)}" class="d-drum-lp"/>`);
  // Валы: НД — тонкий, сквозной; ВД — полый, короче.
  parts.push(`<rect x="58" y="${y(9)}" width="${lx1 - 58}" height="5" class="d-lp"/>`);
  parts.push(`<rect x="${hx0}" y="${y(20)}" width="${tx0 + p.hptStages * 7 - hx0}" height="6" class="d-hp"/>`);
  // Потоки.
  const yb = (R + rc * 1.3) / 2;
  parts.push(`<path d="M2,${y(yb)} L${nacEnd + 30},${y(yb - (p.separateFlow ? 4 : 20))}" class="d-cold" marker-end="url(#d-ac)"/>`);
  parts.push(
    `<path d="M2,${y(rc * 0.85)} L78,${y(rc * 0.85)} Q90,${y(rc * 0.75)} ${hx1},${y(rc * 0.6)} L${lx1 + 20},${y(rc * 0.6)} L${W - 4},${y(rc * 0.45)}" class="d-hotflow" marker-end="url(#d-ah)"/>`,
  );
  // Подписи.
  const lbl = (x: number, r: number, t: string, anchor = "middle") => parts.push(`<text x="${x}" y="${y(r)}" text-anchor="${anchor}">${t}</text>`);
  lbl(67, R + 22, "вентилятор");
  lbl(150, R - 14, "наружный контур");
  lbl((hx0 + hx1) / 2, -12, "КВД");
  lbl(cx0 + 14, -12, "КС");
  lbl((lx0 + lx1) / 2, -12, "ТНД");
  lbl(tx0 + 4, -24, "ТВД");
  lbl(90, -12, "КНД");
  return `<svg viewBox="0 0 ${W} ${H + 18}" class="engine-diagram" role="img" aria-label="Схема двухконтурного двигателя: верхняя половина разреза">
    <defs>
      <linearGradient id="d-hotgrad" x1="0" x2="1"><stop offset="0" stop-color="#7fd3ff"/><stop offset="0.5" stop-color="#ffb347"/><stop offset="0.62" stop-color="#ff5a2a"/><stop offset="1" stop-color="#ff8a4a"/></linearGradient>
      <marker id="d-ac" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#6fd3e8"/></marker>
      <marker id="d-ah" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#ff7a3d"/></marker>
    </defs>
    <line x1="4" x2="${W - 4}" y1="${ax}" y2="${ax}" class="d-axis"/>
    ${parts.join("\n    ")}
  </svg>`;
}
