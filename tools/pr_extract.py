import pymupdf, sys, json
from collections import Counter
path, pno = sys.argv[1], int(sys.argv[2]) - 1
pmax = float(sys.argv[3]) if len(sys.argv) > 3 else 20
r0, r1 = (float(sys.argv[4]), float(sys.argv[5])) if len(sys.argv) > 5 else (500, 5000)
pg = pymupdf.open(path)[pno]
dr = pg.get_drawings()
xs, ys = Counter(), Counter()
curves = {}
for d in dr:
    c = d.get("color")
    for it in d["items"]:
        if it[0] != "l": continue
        a, b = it[1], it[2]
        if c and all(abs(c[0]-x) < 0.05 for x in c):
            if abs(a.x-b.x) < 0.3 and abs(a.y-b.y) > 100: xs[round(a.x,1)] += 1
            if abs(a.y-b.y) < 0.3 and abs(a.x-b.x) > 100: ys[round(a.y,1)] += 1
        elif c:
            curves.setdefault(tuple(round(v,2) for v in c), []).append((a, b))
def run(v):
    v = sorted(v); best = []
    for i in range(len(v)):
        for j in range(i+1, len(v)):
            st = v[j]-v[i]; r = [v[i]]
            while True:
                nx = [w for w in v if abs(w - (r[-1]+st)) < 0.8]
                if not nx: break
                r.append(nx[0])
            if len(r) > len(best): best = r
    return best
X = run(xs); Y = run(ys)
x0, x1, y0, y1 = X[0], X[-1], Y[0], Y[-1]
print("grid x", X, "\ngrid y", Y)
for c, segs in curves.items():
    pts = []
    for a, b in segs:
        for p in (a, b):
            if x0-1 <= p.x <= x1+1 and y0-1 <= p.y <= y1+1:
                pts.append((round(pmax*(x1-p.x)/(x1-x0), 2), round(r0+(r1-r0)*(y1-p.y)/(y1-y0))))
    print(c, sorted(set(pts), key=lambda t: t[1]))

def corners(P):
    P = sorted(P, key=lambda t: (t[1], -t[0]))
    pmax = P[0][0]
    flat = [p for p in P if abs(p[0]-pmax) < 0.05]
    a = flat[-1]
    rest = [p for p in P if p[1] > a[1]]
    sl = [(rest[i+1][0]-rest[i][0])/(rest[i+1][1]-rest[i][1]) for i in range(len(rest)-1)] if len(rest) > 1 else []
    s0 = (rest[0][0]-a[0])/(rest[0][1]-a[1]) if rest else None
    kink = None
    prev = s0
    for i, s in enumerate(sl):
        if prev and (abs(s/prev) > 1.4 or abs(s/prev) < 0.7): kink = rest[i]; break
        prev = s
    end = rest[-1] if rest else a
    if kink is None: kink, ferry = end, None
    else: ferry = end[1] if end[0] < 0.05 else None
    return {"maxPayloadT": a[0], "rangeAtMaxPayloadNm": a[1], "fullTankPayloadT": kink[0], "rangeAtFullTankNm": kink[1], "ferryRangeNm": ferry, "endPoint": end}
print("CORNERS")
for c, segs in curves.items():
    pts = []
    for a_, b_ in segs:
        for p in (a_, b_):
            if x0-1 <= p.x <= x1+1 and y0-1 <= p.y <= y1+1:
                pts.append((round(pmax*(x1-p.x)/(x1-x0), 2), round(r0+(r1-r0)*(y1-p.y)/(y1-y0))))
    pts = sorted(set(pts), key=lambda t: t[1])
    if len(pts) > 3: print(c, corners(pts))
