import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { leap1a, leap1b } from "../web/scene/fleetLeap.ts";
import { applyReverserMotion } from "../web/scene/reverser757.ts";
import { engineCutaway } from "../web/scene/shapes.ts";

const near = (a: number, b: number, tolerance = 1e-5) => assert.ok(Math.abs(a-b) <= tolerance, `${a} ≠ ${b}`);

test("LEAP: complete inlet-to-exhaust envelope matches each declared reference length", () => {
  for (const pkg of [leap1a,leap1b]) for (const scale of [1,1.4]) {
    const parts = pkg.nacelle(scale,scale), spinnerX = .40*scale;
    const exhaust = pkg.exhaust(3.6*scale,.35*scale,{spinnerX,lengthK:scale,radiusK:scale});
    const bounds = new THREE.Box3();
    for (const part of parts) { part.geometry.computeBoundingBox(); bounds.union(part.geometry.boundingBox!); }
    for (const piece of exhaust) {
      piece.geometry.computeBoundingBox();
      bounds.union(piece.geometry.boundingBox!.clone().translate(new THREE.Vector3(spinnerX,0,0)));
    }
    near(bounds.min.x,0); near(bounds.max.x,pkg.referenceLength*scale);
    near(bounds.max.z-bounds.min.z,2*pkg.radius*scale);
    assert.equal(exhaust.filter(p=>p.geometry.name.includes("separate-core-nozzle")).length,1);
    assert.equal(exhaust.filter(p=>p.geometry.name.includes("centerbody-plug")).length,1);
    assert.equal(parts.filter(p=>p.id==="nozzle"||p.id==="plug").length,0,"primary exhaust has one owner, not a second nacelle shell");
    parts.forEach(p=>p.geometry.dispose()); exhaust.forEach(p=>p.geometry.dispose());
  }
});

test("LEAP-1B: two C-sleeves have exposed chevron valleys rather than a concealed extra ring", () => {
  const parts=leap1b.nacelle(1,1), material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide});
  const sleeves=parts.filter(p=>p.geometry.userData.reverserMotion?.role==="sleeve");
  assert.equal(sleeves.length,2);
  const all=parts.map(p=>new THREE.Mesh(p.geometry,material));
  const gap=.46, end=Math.PI-.055, pitch=(end-gap)/7;
  const valleyAngle=gap+pitch/2, tipAngle=gap+pitch;
  const ray=new THREE.Raycaster();
  for(const fraction of [0,.25,.5,.75,1]) {
    all.forEach(m=>{applyReverserMotion(m,fraction,new THREE.Vector3());m.updateMatrixWorld(true);});
    const x=3.10+.48*fraction;
    const cast=(angle:number)=>{ray.set(new THREE.Vector3(x,.80*Math.cos(angle),.80*Math.sin(angle)),new THREE.Vector3(0,Math.cos(angle),Math.sin(angle)));ray.far=.6;return ray.intersectObjects(all);};
    assert.equal(cast(valleyAngle).length,0,"serration valley is a real gap through every shell");
    assert.ok(cast(tipAngle).some(h=>h.object instanceof THREE.Mesh && h.object.geometry.userData.reverserMotion?.role==="sleeve"),"neighboring tooth remains present");
  }
  parts.forEach(p=>p.geometry.dispose());material.dispose();
});

test("LEAP-1B: chevrons stay in their own half and leave the stationary bridges fixed", () => {
  const v=new THREE.Vector3(),origin=new THREE.Vector3(11,-1.9,-4.83);
  for(const [kx,kr] of [[1,1],[1.4,1.2]]) {
    const parts=leap1b.nacelle(kx,kr);
    const moving=parts.filter(p=>p.geometry.userData.reverserMotion?.role==="sleeve");
    for(const [half,part] of moving.entries()) {
      const p=part.geometry.getAttribute("position");let maxX=-Infinity,minEdge=Infinity;
      for(let i=0;i<p.count;i++) {
        const theta=(Math.atan2(p.getZ(i),p.getY(i))+2*Math.PI)%(2*Math.PI);
        const [lo,hi]=half===0?[.46,Math.PI-.055]:[Math.PI+.055,2*Math.PI-.46];
        assert.ok(theta>=lo-1e-6&&theta<=hi+1e-6,"moving shell avoids both bridge sectors");
        maxX=Math.max(maxX,p.getX(i));
        if(p.getX(i)>3.04*kx)minEdge=Math.min(minEdge,p.getX(i));
      }
      near(maxX,3.14*kx);near(minEdge,3.055*kx);
      part.geometry.translate(origin.x,origin.y,origin.z);
      const mesh=new THREE.Mesh(part.geometry);
      for(const f of [0,.25,.5,.75,1,0]) {
        applyReverserMotion(mesh,f,origin);mesh.updateMatrixWorld(true);
        let endX=-Infinity;
        for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i).applyMatrix4(mesh.matrixWorld).sub(origin);assert.ok(v.toArray().every(Number.isFinite));endX=Math.max(endX,v.x);}
        near(endX,(3.14+.48*f)*kx);
      }
      near(mesh.position.length(),0);near(mesh.quaternion.angleTo(new THREE.Quaternion()),0);
    }
    for(const part of parts.filter(p=>p.geometry.userData.reverserMotion?.role==="frame")) {
      const mesh=new THREE.Mesh(part.geometry);applyReverserMotion(mesh,1,origin);
      near(mesh.position.length(),0);near(mesh.quaternion.angleTo(new THREE.Quaternion()),0);
    }
    parts.forEach(p=>p.geometry.dispose());
  }
});

