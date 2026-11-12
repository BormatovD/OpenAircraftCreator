// Слой ограничений: каждое — статус «ок / предупреждение / нарушено», значение, порог и пояснение в одну строку.
// Пороги из документов помечены источником; пороги-соглашения модели помечены как условные.

import { type AircraftDefinition, aeroSpanM } from "./definition.ts";
import { BPR_VALID_RANGE } from "./propulsion.ts";
import { takeoffThrustN } from "./thrust.ts";
import { type HighLiftPerf } from "./highlift.ts";

export type Status = "ok" | "warning" | "violation";

export interface ConstraintResult {
  id: string;
  label: string;
  status: Status;
  value: string;
  limit: string;
  message: string;
}

/** Опорные значения базового самолёта, от которых считаются изменения. */
export interface ConstraintReference {
  /** Клиренс гондолы при MRW, м (AC 2-3-0: CFM56-5B ≈0,57–0,59). */
  nacelleClearanceM: number;
  nacelleWidthM: number;
  /** Угол касания хвостом при обжатой стойке, ° (Airbus Safety First / FCOM: 11,7°). */
  tailStrikeDeg: number;
  /** Расстояние от основных стоек до точки касания хвостом, м. Откалибровано по A321. */
  tailContactArmM: number;
  /** Угол тангажа на отрыве, °. Допущение. */
  liftoffPitchDeg: number;
  /** Длина разбега/ВПП при MTOW, МСА, уровень моря, м (Jenkinson: 2 180 м). */
  takeoffFieldLengthM: number;
  mtowKg: number;
  wingAreaM2: number;
  /** Суммарная взлётная тяга базового самолёта, Н. */
  takeoffThrustN: number;
  /** CLmax во взлётной конфигурации базового самолёта (той же модели механизации). */
  clMaxTakeoff: number;
  /** Длина фюзеляжа базового самолёта, м; по умолчанию — A320 (37,57 м). */
  baseLengthM?: number;
  /** Минимальный клиренс, подтверждённый эксплуатацией (A320neo, AC 2-3-0: ≈0,46 м). */
  provenMinClearanceM: number;
}

const ICAO_CODE_C_MAX_SPAN_M = 36; // ICAO Annex 14: код C — до 36 м, код D — 36–52 м

