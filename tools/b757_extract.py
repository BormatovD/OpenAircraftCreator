"""Extract 757-200 geometry from Boeing D6-58327, Rev H (December 2024).

Usage: python3 tools/b757_extract.py /path/to/757_Rev_H.pdf
       python3 tools/b757_extract.py source.pdf --preview-dir /tmp/757-review

Offline tooling, using the same PyMuPDF/numpy dependencies as ac_extract.py and
ac_shapes.py. Only measured coordinates and provenance enter the repository.
The optional review plots require matplotlib; the source PDF is never copied.

Coordinates are metres: x aft from the body nose, y up from the cylindrical-body
axis, z to starboard. General arrangement is PDF page 20 (1-based), section 2.2.1.
Body length 46.97 m is distinct from overall length 47.32 m (fin overhang).
Blue aircraft paths are separated from black/grey dimensions. The PDF encodes
many strokes as filled triangles plus a stroked quadrilateral; use the latter's
centreline once, rather than counting the duplicated edges as aircraft geometry.
"""

import argparse
from collections import defaultdict
import hashlib
import json
import math
from pathlib import Path

import numpy as np
import pymupdf as fitz


BODY_LENGTH = 46.97
OVERALL_LENGTH = 47.32
BODY_WIDTH = 3.76
BODY_HEIGHT = 4.01
SPAN = 38.05
PAGE = 20
CLIPS = {
    "top": (164, 157, 425, 367),
    "side": (164, 383, 425, 463),
    "front": (226, 550, 435, 629),
}


def midpoint(a, b):
    return ((a.x + b.x) / 2, (a.y + b.y) / 2)


def bezier(a, b, c, d):
    return [tuple((1-t)**3*a[j] + 3*(1-t)**2*t*b[j] +
                  3*(1-t)*t*t*c[j] + t**3*d[j] for j in (0, 1))
            for t in np.linspace(0, 1, 21)]


def vector_paths(page, clip):
    out = []
    for index, drawing in enumerate(page.get_drawings()):
        color = drawing.get("color")
        if (drawing["type"] != "s" or not color or
                max(abs(a-b) for a, b in zip(color, (0, 0, 1))) > .05 or
                not fitz.Rect(clip).contains(drawing["rect"])):
            continue
        current = []
        for item in drawing["items"]:
            if item[0] == "l":
                points = [tuple(item[1]), tuple(item[2])]
            elif item[0] == "c":
                points = bezier(*item[1:5])
            elif item[0] == "qu":
                q = item[1]
                if (drawing.get("width") or 0) > .5:
                    # Keep the source ordering: tiny curved-stroke segments can
                    # be shorter than the pen width, so longest-axis is wrong.
                    points = [midpoint(q.ul, q.ll), midpoint(q.ur, q.lr)]
                else:
                    points = list(map(tuple, (q.ul, q.ur, q.lr, q.ll, q.ul)))
            elif item[0] == "re":
                r = item[1]
                if min(r.width, r.height) < .75 and max(r.width, r.height) > 2:
                    points = ([(r.x0, (r.y0+r.y1)/2), (r.x1, (r.y0+r.y1)/2)]
                              if r.width > r.height else
                              [((r.x0+r.x1)/2, r.y0), ((r.x0+r.x1)/2, r.y1)])
                else:
                    points = list(map(tuple, (r.tl, r.tr, r.br, r.bl, r.tl)))
            else:
                continue
            if current and math.dist(current[-1], points[0]) < .001:
                current.extend(points[1:])
            else:
                if current:
                    out.append({"id": index, "points": current, "width": drawing.get("width") or 0})
                current = points
        if current:
            out.append({"id": index, "points": current, "width": drawing.get("width") or 0})
    return out


def components(paths, tolerance=.06):
    parent = list(range(len(paths)))
    grid = defaultdict(list)

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i, path in enumerate(paths):
        for p in (path["points"][0], path["points"][-1]):
            key = tuple(round(v/tolerance) for v in p)
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    for j, q in grid[(key[0]+dx, key[1]+dy)]:
                        if math.dist(p, q) < tolerance:
                            parent[find(i)] = find(j)
            grid[key].append((i, p))
    groups = defaultdict(list)
    for i, path in enumerate(paths):
        groups[find(i)].append(path)
    return list(groups.values())


def points(paths):
    return np.array([p for path in paths for p in path["points"]])


