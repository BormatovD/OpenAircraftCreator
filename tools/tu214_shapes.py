#!/usr/bin/env python3
"""Tu-214 parametric 3-view trace, expressed in metres.

Copyright-safe numeric abstraction of the user-supplied 1:250 Tu-204-200 drawing;
no image or third-party 3D mesh is embedded. See docs/TU214_MODEL.md for provenance.
Run: python3 tools/tu214_shapes.py
"""
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'data/ac/tu214-shapes.json'
L = 45.22  # fuselage body only; airplane including aft vertical tail projection = 46.14 m
HALF_W, HALF_H = 1.90, 2.05

# Main stations from side / top views; interstations are smooth linear interpolations.
# Two-dimensional section is an engineering ellipse; the source drawing has no body sections.
sections = [
  # x, upper y, lower y, half-width (all relative to cylindrical body axis)
  (0.000, 0.000, 0.000, 0.000),
  (0.100, 0.270, -0.245, 0.335),
  (0.350, 0.540, -0.500, 0.630),
  (0.850, 0.820, -0.780, 0.940),
  (1.700, 1.200, -1.150, 1.260),
  (2.700, 1.720, -1.560, 1.570),
  (3.500, 1.970, -1.900, 1.780),
  (4.500, 2.050, -2.050, 1.900),
  (6.000, 2.050, -2.050, 1.900),
  (10.000, 2.050, -2.050, 1.900),
  (16.000, 2.050, -2.050, 1.900),
  (21.000, 2.050, -2.050, 1.900),
  (28.000, 2.050, -2.050, 1.900),
  (34.000, 2.050, -2.050, 1.900),
  (37.000, 2.025, -1.990, 1.860),
  (39.000, 1.960, -1.650, 1.730),
  (41.000, 1.770, -1.270, 1.410),
  (42.700, 1.520, -0.860, 1.090),
  (44.000, 1.220, -0.420, 0.680),
  (45.220, 0.690, 0.300, 0.120),
]
section_angles = list(range(0, 361, 15))
radial = []
for deg in section_angles:
  ca, sa = math.cos(math.radians(deg)), math.sin(math.radians(deg))
  radial.append(round(1 / math.sqrt((ca / HALF_W)**2 + (sa / HALF_H)**2), 6))

# Rectangular feature bounding boxes are traced locations, not measured free openings.
features = []
def feature(kind, x, width, y0, y1):
  features.append({'kind': kind, 'x0': round(x, 3), 'x1': round(x+width, 3), 'y0': y0, 'y1': y1})

# Front and aft passenger entry points; overwing and intermediate positions are approximate.
for x in (4.83, 12.30, 35.78):
  feature('door', x, 0.88, -0.57, 1.36)
for x in (16.25, 19.05):
  feature('exit', x, 0.76, -0.18, 1.12)
# Windows at roughly half-metre intervals; omit near doors and the swept wing/root obscuration.
for n in range(64):
  x = 6.3 + 0.474*n
  if x > 36.4: break
  if any(f['kind'] in ('door','exit') and x+0.28 > f['x0']-0.10 and x < f['x1']+0.10 for f in features):
    continue
  feature('window', x, 0.270, 0.25, 0.63)
features.sort(key=lambda f:f['x0'])

# Wing: LE on a 30.8° ray, TE nearly square inboard then swept from the flap-track kink.
wing_le = {'slope': round(math.tan(math.radians(30.8)), 6), 'x0': 14.30}
wing_te_in = {'slope': 0.0, 'x0': 23.55}
wing_te_out = {'slope': 0.333, 'x0': 21.353} # joins inner TE at z = 6.6

# Tail: measured span 15.018m and 37.8° LE from user's drawing.
ht_le = {'slope': round(math.tan(math.radians(37.8)), 6), 'x0': 36.05}
ht_te = {'slope': 0.06, 'x0': 44.72}

