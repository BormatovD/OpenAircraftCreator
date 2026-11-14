import type { PylonSpec } from "./pylonGeometry.ts";

/**
 * Эскизные параметры установок 737. Точки координат привязаны к входной
 * плоскости двигателя; это не размерные данные для ремонта/изготовления.
 */
export const pylon737 = {
  cfm3b2: {
    noseX: 0.79,
    shoulderX: 1.47,
    noseRise: 0.015,
    shoulderRise: 0.21,
    halfWidth: 0.17,
    aftWingFraction: 0.24,
    // Две опоры впереди на fan frame; координата по радиусу от оси до корпуса.
    frontMount: [1.28, 0.78, 0.48],
    frontCaseContact: .485,
    // Одна центральная опора на turbine frame; thrust links не считаются опорой.
    rearMount: [3.05, 0.57, .17],
    rearCaseContact: .547,
    wingAttachment: "boeing737",
    thrustLinks: "paired",
    thrustCase: [1.28, 0.78, 0.47],
    // Два створчатых капота; кривизна Classic не задаётся этим профилем.
    latchStations: [1.04, 1.45, 1.87],
    hingeStations: [1.08, 1.48, 1.86],
    forwardMountLabel: "Две боковые точки опоры на передней поперечине.",
    rearMountLabel: "Центральная опора с двумя короткими тягами к корпусу турбины.",
    cowlLabel: "Две створки капота вентилятора с шарнирами сверху.",
    cowlPanels: "halves",
    rearLinks: 2,
  },
  leap1b: {
    noseX: 0.67,
    shoulderX: 1.93,
    noseRise: 0.02,
    shoulderRise: 0.25,
    halfWidth: 0.19,
    aftWingFraction: 0.28,
    // Передний hanger/side-link mount assembly на fan frame.
    frontMount: [1.38, 0.91, 0.54],
    frontCaseContact: .430,
    // Многозвенная aft mount assembly с центральным hanger/link узлом.
    rearMount: [3.16, 0.68, .20],
    rearCaseContact: .378,
    wingAttachment: "boeing737",
    thrustLinks: "paired",
    // Пара связей воспринимает тягу у fan-frame zone; прецизионные точки закрыты AMM.
    thrustCase: [1.38, 0.91, 0.53],
    // Fan cowls в виде двух половин с integrated hinge beam; станции условные.
    latchStations: [1.14, 1.52, 1.92],
    hingeStations: [1.15, 1.55, 1.94],
    forwardMountLabel: "Передняя подвеска с боковой тягой.",
    rearMountLabel: "Задняя подвеска с центральной и тангенциальными тягами и уравнительной балкой.",
    cowlLabel: "Две створки капота вентилятора со встроенной шарнирной балкой.",
    cowlPanels: "halves",
    rearLinks: 3,
    rearRocker: true,
    cowlHingeBeam: true,
  },
} satisfies Record<"cfm3b2" | "leap1b", PylonSpec>;
