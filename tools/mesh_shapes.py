"""Контуры Boeing 737 из сетки Collada (шаблон SketchUp «Boeing 737-800 v.3», присланный пользователем) →
data/ac/b737-8-shapes.json в той же структуре, что a320-shapes.json (вид сбоку/сверху, сечение, оперение).

Сетка не распространяется: в проект попадают только снятые с неё контуры. Сетка — 737-800 (тот же фюзеляж
и крыло, что у 737-8); гондола и законцовки в 3D-модели — параметрические, по определению самолёта.

Запуск: python3 -I tools/mesh_shapes.py <parts.pkl> <out.json>
parts.pkl — список (имя, id геометрии, вершины в метрах, грани), выгруженный trimesh из model.dae
(Z вверх, Y — от носа к хвосту, X — по размаху). Масштаб сетки 1 ед. = 0,0254/3,404 м: общая длина 39,47 м
= 129 ft 6 in по Boeing D6-38A004 2.2.2; дальше всё сжимается на 39,12/39,47 до длины фюзеляжа из того же листа.
"""

import json
import pickle
import sys

import numpy as np

P = pickle.load(open(sys.argv[1], "rb"))
OUT = sys.argv[2]
XC = 17.875  # ось симметрии сетки по размаху
LEN_MESH = 39.473
LEN_FUS = 39.12
S = LEN_FUS / LEN_MESH


def part(gid):
    for n, _g, v, f in P:
        if n == gid:
            return v, f
    raise KeyError(gid)


def merged(ids):
    vs, fs, o = [], [], 0
    for i in ids:
        v, f = part(i)
        vs.append(v)
        fs.append(f + o)
        o += len(v)
    return np.vstack(vs), np.vstack(fs)


def slice_tris(v, f, axis, val):
    """Точки пересечения рёбер треугольников с плоскостью coord[axis] = val."""
    a, b, c = v[f[:, 0]], v[f[:, 1]], v[f[:, 2]]
    pts = []
    for p, q in ((a, b), (b, c), (c, a)):
        dp, dq = p[:, axis] - val, q[:, axis] - val
        m = dp * dq < 0
        t = dp[m] / (dp[m] - dq[m])
        pts.append(p[m] + (q[m] - p[m]) * t[:, None])
    return np.vstack(pts)


r3 = lambda x: round(float(x), 3)

# ——— Фюзеляж: нос, цилиндр, хвостовой конус, срез ВСУ ———
# Стёкла кабины (ID4426), двери и аварийные выходы — отдельные детали: в обшивке на их месте вырезы, без них
# профиль «проваливается» (у задней двери — перетяжка фюзеляжа).
DOOR_PARTS = ["ID4307", "ID4315", "ID4355", "ID4411", "ID4323", "ID4331", "ID4403", "ID4371", "ID4273", "ID4291", "ID4363", "ID4387"]
fv, ff = merged(["ID4077", "ID4513", "ID4426", "ID4553", "ID4491", "ID4503"] + DOOR_PARTS)
# Центр сечения — середина между верхом и низом цилиндрической части (станция 10 м).
p10 = slice_tris(fv, ff, 1, 10.0)
ZC = (p10[:, 2].max() + p10[:, 2].min()) / 2
GROUND = min(v[:, 2].min() for _n, _g, v, _f in P)
to_y = lambda z: (z - ZC) * S
CYL_BOTTOM = p10[:, 2].min()

xs = [0.0]
xs += [round(0.01 * k, 3) for k in range(1, 10)]
xs += [round(0.05 * k, 3) for k in range(2, 120)]
xs += [round(6.0 + 0.25 * k, 3) for k in range(0, int((LEN_MESH - 0.02 - 6.0) / 0.25) + 1)]
xs.append(LEN_MESH - 0.005)
fus = {"x": [], "top": [], "bottom": [], "half_width": []}
for x in xs:
    if x <= 0:
        p = slice_tris(fv, ff, 1, 0.004)
    else:
        p = slice_tris(fv, ff, 1, x)
    if len(p) == 0:
        continue
    bottom = p[:, 2].min()
    # Обтекатель центроплана — отдельная деталь сцены: в таблицу фюзеляжа идёт низ цилиндра.
    if 13.0 < x < 24.0:
        bottom = max(bottom, CYL_BOTTOM)
    fus["x"].append(r3(x * S))
    fus["top"].append(r3(to_y(p[:, 2].max())))
    fus["bottom"].append(r3(to_y(bottom)))
    fus["half_width"].append(r3(np.abs(p[:, 0] - XC).max() * S))
fus["x"][0] = 0.0
# Хвостовой конус: низ сетки с «полкой» (дренажная мачта и стык деталей) — низ только поднимается, ширина только
# убывает, затем сглаживание по 5 точкам.
xa = np.array(fus["x"])
for key, op in (("bottom", np.maximum), ("half_width", np.minimum)):
    a = np.array(fus[key])
    m = xa > 30.0
    i0 = int(np.argmax(m))
    a[i0:] = op.accumulate(a[i0:])
    sm = a.copy()
    for i in range(i0 + 2, len(a) - 2):
        sm[i] = a[i - 2 : i + 3].mean()
    fus[key] = [r3(v) for v in sm]
