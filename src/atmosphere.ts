// Международная стандартная атмосфера (МСА), тропосфера + нижняя стратосфера до 20 км.

export const G0 = 9.80665; // м/с²
const R_AIR = 287.05287; // Дж/(кг·К)
const GAMMA = 1.4;
const T0 = 288.15; // К
const P0 = 101325; // Па
const LAPSE = 0.0065; // К/м
const H_TROPO = 11000; // м

export const FT = 0.3048;
export const NM = 1852;

export interface AtmosphereState {
  altitudeM: number;
  temperatureK: number;
  pressurePa: number;
  densityKgM3: number;
  speedOfSoundMs: number;
}

export function isa(altitudeM: number): AtmosphereState {
  let t: number;
  let p: number;
  if (altitudeM <= H_TROPO) {
    t = T0 - LAPSE * altitudeM;
    p = P0 * Math.pow(t / T0, G0 / (LAPSE * R_AIR));
  } else {
    const tTropo = T0 - LAPSE * H_TROPO;
    const pTropo = P0 * Math.pow(tTropo / T0, G0 / (LAPSE * R_AIR));
    t = tTropo;
    p = pTropo * Math.exp((-G0 * (altitudeM - H_TROPO)) / (R_AIR * tTropo));
  }
  return {
    altitudeM,
    temperatureK: t,
    pressurePa: p,
    densityKgM3: p / (R_AIR * t),
    speedOfSoundMs: Math.sqrt(GAMMA * R_AIR * t),
  };
}

export function flightLevelToM(fl: number): number {
  return fl * 100 * FT;
}
