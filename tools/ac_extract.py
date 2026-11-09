"""Извлечение векторных видов из Airbus AC A320 (Airport and Maintenance Planning) в метры.

Запуск (офлайн-утилита, нужен PyMuPDF):  python3 tools/ac_extract.py путь/к/AC.pdf
Результат: data/ac/a320-ac.json — полилинии каждого вида в системе координат модели:
  вид сбоку:  x — от кончика носа назад, y — вверх от оси фюзеляжа;
  вид сверху: x — от носа, z — вправо от оси симметрии;
  вид спереди: z — от оси симметрии, y — вверх от земли;
  сечение:    z — от оси, y — вверх от оси фюзеляжа.
Масштаб каждого вида — по размерам, подписанным на том же листе (длина 37,57 м, размах 34,10/35,80 м,
ширина фюзеляжа 3,95 м). В репозиторий попадают только координаты, не сами чертежи.
"""
import json, math, sys
import pymupdf

YELLOW = (1.0, 1.0, 0.800000011920929)


def bez(a, b, c, d, n=10):
    out = []
    for k in range(n + 1):
        t = k / n
        mt = 1 - t
        out.append((mt**3 * a.x + 3 * mt * mt * t * b.x + 3 * mt * t * t * c.x + t**3 * d.x,
                    mt**3 * a.y + 3 * mt * mt * t * b.y + 3 * mt * t * t * c.y + t**3 * d.y))
    return out


def polylines(page, clip, strokes=True, min_items=1):
    """Все штрихи внутри clip как полилинии (соседние сегменты склеиваются)."""
    x0, y0, x1, y1 = clip
    lines, silhouette = [], []
    for idx, dr in enumerate(page.get_drawings()):
        r = dr["rect"]
        if r.x1 < x0 or r.x0 > x1 or r.y1 < y0 or r.y0 > y1:
            continue
        is_sil = dr["type"] == "f" and dr.get("fill") == YELLOW
        if not is_sil and dr["type"] not in ("s", "fs"):
            continue
        # Размерные и выносные линии — отдельные короткие пути из 1–4 прямых; рисунок самолёта — длинные пути.
        if not is_sil and len(dr["items"]) < min_items:
            continue
        cur = []
        for it in dr["items"]:
            if it[0] == "l":
                pts = [(it[1].x, it[1].y), (it[2].x, it[2].y)]
            elif it[0] == "c":
                pts = bez(*it[1:5])
            elif it[0] == "re":
                q = it[1]
                pts = [(q.x0, q.y0), (q.x1, q.y0), (q.x1, q.y1), (q.x0, q.y1), (q.x0, q.y0)]
            else:
                continue
            if cur and math.dist(cur[-1], pts[0]) < 1e-3:
                cur.extend(pts[1:])
            else:
                if len(cur) > 1:
                    (silhouette if is_sil else lines).append(cur)
                cur = list(pts)
        if len(cur) > 1:
            (silhouette if is_sil else lines).append(cur)
    inside = lambda pl: any(x0 <= x <= x1 and y0 <= y <= y1 for x, y in pl)
    return [pl for pl in lines if inside(pl)], silhouette


def transform(pls, f):
    return [[[round(v, 4) for v in f(x, y)] for x, y in pl] for pl in pls]


def chain(lines, tol=0.02):
    """Склеивает фрагменты, у которых совпадают концы: окна и двери на чертеже нарисованы кусками."""
    pls = [list(map(tuple, pl)) for pl in lines]
    merged = True
    while merged:
        merged = False
        ends = {}
        for i, pl in enumerate(pls):
            for j, pt in ((0, pl[0]), (1, pl[-1])):
                ends.setdefault((round(pt[0] / tol), round(pt[1] / tol)), []).append((i, j))
        used = set()
        out = []
        for i, pl in enumerate(pls):
            if i in used:
                continue
            used.add(i)
            cur = pl[:]
            grew = True
            while grew:
                grew = False
                for at_end in (True, False):
                    pt = cur[-1] if at_end else cur[0]
                    key = (round(pt[0] / tol), round(pt[1] / tol))
                    for k, j in ends.get(key, []):
                        if k in used:
                            continue
                        nxt = pls[k] if j == (0 if at_end else 1) else pls[k][::-1]
                        cur = cur + nxt[1:] if at_end else nxt[:-1] + cur
                        used.add(k)
                        grew = merged = True
                        break
                    if grew:
                        break
            out.append(cur)
        pls = out
    return [[list(p) for p in pl] for pl in pls]


