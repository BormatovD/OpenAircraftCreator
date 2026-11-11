"""Reproduce the visually verified CES A320-214 phase reference dataset.

Usage:
  python3 tools/fcom_airbus_extract.py /path/to/upload

The four source PDFs must match their SHA-256 fingerprints. Numerical matrices
below are the reviewed transcription, not unreviewed live OCR. Raster extraction
and OCR audit material are kept separately in the session audit directory; this
generator needs only the Python standard library. It never updates simulation,
calibration, or the existing A319 dataset.
"""
from pathlib import Path
import argparse
import hashlib
import json


FILES = {
    "1": {"filename": "FCOM 1.pdf", "sha256": "2323159fd70b2985aca8322e16a4ad9caea2e3fac7b008e0019621f1fcd8adf1", "pages": 1995, "revision": "040C", "issueDate": "2007-07-06", "title": "Systems Description"},
    "2": {"filename": "FCOM 2.pdf", "sha256": "acc6cb05649393067eab2cc49b69b6df550f63cfc0c0a6816420defb9207c5bf", "pages": 885, "revision": "039", "issueDate": "2007-05-01", "title": "Flight Preparation"},
    "3": {"filename": "FCOM 3.pdf", "sha256": "26343087d1c1feda1d618c2956d9cfd296bb91aa68637cfccafda8df8509d4f8", "pages": 2089, "revision": "041B", "issueDate": "2007-07-06", "title": "Flight Operations"},
    "4": {"filename": "FCOM 4.pdf", "sha256": "2e88220d1e266a82d373a63f197e166984a9815bb0cf80ffc8495def4c84ab7f", "pages": 1225, "revision": "019B", "issueDate": "2007-07-06", "title": "FMGS Pilot's Guide"},
}

A320_MSN = "0665-1108 1312-1361 1532 1542 1639 1906-2274 2437-2498 2562-2627 3170 3197"

