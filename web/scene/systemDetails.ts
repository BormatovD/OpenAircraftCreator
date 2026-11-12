// Инженерные геометрические представления внутренних агрегатов.
// Эти детали — ТОЛЬКО визуальный уровень ATA-узлов massTree. Ни масса, ни баланс
// мощности, ни расчёт топлива здесь не задаются. Общая схема размещения —
// приближённая, а не маршрутная карта проводки конкретного серийного борта.
// Геометрии используют абсолютные координаты сцены (м); принадлежность системе
// остаётся у родительского Part. Объединяем детали по цвету/борту ради FPS.

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { SurfaceShape } from "./shapes.ts";
import { surfacePoint } from "./shapes.ts";

export type DetailTone = "detailSteel" | "detailDark" | "detailPanel" | "detailHydraulic" | "detailFuel" | "detailElectrical" | "detailAir";
export type Piece = THREE.BufferGeometry;
const v = (x: number, y: number, z: number) => new THREE.Vector3(x,y,z);
const tagged = <T extends Piece>(g: T, tone: DetailTone, side: -1 | 0 | 1 = 0): T => {
  g.userData.tone = tone;
  g.userData.side = side;
  return g;
};
const box = (a: THREE.Vector3, size: THREE.Vector3, tone: DetailTone, side: -1 | 0 | 1 = 0): Piece => {
  const g = new THREE.BoxGeometry(size.x, size.y, size.z);
  g.translate(a.x, a.y, a.z);
  return tagged(g, tone, side);
};
const sphere = (p: THREE.Vector3, size: THREE.Vector3, tone: DetailTone, side: -1 | 0 | 1 = 0): Piece => {
  const g = new THREE.SphereGeometry(1, 14, 10);
  g.scale(size.x,size.y,size.z);
  g.translate(p.x,p.y,p.z);
  return tagged(g,tone,side);
};
const cylinder = (a: THREE.Vector3, b: THREE.Vector3, radius: number, tone: DetailTone, side: -1 | 0 | 1 = 0, radial = 12): Piece => {
  const distance = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(radius,radius,Math.max(distance,0.001),radial);
  g.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(
    new THREE.Quaternion().setFromUnitVectors(v(0,1,0),b.clone().sub(a).normalize()),
  ));
  const p=a.clone().add(b).multiplyScalar(.5);
  g.translate(p.x,p.y,p.z);
  return tagged(g,tone,side);
};
const pipe = (points: THREE.Vector3[], r: number, tone: DetailTone, side: -1 | 0 | 1 = 0): Piece => {
  const curve = new THREE.CatmullRomCurve3(points, false, "centripetal");
  return tagged(new THREE.TubeGeometry(curve,Math.max(10,points.length*7),r,7,false),tone,side);
};
const ringX = (x:number,y:number,z:number,r:number,thick:number,tone:DetailTone,side:-1|0|1=0): Piece => {
  const g = new THREE.TorusGeometry(r,thick,7,20);
  g.rotateY(Math.PI/2); g.translate(x,y,z); return tagged(g,tone,side);
};

