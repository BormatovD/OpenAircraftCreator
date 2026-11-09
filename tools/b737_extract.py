import pymupdf, sys
d = pymupdf.open("/mnt/user-data/attachments/2d4d26af-d213-57eb-86cc-954cdafe12c3/434bbdd1-737CL_REV_E.pdf")
pg = d[int(sys.argv[1]) - 1]
X0, X1, Y0, Y1 = 208.1, 509.4, 592.3, 216.5   # 0..4000 nm, 65..115 klb
R1, W0, W1 = 4000, 65, 115
segs = []
for x in pg.get_drawings():
    c = x.get("color") or x.get("fill")
    if not c or tuple(round(v,2) for v in c) != (0.0,0.0,1.0): continue
    for it in x["items"]:
        if it[0] == "qu":
            q = it[1]
            # линия = средняя ось длинного четырёхугольника
            a = ((q.ul.x+q.ll.x)/2, (q.ul.y+q.ll.y)/2); b = ((q.ur.x+q.lr.x)/2, (q.ur.y+q.lr.y)/2)
            if abs(q.ul.x-q.ur.x)+abs(q.ul.y-q.ur.y) < abs(q.ul.x-q.ll.x)+abs(q.ul.y-q.ll.y):
                a = ((q.ul.x+q.ur.x)/2, (q.ul.y+q.ur.y)/2); b = ((q.ll.x+q.lr.x)/2, (q.ll.y+q.lr.y)/2)
            f = lambda p: (round(R1*(p[0]-X0)/(X1-X0)), round(W0+(W1-W0)*(Y0-p[1])/(Y0-Y1), 2))
            segs.append((f(a), f(b)))
for s in sorted(segs): print(s)

# Сборка ломаных по весам и выборка точек (W, ZFW, дальность) в пределах стандартных баков и MZFW.
import json
LB = 0.45359237
weights = [90, 95, 100, 105, 110, 115, 120, 124.5, 130, 135, 138.5, 139.5]
fuel_lines = [s for s in segs if abs(s[0][0]-s[1][0]) < 1000 and abs(s[0][1]-s[1][1]) > 20]  # почти вертикальные
lines = [s for s in segs if s not in fuel_lines]
# Ломаная: стартовые сегменты отсортированы по ZFW (у оси или у MZFW), дальше цепочкой
starts = sorted([s for s in lines if s[0][0] == 0 or abs(s[0][1]-106.61) < 0.05], key=lambda s: (s[0][0] == 0 and -s[0][1], s[0][0]))
starts = sorted(starts, key=lambda s: (0 if s[0][0] == 0 else 1, s[0][1] if s[0][0] == 0 else s[0][0]))
polys = []
for st in starts:
    p = [st[0], st[1]]
    while True:
        nx = [s for s in lines if abs(s[0][0]-p[-1][0]) <= 2 and abs(s[0][1]-p[-1][1]) < 0.05 and s not in (st,)]
        nx = [s for s in nx if s[1][0] > p[-1][0]]
        if not nx: break
        p.append(nx[0][1])
    polys.append(p)
mzfw = 106.61
cap_kg = 20102 * 0.8026
pts = []
for W, p in zip(weights, polys):
    for R in range(500, 4001, 250):
        for a, b in zip(p, p[1:]):
            if a[0] <= R <= b[0]:
                z = a[1] + (b[1]-a[1]) * (R-a[0]) / (b[0]-a[0])
                fuel = (W - z) * 1000 * LB
                if fuel <= cap_kg and z <= mzfw + 0.01:
                    pts.append({"towKg": round(W*1000*LB), "zfwKg": round(z*1000*LB), "rangeNm": R})
                break
print(len(polys), [ (w, round(p[0][1],2)) for w,p in zip(weights, polys)])
json.dump(pts, open("val/b737_300_points.json","w"), indent=0)
print(len(pts), pts[:3], pts[-3:])
