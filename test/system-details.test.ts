import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { buildAircraft } from "../web/scene/aircraft.ts";
import { TU214_PS90A } from "../src/aircraft/tu214.ts";
import { A320CEO } from "../src/aircraft/a320.ts";
import { avionicsRack, instrumentPanel, electricalBay, hydraulicBay, airConditioningPacks } from "../web/scene/systemDetails.ts";

function inspect(geometry: THREE.BufferGeometry) {
  const pos=geometry.getAttribute("position");
  assert.ok(pos && pos.count>0);
  for(let i=0;i<pos.count;i++)
    assert.ok(Number.isFinite(pos.getX(i)+pos.getY(i)+pos.getZ(i)),"finite detail vertex");
}

test("ATA systems: detailed racks, pumps and packs replace single boxes", () => {
  for(const a of [avionicsRack(3),instrumentPanel(3),electricalBay(5.5),hydraulicBay(16),airConditioningPacks(17)]) {
    assert.ok(a.length>=2,"multiple physical materials rather than a monolithic cube");
    assert.ok(a.every(g=>typeof g.userData.tone==="string"));
    a.forEach(g=>{inspect(g);g.dispose();});
  }
});

test("A320 and Tu-214: each system keeps its ATA part and visibility for explode", () => {
  for(const def of [A320CEO,TU214_PS90A]) {
    const model=buildAircraft(def);
    for(const id of ["engines","fuel","avionics","hydraulics","electrical.generation","airConditioning","instruments"]) {
      const part=model.parts.get(id);
      assert.ok(part,`${id} belongs to same mass node`);
      let tones=0;
      part.group.traverse(o=>{
        if(o instanceof THREE.Mesh) {
          inspect(o.geometry);
          if(o.userData.tone) tones++;
          assert.equal(o.userData.partId,id);
        }
      });
      assert.ok(tones>0,`${id} must contain distinct visible internals`);
    }
    model.root.traverse(o=>{if(o instanceof THREE.Mesh) o.geometry.dispose();});
  }
});
