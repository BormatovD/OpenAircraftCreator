// Групповые формулы масс Raymer для транспортных самолётов
// (D. Raymer, Aircraft Design: A Conceptual Approach, гл. 15, «Cargo/Transport Weights»).
// Формулы в фунтах и футах; на входе и выходе — СИ. Это статистика по самолётам 1960–90-х,
// поэтому итог калибруется на OEW из Airbus AC одним коэффициентом.

import { type AircraftDefinition } from "../definition.ts";

const LB = 0.45359237;
const FT = 0.3048;
const toLb = (kg: number) => kg / LB;
const toFt = (m: number) => m / FT;
const toFt2 = (m2: number) => m2 / (FT * FT);
const toFt3 = (m3: number) => m3 / (FT * FT * FT);
const toKg = (lb: number) => lb * LB;
const rad = (deg: number) => (deg * Math.PI) / 180;

export function fuselageWettedAreaM2(def: AircraftDefinition): number {
  const f = def.fuselage;
  const d = (f.widthM + f.heightM) / 2;
  // Цилиндр с сужением носа и хвоста: коэффициент 0,85 к площади цилиндра.
  return Math.PI * d * f.lengthM * 0.85;
}

export function nacelleWettedAreaM2(def: AircraftDefinition): number {
  const e = def.engine;
  return Math.PI * e.nacelleWidthM * e.nacelleLengthM * 0.9;
}

export function wingKg(def: AircraftDefinition): number {
  const w = def.wing;
  const ar = (w.spanM * w.spanM) / w.areaM2;
  const lb =
    0.0051 *
    Math.pow(toLb(def.weights.mtowKg) * def.weights.ultimateLoadFactor, 0.557) *
    Math.pow(toFt2(w.areaM2), 0.649) *
    Math.pow(ar, 0.5) *
    Math.pow(w.thicknessRootPct / 100, -0.4) *
    Math.pow(1 + w.taper, 0.1) /
    Math.cos(rad(w.sweepQuarterDeg)) *
    Math.pow(toFt2(w.controlSurfaceAreaM2), 0.1);
  return toKg(lb);
}

export function htailKg(def: AircraftDefinition): number {
  const t = def.htail;
  const fuselageWidthAtTail = def.fuselage.widthM * 0.5;
  const ky = 0.3 * toFt(t.armM);
  const lb =
    0.0379 *
    Math.pow(1 + fuselageWidthAtTail / t.spanM, -0.25) *
    Math.pow(toLb(def.weights.mtowKg), 0.639) *
    Math.pow(def.weights.ultimateLoadFactor, 0.1) *
    Math.pow(toFt2(t.areaM2), 0.75) *
    Math.pow(toFt(t.armM), -1) *
    Math.pow(ky, 0.704) /
    Math.cos(rad(t.sweepDeg)) *
    Math.pow(t.aspectRatio, 0.166) *
    Math.pow(1 + t.controlFraction, 0.1);
  return toKg(lb);
}

export function vtailKg(def: AircraftDefinition): number {
  const t = def.vtail;
  const kz = toFt(t.armM);
  const lb =
    0.0026 *
    Math.pow(toLb(def.weights.mtowKg), 0.556) *
    Math.pow(def.weights.ultimateLoadFactor, 0.536) *
    Math.pow(toFt(t.armM), -0.5) *
    Math.pow(toFt2(t.areaM2), 0.5) *
    Math.pow(kz, 0.875) /
    Math.cos(rad(t.sweepDeg)) *
    Math.pow(t.aspectRatio, 0.35) *
    Math.pow(t.thicknessPct / 100, -0.5);
  return toKg(lb);
}

export function fuselageKg(def: AircraftDefinition): number {
  const f = def.fuselage;
  const w = def.wing;
  const lFt = toFt(f.lengthM);
  const kws =
    0.75 * ((1 + 2 * w.taper) / (1 + w.taper)) * ((toFt(w.spanM) * Math.tan(rad(w.sweepQuarterDeg))) / lFt);
  const d = (f.widthM + f.heightM) / 2;
  const lb =
    0.328 *
    f.doorFactor *
    1.0 *
    Math.pow(toLb(def.weights.mtowKg) * def.weights.ultimateLoadFactor, 0.5) *
    Math.pow(lFt, 0.25) *
    Math.pow(toFt2(fuselageWettedAreaM2(def)), 0.302) *
    Math.pow(1 + kws, 0.04) *
    Math.pow(f.lengthM / d, 0.1);
  return toKg(lb);
}

export function mainGearKg(def: AircraftDefinition): number {
  const g = def.gear;
  const lb =
    0.0106 *
    Math.pow(toLb(def.weights.mlwKg), 0.888) *
    Math.pow(def.weights.landingLoadFactor, 0.25) *
    Math.pow(toFt(g.mainLengthM) * 12, 0.4) *
    Math.pow(g.mainWheels, 0.321) *
    Math.pow(g.mainStruts, -0.5) *
    Math.pow(toFt(g.stallSpeedMs), 0.1);
  return toKg(lb);
}

