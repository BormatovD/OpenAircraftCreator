import assert from "node:assert/strict";
import { test } from "node:test";
import source from "../data/fcom/a319-112-hc-clf-phases.json" with { type: "json" };
import { type PhaseTableDataset, lookupClimb, lookupDescent, lookupHolding } from "../src/phaseTables.ts";

function fixture(): PhaseTableDataset {
  const data: PhaseTableDataset = {
    climb: { rows: [] },
    descent: { rows: [], referenceIsaDeviationC: 0 },
    holding: { rows: [], engineCount: 2, referenceIsaDeviationC: 0 },
  };
  for (const u of [0, 1]) for (const v of [0, 1]) {
    const massKg = 52000 + u * 12000;
    const fl = 250 + v * 100;
    for (const w of [0, 1]) data.climb.rows.push({
      massKg, fl, isaDeviationC: 10 + w * 10,
      fuelKg: 1000 + 300 * u + 200 * v + 100 * w + 80 * u * v + 60 * u * w + 40 * v * w + 20 * u * v * w,
      timeMin: 10 + 2 * u + 5 * v + 3 * w,
      distanceNm: 60 + 20 * u + 30 * v + 10 * w,
      tasKt: 350 + 10 * u + 20 * v + 30 * w,
      pdfPage: 3205 + w,
    });
    data.descent.rows.push({ massKg, fl, timeMin: 10 + u + 2 * v, fuelKg: 100 + 20 * u + 30 * v + 10 * u * v, distanceNm: 50 + 10 * u + 20 * v, n1Pct: null, pdfPage: 3247 });
    data.holding.rows.push({ massKg, fl, n1Pct: 50 + 2 * u + 4 * v, fuelFlowPerEngineKgH: 1000 + 100 * u + 200 * v + 50 * u * v, pdfPage: 3239 });
  }
  return data;
}