def drop_dimension_lines(lines, silhouette):
    """Размерные и выносные линии — прямые, частично лежащие вне силуэта самолёта. Контур и детали — внутри или на границе."""
    from matplotlib.path import Path
    paths = [Path(pl) for pl in silhouette if len(pl) > 2]
    def outside(x, y):
        return not any(p.contains_point((x, y), radius=0.12) or p.contains_point((x, y), radius=-0.12) for p in paths)
    keep = []
    for pl in lines:
        if len(pl) <= 3:
            n = 24
            pts = [(pl[0][0] + (pl[-1][0] - pl[0][0]) * k / n, pl[0][1] + (pl[-1][1] - pl[0][1]) * k / n) for k in range(n + 1)]
            if sum(outside(x, y) for x, y in pts) > 0.15 * len(pts):
                continue
        keep.append(pl)
    return keep


def side_view(page, clip, length_m):
    lines, sil = polylines(page, clip)
    sx = [x for pl in sil for x, _ in pl]
    nose, tail = min(sx), max(sx)
    s = length_m / (tail - nose)
    # Верх фюзеляжа — пересечение контура силуэта с вертикалью на 45% длины (цилиндрическая часть).
    xm = nose + 0.45 * (tail - nose)
    hits = []
    for pl in sil:
        for (ax, ay), (bx, by) in zip(pl, pl[1:]):
            if (ax - xm) * (bx - xm) <= 0 and ax != bx:
                hits.append(ay + (by - ay) * (xm - ax) / (bx - ax))
    top = min(hits)
    # Низ силуэта здесь занят двигателем, поэтому низ фюзеляжа берём из высоты 4,14 м (лист 2-2-0).
    axis = top + 4.14 / 2 / s
    f = lambda x, y: ((x - nose) * s, (axis - y) * s)
    L, S = transform(lines, f), transform(sil, f)
    return {"scale_m_per_pt": s, "lines": chain(drop_dimension_lines(L, S)), "silhouette": S}


def top_view(page, clip, length_m, axis_y):
    lines, sil = polylines(page, clip)
    sx = [x for pl in sil for x, _ in pl]
    nose, tail = min(sx), max(sx)
    s = length_m / (tail - nose)
    f = lambda x, y: ((x - nose) * s, (y - axis_y) * s)
    L, S = transform(lines, f), transform(sil, f)
    return {"scale_m_per_pt": s, "lines": chain(drop_dimension_lines(L, S)), "silhouette": S}


def front_view(page, clip, span_m):
    lines, sil = polylines(page, clip)
    sx = [x for pl in sil for x, _ in pl]
    ground_y = max(y for pl in sil for _, y in pl)  # низ шин
    left, right = min(sx), max(sx)
    s = span_m / (right - left)
    cx = (left + right) / 2
    f = lambda x, y: ((x - cx) * s, (ground_y - y) * s)
    L, S = transform(lines, f), transform(sil, f)
    return {"scale_m_per_pt": s, "lines": chain(drop_dimension_lines(L, S)), "silhouette": S}


def section_view(page, clip, width_m):
    lines, _ = polylines(page, clip)
    xs = [x for pl in lines for x, _ in pl]
    ys = [y for pl in lines for _, y in pl]
    left, right = min(xs), max(xs)
    s = width_m / (right - left)
    cx = (left + right) / 2
    top, bottom = min(ys), max(ys)
    return {"scale_m_per_pt": s, "lines": transform(lines, lambda x, y: ((x - cx) * s, (top - y) * s)), "top_pt": top}


def main(path):
    d = pymupdf.open(path)
    out = {"_source": "Airbus A320 AC — Airport and Maintenance Planning, 2-2-0 и 2-5-0 (векторные контуры)", "views": {}}
    # 2-2-0 лист 1/2 — A320ceo с «заборчиками»; 2-2-0 NEO лист 1/2. Номера — страницы присланного файла.
    p6, p7, p10, p11 = d[5], d[6], d[9], d[10]
    out["views"]["ceo_side"] = side_view(p6, (165, 150, 480, 270), 37.57)
    out["views"]["ceo_top"] = top_view(p7, (180, 175, 490, 505), 37.57, 364.7)
    out["views"]["ceo_front"] = front_view(p6, (190, 380, 475, 520), 34.10)
    out["views"]["neo_side"] = side_view(p10, (165, 150, 480, 270), 37.57)
    out["views"]["neo_top"] = top_view(p11, (180, 175, 490, 505), 37.57, 364.7)
    out["views"]["section"] = section_view(d[26], (220, 220, 400, 330), 3.95)
    json.dump(out, open("data/ac/a320-ac.json", "w"), ensure_ascii=False, separators=(",", ":"))
    for k, v in out["views"].items():
        print(k, round(v["scale_m_per_pt"], 4), "м/pt", len(v["lines"]), "линий")


if __name__ == "__main__":
    main(sys.argv[1])
