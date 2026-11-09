"""Производные формы из контуров AC: профили фюзеляжа, сечение, план крыла и оперения, гондолы.

Запуск: python3 tools/ac_shapes.py  (после ac_extract.py). Результат: data/ac/a320-shapes.json.
Здесь только геометрия «как на чертеже» A320ceo/neo; модель затем масштабирует её рычагами.
"""
import json, math
import numpy as np

V = json.load(open("data/ac/a320-ac.json"))["views"]


def dense(pl, step=0.05):
    out = []
    for (ax, ay), (bx, by) in zip(pl, pl[1:]):
        n = max(1, int(math.dist((ax, ay), (bx, by)) / step))
        for k in range(n):
            t = k / n
            out.append((ax + (bx - ax) * t, ay + (by - ay) * t))
    out.append(tuple(pl[-1]))
    return out


def points(view, extra_sil=False):
    pls = V[view]["lines"] + (V[view]["silhouette"] if extra_sil else [])
    return np.array([p for pl in pls for p in dense(pl)])


def envelope(P, xs, lo, hi, fn, width=0.12):
    out = []
    for x in xs:
        m = P[(np.abs(P[:, 0] - x) < width) & (P[:, 1] >= lo) & (P[:, 1] <= hi)]
        out.append(fn(m[:, 1]) if len(m) else np.nan)
    return np.array(out)


def median_filter(a, k=5):
    b = a.copy()
    for i in range(len(a)):
        w = a[max(0, i - k): i + k + 1]
        w = w[~np.isnan(w)]
        if len(w):
            b[i] = np.median(w)
    return b


def fuselage(prefix):
    S = points(f"{prefix}_side")
    T = points(f"{prefix}_top")
    xs = np.round(np.arange(0.0, 37.57 + 1e-6, 0.25), 3)
    top = median_filter(envelope(S, xs, -2.3, 2.12, np.max), 2)
    bot = median_filter(envelope(S, xs, -2.25, 2.3, np.min), 2)
    # Под крылом низ фюзеляжа на виде сбоку закрыт двигателем — там берём линейную интерполяцию.
    hidden = (xs > 4) & (xs < 27) & (bot > -1.9)
    bot[hidden] = np.nan
    ok = ~np.isnan(bot)
    bot = np.interp(xs, xs[ok], bot[ok])
    # Чертёж слегка наклонён (положение самолёта на стоянке): убираем линейный тренд верха цилиндрической части.
    cyl = (xs > 6) & (xs < 26)
    k, b = np.polyfit(xs[cyl], top[cyl], 1)
    tilt = k * (xs - 16)
    top, bot = top - tilt, bot - tilt
    # Ниша передней стойки даёт «зуб» вниз — убираем выбросы относительно скользящей медианы.
    med = median_filter(bot, 6)
    spike = (xs > 3) & (xs < 27) & (np.abs(bot - med) > 0.05)
    bot[spike] = med[spike]
    half = median_filter(envelope(np.c_[T[:, 0], np.abs(T[:, 1])], xs, 0, 1.99, np.max), 2)
    # В хвосте на ширину накладываются линии стабилизатора: хвостовой конус только сужается.
    tail = xs >= 26
    half[tail] = np.minimum.accumulate(half[tail])
    # …и сглаживаем хвостовой конус полиномом: ступеньки от пересечения с линиями стабилизатора дают «рёбра» на обшивке.
    tt = xs >= 27
    cf = np.polyfit(xs[tt], half[tt], 3)
    half[tt] = np.polyval(cf, xs[tt])
    blend = (xs >= 26) & (xs < 27)
    half[blend] = half[blend]
    # Нос (до 5 м) — точнее: шаг 0,05 м по самому силуэту (заливке), без медианного сглаживания.
    sil_s = np.array([q for pl in V[f"{prefix}_side"]["silhouette"] for q in dense(pl, 0.01)])
    sil_t = np.array([q for pl in V[f"{prefix}_top"]["silhouette"] for q in dense(pl, 0.01)])
    xn = np.round(np.concatenate([[0.0, 0.01, 0.025], np.arange(0.05, 5.0, 0.05)]), 3)
    def env(P, x, lo, hi, fn):
        m = P[(np.abs(P[:, 0] - x) < 0.012) & (P[:, 1] >= lo) & (P[:, 1] <= hi)]
        return fn(m[:, 1]) if len(m) else np.nan
    tn = np.array([env(sil_s, x, -1.5, 2.2, np.max) for x in xn])
    bn = np.array([env(sil_s, x, -2.3, 0.0, np.min) for x in xn])
    hn = np.array([env(np.c_[sil_t[:, 0], np.abs(sil_t[:, 1])], x, 0, 2.0, np.max) for x in xn])
    tip_y = float(sil_s[np.argmin(sil_s[:, 0]), 1])
    tn[0], bn[0], hn[0] = tip_y, tip_y, 0.0
    for a in (tn, bn, hn):
        ok = ~np.isnan(a)
        a[:] = np.interp(xn, xn[ok], a[ok])
    tilt_n = k * (xn - 16)
    tn, bn = tn - tilt_n, bn - tilt_n
    far = xs >= 5.0
    return {"x": np.concatenate([xn, xs[far]]).round(3).tolist(),
            "top": np.round(np.concatenate([tn, top[far]]), 3).tolist(),
            "bottom": np.round(np.concatenate([bn, bot[far]]), 3).tolist(),
            "half_width": np.round(np.concatenate([hn, half[far]]), 3).tolist(), "tilt_per_m": round(float(k), 5)}


