"""Extract A321 door reference data from the supplied July 2026 Airbus AC.

Usage: python3 tools/a321_doors_extract.py /path/to/aca32101-jul-2026.pdf
Requires PyMuPDF and matplotlib, as does ac_extract.py. No PDF is distributed.

Published location dimensions and clearances are transcribed separately from
the exterior outlines. The small side views are schematic: a published free-
aisle reference is not used as the centre of an exterior panel. Only the two
partially hidden door-3 outlines are reconstructed, explicitly in the output.
"""
from pathlib import Path
import argparse
import hashlib
import json

import pymupdf

from ac_extract import chain, drop_dimension_lines, polylines, side_view, transform


LENGTH_M = 44.51
HEIGHT_M = 4.14
LEFT_CLIPS = {114: (108, 180, 505, 290), 116: (100, 205, 506, 322)}
RIGHT_CLIPS = {114: (108, 420, 505, 526), 116: (100, 425, 506, 540)}


def bbox(pl):
    xs, ys = zip(*pl)
    return {"x0": min(xs), "x1": max(xs), "y0": min(ys), "y1": max(ys)}


def envelope(view, roi, min_width=0.5, min_height=0.8):
    """Join the visually identified outline fragments wholly inside an ROI.

    ROIs are model-coordinate rectangles, not an automatic door recognizer.
    Height/width thresholds exclude nearby cabin windows and annotation lines.
    """
    x0, x1, y0, y1 = roi
    selected = []
    for pl in view["lines"]:
        b = bbox(pl)
        if (x0 <= b["x0"] <= b["x1"] <= x1
                and y0 <= b["y0"] <= b["y1"] <= y1
                and b["x1"] - b["x0"] > min_width
                and b["y1"] - b["y0"] > min_height):
            selected.extend(pl)
    if not selected:
        raise ValueError(f"No door outline in {roi}")
    return bbox(selected)


def right_side_view(page, clip):
    """The lower right-hand view points nose-right; retain nose-based x."""
    lines, silhouettes = polylines(page, clip)
    xs = [x for pl in silhouettes for x, _ in pl]
    tail, nose = min(xs), max(xs)
    scale = LENGTH_M / (nose - tail)
    xm = nose - 0.45 * (nose - tail)
    hits = []
    for pl in silhouettes:
        for (ax, ay), (bx, by) in zip(pl, pl[1:]):
            if (ax - xm) * (bx - xm) <= 0 and ax != bx:
                hits.append(ay + (by - ay) * (xm - ax) / (bx - ax))
    axis = min(hits) + HEIGHT_M / 2 / scale
    to_model = lambda x, y: ((nose - x) * scale, (axis - y) * scale)
    lines, silhouettes = transform(lines, to_model), transform(silhouettes, to_model)
    return {"scale_m_per_pt": scale,
            "lines": chain(drop_dimension_lines(lines, silhouettes))}


def round_box(b):
    return {k: round(v, 4) for k, v in b.items()}


def opening(ident, kind, x, measured, page, clearance_page, width, height,
            *, sides=("L", "R"), reconstructed=None, optional=None):
    exterior = dict(measured)
    if reconstructed:
        exterior.update(reconstructed["edges"])
    geometry = {
        "method": "vector-outline-with-reconstructed-hidden-edge" if reconstructed else "vector-outline",
        "approximate": True,
        "longitudinalAlignment": "unshifted-nose-based-vector-view",
        "measuredCenterMinusLocationReferenceM": round((measured["x0"] + measured["x1"]) / 2 - x, 4),
    }
    if reconstructed:
        geometry["reconstruction"] = reconstructed["note"]
    result = {
        "id": ident,
        "kind": kind,
        "sides": list(sides),
        "locationFromNoseM": x,
        "locationReference": "center-of-free-aisle" if kind == "exit" else "published-door-location-reference-line",
        "exteriorBBox": round_box(exterior),
        "measuredExteriorBBox": round_box(measured),
        "geometry": geometry,
        "clearOpening": {
            "widthM": width,
            "heightM": height,
            "dimensionKind": "free-aisle-width-and-sectional-opening-height" if kind == "exit" else "clear-opening",
        },
        "sourcePages": {"location": page, "exterior": page, "clearance": clearance_page},
    }
    if optional:
        result["optionalInLayouts"] = optional
    return result


