import type { PylonSpec } from "./pylonGeometry.ts";

/**
 * Installation sketches keyed to each engine. External pylon proportions and
 * the metric case stations below are illustrative: source drawings establish
 * the load path and component boundaries, but do not publish this set of
 * three-dimensional attachment coordinates.
 */
export const pylon757Tu = {
  rb211: {
    noseX: .65,
    shoulderX: 4.62,
    noseRise: .72,
    shoulderRise: .47,
    halfWidth: .20,
    wingAttachment: "boeing757",
    aftWingFraction: .18,
    // Boeing training places the forward engine mount on the intermediate
    // case; its thrust path is through this mount, so there are no separate
    // thrust links in this sketch.
    // The x positions align with the cutaway's intermediate-case band
    // (.32 L) and turbine exhaust case (.86 L); the radii seat on those
    // modeled case envelopes. They are scene coordinates, not OEM dimensions.
    frontMount: [1.30, .590, 0],
    rearMount: [3.02, .607, 0],
    thrustLinks: "none",
    latchStations: [1.28, 1.68, 2.08, 2.42],
    hingeStations: [1.20, 1.60, 2.00, 2.40],
    forwardMountLabel: "Опора на промежуточном корпусе передаёт тягу, вертикальную и боковую нагрузки.",
    rearMountLabel: "Опора на корпусе турбины воспринимает вертикальную и боковую нагрузки и крутящий момент.",
    cowlLabel: "Две створки капота вентилятора. За ними расположены две секции реверса.",
    cowlPanels: "halves",
  },
  pw2037: {
    noseX: .65,
    shoulderX: 5.02,
    noseRise: .78,
    shoulderRise: .52,
    halfWidth: .20,
    wingAttachment: "boeing757",
    aftWingFraction: .31,
    // Forward mount at the intermediate-case rear flange: centre shear pin
    // plus two thrust links. The aft mount is a three-point fitting.
    // Intermediate case (.30 L) and turbine exhaust case (.86 L), fitted to
    // the corresponding cutaway envelope rather than the fan-cowl radius.
    frontLinks: 1,
    frontMount: [1.65, .574, .24],
    rearMount: [3.55, .528, .34],
    rearLinks: 3,
    rearRocker: true,
    thrustLinks: "paired",
    thrustCase: [1.65, .574, .24],
    thrustTo: "front",
    latchStations: [1.22, 1.75, 2.08],
    hingeStations: [1.16, 1.65, 2.12],
    coreLatchStations: [3.42, 3.92, 4.36],
    coreHingeStations: [3.34, 3.84, 4.28],
    forwardMountLabel: "Центральный срезной палец и две тяги на промежуточном корпусе.",
    rearMountLabel: "Две тангенциальные тяги и одна центральная на корпусе за турбиной.",
    cowlLabel: "Две створки у вентилятора и две у газогенератора. У каждой пары свои петли и замки.",
    cowlPanels: "halves",
  },
  ps90a: {
    fairingProfile: "ps90a",
    // Photographic Tu-214 outline: a slim rounded foot grows aft along the
    // crown to a nearly straight high roof and short upper-wing saddle. Scene fit
    // parameters, not published pylon dimensions.
    noseX: .72,
    shoulderX: 3.80,
    noseRise: .52,
    shoulderRise: .60,
    halfWidth: .18,
    upperWingFraction: .14,
    aftWingFraction: .38,
    // PS-90A has forward, middle, and rear support zones. The rear three-link
    // suspension carries direct/reverse thrust; the rear bracket reaches the
    // Tu pylon beam through a paired tie-rod connection.
    // The front V-rods seat on the splitter-case envelope; the middle ring
    // sits on the high-pressure compressor case. The aft point follows the
    // modeled turbine exhaust casing. Radii are fitted to these scene bodies.
    frontMount: [1.87, .90, .30],
    frontCaseContact: .619,
    raisedRearBracket: true,
    middleMount: [2.77, .36, 0],
    middleMountLabel: "Кольцо на корпусе компрессора высокого давления соединено с кронштейном одной тягой.",
    rearMount: [4.49, .53, .32],
    rearLinks: 3,
    thrustLinks: "paired",
    thrustCase: [4.49, .53, .32],
    thrustTo: "rear",
    // The source identifies outer movable reverser fairing parts, not the
    // service-cowl split/hinge system on the fan case.
    latchStations: [],
    hingeStations: [],
    forwardMountLabel: "Две V-образные тяги соединяют разделительный корпус с силовой балкой.",
    rearMountLabel: "Три тяги соединяют силовое кольцо с кронштейном. Ещё две связывают кронштейн с пилоном.",
    cowlLabel: "Обтекатель реверса состоит из двух передних, двух задних и одной нижней панели. Разбивка капота вентилятора требует уточнения.",
    cowlPanels: "undivided",
  },
} satisfies Record<"rb211" | "pw2037" | "ps90a", PylonSpec>;