export function noseGearKg(def: AircraftDefinition): number {
  const g = def.gear;
  const lb =
    0.032 *
    Math.pow(toLb(def.weights.mlwKg), 0.646) *
    Math.pow(def.weights.landingLoadFactor, 0.2) *
    Math.pow(toFt(g.noseLengthM) * 12, 0.5) *
    Math.pow(g.noseWheels, 0.45);
  return toKg(lb);
}

/** Масса двигателя с содержимым гондолы (Raymer W_ec). */
function engineInstalledLb(def: AircraftDefinition): number {
  const e = def.engine;
  return 2.331 * Math.pow(toLb(e.dryMassKg), 0.901) * (e.thrustReverser ? 1.18 : 1.0);
}

export function nacellesKg(def: AircraftDefinition): number {
  const e = def.engine;
  const lb =
    0.6724 *
    Math.pow(toFt(e.nacelleLengthM), 0.1) *
    Math.pow(toFt(e.nacelleWidthM), 0.294) *
    Math.pow(def.weights.ultimateLoadFactor, 0.119) *
    Math.pow(engineInstalledLb(def), 0.611) *
    Math.pow(e.count, 0.984) *
    Math.pow(toFt2(nacelleWettedAreaM2(def)), 0.224);
  return toKg(lb);
}

export function engineControlsAndStarterKg(def: AircraftDefinition): number {
  const e = def.engine;
  const controlsLb = 5.0 * e.count + 0.8 * toFt(def.fuselage.lengthM * 0.6) * e.count;
  const starterLb = 49.19 * Math.pow((e.count * toLb(e.dryMassKg)) / 1000, 0.541);
  return toKg(controlsLb + starterLb);
}

export function fuelSystemKg(def: AircraftDefinition): number {
  const s = def.systems;
  const gal = s.fuelVolumeL / 3.78541;
  // Все баки интегральные: (1 + Vi/Vt)^-1 = 0,5.
  const lb = 2.405 * Math.pow(gal, 0.606) * 0.5 * Math.pow(s.fuelTanks, 0.5);
  return toKg(lb);
}

export function flightControlsKg(def: AircraftDefinition): number {
  const s = def.systems;
  const scs =
    def.wing.controlSurfaceAreaM2 +
    def.htail.areaM2 * def.htail.controlFraction +
    def.vtail.areaM2 * def.vtail.controlFraction;
  // Момент инерции по рысканию: оценка m·(0,3·L)², влияние ничтожно (показатель 0,07).
  const iyy = toLb(def.weights.mtowKg) * Math.pow(0.3 * toFt(def.fuselage.lengthM), 2);
  const nf = s.flightControlFunctions;
  const lb = 145.9 * Math.pow(nf, 0.554) * Math.pow(1 + 1 / nf, -1) * Math.pow(toFt2(scs), 0.2) * Math.pow(iyy * 1e-6, 0.07);
  return toKg(lb);
}

function lfPlusBwFt(def: AircraftDefinition): number {
  return toFt(def.fuselage.lengthM) + toFt(def.wing.spanM);
}

export function hydraulicsKg(def: AircraftDefinition): number {
  return toKg(0.2673 * def.systems.flightControlFunctions * Math.pow(lfPlusBwFt(def), 0.937));
}

export function electricalKg(def: AircraftDefinition): number {
  const s = def.systems;
  const lb =
    7.291 *
    Math.pow(s.generatorsKva * s.generators, 0.782) *
    Math.pow(toFt(s.electricalRoutingM), 0.346) *
    Math.pow(s.generators, 0.1);
  return toKg(lb);
}

export function instrumentsKg(def: AircraftDefinition): number {
  return toKg(4.509 * Math.pow(def.systems.crew, 0.541) * def.engine.count * Math.pow(lfPlusBwFt(def), 0.5));
}

export function avionicsKg(def: AircraftDefinition): number {
  return toKg(1.73 * Math.pow(toLb(def.systems.avionicsUninstalledKg), 0.983));
}

export function furnishingsKg(def: AircraftDefinition): number {
  const s = def.systems;
  const lb =
    0.0577 *
    Math.pow(s.crew, 0.1) *
    Math.pow(toLb(s.cargoMassKg), 0.393) *
    Math.pow(toFt2(fuselageWettedAreaM2(def)), 0.75);
  return toKg(lb);
}

export function airConditioningKg(def: AircraftDefinition): number {
  const s = def.systems;
  const lb =
    62.36 *
    Math.pow(s.seats + s.cabinCrew + s.crew, 0.25) *
    Math.pow(toFt3(def.fuselage.pressurizedVolumeM3) / 1000, 0.604) *
    Math.pow(toLb(s.avionicsUninstalledKg), 0.1);
  return toKg(lb);
}

export function antiIceKg(def: AircraftDefinition): number {
  return 0.002 * def.weights.mtowKg;
}

export function apuKg(def: AircraftDefinition): number {
  return 2.2 * def.systems.apuUninstalledKg;
}

export function handlingGearKg(def: AircraftDefinition): number {
  return 3.0e-4 * def.weights.mtowKg;
}