def hits(paths, at, axis=0):
    out = []
    other = 1-axis
    for path in paths:
        for a, b in zip(path["points"], path["points"][1:]):
            if min(a[axis], b[axis]) <= at <= max(a[axis], b[axis]) and abs(b[axis]-a[axis]) > 1e-9:
                t = (at-a[axis])/(b[axis]-a[axis])
                out.append(a[other]+t*(b[other]-a[other]))
    return out


def fill_gaps(values, stations):
    a = np.asarray(values, dtype=float)
    ok = np.isfinite(a)
    if ok.sum() < 2:
        raise ValueError("Source selection has fewer than two usable contour stations")
    a[~ok] = np.interp(np.asarray(stations)[~ok], np.asarray(stations)[ok], a[ok])
    return a


def line(z, x):
    k, b = np.polyfit(z, x, 1)
    return {"slope": float(k), "x0": float(b), "sweep_deg": math.degrees(math.atan(k))}


def ordered_polygon(group):
    # Cockpit apertures are convex in these orthographic views.
    p = np.unique(np.round(points(group), 5), axis=0)
    c = p.mean(axis=0)
    return p[np.argsort(np.arctan2(p[:, 1]-c[1], p[:, 0]-c[0]))].tolist()


# Visual-only A321-family forebody donor. The Boeing drawing remains the authority
# for wing, tail, doors, engine stations, gear, masses and full fuselage dimensions.
# These five- and six-sided cabin window polygons are from A320-family AC, via
# web/scene/shapeSet.ts. The transfer is not a 757 manufacturer CAD cockpit.
A321_WINDSCREEN = [[.07,.872],[.719,.932],[.84,.488],[.147,.439],[.06,.488]]
A321_SIDE_GLAZING = [
    [[1.88,.419],[2.229,.865],[2.654,.868],[2.654,.308],[2.551,.308]],
    [[2.654,.308],[2.654,.868],[3.13,.868],[3.267,.735],[3.265,.35],[3.225,.31]],
]


def smooth_transfer_forebody(output, a320_shapes_path):
    """Blend the approved A321 nose into the Boeing 757 barrel without a join.

    x <= 4.0 m uses the A321 cross-section profile, scaled to the 757 body;
    4.0–8.5 m uses a C1 smoothstep to the traced Boeing body. At and aft of
    8.5 m, the original Boeing measurements remain exactly unchanged.
    """
    with open(a320_shapes_path, encoding='utf-8') as file:
        donor = json.load(file)['ceo']['fuselage']
    original = output['fuselage']
    x_src = np.asarray(original['x'], dtype=float)
    x_donor = np.asarray(donor['x'], dtype=float)
    x_new = np.unique(np.round(np.r_[x_src, np.arange(.05, 8.501, .05)], 6))
    keys = {'top': (BODY_HEIGHT/2)/2.069,
            'bottom': (BODY_HEIGHT/2)/2.073,
            'half_width': (BODY_WIDTH/2)/1.977}
    new_fus = {'x': x_new.tolist()}
    for key, scale in keys.items():
        original_v = np.interp(x_new, x_src, original[key])
        transplanted_v = np.interp(x_new, x_donor, donor[key]) * scale
        if key == 'top': transplanted_v = np.minimum(transplanted_v, BODY_HEIGHT/2)
        elif key == 'bottom': transplanted_v = np.maximum(transplanted_v, -BODY_HEIGHT/2)
        else: transplanted_v = np.minimum(transplanted_v, BODY_WIDTH/2)
        weight = np.clip((x_new - 4.0) / 4.5, 0, 1)
        weight = weight * weight * (3 - 2 * weight)
        blended = (1-weight)*transplanted_v + weight*original_v
        # The original trace's first point is intentionally replaced with the
        # smooth donor's tip, but tip still has zero width and height.
        new_fus[key] = blended.tolist()
    # The printed blue outline contains a small false roof dent near 8 m.
    # Preserve the underlying measured data aft of 9 m, but remove that
    # isolated dip in the visual forebody to avoid a visible junction ridge.
    forebody = x_new <= 9.0
    new_fus['top'] = np.where(forebody, np.maximum.accumulate(new_fus['top']), new_fus['top']).tolist()
    new_fus['bottom'] = np.where(forebody, np.minimum.accumulate(new_fus['bottom']), new_fus['bottom']).tolist()
    new_fus['half_width'] = np.where(forebody, np.maximum.accumulate(new_fus['half_width']), new_fus['half_width']).tolist()
    # Cross-axis donor scaling must not split the closed tip.
    tip_y = (new_fus['top'][0] + new_fus['bottom'][0]) / 2
    new_fus['top'][0] = new_fus['bottom'][0] = tip_y
    output['fuselage'] = new_fus
    y_scale = (BODY_HEIGHT/2) / 2.07
    z_scale = (BODY_WIDTH/2) / 1.975
    output['cockpit'] = {
        'windscreen': [[z*z_scale, y*y_scale] for z,y in A321_WINDSCREEN],
        'side': [[[x, y*y_scale] for x,y in poly] for poly in A321_SIDE_GLAZING],
    }
    output['_assumptions'].append(
        '757 forebody x=0–4.0m and cockpit glazing are an explicitly visual '
        'A321-family AC donor, scaled to the Boeing 3.76x4.01m fuselage; '
        'x=4.0–8.5m blends C1-smoothly to the Boeing dimensions; the '
        'isolated tracing artefact near 8m is removed. The aft body is unchanged. '
        'This is not a certified 757 nose geometry or a change to aerodynamic reference area.'
    )
    return output