def extract(path):
    doc = pymupdf.open(path)
    if len(doc) != 471 or "A321" not in doc[113].get_text():
        raise ValueError("Expected the 471-page July 2026 A321 AC supplied for this extraction")
    left = {p: side_view(doc[p - 1], clip, LENGTH_M) for p, clip in LEFT_CLIPS.items()}
    right = {p: right_side_view(doc[p - 1], clip) for p, clip in RIGHT_CLIPS.items()}
    normal = left[114]
    acf = left[116]
    n1 = envelope(normal, (4.3, 5.9, -0.65, 1.7))
    n2 = envelope(normal, (13.2, 14.6, -0.65, 1.7))
    n3 = envelope(normal, (24.1, 25.5, -0.65, 1.7))
    n4 = envelope(normal, (35.7, 37.3, -0.65, 1.9))
    a1 = envelope(acf, (4.3, 5.9, -0.65, 1.7))
    aow1 = envelope(acf, (18.2, 19.2, -0.4, 1.2))
    aow2 = envelope(acf, (19.2, 20.1, -0.4, 1.2))
    a3 = envelope(acf, (26.3, 27.7, -0.65, 1.7))
    a4 = envelope(acf, (35.7, 37.3, -0.65, 1.9))
    emergency_panel_height = n2["y1"] - n2["y0"]
    standard = [
        opening("door1", "door", 5.02, n1, 114, 117, 0.81, 1.85),
        opening("forwardEmergency", "exit", 13.84, n2, 114, 118, 0.76, 1.52),
        opening("aftEmergency", "exit", 24.79, n3, 114, 118, 0.76, 1.52,
                reconstructed={"edges": {"y0": n3["y1"] - emergency_panel_height},
                    "note": "Lower edge hidden by the wing. Retain the visible upper edge and use the exterior height of the forward emergency exit on the same sheet; both exits have matching clear-opening dimensions on PDF 118."}),
        opening("door4", "door", 36.58, n4, 114, 120, 0.81, 1.85),
    ]
    acf_cabin = [
        opening("door1", "door", 5.04, a1, 116, 117, 0.81, 1.85),
        opening("forwardOverwing", "exit", 18.70, aow1, 116, 119, 0.57, 1.04),
        opening("aftOverwing", "exit", 19.54, aow2, 116, 119, 0.57, 1.04,
                optional=["twoClass206"]),
        opening("door3", "exit", 26.82, a3, 116, 119, 0.76, 1.52,
                reconstructed={"edges": {"y1": a3["y0"] + emergency_panel_height},
                    "note": "Upper edge partly hidden by the winglet. Retain the visible lower edge and use the exterior height of the standard forward emergency exit on PDF 114; PDF 119 gives the same clear-opening dimensions. This is a visualization reconstruction, not a published outer-panel dimension."}),
        opening("door4", "door", 36.47, a4, 116, 120, 0.81, 1.85),
    ]

    def cargo(page, positions):
        boxes = [envelope(right[page], roi, min_width=0.1, min_height=0.5)
                 for roi in [(7, 9.3, -2.2, -0.3), (28.5, 30.7, -2.2, -0.3), (32.4, 33.8, -2.1, -0.5)]]
        return [opening(ident, "cargo", x, box, page, clearance_page, w, h, sides=("R",))
                for ident, x, box, clearance_page, w, h in zip(
                    ("forwardCargo", "aftCargo", "bulkCargo"), positions, boxes,
                    (121 if page == 114 else 122, 123, 124), (1.82, 1.82, 0.95), (1.24, 1.23, 0.77))]

    pages = {
        67: ("2-2-0", 2, "General Aircraft Dimensions", "A321-100 A321-200"),
        68: ("2-2-0", 3, "General Aircraft Dimensions", "A321-100 A321-200"),
        96: ("2-4-1", 2, "Typical Single Class Interior Arrangement — 220 seats", "A321-100 A321-200 A321neo"),
        97: ("2-4-1", 3, "Typical Two Class Interior Arrangement — 185 seats", "A321-100 A321-200 A321neo"),
        98: ("2-4-1", 4, "Typical Single Class Interior Arrangement — 244 seats", "A321neo-ACF"),
        99: ("2-4-1", 5, "Typical Two Class Interior Arrangement — 206 seats", "A321neo-ACF A321neo-XLR"),
        113: ("2-7-0", 2, "Door Identification — FIGURE-2-7-0-991-004-A01", "A321-100 A321-200 A321neo"),
        114: ("2-7-0", 3, "Door Location — FIGURE-2-7-0-991-004-A01", "A321-100 A321-200 A321neo"),
        115: ("2-7-0", 4, "Door Identification — FIGURE-2-7-0-991-047-A01", "A321neo-ACF A321neo-XLR"),
        116: ("2-7-0", 5, "Door Location — FIGURE-2-7-0-991-047-A01", "A321neo-ACF A321neo-XLR"),
        117: ("2-7-0", 6, "Forward Passenger/Crew Doors — FIGURE-2-7-0-991-033-A01", "All listed A321 variants"),
        118: ("2-7-0", 7, "Emergency Exits — FIGURE-2-7-0-991-034-A01", "A321-100 A321-200 A321neo"),
        119: ("2-7-0", 8, "Emergency Exits — FIGURE-2-7-0-991-046-A01", "A321neo-ACF A321neo-XLR"),
        120: ("2-7-0", 9, "Aft Passenger/Crew Doors — FIGURE-2-7-0-991-035-A01", "All listed A321 variants"),
        121: ("2-7-0", 10, "Forward Cargo Compartment Door — FIGURE-2-7-0-991-036-A01", "A321-100 A321-200"),
        122: ("2-7-0", 11, "Forward Cargo Compartment Door — FIGURE-2-7-0-991-037-A01", "A321neo A321neo-ACF A321neo-XLR"),
        123: ("2-7-0", 12, "Aft Cargo Compartment Door — FIGURE-2-7-0-991-038-A01", "All listed A321 variants"),
        124: ("2-7-0", 13, "Bulk Cargo Compartment Door — FIGURE-2-7-0-991-039-A01", "All listed A321 variants"),
    }
    return {
        "schemaVersion": 1,
        "_source": "Airbus A321 Aircraft Characteristics — Airport and Maintenance Planning, July 2026, supplied PDF; dimensions and vector outlines, not aircraft operating limitations.",
        "source": {
            "filename": Path(path).name,
            "revisionDate": "2026-07-01",
            "sha256": hashlib.sha256(Path(path).read_bytes()).hexdigest(),
            "pdfPageCount": len(doc),
            "pageNumbering": "1-based PDF page numbers",
            "pages": {str(n): {"section": sec, "sectionPage": p, "title": title, "applicability": app}
                      for n, (sec, p, title, app) in pages.items()},
        },
        "coordinateSystem": {
            "unit": "m",
            "x": "From the tip of the nose, positive aft. Published location references and measured panel centres are separate quantities.",
            "y": "Up from the axis of the cylindrical fuselage; the upper cylindrical skin is +2.07 m. No ground or cabin-floor datum is used.",
            "lengthM": LENGTH_M,
            "fuselageHeightM": HEIGHT_M,
            "scaleSourcePdfPages": [67, 68],
            "exteriorBBox": "Measured in the unshifted vector side view. Hidden edges are reconstructed only where geometry.method says so. These are approximate outer panel boxes, not published clear-opening dimensions.",
            "leftViewExtraction": {str(p): {"clipPdfPoints": list(clip), "scaleMPerPoint": left[p]["scale_m_per_pt"]}
                                   for p, clip in LEFT_CLIPS.items()},
            "rightViewExtraction": {str(p): {"clipPdfPoints": list(clip), "scaleMPerPoint": right[p]["scale_m_per_pt"]}
                                    for p, clip in RIGHT_CLIPS.items()},
        },
        "defaults": {"a321ceo": "standard", "a321neo": "standard"},
        "limitations": [
            "The current repository A321ceo and A321neo definitions describe 220-seat conventional aircraft. ACF/XLR is a separate door configuration, not an automatic consequence of a neo engine.",
            "LR is not identified separately on these door sheets. Select a door configuration from the aircraft's confirmed configuration; the LR label alone is not used to infer one.",
            "No A319 geometry is inferred from this A321 source.",
            "An exterior-panel centre need not coincide with the centre of the free aisle. The vector views also have finite schematic accuracy; no per-door longitudinal recentering is performed.",
            "The ACF/XLR location sheet gives 5.04/36.47 m for passenger doors and 8.56/30.02 m for forward/aft cargo doors. Common clearance sheets retain 5.02/36.58 and 8.16/29.62 m. Published locationFromNoseM uses the variant-specific sheet 116; exteriorBBox preserves the drawing and exposes the discrepancy.",
            "AFT OVERWING EXIT is marked OPTIONAL in the 206-seat ACF/XLR example (PDF 99), not in the 244-seat ACF example (PDF 98). This data does not establish certification or passenger limits for every possible layout.",
        ],
        "variants": {
            "standard": {
                "appliesTo": ["A321-100", "A321-200", "A321neo"],
                "identificationPdfPage": 113,
                "cabinOpenings": standard,
                "cargoOpenings": cargo(114, (8.16, 29.62, 33.22)),
                "layouts": {
                    "singleClass220": {"pdfPage": 96, "optionalOpeningIds": []},
                    "twoClass185": {"pdfPage": 97, "optionalOpeningIds": []},
                },
                "notes": ["Forward cargo clearance is identical on PDF 121 (ceo) and PDF 122 (neo); engine clearances on those sheets differ and are not part of clearOpening."],
            },
            "acfXlr": {
                "appliesTo": ["A321neo-ACF", "A321neo-XLR"],
                "identificationPdfPage": 115,
                "cabinOpenings": acf_cabin,
                "cargoOpenings": cargo(116, (8.56, 30.02, 33.22)),
                "layouts": {
                    "singleClass244": {"pdfPage": 98, "appliesTo": ["A321neo-ACF"], "optionalOpeningIds": []},
                    "twoClass206": {"pdfPage": 99, "appliesTo": ["A321neo-ACF", "A321neo-XLR"], "optionalOpeningIds": ["aftOverwing"]},
                },
            },
        },
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf")
    parser.add_argument("--output", default=str(Path(__file__).resolve().parents[1] / "data/ac/a321-doors.json"))
    args = parser.parse_args()
    data = extract(args.pdf)
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for name, variant in data["variants"].items():
        print(f"{name}: {len(variant['cabinOpenings'])} paired cabin openings, {len(variant['cargoOpenings'])} right-side cargo openings")


if __name__ == "__main__":
    main()