const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} вместо ${expected}`);

test("таблицы фаз: точные узлы сохраняются без интерполяции номеров страниц", () => {
  const data = fixture();
  for (const { pdfPage: _page, ...row } of data.climb.rows) assert.deepEqual(lookupClimb(data, row.massKg, row.fl, row.isaDeviationC), row);
  for (const { pdfPage: _page, ...row } of data.descent.rows) assert.deepEqual(lookupDescent(data, row.massKg, row.fl), { ...row, isaDeviationC: 0 });
  for (const { pdfPage: _page, ...row } of data.holding.rows) assert.deepEqual(lookupHolding(data, row.massKg, row.fl), { ...row, isaDeviationC: 0 });
});

test("набор: трёхмерная интерполяция с неравными весами всех восьми углов", () => {
  const data = fixture();
  const p = lookupClimb(data, 55000, 290, 13)!;
  near(p.fuelKg, 1202.9);
  near(p.timeMin, 13.4);
  near(p.distanceNm, 80);
  near(p.tasKt, 369.5);
  assert.equal(p.massKg, 55000);
  assert.equal(p.fl, 290);
  assert.equal(p.isaDeviationC, 13);
  // Края по двум осям оставляют интерполяцию только по третьей.
  near(lookupClimb(data, 55000, 250, 10)!.fuelKg, 1075);
  near(lookupClimb(data, 52000, 290, 10)!.fuelKg, 1080);
  near(lookupClimb(data, 52000, 250, 13)!.fuelKg, 1030);
});

test("снижение и ожидание: билинейная интерполяция по массе и FL", () => {
  const data = fixture();
  const descent = lookupDescent(data, 55000, 290)!;
  near(descent.fuelKg, 118);
  near(descent.timeMin, 11.05);
  near(descent.distanceNm, 60.5);
  assert.equal(descent.n1Pct, null);
  const holding = lookupHolding(data, 55000, 290)!;
  near(holding.fuelFlowPerEngineKgH, 1110);
  near(holding.n1Pct, 52.1);
  assert.equal(holding.isaDeviationC, 0);
});

test("нельзя экстраполировать ISA0 из тёплых таблиц, массу или высоту", () => {
  const data = fixture();
  for (const temp of [0, 9.99, 20.01]) assert.equal(lookupClimb(data, 60000, 300, temp), undefined);
  for (const [mass, fl] of [[51999, 300], [64001, 300], [60000, 249.99], [60000, 350.01]]) {
    assert.equal(lookupClimb(data, mass, fl, 15), undefined);
    assert.equal(lookupDescent(data, mass, fl), undefined);
    assert.equal(lookupHolding(data, mass, fl), undefined);
  }
});

test("отсутствующие углы не заполняются; точная грань не требует внешних узлов", () => {
  const data = fixture();
  data.climb.rows = data.climb.rows.filter((r) => !(r.massKg === 64000 && r.fl === 350 && r.isaDeviationC === 20));
  data.descent.rows = data.descent.rows.filter((r) => !(r.massKg === 64000 && r.fl === 350));
  data.holding.rows = data.holding.rows.filter((r) => !(r.massKg === 64000 && r.fl === 350));
  assert.equal(lookupClimb(data, 55000, 290, 13), undefined);
  assert.equal(lookupDescent(data, 55000, 290), undefined);
  assert.equal(lookupHolding(data, 55000, 290), undefined);
  assert.ok(lookupClimb(data, 55000, 290, 10));
  assert.ok(lookupClimb(data, 52000, 290, 13));
  assert.ok(lookupDescent(data, 52000, 290));
  assert.ok(lookupHolding(data, 55000, 250));
});

test("IDLE не становится нулевым N1 и не смешивается численно с числовым режимом", () => {
  const data = fixture();
  data.descent.rows[0].n1Pct = 68.2;
  assert.equal(lookupDescent(data, 52000, 250)!.n1Pct, 68.2);
  assert.equal(lookupDescent(data, 64000, 350)!.n1Pct, null);
  const mixed = lookupDescent(data, 55000, 290)!;
  assert.equal(mixed.n1Pct, undefined);
  near(mixed.fuelKg, 118);
  const numeric = fixture();
  for (const row of numeric.descent.rows) row.n1Pct = row.massKg === 52000 ? 50 : 70;
  near(lookupDescent(numeric, 55000, 290)!.n1Pct as number, 55);
});

test("ожидание сохраняет кг/ч на двигатель независимо от engineCount", () => {
  const data = fixture();
  const other = structuredClone(data);
  other.holding.engineCount = 4;
  assert.deepEqual(lookupHolding(data, 55000, 290), lookupHolding(other, 55000, 290));
  assert.equal(lookupHolding(data, 55000, 290)!.fuelFlowPerEngineKgH, 1110);
});

test("нулевой расход на границе снижения допустим, пустые и неоднозначные точки — нет", () => {
  const data = fixture();
  const zero = { massKg: 60000, fl: 15, timeMin: 0, fuelKg: 0, distanceNm: 0, n1Pct: null, pdfPage: 3247 };
  data.descent.rows = [zero];
  assert.equal(lookupDescent(data, 60000, 15)!.fuelKg, 0);
  const duplicate = structuredClone(data);
  duplicate.descent.rows.push({ ...zero });
  assert.equal(lookupDescent(duplicate, 60000, 15), undefined);
  const empty: PhaseTableDataset = { climb: { rows: [] }, descent: { rows: [], referenceIsaDeviationC: 0 }, holding: { rows: [], engineCount: 2, referenceIsaDeviationC: 0 } };
  assert.equal(lookupClimb(empty, 60000, 350, 10), undefined);
  assert.equal(lookupDescent(empty, 60000, 350), undefined);
  assert.equal(lookupHolding(empty, 60000, 350), undefined);
});

test("невалидные входы и физические значения не дают числовой результат", () => {
  const data = fixture();
  for (const mass of [NaN, Infinity, -Infinity, 0, -1]) {
    assert.equal(lookupClimb(data, mass, 300, 15), undefined);
    assert.equal(lookupDescent(data, mass, 300), undefined);
    assert.equal(lookupHolding(data, mass, 300), undefined);
  }
  for (const fl of [NaN, Infinity, -Infinity, -1]) {
    assert.equal(lookupClimb(data, 60000, fl, 15), undefined);
    assert.equal(lookupDescent(data, 60000, fl), undefined);
    assert.equal(lookupHolding(data, 60000, fl), undefined);
  }
  for (const temp of [NaN, Infinity, -Infinity]) assert.equal(lookupClimb(data, 60000, 300, temp), undefined);
  const bad = fixture();
  bad.climb.rows[0].fuelKg = NaN;
  bad.holding.rows[0].fuelFlowPerEngineKgH = -100;
  assert.equal(lookupClimb(bad, 52000, 250, 10), undefined);
  assert.equal(lookupHolding(bad, 52000, 250), undefined);
});

test("A319 HC-CLF: контрольные значения проверенных страниц и единицы FF на двигатель", () => {
  assert.deepEqual(lookupClimb(source, 60000, 350, 10), {
    massKg: 60000, fl: 350, isaDeviationC: 10, timeMin: 18, fuelKg: 1458, distanceNm: 117, tasKt: 384,
  });
  assert.deepEqual(lookupDescent(source, 45000, 350), {
    massKg: 45000, fl: 350, isaDeviationC: 0, timeMin: 12.6, fuelKg: 124, distanceNm: 75, n1Pct: null,
  });
  assert.deepEqual(lookupDescent(source, 65000, 350), {
    massKg: 65000, fl: 350, isaDeviationC: 0, timeMin: 16.2, fuelKg: 158, distanceNm: 97, n1Pct: null,
  });
  const descent60 = lookupDescent(source, 60000, 350)!;
  near(descent60.fuelKg, 149.5);
  near(descent60.distanceNm, 91.5);
  near(descent60.timeMin, 15.3);
  const holding = lookupHolding(source, 60000, 15)!;
  assert.equal(holding.n1Pct, 51.5);
  assert.equal(holding.fuelFlowPerEngineKgH, 1125);
  // Перевод в расход всего самолёта делается явно вызывающим кодом.
  assert.equal(holding.fuelFlowPerEngineKgH * source.holding.engineCount, 2250);
});

test("A319 HC-CLF: все 643 узла воспроизводятся точно — проверка lookup, не калибровка модели", () => {
  assert.equal(source.climb.rows.filter((r) => r.isaDeviationC === 10).length, 241);
  assert.equal(source.climb.rows.filter((r) => r.isaDeviationC === 20).length, 230);
  assert.equal(source.descent.rows.length, 36);
  assert.equal(source.holding.rows.length, 136);
  for (const r of source.climb.rows) {
    assert.deepEqual(lookupClimb(source, r.massKg, r.fl, r.isaDeviationC), {
      massKg: r.massKg, fl: r.fl, isaDeviationC: r.isaDeviationC,
      timeMin: r.timeMin, fuelKg: r.fuelKg, distanceNm: r.distanceNm, tasKt: r.tasKt,
    });
  }
  for (const r of source.descent.rows) {
    assert.deepEqual(lookupDescent(source, r.massKg, r.fl), {
      massKg: r.massKg, fl: r.fl, isaDeviationC: 0,
      timeMin: r.timeMin, fuelKg: r.fuelKg, distanceNm: r.distanceNm, n1Pct: r.n1Pct,
    });
  }
  for (const r of source.holding.rows) {
    assert.deepEqual(lookupHolding(source, r.massKg, r.fl), {
      massKg: r.massKg, fl: r.fl, isaDeviationC: 0, n1Pct: r.n1Pct, fuelFlowPerEngineKgH: r.fuelFlowPerEngineKgH,
    });
  }
});

test("A319 HC-CLF: ISA0 не восстанавливается, пустая ячейка 78т/FL330/+20 сохраняется", () => {
  assert.equal(lookupClimb(source, 60000, 350, 0), undefined);
  assert.equal(lookupClimb(source, 78000, 330, 20), undefined);
  assert.equal(lookupClimb(source, 77000, 320, 15), undefined);
  assert.ok(lookupClimb(source, 77000, 320, 10));
  // Существующий справочный узел сохраняется независимо от эксплуатационных весовых ограничений.
  assert.ok(lookupClimb(source, 78000, 290, 10));
  const mixedN1 = lookupDescent(source, 55000, 390)!;
  assert.equal(mixedN1.n1Pct, undefined);
  near(mixedN1.fuelKg, 161.5);
  for (const mass of [45000, 65000]) {
    const boundary = lookupDescent(source, mass, 15)!;
    assert.equal(boundary.fuelKg, 0);
    assert.equal(boundary.timeMin, 0);
    assert.equal(boundary.distanceNm, 0);
  }
});