def rounded(value):
    if isinstance(value, dict):
        return {k: rounded(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, np.ndarray)):
        return [rounded(v) for v in value]
    if isinstance(value, (float, np.floating)):
        if not math.isfinite(value):
            raise ValueError("Non-finite geometry value")
        return round(float(value), 6)
    if isinstance(value, np.integer):
        return int(value)
    return value


def extract(pdf):
    document = fitz.open(pdf)
    page = document[PAGE-1]
    if "2.2.1" not in page.get_text() or "757-200" not in page.get_text():
        raise ValueError("Expected the Rev H 757-200 general arrangement on PDF page 20")
    views = {name: vector_paths(page, clip) for name, clip in CLIPS.items()}
    top, side, front = (views[k] for k in ("top", "side", "front"))
    thick_top = [p for p in top if p["width"] > .5]
    thick_side = [p for p in side if p["width"] > .5]
    tp, sp, fp = map(points, (thick_top, thick_side, front))

    # Explicit, inspectable PDF anchors. The aft fin projects beyond the body.
    side_nose = sp[sp[:, 1] > 430, 0].min()
    side_tail = sp[(sp[:, 0] > 410) & (sp[:, 1] > 430), 0].max()
    sx = BODY_LENGTH/(side_tail-side_nose)
    cyl_top = sum(page.get_drawings()[11351]["rect"][j] for j in (1, 3))/2
    cyl_bottom = sum(page.get_drawings()[11771]["rect"][j] for j in (1, 3))/2
    body_sy = BODY_HEIGHT/(cyl_bottom-cyl_top)
    body_axis = (cyl_top+cyl_bottom)/2
    side_y = lambda y: (body_axis-y)*body_sy
    # Surfaces preserve isotropic drawing scale; their root meets the labelled body top.
    aircraft_y = lambda y: BODY_HEIGHT/2+(cyl_top-y)*sx

    # Top-view body tip excludes the narrow fin projection beyond x=420.3 pt.
    top_axis = 262.39019775390625
    body_top_points = tp[(np.abs(tp[:, 1]-top_axis) < 10.2) & (tp[:, 0] < 420.3)]
    top_nose = body_top_points[:, 0].min()
    # End of the drawn body centreline, before the thin fin projection.
    top_tail = 419.8315734863281
    top_sx = BODY_LENGTH/(top_tail-top_nose)
    top_sz = SPAN/(tp[:, 1].max()-tp[:, 1].min())
    top_x = lambda x: (x-top_nose)*top_sx
    top_z = lambda y: (top_axis-y)*top_sz

    front_axis = (fp[:, 0].min()+fp[:, 0].max())/2
    front_scale = SPAN/(fp[:, 0].max()-fp[:, 0].min())
    # Top of body, excluding the vertical fin; ground is the bottom of the tyres.
    front_body_top = fp[(np.abs(fp[:, 0]-front_axis) < 10) & (fp[:, 1] > 590.8), 1].min()
    front_ground = fp[fp[:, 1] > 620, 1].max()
    front_y = lambda y: BODY_HEIGHT/2+(front_body_top-y)*front_scale
    drawn_ground_y = front_y(front_ground)

    xs = np.unique(np.r_[0, .01, .025, np.arange(.05, 7, .1), np.arange(7, BODY_LENGTH, .25), BODY_LENGTH])
    ft, fb, fw = [], [], []
    for x in xs:
        yy = hits(thick_side, side_nose+x/sx)
        body = [y for y in yy if cyl_top-.12 <= y <= cyl_bottom+2.0]
        ft.append(side_y(min(body)) if body else np.nan)
        fb.append(side_y(max(body)) if body else np.nan)
        if x < 8:  # Real pointed nose, including the contour below its tip.
            nose = [y for y in yy if 425 < y < 450]
            if nose:
                ft[-1], fb[-1] = side_y(min(nose)), side_y(max(nose))
        if 15.8 < x < 33.5:  # The wing, fairing and nacelle obscure the cylindrical belly.
            fb[-1] = -BODY_HEIGHT/2
        zz = [abs(top_z(y)) for y in hits(thick_top, top_nose+x/top_sx)
              if abs(y-top_axis) <= 10.2]
        fw.append(max(zz) if zz else np.nan)
    ft, fb, fw = (fill_gaps(a, xs) for a in (ft, fb, fw))
    # Match labelled cylinder dimensions; this also removes line-weight bias.
    fw *= (BODY_WIDTH/2)/np.median(fw[(xs > 9) & (xs < 35)])
    fw = np.minimum(fw, BODY_WIDTH/2)
    ft = np.minimum(ft, BODY_HEIGHT/2)
    fb = np.maximum(fb, -BODY_HEIGHT/2)
    ft[(xs > 8) & (xs < 37)] = BODY_HEIGHT/2
    fb[(xs > 8) & (xs < 33.5)] = -BODY_HEIGHT/2
    nose = xs < 8
    ft[nose] = np.maximum.accumulate(ft[nose])
    fb[nose] = np.minimum.accumulate(fb[nose])
    tail = np.flatnonzero(xs >= 38)
    fw[tail] = np.minimum.accumulate(fw[tail])
    fb[tail] = np.maximum.accumulate(fb[tail])
    ft[tail] = np.minimum.accumulate(ft[tail])
    fw[0] = 0
    nose_tip_y = side_y(sp[np.argmin(sp[:, 0]), 1])
    ft[0] = fb[0] = nose_tip_y
    fuselage = {"x": xs, "top": ft, "bottom": fb, "half_width": fw}

    # Leading and trailing edges of the exposed wing, from distinct vector strokes.
    by_id = {p["id"]: p for p in top}
    def plan_line(ids):
        pp = points([by_id[i] for i in ids])
        return line(np.abs([top_z(y) for x, y in pp]), [top_x(x) for x, y in pp])
    wing_le = plan_line([6221])
    wing_te_outer = plan_line([6158])
    te_inner_x = top_x((308.36773681640625+309.06072998046875)/2)
    wing_te_inner = {"slope": 0.0, "x0": te_inner_x}
    kink = (te_inner_x-wing_te_outer["x0"])/wing_te_outer["slope"]
    tip_z = SPAN/2

    # Front wing upper/lower edges are independent of the planform extraction.
    front_by_id = {p["id"]: p for p in front}
    def front_line(ids):
        pp = points([front_by_id[i] for i in ids])
        return line((pp[:, 0]-front_axis)*front_scale, [front_y(y) for x, y in pp])
    wu, wl = front_line([1111]), front_line([1167])
    dihedral = math.degrees(math.atan((wu["slope"]+wl["slope"])/2))
    wing_root_y = (wu["x0"]+wl["x0"])/2
    wing = {"le": wing_le, "te_inner": wing_te_inner, "te_outer": wing_te_outer,
            "kink_z": kink, "tip_z": tip_z, "side_z": BODY_WIDTH/2,
            "root_y": wing_root_y, "dihedral_deg": dihedral,
            "thickness_root": .15, "thickness_tip": .10, "lines": [],
            "ref_span_m": SPAN, "ref_area_m2": 185.25}

    # Horizontal-tail planform: body and fin are inside |z|<2 m.
    hz, hle, hte = [], [], []
    for z in np.arange(2.15, 7.35, .1):
        xx = [top_x(x) for x in hits(thick_top, top_axis-z/top_sz, axis=1) if x > 375]
        if xx:
            hz.append(z); hle.append(min(xx)); hte.append(max(xx))
    htail_points = tp[(tp[:, 0] > 380) & (tp[:, 0] < 420)]
    drawn_htip = max(abs(top_z(y)) for x, y in htail_points)
    hz_front, hy_front = [], []
    for z in np.arange(2.2, 7.3, .1):
        yy = [y for y in hits(front, front_axis+z/front_scale) if 590 < y < 603]
        if yy:
            hz_front.append(z)
            hy_front.append(front_y((min(yy)+max(yy))/2))
    hdihedral = line(hz_front, hy_front)["sweep_deg"]
    htail = {"le": line(hz, hle), "te": line(hz, hte), "tip_z": 15.21/2,
             "dihedral_deg": hdihedral, "lines": []}

    # Vertical-tail envelope, including the dorsal fillet. Its upper outline is
    # unambiguous above the body roof; root TE continues the visible straight TE.
    fin = [p for p in thick_side if all(x > 350 for x, y in p["points"])]
    fin_pp = points(fin)
    fin_tip = aircraft_y(fin_pp[:, 1].min())
    fy = np.r_[np.arange(BODY_HEIGHT/2, fin_tip-.015, .08), fin_tip]
    fle, fte = [], []
    for y in fy:
        raw_y = cyl_top-(y-BODY_HEIGHT/2)/sx
        xx = [float((x-side_nose)*sx) for x in hits(fin, raw_y, axis=1)]
        fle.append(min(xx) if xx else np.nan)
        fte.append(max(xx) if xx else np.nan)
    fle, fte = fill_gaps(fle, fy), fill_gaps(fte, fy)
    mask = (fy > 4.2) & (fy < 8.6)
    vle, vte = line(fy[mask], fle[mask]), line(fy[mask], fte[mask])
    fte = np.minimum(fte, vte["slope"]*fy+vte["x0"])
    vtail = {"le": vle, "te": vte, "tip_y": fin_tip,
             "fillet_x": float(fle[0]), "table": {"y": fy, "le": fle, "te": fte},
             "lines": [], "ref_span_m": 7.4, "ref_area_m2": 34.37}

    groups = components(side)
    features = []
    for group in groups:
        p = points(group)
        x0, y0 = p.min(axis=0); x1, y1 = p.max(axis=0)
        width, height = x1-x0, y1-y0
        kind = None
        if 190 < x0 < 380 and 429 < y0 < 431 and 4 < width < 5 and 9 < height < 11:
            kind = "door"
        elif 270 < x0 < 290 and 431 < y0 < 433 and 3 < width < 4 and 4 < height < 6:
            kind = "exit"
        elif 198 < x0 < 365 and 433 < y0 < 434 and 1.5 < width < 1.8 and 1.7 < height < 2.1:
            kind = "window"
        if kind:
            features.append({"kind": kind, "x0": (x0-side_nose)*sx, "x1": (x1-side_nose)*sx,
                             "y0": side_y(y1), "y1": side_y(y0)})
    features.sort(key=lambda q: q["x0"])
    doors = [f for f in features if f["kind"] == "door"]
    if len(doors) != 3 or sum(f["kind"] == "exit" for f in features) != 2:
        raise ValueError("Expected the 757-200 overwing-exit configuration (three doors and two exits per side)")
    for door, centre, width in zip(doors, (5.05, 13.99, 38.23), (.84, .84, .76)):
        cy = (door["y0"]+door["y1"])/2
        door.update(x0=centre-width/2, x1=centre+width/2, y0=cy-1.83/2, y1=cy+1.83/2)
    right = [dict(f) for f in features]
    first_right = next(f for f in right if f["kind"] == "door")
    cy = (first_right["y0"]+first_right["y1"])/2
    first_right.update(x0=4.78-.76/2, x1=4.78+.76/2, y0=cy-1.65/2, y1=cy+1.65/2)
    windscreen = next(p for p in front if p["id"] == 85)["points"]
    side_windows = [next(g for g in groups if any(p["id"] == k for p in g)) for k in (9978, 9980)]
    cockpit = {"windscreen": [[(x-front_axis)*front_scale, front_y(y)] for x, y in windscreen[:-1]],
               "side": [[[(x-side_nose)*sx, side_y(y)] for x, y in ordered_polygon(g)] for g in side_windows]}

    # The front-view body is partly crossed by lifting surfaces and nose glazing.
    # Use the labelled section dimensions for a full elliptical visual section;
    # the longitudinal top/side contours themselves are measured, not inherited.
    degrees = np.arange(0, 361, 5)
    radians = np.radians(degrees)
    radii = 1/np.sqrt((np.cos(radians)/(BODY_WIDTH/2))**2+(np.sin(radians)/(BODY_HEIGHT/2))**2)
    section = {"deg": degrees, "r": radii, "fullTurn": True,
               "note": "Visual elliptical section constrained by labelled 3.76 x 4.01 m; not an extracted full structural section. PDF28 shows only the upper cabin section."}

    # A common installation axis is visible, while inlet station and width are
    # explicitly different for RR/PW. Longitudinal pod shapes remain parametric.
    engine_group = next(g for g in components(front) if any(p["id"] == 1999 for p in g))
    engine_front = points(engine_group)
    axis_y = front_y((engine_front[:, 1].min()+engine_front[:, 1].max())/2)
    # A general drawing is not a loading/attitude model. Select a feasible static
    # ground plane from the published A (body roof), K (fin) and L (nacelle)
    # clearance ranges, retaining the common illustrated engine-axis position.
    # This avoids treating a small orthographic drawing distortion as a clearance.
    ground_intervals = [(BODY_HEIGHT/2-6.45, BODY_HEIGHT/2-6.25),
                        (fin_tip-13.74, fin_tip-13.49)]
    ground_intervals += [(axis_y-width/2-.86, axis_y-width/2-.74) for width in (2.46, 2.69)]
    ground_low = max(a for a, b in ground_intervals)
    ground_high = min(b for a, b in ground_intervals)
    if ground_low > ground_high:
        raise ValueError("The traced installation has no pose satisfying the labelled clearance ranges")
    ground_y = (ground_low+ground_high)/2
    nacelle = {"inlet_x": 16.84, "axis_z": 6.48, "axis_y": axis_y,
               "ref_length_m": 5.50, "clearance_m": axis_y-2.46/2-ground_y}
    nacelles = {
        "RB211": {**nacelle, "width_m": 2.46},
        "PW2000": {**nacelle, "inlet_x": 16.61, "width_m": 2.69, "ref_length_m": 6.05,
                   "clearance_m": axis_y-2.69/2-ground_y},
    }
    gear = {"noseX": 5.89, "wheelbaseM": 18.29, "mainZ": 7.32/2,
            "mainR": 40*.0254/2, "mainTireW": 14.5*.0254,
            "mainWheelGap": 34*.0254/2, "mainWheelCenterSpacingM": 34*.0254,
            "axleSpacingM": 45*.0254, "mainAxlesPerStrut": 2,
            "noseR": 31*.0254/2, "noseTireW": 13*.0254, "noseWheelGap": 24*.0254/2,
            "noseLegM": -BODY_HEIGHT/2-ground_y-31*.0254/2,
            "retractDeg": 85, "rakeDeg": 0}

    xx = np.linspace(0, tip_z, 500)
    le = wing_le["slope"]*xx+wing_le["x0"]
    te = np.maximum(te_inner_x, wing_te_outer["slope"]*xx+wing_te_outer["x0"])
    drawn_area = 2*float(np.trapezoid(te-le, xx))
    source = {
        "document": "Boeing D6-58327, 757 Airplane Characteristics for Airport Planning",
        "revision": "H", "date": "2024-12", "filename": pdf.name,
        "sha256": hashlib.sha256(pdf.read_bytes()).hexdigest(),
        "catalogUrl": "https://www.boeing.com/commercial/airports/plan-manuals",
        "pages": [{"pdfPage": 20, "section": "2.2.1", "printedPage": "2-10", "use": "three orthographic vector views and labelled dimensions"},
                  {"pdfPage": 22, "section": "2.3.1", "printedPage": "2-12", "use": "clearance range and exit configuration"},
                  {"pdfPage": 28, "section": "2.5", "printedPage": "2-18", "use": "labelled exterior width; upper cabin section only"},
                  {"pdfPage": 31, "section": "2.7.1", "printedPage": "2-21", "use": "door centres and sizes, left/right difference"},
                  {"pdfPage": 117, "section": "7.2", "printedPage": "7-5", "use": "labelled bogie dimensions and tyre sizes; diagram NOT TO SCALE"}],
        "configuration": "757-200 passenger, three main doors plus two overwing exits on each side; no optional early-production bulk cargo door",
        "method": "Blue vector stroke centrelines; black/grey dimensions excluded. Visible contour envelopes, straight-edge fits and explicit labelled dimensions.",
        "vectorPathCounts": {name: len(paths) for name, paths in views.items()},
        "calibration": {"sideXMetresPerPt": sx, "bodyYMetresPerPt": body_sy,
                        "topXMetresPerPt": top_sx, "topZMetresPerPt": top_sz,
                        "frontMetresPerPt": front_scale,
                        "sideNosePt": side_nose, "sideBodyTailPt": side_tail,
                        "sideCylinderTopPt": cyl_top, "sideCylinderBottomPt": cyl_bottom,
                        "topNosePt": top_nose, "topBodyTailPt": top_tail, "topAxisPt": top_axis,
                        "frontAxisPt": front_axis, "frontBodyTopPt": front_body_top, "frontGroundPt": front_ground},
    }
    cargo = []
    for path_id, centre, width, height in ((10428, 10.95, 1.40, 1.08), (10436, 31.78, 1.40, 1.14)):
        group = next(g for g in groups if any(p["id"] == path_id for p in g))
        pp = points(group)
        cy = side_y((pp[:, 1].min()+pp[:, 1].max())/2)
        cargo.append([centre-width/2, width, cy-height/2, cy+height/2])
    output = {
        "_source": source,
        "_units": {"coordinates": "metres", "x": "aft from body nose", "y": "up from cylindrical-body axis", "z": "starboard from symmetry plane", "angles": "degrees", "lines": "normalised span/chord when populated"},
        "_assumptions": [
            "Body length 46.97 m is not overall length 47.32 m; the latter includes fin overhang.",
            "Printed dimensions take precedence over stroke thickness and drawing distortion. Only the body vertical profile is normalised to the labelled 4.01 m; surface geometry keeps its own drawing scale.",
            "The belly obscured by wing/nacelle/fairing is continued as the same cylindrical body. Tail width is constrained to taper monotonically where the stabiliser crosses the outline.",
            "A full structural cross-section is not supplied: an explicitly elliptical visual section uses the labelled width and height.",
            "Wing t/c 0.15/0.10, gear retraction 85 degrees, zero rake, and the fairing ellipsoid are visual engineering assumptions. Horizontal-tail dihedral is measured from the front view.",
            "Boeing cabin doors, window stations, and high-lift surfaces are retained; cockpit glazing and the first 8.5 m of the forebody have a separate visual A321-family donor. Panel lines remain approximate.",
            f"Straight-edge planform integration with an extrapolated centre section gives {drawn_area:.2f} m2, versus the aircraft's 185.25 m2 aerodynamic reference area. The measured drawing polygon is not used to replace the aerodynamic area.",
            "RR/PW inlet stations and widths are labelled; the illustrated installation axis is shared. The RB211 inlet-to-common-nozzle length (about 5.50 m) is estimated from the TF-FIW photograph. EASA E.061 III.4 gives 5.0359 m from the spinner nose to that nozzle. The PW2037 fan and core nozzle exits are estimated at 3.78 m and 6.05 m aft of its inlet from Delta N6706Q; the common Boeing side outline does not dimension these exits.",
            "The ground plane is one feasible static pose in the intersection of labelled A, K and L clearance ranges, retaining the illustrated common engine axis. It is not a model of load-dependent aircraft attitude. The unadjusted drawing ground ordinate is retained in validation metadata.",
            "PDF31 repeats 757-200 in its second table-column heading; the first column is used for 757-200, not the visibly longer dimensions in the second column.",
            "Opposite-side windows are mirrored because the general arrangement gives one side. The first right service door uses its own published station and dimensions. Bulk cargo door is optional early production and omitted.",
        ],
        "dimensions": {"bodyLengthM": BODY_LENGTH, "overallLengthM": OVERALL_LENGTH,
                       "spanM": SPAN, "fuselageWidthM": BODY_WIDTH, "fuselageHeightM": BODY_HEIGHT,
                       "horizontalTailSpanM": 15.21, "heightRangeM": [13.49, 13.74]},
        "baseLengthM": BODY_LENGTH, "halfHeight": BODY_HEIGHT/2, "halfWidth": BODY_WIDTH/2,
        "fuselage": fuselage, "section": section, "groundY": ground_y,
        "features": features, "featuresBySide": {"left": features, "right": right},
        "cockpit": cockpit, "wing": wing, "htail": htail, "vtail": vtail,
        "nacelle": nacelle, "nacelleByEngine": nacelles, "gear": gear,
        "fairing": {"x": 23.1, "y": -1.65, "sx": 7.6, "sy": .65, "sz": 2.05},
        "cabin": {"floorY": doors[0]["y0"], "fwdDoorEnd": doors[0]["x1"]+.6, "aftDoorX": doors[-1]["x0"]},
        "cargo": cargo,
        "titleX": [6.5, 13.2],
        "fin": {"box": {"x0": float(fle.min()), "x1": OVERALL_LENGTH, "y0": 1.5, "y1": fin_tip},
                "logo": {"cx": 43.5, "cy": 5.3, "r": 1.5}},
        "_validation": {"extractedHorizontalTailSpanBeforeLabelNormalisationM": 2*drawn_htip,
                        "extractedHeightM": fin_tip-ground_y,
                        "drawnGroundYBeforePoseSelectionM": drawn_ground_y,
                        "selectedGroundYIntervalM": [ground_low, ground_high],
                        "roofGroundClearanceM": BODY_HEIGHT/2-ground_y,
                        "nacelleGroundClearanceM": {"RB211": axis_y-2.46/2-ground_y, "PW2000": axis_y-2.69/2-ground_y},
                        "drawnPlanformAreaIncludingCentreM2": drawn_area,
                        "sideCylinderHeightBeforeLabelNormalisationM": (cyl_bottom-cyl_top)*sx,
                        "windowCountOnDrawnSide": sum(f["kind"] == "window" for f in features),
                        "doorCountPerSide": len(doors), "overwingExitCountPerSide": 2},
    }
    output = smooth_transfer_forebody(output, Path(__file__).resolve().parents[1] / 'data/ac/a320-shapes.json')
    return rounded(output), views


