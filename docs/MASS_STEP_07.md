# Step 07 — 757-200 operating empty weight: reference comparability before calibration

**Scope:** diagnostic only. No changes to the Raymer formulas, model coefficients, aircraft definitions, TSFC or mission results.

## 1. Sources and definition of the comparable mass

Boeing, *757-200/-300 Airplane Characteristics for Airport Planning*, **D6-58327, Rev H, December 2024**:

- PDF p. **15** (section 2.1): definition of **Operating Empty Weight (OEW)**. Includes structure, powerplant, furnishings, equipment and specified operational items; excludes usable fuel and payload.
- PDF p. **16** (section **2.1.1**): 757-200 **RB211**, typical `SPEC OPERATING EMPTY WEIGHT` values and weight variants.
- PDF p. **17** (section **2.1.2**): 757-200 **PW2037/PW2040**, same format.
- Both tables warn that weights are typical *as-delivered or as-offered* configurations and tell the reader to consult the airline for actual weights.

### Published OEW, kg

| MTOW, lb | 220,000 | 230,000 | **240,000** | 250,000 | 255,000 |
|---|---:|---:|---:|---:|---:|
| RB211 | 60,822 | **56,748** | **60,001** | 62,114 | 62,114 |
| PW2037/PW2040 | 58,232 | **59,352** | **59,357** | 59,363 | 59,363 |

**Do not treat the five columns as a single airframe with increasing MTOW.** In particular, RB211 published OEW changes by **3,253 kg** between the 230k and 240k columns. A mere 10,000 lb change in certified MTOW does not establish that the increase is purely structural; the source does not provide a matching configuration list.

## 2. Computed snapshot: A320-calibrated mass model, no retuning

The active definitions `src/aircraft/b757.ts` specify **MTOW 240,000 lb (108,862 kg)**. Calibration is based solely on A320ceo OEW 41,244 kg; the remaining system architecture inherits some A320 system assumptions. Reproduction command:

```bash
node --experimental-strip-types scripts/audit-b757-mass.ts > b757-mass-local.json
```

Expected values on the reviewed source snapshot (rounded):

| Variant | Model OEW | Boeing 240k OEW | Model minus Boeing |
|---|---:|---:|---:|
| RB211-535E4 | 55,991 kg | 60,001 kg | **−4,010 kg (−6.68%)** |
| PW2037 | 56,102 kg | 59,357 kg | **−3,255 kg (−5.48%)** |

For reference only: against the *different* RB211 **230,000 lb** column (56,748 kg), the unchanged 240k model differs by merely −757 kg (−1.33%). This is **not a valid 230k MTOW validation**, but a demonstration that assumptions about the reference equipment configuration may dominate the apparent shortfall.

The 240k reference reports **RB211 heavier than PW by 644 kg**. Our model predicts **RB211 lighter by about 111 kg**. The sign is reversed; but a 755 kg gap cannot automatically be attributed to engine dry mass, because the source is not a controlled two-engine comparison of an otherwise identical airplane.

### Model mass groups for RB211 (kg)

| Group | Model |
|---|---:|
| Structure: wing, fuselage, empennage, landing gear, nacelles | 32,105 |
| Propulsion: dry engines, controls/starter, fuel system | 7,271 |
| Systems: controls, hydraulics, electrical, air conditioning, etc. | 7,024 |
| Furnishings | 5,395 |
| Operator items | 4,195 |
| **Total** | **55,991** |

Selected leaves: wing 11,332; fuselage 11,666; main landing gear 4,142; nacelles/pylons 1,249; both **dry** RB211 engines 6,590; electrical 2,467; air conditioning 876 kg. These are the model's estimates, *not* Boeing component weights.

## 3. Where to look for the discrepancy

1. **Reference configuration / definition.** Establish the exact weight variant (MTOW, equipment list, cabin and operational items). A manufacturer-published typical OEW is not a weight report for a named serial number.
2. **Installed powerplant versus engine dry weight.** Current engine mass node counts **dry** engines and separate nacelles/pylons; the OEM OEW includes more installation items. Check that no items are omitted or double-counted before modifying engine factors.
3. **System extrapolation.** The 757 definition inherits from A320 several quantities including the generator system, APU uninstalled mass, avionics assumptions, EWIS shares and flight-control functions. They are useful model proxies, not type-specific Boeing values.
4. **Cabin / operator items.** The model has 186 seats, A320-derived seat pitch and scaled operator items. These may not match either 757 column's as-delivered interior.
5. **Structure / wing / gear.** Raymer equations are calibrated by A320-group shares based on an actual 737-200 analogue. Independent 757 component mass data would be needed to attribute any structural deficit.

## 4. Proposed acceptance criteria and next step

- Preserve the current mass model and all 757 range validations; **do not multiply all 757 structural components by 1.06**.
- Attach a versioned configuration ID to each manufacturer comparison before declaring model error.
- Obtain if possible one **757-200 Weight & Balance / empty weight report** with definition of included operational items, equipment inventory, specific engine, cabin layout and MTOW. Even a reliable group-level mass buildup is useful; do not seek proprietary material inappropriately.
- Only after matching the reference: change the **smallest** attributable engineering group, then rerun A320, 737, 757 and mission validations. Preserve uncorrected numbers alongside revisions.

**What we do now:** use the script to confirm the mass tree is exactly reproducible in the user's current repository. Keep a baseline JSON and discuss which OEM column is an actual matching configuration; no mathematical retuning yet.
