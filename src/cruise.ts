/** Таблица FCOM LRC: масса в тоннах, высота в футах; ячейка [%N1, Mach, KIAS, FF/ENG кг/ч]. */
export interface LrcTable {
  _source: string;
  altitudesFt: number[];
  rows: Record<string, number[][]>;
}

interface PreparedLrcTable {
  massesKg: number[];
  flightLevels: number[];
  mach: (number | undefined)[][];
}

// Исходные таблицы — неизменяемые данные. Подготовка и сортировка нужны только при первом обращении.
const preparedTables = new WeakMap<LrcTable, PreparedLrcTable | null>();

function prepare(table: LrcTable): PreparedLrcTable | null {
  if (!Array.isArray(table.altitudesFt) || !table.rows || typeof table.rows !== "object") return null;
  const columns = table.altitudesFt.map((ft, index) => ({ fl: ft / 100, index })).sort((a, b) => a.fl - b.fl);
  const rows = Object.entries(table.rows).map(([tonnes, cells]) => ({ kg: Number(tonnes) * 1000, cells })).sort((a, b) => a.kg - b.kg);
  if (!columns.length || !rows.length) return null;
  if (columns.some((c, i) => !Number.isFinite(c.fl) || c.fl < 0 || (i > 0 && c.fl === columns[i - 1].fl))) return null;
  if (rows.some((r, i) => !Number.isFinite(r.kg) || r.kg <= 0 || !Array.isArray(r.cells) || (i > 0 && r.kg === rows[i - 1].kg))) return null;
  return {
    massesKg: rows.map((r) => r.kg),
    flightLevels: columns.map((c) => c.fl),
    mach: rows.map((r) => columns.map((c) => {
      const m = r.cells[c.index]?.[1];
      return Number.isFinite(m) && m > 0 ? m : undefined;
    })),
  };
}

/** Два соседних узла; для точного попадания оба индекса одинаковы. Экстраполяции нет. */
function bracket(axis: number[], value: number): [number, number] | undefined {
  if (value < axis[0] || value > axis[axis.length - 1]) return undefined;
  let lo = 0;
  let hi = axis.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (axis[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return axis[lo] === value ? [lo, lo] : [lo - 1, lo];
}

/**
 * Скорость LRC по массе (кг) и эшелону (FL), с линейной интерполяцией по обеим осям.
 * Возвращает undefined вне таблицы или при отсутствии любого нужного узла. Пустые ячейки у потолка
 * не заполняются и не экстраполируются. Точные узлы сохраняются без округления массы или скорости.
 * Таблицу нельзя менять после первого вызова: подготовленные оси кешируются по её объекту.
 */
export function interpolateLrcMach(table: LrcTable, massKg: number, fl: number): number | undefined {
  if (!Number.isFinite(massKg) || massKg <= 0 || !Number.isFinite(fl) || fl < 0) return undefined;
  let t = preparedTables.get(table);
  if (t === undefined) {
    t = prepare(table);
    preparedTables.set(table, t);
  }
  if (!t) return undefined;
  const mass = bracket(t.massesKg, massKg);
  const altitude = bracket(t.flightLevels, fl);
  if (!mass || !altitude) return undefined;
  const [m0, m1] = mass;
  const [h0, h1] = altitude;
  const atMass = (m: number): number | undefined => {
    const a = t.mach[m][h0];
    const b = t.mach[m][h1];
    if (a === undefined || b === undefined) return undefined;
    return h0 === h1 ? a : a + (b - a) * ((fl - t.flightLevels[h0]) / (t.flightLevels[h1] - t.flightLevels[h0]));
  };
  const a = atMass(m0);
  if (a === undefined || m0 === m1) return a;
  const b = atMass(m1);
  if (b === undefined) return undefined;
  return a + (b - a) * ((massKg - t.massesKg[m0]) / (t.massesKg[m1] - t.massesKg[m0]));
}
