import { test } from "node:test";
import assert from "node:assert/strict";
import tu from "../data/ac/tu214-shapes.json" with { type: "json" };
import a320 from "../data/ac/a320-shapes.json" with { type: "json" };

type Surface = { x: number[]; top: number[]; bottom: number[]; half_width: number[] };
const a = a320.ceo.fuselage as Surface;
const f = tu.fuselage as Surface;
function interp(xs:number[], ys:number[], x:number):number {
  if(x<=xs[0])return ys[0];
  for(let i=1;i<xs.length;i++) if(x<=xs[i]) {
    const t=(x-xs[i-1])/(xs[i]-xs[i-1]);
    return ys[i-1]*(1-t)+ys[i]*t;
  }
  return ys[ys.length-1];
}

test("Tu-214 nose inherits A321-family silhouette at sampled stations, scaled to Tu section",()=>{
  for(const [key, scale, ceiling] of [
    ["top",2.05/2.069,2.05],
    ["bottom",2.05/2.073,-2.05],
    ["half_width",1.9/1.977,1.9],
  ] as const) {
    for(const x of [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4]) {
      const expected=interp(a.x,a[key],x)*scale;
      const got=interp(f.x,f[key],x);
      assert.ok(Math.abs(got-expected)<1e-4,`${key} at ${x}: got ${got} expected ${expected}`);
    }
    assert.ok(Math.abs(interp(f.x,f[key],6.5)-ceiling)<1e-6,`${key} joins body`);
  }
});

test("Tu-214 donor forebody has no false underbody protrusion or frame jump",()=>{
  for(let x=0.05;x<=6.50;x+=0.05) {
    assert.ok(interp(f.x,f.bottom,x)>=-2.050001,`bottom below cylindrical envelope at ${x}`);
    assert.ok(interp(f.x,f.half_width,x)<=1.900001,`width above cylindrical envelope at ${x}`);
    assert.ok(interp(f.x,f.top,x)<=2.050001,`top above cylindrical envelope at ${x}`);
  }
  // Join slopes are small, not a faceted transition.
  for(const key of ["top","bottom","half_width"] as const) {
    const a=interp(f.x,f[key],6.5),b=interp(f.x,f[key],6.25),c=interp(f.x,f[key],6.75);
    assert.ok(Math.abs(a-b)<0.005,`${key} join incoming smooth`);
    assert.ok(Math.abs(c-a)<0.005,`${key} join outgoing smooth`);
  }
});

test("Tu-214 forward and lateral windows are copied from five/six-sided A321 set",()=>{
  assert.equal(tu.cockpit.windscreen.length, 5);
  assert.deepEqual(tu.cockpit.side.map((x)=>x.length),[5,6]);
  for(const poly of [tu.cockpit.windscreen,...tu.cockpit.side]) {
    const signed=[];
    for(let i=0;i<poly.length;i++) {
      const p=poly[i],q=poly[(i+1)%poly.length],r=poly[(i+2)%poly.length];
      signed.push((q[0]-p[0])*(r[1]-q[1])-(q[1]-p[1])*(r[0]-q[0]));
    }
    assert.ok(signed.every(x=>x>=-1e-5)||signed.every(x=>x<=1e-5),"convex glazing");
  }
});
