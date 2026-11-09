from PIL import Image
import numpy as np, json
im = np.array(Image.open("maxpr/p52.png").convert("L")).astype(int)
X0, X1 = 117.5, 434.0
Y155, Y90 = 208.0, 619.5
px = lambda R: X0 + R / 5000 * (X1 - X0)
py = lambda z: Y155 + (155 - z) / 65 * (Y90 - Y155)
gx = [117, 118, 149, 181, 212, 213, 244, 276, 307, 308, 339, 371, 402, 434]
gy = [208, 240, 271, 303, 334, 335, 366, 398, 429, 430, 461, 493, 524, 556, 588, 619, 620]
dark = im < 150
MZFW = 145.4
FUEL_LB = 45.694  # тыс. lb
def score(z0, slope, R0, W):
    hit = tot = 0
    R = R0
    while True:
        z = z0 + slope * (R - R0) / 1000
        if z < 98.6 or W - z > FUEL_LB + 0.3 or R > 5000: break
        x, y = px(R), py(z)
        xi, yi = int(round(x)), int(round(y))
        if all(abs(xi - g) > 1 for g in gx) and all(abs(yi - g) > 1 for g in gy):
            tot += 1
            hit += dark[yi - 1:yi + 2, xi - 1:xi + 2].any()
        R += 5000 / (X1 - X0)  # шаг ≈ 1 пиксель
    return hit / max(tot, 1), tot
out = {}
axis = {105: 100.0, 110: 104.8, 115: 109.8, 120: 114.5, 125: 119.2, 130: 124.0, 135: 129.0, 140: 134.0, 145: 139.0, 150: 143.6}
roof = {155: 260, 160: 730, 165: 1200, 170: 1630, 175: 2050, 180: 2450}
for W, z0g in axis.items():
    best = (0, 0, 0, 0)
    for z0 in np.arange(z0g - 1.6, z0g + 1.6, 0.05):
        for sl in np.arange(-10, -4, 0.05):
            f, n = score(z0, sl, 0, W)
            if n > 15 and f > best[0]: best = (f, n, z0, sl)
    out[W] = {"R0": 0, "z0": best[2], "slope": best[3], "cover": best[0], "n": best[1]}
for W, Rg in roof.items():
    best = (0, 0, 0, 0)
    for R0 in np.arange(Rg - 250, Rg + 250, 10):
        for sl in np.arange(-10, -4, 0.05):
            f, n = score(MZFW, sl, R0, W)
            if n > 15 and f > best[0]: best = (f, n, R0, sl)
    out[W] = {"R0": best[2], "z0": MZFW, "slope": best[3], "cover": best[0], "n": best[1]}
for W, v in out.items(): print(W, {k: round(x, 3) for k, x in v.items()})
json.dump(out, open("maxpr/fit.json", "w"))
