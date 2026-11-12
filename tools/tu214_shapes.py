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

# The A321 uses the same A320-family AC nose (2-2-0) and cockpit outline.
# Use that established forebody as an explicit visual donor, scaled to the
# Tu-214 body (3.80m wide, 4.10m high). This is not Tu-214 manufacturer CAD.
# The shape joins its own unchanged cylindrical body at x=6.50m.
DONOR_FILE = ROOT / 'data/ac/a320-shapes.json'
donor = json.loads(DONOR_FILE.read_text(encoding='utf-8'))['ceo']['fuselage']
sections_original = [
  # x, upper y, lower y, half-width (from owner's Tu-204-200 3-view)
  (0.0, 0.0, 0.0, 0.0), (0.1, .270, -.245, .335),
  (.35, .540, -.500, .630), (.85, .820, -.780, .940),
  (1.7, 1.20, -1.15, 1.26), (2.7, 1.72, -1.56, 1.57),
  (3.5, 1.97, -1.90, 1.78), (4.5, 2.05, -2.05, 1.90),
  (6.0, 2.05, -2.05, 1.90), (10.0, 2.05, -2.05, 1.90),
  (16.0, 2.05, -2.05, 1.90), (21.0, 2.05, -2.05, 1.90),
  (28.0, 2.05, -2.05, 1.90), (34.0, 2.05, -2.05, 1.90),
  (37.0, 2.025, -1.99, 1.86), (39.0, 1.96, -1.65, 1.73),
  (41.0, 1.77, -1.27, 1.41), (42.7, 1.52, -.86, 1.09),
  (44.0, 1.22, -.42, .68), (45.22, .69, .30, .12),
]

def linear_at(xs, ys, x):
  if x <= xs[0]: return ys[0]
  if x >= xs[-1]: return ys[-1]
  for i in range(len(xs)-1):
    if xs[i] <= x <= xs[i+1]:
      t = (x-xs[i]) / (xs[i+1]-xs[i])
      return ys[i]*(1-t) + ys[i+1]*t
  raise ValueError('unreachable')

nose_stations = [round(i/20, 3) for i in range(131)]  # 0–6.5m
scales = [('top', HALF_H/2.069, HALF_H),
          ('bottom', HALF_H/2.073, -HALF_H),
          ('half_width', HALF_W/1.977, HALF_W)]
sections = []
for x in nose_stations:
  dims=[]
  for key,scale,limit in scales:
    if x == 0:
      v=-0.7 if key != 'half_width' else 0.0
    elif x == 6.5: v=limit
    else:
      v=linear_at(donor['x'],donor[key],x)*scale
      # A320 AC has an isolated lower-fairing tracing at 4.8–4.95m;
      # this is not a nose feature. Also suppress tiny shoulder overshoot,
      # so the Tu-214 forebody joins its cylindrical body without a ring.
      if key=='bottom':v=max(-HALF_H,v)
      if key=='top':v=min(HALF_H,v)
      if key=='half_width':v=min(HALF_W,v)
    dims.append(round(v,6))
  sections.append((x,*dims))
sections.extend(s for s in sections_original if s[0]>6.5)

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
  'modelStatus': 'Tu-214 own wing/tail/gear; visual forebody and glazing transferred from A321/A320 AC and scaled to Tu section, smooth cylinder join at x=6.5m; not Tu manufacturer CAD',
  'baseLengthM': L,
  'halfWidth': HALF_W, 'halfHeight': HALF_H,
  'fuselage': {
    'x':[v[0] for v in sections], 'top':[v[1] for v in sections],
    'bottom':[v[2] for v in sections], 'half_width':[v[3] for v in sections]},
  'section': {'deg': section_angles, 'r': radial},
  'features': features,
  # The A321-family five-sided windshield and multi-sided side glazing,
  # projected onto the transferred A321 nose. Visual reference only.
  'cockpit': {
    'windscreen': [[0.067274,0.863992],[0.690996,0.923441],[0.807284,0.483519],[0.141275,0.434969],[0.057663,0.483519]],
    'side': [
      [[1.88,0.415152],[2.229,0.857057],[2.654,0.860029],[2.654,0.305172],[2.551,0.305172]],
      [[2.654,0.305172],[2.654,0.860029],[3.13,0.860029],[3.267,0.72825],[3.265,0.346786],[3.225,0.307153]],
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
