import assert from "node:assert/strict";
import { test } from "node:test";
import T from "../data/fcom/b737-8-lrc.json" with { type: "json" };
import { type LrcTable, interpolateLrcMach } from "../src/cruise.ts";

const close = (actual: number | undefined, expected: number) => {
  assert.ok(actual !== undefined && Math.abs(actual - expected) < 1e-12, `${actual} вместо ${expected}`);
};

test("LRC 737-8: все 80 исходных ячеек FCOM воспроизводятся точно", () => {
  let n = 0;
  for (const [mass, row] of Object.entries(T.rows)) row.forEach((cell, i) => {
    assert.equal(interpolateLrcMach(T, +mass * 1000, T.altitudesFt[i] / 100), cell[1]);
    n++;
  });
  assert.equal(n, 80);
});

test("LRC: интерполяция по массе, эшелону и обеим осям без округления входов", () => {
  // FL330/350, 55/60 т: 0,715 / 0,742 и 0,740 / 0,767.
  close(interpolateLrcMach(T, 57500, 330), (0.715 + 0.740) / 2);
  close(interpolateLrcMach(T, 60000, 340), (0.740 + 0.767) / 2);
  close(interpolateLrcMach(T, 57500, 340), (0.715 + 0.742 + 0.740 + 0.767) / 4);
  close(interpolateLrcMach(T, 56001, 334), 0.715 + (0.740 - 0.715) * (1001 / 5000) + (0.742 - 0.715) * (4 / 20));
  assert.notEqual(interpolateLrcMach(T, 56001, 334), interpolateLrcMach(T, 56002, 334));
});

test("LRC: границы таблицы включены, экстраполяции массы и высоты нет", () => {
  assert.equal(interpolateLrcMach(T, 40000, 250), 0.527);
  assert.equal(interpolateLrcMach(T, 85000, 350), 0.789);
  assert.equal(interpolateLrcMach(T, 60000, 410), 0.795);
  for (const [mass, fl] of [[39999, 350], [85001, 350], [60000, 249.9], [60000, 410.1]]) {
    assert.equal(interpolateLrcMach(T, mass, fl), undefined);
  }
});

test("LRC: отсутствующие ячейки у потолка не заполняются соседними", () => {
  assert.equal(interpolateLrcMach(T, 80000, 370), undefined);
  assert.equal(interpolateLrcMach(T, 77500, 360), undefined);
  assert.equal(interpolateLrcMach(T, 62500, 410), undefined);
  // Точная строка или точный столбец не требуют отсутствующих узлов за их пределами.
  assert.equal(interpolateLrcMach(T, 75000, 370), 0.793);
  close(interpolateLrcMach(T, 77500, 350), (0.797 + 0.795) / 2);
  close(interpolateLrcMach(T, 75000, 360), (0.797 + 0.793) / 2);
});

test("LRC: функция универсальна, порядок осей не меняет интерполяцию", () => {
  const table: LrcTable = {
    _source: "Синтетическая таблица для проверки интерполяции",
    altitudesFt: [35000, 25000],
    rows: { "80": [[80, 0.9, 0, 0], [80, 0.6, 0, 0]], "40": [[80, 0.7, 0, 0], [80, 0.5, 0, 0]] },
  };
  close(interpolateLrcMach(table, 60000, 300), 0.675);
  // Неравные веса и разные наклоны строк требуют всех четырёх углов.
  close(interpolateLrcMach(table, 50000, 275), 0.58125);
});

test("LRC: пустые таблицы, неоднозначные оси и невалидные входы не дают скорость", () => {
  const empty: LrcTable = { _source: "empty", altitudesFt: [], rows: {} };
  assert.equal(interpolateLrcMach(empty, 60000, 350), undefined);
  assert.equal(interpolateLrcMach({ ...empty, altitudesFt: [35000] }, 60000, 350), undefined);
  assert.equal(interpolateLrcMach({ ...empty, rows: { "60": [] } }, 60000, 350), undefined);
  assert.equal(interpolateLrcMach({ ...T, altitudesFt: [35000, 35000] }, 60000, 350), undefined);
  for (const mass of [NaN, Infinity, -Infinity, 0, -1]) assert.equal(interpolateLrcMach(T, mass, 350), undefined);
  for (const fl of [NaN, Infinity, -Infinity, -1]) assert.equal(interpolateLrcMach(T, 60000, fl), undefined);
  const badCell: LrcTable = { _source: "invalid", altitudesFt: [35000], rows: { "60": [[80, NaN, 250, 1000]] } };
  assert.equal(interpolateLrcMach(badCell, 60000, 350), undefined);
});
