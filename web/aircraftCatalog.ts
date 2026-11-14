// Выбор типа и его вариантов не зависит от написания id расчётного ядра.
import { type AircraftDefinition } from "../src/definition.ts";
import { A319CEO, A319NEO, A321CEO, A321NEO } from "../src/aircraft/a320family.ts";
import { A320CEO, A320NEO } from "../src/aircraft/a320.ts";
import { B737_300 } from "../src/aircraft/b737.ts";
import { B737_800 } from "../src/aircraft/b737ng.ts";
import { B737_8 } from "../src/aircraft/b737max.ts";
import { B757_RB211, B757_PW2037 } from "../src/aircraft/b757.ts";
import { TU214_PS90A, TU214_FACTORY } from "../src/aircraft/tu214.ts";

interface AircraftChoice {
  type: string;
  variant: string;
  variantLabel: string;
  label: string;
  definition: AircraftDefinition;
}

export const AIRCRAFT_CHOICES: Record<string, AircraftChoice> = {
  a319ceo: { type: "a319", variant: "ceo", variantLabel: "ceo", label: "A319ceo", definition: A319CEO },
  a319neo: { type: "a319", variant: "neo", variantLabel: "neo", label: "A319neo", definition: A319NEO },
  a320ceo: { type: "a320", variant: "ceo", variantLabel: "ceo", label: "A320ceo", definition: A320CEO },
  a320neo: { type: "a320", variant: "neo", variantLabel: "neo", label: "A320neo", definition: A320NEO },
  a321ceo: { type: "a321", variant: "ceo", variantLabel: "ceo", label: "A321ceo", definition: A321CEO },
  a321neo: { type: "a321", variant: "neo", variantLabel: "neo", label: "A321neo", definition: A321NEO },
  "b737-8": { type: "b737", variant: "neo", variantLabel: "MAX 8 · LEAP-1B", label: "737-8", definition: B737_8 },
  "b737-300": { type: "b737", variant: "classic", variantLabel: "737-300 · CFM56-3B2", label: "737-300", definition: B737_300 },
  "b737-800": { type: "b737", variant: "ng", variantLabel: "737-800 · CFM56-7B26", label: "737-800", definition: B737_800 },
  "b757-200-rb": { type: "b757", variant: "rb", variantLabel: "RB211-535E4", label: "757-200 / RB211", definition: B757_RB211 },
  "b757-200-pw": { type: "b757", variant: "pw", variantLabel: "PW2037", label: "757-200 / PW2037", definition: B757_PW2037 },
  "tu214-ps90a": { type: "tu214", variant: "operational", variantLabel: "Эксплуатац. · 61,83 т", label: "Ту-214 / ПС-90А · эксплуатационный", definition: TU214_PS90A },
  "tu214-ps90a-factory": { type: "tu214", variant: "factory", variantLabel: "Заводской · 59,0 т", label: "Ту-214 / ПС-90А · заводской", definition: TU214_FACTORY },
};

export const AIRCRAFT: Record<string, AircraftDefinition> = Object.fromEntries(Object.entries(AIRCRAFT_CHOICES).map(([id, a]) => [id, a.definition]));
export const AIRCRAFT_LABEL: Record<string, string> = Object.fromEntries(Object.entries(AIRCRAFT_CHOICES).map(([id, a]) => [id, a.label]));
export const typeOf = (id: string): string => AIRCRAFT_CHOICES[id].type;
export const variantsFor = (type: string): string[] => Object.keys(AIRCRAFT_CHOICES).filter((id) => typeOf(id) === type);

/** При переходе внутри семейства сохраняем поколение/двигатель, иначе берём первый доступный вариант. */
export function aircraftForType(type: string, currentId: string): string | undefined {
  const ids = variantsFor(type);
  const variant = AIRCRAFT_CHOICES[currentId]?.variant;
  return ids.find((id) => AIRCRAFT_CHOICES[id].variant === variant) ?? ids[0];
}