def fuselage_features(prefix, tilt):
    """Окна, двери, аварийные выходы и окна кабины — замкнутые контуры на виде сбоку."""
    feats = []
    for pl in V[f"{prefix}_side"]["lines"]:
        P = np.array(pl)
        x0, x1 = P[:, 0].min(), P[:, 0].max()
        y0, y1 = P[:, 1].min(), P[:, 1].max()
        w, h = x1 - x0, y1 - y0
        closed = math.dist(pl[0], pl[-1]) < 0.05
        ym = (y0 + y1) / 2 - tilt * ((x0 + x1) / 2 - 16)
        if y0 < -1.6 or y1 > 1.9:
            continue
        if x1 < 3.6 and x0 > 1.0 and y0 > -0.2 and w < 1.6 and h < 1.2:
            kind = "cockpit"
        elif not closed:
            continue
        elif w < 0.4 and 0.2 < h < 0.5:
            kind = "window"
        elif h > 1.4 and w < 1.2:
            kind = "door"
        elif 0.7 < h < 1.4 and w < 0.8:
            kind = "exit"
        else:
            continue
        feats.append({"kind": kind, "x0": round(float(x0), 3), "x1": round(float(x1), 3),
                      "y0": round(float(y0 - tilt * ((x0 + x1) / 2 - 16)), 3), "y1": round(float(y1 - tilt * ((x0 + x1) / 2 - 16)), 3),
                      "poly": [[round(a, 3), round(b - tilt * (a - 16), 3)] for a, b in pl] if kind == "cockpit" else None})
    # Внутри дверей и выходов есть свои окна — оставляем, они реальные.
    return sorted(feats, key=lambda f: f["x0"])


def planform_lines(view, z_min, z_max, le, te, sign=1, axis=1, x_min=0):
    """Линии детали (рули, механизация, обтекатели) в долях: u — размах от оси, v — хорда от передней кромки."""
    out = []
    for pl in V[view]["lines"]:
        seg = []
        for x, z in pl:
            zz = z * sign
            if zz < z_min - 0.05 or zz > z_max + 0.05 or x < x_min:
                if len(seg) > 1:
                    out.append(seg)
                seg = []
                continue
            c = te(zz) - le(zz)
            v = (x - le(zz)) / c
            if -0.03 <= v <= 1.03:
                seg.append([round(zz / z_max, 4), round(float(v), 4)])
            else:
                if len(seg) > 1:
                    out.append(seg)
                seg = []
        if len(seg) > 1:
            out.append(seg)
    return out


def section():
    P = points("section")
    # Наружная обшивка: для каждого угла — самый дальний штрих от оси (ось на 2,07 м ниже верха).
    cy = -2.07
    ang = np.radians(np.arange(0, 181, 5))  # 0 — правый борт, 90 — верх, 180 — левый
    out = []
    for a in ang:
        d = np.array([math.cos(a), math.sin(a)])
        rel = P - np.array([0, cy])
        proj = rel @ d
        perp = np.abs(rel @ np.array([-d[1], d[0]]))
        m = proj[(perp < 0.04) & (proj > 0)]
        out.append(float(m.max()) if len(m) else float("nan"))
    return {"deg": np.degrees(ang).round(1).tolist(), "r": np.round(out, 3).tolist(), "note": "верхняя часть сечения по 2-5-0; ниже ~0,4 м под осью чертёж обрезан"}


