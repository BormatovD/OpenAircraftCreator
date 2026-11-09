"""Точки (взлётная масса, ZFW, дальность) с векторного графика нагрузка–дальность Boeing.

Ось X — дальность, nm; ось Y — OEW + нагрузка (ZFW), тыс. lb. Сетка — серые линии; линии взлётных масс — синие
четырёхугольники (тонкие полосы), собираются в ломаные по общим концам. Ломаные упорядочиваются по пересечению
с осью и сопоставляются с подписанными массами по возрастанию.

python3 boeing_pr.py <pdf> <страница> <x_первой_серой_nm> <x_последней_nm> <y_нижней_серой_klb> <y_верхней_klb> <массы_klb> <MZFW_klb> <топливо_л> <out.json>
Крайние серые линии сетки и их значения задаются по подписям осей (рамка графика бывает чёрной и в сетку не входит).
"""
import json
import sys
from collections import Counter

import pymupdf

path, pno = sys.argv[1], int(sys.argv[2])
X0N, X1N, Y0K, Y1K = (float(v) for v in sys.argv[3:7])
weights = [float(w) for w in sys.argv[7].split(",")]
mzfw, fuel_l, out = float(sys.argv[8]), float(sys.argv[9]), sys.argv[10]
LB = 0.45359237
CAP_KG = fuel_l * 6.7 * LB / 3.785411784

pg = pymupdf.open(path)[pno - 1]
xs, ys, quads = Counter(), Counter(), []
for d in pg.get_drawings():
    c = d.get("color")
    if not c:
        continue
    c = tuple(round(v, 2) for v in c)
    for it in d["items"]:
        if it[0] == "l" and abs(c[0] - c[1]) < 0.05 and 0.3 < c[0] < 0.8:
            a, b = it[1], it[2]
            if abs(a.x - b.x) < 0.3:
                xs[round(a.x, 1)] += abs(a.y - b.y)
            if abs(a.y - b.y) < 0.3:
                ys[round(a.y, 1)] += abs(a.x - b.x)
        if it[0] == "qu" and c == (0.0, 0.0, 1.0):
            q = it[1]
            long1 = abs(q.ul.x - q.ur.x) + abs(q.ul.y - q.ur.y)
            long2 = abs(q.ul.x - q.ll.x) + abs(q.ul.y - q.ll.y)
            if long1 >= long2:
                a = ((q.ul.x + q.ll.x) / 2, (q.ul.y + q.ll.y) / 2); b = ((q.ur.x + q.lr.x) / 2, (q.ur.y + q.lr.y) / 2)
            else:
                a = ((q.ul.x + q.ur.x) / 2, (q.ul.y + q.ur.y) / 2); b = ((q.ll.x + q.lr.x) / 2, (q.ll.y + q.lr.y) / 2)
            if a[0] > b[0]:
                a, b = b, a
            quads.append((a, b))
X = sorted(x for x, n in xs.items() if n > 150)
Y = sorted(y for y, n in ys.items() if n > 150)
X0, X1, YT, YB = X[0], X[-1], Y[0], Y[-1]
f = lambda p: (X0N + (X1N - X0N) * (p[0] - X0) / (X1 - X0), Y0K + (Y1K - Y0K) * (YB - p[1]) / (YB - YT))
segs = [(f(a), f(b)) for a, b in quads]
segs = [s for s in segs if -50 <= s[0][0] <= X1N + 1000]
# Линии масс: наклон в «нормальном» диапазоне (не горизонталь MZFW, не крутая линия топлива).
def slope(s):
    dx = s[1][0] - s[0][0]
    return (s[1][1] - s[0][1]) / dx if dx > 1e-6 else -1e9
lines = [s for s in segs if -0.05 < slope(s) < -0.004]
# Сборка ломаных.
chains = []
used = set()
for i, s in sorted(enumerate(lines), key=lambda t: t[1][0][0]):
    if i in used:
        continue
    used.add(i)
    ch = [s[0], s[1]]
    while True:
        nx = [(j, t) for j, t in enumerate(lines) if j not in used and abs(t[0][0] - ch[-1][0]) < 25 and abs(t[0][1] - ch[-1][1]) < 0.4]
        if not nx:
            break
        j, t = nx[0]
        used.add(j)
        ch.append(t[1])
    if ch[-1][0] - ch[0][0] > 300:
        chains.append(ch)
# Масса ломаной: ZFW, экстраполированный к нулевой дальности по первым ~400 nm, ≈ k·W (резерв — доля массы).
def intercept(ch):
    head = [p for p in ch if p[0] <= ch[0][0] + 400] or ch[:2]
    if len(head) < 2:
        head = ch[:2]
    (x0, y0), (x1, y1) = head[0], head[-1]
    return y0 - (y1 - y0) / (x1 - x0) * x0
# Масса ломаной: линии разных масс почти параллельны, поэтому дальность, на которой ломаная (с экстраполяцией)
# пересекает уровень ZFW = zref, растёт с массой. Ломаные с близкой дальностью — одна линия (обрывки у подписей).
zref = (Y0K + mzfw) / 2
def xcross(ch):
    pts_ = sorted(ch, key=lambda p: abs(p[1] - zref))[:2]
    (x0, y0), (x1, y1) = sorted(pts_)
    if abs(y1 - y0) < 1e-6:
        return x0
    return x0 + (zref - y0) * (x1 - x0) / (y1 - y0)
chains = [ch for ch in chains if min(p[1] for p in ch) <= mzfw + 0.5]
chains.sort(key=xcross)
groups = []
for ch in chains:
    if groups and abs(xcross(ch) - xcross(groups[-1][0])) < 150:
        groups[-1].append(ch)
    else:
        groups.append([ch])
groups = groups[: len(weights)]  # самые тяжёлые линии, если их не перечислили, отбрасываются
# Самые тяжёлые линии могут не дойти до zref: тогда групп меньше, и сопоставляем с самых лёгких.
by_w = {w: g for w, g in zip(weights, groups)}
print("grid", X0, X1, YT, YB, "chains", len(chains), "groups", len(groups), "zref", zref)
for w in sorted(by_w):
    print(w, round(xcross(by_w[w][0])), [(round(c[0][0]), round(c[0][1], 1), round(c[-1][0]), round(c[-1][1], 1)) for c in by_w[w]])
pts = []
for w, chs in sorted(by_w.items()):
  for ch in chs:
    for R in range(500, int(X1N) + 1, 250):
        for a, b in zip(ch, ch[1:]):
            if a[0] <= R <= b[0]:
                z = a[1] + (b[1] - a[1]) * (R - a[0]) / (b[0] - a[0])
                if (w - z) * 1000 * LB <= CAP_KG and z <= mzfw + 0.05:
                    pts.append({"towKg": round(w * 1000 * LB), "zfwKg": round(z * 1000 * LB), "rangeNm": R})
                break
json.dump(pts, open(out, "w"), indent=0)
print(len(pts), "точек")
