// JSON stdin/stdout adapter for fca serve. Both the page and this runner call leapRoute.
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { A320NEO } from "../src/aircraft/a320.ts";
import { contextFor } from "../src/aircraft/contextFor.ts";
import { evaluate } from "../src/evaluate.ts";
import { evaluateConfiguration } from "../src/integration/configuration.ts";
import { flightCostDesign, layoutFor, withCabinLayout, LEAP_ROUTE_MODEL, type FlightCostDesign } from "../src/integration/flightcost.ts";
import { leapRoute, type RouteInput } from "../src/integration/leapRoute.ts";
import { controlsFor, leversFor } from "../web/controls.ts";

function run(design: FlightCostDesign, route?: RouteInput) {
  const { aircraft, model } = design;
  if (aircraft.aircraftId !== "a320neo" || (model.routeSolver !== undefined && model.routeSolver !== LEAP_ROUTE_MODEL))
    throw Error("Несовместимая версия расчёта A320neo");
  const layout = layoutFor(aircraft.aircraftId, aircraft.layoutId);
  if (!layout || !["fixed", "redesign"].includes(model.mode)) throw Error("Неизвестный салон или режим Designer");
  const def = withCabinLayout(A320NEO, layout);
  const controls = controlsFor(def);
  if (!model.controls || Object.keys(model.controls).length !== controls.length) throw Error("Неполная конфигурация Designer");
  for (const c of controls) {
    const v = model.controls[c.id];
    if (c.kind === "toggle" ? typeof v !== "boolean" :
      typeof v !== "number" || !Number.isFinite(v) || (v !== c.base(def) && (v < c.min || v > c.max))) {
      throw Error("Некорректный параметр Designer: " + c.id);
    }
  }
  const base = evaluate(A320NEO, [], contextFor(A320NEO));
  const configuration = evaluateConfiguration(def, leversFor(def, model.controls), model.mode, base);
  const { ev, ctx } = configuration;
  const replay = flightCostDesign(ev.definition, ev.oewKg, model.controls, model.mode, aircraft.aircraftId, aircraft.layoutId, ctx.fuelDensityKgL);
  // Browser and Node math libraries can differ at the last few floating-point bits.
  function matchNumbers<T extends Record<string, number>>(a: T, b: T) {
    return Object.keys(a).every(k => Number.isFinite(b[k]) && Math.abs(a[k] - b[k]) < 0.00001);
  }
  if (!isDeepStrictEqual(aircraft, replay.aircraft) || !matchNumbers(replay.weights, design.weights) ||
      !matchNumbers(replay.geometry, design.geometry)) throw Error("Салон, геометрия или массы отличаются от сохранённого проекта");
  return { model: LEAP_ROUTE_MODEL, ...(route ? { route: leapRoute(configuration, route) } : {}) };
}
try {
  const { design, route } = JSON.parse(readFileSync(0, "utf8"));
  process.stdout.write(JSON.stringify(run(design, route)));
} catch (error) {
  process.stderr.write(error instanceof Error ? error.message : "Ошибка расчёта Designer");
  process.exitCode = 1;
}
