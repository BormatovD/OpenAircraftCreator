#!/usr/bin/env python3
"""Extract explicitly separated 757 performance packets from the supplied FCOM.

Usage:
  python tools/fcom_757_extract.py /path/to/FCOM.pdf

Requires the same PyMuPDF dependency used by the other PDF extractors.  The PDF
is not distributed with the repository.  Cells are read by their PDF positions;
no interpolation, aerodynamic correction, or missing-cell filling is performed.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path

import fitz

LB_TO_KG = 0.45359237
EXPECTED_SHA256 = "eafcade91517e8e507e31b70552eafd4e0b59ee819259901fe9533ea5b106a86"
PACKETS = [
    ("pi10-pw2037", "757-200", "PW2037", "LB", "FAA", 334, 339, 340, 343, 344, 393, 394, 398, ["VQ-BTO"]),
    ("pi20-pw2040", "757-200", "PW2040", "KG", "FAA/EU-OPS", 417, 423, 424, 427, 428, 477, 478, 482, ["VQ-BBU", "VQ-BJK"]),
    ("pi30-pw2040", "757-200", "PW2040", "KG", "FAA", 502, 507, 508, 511, 512, 561, 562, 566, ["VQ-BBU", "VQ-BJK"]),
    ("pi40-pw2037-winglets", "757-200W", "PW2037", "KG", "FAA/EU-OPS", 587, 593, 594, 597, 598, 647, 648, 652, ["VQ-BKM"]),
    ("pi50-pw2040-winglets", "757-200W", "PW2040", "KG", "FAA/EU-OPS", 672, 677, 678, 681, 682, 731, 732, 736, ["VQ-BHR"]),
]
NUM = re.compile(r"^-?(?:\d+(?:\.\d+)?|\.\d+)\*?$")


def number(s: str) -> float:
    return float(s.rstrip("*"))


def numeric_words(words):
    return [w for w in words if NUM.fullmatch(w[4])]


def lines(page):
    """Group PDF words by their baseline; the table uses a common font size."""
    grouped = {}
    for word in page.get_text("words"):
        grouped.setdefault(round(word[1], 1), []).append(word)
    return [(y, sorted(ws, key=lambda w: w[0])) for y, ws in sorted(grouped.items())]


def reference(page, pdf_page):
    text = page.get_text()
    codes = re.findall(r"\bPI\.\d+\.\d+\b", text)
    dates = re.findall(r"\b(?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, \d{4}\b", text)
    assert codes and dates, f"No printed page code/date on PDF {pdf_page}"
    return {"pdfPage": pdf_page, "pageCode": codes[-1], "pageDate": dates[-1]}


def kg(value, unit):
    return round(value * (LB_TO_KG if unit == "LB" else 1), 8)


def control_table(page, pdf_page, unit, lrc):
    words = page.get_text("words")
    eprs = sorted([w for w in words if w[4] == "EPR" and w[0] < 80], key=lambda w: w[1])
    assert len(eprs) in (7, 8), (pdf_page, len(eprs))
    # Header digits have the same x-centres as the data.  They occur directly
    # above the first EPR row, not in the separate weight column.
    header = sorted([w for w in numeric_words(words) if w[0] > 80 and eprs[0][1] - 12 < w[1] < eprs[0][1] - 2], key=lambda w: w[0])
    alts = [int(number(w[4]) * (1000 if lrc else 1)) for w in header]
    assert alts == (list(range(25000 if "200W" in page.get_text() else 21000, 42000, 2000)) if lrc else [1500, 5000, 10000, 15000, 20000, 25000, 30000, 35000, 40000]), (pdf_page, alts)
    centers = [(w[0] + w[2]) / 2 for w in header]
    labels = ["EPR", "MACH", "KIAS", "FF/ENG"] if lrc else ["EPR", "KIAS", "FF/ENG"]
    rows, missing, masses = [], [], []
    for gi, epr in enumerate(eprs):
        end_y = eprs[gi + 1][1] - 1 if gi + 1 < len(eprs) else epr[1] + 40
        group = [w for w in words if epr[1] - 0.2 <= w[1] <= end_y]
        mass_words = [w for w in numeric_words(group) if w[0] < 48]
        assert len(mass_words) == 1, (pdf_page, gi, mass_words)
        source_mass = int(number(mass_words[0][4]))
        mass_kg = kg(source_mass * 1000, unit)
        masses.append(mass_kg)
        columns = {}
        for label in labels:
            markers = [w for w in group if w[4] == label]
            assert len(markers) == 1, (pdf_page, source_mass, label)
            y = markers[0][1]
            values = [w for w in numeric_words(group) if w[0] > 80 and abs(w[1] - y) < 0.3]
            by_col = {}
            for word in values:
                center = (word[0] + word[2]) / 2
                col = min(range(len(centers)), key=lambda i: abs(centers[i] - center))
                assert abs(centers[col] - center) < 3 and col not in by_col, (pdf_page, word)
                by_col[col] = number(word[4])
            columns[label] = by_col
        sets = [set(c) for c in columns.values()]
        assert all(s == sets[0] for s in sets), (pdf_page, source_mass, sets)
        for col, altitude in enumerate(alts):
            if col not in sets[0]:
                missing.append({"massKg": mass_kg, "fl": altitude / 100})
                continue
            raw_ff = int(columns["FF/ENG"][col])
            row = {
                "massKg": mass_kg, "sourceMassThousands": source_mass,
                "fl": altitude / 100, "epr": columns["EPR"][col],
                "iasKt": int(columns["KIAS"][col]),
                "fuelFlowPerEngineKgH": kg(raw_ff, unit),
                "sourceFuelFlowPerEngine": raw_ff, "pdfPage": pdf_page,
            }
            if lrc:
                row["mach"] = columns["MACH"][col]
            rows.append(row)
    return {
        "source": reference(page, pdf_page),
        "sourceMassUnit": f"1000 {unit}", "sourceFuelFlowUnit": f"{unit}/h per engine",
        "engineCount": 2, "altitudesFt": alts, "massesKg": masses,
        "conditions": ({"temperature": "standard day", "speedMode": "Long Range Cruise", "flightConfiguration": "all engines, normal configuration"} if lrc else {"flaps": "up", "speedSchedule": "FMC optimum holding: higher of maximum endurance and maneuvering speed", "racetrackFuelAllowanceIncludedPct": 5, "temperature": "not separately specified on the holding page"}),
        "rows": rows, "missingCells": missing,
    }


def climb_and_bleed(page, pdf_page):
    ls = lines(page)
    numeric = [(y, numeric_words(ws)) for y, ws in ls]
    main = [(y, ws) for y, ws in numeric if len(ws) == 10 and 90 < y < 200]
    assert len(main) == 9, (pdf_page, len(main))
    header = [ws for y, ws in numeric if len(ws) == 9 and 75 < y < main[0][0]]
    assert len(header) == 2, (pdf_page, header)
    alts = [int(number(w[4]) * 1000) for w in header[0]]
    speeds = [number(w[4]) for w in header[1]]
    assert alts == list(range(0, 41000, 5000))
    rows = []
    for _, words in main:
        tat, *vals = [number(w[4]) for w in words]
        for alt, speed, epr in zip(alts, speeds, vals):
            rows.append({"fl": alt / 100, "tatC": tat, "epr": epr, "iasKt": speed if speed > 1 else None, "mach": speed if speed < 1 else None, "pdfPage": pdf_page})
    corrections = []
    for _, words in ls:
        s = " ".join(w[4] for w in words)
        config = None
        if s.startswith("PACKS OFF"):
            config = "packsOff"
        elif s.startswith("ENGINE & WING ANTI-ICE ON"):
            config = "engineAndWingAntiIceOn"
        elif s.startswith("ENGINE ANTI-ICE ON"):
            config = "engineAntiIceOn"
        if config:
            values = [number(w[4]) for w in numeric_words(words)]
            assert len(values) == len(alts), (pdf_page, config)
            corrections.extend({"configuration": config, "fl": alt / 100, "deltaEpr": val, "pdfPage": pdf_page} for alt, val in zip(alts, values))
    assert len(corrections) == 27
    return (
        {"source": reference(page, pdf_page), "conditions": {"packs": "on", "antiIce": "off", "speedSchedule": "250/290/.78", "temperatureInput": "TAT, not ISA deviation or static air temperature", "fuelTimeDistanceProvided": False}, "rows": rows},
        {"source": reference(page, pdf_page), "quantity": "additive maximum-climb target-EPR adjustment", "notEquivalentTo": ["fuel-flow fraction", "shaft-power extraction", "bleed mass flow"], "baseline": "packs on, anti-ice off", "rows": corrections},
    )


def descent_table(page, pdf_page):
    ls = lines(page)
    start = next(y for y, ws in ls if " ".join(w[4] for w in ws).startswith("Descent at"))
    ns = [(y, numeric_words(ws)) for y, ws in ls if start < y < start + 45]
    ns = [(y, ws) for y, ws in ns if len(ws) == 14]
    assert len(ns) == 3, (pdf_page, ns)
    alts, distance, time = [[number(w[4]) for w in ws] for _, ws in ns]
    assert alts == list(range(15, 42, 2))
    return {
        "source": reference(page, pdf_page),
        "conditions": {"speedSchedule": ".78/290/250", "thrust": "flight idle", "windKt": 0, "boundary": "top of descent through straight-in approach, gear down and landing flaps at outer marker", "referenceMassKg": None, "fuelKgAvailable": False},
        "rows": [{"fl": a * 10, "distanceNm": d, "timeMin": t, "fuelKg": None, "pdfPage": pdf_page} for a, d, t in zip(alts, distance, time)],
    }


def apu_table(page, pdf_page, unit):
    ls = lines(page)
    title_y = next(y for y, ws in ls if "APU FUEL FLOW" in " ".join(w[4] for w in ws))
    nums = [numeric_words(ws) for y, ws in ls if title_y < y < title_y + 90]
    nums = [ws for ws in nums if len(ws) == 2]
    assert len(nums) == 8, (pdf_page, nums)
    return {
        "source": reference(page, pdf_page),
        "scope": "aircraft total increment; all-engine text explicitly refers to this table in engine-inoperative text",
        "includes": ["APU fuel flow", "additional main-engine fuel from APU door drag"],
        "sourceFuelFlowUnit": f"{unit}/h", "isPureApuFuelFlow": False,
        "rows": [{"fl": number(ws[0][4]) * 10, "totalFuelFlowIncrementKgH": kg(number(ws[1][4]), unit), "sourceTotalFuelFlowIncrement": number(ws[1][4]), "pdfPage": pdf_page} for ws in nums],
    }


def maximum_altitude(page, pdf_page, unit):
    ls = lines(page)
    heads = []
    for y, ws in ls:
        text = " ".join(w[4] for w in ws)
        m = re.match(r"ISA \+ (\d+)°C", text)
        if m:
            heads.append((y, int(m.group(1)), "and Below" in text))
    assert len(heads) == 3, (pdf_page, heads)
    rows = []
    for y, ws in ls:
        vals = numeric_words(ws)
        if len(vals) != 8 or not 50 <= number(vals[0][4]) <= 260:
            continue
        available = [h for h in heads if h[0] < y]
        assert available
        _, isa, and_below = available[-1]
        vals = [w[4] for w in vals]
        rows.append({
            "massKg": kg(number(vals[0]) * 1000, unit), "sourceMassThousands": number(vals[0]),
            "isaDeltaC": isa, "isaDeltaAndBelow": and_below,
            "optimumAltitudeFt": number(vals[1]), "tatC": number(vals[2]),
            "buffetMargins": [{"g": g, "bankDeg": bank, "maximumAltitudeFt": number(s), "thrustLimited": s.endswith("*")} for g, bank, s in zip([1.2, 1.25, 1.3, 1.4, 1.5], [33, 36, 39, 44, 48], vals[3:])],
            "pdfPage": pdf_page,
        })
    assert len(rows) == 39, (pdf_page, len(rows))
    footnote = next(" ".join(w[4] for w in ws) for _, ws in ls if " ".join(w[4] for w in ws).startswith("*Denotes"))
    return {"source": reference(page, pdf_page), "conditions": {"speedMode": "LRC", "certifiedAltitudeLimitFt": 42000, "pageFootnote": footnote, "asteriskMeaning": "thrust limited in level flight; explanatory text permits max-cruise thrust at 0 fpm OR max-climb thrust at 100 fpm", "isUniversal300FpmCriterion": False}, "rows": rows}


def extract(pdf: Path):
    digest = hashlib.sha256(pdf.read_bytes()).hexdigest()
    if EXPECTED_SHA256 is not None and digest != EXPECTED_SHA256:
        raise ValueError("The supplied PDF differs from the visually audited FCOM; audit page anchors before extracting it.")
    doc = fitz.open(pdf)
    assert len(doc) == 1702
    assert "D632N001-55NRW" in doc[0].get_text() and "May 15, 2014" in doc[0].get_text()
    result = {
        "schemaVersion": 1,
        "_source": {"title": "757-200 Flight Crew Operations Manual", "operator": "Nord Wind Airlines", "documentNumber": "D632N001-55NRW", "revision": 10, "revisionDate": "2014-05-15", "sourceFileName": pdf.name, "sha256": digest, "pdfPageCount": 1702, "pdfPageNumbering": "1-based", "provenance": "user-supplied PDF; not included in repository", "extraction": "PyMuPDF positional text extraction; no interpolation; rendered-page visual checks; see docs/FCOM_757_NORDWIND.md"},
        "_units": {"massKg": "kg", "fl": "100 ft pressure altitude", "fuelFlowPerEngineKgH": "kg/h per engine", "totalFuelFlowIncrementKgH": "kg/h for aircraft", "epr": "dimensionless", "deltaEpr": "additive dimensionless EPR", "iasKt": "KIAS", "mach": "dimensionless", "tatC": "degrees C total air temperature", "distanceNm": "nautical miles", "timeMin": "minutes", "lbToKg": LB_TO_KG},
        "scope": {"referenceOnly": True, "productionMissionModified": False, "rb211DataPresent": False, "fixedMach080FuelFlowTablePresent": False, "normalClimbFuelTimeDistanceTablePresent": False, "normalDescentFuelTablePresent": False, "missingCellsPolicy": "listed explicitly, not zero and not interpolated", "flowUnitsEvidencePdfPages": [1003, 1004], "engineCount": 2},
        "fleet": [], "packets": [],
    }
    fleet_rows = [
        ("VQ-BBU", 29442, "NT376", "PW2040", False),
        ("VQ-BHR", 30046, "NT346", "PW2040", True),
        ("VQ-BJK", 29380, "NT378", "PW2040", False),
        ("VQ-BKM", 27203, "NE301", "PW2037", True),
        ("VQ-BTO", 30338, "NT358", "PW2037", False),
    ]
    for reg, serial, tabulation, engine, winglets in fleet_rows:
        result["fleet"].append({"registry": reg, "serialNumber": serial, "tabulationNumber": tabulation, "engine": engine, "engineCount": 2, "nominalTakeoffThrustPerEngineLbf": 37000 if engine == "PW2037" else 40000, "winglets": winglets, "evidence": {"modelIdentificationPdfPage": 5, "enginePdfPage": 1019, "wingletPdfPages": [175, 177, 745, 746, 747, 796]}})
    # Small fleet-specific metadata is transcribed from the visually checked
    # effectivity blocks; performance arrays above are extracted positionally.
    limits = {
        "VQ-BBU": ("KG", 113851, 113398, 89811, 83460),
        "VQ-BHR": ("KG", 116119, 115893, 95254, 85003),
        "VQ-BJK": ("KG", 113851, 113398, 89811, 83460),
        "VQ-BKM": ("KG", 116119, 115893, 89811, 84096),
        "VQ-BTO": ("LB", 256000, 255500, 198000, 184000),
    }
    for airplane in result["fleet"]:
        unit, taxi, takeoff, landing, zero_fuel = limits[airplane["registry"]]
        airplane["maximumWeightLimits"] = {"sourceUnit": unit, "sourceValues": {"taxi": taxi, "takeoff": takeoff, "landing": landing, "zeroFuel": zero_fuel}, "taxiKg": kg(taxi, unit), "takeoffKg": kg(takeoff, unit), "landingKg": kg(landing, unit), "zeroFuelKg": kg(zero_fuel, unit), "pdfPages": [153, 154], "alternateLimitsNotExtracted": True}
        if airplane["registry"] in ("VQ-BHR", "VQ-BKM", "VQ-BTO"):
            airplane["maximumWeightLimits"]["takeoffElevationCondition"] = {"fullLimitAtOrBelowFt": 1500, "linearDecreaseToFt": 5000, "sourceLimitAt5000Ft": 255000 if unit == "LB" else 115666}
        if airplane["registry"] == "VQ-BTO":
            airplane["fuelCapacity"] = {"sourceVolumeUnit": "US gal", "sourceMassUnit": "LB", "leftMainVolume": 2176, "rightMainVolume": 2176, "centerVolume": 6924, "totalVolume": 11276, "totalFuelMass": 75549, "densityLbPerUsGal": 6.7, "attitude": "level", "usableFuel": True, "pdfPage": 1561}
        else:
            larger = airplane["registry"] == "VQ-BHR"
            airplane["fuelCapacity"] = {"sourceVolumeUnit": "L", "sourceMassUnit": "KG", "leftMainVolume": 8430 if larger else 8213, "rightMainVolume": 8430 if larger else 8213, "centerVolume": 26543 if larger else 26257, "totalVolume": 43403 if larger else 42683, "totalFuelMass": 34848 if larger else 34270, "densityKgPerL": 0.8029, "attitude": "level", "usableFuel": True, "pdfPage": 1561 if larger else 1560}
    for packet in PACKETS:
        ident, model, engine, unit, regulatory, climb, maxalt, lrc, descent, holding, text_cruise, text_phases, apu, registrations = packet
        # Assert packet identity on every numerical source page before parsing.
        for n in (climb, maxalt, lrc, descent, holding, apu):
            assert f"{model}/{engine}" in doc[n - 1].get_text(), (ident, n)
        max_climb, bleeds = climb_and_bleed(doc[climb - 1], climb)
        p = {
            "id": ident, "model": model, "engine": engine, "winglets": model.endswith("W"),
            "regulatoryLabel": regulatory, "sourceWeightUnit": unit,
            "matchingFleetRegistrations": registrations,
            "fleetMapping": "engine and wing configuration established from 7.21.1 and 1.10/1.40; PI.20 versus PI.30 regulatory assignment to individual BBU/BJK not established" if ident in ("pi20-pw2040", "pi30-pw2040") else "correlation of explicit engine, wing and mass-unit effectivity; PI packet itself has model/engine header",
            "explanatorySources": [reference(doc[text_cruise - 1], text_cruise), reference(doc[text_phases - 1], text_phases)],
            "lrc": control_table(doc[lrc - 1], lrc, unit, True),
            "holding": control_table(doc[holding - 1], holding, unit, False),
            "descent": descent_table(doc[descent - 1], descent),
            "maxClimbEpr": max_climb, "bleedEprAdjustments": bleeds,
            "apuFuelIncrement": apu_table(doc[apu - 1], apu, unit),
            "lrcMaximumAltitude": maximum_altitude(doc[maxalt - 1], maxalt, unit),
        }
        result["packets"].append(p)
    result["systemsFacts"] = {
        "electrical": {"engineDrivenIdgCount": 2, "apuGeneratorCount": 1, "hydraulicDrivenBackupGenerator": True, "idgRatedKva": None, "actualFlightElectricalLoadKw": None, "externalPowerReferenceKva": 90, "externalPowerIsNotIdgRating": True, "pdfPages": [244, 973, 974, 976, 978]},
        "bleed": {"engineSources": ["low-pressure compressor at high engine power", "high-pressure compressor during descent and other low-power operation"], "uses": ["air conditioning", "pressurization", "engine starting", "wing and engine anti-ice", "hydraulic reservoir pressurization"], "apuBleedApproxMaxAltitudeFt": 17000, "bleedMassFlowKgS": None, "pdfPage": 851},
        "notProvided": ["operating empty weights for the five individual airplanes", "engine dry masses", "shaft-power extraction map", "engine thermodynamic design-cycle parameters"],
    }
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / "data/fcom/b757-nordwind-performance.json")
    args = parser.parse_args()
    data = extract(args.pdf)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(args.output)
    for p in data["packets"]:
        print(p["id"], {k: len(p[k]["rows"]) for k in ["lrc", "holding", "descent", "maxClimbEpr", "bleedEprAdjustments", "apuFuelIncrement", "lrcMaximumAltitude"]})


if __name__ == "__main__":
    main()
