# Step 08 — Boeing 757: sensitivity without masking the configuration mismatch

**Status:** diagnostic only. No changes to structural weight equations, aircraft definitions, calibration, TSFC or mission integration.

## Evidence and boundary of this audit

- Primary reference: Boeing, *757-200/-300 Airplane Characteristics for Airport Planning*, **D6-58327 Rev H (December 2024)**, PDF pages 15–17, 757-200 RB211/PW weight columns. These are typical *as-delivered/as-offered* OEW estimates, **not** controlled changes of a single configured airplane.
- Reproduced computation: `scripts/audit-b757-mass.ts`, calibrated to the A320ceo reference of **41,244 kg**. User's run `b757-mass-local.json` matches 55,990.790 kg (RB211) and 56,101.519 kg (PW2037).
- New report: `scripts/audit-b757-sensitivity.ts`. It deliberately does **not** solve the weight shortfall by fitting coefficients; it changes only one input at a time and recomputes the existing mass tree.

## Baseline versus the 240,000 lb MTOW columns

| Variant | Model OEW, kg | Boeing typical OEW, kg | Shortfall, kg | Model below Boeing |
|---|---:|---:|---:|---:|
| 757-200 RB211-535E4 | 55,990.8 | 60,001 | 4,010.2 | 6.68% |
| 757-200 PW2037 | 56,101.5 | 59,357 | 3,255.5 | 5.48% |

**Source column caution:** the RB211 230,000 lb column has OEW **56,748 kg**; compared with our unmodified 240,000 lb model it differs by only **757 kg**, but the column is not configuration-matched. **Do not** calibrate to this coincidence.

## Engine variant discrepancy: compare like with like before changing physics

In the Boeing 240k column RB211 − PW2037 OEW is **+644 kg**. Model RB211 − PW2037 is **−110.729 kg**, a disagreement of **754.729 kg**.

Nearly the entire calculated PW − RB difference comes from **+78.258 kg nacelles**, **+32.000 kg dry engines**, **+0.306 kg engine controls**, and **+0.165 kg wiring**, for ~+110.729 kg overall. The Boeing difference also includes potentially different *installed* powerplants, furnishing, equipment lists and delivered configurations. The 755 kg is **not** identifiable as engine dry weight or missing pylon weight.

## What would be required if ONLY one mass group were responsible?

Numbers in the following table are **mathematical sensitivity scenarios**, not corrections and not physically justified claims about actual 757 component masses.

| Group | RB211 group, kg | Required RB group uplift | PW group, kg | Required PW group uplift |
|---|---:|---:|---:|---:|
| Structure | 32,105 | +12.49% | 32,183 | +10.12% |
| Powerplant | 7,271 | +55.15% | 7,304 | +44.57% |
| Systems | 7,024 | +57.09% | 7,024 | +46.35% |
| Furnishings | 5,395 | +74.33% | 5,395 | +60.34% |
| Operator items | 4,195 | +95.59% | 4,195 | +77.60% |

This table shows why choosing a single global 6% factor is not an engineering explanation. If the Boeing and model definitions differ in delivered equipment, any redistribution across groups may be false.

## Local physical-input sensitivity of the existing model

The new script computes a **central finite difference** at each input's current value:

\[
 S_x \approx \frac{OEW(1.01x)-OEW(0.99x)}{0.02},\qquad
 \epsilon_x = \frac{S_x}{OEW(x)}.
\]

`S_x` is the kg change corresponding approximately to a 100% change in the input if locally linear; the JSON displays the **actual** one-sided result `OEW(1.01x)-OEW(x)` in kg, which is easier to interpret. **Do not extrapolate** the +1% result to physically large changes without a full redesign and corresponding load changes.

For RB211, +1% at a time gives (approximate):

| Input +1% | ΔOEW, kg | Caveat |
|---|---:|---|
| MTOW +1% | +144.0 | Not independently variable without changing structural design and certified variant |
| Fuselage length +1% | +128.2 | Also changes payload/seats/systems in a real redesign; this test holds them fixed |
| Wing span +1% | +119.1 | Structural response only; wing aerodynamics and mission outside scope |
| Dry engine mass +1% | +73.7 | Both engines change; includes modelled nacelle dependency |
| MLW +1% | +40.7 | Gear mass response, no weight-variant validity implied |
| Cargo design allowance +1% | +23.0 | Furnishings estimator proxy; not literal payload mass in OEW |
| Wing area +1% | +16.8 | Span held constant; aspect ratio varies automatically |
| Nacelle outer width +1% | +6.5 | No inference about installed engine structure |
| APU uninstalled mass +1% | +5.8 | A320-derived input; manufacturer mass needed |
| Avionics uninstalled mass +1% | +5.2 | A320-derived input; manufacturer mass needed |

## What we do next

1. **Freeze baseline:** archive both original `b757-mass-local.json` and `b757-sensitivity-local.json`. Do not modify any production mass coefficients yet.
2. **Audit definitions**, not scalar mass fits: verify engine/pylon/nacelle boundary; separate installed hardware from dry engine and thrust reverser, reconcile MTOW variant and operators' OEW/BOW contents.
3. **Focus source retrieval on high-value information:** 757-200 Weight & Balance manual weight buildup or one reliable empty-weight / equipment list with engine, seat arrangement, all operator items and the specific 240k weight variant. Partial installed-powerplant or group breakdown is useful; *avoid proprietary or restricted sources obtained without authorization*.
4. **Run a controlled experiment** only after selecting a matched configuration: replace a single identifiable mass assumption, re-run 757 OEW and all existing Airbus/Boeing validations, and report baseline vs result.

Reproduce locally:

```bash
node --experimental-strip-types scripts/audit-b757-sensitivity.ts > b757-sensitivity-local.json
node --test test/b757-sensitivity.test.ts
```

**Limitations:** local sensitivity, not uncertainty intervals or an optimization over feasible designs. The numerical table cannot determine which item is missing in the real 757.