test("LEAP: external nacelle and exhaust contain no duplicate surface triangles", () => {
  for(const pkg of [leap1a,leap1b]) {
    const parts=pkg.nacelle(1,1),spinnerX=.40,exhaust=pkg.exhaust(3.6,.35,{spinnerX,lengthK:1,radiusK:1});
    const geometries=[...parts.map(p=>p.geometry),...exhaust.map(p=>p.geometry.translate(spinnerX,0,0))];
    const triangles=new Set<string>(),v=new THREE.Vector3();
    for(const geometry of geometries) {
      const p=geometry.getAttribute("position"),index=geometry.getIndex();
      for(let i=0;i<(index?.count??p.count);i+=3) {
        const keys=[0,1,2].map(j=>{v.fromBufferAttribute(p,index?index.getX(i+j):i+j);return v.toArray().map(n=>Math.round(n*1e6)).join(",");});
        if(new Set(keys).size<3)continue;
        const key=keys.sort().join(";");assert.ok(!triangles.has(key),geometry.name+" duplicates a shell face");triangles.add(key);
      }
    }
    geometries.forEach(g=>g.dispose());
  }
});

test("LEAP: inlet fan faces retain circular clearance for their distinct fan diameters", () => {
  for(const [pkg,fanRadius] of [[leap1a,.99],[leap1b,.88]] as const) {
    const parts=pkg.nacelle(1,1),inlet=parts.find(p=>p.id==="inlet")!.geometry.getAttribute("position");
    const radii:number[]=[];
    for(let i=0;i<inlet.count;i++)if(Math.abs(inlet.getX(i)-pkg.fanFaceX)<1e-5)radii.push(Math.hypot(inlet.getY(i),inlet.getZ(i)));
    assert.ok(radii.length>=64);assert.ok(Math.min(...radii)>fanRadius);
    parts.forEach(p=>p.geometry.dispose());
  }
});

test("LEAP: actual separate TAPS heads number nineteen on 1A and eighteen on 1B", () => {
  for (const [pkg,count] of [[leap1a,19],[leap1b,18]] as const) {
    const L=3.6,rc=.40,pieces=pkg.combustor(L,rc);
    const heads=pieces.filter(p=>p.geometry.name.includes("injector-head-"));
    assert.equal(pkg.injectorCount,count);assert.equal(heads.length,count);
    const angles:number[]=[];
    for(const head of heads) {
      const pos=head.geometry.getAttribute("position"),box=new THREE.Box3(),v=new THREE.Vector3();
      // The circular front section independently locates each physical head,
      // without treating labels or an attribute count as proof of geometry.
      for(let i=0;i<pos.count;i++)if(Math.abs(pos.getX(i)-.524*L)<1e-6){v.fromBufferAttribute(pos,i);box.expandByPoint(v);}
      const centre=box.getCenter(new THREE.Vector3());
      near(Math.hypot(centre.y,centre.z),.63*rc);
      angles.push((Math.atan2(centre.z,centre.y)+2*Math.PI)%(2*Math.PI));
      assert.equal(head.spin,null);
    }
    const ordered=[...angles].sort((a,b)=>a-b);
    for(let i=0;i<count;i++)near((ordered[(i+1)%count]-ordered[i]+2*Math.PI)%(2*Math.PI),2*Math.PI/count);
    if(pkg===leap1a){near(Math.min(angles[0],2*Math.PI-angles[0]),0);near(angles[1],2*Math.PI-2*Math.PI/count);}
    else {
      // NTSB p8 Fig.2: #1/#18 flank the top; #5 and #14 are horizontal.
      near(angles[0],2*Math.PI-Math.PI/18);near(angles[17],Math.PI/18);
      near(angles[4],3*Math.PI/2);near(angles[13],Math.PI/2);
    }
    pieces.forEach(p=>p.geometry.dispose());
  }
});