export function checkConstraints(
  def: AircraftDefinition,
  ref: ConstraintReference,
  opts: { payloadLimitedByMzfw: boolean; ceilingFl: number; oeiGradient: number; oeiEmergencyGradient?: number; highLift: HighLiftPerf },
): ConstraintResult[] {
  const out: ConstraintResult[] = [];

  // 1. Размах → код аэродрома ICAO.
  const span = aeroSpanM(def);
  out.push({
    id: "span-code",
    label: "Код аэродрома по размаху",
    status: span <= ICAO_CODE_C_MAX_SPAN_M ? "ok" : "warning",
    value: `${span.toFixed(2)} м`,
    limit: `код C ≤ ${ICAO_CODE_C_MAX_SPAN_M} м`,
    message:
      span <= ICAO_CODE_C_MAX_SPAN_M
        ? `Код C, запас ${(ICAO_CODE_C_MAX_SPAN_M - span).toFixed(2)} м`
        : "Код D: стоянки и рулёжки для более широких самолётов, часть аэропортов недоступна. Решение у 777X — складные законцовки",
  });

  // 2. Клиренс гондолы: нижняя кромка опускается на половину прироста ширины гондолы, плюс подъём установки.
  const clearance = ref.nacelleClearanceM - (def.engine.nacelleWidthM - ref.nacelleWidthM) / 2 + def.engine.nacelleRaiseM;
  out.push({
    id: "nacelle-clearance",
    label: "Клиренс под гондолой",
    // Допуск 0,005 м — точность значений AC.
    status: clearance >= ref.provenMinClearanceM - 0.005 ? "ok" : clearance >= 0.3 ? "warning" : "violation",
    value: `${clearance.toFixed(2)} м`,
    limit: `≥ ${ref.provenMinClearanceM} м (как у A320neo); < 0,30 м — условный предел модели`,
    message:
      clearance >= ref.provenMinClearanceM - 0.005
        ? "Помещается без изменений пилона и шасси"
        : clearance >= 0.3
          ? "Нужно поднять пилон или удлинить стойки — так сделали на 737 MAX"
          : "Двигатель не помещается под крылом без перекомпоновки",
  });

  // 3. Угол касания хвостом: точка касания уходит назад на половину вставки в фюзеляж.
  // Геометрия касания — от A320 (37,57 м); у другого базового самолёта «как у базы» — его собственный угол.
  const h = ref.tailContactArmM * Math.tan((ref.tailStrikeDeg * Math.PI) / 180);
  const angleAt = (len: number) => (Math.atan(h / (ref.tailContactArmM + (len - 37.57) / 2)) * 180) / Math.PI;
  const tailAngle = angleAt(def.fuselage.lengthM);
  const baseAngle = angleAt(ref.baseLengthM ?? 37.57);
  // Нарушение — на градус ниже угла отрыва A320 (или угла самой базы, если он меньше).
  const tailLimit = Math.min(ref.liftoffPitchDeg, baseAngle) - 1;
  out.push({
    id: "tail-strike",
    label: "Угол касания хвостом",
    status: tailAngle >= baseAngle - 0.05 ? "ok" : tailAngle >= tailLimit ? "warning" : "violation",
    value: `${tailAngle.toFixed(1)}°`,
    limit: `база ${baseAngle.toFixed(1)}°; ниже ${tailLimit.toFixed(1)}° — условный предел (угол отрыва ≈${ref.liftoffPitchDeg}° — допущение)`,
    message:
      tailAngle >= baseAngle - 0.05
        ? "Как у базового самолёта"
        : tailAngle >= tailLimit
          ? "Запас на отрыве меньше: нужна более аккуратная техника пилотирования или защита хвоста"
          : "Хвост касается полосы раньше отрыва: нужны более длинные стойки или иной закрылок",
  });

  // 4. Потолок по тяге на верху набора при MTOW.
  const ceil = opts.ceilingFl;
  out.push({
    id: "thrust-ceiling",
    label: "Эшелон по тяге при MTOW",
    status: ceil >= 330 ? "ok" : ceil >= 310 ? "warning" : "violation",
    value: ceil >= 398 ? "FL398 (потолок)" : `FL${ceil}`,
    limit: "300 фут/мин остаточной скороподъёмности; ≥ FL330 / FL310 — условные пороги",
    message:
      ceil >= 330
        ? "Тяги хватает, чтобы сразу занять экономичный эшелон"
        : ceil >= 310
          ? "После взлёта с MTOW — эшелоны ниже: больше расход, теснее в воздушном пространстве"
          : "Двигатель мал для этой массы и сопротивления: нужна большая тяга (её определяет верх набора, а не взлёт)",
  });

  // 5. Второй сегмент взлёта с отказавшим двигателем (CS 25.121(b)).
  const g = opts.oeiGradient;
  const emergencyG = opts.oeiEmergencyGradient;
  const emergencyPasses = emergencyG !== undefined && emergencyG >= 0.024;
  const normalPasses = g >= 0.024;
  out.push({
    id: "oei-climb",
    label: "Набор с отказавшим двигателем",
    // Чрезвычайный кратковременный режим допускает лишь условную оценку — не зелёную
    // отметку сертификационного соответствия. Для остальных ВС оставляем старые пороги.
    status: normalPasses ? (g >= 0.03 ? "ok" : "warning") : emergencyPasses ? "warning" : "violation",
    value: emergencyG === undefined ? `${(g * 100).toFixed(1)}%` :
      `${(g * 100).toFixed(1)}% штат. / ${(emergencyG * 100).toFixed(1)}% ЧР`,
    limit: emergencyG === undefined
      ? "≥ 2,4% (CS 25.121(b)); МСА, уровень моря, MTOW; < 3% — условный порог запаса"
      : "≥ 2,4% (второй сегмент); ЧР ПС-90А ≤ 3 мин, одноразовый",
    message: emergencyG === undefined
      ? g >= 0.03 ? "Запас есть" : g >= 0.024
        ? "Запас мал: в жару и на высокогорных аэродромах придётся снижать взлётную массу"
        : "Не выполняется требование норм: нужна большая тяга, больше крыло или меньше MTOW"
      : normalPasses
        ? "Оценка на штатной тяге проходит порог; чрезвычайный режим в миссии не используется."
        : emergencyPasses
          ? "Штатная тяга недостаточна по упрощённой модели; с учётом кратковременной ЧР исправного ПС-90А порог достигается. Требуется подтверждение применимости по РЛЭ/сертификационному расчёту, не вывод о сертификации."
          : "Даже чрезвычайный режим не достигает 2,4% в упрощённой модели. Проверить взлётные данные, ограничения режима и расчётную аэродинамику.",
  });

  // 6. Длина ВПП: TOFL ∝ W² / (S · CLmax,взл · T) (Raymer, параметр взлёта).
  const tofl =
    (ref.takeoffFieldLengthM * Math.pow(def.weights.mtowKg / ref.mtowKg, 2) * (ref.wingAreaM2 / def.wing.areaM2) * (ref.clMaxTakeoff / opts.highLift.clMaxTakeoff)) /
    (takeoffThrustN(def) / ref.takeoffThrustN);
  const ratio = tofl / ref.takeoffFieldLengthM;
  out.push({
    id: "takeoff-field",
    label: "Длина ВПП при MTOW",
    status: ratio <= 1.05 ? "ok" : ratio <= 1.15 ? "warning" : "violation",
    value: `${Math.round(tofl)} м`,
    limit: `база ${ref.takeoffFieldLengthM} м; +5% / +15% — условные пороги`,
    message: ratio <= 1.05 ? "Как у базового самолёта" : "Меньше доступных аэропортов, ограничения в жару и на высокогорье",
  });

  // 7. Скорость захода → категория воздушного судна ИКАО (PANS-OPS: V_AT = 1,23·V_SR при максимальной посадочной массе).
  const vat = opts.highLift.vAppKt;
  out.push({
    id: "approach-speed",
    label: "Скорость захода при MLW",
    status: vat <= 140.5 ? "ok" : vat <= 165.5 ? "warning" : "violation",
    value: `${Math.round(vat)} уз`,
    limit: "категория C ≤ 140 уз, D — 141–165 уз (ИКАО PANS-OPS)",
    message:
      vat <= 140.5
        ? "Категория C, как у A320"
        : vat <= 165.5
          ? "Категория D: выше минимумы захода, длиннее посадочная дистанция, часть схем недоступна"
          : "Быстрее категории D: нужна более мощная механизация или больше крыло",
  });

  // 8. Масса: все места не помещаются в MZFW.
  out.push({
    id: "mzfw",
    label: "Нагрузка в пределах MZFW и ограничений типа",
    status: opts.payloadLimitedByMzfw ? "warning" : "ok",
    value: opts.payloadLimitedByMzfw ? "нагрузка превышает предел" : "помещается",
    limit: `MZFW ${def.weights.mzfwKg} кг${def.weights.maxPayloadKg !== undefined ? `; коммерческая нагрузка ≤ ${def.weights.maxPayloadKg} кг` : ""}`,
    message: opts.payloadLimitedByMzfw
      ? "Нужно уменьшить груз или число пассажиров; изменение количества топлива не снимает ограничение MZFW"
      : "Полная загрузка помещается",
  });

  // 9. Двухконтурность вне диапазона данных.
  const bpr = def.engine.bypassRatio;
  const inRange = bpr >= BPR_VALID_RANGE[0] && bpr <= BPR_VALID_RANGE[1];
  out.push({
    id: "bpr-range",
    label: "Двухконтурность в диапазоне данных",
    status: inRange ? "ok" : "warning",
    value: bpr.toFixed(1),
    limit: `${BPR_VALID_RANGE[0]}–${BPR_VALID_RANGE[1]}`,
    message: inRange ? "Внутри диапазона реальных двигателей" : "Экстраполяция: оценки массы и диаметра ненадёжны",
  });

  return out;
}

export function worstStatus(rs: ConstraintResult[]): Status {
  if (rs.some((r) => r.status === "violation")) return "violation";
  if (rs.some((r) => r.status === "warning")) return "warning";
  return "ok";
}
