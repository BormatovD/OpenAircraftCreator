# Tu-214: cockpit, native winglets, and PS-90A OEI diagnostic

## Scope

This patch changes the **visual model only**, plus an independent OEI *diagnostic script*;
**no production thrust, mass, drag or mission physics is changed**.

- `tu214-shapes.json` is regenerated from the parametric `tools/tu214_shapes.py`.
  Tu-214 windshield and side windows are an **approximate reconstruction from the
  owner's photograph**. They do not constitute measured aircraft drawings.
- `cockpitGlazing` renders dark panes and a separate light-coloured frame for
  Tu-214; existing glazing of other aircraft uses the original logic.
- The ordinary A320 *fence* is replaced by a fixed upward-bent Tu-214 tip
  (`wing.tip = "blended"`). No A320 "sharklets" control is shown for Tu-214.
  The first visual shape is a tapered, nearly vertical panel; its precise
  curvature/attachment is still approximate and may need another visual pass.
- The published wing span, mass of winglets, OEW, payload, aerodynamics,
  reserve policy and A320-derived model results are unchanged.

## PS-90A OEI second-segment question

**Documented engine rating:** the Russian certificate type data sheet
`FATA-02074`, edition 2, describes `ПС-90А` *maximum* rating as **16,000 kgf**
and *one-time emergency* rating as **17,500 kgf**, with continuous emergency
rating limited to **3 minutes** (see pp. 2 and 16 of the PDF).

Source: <https://favt.gov.ru/public/ododoc/%D0%9E%D0%94%D0%9A-%D0%90%D0%92%D0%98%D0%90%D0%94%D0%92%D0%98%D0%93%D0%90%D0%A2%D0%95%D0%9B%D0%AC/%D0%9F%D0%A1-90%D0%90/%D0%9A%D0%94%D0%A1%D0%A2_FATA-02074_%D0%B8%D0%B7%D0%B4.2.pdf>

Another source (patent RU2306446C1) describes automatic increased thrust for the
remaining PS-90A in the event of an engine failure during takeoff, and references
Tu-214 engine/flight tests: <https://patents.google.com/patent/RU2306446C1/ru>.
This is useful supporting context, but **not an approved aircraft performance table**.

AP-25.121(b), two-engine aircraft: required second-segment climb gradient
**2.4%** with gear retracted, takeoff wing configuration, at V2. The current
simplified code evaluates `gradient = T_remaining/W - CD/CL` at modeled V2 and
MTOW; it lacks approved drag, engine-installation, anti-ice, bleed, certification
reference conditions and detailed thrust map.

Run `node --experimental-strip-types scripts/audit-tu214-oei.ts > tu214-oei-local.json`.
At nominal max rating 16,000 kgf the **model** gives approximately **1.93%**;
at 17,000 kgf **2.65%**; at nominal emergency 17,500 kgf **3.01%**.
Even the **17,150 kgf** rating (17,500 × 0.98) gives about **2.76%**.
These estimates apply a common speed-dependent lapse to each rating and are
not certified airworthiness findings.

The displayed red violation remains unchanged until the application can
explicitly represent a legally applicable OEI engine rating and its time limit,
with a source-specific disclaimer. Do not overwrite the **normal** engine
rating with an emergency rating: doing so would distort mission performance.

## Still needed

- Approved Tu-214 second-segment OEI data, V2, climb thrust, anti-ice/bleed,
  and rated emergency thrust schedule in the relevant Tu-214 RLE or AFM.
- More detailed close-up photographs of the cockpit frontal glazing, window
  frame geometry and wingtip transition, ideally with a dimensional drawing.

## Verification

- `node --experimental-strip-types --test test/tu214-visual.test.ts`
- `npm test && npm run typecheck && npm run build` on the user's machine.
- `test/tu214-scene.test.ts` requires `three`; registry unavailable in the
  isolated assembly environment, so actual 3D appearance remains to be checked.
