// Запуск из корня: node scripts/audit-levers.ts
import assert from "node:assert/strict";
import { AIRCRAFT } from "../web/aircraftCatalog.ts";
import { controlsFor, defaults, leversFor, SCENARIOS } from "../web/controls.ts";
import { contextFor } from "../src/aircraft/contextFor.ts";
import { evaluate, type Evaluation } from "../src/evaluate.ts";
import { evaluateConfiguration } from "../src/integration/configuration.ts";
import { liftToDrag } from "../src/aero.ts";

assert.equal(Object.keys(AIRCRAFT).length, 13, "Audit must exercise the current full 13-aircraft catalog, including 737-800");

function close(actual: number, expected: number, tolerance: number, quantity: string) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${quantity}: ${actual} ≠ ${expected} (±${tolerance})`);
}

function checkBalances(e: Evaluation) {
  const { trip, reserves, feasible } = e.missionResult;
  const leaves = [...e.masses.byId.values()].filter(n => n.children.length === 0);
  close(e.oewKg, leaves.reduce((sum, n) => sum + n.kg, 0), 1e-7, "OEW, кг");
  close(e.payloadKg, e.seatsCarried * e.mission.massPerPaxKg + e.cargoCarriedKg, 1e-7, "нагрузка, кг");
  close(e.tripFuelKg, trip.takeoffFuelKg + trip.climbFuelKg + trip.cruiseFuelKg
    + trip.stepClimbFuelKg + trip.descentFuelKg, 0.001, "рейсовое топливо, кг");
  close(reserves.totalKg, reserves.contingencyKg + reserves.alternateKg + reserves.finalKg, 1e-7, "резервы, кг");
  close(e.cruiseDrag.total, e.cruiseDrag.parts.reduce((sum, p) => sum + p.counts, 0), 1e-8, "сопротивление, каунты");
  assert.ok(e.missionFuelKg + e.payloadKg + e.oewKg <= e.definition.weights.mtowKg + 0.001);
  assert.ok(e.missionFuelKg + e.missionAssumptions.taxiFuelKg <=
    e.definition.systems.fuelVolumeL * contextFor(AIRCRAFT[e.definition.id]).fuelDensityKgL + 0.001);
  if (feasible) {
    close(e.missionFuelKg, e.tripFuelKg + reserves.totalKg, 0.5, "взлётное топливо, кг");
    if (e.seatsCarried) close(e.fuelPerSeatPer100KmKg,
      e.tripFuelKg * 100 / (e.seatsCarried * e.mission.distanceNm * 1.852), 1e-9, "кг/место/100 км");
  } else {
    assert.ok(Number.isNaN(e.fuelPerSeatPer100KmKg));
  }
}

function checkLever(id: string, value: number | boolean, base: Evaluation, e: Evaluation) {
  const d = e.definition, b = base.definition;
  const mass = (ev: Evaluation, node: string) => ev.masses.byId.get(node)!.kg;
  const v = Number(value);
  const engine = d.engine, cycle = engine.cycle;
  switch (id) {
    case "compositeBox": case "compositeHighLift": case "harness": {
      const [node, saving] = id === "compositeBox" ? ["wing.box", 0.20] as const
        : id === "compositeHighLift" ? ["wing.highLift", 0.15] as const : ["electrical.harness", v / 100] as const;
      close(base.oewKg - e.oewKg, mass(base, node) * saving, 1e-7, "экономия массы, кг");
      break;
    }
    case "span":
      close(d.wing.spanM - b.wing.spanM, v, 1e-9, "размах, м");
      close(mass(e, "wing.box") / mass(base, "wing.box"), d.wing.spanM / b.wing.spanM, 1e-10, "масса кессона");
      break;
    case "thickness":
      close(mass(e, "wing.box") / mass(base, "wing.box"), (v / b.wing.thicknessRootPct) ** -0.4, 1e-10, "масса кессона");
      close(d.systems.fuelVolumeL / b.systems.fuelVolumeL, 0.2 + 0.8 * v / b.wing.thicknessRootPct, 1e-10, "объём баков");
      break;
    case "sharklets":
      close(e.aero.spanM, value ? b.wing.sharkletSpanM : b.wing.spanM, 1e-10, "аэродинамический размах");
      close(e.oewKg - base.oewKg, value ? 200 : -200, 1e-7, "законцовки, кг");
      break;
    case "airfoil": close(e.aero.wave!.kappa, v, 1e-12, "константа Корна"); break;
    case "doubleFlaps": case "slats": case "flapChord": {
      const sign = id === "flapChord" ? Math.sign(v / 100 - b.wing.highLift.flapChordFraction) : value ? 1 : -1;
      assert.equal(Math.sign(e.highLift.clMaxLanding - base.highLift.clMaxLanding), sign);
      assert.equal(Math.sign(mass(e, "wing.highLift") - mass(base, "wing.highLift")), sign);
      break;
    }
    case "bpr": {
      assert.equal(engine.bypassRatio, v);
      const sign = Math.sign(v - b.engine.bypassRatio);
      assert.equal(Math.sign(engine.fanDiameterM - b.engine.fanDiameterM), sign);
      assert.equal(Math.sign(engine.dryMassKg - b.engine.dryMassKg), sign);
      break;
    }
    case "opr": assert.equal(engine.overallPressureRatio, v); break;
    case "t4": assert.equal(cycle.t4K, v); break;
    case "cooling": assert.equal(cycle.coolingFrac, v / 100); break;
    case "fanEff": assert.equal(cycle.fanEff, v); break;
    case "compEff": assert.equal(cycle.compEff, v); break;
    case "turbEff":
      assert.equal(cycle.hptEff, v);
      close(cycle.lptEff - b.engine.cycle.lptEff, v - b.engine.cycle.hptEff, 1e-12, "КПД ТНД");
      break;
    case "gearbox": assert.equal(cycle.gearbox, value); break;
    case "thrust":
      close(engine.thrustScale / b.engine.thrustScale, v / 100, 1e-12, "тяга");
      close(engine.dryMassKg / b.engine.dryMassKg, v / 100, 1e-12, "масса двигателя");
      close(engine.fanDiameterM / b.engine.fanDiameterM, Math.sqrt(v / 100), 1e-12, "диаметр");
      break;
    case "installation":
      assert.equal(Math.sign(e.aero.cd0 - base.aero.cd0), value ? 1 : -1);
      break;
    case "raise":
      close(e.tripFuelKg, base.tripFuelKg, 1e-6, "расход при изменении одного клиренса");
      assert.notEqual(e.constraints.find(c => c.id === "nacelle-clearance")!.value,
        base.constraints.find(c => c.id === "nacelle-clearance")!.value);
      break;
    case "rows": assert.equal(e.seats - base.seats, v * b.systems.seatsAbreast); break;
    case "aero":
      for (const mach of [0.70, 0.84]) close(liftToDrag(e.aero, 0.55, mach) / liftToDrag(base.aero, 0.55, mach),
        1 + v / 100, 1e-12, "изменение L/D при постоянном CL");
      break;
    case "lrc": assert.equal(e.missionAssumptions.cruiseSpeedMode, value ? "lrc" : "fixedMach"); break;
    case "mach": close(e.cruiseDrag.mach, v, 1e-10, "крейсерский Мах"); break;
    default: throw Error(`Проверка рычага ${id} отсутствует`);
  }
  if (["bpr", "opr", "t4", "cooling", "fanEff", "compEff", "turbEff", "gearbox"].includes(id)) {
    assert.ok(Number.isFinite(e.tsfcCruise) && e.tsfcCruise > 0 && e.tsfcCruise !== base.tsfcCruise);
  }
}

let settings = 0;
const testedControls = new Set<string>();
for (const d of Object.values(AIRCRAFT)) {
  const base = evaluate(d, [], contextFor(d));
  const initial = defaults(d);
  assert.deepEqual(leversFor(d, initial), []);
  const unchanged = evaluateConfiguration(d, [], "redesign", base);
  assert.ok(unchanged.redesign?.converged, d.id);
  close(unchanged.ev.definition.weights.mtowKg, d.weights.mtowKg, 0.01, d.id);
  close(unchanged.ev.rangeWithMissionPayloadNm, base.rangeWithMissionPayloadNm, 0.02, d.id);
  for (const c of controlsFor(d)) {
    for (const v of c.kind === "toggle" ? [!c.base(d)] : [c.min, c.max]) {
      if (v === initial[c.id]) continue;
      const values = { ...initial, [c.id]: v };
      if (c.id === "mach" && initial.lrc) values.lrc = false;
      try {
        const { base: comparison, ev } = evaluateConfiguration(d, leversFor(d, values), "fixed", base);
        checkBalances(ev);
        checkLever(c.id, v, comparison, ev);
      } catch (cause) {
        throw new Error(`${d.id} / ${c.id} = ${v}`, { cause });
      }
      testedControls.add(c.id);
      settings++;
    }
  }
  console.log(`${d.id} — проверено`);
}
for (const s of SCENARIOS) {
  const d = AIRCRAFT[s.aircraft];
  const r = evaluateConfiguration(d, leversFor(d, { ...defaults(d), ...s.values }), s.mode, evaluate(d, [], contextFor(d)));
  checkBalances(r.ev);
  if (r.redesign) {
    assert.ok(r.redesign.converged, s.id);
    assert.ok(r.ev.rangeWithMissionPayloadNm >= r.redesign.designRangeNm - 0.02, s.id);
  }
}
console.log(`${testedControls.size} рычагов, ${settings} отклонений от базы, ${SCENARIOS.length} сценариев`);
