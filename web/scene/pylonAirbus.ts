import type { PylonSpec } from "./pylonGeometry.ts";

// Fixed engine-to-pylon installations, shared by the applicable A319/A320/A321
// engine family. Inlet/axis/wing datums come from the particular aircraft.
// Every metric station and fairing dimension below is an illustrative fit to
// this model, not an AMM/IPC dimension. See docs/engines/pylons-airbus.md.
export const airbusPylons = {
  cfm5b: {
    noseX: .74,
    shoulderX: 1.70,
    noseRise: .025,
    shoulderRise: .24,
    halfWidth: .19,
    aftWingFraction: .20,
    // CFMI CTC-235 pp40–43: fan-frame forward beam/crossbeam and two short
    // thrust links; a distinct three-link aft mount on the turbine rear frame.
    // AC A319 2-12-0 figs019/052 locate the fan/TRF envelopes. Conversion
    // from fan flange to our fan-face datum remains an illustrative offset.
    frontMount: [1.88, .910, .24],
    rearMount: [3.35, .510, .16],
    // Contacts measured on the current simplified case/primary duct. Local
    // frame sectors bridge these to the reference frame envelopes above.
    frontCaseContact: .537,
    rearCaseContact: .500,
    rearLinks: 3,
    wingAttachment: "airbus",
    thrustLinks: "paired",
    thrustCase: [1.88, .910, .24],
    thrustTo: "front",
    // Fixed fan cowl only, inside x=.93…2.23. The four working reverser doors
    // retain their own motion; decorative seams/latches do not cross them.
    latchStations: [1.12, 1.61, 2.07],
    hingeStations: [1.15, 1.56, 2.02],
    cowlPanels: "halves",
    forwardMountLabel: "Опорная балка и две короткие тяги на силовом корпусе вентилятора.",
    rearMountLabel: "Поперечина и три тяги на заднем силовом корпусе турбины.",
    cowlLabel: "Две створки капота вентилятора. Каждая крепится к пилону на трёх петлях. Снизу створки соединяют три замка.",
  },
  leap1a: {
    noseX: .88,
    shoulderX: 1.94,
    noseRise: .025,
    shoulderRise: .30,
    halfWidth: .22,
    aftWingFraction: .21,
    // The LEAP forward support is on the FAN HUB rear flange at twelve
    // o'clock, not the outer fan case. The paired links land on hub fairings
    // at approximately two/ten o'clock. Seats share the local fan-hub frame;
    // link lengths and their axial inclination are not dimensioned here.
    frontMount: [2.13, .58, .12],
    rearMount: [4.10, .542, .13],
    frontCaseContact: .459,
    rearCaseContact: .433,
    rearLinks: 2,
    rearStandby: true,
    wingAttachment: "airbusNeo",
    thrustLinks: "paired",
    thrustCase: [2.13, .58, .5023],
    thrustTo: "front",
    // Two pylon hinges per door plus the separate forward common tie link.
    // All are inside fixed fan-cowl bounds x=1.10…2.32, before the transcowl.
    latchStations: [1.26, 1.75, 2.18],
    hingeStations: [1.58, 2.10],
    cowlTieBarX: 1.24,
    cowlPanels: "halves",
    forwardMountLabel: "Кронштейн, балансир и две тяги на заднем фланце корпуса опоры вентилятора.",
    rearMountLabel: "Две рабочие тяги и центральный страховочный палец на заднем силовом корпусе турбины.",
    cowlLabel: "У каждой створки две петли на пилоне. Спереди створки соединяет общая шарнирная связь, снизу — три замка.",
  },
} satisfies Record<"cfm5b" | "leap1a", PylonSpec>;
