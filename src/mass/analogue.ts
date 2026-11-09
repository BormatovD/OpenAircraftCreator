// Аналог для разбивки масс: фактическая групповая сводка Boeing 737-200
// (NASA TM 20190000431, табл. 1 «Boeing 737-200 FLOPS weight buildup summary», колонка Actual, lb).
// Публичной групповой сводки A320 нет, поэтому базовые доли групп берём у ближайшего узкофюзеляжника
// с фактическими данными, а чувствительность к рычагам — из формул Raymer.

export const B737_200_ACTUAL_LB = {
  wing: 10613,
  empennage: 2718,
  fuselage: 12108,
  landingGear: 4354,
  nacelle: 1392,
  engines: 6217,
  thrustReversers: 1007,
  miscPropulsion: 378,
  fuelSystem: 575,
  surfaceControls: 2348,
  apu: 836,
  instruments: 956,
  hydraulics: 873,
  electrical: 1066,
  avionics: 625,
  furnishings: 6643,
  airConditioningAntiIce: 1416,
  weightEmpty: 54249,
  operatingWeight: 60170,
} as const;

/** Группы аналога → узлы нашего дерева. Узлы внутри группы делят её массу пропорционально оценкам Raymer. */
export const GROUP_MAP: Record<string, string[]> = {
  wing: ["wing.box", "wing.highLift"],
  empennage: ["htail", "vtail"],
  fuselage: ["fuselage"],
  landingGear: ["gear.main", "gear.nose"],
  nacelle: ["nacelles"],
  miscPropulsion: ["engine.controls"],
  fuelSystem: ["fuel"],
  surfaceControls: ["flightControls"],
  apu: ["apu"],
  instruments: ["instruments"],
  hydraulics: ["hydraulics"],
  electrical: ["electrical.generation", "electrical.harness"],
  avionics: ["avionics"],
  furnishings: ["furnishings"],
  airConditioningAntiIce: ["airConditioning", "antiIce"],
};

/** Доли групп в «массе пустого без двигателей и реверсов» у 737-200. */
export function analogueShares(): Record<string, number> {
  const a = B737_200_ACTUAL_LB;
  const base = a.weightEmpty - a.engines - a.thrustReversers;
  const out: Record<string, number> = {};
  for (const g of Object.keys(GROUP_MAP)) out[g] = (a as Record<string, number>)[g] / base;
  return out;
}

/** Доля операционных позиций в OEW у 737-200: (Operating − Empty) / Operating ≈ 9,8%. */
export const OPERATING_ITEMS_SHARE = (B737_200_ACTUAL_LB.operatingWeight - B737_200_ACTUAL_LB.weightEmpty) / B737_200_ACTUAL_LB.operatingWeight;