# Populated by the reviewed transcription. Each climb cell is time/fuel/distance/TAS;
# a dash is a genuinely blank source cell and must never become zero or extrapolation.
CLIMB_ISA = {
    1637: (52, """
390 18/1326/118/387 19/1400/126/388 21/1478/134/389 22/1563/143/390 23/1657/153/392 25/1763/165/393 27/1884/179/396
370 16/1240/104/380 17/1304/110/381 18/1371/116/381 19/1442/122/382 20/1517/129/383 21/1598/137/384 23/1685/146/385
350 15/1168/93/373 16/1226/98/374 16/1287/103/375 17/1351/108/375 18/1417/114/376 19/1487/120/377 20/1560/127/377
330 14/1102/84/366 14/1156/88/367 15/1212/92/367 16/1270/97/368 17/1331/102/368 17/1394/107/369 18/1459/112/370
310 13/1038/75/358 13/1088/79/359 14/1140/83/359 14/1193/87/360 15/1249/91/360 16/1306/95/361 17/1366/100/361
290 11/970/66/348 12/1016/70/349 13/1063/73/349 13/1112/77/350 14/1163/80/350 14/1215/84/351 15/1270/88/351
270 10/887/57/335 11/928/59/336 11/971/62/336 12/1015/65/336 12/1060/68/337 13/1107/71/337 13/1155/74/337
250 9/811/48/322 9/849/51/323 10/887/53/323 10/927/56/323 11/968/58/324 11/1010/61/324 12/1053/63/324
240 9/776/45/316 9/811/47/316 9/848/49/317 10/886/51/317 10/925/54/317 11/965/56/318 11/1006/58/318
220 8/709/38/303 8/741/40/304 8/774/42/304 9/808/44/304 9/843/46/305 9/879/48/305 10/916/50/305
200 7/645/33/291 7/674/34/291 7/704/36/291 8/735/37/292 8/767/39/292 8/799/41/292 9/833/42/292
180 6/585/28/278 6/611/29/278 7/638/30/278 7/666/32/279 7/695/33/279 7/724/34/279 8/754/36/279
160 5/528/23/264 6/551/24/264 6/576/25/265 6/601/27/265 6/626/28/265 7/653/29/265 7/679/30/266
140 5/473/19/250 5/494/20/250 5/516/21/251 5/538/22/251 6/561/23/251 6/585/24/251 6/609/25/251
120 4/421/16/234 4/440/17/235 4/459/17/235 5/479/18/236 5/499/19/236 5/520/20/236 5/542/21/236
100 3/336/11/207 3/351/12/207 3/367/12/208 4/383/13/208 4/399/13/208 4/416/14/208 4/433/14/209
50 2/220/6/169 2/229/6/169 2/239/6/169 2/250/7/170 2/260/7/170 3/271/7/170 3/282/8/171
15 1/138/3/120 1/144/3/120 1/150/3/120 2/156/3/120 2/163/3/121 2/170/3/121 2/177/3/121
"""),
    1644: (66, """
390 - - - - - - -
370 24/1779/155/387 26/1884/166/388 27/2003/179/391 - - - -
350 21/1638/134/378 22/1721/141/380 24/1811/150/381 25/1910/159/383 27/2019/170/384 28/2142/183/387 30/2282/197/389
330 19/1528/118/371 20/1600/124/371 21/1677/131/373 22/1759/138/374 23/1847/146/375 25/1942/154/377 26/2045/164/378
310 17/1428/105/362 18/1492/110/363 19/1560/115/364 20/1632/121/365 21/1708/127/366 22/1788/134/367 23/1874/141/368
290 16/1326/92/352 16/1384/96/352 17/1445/101/353 18/1509/106/354 19/1576/111/355 20/1646/116/356 20/1720/122/357
270 14/1205/78/338 14/1256/81/339 15/1310/85/339 16/1365/89/340 16/1423/93/341 17/1484/97/342 18/1547/101/343
250 12/1098/66/325 13/1143/69/325 13/1191/72/326 14/1240/75/327 14/1291/78/327 15/1344/82/328 16/1399/85/329
240 11/1048/61/318 12/1091/64/319 12/1136/66/319 13/1182/69/320 13/1230/72/321 14/1280/75/322 15/1331/78/322
220 10/954/52/306 11/993/54/306 11/1033/56/307 11/1074/59/307 12/1117/61/308 12/1161/64/309 13/1207/66/309
200 9/866/44/293 9/901/46/293 10/937/48/294 10/974/50/294 11/1012/52/295 11/1052/54/296 11/1092/56/296
180 8/784/37/280 8/816/39/280 9/848/40/281 9/881/42/281 9/915/44/282 10/950/45/283 10/986/47/283
160 7/707/31/266 7/735/33/267 8/764/34/267 8/793/35/268 8/823/37/268 8/855/38/269 9/887/40/270
140 6/633/26/252 6/658/27/252 7/684/28/253 7/710/29/254 7/737/31/254 7/765/32/255 8/794/33/256
120 5/563/22/237 6/586/22/237 6/608/23/238 6/632/24/239 6/656/25/239 7/680/26/240 7/705/27/241
100 4/450/15/209 4/468/16/210 5/486/16/211 5/505/17/211 5/524/17/212 5/544/18/213 5/564/19/214
50 3/293/8/171 3/304/8/172 3/316/8/173 3/328/9/174 3/340/9/174 3/352/9/176 3/364/10/177
15 2/184/4/122 2/191/4/122 2/198/4/123 2/205/4/124 2/212/4/125 2/219/4/126 2/227/4/127
"""),
}
HOLDING = """
46 45.6/890 47.9/873 51.1/839 54.0/813 57.5/794 58.9/789 60.6/787 63.5/784
48 46.5/926 48.9/908 52.1/871 55.1/844 58.4/828 59.9/823 61.7/821 64.7/818
50 47.4/962 49.8/940 53.0/901 56.2/876 59.4/861 61.0/859 62.8/855 65.8/851
52 48.3/997 50.6/971 53.9/931 57.3/908 60.3/896 62.0/892 63.9/889 66.7/884
54 49.2/1033 51.4/1002 54.9/963 58.3/942 61.3/931 63.0/926 65.0/924 67.7/916
56 50.1/1065 52.2/1033 55.8/994 59.1/975 62.2/964 64.0/960 66.1/955 68.6/949
58 50.8/1097 52.9/1063 56.8/1026 59.9/1008 63.2/997 65.1/994 66.9/988 69.5/982
60 51.5/1128 53.7/1094 57.7/1059 60.7/1043 64.1/1031 66.1/1026 67.7/1021 70.4/1016
62 52.2/1158 54.5/1125 58.7/1092 61.6/1078 65.1/1065 66.9/1058 68.6/1054 71.2/1049
64 52.9/1189 55.3/1156 59.4/1126 62.4/1110 66.0/1097 67.7/1091 69.4/1087 72.1/1084
66 53.6/1219 56.1/1188 60.1/1159 63.2/1143 67.0/1129 68.5/1124 70.3/1120 72.9/1119
68 54.3/1250 56.9/1221 60.9/1193 64.1/1176 67.7/1162 69.3/1157 71.4/1154 73.7/1155
70 55.0/1282 57.8/1254 61.6/1228 64.9/1210 68.4/1195 70.1/1191 71.8/1188 74.6/1192
72 55.8/1314 58.6/1287 62.3/1261 65.7/1243 69.2/1228 70.8/1224 72.5/1223 75.4/1230
74 56.5/1347 59.4/1321 63.1/1294 66.6/1275 69.9/1262 71.6/1258 73.3/1258 76.1/1269
76 57.2/1380 60.2/1355 63.8/1327 67.4/1307 70.6/1296 72.3/1292 74.0/1295 76.9/1309
78 58.0/1413 60.8/1389 64.5/1360 68.2/1339 71.3/1330 73.0/1328 74.8/1332 77.6/1350
"""

