import { AIRCRAFT_CHOICES, aircraftForType, typeOf, variantsFor } from "./aircraftCatalog.ts";

type PickerOption = HTMLButtonElement;

function option(text: string, current: boolean): PickerOption {
  const button = document.createElement("button");
  button.type = "button";
  button.tabIndex = -1;
  button.setAttribute("role", "menuitemradio");
  button.setAttribute("aria-checked", String(current));
  button.textContent = text;
  return button;
}

/** Keep FlightCost links, scenarios and manual selections on the same catalogue id. */
export function bindAircraftPickers(currentId: () => string, pick: (id: string) => void): () => void {
  const root = document.getElementById("model-pickers")!;
  const airframe = root.querySelector<HTMLButtonElement>("#aircraft-picker")!;
  const engine = root.querySelector<HTMLButtonElement>("#engine-picker")!;
  const weights = root.querySelector<HTMLElement>("#weight-options")!;
  const engines = root.querySelector<HTMLElement>("#engine-choices")!;
  let openTrigger: HTMLButtonElement | null = null;
  const menu = (trigger: HTMLButtonElement) => document.getElementById(trigger.getAttribute("aria-controls")!)!;
  const close = () => {
    if (!openTrigger) return;
    menu(openTrigger).hidden = true;
    openTrigger.setAttribute("aria-expanded", "false");
    openTrigger = null;
  };
  const items = (trigger: HTMLButtonElement) => Array.from(menu(trigger).querySelectorAll<PickerOption>('[role="menuitemradio"]'))
    .filter(item => !item.closest("[hidden]"));
  function open(trigger: HTMLButtonElement, last = false) {
    close();
    openTrigger = trigger;
    trigger.setAttribute("aria-expanded", "true");
    menu(trigger).hidden = false;
    const choices = items(trigger);
    const selected = choices.find(item => item.getAttribute("aria-checked") === "true");
    (last ? choices.at(-1) : selected ?? choices[0])?.focus();
  }
  for (const trigger of [airframe, engine]) {
    trigger.addEventListener("click", () => openTrigger === trigger ? close() : open(trigger));
    trigger.addEventListener("keydown", event => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        open(trigger, event.key === "ArrowUp");
      }
    });
    menu(trigger).addEventListener("click", event => {
      const item = (event.target as HTMLElement).closest<PickerOption>('[role="menuitemradio"]');
      if (!item) return;
      const id = item.dataset.type ? aircraftForType(item.dataset.type, currentId()) : item.dataset.variant ?? item.dataset.weightPreset;
      close();
      trigger.focus();
      if (id) pick(id);
    });
    menu(trigger).addEventListener("keydown", event => {
      if (event.key === "Escape" || event.key === "Tab") {
        close();
        trigger.focus();
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const choices = items(trigger);
      const index = choices.indexOf(document.activeElement as PickerOption);
      const step = event.key === "ArrowUp" ? -1 : 1;
      const next = event.key === "Home" ? 0 : event.key === "End" ? choices.length - 1 : (index + step + choices.length) % choices.length;
      choices[next].focus();
    });
  }
  function dismissOutside(event: Event) {
    if (openTrigger && !openTrigger.contains(event.target as Node) && !menu(openTrigger).contains(event.target as Node)) close();
  }
  document.addEventListener("pointerdown", dismissOutside);
  document.addEventListener("focusin", dismissOutside);

  return () => {
    const id = currentId();
    const current = AIRCRAFT_CHOICES[id];
    const type = typeOf(id);
    const ids = variantsFor(type);
    const describe = (trigger: HTMLButtonElement, label: string) => {
      trigger.title = label;
      trigger.setAttribute("aria-label", label);
    };
    describe(airframe, `Выбрать ВС · ${current.label}`);
    describe(engine, `Выбрать МСУ · ${current.definition.engine.name}`);
    for (const choice of root.querySelectorAll<PickerOption>("[data-type]")) {
      choice.setAttribute("aria-checked", String(choice.dataset.type === type));
    }
    weights.hidden = type !== "tu214";
    for (const old of weights.querySelectorAll("button")) old.remove();
    if (!weights.hidden) {
      for (const preset of ids) {
        const choice = option(AIRCRAFT_CHOICES[preset].variantLabel, preset === id);
        choice.dataset.weightPreset = preset;
        weights.append(choice);
      }
    }
    engines.replaceChildren();
    // Both Tu-214 weight presets share one PS-90A. Keep the chosen weight when inspecting the engine.
    for (const variant of (type === "tu214" ? [id] : ids)) {
      const data = AIRCRAFT_CHOICES[variant];
      const name = data.definition.engine.name;
      const label = type === "b737" ? data.variantLabel : data.variant === "ceo" || data.variant === "neo" ? `${name} · ${data.variant}` : name;
      const choice = option(label, variant === id);
      choice.dataset.variant = variant;
      engines.append(choice);
    }
  };
}