def preview(output, views, directory):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    directory.mkdir(parents=True, exist_ok=True)
    c = output["_source"]["calibration"]
    fig, axes = plt.subplots(3, 1, figsize=(14, 14), constrained_layout=True)
    for name, ax in zip(("top", "side", "front"), axes):
        for path in views[name]:
            p = np.array(path["points"])
            if name == "top":
                x = (p[:, 0]-c["topNosePt"])*c["topXMetresPerPt"]
                y = (c["topAxisPt"]-p[:, 1])*c["topZMetresPerPt"]
            elif name == "side":
                x = (p[:, 0]-c["sideNosePt"])*c["sideXMetresPerPt"]
                y = BODY_HEIGHT/2+(c["sideCylinderTopPt"]-p[:, 1])*c["sideXMetresPerPt"]
            else:
                x = (p[:, 0]-c["frontAxisPt"])*c["frontMetresPerPt"]
                y = BODY_HEIGHT/2+(c["frontBodyTopPt"]-p[:, 1])*c["frontMetresPerPt"]
            ax.plot(x, y, color="#9ab8cc", linewidth=.45)
        ax.set_aspect("equal"); ax.grid(alpha=.2); ax.set_title(name+" — source blue / extracted model red")
    f = output["fuselage"]
    axes[0].plot(f["x"], f["half_width"], "r-", lw=1)
    axes[0].plot(f["x"], -np.array(f["half_width"]), "r-", lw=1)
    for component in ("wing", "htail"):
        w = output[component]
        z = np.linspace(BODY_WIDTH/2, w["tip_z"], 100)
        le = w["le"]["slope"]*z+w["le"]["x0"]
        te = (np.maximum(w["te_inner"]["x0"], w["te_outer"]["slope"]*z+w["te_outer"]["x0"])
              if component == "wing" else w["te"]["slope"]*z+w["te"]["x0"])
        for sign in (-1, 1):
            axes[0].plot(le, sign*z, "r-", lw=1); axes[0].plot(te, sign*z, "r-", lw=1)
    for k in ("top", "bottom"):
        axes[1].plot(f["x"], f[k], "r-", lw=1)
    vt = output["vtail"]["table"]
    axes[1].plot(vt["le"], vt["y"], "r-", lw=1); axes[1].plot(vt["te"], vt["y"], "r-", lw=1)
    for feat in output["features"]:
        axes[1].plot([feat["x0"], feat["x1"], feat["x1"], feat["x0"], feat["x0"]],
                     [feat["y0"], feat["y0"], feat["y1"], feat["y1"], feat["y0"]], "r-", lw=.5)
    deg = np.radians(output["section"]["deg"]); r = np.array(output["section"]["r"])
    axes[2].plot(r*np.cos(deg), r*np.sin(deg), "r-", lw=1)
    w = output["wing"]; z = np.linspace(BODY_WIDTH/2, SPAN/2, 80)
    for sign in (-1, 1):
        axes[2].plot(sign*z, w["root_y"]+np.tan(np.radians(w["dihedral_deg"]))*z, "r-", lw=1)
    axes[2].axhline(output["groundY"], color="r", lw=.7)
    fig.savefig(directory/"b757-three-view-check.png", dpi=160)
    plt.close(fig)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1]/"data/ac/b757-shapes.json")
    parser.add_argument("--preview-dir", type=Path)
    args = parser.parse_args()
    output, views = extract(args.pdf)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, ensure_ascii=False, indent=2)+"\n")
    if args.preview_dir:
        preview(output, views, args.preview_dir)
    print(json.dumps({"output": str(args.output), "validation": output["_validation"],
                      "gear": output["gear"], "groundY": output["groundY"]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
