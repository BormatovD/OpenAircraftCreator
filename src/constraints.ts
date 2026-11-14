// Слой ограничений: каждое — статус «ок / предупреждение / нарушено», значение, порог и пояснение в одну строку.
// Пороги из документов помечены источником; пороги-соглашения модели помечены как условные.

import { type AircraftDefinition, aeroSpanM } from "./definition.ts";
import { BPR_VALID_RANGE } from "./propulsion.ts";
import { takeoffThrustN } from "./thrust.ts";
import { type HighLiftPerf } from "./highlift.ts";

export type Status = "ok" | "info" | "warning" | "violation";
export type ConstraintKind = "geometry" | "mission" | "operational" | "model" | "classification";

export interface ConstraintResult {
  id: string;
  label: string;
  status: Status;
  value: string;
  limit: string;
  message: string;
  kind?: ConstraintKind;
  source?: string;
}

/** Опорные значения базового самолёта, от которых считаются изменения. */
export interface ConstraintReference {
  /** Клиренс гондолы при MRW, м (AC 2-3-0: CFM56-5B ≈0,57–0,59). */
  nacelleClearanceM: number;
  nacelleWidthM: number;
  /** Ось — низ гондолы, в долях её ширины. Для круглой гондолы 0,5. */
  nacelleLowerRadiusPerWidth?: number;
  clearanceReference?: string;
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
  /** Lower planning dimension in the source's stated ground condition; NOT a safety limit. */
  provenMinClearanceM?: number;
  /** Source-condition variation, not an extra ground-contact safety allowance. */
  clearanceVariationM?: number;
  clearanceEstimated?: boolean;
  baseBypassRatio?: number;
}

const ICAO_CODE_C_MAX_SPAN_M = 36; // ICAO Annex 14: код C — до 36 м, код D — 36–52 м

