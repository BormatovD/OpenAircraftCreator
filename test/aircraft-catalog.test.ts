import assert from "node:assert/strict";
import { test } from "node:test";
import { AIRCRAFT, aircraftForType, variantsFor } from "../web/aircraftCatalog.ts";
import { controlsFor, defaults, leversFor, scenarioFamily } from "../web/controls.ts";
import { comparisonAssumptionsFor } from "../src/aircraft/missionProfiles.ts";

test("выбор типов сохраняет доступный вариант и открывает оба двигателя 757", () => {
  assert.deepEqual(variantsFor("b757"), ["b757-200-rb", "b757-200-pw"]);
  assert.equal(aircraftForType("a321", "a319neo"), "a321neo");
  assert.equal(aircraftForType("a320", "b737-8"), "a320neo");
  assert.equal(aircraftForType("b757", "a320neo"), "b757-200-rb");
  assert.equal(aircraftForType("b757", "b757-200-pw"), "b757-200-pw");
  assert.equal(aircraftForType("missing", "a320ceo"), undefined);
  assert.equal(AIRCRAFT["b757-200-rb"].engine.name, "RB211-535E4");
  assert.equal(AIRCRAFT["b757-200-pw"].engine.name, "PW2037");
});

test("737 NG and MAX keep separate engines, cabins and scenarios", () => {
  assert.deepEqual(variantsFor("b737"), ["b737-8", "b737-300", "b737-800"]);
  assert.notEqual(scenarioFamily("b737-800"), scenarioFamily("b737-8"));
  const ng = AIRCRAFT["b737-800"];
  assert.equal(ng.engine.name, "CFM56-7B26");
  assert.equal(ng.wing.tip, "blended");
  assert.ok(!controlsFor(ng).some(c => c.id === "lrc" || c.id === "sharklets"));
});

test("757: UI показывает M0,80, не применяет рычагов по умолчанию и не наследует сценарии 737", () => {
  for (const id of variantsFor("b757")) {
    const def = AIRCRAFT[id];
    const values = defaults(def);
    assert.equal(values.mach, 0.8);
    assert.equal(values.mach, comparisonAssumptionsFor(def).cruiseMach);
    assert.deepEqual(leversFor(def, values), []);
    assert.ok(!controlsFor(def).some((c) => c.id === "sharklets" || c.id === "lrc"));
    assert.notEqual(scenarioFamily(id), scenarioFamily("b737-8"));
  }
});