# FL, then time/fuel/distance/N1 at 45 t and 65 t, then the printed IAS.
# IDLE is categorical, not zero percent N1.
DESCENT = """
390 16.1/204/101/68.8 17.4/165/106/IDLE 241
370 14.6/174/89/69.9 16.7/160/100/IDLE 252
350 12.9/134/77/72.1 16.0/156/95/IDLE 264
330 12.0/119/70/IDLE 15.4/153/91/IDLE 277
310 11.6/117/67/IDLE 14.8/149/86/IDLE 289
290 11.1/114/64/IDLE 14.2/145/82/IDLE 300
270 10.6/110/59/IDLE 13.4/141/76/IDLE 300
250 10.0/107/55/IDLE 12.7/136/71/IDLE 300
240 9.7/105/53/IDLE 12.3/133/68/IDLE 300
220 9.1/100/49/IDLE 11.5/127/62/IDLE 300
200 8.5/94/45/IDLE 10.6/119/56/IDLE 300
180 7.8/86/40/IDLE 9.8/109/51/IDLE 300
160 7.1/78/36/IDLE 8.8/97/45/IDLE 300
140 6.3/67/31/IDLE 7.9/83/39/IDLE 300
120 5.6/57/27/IDLE 6.9/70/33/IDLE 300
100 4.9/48/23/IDLE 6.0/58/28/IDLE 300
50 1.7/15/7/IDLE 2.1/18/9/IDLE 250
15 0.0/0/0/IDLE 0.0/0/0/IDLE 250
"""


def climb_rows():
    out = []
    for page, (first_mass_t, text) in CLIMB_ISA.items():
        for line in text.strip().splitlines():
            fl, *cells = line.split()
            assert len(cells) == 7
            for i, cell in enumerate(cells):
                if cell == "-":
                    continue
                time, fuel, distance, tas = map(int, cell.split("/"))
                out.append({"isaDeviationC": 0, "massKg": (first_mass_t + 2 * i) * 1000,
                            "fl": int(fl), "timeMin": time, "fuelKg": fuel,
                            "distanceNm": distance, "tasKt": tas, "pdfPage": page})
    return out


def holding_rows():
    out = []
    levels = [15, 50, 100, 140, 180, 200, 220, 250]
    for line in HOLDING.strip().splitlines():
        mass, *cells = line.split()
        assert len(cells) == len(levels)
        for fl, cell in zip(levels, cells):
            n1, flow = cell.split("/")
            out.append({"massKg": int(mass) * 1000, "fl": fl, "n1Pct": float(n1),
                        "fuelFlowPerEngineKgH": int(flow), "pdfPage": 1826})
    return out


def descent_rows():
    out = []
    for line in DESCENT.strip().splitlines():
        fl, low, high, ias = line.split()
        for mass, cell in [(45000, low), (65000, high)]:
            time, fuel, distance, n1 = cell.split("/")
            out.append({"massKg": mass, "fl": int(fl), "timeMin": float(time),
                        "fuelKg": int(fuel), "distanceNm": int(distance),
                        "n1Pct": None if n1 == "IDLE" else float(n1),
                        "iasKt": int(ias), "pdfPage": 1846})
    return out


