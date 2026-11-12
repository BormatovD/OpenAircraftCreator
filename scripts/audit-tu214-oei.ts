// Диагностика Ту-214: изменение рейтинга тяги только для проверки второго сегмента.
// НЕ корректирует характеристики самолёта и не заменяет сертификационный расчёт.
// Run: node --experimental-strip-types scripts/audit-tu214-oei.ts > tu214-oei-local.json
import { TU214_PS90A } from "../src/aircraft/tu214.ts";
import { evaluate } from "../src/evaluate.ts";
import { contextFor } from "../src/aircraft/contextFor.ts";
import { G0 } from "../src/atmosphere.ts";
import { TAKEOFF_POLAR } from "../src/thrust.ts";

const ratingsKgf = [16000, 17000, 17150, 17500];
const points = ratingsKgf.map((kgf) => {
  // Приближение: применяем одинаковый закон падения тяги с воздушной скоростью
  // ко всем рейтингам ПС-90А. Настоящей approved takeoff/OEI тяговой карты нет.
  const def = { ...TU214_PS90A, engine: { ...TU214_PS90A.engine, takeoffThrustKn: (kgf * G0) / 1000 } };
  const ev = evaluate(def, [], contextFor(def));
  return {
    ratingKgf: kgf,
    secondSegmentGradientPercent: Number((100 * ev.oei.gradient).toFixed(4)),
    modelV2Kt: Number((ev.oei.v2Ms / 0.514444).toFixed(3)),
    remainingEngineThrustN: Number(ev.oei.thrustN.toFixed(1)),
    exceedsNumerical2p4PercentThreshold: ev.oei.gradient >= TAKEOFF_POLAR.requiredGradient,
  };
});

console.log(JSON.stringify({
  status: "DIAGNOSTIC ONLY — NOT AN AIRWORTHINESS DETERMINATION",
  aircraft: "Tu-214 / PS-90A", mtowKg: TU214_PS90A.weights.mtowKg,
  conditions: "model ISA sea level / gear up / takeoff wing / one engine inoperative; simplistic V2 and thrust lapse",
  secondSegmentRequirementPercent: 100 * TAKEOFF_POLAR.requiredGradient,
  documentedEmergencyRating: { kgf: 17500, maxContinuousMinutes: 3, oneTime: true, nominalKgF: 16000 },
  formula: "gradient = thrust_remaining/weight - drag/weight (at model V2)",
  points,
  caveats: [
    "Manufacturer/certificate emergency rating is not proof that it is allowed in every certification OEI calculation.",
    "No approved speed/altitude/temperature/bleed corrections or OEI performance tables for this Tu-214 configuration.",
    "Increasing a rating in this diagnostic must not modify normal engine thrust used elsewhere in the mission.",
  ],
}, null, 2));