test("LEAP: each head exposes two physically distinct fuel inlet collars", () => {
  const material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide});
  for(const pkg of [leap1a,leap1b]) {
    const L=3.6,rc=.4,pieces=pkg.combustor(L,rc),head=pieces.find(p=>p.geometry.name.endsWith("injector-head-1"))!;
    const mesh=new THREE.Mesh(head.geometry,material),ray=new THREE.Raycaster();
    if(pkg===leap1b)mesh.rotation.x=Math.PI/18;
    mesh.updateMatrixWorld(true);
    const cast=(z:number)=>{ray.set(new THREE.Vector3(.540*L,.99*rc,z),new THREE.Vector3(0,-1,0));ray.far=.10*rc;return ray.intersectObject(mesh);};
    assert.ok(cast(-.040*rc).length>0);assert.ok(cast(.040*rc).length>0);
    assert.equal(cast(0).length,0,"the two feed fittings retain a real gap between them");
    pieces.forEach(p=>p.geometry.dispose());
  }
  material.dispose();
});

test("LEAP: primary exhaust continues the open LPT annulus and the outer casing", () => {
  for(const pkg of [leap1a,leap1b])for(const scale of [1,1.4]) {
    const L=3.6*scale,rc=.35*scale,spinnerX=.40*scale,exit=.86*L;
    const pieces=pkg.exhaust(L,rc,{spinnerX,lengthK:scale,radiusK:scale});
    const outer=pieces.find(p=>p.geometry.name.includes("separate-core-nozzle"))!;
    const hub=pieces.find(p=>p.geometry.name.includes("centerbody-plug"))!;
    const boundary=pieces.find(p=>p.geometry.name.includes("bypass-inner-wall"))!;
    for(const [piece,radius] of [[outer,1.05*rc],[hub,.48*rc],[boundary,1.06*rc]] as const) {
      const position=piece.geometry.getAttribute("position"),radii:number[]=[];
      piece.geometry.computeBoundingBox();near(piece.geometry.boundingBox!.min.x,exit);
      for(let i=0;i<position.count;i++)if(Math.abs(position.getX(i)-exit)<1e-5)radii.push(Math.hypot(position.getY(i),position.getZ(i)));
      assert.ok(radii.length>16);radii.forEach(r=>near(r,radius));
    }
    // Compare to the actual last LP rotor instead of assuming a blade-tip
    // radius from the exhaust implementation itself.
    const bpr=pkg===leap1a?11:9;
    const engine=engineCutaway({fanStyle:pkg===leap1a?"leap1a":"leap1b",lengthM:L,
      fanDiameterM:2*rc*Math.sqrt((1+bpr)/1.6),bypassRatio:bpr,fanBlades:18,
      boosterStages:3,hpcStages:10,hptStages:2,lptStages:pkg===leap1a?7:5,spools:2},
      {spinnerX,lengthK:scale,radiusK:scale});
    const rotor=engine.find(p=>p.geometry.name==="lp-turbine-rotor")!.geometry;
    rotor.computeBoundingBox();outer.geometry.computeBoundingBox();
    assert.ok(outer.geometry.boundingBox!.min.x>rotor.boundingBox!.max.x,"exhaust starts behind the last working row");
    const blades=rotor.getAttribute("position");let tip=0;
    for(let i=0;i<blades.count;i++)tip=Math.max(tip,Math.hypot(blades.getY(i),blades.getZ(i)));
    assert.ok(tip<1.05*rc,"outer hot wall clears the real blade and shroud vertices");
    engine.forEach(p=>p.geometry.dispose());
    // A ray along the annulus just outside the hub has no artificial wall at
    // the exit or immediately behind it.
    const material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide});
    const meshes=pieces.map(p=>new THREE.Mesh(p.geometry,material));meshes.forEach(m=>m.updateMatrixWorld(true));
    const ray=new THREE.Raycaster(new THREE.Vector3(exit+1e-5,.75*rc,0),new THREE.Vector3(1,0,0),0,.025*L);
    assert.equal(ray.intersectObjects(meshes).length,0);
    const nacelle=pkg.nacelle(scale,scale),core=nacelle.find(p=>p.id==="coreCowl")!.geometry;
    core.computeBoundingBox();boundary.geometry.computeBoundingBox();
    assert.ok(boundary.geometry.boundingBox!.max.x+spinnerX>=core.boundingBox!.min.x-1e-5,"casing continuation reaches the exposed core cowl");
    pieces.forEach(p=>p.geometry.dispose());nacelle.forEach(p=>p.geometry.dispose());material.dispose();
  }
});
