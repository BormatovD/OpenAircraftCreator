# FlightCost page work for its repository

This is the **second-repository** task list, not a claim that it is already deployed.

1. Inspect the current `flightcostapp/seo.py` type page renderer and current `deploy/` process. Insert the 3D button for supported types in `/<lang>/type/<ICAO>` using `flightcost-embed.js`. If the current engine is not modelled, display a clearly marked alternative or unsupported note; no silent fallback.
2. Introduce a server-side route in the existing Python app which checks the user's current workspace ownership and CSRF token; validate its payload using `bridge_validator.py`; create a guest-owned custom aircraft without modifying the `aircraft` public facts catalog.
3. Ensure the resulting model's seat count in every FlightCost economics call comes from the **saved cabin zones**, never the ICAO default. Preserve the model's source and burn tier; when no fuel burn method applies, show 'not available' instead of manufacturing a forecast.
4. Return a real saved identifier and calculate a user-chosen route using that identifier. The exact URL shape will be determined by inspecting FlightCost's workspace parser; no endpoints were invented here.
5. Test concurrent guests, CSRF rejection, cross-origin spoofed messages, unknown engines, invalid rows, workspace retention after reference-data publication, and all 3 supported languages.
6. Preserve existing `/<lang>/type/<ICAO>` SEO/canonicals/sitemap and IndexNow. Embed should be enhancement, not replace server-rendered type content.