def dataset():
    c, h, d = climb_rows(), holding_rows(), descent_rows()
    assert (len(c), len(h), len(d)) == (241, 136, 36)
    assert next(r for r in c if r["massKg"] == 60000 and r["fl"] == 350)["fuelKg"] == 1417
    assert next(r for r in h if r["massKg"] == 60000 and r["fl"] == 15)["fuelFlowPerEngineKgH"] == 1128
    assert next(r for r in d if r["massKg"] == 45000 and r["fl"] == 350)["n1Pct"] == 72.1
    for rows, axes in [(c, ["isaDeviationC", "massKg", "fl"]), (h, ["massKg", "fl"]), (d, ["massKg", "fl"])]:
        assert len({tuple(r[a] for a in axes) for r in rows}) == len(rows)
    return {
        "schemaVersion": 1,
        "source": {
            "filename": FILES["3"]["filename"], "sha256": FILES["3"]["sha256"],
            "document": "Airbus / China Eastern Airlines (CES) A319/A320/A321 Flight Crew Operating Manual, Volume 3 — Flight Operations",
            "revision": "041B", "issueDate": "2007-07-06", "pdfPageCount": 2089,
            "pdfPageNumbering": "1-based; not the printed section page number",
            "tablePageRevisions": {"climb": 27, "holding": 31, "descent": 27},
            "relatedVolumes": FILES,
            "providedBy": "User-supplied PDFs; source manuals and raster pages are not included in this repository",
        },
        "applicability": {
            "aircraftModel": "A320-214", "engineModel": "CFM56-5B4/P", "engineCount": 2,
            "combustor": "SAC", "wingtip": "fence", "operator": "China Eastern Airlines", "operatorCode": "CES",
            "msnEffectivityAsPrinted": A320_MSN,
            "evidence": [
                {"volume": 1, "pdfPage": 212, "pageCode": "1.20.10 P1 SEQ105 REV34", "meaning": "The A320 description and 180-seat maximum carry the same MSN effectivity as these performance tables."},
                {"volume": 1, "pdfPage": 215, "pageCode": "1.20.20 P1 SEQ001 REV31", "meaning": "A320 general arrangement: length 37.57 m, span 34.1 m, conventional wing-tip fences; same MSN effectivity."},
                {"volume": 2, "pdfPage": 655, "pageCode": "2.05.15 P2 SEQ020 REV24", "meaning": "Flight-planning databases explicitly identify CFM56-5-B/P SAC. The stated 3% non-/P correction is scoped to those flight-planning tables."},
                {"volume": 3, "pdfPages": [96, 97, 102, 103], "pageCode": "3.00.80 LEP", "meaning": "SEQ170 climb/holding/descent entries specify CFM56-5-B4 and the A320 MSN group."},
                {"volume": 3, "pdfPages": [1637, 1644, 1846], "meaning": "The technical table footers explicitly identify A320-214 CFM56-5B4/P; headers and footer effectivity were checked visually."},
            ],
            "notes": [
                "This is one confirmed configuration in a multi-aircraft manual. CES ALL does not make a numerical table applicable to every Airbus model.",
                "These rows do not directly apply to A319, A321, non-/P engines, sharklet variants, NEO or modified aircraft.",
                "The numerical grid does not establish certified operating mass or altitude limits for any individual MSN.",
                "Exact match to reference data is separate from the model's independent aerodynamic/propulsive predictions and calibration.",
            ],
        },
        "climb": {
            "boundary": "Brake release to the selected flight level; takeoff and initial climb are included.",
            "massBasis": "Weight at brake release, as printed. Cumulative entries at different FL use this same original reference mass.",
            "fuelBasis": "Aircraft total. Do not multiply by engine count or add a separate takeoff allowance.",
            "conditions": {"thrust": "MAX CLIMB THRUST", "airConditioning": "NORMAL", "antiIce": "OFF", "cgPercentMac": 33,
                           "speedProfile": "250 kt from 1500 ft to FL100; accelerate 250 to 300 kt; climb at 300 kt then M0.78 to the selected altitude"},
            "temperatureDeviationC": [0],
            "units": {"massKg": "kg at brake release", "fl": "hundreds of feet", "isaDeviationC": "degC relative to ISA",
                      "timeMin": "min", "fuelKg": "kg, aircraft total", "distanceNm": "NM", "tasKt": "KT, printed TAS field"},
            "sourceTables": [{"volume": 3, "isaDeviationC": 0, "pdfPages": [1637, 1644], "generalPdfPage": 1636,
                              "pageCode": "3.05.10 P2/P3 SEQ170 REV27", "rows": 241,
                              "extraction": "Native 1-bit raster, column OCR with table lines removed, all rows visually checked; specific OCR repairs recorded in quality."}],
            "correctionsFuelPct": [{"isaDeviationC": 0, "massRangeKg": [52000, 78000], "pdfPages": [1637, 1644],
                                    "lowAirConditioning": -0.6, "highAirConditioning": 0.6,
                                    "engineAntiIceOn": 2.5, "totalAntiIceOn": 5}],
            "notes": [
                "FL15 contains takeoff and initial climb, not pure ground roll. At 60 t it is 163 kg, 2 min and 3 NM.",
                "The difference C(m0, FL2)-C(m0, FL1) refers to the same brake-release mass m0; a later step-climb entry mass is not automatically that same reference.",
                "Eleven genuinely empty cells remain absent: FL390 at 66–78 t, and FL370 at 72–78 t.",
                "This first dataset extracts ISA0 only. Additional ISA+10/+15/+20 sheets exist and are catalogued; their numbers are not silently inferred.",
                "Time and distance are integer-rounded source outputs. Very short differences can lose resolution; they are not instantaneous climb rates.",
                "The source labels the fourth field TAS but does not define it as final cruise TAS. Preserve the printed values without that reinterpretation.",
                "Corrections are metadata only; the lookup does not apply them automatically.",
            ],
            "rows": c,
        },
        "descent": {
            "boundary": "Selected FL down to 1500 ft; approach and landing are not included in this pure phase table.",
            "massBasis": "The source heading is WEIGHT (1000KG). The selected general and table pages do not define whether this is initial, final or mean descent mass.",
            "massReferenceTiming": "unspecified-by-source",
            "fuelBasis": "Aircraft total; not fuel per engine.", "referenceIsaDeviationC": 0,
            "conditions": {"thrust": "IDLE THRUST heading; numeric N1 exceptions retained where printed", "airConditioning": "NORMAL", "antiIce": "OFF",
                           "cgPercentMac": 33, "speedProfile": "M0.78/300 kt/250 kt", "maximumCabinDescentRateFtMin": 350},
            "units": {"massKg": "kg, source WEIGHT reference", "fl": "hundreds of feet", "timeMin": "min", "fuelKg": "kg, aircraft total",
                      "distanceNm": "NM", "n1Pct": "percent, or null for the source's IDLE label", "iasKt": "KT IAS, printed field"},
            "sourceTables": [{"volume": 3, "pdfPage": 1846, "generalPdfPage": 1845, "pageCode": "3.05.30 P2 SEQ170 REV27", "rows": 36}],
            "correctionsPct": {
                "sourcePdfPage": 1846,
                "lowAirConditioning": {"time": None, "fuel": -2, "distance": None},
                "engineAntiIceOn": {"time": 6, "fuel": 28, "distance": 3},
                "totalAntiIceOn": {"time": 6, "fuel": 44, "distance": 4},
                "perDegreeAboveIsa": {"time": None, "fuel": 0.2, "distance": 0.3},
                "nullMeaning": "Dash in the source correction table; no numerical correction provided here.",
            },
            "notes": [
                "Do not claim a descent-start or descent-end interpretation of WEIGHT from this source; callers must name their assumed reference mass explicitly.",
                "At 45 t, FL390/370/350 give numeric N1=68.8/69.9/72.1 despite the general IDLE THRUST heading. Other cells say IDLE, stored as null rather than zero.",
                "FL15 has zero cumulative descent time, distance and fuel. An arrival allowance belongs after this endpoint.",
                "The 2.05.30 descent correction for integrated cruise is a different calculation and already includes a six-minute IFR arrival. Do not add it to these full phase values.",
            ],
            "rows": d,
        },
        "holding": {
            "boundary": "Race-track holding pattern at green-dot speed, clean configuration.",
            "massBasis": "Fuel planning instruction: use the landing weight at the alternate (Volume 2 PDF647). The calculation worksheet subtracts holding fuel after alternate landing weight (PDF657 lines12–14).",
            "fuelBasis": "The numerical table explicitly gives FF in KG/H/ENG; multiply by engineCount and hours only at the call site.",
            "engineCount": 2, "referenceIsaDeviationC": 0,
            "conditions": {"thrustLimit": "MAX CRUISE THRUST LIMITS", "configuration": "CLEAN", "speed": "GREEN DOT", "pattern": "RACE TRACK",
                           "airConditioning": "NORMAL", "antiIce": "OFF", "cgPercentMac": 33},
            "units": {"massKg": "kg", "fl": "hundreds of feet", "n1Pct": "percent", "fuelFlowPerEngineKgH": "kg/h/engine"},
            "sourceTables": [{"volume": 3, "pdfPage": 1826, "generalPdfPage": 1825, "pageCode": "3.05.25 P2 SEQ170 REV31", "rows": 136}],
            "correctionsFuelFlowPct": {"sourcePdfPage": 1826, "lowAirConditioning": -0.3, "engineAntiIceOn": 5, "totalAntiIceOn": 9,
                                       "perDegreeAboveIsa": 0.3, "straightLine": -5},
            "notes": [
                "The general page discusses total holding fuel; the numerical sheet's explicit per-engine unit takes precedence for its entries.",
                "Green dot in clean configuration and S speed in CONF1 lie between minimum-fuel and minimum-drag speed according to the general page.",
                "Straight-line correction is not part of race-track values and is not applied automatically.",
            ],
            "rows": h,
        },
        "groundAndTerminalFuel": {
            "source": {"volume": 2, "pdfPage": 647, "pageCode": "2.05.10 P2 SEQ001 REV21", "msnEffectivityAsPrinted": A320_MSN},
            "taxi": {"fuelFlowAircraftKgMin": 11.5, "referenceTimeMin": 12, "publishedReferenceFuelKg": 140,
                     "note": "Includes start-up and taxi. The stated average is rounded; 11.5×12 is 138 kg."},
            "approachAndLanding": {"fuelFlowAircraftKgMin": 20, "ifrTimeMin": 6, "ifrFuelKg": 120,
                                   "vfrTimeMin": 4, "vfrFuelKg": 80,
                                   "note": "Trip fuel includes descent to1500ft above destination, then approach and landing. The four-minute VFR value is stated for the alternate approach procedure."},
            "goAround": {"fuelKg": 100, "note": "Allowance included in alternate fuel; not automatically part of every trip arrival."},
            "holdingPlanningReference": {"timeMin": 30, "altitudeAboveAlternateFt": 1500, "fuelKg": 1200, "configuration": "CLEAN GREEN DOT",
                                         "note": "Explicitly described as a conservative quantity, not a replacement for the mass-dependent holding table."},
            "apu": {"fuelFlowKgH": 130, "packs": "ON", "generatorLoadKva": 90, "qualifier": "about"},
            "contingency": {"note": "According to national regulations and company policy, generally a percentage of trip fuel; no fixed percentage specified on this page."},
        },
        "integratedCruisePlanning": {
            "purpose": "Catalogue of the separate whole-route integrated-cruise method. These corrections are not full phase burns and are not combined with the phase rows automatically.",
            "nonPEngineCorrection": {"volume": 2, "pdfPage": 655, "fuelPct": 3, "scope": "Following flight-planning calculation tables based on CFM56-5-B/P SAC; non-/P engines only."},
            "climbCorrection": {"volume": 2, "pdfPage": 782, "reference": "WEIGHT AT BRAKE RELEASE", "profile": "250kt/300kt/M0.78", "note": "Correction to fuel and time already calculated from integrated cruise over the route, not full climb fuel."},
            "stepClimbCorrection": {"volume": 2, "pdfPage": 782, "fuelKgPerStep": 50, "stepHeightFtBelowFl290": 2000, "stepHeightFtAboveFl290": 4000,
                                    "note": "Applies to the integrated-cruise planning method. Source does not assign the exact FL290 boundary to either height."},
            "descentCorrection": {"volume": 2, "pdfPage": 783, "reference": "WEIGHT OVERHEAD DESTINATION", "endAltitudeFt": 1500, "includesIfrApproachMin": 6,
                                  "note": "This fictitious integrated-cruise reference is not an explicit mass definition for the pure descent table in3.05.30."},
            "cruiseTemperatureCorrection": {"volume": 2, "pdfPage": 657, "fuelKgPerDegreeCPerNm": 0.015, "expression": "0.015 × deltaISA_degC × airDistance_nm"},
            "takeoffAirportAltitudeCorrection": {"volume": 2, "pdfPage": 657, "fuelKgPer1000KgPer1000Ft": 0.5,
                                               "expression": "0.5 × TOW_1000kg × airportElevation_1000ft", "signInWorksheet": "Added to overhead-destination weight; reduces required fuel relative to sea-level integrated reference."},
        },
        "quality": {
            "verifiedRows": 413, "climbRows": 241, "holdingRows": 136, "descentRows": 36,
            "originalsVisuallyChecked": True, "automaticApplicationToMission": False,
            "extraction": "The main numerical content is raster. Native image OCR was used as an aid; the committed transcription was checked against rendered pages, including every row and the source headings/footnotes.",
            "ocrRepairs": [
                {"pdfPage": 1637, "massKg": 62000, "fl": 270, "field": "cell", "verified": "13 min /1107kg /71NM /337KT", "reason": "OCR omitted distance71 in a line joined to another field."},
                {"pdfPage": 1644, "massKg": 70000, "fl": 160, "field": "distanceNm", "ocr": 349, "verified": 34},
                {"pdfPage": 1826, "massKg": 66000, "fl": 250, "field": "n1Pct", "ocr": "712.9", "verified": 72.9},
                {"pdfPage": 1826, "massKg": 72000, "fl": 220, "field": "n1Pct", "ocr": "712.5", "verified": 72.5},
                {"pdfPage": 1826, "massKg": 76000, "fl": 200, "field": "n1Pct", "ocr": "712.3", "verified": 72.3},
            ],
            "limitations": [
                "The phase rows preserve raw reference semantics, including the unresolved start/end timing of descent WEIGHT.",
                "No unprinted cells, temperature extrapolation, aircraft variant substitution or bleed corrections are synthesized.",
                "Remaining ISA temperatures, other holding configurations and cruise numerical tables are catalogued for later extraction.",
            ],
        },
    }


