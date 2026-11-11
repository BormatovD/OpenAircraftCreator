#!/usr/bin/env python3
"""Extract diagnostic packets from the two supplied Boeing 737 sample manuals.

These PDFs explicitly describe themselves as examples of manual layout and
structure, not approved operational manuals.  This script preserves that status
and does not connect the resulting data to a production aircraft definition.

Usage (requires PyMuPDF):
  python tools/fcom_737_extract.py --ng-pdf /path/to/NG.pdf \
      --classic-pdf /path/to/Classic.pdf --audit-dir /path/to/audit

The hash-pinned text layer is read without OCR or interpolation.  Published
blank cells stay blank.  Every numerical table carries its own units and page
reference; FF/ENG is never silently converted into total aircraft fuel flow.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path

import fitz


SOURCES = {
    "ng-2008": {
        "filename": "_737-TBC_OM_TBC_C_080515_V1V2_B8P-C.pdf",
        "sha256": "47445fbc4dd0f6d6a96c221aa96c12d7aac4ede26778997d82188afb16c72cac",
        "pageCount": 2358,
        "documentId": "D6-27370-TBC",
        "title": "737-600/-700/-800/-900 Flight Crew Operations Manual",
        "revision": 22,
        "revisionDate": "2008-05-15",
        "output": "b737-800-cfm56-7b26-sample-2008.json",
    },
    "classic-2007": {
        "filename": "737-300-400-500 Flight Crew Operational Manual.pdf",
        "sha256": "d3cc1e01c8062c6a87f69e1542a4f591a71da7d594be6731c57f22ef6fbf9f7e",
        "pageCount": 1098,
        "documentId": "D6-27370-400E-TBCE",
        "title": "737-300/-400/-500 Flight Crew Operations Manual",
        "revision": 20,
        "revisionDate": "2007-12-07",
        "output": "b737-300-cfm56-3-22k-sample-2007.json",
    },
}
NUMBER = re.compile(r"^-?(?:\d+(?:\.\d+)?|\.\d+)$")
DATE = re.compile(r"\b(?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, \d{4}\b")
NG_MASSES_T = list(range(85, 39, -5))
HOLD_ALTS_NG = [1500, 5000, 10000, 15000, 20000, 25000, 30000, 35000, 41000]
HOLD_ALTS_CLASSIC = HOLD_ALTS_NG[:-1] + [37000]
HOLD_SCHEDULE = "FMC holding: higher of maximum-endurance speed and flaps-up maneuvering speed"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def numbers(text):
    ls = [line.strip() for line in text.strip().splitlines()]
    require(all(NUMBER.fullmatch(line) for line in ls), f"Unexpected non-numeric row: {ls}")
    return [float(line) for line in ls]


def kg(thousands):
    return round(thousands * 1000)


def minutes(text):
    require(re.fullmatch(r"\d+:\d{2}", text) is not None, f"Invalid time {text}")
    h, m = map(int, text.split(":"))
    require(m < 60, f"Invalid minute field {text}")
    return h * 60 + m


def between(text, first, last):
    return text.split(first, 1)[1].split(last, 1)[0]


def page_ref(doc, page_number, expected_code=None):
    text = doc[page_number - 1].get_text()
    codes = re.findall(r"\b(?:P[DI]\.(?:TOC\.)?)?\d+\.\d+\b|\bPD\.TOC\.\d+\b", text)
    dates = DATE.findall(text)
    require(dates, f"No printed date on PDF {page_number}")
    if expected_code:
        require(expected_code in text, f"Wrong page code on PDF {page_number}: {expected_code}")
        code = expected_code
    else:
        require(codes, f"No printed page code on PDF {page_number}")
        code = codes[0]
    return {"pdfPage": page_number, "pageCode": code, "pageDate": dates[-1]}


def page_text(doc, page_number, aircraft):
    text = doc[page_number - 1].get_text()
    require(aircraft in text, f"Wrong applicability on PDF {page_number}")
    return text


def control_table(doc, page_number, lrc):
    text = page_text(doc, page_number, "737-800/CFM56-7B26")
    alts = list(range(25000, 41001, 2000)) if lrc else HOLD_ALTS_NG
    labels = ["%N1", "MACH", "KIAS", "FF/ENG"] if lrc else ["%N1", "KIAS", "FF/ENG"]
    ending = "Shaded area" if lrc else "This table includes"
    body = text.split(ending)[0]
    starts = list(re.finditer(r"(?m)^(\d+)\n%N1\n", body))
    require([int(m[1]) for m in starts] == NG_MASSES_T, f"Wrong weights on PDF {page_number}")
    rows, missing = [], []
    counts = [5, 6, 6, 7, 8, 8, 9, 9, 9, 9] if lrc else [7, 8, 8, 8, 8, 8, 9, 9, 9, 9]
    for i, start in enumerate(starts):
        mass = kg(int(start[1]))
        group = body[start.start(): starts[i + 1].start() if i + 1 < len(starts) else len(body)]
        columns = {}
        for li, label in enumerate(labels):
            part = group.split(label + "\n", 1)[1]
            if li + 1 < len(labels):
                part = part.split(labels[li + 1] + "\n", 1)[0]
            columns[label] = numbers(part)
            require(len(columns[label]) == counts[i], f"Wrong {label} cell count at {mass} kg / PDF {page_number}")
        # The blank region is on the right of every block, as checked visually.
        for col, alt in enumerate(alts):
            if col >= counts[i]:
                missing.append({"massKg": mass, "fl": alt / 100})
                continue
            row = {
                "massKg": mass, "fl": alt / 100,
                "n1Pct": columns["%N1"][col],
                "iasKt": int(columns["KIAS"][col]),
                "fuelFlowPerEngineKgH": int(columns["FF/ENG"][col]),
                "pdfPage": page_number,
            }
            if lrc:
                row["mach"] = columns["MACH"][col]
            rows.append(row)
    return {
        "source": page_ref(doc, page_number, "PI.31.2" if lrc else "PI.31.8"),
        "explanationSource": page_ref(doc, 890 if lrc else 891, "PI.37.6" if lrc else "PI.37.7"),
        "sourceMassUnit": "1000 kg", "sourceFuelFlowUnit": "kg/h per engine",
        "engineCount": 2, "massesKg": [kg(m) for m in NG_MASSES_T], "altitudesFt": alts,
        "conditions": {
            "speedSchedule": "Long Range Cruise" if lrc else HOLD_SCHEDULE,
            "temperature": "standard day" if lrc else "not separately specified on holding page",
            "engineState": "all engines operating",
            **({"optimumAltitudeShading": "not digitized"} if lrc else {
                "flaps": "up", "racetrackAllowanceIncluded": True,
                "racetrackAllowanceNote": "PI.31.8 says additional fuel; PD.31.5 specifies 5%. The two printed flow tables have independent rounding.",
            }),
        },
        "rows": rows, "missingCells": missing,
    }


def holding_planning(doc, page_number, classic):
    aircraft = "737-300/CFM56-3_22K" if classic else "737-800/CFM56-7B26"
    text = page_text(doc, page_number, aircraft)
    masses = list(range(62, 35, -2)) if classic else NG_MASSES_T
    alts = HOLD_ALTS_CLASSIC if classic else HOLD_ALTS_NG
    counts = [7, 7, 7, 8, 8, 8] + [9] * 8 if classic else [7] + [8] * 5 + [9] * 4
    body = between(text, "TOTAL FUEL FLOW (KG/HR)", "This table includes")
    vals = numbers(body.split("PRESSURE ALTITUDE (FT)\n")[1])
    require(vals[:9] == alts, "Wrong holding altitude axes")
    vals = vals[9:]
    rows, missing = [], []
    for mass, count in zip(masses, counts):
        require(vals.pop(0) == mass, f"Wrong holding mass {mass}")
        flows, vals = vals[:count], vals[count:]
        for col, alt in enumerate(alts):
            key = {"massKg": kg(mass), "fl": alt / 100}
            if col >= count:
                missing.append(key)
            else:
                rows.append({**key, "totalFuelFlowKgH": int(flows[col]), "pdfPage": page_number})
    require(not vals, "Unconsumed holding values")
    return {
        "source": page_ref(doc, page_number, "PD.11.6" if classic else "PD.31.5"),
        "explanationSource": page_ref(doc, 269 if classic else 493, "PD.13.3" if classic else "PD.34.3"),
        "sourceMassUnit": "1000 kg", "sourceFuelFlowUnit": "kg/h total airplane",
        "massesKg": [kg(m) for m in masses], "altitudesFt": alts,
        "conditions": {
            "flaps": "up", "speedSchedule": HOLD_SCHEDULE,
            "temperature": "not separately specified on holding page",
            "racetrackAllowanceIncludedPct": 5,
            "straightLevelInstruction": "Reduce printed table values by 5%, per the explanatory text; no adjustment applied to these stored rows.",
        },
        "rows": rows, "missingCells": missing,
    }


def trip_tables(doc, page_number, classic):
    text = page_text(doc, page_number, "737-300/CFM56-3_22K" if classic else "737-800/CFM56-7B26")
    reference_part, adjustments_part = text.split("REFERENCE FUEL REQUIRED", 1)
    body = reference_part.split("\n200\n", 1)[1]
    body = "200\n" + body
    starts = list(re.finditer(r"(?m)^(\d+)\n", body))
    dists = list(range(200, 3401 if classic else 5001, 200))
    require([int(s[1]) for s in starts] == dists, "Wrong trip distance axis")
    alts = [29000, 31000, 33000, 35000, 37000]
    rows, missing = [], []
    for i, start in enumerate(starts):
        dist = int(start[1])
        values = body[start.end(): starts[i + 1].start() if i + 1 < len(starts) else len(body)].strip().splitlines()
        count = 5 if dist <= (2400 if classic else 4000) else 4
        require(len(values) == count * 2, f"Wrong trip values at {dist} nm")
        for col, alt in enumerate(alts):
            key = {"airDistanceNm": dist, "fl": alt / 100}
            if col >= count:
                missing.append(key)
            else:
                rows.append({**key, "fuelKg": kg(float(values[col * 2])), "timeMin": minutes(values[col * 2 + 1]), "pdfPage": page_number})
    masses = list(range(30, 56, 5)) if classic else list(range(40, 71, 5))
    vals = numbers(between(adjustments_part, "LANDING WEIGHT (1000 KG)\n", "Based on"))
    require(vals[:len(masses)] == masses, "Wrong trip adjustment mass axis")
    vals = vals[len(masses):]
    adjustment_rows = []
    ref_fuels = list(range(2, 23 if classic else 33, 2))
    for fuel in ref_fuels:
        require(vals.pop(0) == fuel, "Wrong reference fuel axis")
        increments, vals = vals[:len(masses)], vals[len(masses):]
        for mass, increment in zip(masses, increments):
            adjustment_rows.append({"referenceFuelKg": kg(fuel), "landingMassKg": kg(mass), "fuelAdjustmentKg": kg(increment), "pdfPage": page_number})
    require(not vals, "Unconsumed trip adjustment values")
    profile = {
        "climbSpeedSchedule": "280 KIAS / M0.74" if classic else "280 KIAS / M0.78",
        "cruiseSpeedSchedule": "Long Range Cruise",
        "descentSpeedSchedule": "M0.74 / 250 KIAS" if classic else "M0.78 / 280 / 250 KIAS",
        "distance": "still-air equivalent air distance, not uncorrected ground distance",
        "fuelScope": "whole trip including climb, cruise and descent; not a phase-only table",
        "bleeds": "normal engine bleed for air conditioning (PD.13.2)" if classic else "not separately specified in selected PD enroute text",
    }
    ref = page_ref(doc, page_number, "PD.11.3" if classic else "PD.31.3")
    return ({
        "source": ref, "explanationSource": page_ref(doc, 268 if classic else 492, "PD.13.2" if classic else "PD.34.2"),
        "sourceFuelUnit": "1000 kg total airplane", "sourceTimeUnit": "hours:minutes",
        "conditions": profile, "altitudesFt": alts, "airDistancesNm": dists,
        "inferredReferenceLandingMassKg": 45000 if classic else 50000,
        "referenceMassInference": "The zero-adjustment column identifies the reference landing mass; it is an inference from this table, not a separately printed caption.",
        "rows": rows, "missingCells": missing,
    }, {
        "source": ref, "sourceFuelUnit": "1000 kg",
        "operation": "Add fuelAdjustmentKg to referenceFuelKg for the planned landing mass; values are not replacement total fuel.",
        "landingMassesKg": [kg(m) for m in masses], "referenceFuelsKg": [kg(f) for f in ref_fuels],
        "rows": adjustment_rows, "missingCells": [],
    })


def short_trip(doc, page_number, classic):
    text = page_text(doc, page_number, "737-300/CFM56-3_22K" if classic else "737-800/CFM56-7B26")
    body = between(text, "AIR DIST (NM)", "Based on")
    starts = list(re.finditer(r"(?m)^(\d+)\nFUEL \(1000\s+KG\)\n", body))
    require([int(s[1]) for s in starts] == list(range(50, 501, 50)), "Wrong short-trip distance axis")
    masses = list(range(30, 56, 5)) if classic else list(range(40, 71, 5))
    rows = []
    for i, start in enumerate(starts):
        group = body[start.end(): starts[i + 1].start() if i + 1 < len(starts) else len(body)]
        fuel_time, alt_part = re.split(r"ALT\s+\(FT\)\n", group)
        fuel_time = fuel_time.strip().splitlines()
        require(len(fuel_time) == len(masses) + 1, "Wrong short-trip fuel/time cell count")
        fuels, duration, alts = list(map(float, fuel_time[:-1])), minutes(fuel_time[-1]), numbers(alt_part)
        require(len(alts) == len(masses), "Wrong short-trip altitude cell count")
        for mass, fuel, alt in zip(masses, fuels, alts):
            rows.append({"airDistanceNm": int(start[1]), "landingMassKg": kg(mass), "fuelKg": kg(fuel), "timeMin": duration, "fl": alt / 100, "pdfPage": page_number})
    return {
        "source": page_ref(doc, page_number, "PD.11.5" if classic else "PD.31.5"),
        "sourceFuelUnit": "1000 kg total airplane", "sourceTimeUnit": "hours:minutes",
        "conditions": {
            "climbSpeedSchedule": "280 KIAS / M0.74" if classic else "280 KIAS / M0.78",
            "cruiseSpeedSchedule": "Long Range Cruise",
            "descentSpeedSchedule": "M0.74 / 250 KIAS" if classic else "M0.78 / 280 / 250 KIAS",
            "fuelScope": "whole trip including climb, cruise and descent",
            "altitude": "use the altitude printed for each distance and landing mass; it is not common to every cell",
        },
        "landingMassesKg": [kg(m) for m in masses], "rows": rows, "missingCells": [],
    }


def descent(doc):
    text = page_text(doc, 847, "737-800/CFM56-7B26")
    body = between(text, "PRESSURE \nALTITUDE \n(FT)", "Allowances")
    vals = numbers("41000\n" + body.split("\n41000\n")[1])
    alts = list(range(41000, 14999, -2000)) + [10000, 5000, 1500]
    require(len(vals) == len(alts) * 7, "Wrong descent table size")
    rows = []
    for i, alt in enumerate(alts):
        values = vals[i * 7:(i + 1) * 7]
        require(values[0] == alt, "Wrong descent altitude axis")
        for mass, distance in zip([40000, 50000, 60000, 70000], values[3:]):
            rows.append({"landingMassKg": mass, "fl": alt / 100, "timeMin": int(values[1]), "fuelKg": int(values[2]), "distanceNm": int(distance), "pdfPage": 847})
    return {
        "source": page_ref(doc, 847, "PI.31.7"), "explanationSource": page_ref(doc, 891, "PI.37.7"),
        "sourceFuelUnit": "kg total airplane", "sourceTimeUnit": "minutes",
        "conditions": {
            "speedSchedule": "M0.78 / 280 / 250 KIAS", "thrust": "flight idle", "windKt": 0,
            "straightInApproachIncluded": True, "approachConfiguration": "gear down and landing flaps at outer marker",
            "massDependence": "Published time and fuel columns are common to all four landing masses; only distance has mass columns.",
        },
        "landingMassesKg": [40000, 50000, 60000, 70000], "altitudesFt": alts,
        "rows": rows, "missingCells": [],
    }


def max_climb_n1(doc):
    text = page_text(doc, 836, "737-800/CFM56-7B26")
    vals = numbers("60\n" + between(text, "\n60\n", "BLEED CONFIGURATION"))
    alts = [0, 5000, 10000, 15000, 20000, 25000, 30000, 35000, 37000, 41000]
    tats = list(range(60, -41, -5))
    require(len(vals) == len(tats) * 11, "Wrong max climb N1 table size")
    rows = []
    for i, tat in enumerate(tats):
        group = vals[i * 11:(i + 1) * 11]
        require(group[0] == tat, "Wrong TAT axis")
        for alt, n1 in zip(alts, group[1:]):
            rows.append({"tatC": tat, "fl": alt / 100, "n1Pct": n1, "pdfPage": 836})
    engine = numbers(between(text, "ENGINE ANTI-ICE \n", "ENGINE & WING ANTI-ICE*"))
    both = numbers(between(text, "ENGINE & WING ANTI-ICE*\n", "*Dual bleed sources"))
    bleed_alts = [0, 10000, 20000, 30000, 35000, 41000]
    require(len(engine) == len(both) == 6, "Wrong anti-ice N1 correction size")
    corrections = [
        {"configuration": name, "fl": alt / 100, "n1AdjustmentPercentagePoints": value, "pdfPage": 836}
        for name, values in [("engineAntiIce", engine), ("engineAndWingAntiIceDualBleed", both)]
        for alt, value in zip(bleed_alts, values)
    ]
    return {
        "source": page_ref(doc, 836, "PI.30.40"), "explanationSource": page_ref(doc, 890, "PI.37.6"),
        "sourceUnit": "percent N1", "conditions": {"packs": "on or off", "antiIce": "off before listed corrections", "temperatureInput": "TAT, not OAT or ISA deviation"},
        "speedSchedule": [{"fl": alt / 100, **({"iasKt": 280} if alt <= 30000 else {"mach": 0.78})} for alt in alts],
        "altitudesFt": alts, "tatValuesC": tats, "rows": rows,
        "bleedCorrectionUnit": "N1 percentage points, not thrust percent or fuel-flow percent",
        "bleedCorrections": corrections,
        "limitation": "This is a rotational-speed setting table; it does not provide climb fuel, time, distance, mass flow or shaft power.",
    }


def apu_increment(doc):
    text = page_text(doc, 895, "737-800/CFM56-7B26")
    vals = numbers(between(text, "APU FUEL FLOW (KG/HR)\n", "May 15, 2008"))
    require(len(vals) == 16, "Wrong APU increment table size")
    return {
        "source": page_ref(doc, 895, "PI.37.11"),
        "allEngineCrossReference": page_ref(doc, 891, "PI.37.7"),
        "sourceUnit": "kg/h increment for the airplane",
        "conditions": {
            "apu": "operating during flight",
            "includesApuFuelAndDoorDrag": True,
            "scope": "Printed in engine-inoperative text; all-engine PI.37.7 explicitly refers to this same table.",
        },
        "rows": [{"fl": vals[i] * 10, "fuelFlowIncrementKgH": int(vals[i + 1]), "pdfPage": 895} for i in range(0, len(vals), 2)],
        "limitation": "Not a measurement of engine shaft-power extraction or a normal air-conditioning bleed penalty.",
    }


def critical_fuel_corrections(doc, classic):
    pages = [257, 258] if classic else [478, 479]
    result = []
    for i, page in enumerate(pages):
        text = page_text(doc, page, "737-300/CFM56-3_22K" if classic else "737-800/CFM56-7B26")
        temperature = float(re.search(r"Increase fuel required ([\d.]+)%", text)[1])
        icing = int(re.search(r"If icing conditions exist, increase fuel (?:required )?by (\d+)%", text)[1])
        row = {
            "source": page_ref(doc, page, f"PD.11.{9 + i}" if classic else f"PD.31.{8 + i}"),
            "scope": "critical diversion reserve scenario only; not a normal cruise bleed correction",
            "engineState": "all engines" if i == 0 else "one engine inoperative",
            "scenario": {
                "emergencyDescentToFt": 10000, "cruiseAltitudeFt": 10000,
                "descentIasKt": 250, "holdAltitudeFt": 1500, "holdingMinutes": 15,
                "missedApproaches": 1, "approachAndLandingIncluded": True,
                "windErrorAllowancePct": 5, "performanceDeteriorationAllowanceIncluded": False,
            },
            "hotDayFuelIncreasePctPer10CAboveIsa": temperature,
            "icingFuelIncreasePct": icing,
        }
        if not classic:
            row["icingComponentsPct"] = {
                "engineAndWingAntiIce": int(re.search(r"anti-ice on \((\d+)%\)", text)[1]),
                "iceOnUnheatedSurfaces": int(re.search(r"unheated surfaces \((\d+)%\)", text)[1]),
            }
        else:
            row["icingComponentsPct"] = None
            row["icingComponentsNote"] = "The Classic text gives only the combined effect of anti-ice and ice on unheated surfaces."
        result.append(row)
    return result


def build(doc, key):
    classic = key == "classic-2007"
    profile = "737-300/CFM56-3_22K" if classic else "737-800/CFM56-7B26"
    trip, adjustment = trip_tables(doc, 251 if classic else 473, classic)
    tables = {
        "tripReference": trip, "tripFuelAdjustment": adjustment,
        "shortTrip": short_trip(doc, 253 if classic else 475, classic),
        "holdingPlanning": holding_planning(doc, 254 if classic else 475, classic),
    }
    if not classic:
        tables.update({
            "lrcControl": control_table(doc, 842, True),
            "holdingInflight": control_table(doc, 848, False),
            "descent": descent(doc), "maxClimbN1": max_climb_n1(doc),
            "apuIncrement": apu_increment(doc),
        })
    source = {k: v for k, v in SOURCES[key].items() if k != "output"}
    source.update({
        "coverPdfPage": 1, "sampleOnly": True, "approvedForOperationalUse": False,
        "qualification": "The cover says this material is provided solely as guidance on the layout and structure of a typical aircraft manual, has not been approved by any aviation administration, and must not be used for operation, use or maintenance of an aircraft.",
        "purposeHere": "source-separated engineering diagnostics, not an operational performance authority or automatic calibration target",
    })
    variants = (
        [("737-300", "CFM56-3_22K", "KG", "PD.10–13", 239),
         ("737-400", "CFM56-3_23.5K", "KG", "PD.20–23", 240),
         ("737-500", "CFM56-3_20K", "KG", "PD.30–33", 240)] if classic else
        [("737-600", "CFM56-7B22", "KG", "PD.10–14", 385),
         ("737-700", "CFM56-7B24", "LB", "PD.20–24", 385),
         ("737-800", "CFM56-7B26", "KG", "PD.30–34", 385),
         ("737-900", "CFM56-7B26", "LB", "PD.40–44", 385),
         ("737-900ERW", "CFM56-7B26", "KG", "PD.50–54", 385)]
    )
    inventory = []
    for aircraft, engine, unit, chapter, page in variants:
        require(f"{aircraft} {engine} {unit}" in doc[page - 1].get_text(), f"Variant inventory mismatch: {aircraft}")
        inventory.append({"aircraft": aircraft, "engine": engine, "sourceMassUnit": unit, "chapter": chapter, "tocPdfPage": page})
    packet = {
        "schemaVersion": 1, "source": source,
        "otherPerformanceSectionsInThisPdf": inventory,
        "applicability": {
            "tableHeader": profile, "massUnit": "kg", "authorityLabel": "FAA",
            "brakeCategory": None if classic else "C",
            "engineSuffixResolution": "22K thrust label does not uniquely establish CFM56-3B1 versus -3B2" if classic else "CFM56-7B26, not LEAP-1B / 737 MAX",
            "aircraftConfigurationLimit": "No registration-specific match, auxiliary-tank configuration or exact installed-power match to the current aircraft definition has been established.",
            "wingletStatus": "not established by the selected 737-300 header" if classic else "selected header is 737-800 without W; no explicit winglet applicability statement established",
            "connectedToRuntimeModel": False,
        },
        "tables": tables,
        "scopedCriticalFuelCorrections": critical_fuel_corrections(doc, classic),
        "coverageLimits": {
            "separateNormalClimbFuelTimeDistance": "not identified; integrated trip tables cannot uniquely separate climb fuel",
            "fixedMachCruiseFuelFlow": "not identified in the selected normal-flight data; the trip cruise profile is LRC",
            "shaftPowerExtractionKw": "no numerical mission shaft-load schedule identified",
            "normalAirConditioningBleedFuelPenaltyPct": "no isolated numerical normal-cruise penalty identified",
            **({"separateDescentFuelTimeDistance": "not present in this Classic Performance Dispatch-only packet", "lrcMachControl": "no Performance Inflight LRC control table in this Classic sample; existing b737-300-lrc.json is a different source and is unchanged"} if classic else {}),
        },
        "verification": {
            "extractor": "tools/fcom_737_extract.py", "reviewDate": "2026-11-11",
            "method": "Hash-pinned vector text, strict axes and cell counts; visual review of headers, units, layout, blank regions and numerical anchors. No OCR, interpolation, missing-cell fill or calibration.",
            "visuallyReviewedPdfPages": [1, 251, 253, 254, 257, 258] if classic else [1, 473, 475, 478, 479, 836, 842, 847, 848, 895],
        },
    }
    if classic:
        packet["engineArchitectureFacts"] = {
            "source": page_ref(doc, 607, "7.20.1"),
            "engineFamily": "CFM56-3", "rotors": 2, "boosterStages": 3,
            "lowPressureTurbineStages": 4, "gearboxDrive": "N2 rotor",
            "controls": "MEC schedules fuel; PMC refines it electronically",
            "cycleDataLimit": "This passage establishes topology, not BPR, OPR, turbine inlet temperature, component efficiencies or actual shaft extraction.",
        }
    return packet


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")


def save_audit(doc, key, packet, directory):
    refs = {}

    def collect(value):
        if isinstance(value, dict):
            if "pdfPage" in value and "pageCode" in value:
                refs[value["pdfPage"]] = value
            for child in value.values():
                collect(child)
        elif isinstance(value, list):
            for child in value:
                collect(child)

    collect(packet)
    extra = [(239, "PD.TOC.0.1"), (240, "PD.TOC.0.2"), (241, "PD.TOC.0.3"), (250, "PD.11.2"), (252, "PD.11.4"), (607, "7.20.1")] if key == "classic-2007" else [(385, "PD.TOC.1"), (472, "PD.31.2"), (474, "PD.31.4"), (841, "PI.31.1")]
    for page, code in extra:
        refs[page] = page_ref(doc, page, code)
    write_json(directory / f"{key}-page-map.json", {
        "source": packet["source"], "pdfPageNumbering": "one based",
        "pages": [refs[n] for n in sorted(refs)],
        "note": "The extra inventory/step-climb/maximum-altitude pages are mapped but their numerical tables are not part of this extraction.",
    })
    for number in sorted(set(refs) | {1}):
        page = doc[number - 1]
        (directory / f"{key}-page-{number}-text.txt").write_text(page.get_text())
        page.get_pixmap(matrix=fitz.Matrix(2.5, 2.5)).save(directory / f"{key}-page-{number}.png")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ng-pdf", type=Path, required=True)
    parser.add_argument("--classic-pdf", type=Path, required=True)
    parser.add_argument("--out-dir", type=Path, default=Path(__file__).resolve().parents[1] / "data" / "fcom")
    parser.add_argument("--audit-dir", type=Path)
    args = parser.parse_args()
    for key, path in [("ng-2008", args.ng_pdf), ("classic-2007", args.classic_pdf)]:
        info = SOURCES[key]
        require(hashlib.sha256(path.read_bytes()).hexdigest() == info["sha256"], f"Unexpected PDF SHA-256: {path}")
        with fitz.open(path) as doc:
            require(len(doc) == info["pageCount"], f"Wrong page count: {path}")
            cover = " ".join(doc[0].get_text().split())
            require("LAYOUT AND STRUCTURE" in cover and "NOT BEEN APPROVED" in cover, "Sample-manual provenance missing")
            packet = build(doc, key)
            out = args.out_dir / info["output"]
            write_json(out, packet)
            if args.audit_dir:
                args.audit_dir.mkdir(parents=True, exist_ok=True)
                save_audit(doc, key, packet, args.audit_dir)
            counts = {name: len(table["rows"]) for name, table in packet["tables"].items()}
            print(json.dumps({"file": str(out), "rows": counts}, ensure_ascii=False))


if __name__ == "__main__":
    main()