# Fin from side view at approx 40.2° leading edge; shape tip and end radiused only in appearance.
# Start table slightly below body surface for no gap in assembled mesh.
fin_start_y, fin_tip_y = 2.00, 9.825
fin_le = {'slope': round(math.tan(math.radians(40.2)), 6), 'x0': 35.40}
fin_te = {'slope': 0.24, 'x0': round(46.14 - 0.24 * fin_tip_y, 6)}
fin_ys = [round(fin_start_y + (fin_tip_y - fin_start_y)*i/80, 6) for i in range(81)]
fin_les = [round(fin_le['slope']*y + fin_le['x0'], 6) for y in fin_ys]
fin_tes = [round(fin_te['slope']*y + fin_te['x0'], 6) for y in fin_ys]

shape = {
  'schema': 'aircraft-designer/shape-set/v1',
  'source': 'Tu-204-200 / Tu-214 three-view supplied by project owner, dimensions checked against UIGA 2024',
  'modelStatus': 'traced-planform; provisional doors/cockpit/sections/gear and installed nacelles',
  'baseLengthM': L,
  'halfWidth': HALF_W, 'halfHeight': HALF_H,
  'fuselage': {
    'x':[v[0] for v in sections], 'top':[v[1] for v in sections],
    'bottom':[v[2] for v in sections], 'half_width':[v[3] for v in sections]},
  'section': {'deg': section_angles, 'r': radial},
  'features': features,
  'cockpit': {
    'windscreen':[[0.15,0.65],[0.15,0.14],[0.87,0.14],[0.73,0.69]],
    'side': [
      [[1.55,0.69],[2.28,0.85],[2.38,0.32],[1.71,0.28]],
      [[2.45,0.88],[3.17,0.92],[3.25,0.34],[2.44,0.32]],
    ],
  },
  'wing': {
    'le':wing_le, 'te_inner':wing_te_in,'te_outer':wing_te_out,
    'kink_z':6.60, 'tip_z':20.92, 'side_z':HALF_W,
    'root_y':-1.15,'dihedral_deg':4.0,
    'thickness_root':0.145,'thickness_tip':0.095,'lines':[],
    'ref_span_m':41.84,'ref_area_m2':184.17,
  },
  'htail': {'le':ht_le,'te':ht_te,'tip_z':7.509,'dihedral_deg':5.0,'lines':[]},
  'vtail': {
    'le':fin_le,'te':fin_te,'tip_y':fin_tip_y,
    'table': {'y':fin_ys, 'le':fin_les,'te':fin_tes},
    'fillet_x':36.25, 'ref_span_m':7.775, 'ref_area_m2':34.295,'lines':[],
  },
  'fairing': {'x':19.7,'y':-1.54,'sx':5.2,'sy':0.75,'sz':2.10},
  'nacelle': {'inlet_x':14.35,'ref_length_m':5.70,'axis_z':6.05,'axis_y':-2.42,'clearance_m':0.79},
  'groundY':-4.39,
  'gear': {
    'noseX':5.15,'wheelbaseM':13.97,'mainZ':3.91,
    'mainR':0.61,'mainWheelGap':0.47,'mainTireW':0.41,
    'axleSpacingM':1.10,'retractDeg':84,'noseR':0.38,
    'noseTireW':0.30,'noseWheelGap':0.28,'noseLegM':2.0,'rakeDeg':5,
  },
  'cabin': {'floorY':-0.48,'fwdDoorEnd':5.71,'aftDoorX':35.78},
  'titleX':[6.5,13.6],
  'cargo': [[8.35,1.70,-1.84,-0.75],[30.2,1.55,-1.82,-0.75]],
  'fin': {
    'box': {'x0':36.1,'x1':46.14,'y0':1.25,'y1':fin_tip_y+0.20},
    'logo': {'cx':42.0,'cy':5.65,'r':1.45},
  },
}
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(shape, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(f'{OUT} ({len(features)} features, {len(sections)} fuselage stations)')
