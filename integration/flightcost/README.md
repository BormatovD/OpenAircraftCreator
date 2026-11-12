# FlightCost integration adapter — staged, NOT yet live

This folder is intended for the separate FlightCost repository. **Do not copy the entire folder to the static Aircraft Designer server.**

What works:
- `flightcost-embed.js`: tiny dependency-free embed for `/<lang>/type/<ICAO>`; generates a strict-origin iframe URL and checks the exported design before calling a same-origin callback.
- `bridge_validator.py`: additional server-side validation before storing a guest-owned custom aircraft.
- Aircraft Designer serves a common, versioned type/engine/seat catalog at `/aircraft-configurations.v1.json`.

What still needs an actual FlightCost repository change:
- Import the JS into `flightcostapp/seo.py` (or whichever current function generates type pages). The code is deliberately NOT auto-injected without inspecting the current HTML renderer.
- Supply `saveDesign`: an authenticated/CSRF-protected callback to the **existing guest workspace** storage in `site/data/user.db`. Do not write to the public `aircraft` source catalog, and never write directly to `master`.
- Return a real workspace record id only after commit. Use that id when deep-linking into `/<lang>/calc?o=EDDF&d=LEBL&ac=USER:<id>` (actual workspace identifier/route syntax must be checked in the current FlightCost source; this URL shape is not asserted to work).
- Calculation: pass `seats=design.aircraft.seats` plus exact mass limits to the already-existing FlightCost type model; preserve its burn-tier/anchor provenance. Reject unsupported fuel model instead of deriving one from geometry alone.

Example after including `flightcost-embed.js` as a locally served module:

```js
import { mountAircraftDesigner } from '/static/flightcost-embed.js';
mountAircraftDesigner({
  container: document.querySelector('#aircraft-designer-container'),
  icao: 'B752', engine: 'RB211-535E4', layoutId: 'b752-186',
  supportedEngines: ['RB211-535E4', 'PW2037'], // switch of engine allowed only for this type
  // Save callback is required for real persistence:
  // saveDesign: (design) => yourExistingGuestWorkspaceSaveFunction(design),
});
```

For `A20N` the current Aircraft Designer only models `LEAP-1A`.
PW1127G-JM is NOT interchangeable and should be shown as unavailable until modelled.

Do not claim that a postMessage acknowledgement or copy-to-clipboard means that the FlightCost database has saved the design.

## Stage 1.1 correction / non-module option

For a server-rendered FlightCost page that must NOT introduce JavaScript modules,
serve `flightcost-embed.nomodule.js` as an ordinary script. It registers
`window.AircraftDesignerFlightCost.mount(options)`. See
`INTEGRATE_WITHOUT_MODULES.md`. Do not confuse this file with the older ESM
`flightcost-embed.js`; both implement the same cross-origin protocol.

FlightCost's Tu-214 ICAO type code is `T204` (former Stage-1 `T214` deep links
are accepted as an alias); Tu-214 engine `PS-90A` is an alternate spelling of
Designer `ПС-90А` only. A320ceo/ A321ceo high-density neo layouts are removed.