export function checkConstraints(
  def: AircraftDefinition,
  ref: ConstraintReference,
  opts: { payloadLimitedByMzfw: boolean; ceilingFl: number; oeiGradient: number; oeiEmergencyGradient?: number;
    oeiMassKg?: number; oeiMtowGradient?: number; oeiMtowEmergencyGradient?: number;
    bprModelUsed?: boolean; highLift: HighLiftPerf },
): ConstraintResult[] {
  const out: ConstraintResult[] = [];

  // 1. Размах → код аэродрома ICAO.
  const span = aeroSpanM(def);
  out.push({
    id: "span-code",
    label: "Код аэродрома по размаху",
    status: span < ICAO_CODE_C_MAX_SPAN_M ? "ok" : "info",
    kind: "classification",
    value: `${span.toFixed(2)} м`,
    limit: `размах для кода C < ${ICAO_CODE_C_MAX_SPAN_M} м`,
    message:
      span < ICAO_CODE_C_MAX_SPAN_M
        ? `Код C, запас ${(ICAO_CODE_C_MAX_SPAN_M - span).toFixed(2)} м`
        : span < 52 ? "Код D по размаху. Для самолёта нужны более широкие стоянки и рулёжные дорожки."
          : "Размах превышает пределы кодов C и D.",
  });

  // При изменении размера нижний радиус масштабируется вместе с гондолой.
  const radiusChange = (def.engine.nacelleWidthM - ref.nacelleWidthM) * (ref.nacelleLowerRadiusPerWidth ?? 0.5);
  const clearance = ref.nacelleClearanceM - radiusChange + def.engine.nacelleRaiseM;
  const minClearance = ref.provenMinClearanceM;
  const outsideReference = minClearance !== undefined && clearance < minClearance - (ref.clearanceVariationM ?? 0.005);
  const reducedClearance = clearance < ref.nacelleClearanceM - .005;
  out.push({
    id: "nacelle-clearance",
    label: "Клиренс под обшивкой гондолы · реверс убран",
    // Допуск 0,005 м — точность значений AC.
    status: clearance <= 0 ? "violation" : outsideReference || reducedClearance ? "warning" : ref.clearanceEstimated ? "info" : "ok",
    kind: clearance <= 0 || reducedClearance ? "geometry" : ref.clearanceEstimated ? "model" : "geometry",
    value: `${clearance.toFixed(2)} м`,
    source: ref.clearanceReference,
    limit: minClearance === undefined ? "Типовой эксплуатационный минимум не подтверждён; контакт с землёй ≤ 0 м"
      : `Ориентир типа ${minClearance.toFixed(2)} м; вариация условий ±${(ref.clearanceVariationM ?? .005).toFixed(3)} м; контакт ≤ 0 м`,
    message: clearance <= 0 ? "Расчётная обшивка гондолы касается земли. Измените размер или установку двигателя."
      : reducedClearance ? `Клиренс уменьшился на ${((ref.nacelleClearanceM - clearance) * 100).toFixed(1)} см относительно своей базовой геометрии при тех же условиях. Проверьте размеры и установку; исходные стояночные условия приближённые.`
      : outsideReference ? "Расчётный клиренс ниже собственного размерного ориентира типа. Нужна сверка геометрии и условий массы, CG, шин и обжатия стоек; это не установленный эксплуатационный допуск."
      : ref.clearanceEstimated ? "Клиренс — оценка геометрии. Условия массы, центровки и обжатия стоек не согласованы с эксплуатационными данными; соответствие нормам не установлено."
      : "В пределах собственного размерного ориентира типа; это сравнение геометрии, не эксплуатационный допуск.",
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
    kind: "model",
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
    kind: "mission",
    label: "Набор с одним двигателем · текущий рейс (оценка)",
    // Чрезвычайный кратковременный режим допускает лишь условную оценку — не зелёную
    // отметку сертификационного соответствия. Для остальных ВС оставляем старые пороги.
    status: normalPasses ? (g >= 0.03 ? "ok" : "warning") : emergencyPasses ? "warning" : "violation",
    value: (emergencyG === undefined ? `${(g * 100).toFixed(2)}%` :
      `${(g * 100).toFixed(2)}% штат. / ${(emergencyG * 100).toFixed(2)}% ЧР`) +
      (opts.oeiMassKg === undefined ? "" : ` · ${(opts.oeiMassKg / 1000).toFixed(2)} т`),
    limit: emergencyG === undefined
      ? "≥ 2,4% (CS 25.121(b)); МСА, уровень моря, масса текущего рейса; < 3% — условный порог запаса"
      : "≥ 2,4% (второй сегмент); ЧР ПС-90А ≤ 3 мин, одноразовый",
    message: emergencyG === undefined
      ? g >= 0.03 ? "Запас есть" : g >= 0.024
        ? "Запас мал: в жару и на высокогорных аэродромах придётся снижать взлётную массу"
        : "Расчёт текущего рейса ниже 2,4%. Проверьте взлётную массу, тягу и аэродинамику; эта оценка не заменяет одобренные взлётные данные."
      : normalPasses
        ? "Оценка на штатной тяге проходит порог; чрезвычайный режим в миссии не используется."
        : emergencyPasses
          ? "Штатная тяга недостаточна по упрощённой модели; с учётом кратковременной ЧР исправного ПС-90А порог достигается. Требуется подтверждение применимости по РЛЭ/сертификационному расчёту, не вывод о сертификации."
          : "Даже чрезвычайный режим не достигает 2,4% в упрощённой модели. Проверить взлётные данные, ограничения режима и расчётную аэродинамику.",
  });

  if (opts.oeiMtowGradient !== undefined) {
    const gm = opts.oeiMtowGradient, ge = opts.oeiMtowEmergencyGradient;
    out.push({ id: "oei-mtow", kind: "model", label: "Набор с одним двигателем · MTOW (не подтверждён по РЛЭ)",
      status: gm >= .024 ? "info" : "warning",
      value: `${(gm * 100).toFixed(2)}%${ge === undefined ? "" : ` штат. / ${(ge * 100).toFixed(2)}% ЧР`} · ${(def.weights.mtowKg / 1000).toFixed(2)} т`,
      limit: "Ориентир 2,4%; расчётная V₂MIN = 1,13 VSR, МСА, уровень моря, шасси убрано",
      source: "CS 25.107 и 25.121(b); поляра и скоростная характеристика тяги — общая инженерная модель",
      message: "Сохранена отдельная проектная оценка при MTOW. Расчёт использует минимальную оценку V₂ и условные поправки на механизацию/отказ; нужны V₂, поляра и располагаемая тяга конкретного типа. Это не вывод о сертификационном соответствии." });
  }

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
    kind: "classification",
    label: "Скорость захода при MLW",
    status: vat <= 140.5 ? "ok" : "info",
    value: `${Math.round(vat)} уз`,
    limit: "категория C ≤ 140 уз, D — 141–165 уз (ИКАО PANS-OPS)",
    message:
      vat <= 140.5
        ? "Категория C, как у A320"
        : vat <= 165.5
          ? "Категория D: выше минимумы захода, длиннее посадочная дистанция, часть схем недоступна"
          : "Категория E по расчётной скорости; применимость схем захода проверяется отдельно.",
  });

  // 8. Масса: все места не помещаются в MZFW.
  out.push({
    id: "mzfw",
    kind: "mission",
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
  // Both endpoints of the mass/diameter ratio must be within its empirical anchors.
  const baselineBpr = ref.baseBypassRatio ?? bpr;
  const inRange = bpr >= BPR_VALID_RANGE[0] && bpr <= BPR_VALID_RANGE[1] && baselineBpr >= BPR_VALID_RANGE[0] && baselineBpr <= BPR_VALID_RANGE[1];
  out.push({
    id: "bpr-range",
    kind: "model",
    label: "Применимость эмпирики массы и диаметра двигателя",
    status: !opts.bprModelUsed ? "info" : inRange ? "ok" : "warning",
    value: bpr.toFixed(1),
    limit: "Опорные точки CFM56-5B B=5,7 и LEAP-1A B=11; проверяются исходное и заданное значения",
    message: !opts.bprModelUsed ? "Использованы исходные масса и размеры выбранного двигателя. Эмпирика изменения двухконтурности не применялась."
      : inRange ? "Оба значения внутри интервала эмпирических опорных точек. Это оценка изменения, не модель нового сертифицированного двигателя."
      : `Применён рычаг двухконтурности ${baselineBpr.toFixed(1)} → ${bpr.toFixed(1)}: масса и диаметр требуют экстраполяции вне опорных точек.`,
  });

  return out;
}

export function worstStatus(rs: ConstraintResult[]): Status {
  if (rs.some((r) => r.status === "violation")) return "violation";
  if (rs.some((r) => r.status === "warning")) return "warning";
  return "ok";
}
