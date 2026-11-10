// Справочные таблицы фаз FCOM. Этот файл не подключён к расчёту миссии и не переносит данные
// одного типа на другой. Покрытие таблицы не означает допустимость массы или режима самолёта.

export interface PhaseCoordinates {
  massKg: number;
  fl: number;
}

export interface ClimbPoint extends PhaseCoordinates {
  isaDeviationC: number;
  timeMin: number;
  fuelKg: number;
  distanceNm: number;
  tasKt: number;
}

export interface DescentPoint extends PhaseCoordinates {
  isaDeviationC: number;
  timeMin: number;
  fuelKg: number;
  distanceNm: number;
  /** null — IDLE в источнике; undefined — смешанные IDLE/числовые узлы, числовой N1 не определён. */
  n1Pct: number | null | undefined;
}

export interface HoldingPoint extends PhaseCoordinates {
  isaDeviationC: number;
  n1Pct: number;
  /** Расход одного двигателя; число двигателей здесь не применяется. */
  fuelFlowPerEngineKgH: number;
}

export interface PhaseTableDataset {
  climb: { rows: (ClimbPoint & { pdfPage: number })[] };
  descent: {
    rows: (PhaseCoordinates & { timeMin: number; fuelKg: number; distanceNm: number; n1Pct: number | null; pdfPage: number })[];
    referenceIsaDeviationC: number;
  };
  holding: {
    rows: (PhaseCoordinates & { n1Pct: number; fuelFlowPerEngineKgH: number; pdfPage: number })[];
    engineCount: number;
    referenceIsaDeviationC: number;
  };
}

type Axis = "massKg" | "fl" | "isaDeviationC";
type RowCoordinates = PhaseCoordinates & { isaDeviationC?: number };
interface Grid {
  axes: number[][];
  points: Map<string, RowCoordinates | null>;
}
interface WeightedRow<R> { row: R; weight: number }

// Таблицы неизменяемы после первого обращения. Страницы, применимость и поправки остаются
// метаданными источника; они не интерполируются и не применяются автоматически.
const grids = new WeakMap<object, Grid>();
const pointKey = (coordinates: number[]) => coordinates.join("|");

function prepare<R extends RowCoordinates>(table: { rows: R[] }, axes: Axis[]): Grid {
  const values = axes.map(() => new Set<number>());
  const points = new Map<string, RowCoordinates | null>();
  for (const row of table.rows) {
    const coordinates = axes.map((axis) => row[axis] as number);
    if (!coordinates.every(Number.isFinite) || row.massKg <= 0 || row.fl < 0) continue;
    coordinates.forEach((v, i) => values[i].add(v));
    const key = pointKey(coordinates);
    // Два исходных значения для одной точки неоднозначны — такую точку нельзя использовать.
    points.set(key, points.has(key) ? null : row);
  }
  return { axes: values.map((set) => [...set].sort((a, b) => a - b)), points };
}