fus["half_width"][0] = 0.0

# ——— Сечение: радиус от центра по углу, полный оборот (у 737 верх и низ не симметричны) ———
deg, rad = [], []
d10 = p10.copy()
ang = np.degrees(np.arctan2(d10[:, 2] - ZC, d10[:, 0] - XC)) % 360
rr = np.hypot(d10[:, 2] - ZC, d10[:, 0] - XC)
for a in range(0, 361, 5):
    da = np.abs(((ang - a) + 180) % 360 - 180)
    m = da < 3.0
    deg.append(a)
    rad.append(r3(rr[m].max() * S if m.any() else np.nan))
# Вершин в цилиндре мало: пропуски по углу — линейная интерполяция по соседним узлам (по кругу).
ra = np.array(rad, dtype=float)
ok = ~np.isnan(ra)
da = np.array(deg, dtype=float)
ra[~ok] = np.interp(da[~ok], np.concatenate([da[ok] - 360, da[ok], da[ok] + 360]), np.tile(ra[ok], 3))
rad = [r3(x) for x in ra]
section = {"deg": deg, "r": rad, "note": "737-800, станция 10 м, полный оборот; 0° — правый борт, 90° — верх"}
halfH = r3((p10[:, 2].max() - ZC) * S)
halfW = r3(max(r * np.cos(np.radians(a)) for a, r in zip(deg, rad)))

# ——— Двери и аварийные выходы (левый борт; на текстуре — оба борта) ———
def feat(kind, gid):
    v, _ = part(gid)
    return {
        "kind": kind,
        "x0": r3(v[:, 1].min() * S),
        "x1": r3(v[:, 1].max() * S),
        "y0": r3(to_y(v[:, 2].min())),
        "y1": r3(to_y(v[:, 2].max())),
    }


doors = [feat("door", "ID4315"), feat("exit", "ID4291"), feat("exit", "ID4273"), feat("door", "ID4331")]
# Окна — шаг 20 in (0,508 м), как у 737NG; размер 0,25 × 0,35 м; пропуски — у аварийных выходов над крылом.
WIN_W, WIN_H, WIN_Y = 0.25, 0.36, 0.69
windows = []
x = doors[0]["x1"] + 0.62
while x < doors[3]["x0"] - 0.85:
    if all(not (e["x0"] - 0.2 < x + WIN_W / 2 < e["x1"] + 0.2) for e in doors[1:3]):
        windows.append({"kind": "window", "x0": r3(x), "x1": r3(x + WIN_W), "y0": r3(WIN_Y - WIN_H / 2), "y1": r3(WIN_Y + WIN_H / 2)})
    x += 0.508

# ——— Остекление кабины: углы стёкол сетки (деталь ID4426) ———
def cp(points):
    return [[r3(a * S), r3(to_y(b))] for a, b in points]


cockpit = {
    # Вид спереди (z от оси, y от оси фюзеляжа), правая половина: лобовое стекло.
    "windscreen": [[r3(z * S), r3(to_y(y))] for z, y in [(0.03, 3.90), (0.02, 4.25), (0.74, 4.23), (0.86, 3.88)]],
    # Вид сбоку (x от носа, y от оси): два боковых окна.
    "side": [
        cp([(2.02, 3.89), (2.22, 4.23), (2.62, 4.24), (2.62, 3.73), (2.46, 3.76)]),
        cp([(2.66, 3.73), (2.66, 4.24), (3.18, 4.27), (3.22, 3.93), (3.02, 3.73)]),
    ],
}

# ——— Крыло (правая консоль, вид сверху) ———
wv, wf = merged(["ID6417", "ID6545", "ID4945", "ID4980", "ID4989", "ID4998"])
zs, les, tes, mids, ths = [], [], [], [], []
box_v, box_f = part("ID6417")
for dz in np.arange(1.9, 16.45, 0.25):
    p = slice_tris(wv, wf, 0, XC + dz)
    q = slice_tris(box_v, box_f, 0, XC + dz)
    zs.append(dz * S)
    les.append(p[:, 1].min() * S)
    tes.append(p[:, 1].max() * S)
    mids.append(to_y((q[:, 2].max() + q[:, 2].min()) / 2))
    ths.append((q[:, 2].max() - q[:, 2].min()) * S / ((p[:, 1].max() - p[:, 1].min()) * S))
zs, les, tes, mids = map(np.array, (zs, les, tes, mids))


def line(z, x):
    k, b = np.polyfit(z, x, 1)
    return {"slope": float(k), "x0": float(b)}


inner = zs < 4.9
outer = zs > 6.0
le_inner = line(zs[inner], les[inner])
le_outer = line(zs[outer], les[outer])
te_inner = {"slope": 0.0, "x0": float(np.median(tes[zs < 4.8]))}
te_outer = line(zs[outer & (zs < 14.0)], tes[outer & (zs < 14.0)])
kink_z = (te_inner["x0"] - te_outer["x0"]) / te_outer["slope"]
tip_z = float(zs[-1])
dih = np.degrees(np.arctan(np.polyfit(zs[outer], mids[outer], 1)[0]))
side_z = halfW
y_side = float(np.interp(6.0, zs, mids) - (6.0 - side_z) * np.tan(np.radians(dih)))