def cruise_checks():
    # Visually checked on Volume3 PDF1707 (M.78) and PDF1724 (LRC).
    # mass_t, FL, N1_pct, Mach, FF_kg/h/engine, IAS_kt, TAS_kt, SR_nm/1000kg.
    fixed = [
        [50, 290, 80.8, .780, 1305, 302, 462, 176.9],
        [50, 350, 80.4, .780, 1053, 264, 450, 213.5],
        [50, 390, 82.0, .780, 954, 241, 447, 234.6],
        [60, 290, 81.6, .780, 1356, 302, 462, 170.2],
        [60, 350, 82.1, .780, 1135, 264, 450, 198.1],
        [60, 390, 84.7, .780, 1097, 241, 447, 203.9],
        [70, 290, 82.6, .780, 1424, 302, 462, 162.1],
        [70, 350, 84.2, .780, 1267, 264, 450, 177.4],
        [78, 350, 86.5, .780, 1411, 264, 450, 159.3],
    ]
    lrc = [
        [50, 290, 74.8, .662, 976, 253, 392, 200.6],
        [50, 350, 78.4, .722, 932, 243, 416, 223.4],
        [50, 390, 81.8, .771, 938, 238, 442, 235.7],
        [60, 290, 78.0, .694, 1122, 266, 411, 183.0],
        [60, 350, 81.8, .771, 1116, 261, 444, 199.0],
        [60, 390, 85.0, .788, 1116, 244, 452, 202.5],
        [70, 290, 81.3, .739, 1311, 285, 437, 166.8],
        [70, 350, 84.4, .786, 1285, 267, 453, 176.3],
        [78, 350, 86.5, .782, 1417, 265, 451, 159.0],
    ]
    rows = []
    for regime, page, section_page, source_rows in [("fixedMach", 1707, 9, fixed), ("lrc", 1724, 14, lrc)]:
        for mass, fl, n1, mach, ff, ias, tas, sr in source_rows:
            rows.append({"regime": regime, "massKg": mass * 1000, "fl": fl, "isaDeviationC": 0,
                         "mach": mach, "n1Pct": n1, "fuelFlowPerEngineKgH": ff, "iasKt": ias,
                         "tasKt": tas, "specificRangeNmPer1000Kg": sr, "pdfPage": page,
                         "pageCode": f"3.05.15 P{section_page} SEQ130 REV30"})
            # TAS, FF and SR are rounded independently in the printed table.
            assert abs((tas / (ff * 2) * 1000) / sr - 1) < .002
    assert len(rows) == 18
    return {
        "schemaVersion": 1,
        "source": {
            "filename": FILES["3"]["filename"], "sha256": FILES["3"]["sha256"],
            "document": "Airbus / China Eastern Airlines A319/A320/A321 FCOM, Volume3 — Flight Operations",
            "revision": "041B", "issueDate": "2007-07-06", "pdfPageCount": 2089,
            "pdfPageNumbering": "1-based PDF pages",
            "sourceTables": [
                {"regime": "fixedMach", "pdfPage": 1707, "pageCode": "3.05.15 P9 SEQ130 REV30", "title": "CRUISE — M.78"},
                {"regime": "lrc", "pdfPage": 1724, "pageCode": "3.05.15 P14 SEQ130 REV30", "title": "LONG RANGE CRUISE"},
            ],
        },
        "applicability": {
            "aircraftModel": "A320-214", "engineModel": "CFM56-5B4/P", "engineCount": 2,
            "combustor": "SAC", "wingtip": "fence", "operatorCode": "CES", "msnEffectivityAsPrinted": A320_MSN,
            "evidence": [
                {"volume": 1, "pdfPages": [212, 215], "meaning": "A320 airframe and conventional 34.1m wing, same effectivity."},
                {"volume": 2, "pdfPage": 655, "meaning": "CFM56-5-B/P SAC database identification."},
                {"volume": 3, "pdfPages": [98, 99, 100], "meaning": "LEP links cruise SEQ130 to CODE0370/CFM56-5-B4 and the A320 MSN group."},
                {"volume": 3, "pdfPages": [1637, 1644, 1846], "meaning": "A320-214 CFM56-5B4/P identification in technical performance-table footers for the same fleet group."},
            ],
        },
        "conditions": {"referenceIsaDeviationC": 0, "cgPercentMac": 33, "airConditioning": "NORMAL", "antiIce": "OFF",
                       "thrustLimit": "MAX CRUISE THRUST LIMITS", "altitudeDatum": "Pressure altitude expressed as FL"},
        "units": {"massKg": "kg", "fl": "hundreds of feet", "isaDeviationC": "degC relative to ISA", "mach": "dimensionless",
                  "n1Pct": "percent", "fuelFlowPerEngineKgH": "kg/h/engine", "iasKt": "KT IAS", "tasKt": "KT TAS",
                  "specificRangeNmPer1000Kg": "NM/1000KG, aircraft-total fuel basis consistent with two-engine FF and TAS within source rounding"},
        "corrections": [
            {"regime": "fixedMach", "pdfPage": 1707, "sourceQuantity": "deltaFUEL percent", "lowAirConditioningPct": -0.5, "engineAntiIceOnPct": 2.0, "totalAntiIceOnPct": 4.5},
            {"regime": "lrc", "pdfPage": 1724, "sourceQuantity": "deltaFUEL percent", "lowAirConditioningPct": -0.5, "engineAntiIceOnPct": 2.5, "totalAntiIceOnPct": 5.0},
        ],
        "notes": [
            "Selected independent validation nodes, not a complete interpolation table. No missing cells are filled and no Mach profile is automatically connected to the mission.",
            "All18 entries were read from page images. FF is per engine, while SR is consistent with total fuel for the two engines; values retain the source's independent rounding.",
            "LRC Mach varies with mass and altitude and may lie above or below M0.78. For example, at60t/FL390 it is0.788; at50t/FL290 it is0.662.",
            "Fuel flow is a validation reference and must not replace the model's FF in the same independent check or be fitted to the holdout points.",
            "Air-conditioning and anti-ice corrections are source-specific metadata, not an estimate of the benefit of a bleedless architecture.",
            "The phase dataset and these cruise controls share aircraft applicability but remain separate numerical products.",
        ],
        "checks": rows,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source_dir", type=Path)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / "data/fcom/a320-214-ces-phases.json")
    parser.add_argument("--cruise-output", type=Path, default=Path(__file__).resolve().parents[1] / "data/fcom/a320-214-ces-cruise-checks.json")
    args = parser.parse_args()
    for info in FILES.values():
        source = args.source_dir / info["filename"]
        actual = hashlib.sha256(source.read_bytes()).hexdigest()
        if actual != info["sha256"]:
            raise ValueError(f"Unexpected source revision: {source.name}; SHA-256 {actual}")
    result = dataset()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {args.output}: 241 ISA0 climb +136 holding +36 descent rows; all413 source coordinates preserved")
    args.cruise_output.parent.mkdir(parents=True, exist_ok=True)
    args.cruise_output.write_text(json.dumps(cruise_checks(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {args.cruise_output}: 18 independently checked cruise nodes, no mission integration")


if __name__ == "__main__":
    main()