function bracket(axis: number[], value: number): { value: number; weight: number }[] | undefined {
  if (!axis.length || value < axis[0] || value > axis[axis.length - 1]) return undefined;
  let lo = 0;
  let hi = axis.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (axis[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  if (axis[lo] === value) return [{ value, weight: 1 }];
  const weight = (value - axis[lo - 1]) / (axis[lo] - axis[lo - 1]);
  return [{ value: axis[lo - 1], weight: 1 - weight }, { value: axis[lo], weight }];
}

function corners<R extends RowCoordinates>(table: { rows: R[] }, axes: Axis[], coordinates: number[]): WeightedRow<R>[] | undefined {
  let grid = grids.get(table);
  if (!grid) {
    grid = prepare(table, axes);
    grids.set(table, grid);
  }
  let combinations: { coordinates: number[]; weight: number }[] = [{ coordinates: [], weight: 1 }];
  for (let i = 0; i < axes.length; i++) {
    const bounds = bracket(grid.axes[i], coordinates[i]);
    if (!bounds) return undefined;
    combinations = combinations.flatMap((c) => bounds.map((b) => ({ coordinates: [...c.coordinates, b.value], weight: c.weight * b.weight })));
  }
  const out: WeightedRow<R>[] = [];
  for (const c of combinations) {
    const row = grid.points.get(pointKey(c.coordinates));
    if (!row) return undefined;
    out.push({ row: row as R, weight: c.weight });
  }
  return out;
}

function validCoordinates(massKg: number, fl: number): boolean {
  return Number.isFinite(massKg) && massKg > 0 && Number.isFinite(fl) && fl >= 0;
}

function interpolate<R>(rows: WeightedRow<R>[], read: (row: R) => number): number | undefined {
  let value = 0;
  for (const { row, weight } of rows) {
    const v = read(row);
    if (!Number.isFinite(v) || v < 0) return undefined;
    value += weight * v;
  }
  return value;
}

/**
 * Накопленные значения набора от указанной в источнике границы. Линейная интерполяция
 * по массе, FL и ΔISA требует всех нужных узлов; ISA0 из ISA+10/+20 не экстраполируется.
 * Масса сохраняет определение источника (для HC-CLF — при brake release).
 */
export function lookupClimb(dataset: PhaseTableDataset, massKg: number, fl: number, isaDeviationC: number): ClimbPoint | undefined {
  if (!validCoordinates(massKg, fl) || !Number.isFinite(isaDeviationC)) return undefined;
  const rows = corners(dataset.climb, ["massKg", "fl", "isaDeviationC"], [massKg, fl, isaDeviationC]);
  if (!rows) return undefined;
  const timeMin = interpolate(rows, (r) => r.timeMin);
  const fuelKg = interpolate(rows, (r) => r.fuelKg);
  const distanceNm = interpolate(rows, (r) => r.distanceNm);
  const tasKt = interpolate(rows, (r) => r.tasKt);
  if (timeMin === undefined || fuelKg === undefined || distanceNm === undefined || tasKt === undefined) return undefined;
  return { massKg, fl, isaDeviationC, timeMin, fuelKg, distanceNm, tasKt };
}

/** Снижение до границы из источника при его опорной ΔISA; поправки A/C/anti-ice не применяются. */
export function lookupDescent(dataset: PhaseTableDataset, massKg: number, fl: number): DescentPoint | undefined {
  const isaDeviationC = dataset.descent.referenceIsaDeviationC;
  if (!validCoordinates(massKg, fl) || !Number.isFinite(isaDeviationC)) return undefined;
  const rows = corners(dataset.descent, ["massKg", "fl"], [massKg, fl]);
  if (!rows) return undefined;
  const timeMin = interpolate(rows, (r) => r.timeMin);
  const fuelKg = interpolate(rows, (r) => r.fuelKg);
  const distanceNm = interpolate(rows, (r) => r.distanceNm);
  if (timeMin === undefined || fuelKg === undefined || distanceNm === undefined) return undefined;
  const n1Pct = rows.every(({ row }) => row.n1Pct === null) ? null
    : rows.some(({ row }) => row.n1Pct === null) ? undefined
    : interpolate(rows, (r) => r.n1Pct!);
  return { massKg, fl, isaDeviationC, timeMin, fuelKg, distanceNm, n1Pct };
}

/** Расход на ОДИН двигатель в кг/ч. engineCount и длительность ожидания вызывающий применяет явно. */
export function lookupHolding(dataset: PhaseTableDataset, massKg: number, fl: number): HoldingPoint | undefined {
  const isaDeviationC = dataset.holding.referenceIsaDeviationC;
  if (!validCoordinates(massKg, fl) || !Number.isFinite(isaDeviationC)) return undefined;
  const rows = corners(dataset.holding, ["massKg", "fl"], [massKg, fl]);
  if (!rows) return undefined;
  const n1Pct = interpolate(rows, (r) => r.n1Pct);
  const fuelFlowPerEngineKgH = interpolate(rows, (r) => r.fuelFlowPerEngineKgH);
  if (n1Pct === undefined || fuelFlowPerEngineKgH === undefined) return undefined;
  return { massKg, fl, isaDeviationC, n1Pct, fuelFlowPerEngineKgH };
}