/** Свести сотни мелких корпусов/винтов к небольшому числу DrawCalls. */
export function compactDetails(geoms: Piece[]): Piece[] {
  const groups = new Map<string, Piece[]>();
  for (const g of geoms) {
    const key = `${g.userData.tone || "detailSteel"}:${g.userData.side || 0}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(g);
  }
  const out: Piece[] = [];
  for (const group of groups.values()) {
    if (group.length === 1) { out.push(group[0]); continue; }
    // BufferGeometryUtils requires the same attributes/index mode. All inputs are
    // Three primitive shapes with position, normal, uv; normalise to non-indexed.
    const copies = group.map((g) => g.index ? g.toNonIndexed() : g.clone());
    const merged = mergeGeometries(copies, false);
    for (const c of copies) c.dispose();
    if (!merged) { out.push(...group); continue; }
    merged.userData = { ...group[0].userData };
    for (const g of group) g.dispose();
    out.push(merged);
  }
  return out;
}

/** ATA 34: радиоблоки с направляющими, заменяемыми кассетами, вентиляцией и разъёмами. */
export function avionicsRack(x: number): Piece[] {
  const out:Piece[] = [];
  out.push(box(v(x+0.73,-1.12,0),v(1.5,.075,1.5),"detailDark"));
  for (const sd of [-1,1] as const) {
    out.push(box(v(x+0.73,-.78,sd*.78),v(1.52,.70,.048),"detailSteel"));
    for (let col=0;col<3;col++) {
      const z=sd*(.17+col*.22);
      const unitX=x+.45+(col%2)*.22;
      out.push(box(v(unitX,-.78,z),v(.45,.40,.18),"detailPanel"));
      // Блоки охлаждения (щели) и ручки съёмной аппаратуры.
      for (let i=0;i<4;i++)
        out.push(box(v(unitX-.14+i*.075,-.67,z+sd*.095),v(.035,.022,.012),"detailDark"));
      out.push(cylinder(v(unitX+.19,-.84,z+sd*.09),v(unitX+.19,-.68,z+sd*.09),.015,"detailSteel"));
    }
  }
  out.push(pipe([v(x+.5,-1.02,-.67),v(x+.1,-1.16,-.63),v(x+.07,-1.22,-.25)],.033,"detailElectrical"));
  return compactDetails(out);
}

/** ATA 31: приборная консоль со стеклянными индикаторами и крепежом. */
export function instrumentPanel(x:number): Piece[] {
  const out:Piece[] = [box(v(x+.22,.14,0),v(.46,.53,1.55),"detailDark")];
  for(const z of [-.49,0,.49]) {
    out.push(box(v(x-.018,.18,z),v(.020,.30,.37),"detailPanel"));
    out.push(box(v(x-.031,.18,z),v(.008,.25,.29),"detailElectrical"));
    for(const dz of [-.16,.16]) out.push(ringX(x-.04,-.035,z+dz,.023,.007,"detailSteel"));
  }
  return compactDetails(out);
}

/** ATA 24: силовой распределительный шкаф с выпрямителями, разъёмами и охлаждением. */
export function electricalBay(x:number): Piece[] {
  const out:Piece[]=[box(v(x+.68,-1.39,0),v(1.34,.53,1.20),"detailDark")];
  for(let i=0;i<3;i++) {
    const z=-.35+i*.35;
    out.push(box(v(x+.68,-1.09,z),v(.95,.075,.29),"detailSteel"));
    out.push(box(v(x+.67,-1.00,z),v(.64,.12,.23),"detailPanel"));
    for(let j=0;j<4;j++)
      out.push(box(v(x+.38+j*.19,-.986,z+.124),v(.12,.035,.018),"detailDark"));
    out.push(pipe([v(x+.16,-1.24,z),v(x+.07,-1.39,z),v(x+.16,-1.56,z+.12)],.018,"detailElectrical"));
  }
  for(const z of [-.57,.57]) out.push(box(v(x+.68,-1.52,z),v(1.5,.045,.04),"detailSteel"));
  return compactDetails(out);
}

/** ATA 29: гидравлическая насосная станция, аккумулирующие баллоны и линии к шасси. */
export function hydraulicBay(x:number): Piece[] {
  const out:Piece[]=[box(v(x+.7,-1.56,0),v(1.45,.07,1.42),"detailSteel")];
  for(const sd of [-1,1] as const) {
    const z=sd*.43;
    // Насос с электродвигателем и кольцами корпуса.
    out.push(cylinder(v(x+.20,-1.36,z),v(x+.74,-1.36,z),.17,"detailHydraulic"));
    for(const dx of [.2,.50,.74]) out.push(ringX(x+dx,-1.36,z,.17,.024,"detailSteel"));
    out.push(sphere(v(x+1.08,-1.29,z),v(.19,.27,.19),"detailHydraulic"));
    out.push(box(v(x+1.07,-1.58,z),v(.38,.08,.31),"detailDark"));
    out.push(pipe([v(x+.73,-1.36,z),v(x+.84,-1.18,z),v(x+1.08,-1.18,z)],.034,"detailHydraulic"));
    out.push(pipe([v(x+1.08,-1.43,z),v(x+1.34,-1.48,sd*.75),v(x+1.60,-1.49,sd*.8)],.024,"detailSteel"));
  }
  return compactDetails(out);
}

/** ATA 21: два ECS packs: теплообменники, торцевые коллекторы, воздуховоды и крепёж. */
export function airConditioningPacks(x:number): Piece[] {
  const out:Piece[]=[];
  for(const sd of [-1,1] as const) {
    const z=sd*1.02;
    out.push(box(v(x+1.1,-1.72,z),v(2.3,.09,.82),"detailSteel",sd));
    out.push(cylinder(v(x+.28,-1.56,z),v(x+1.54,-1.56,z),.23,"detailAir",sd));
    for(let i=0;i<11;i++) out.push(box(v(x+.43+i*.1,-1.56,z),v(.035,.50,.50),"detailPanel",sd));
    out.push(cylinder(v(x+1.66,-1.56,z),v(x+2.1,-1.56,z),.20,"detailDark",sd));
    out.push(pipe([v(x+.22,-1.56,z),v(x+.05,-1.35,z),v(x+.3,-1.12,sd*.6)],.075,"detailAir",sd));
    out.push(pipe([v(x+2.0,-1.55,z),v(x+2.35,-1.38,z),v(x+2.55,-1.22,sd*.6)],.066,"detailAir",sd));
  }
  return compactDetails(out);
}

/** ATA 28: по одной условной ветви подачи в каждой полуконсоли.
 *  Позиции следуют за текущей формой крыла, а не фиксированы по координатам A320. */
export function fuelDetails(
  wing: (side: 1|-1)=>SurfaceShape,
  xRoot:number,
): Piece[] {
  const out:Piece[]=[];
  for(const sd of [-1,1] as const) {
    const sh=wing(sd);
    const mid=(u:number, chord:number)=>surfacePoint(sh,u,chord,true).add(surfacePoint(sh,u,chord,false)).multiplyScalar(.5);
    const line=[.14,.28,.43,.60,.76].map((u)=>mid(u,.36));
    out.push(pipe(line,.033,"detailFuel",sd));
    for(const u of [.22,.48,.68]) {
      const p=mid(u,.40);
      const a=surfacePoint(sh,u,.40,true);
      const b=surfacePoint(sh,u,.40,false);
      const height=Math.max(.08,Math.abs(a.y-b.y)*.63);
      // Перегородка внутри бака; не новый силовой элемент в дереве масс.
      out.push(box(p,v(.44,height,.05),"detailPanel",sd));
    }
    for(const u of [.22,.65]) {
      const p=mid(u,.34);
      const c=v(p.x,p.y-.05,p.z);
      out.push(cylinder(c.clone().add(v(-.2,0,0)),c.clone().add(v(.2,0,0)),.11,"detailFuel",sd));
      out.push(ringX(c.x+.2,c.y,c.z,.12,.018,"detailSteel",sd));
    }
    const root=mid(.14,.36);
    out.push(pipe([root,v(xRoot+1.1,-1.0,sd*.9),v(xRoot+1.8,-1.35,sd*.35)],.046,"detailFuel",sd));
  }
  out.push(cylinder(v(xRoot+1.8,-1.38,-.65),v(xRoot+1.8,-1.38,.65),.12,"detailSteel"));
  return compactDetails(out);
}

/** Кольца корпуса ядра и трубки подачи топлива (локальная СК двигателя, ось +x). */
export function engineAccessories(lengthM:number, coreRadius:number): Piece[] {
  const out:Piece[]=[];
  for(const t of [.31,.53,.64,.89]) out.push(ringX(t*lengthM,0,0,coreRadius*(t>.8?.90:.85),.02,"detailSteel"));
  for(let k=0;k<6;k++) {
    const a=2*Math.PI*k/6;
    const y=coreRadius*.9*Math.sin(a),z=coreRadius*.9*Math.cos(a);
    out.push(pipe([v(.44*lengthM,y,z),v(.50*lengthM,y*1.1,z*1.1),v(.56*lengthM,y*.98,z*.98)],.012,"detailFuel"));
  }
  // Accessory gearbox housing below the core, not an invented third spool.
  out.push(box(v(.42*lengthM,-coreRadius*.98,0),v(.28*lengthM,.16,.27),"detailDark"));
  return compactDetails(out);
}
