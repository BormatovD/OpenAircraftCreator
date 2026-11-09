// Калибровка ядра по диаграммам нагрузка–дальность A320 и отчёт об ошибке.
// Запуск: node scripts/calibrate-a320.ts  (Node ≥ 22.18, типы снимаются встроенно)

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { type AeroConfig, aspectRatio, maxLiftToDrag } from "../src/aero.ts";
import { flightLevelToM, isa } from "../src/atmosphere.ts";
import { calibrateTsfc, tsfcToImperial } from "../src/calibrate.ts";
import { DEFAULT_ASSUMPTIONS, LHV_JET_A } from "../src/mission.ts";
import { A320CEO, A320NEO } from "../src/aircraft/a320.ts";
import { A320_CONTEXT } from "../src/aircraft/a320Context.ts";
import { type AircraftDefinition } from "../src/definition.ts";
import { aeroFor as modelAero } from "../src/evaluate.ts";
import { type AircraftData, chartOewKg, compareAircraft, maxAbsErrorPct, rmsErrorPct } from "../src/payloadRange.ts";

const data = JSON.parse(readFileSync(new URL("../data/a320.json", import.meta.url), "utf8"));
const density: number = data.fuelDensityKgPerL;
const as = DEFAULT_ASSUMPTIONS;

// Аэродинамика — тем же путём, что в модели: сопротивление по составляющим (с гондолами своего двигателя),
// e по Оберту и волновое по Корну, привязанные к поляре Poll & Schumann на A320 с шарклетами.
const DEFS: Record<string, AircraftDefinition> = {
  ceo_fence: A320CEO,
  ceo_sharklet: { ...A320CEO, wing: { ...A320CEO.wing, tip: "sharklet" } },
  neo: A320NEO,
};
const aeroFor = (ac: AircraftData): AeroConfig => {
  const key = Object.keys(data.aircraft).find((k) => data.aircraft[k] === ac)!;
  return modelAero(DEFS[key], A320_CONTEXT.aero, []);
};

const ceoS: AircraftData = data.aircraft.ceo_sharklet;
const ceoF: AircraftData = data.aircraft.ceo_fence;
const neo: AircraftData = data.aircraft.neo;

const calCeo = calibrateTsfc(ceoS, aeroFor(ceoS), as, density);
const calNeo = calibrateTsfc(neo, aeroFor(neo), as, density);
// Проверка, а не подгонка: CEO с «заборчиками» считаем с TSFC от CEO с шарклетами.
const valFence = compareAircraft(ceoF, aeroFor(ceoF), { tsfcCruise: calCeo.tsfcCruise }, as, density);

// Независимая проверка TSFC CEO: общий КПД η_o = 0,309 при M 0,753 (Poll & Schumann, табл. 1–2).
const atm = isa(flightLevelToM(as.cruiseFL));
const tsfcPoll = (0.753 * atm.speedOfSoundMs) / (0.309 * LHV_JET_A);

const oews = (ac: AircraftData) => ac.curves.map((c) => Math.round(chartOewKg(ac, c, density, as.taxiFuelKg)));

const report = {
  assumptions: as,
  aero: {
    cd0Sharklet: aeroFor(ceoS).cd0,
    cd0Neo: aeroFor(neo).cd0,
    arSharklet: aspectRatio(aeroFor(ceoS)),
    arFence: aspectRatio(aeroFor(ceoF)),
    ldMaxSharklet: maxLiftToDrag(aeroFor(ceoS)),
  },
  ceo: {
    tsfc: calCeo.tsfcCruise,
    tsfcImperial: tsfcToImperial(calCeo.tsfcCruise),
    rmsPct: calCeo.rmsPct,
    maxAbsPct: maxAbsErrorPct(calCeo.rows),
    chartOewKg: oews(ceoS),
    rows: calCeo.rows,
  },
  neo: {
    tsfc: calNeo.tsfcCruise,
    tsfcImperial: tsfcToImperial(calNeo.tsfcCruise),
    rmsPct: calNeo.rmsPct,
    maxAbsPct: maxAbsErrorPct(calNeo.rows),
    chartOewKg: oews(neo),
    rows: calNeo.rows,
  },
  fenceValidation: {
    rmsPct: rmsErrorPct(valFence),
    maxAbsPct: maxAbsErrorPct(valFence),
    chartOewKg: oews(ceoF),
    rows: valFence,
  },
  checks: {
    tsfcRatioNeoToCeo: calNeo.tsfcCruise / calCeo.tsfcCruise,
    tsfcCeoFromPollEta: tsfcPoll,
    tsfcCeoFromPollEtaImperial: tsfcToImperial(tsfcPoll),
    ceoVsPollPct: ((calCeo.tsfcCruise - tsfcPoll) / tsfcPoll) * 100,
  },
};

mkdirSync(new URL("../out/", import.meta.url), { recursive: true });
writeFileSync(new URL("../out/calibration-a320.json", import.meta.url), JSON.stringify(report, null, 2));

const fmt = (x: number, d = 1) => x.toFixed(d);
const table = (rows: typeof calCeo.rows) =>
  rows.map((r) => `  ${r.curve.padEnd(16)} ${r.corner.padEnd(10)} chart ${fmt(r.chartNm, 0).padStart(5)} nm  model ${fmt(r.modelNm, 0).padStart(5)} nm  ${fmt(r.errorPct).padStart(5)}%`).join("\n");

console.log(`CEO (шарклеты): TSFC ${fmt(report.ceo.tsfcImperial, 3)} lb/lbf/h, RMS ${fmt(report.ceo.rmsPct)}%, max ${fmt(report.ceo.maxAbsPct)}%`);
console.log(`  OEW из графиков: ${report.ceo.chartOewKg.join(", ")} кг`);
console.log(table(calCeo.rows));
console.log(`NEO: TSFC ${fmt(report.neo.tsfcImperial, 3)} lb/lbf/h, RMS ${fmt(report.neo.rmsPct)}%, max ${fmt(report.neo.maxAbsPct)}%`);
console.log(`  OEW из графиков: ${report.neo.chartOewKg.join(", ")} кг`);
console.log(table(calNeo.rows));
console.log(`Проверка CEO с «заборчиками» (без подгонки): RMS ${fmt(report.fenceValidation.rmsPct)}%, max ${fmt(report.fenceValidation.maxAbsPct)}%`);
console.log(table(valFence));
console.log(`TSFC NEO/CEO = ${fmt(report.checks.tsfcRatioNeoToCeo, 3)}`);
console.log(`TSFC CEO по η_o Poll & Schumann = ${fmt(report.checks.tsfcCeoFromPollEtaImperial, 3)} lb/lbf/h; калибровка отличается на ${fmt(report.checks.ceoVsPollPct)}%`);
console.log(`L/D max (шарклеты, AR ${fmt(report.aero.arSharklet, 2)}) = ${fmt(report.aero.ldMaxSharklet, 1)}`);