# ——— Стабилизатор (правая половина) ———
hv, hf = part("ID129")
hz, hle, hte, hy = [], [], [], []
for dz in np.arange(0.6, 7.05, 0.2):
    p = slice_tris(hv, hf, 0, XC + dz)
    if len(p) < 4:
        continue
    hz.append(dz * S)
    hle.append(p[:, 1].min() * S)
    hte.append(p[:, 1].max() * S)
    hy.append(to_y((p[:, 2].max() + p[:, 2].min()) / 2))
hz, hle, hte, hy = map(np.array, (hz, hle, hte, hy))
hm = hz > 1.2
ht_le = line(hz[hm], hle[hm])
ht_te = line(hz[hm], hte[hm])
ht_tip = float(np.abs(hv[:, 0] - XC).max() * S)  # законцовка — по крайней точке, сечения до неё не доходят
ht_dih = float(np.degrees(np.arctan(np.polyfit(hz[hm], hy[hm], 1)[0])))

# ——— Киль с форкилем и рулём (вид сбоку) ———
vv, vf = merged(["ID42", "ID8", "ID34"])
vy, vle, vte = [], [], []
z0, z1 = vv[:, 2].min(), vv[:, 2].max()
for z in np.arange(z0 + 0.02, z1 - 0.01, 0.05):
    p = slice_tris(vv, vf, 2, z)
    if len(p) < 4:
        continue
    vy.append(r3(to_y(z)))
    vle.append(r3(p[:, 1].min() * S))
    vte.append(r3(p[:, 1].max() * S))
vy, vle_a, vte_a = np.array(vy), np.array(vle), np.array(vte)
tip_y = float(to_y(z1))
# Прямые основного киля — выше наплыва форкиля.
main = vy > vy[0] + 0.45 * (tip_y - vy[0])
vt_le = line(vy[main], vle_a[main])
vt_te = line(vy[main], vte_a[main])
fillet_x = float(vle_a[0])

A320 = json.load(open("data/ac/a320-shapes.json"))["ceo"]
out = {
    "_source": "контуры сняты с сетки Collada «Template - Boeing 737-800 v.3» (SketchUp) утилитой tools/mesh_shapes.py; "
    "сетка в проект не входит. Линии панелей крыла и оперения — общий рисунок с A320.",
    "fuselage": fus,
    "section": section,
    "halfHeight": halfH,
    "halfWidth": halfW,
    "groundY": r3(to_y(GROUND)),
    "features": doors + windows,
    "cockpit": cockpit,
    "wing": {
        "le": {**le_outer, "sweep_deg": float(np.degrees(np.arctan(le_outer["slope"])))},
        "le_inner": le_inner,
        "te_inner": te_inner,
        "te_outer": te_outer,
        "kink_z": float(kink_z),
        "tip_z": tip_z,
        "side_z": side_z,
        "root_y": r3(y_side),
        "dihedral_deg": round(float(dih), 2),
        "thickness_root": round(float(np.median(ths[:3])), 3),
        "thickness_tip": round(float(np.median(ths[-8:])), 3),
        "lines": A320["wing"]["lines"],
    },
    "htail": {"le": ht_le, "te": ht_te, "tip_z": ht_tip, "dihedral_deg": round(ht_dih, 2), "lines": A320["htail"]["lines"]},
    "vtail": {
        "le": vt_le,
        "te": vt_te,
        "tip_y": tip_y,
        "fillet_x": fillet_x,
        "lines": A320["vtail"]["lines"],
        "table": {"y": vy.tolist(), "le": vle_a.tolist(), "te": vte_a.tolist(), "tip_y": tip_y},
    },
    "nacelle": {
        # Срез воздухозаборника (гондола CFM56-7 сетки), ось двигателя — от оси самолёта и от оси фюзеляжа.
        "inlet_x": r3(part("ID5914")[0][:, 1].min() * S),
        "axis_z": r3((((part("ID5914")[0][:, 0].min() + part("ID5914")[0][:, 0].max()) / 2) - XC) * S),
        "axis_y": r3(to_y((part("ID5914")[0][:, 2].min() + part("ID5914")[0][:, 2].max()) / 2)),
    },
}
json.dump(out, open(OUT, "w"), ensure_ascii=False, separators=(",", ":"))
print("halfH", halfH, "halfW", halfW, "ground", out["groundY"], "len", fus["x"][-1])
print("wing", le_inner, le_outer, te_inner, te_outer, "kink", kink_z, "tip", tip_z, "dih", dih, "rootY", y_side, out["wing"]["thickness_root"], out["wing"]["thickness_tip"])
print("htail", ht_le, ht_te, ht_tip, ht_dih)
print("vtail", vt_le, vt_te, tip_y, "fillet", fillet_x, "rows", len(vy))
print("nacelle", out["nacelle"], "doors", doors, "windows", len(windows))
print("section r", rad[::6])
