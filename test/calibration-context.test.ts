import { test } from "node:test";
import assert from "node:assert/strict";
import data from "../data/a320.json" with { type: "json" };
import { A320CEO } from "../src/aircraft/a320.ts";
import { A320_CONTEXT } from "../src/aircraft/a320Context.ts";
import { calibrateTsfc } from "../src/calibrate.ts";
import { aeroFor, assumptionsFor, engineStateFor } from "../src/evaluate.ts";
import { selectFlightLevel } from "../src/mission.ts";
import { type AircraftData, compareAircraft } from "../src/payloadRange.ts";
import { validateFamily } from "../src/validation.ts";

const def = { ...A320CEO, wing: { ...A320CEO.wing, tip: "sharklet" as const } };
const ac: AircraftData = data.aircraft.ceo_sharklet;
const as = assumptionsFor(A320_CONTEXT, []);
const aero = aeroFor(def, A320_CONTEXT.aero, []);
const engine = engineStateFor(def, A320_CONTEXT, [], as);
const density = A320_CONTEXT.fuelDensityKgL;

test("калибровка A320: найденный TSFC точно воспроизводится в рабочем пути проверки", () => {
  const cal = calibrateTsfc(ac, aero, engine, as, density);
  // CEO и опорный двигатель совпадают; у NEO fitted TSFC нельзя повторно умножать на отношение циклов.
  const replay = validateFamily({ ...A320_CONTEXT, tsfcCruise: cal.tsfcCruise })
    .find((r) => r.c.role === "калибровка")!;
  assert.deepEqual(cal.rows, replay.rows);
  assert.equal(cal.rmsPct, replay.rmsPct);
});

test("калибровка сохраняет ограничение тяги и восстанавливает известный TSFC", () => {
  // Численный контроль, не новый паспорт A320: задаём 85% располагаемой взлётной тяги.
  const limitedEngine = { ...engine, takeoffThrustN: engine.takeoffThrustN * 0.85 };
  const source: AircraftData = { ...ac, curves: [{ ...ac.curves[0] }] };
  const massAfterTakeoff = source.curves[0].mtowKg - as.takeoffFuelKg;
  const limitedLevel = selectFlightLevel(aero, as, massAfterTakeoff, limitedEngine);
  const noThrustLimit = selectFlightLevel(aero, as, massAfterTakeoff, { tsfcCruise: engine.tsfcCruise });
  assert.ok(limitedLevel.fl < noThrustLimit.fl, "контрольный случай должен быть чувствителен к тяге");
  assert.equal(limitedLevel.limited, false, "нужен допустимый нижний эшелон, а не fallback вне тягового диапазона");

  // Создаём синтетические дальности прямым расчётом с известным TSFC и затем решаем обратную задачу.
  const truth = compareAircraft(source, aero, limitedEngine, as, density);
  source.curves[0].rangeAtMaxPayloadNm = truth.find((r) => r.corner === "maxPayload")!.modelNm;
  source.curves[0].rangeAtFullTankNm = truth.find((r) => r.corner === "fullTank")!.modelNm;

  const cal = calibrateTsfc(source, aero, limitedEngine, as, density);
  assert.ok(Math.abs(cal.tsfcCruise / limitedEngine.tsfcCruise - 1) < 1e-6,
    `известный TSFC ${limitedEngine.tsfcCruise}; восстановленный ${cal.tsfcCruise}`);
  assert.ok(cal.rmsPct < 1e-4, `ошибка восстановления ${cal.rmsPct}%`);
  const replay = compareAircraft(source, aero, { ...limitedEngine, tsfcCruise: cal.tsfcCruise }, as, density);
  assert.deepEqual(cal.rows, replay);
});