def robust_line(z, x, q=None):
    """Прямая x(z) по точкам; при q — по нижнему/верхнему квантилю в окнах (отсекает обтекатели кареток)."""
    A = np.c_[z, np.ones_like(z)]
    k, b = np.linalg.lstsq(A, x, rcond=None)[0]
    for _ in range(4):
        r = x - (k * z + b)
        keep = np.abs(r) < max(0.05, 2.5 * np.median(np.abs(r)))
        k, b = np.linalg.lstsq(A[keep], x[keep], rcond=None)[0]
    return float(k), float(b)


def wing(prefix):
    T = points(f"{prefix}_top")
    R = T[T[:, 1] > 0]
    out = {}
    # Передняя кромка: самая передняя точка каждого сечения z вне зоны гондолы.
    zs = np.arange(2.2, 16.6, 0.1)
    le = []
    for z in zs:
        if 4.3 < z < 7.2:
            continue
        m = R[(np.abs(R[:, 1] - z) < 0.04) & (R[:, 0] > 9) & (R[:, 0] < 24)]
        if len(m):
            le.append((z, m[:, 0].min()))
    le = np.array(le)
    k, b = robust_line(le[:, 0], le[:, 1])
    out["le"] = {"slope": k, "x0": b, "sweep_deg": math.degrees(math.atan(k))}
    # Задняя кромка: самая задняя точка, но обтекатели кареток выступают — берём 30-й перцентиль в окне 1 м.
    te = []
    for z in zs:
        m = R[(np.abs(R[:, 1] - z) < 0.04) & (R[:, 0] > 12) & (R[:, 0] < 25)]
        if len(m):
            te.append((z, m[:, 0].max()))
    te = np.array(te)
    sm = np.array([np.percentile(te[np.abs(te[:, 0] - z) < 0.6][:, 1], 30) for z in te[:, 0]])
    inner = te[:, 0] < 6.3
    ki, bi = robust_line(te[inner, 0], sm[inner])
    ko, bo = robust_line(te[(te[:, 0] > 7.2) & (te[:, 0] < 16.3), 0], sm[(te[:, 0] > 7.2) & (te[:, 0] < 16.3)])
    out["te_inner"] = {"slope": ki, "x0": bi}
    out["te_outer"] = {"slope": ko, "x0": bo}
    out["kink_z"] = (bo - bi) / (ki - ko) if abs(ki - ko) > 1e-6 else None
    tip_z = R[(R[:, 0] > 15) & (R[:, 0] < 24)][:, 1].max()
    out["tip_z"] = float(tip_z)
    return out


def tail_planform(prefix):
    T = points(f"{prefix}_top")
    R = T[(T[:, 1] > 2.05) & (T[:, 0] > 29)]
    zs = np.arange(2.2, R[:, 1].max() - 0.1, 0.1)
    le, te = [], []
    for z in zs:
        m = R[np.abs(R[:, 1] - z) < 0.04]
        if len(m):
            le.append((z, m[:, 0].min()))
            te.append((z, m[:, 0].max()))
    le, te = np.array(le), np.array(te)
    kl, bl = robust_line(le[:, 0], le[:, 1])
    kt, bt = robust_line(te[:, 0], te[:, 1])
    return {"le": {"slope": kl, "x0": bl}, "te": {"slope": kt, "x0": bt}, "tip_z": float(R[:, 1].max())}


def fin_table(prefix):
    """Передняя и задняя кромки киля по высоте, включая форкиль у корня (без аппроксимации прямой)."""
    S = np.array([q for pl in V[f"{prefix}_side"]["lines"] for q in dense(pl, 0.01)])
    R = S[(S[:, 0] > 27.0) & (S[:, 1] > 1.6)]
    tip = R[:, 1].max()
    ys = np.round(np.arange(2.05, tip - 0.02, 0.05), 3)
    le, te = [], []
    for y in ys:
        m = R[np.abs(R[:, 1] - y) < 0.012]
        le.append(m[:, 0].min() if len(m) else np.nan)
        te.append(m[:, 0].max() if len(m) else np.nan)
    le, te = np.array(le), np.array(te)
    for a in (le, te):
        ok = ~np.isnan(a)
        a[:] = np.interp(ys, ys[ok], a[ok])
    # Задняя кромка у самого корня уходит в хвостовой конус — там продолжаем прямую выше.
    k, b = np.polyfit(ys[ys > 3.0], te[ys > 3.0], 1)
    te = np.minimum(te, k * ys + b)
    return {"y": ys.tolist(), "le": np.round(le, 3).tolist(), "te": np.round(te, 3).tolist(), "tip_y": round(float(tip), 3)}


def fin(prefix):
    S = points(f"{prefix}_side")
    R = S[(S[:, 1] > 2.6) & (S[:, 0] > 26)]
    ys = np.arange(2.8, R[:, 1].max() - 0.15, 0.1)
    le, te = [], []
    for y in ys:
        m = R[np.abs(R[:, 1] - y) < 0.04]
        if len(m):
            le.append((y, m[:, 0].min()))
            te.append((y, m[:, 0].max()))
    le, te = np.array(le), np.array(te)
    kl, bl = robust_line(le[:, 0], le[:, 1])
    kt, bt = robust_line(te[:, 0], te[:, 1])
    return {"le": {"slope": kl, "x0": bl}, "te": {"slope": kt, "x0": bt}, "tip_y": float(R[:, 1].max())}


def nacelle(prefix):
    """Профиль гондолы сбоку: верх и низ на каждом x под крылом — радиус и ось."""
    S = points(f"{prefix}_side", extra_sil=False)
    R = S[(S[:, 0] > 9) & (S[:, 0] < 17.5) & (S[:, 1] < -1.2) & (S[:, 1] > -3.9)]
    bottom_x = R[R[:, 1] < -3.0]
    x0, x1 = bottom_x[:, 0].min(), bottom_x[:, 0].max()
    xs = np.arange(x0, x1 + 1e-6, 0.1)
    bot = envelope(R, xs, -3.9, -1.2, np.min, 0.06)
    return {"x": np.round(xs, 3).tolist(), "bottom": np.round(bot, 3).tolist()}


out = {"_source": "производные от data/ac/a320-ac.json (Airbus AC A320, 2-2-0, 2-5-0)"}
for p in ("ceo", "neo"):
    fus = fuselage(p)
    w, ht, vt = wing(p), tail_planform(p), fin(p)
    le = lambda z, w=w: w["le"]["slope"] * z + w["le"]["x0"]
    te = lambda z, w=w: min(w["te_inner"]["slope"] * z + w["te_inner"]["x0"], w["te_outer"]["slope"] * z + w["te_outer"]["x0"]) if w["te_outer"]["slope"] * z + w["te_outer"]["x0"] > w["te_inner"]["x0"] else max(w["te_inner"]["slope"] * z + w["te_inner"]["x0"], w["te_outer"]["slope"] * z + w["te_outer"]["x0"])
    w["lines"] = planform_lines(f"{p}_top", 1.975, w["tip_z"], le, te, x_min=9)
    hle = lambda z, h=ht: h["le"]["slope"] * z + h["le"]["x0"]
    hte = lambda z, h=ht: h["te"]["slope"] * z + h["te"]["x0"]
    ht["lines"] = planform_lines(f"{p}_top", 1.2, ht["tip_z"], hle, hte, x_min=29)
    vle = lambda y, h=vt: h["le"]["slope"] * y + h["le"]["x0"]
    vte = lambda y, h=vt: h["te"]["slope"] * y + h["te"]["x0"]
    vt["lines"] = planform_lines(f"{p}_side", 2.07, vt["tip_y"], vle, vte, x_min=26)
    vt["table"] = fin_table(p)
    out[p] = {"fuselage": fus, "features": fuselage_features(p, fus["tilt_per_m"]), "wing": w, "htail": ht, "vtail": vt, "nacelle": nacelle(p)}
out["section"] = section()
json.dump(out, open("data/ac/a320-shapes.json", "w"), ensure_ascii=False, indent=1)
for p in ("ceo", "neo"):
    from collections import Counter
    print(p, Counter(f["kind"] for f in out[p]["features"]), "линий: крыло", len(out[p]["wing"]["lines"]), "ГО", len(out[p]["htail"]["lines"]), "ВО", len(out[p]["vtail"]["lines"]))
    w = out[p]["wing"]
    print(p, "LE sweep", round(w["le"]["sweep_deg"], 2), "LE at z=1.975:", round(w["le"]["slope"] * 1.975 + w["le"]["x0"], 3),
          "TE inner", round(w["te_inner"]["slope"], 3), round(w["te_inner"]["x0"], 3), "outer", round(w["te_outer"]["slope"], 3), round(w["te_outer"]["x0"], 3),
          "kink", round(w["kink_z"], 2), "tip", round(w["tip_z"], 2))
    for t in ("htail", "vtail"):
        print("  ", t, {k: (round(v, 3) if isinstance(v, float) else {a: round(b, 3) for a, b in v.items()}) for k, v in out[p][t].items() if k not in ("lines", "table")})
