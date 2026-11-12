# Aircraft Designer — Tu-214 cleanup + UI consistency

**Scope:** presentation, shape/label fidelity, diagnostic OEI indication. This is **not** a performance/TSFC/weight recalibration.

## Included

1. **Tu-214 names:** no `β` marker in the type switch, variant list or aircraft labels. The methodology still explicitly notes that the model is not validated against full Tu-214 RLE performance tables.
2. **Math rendering:** the `Как рассчитано` page uses a single validated KaTeX/MathML render path for formulas and numeric substitutions; malformed expressions are logged and show a neutral readable notice instead of raw red TeX. Two long mass substitutions were rewritten in KaTeX-safe notation. Plain MathML output is retained for the offline single-HTML build (no extra font assets).
3. **Passport:** right-hand panel has a small collapsed passport of the *unchanged baseline definition*: seats, MTOW/MLW/MZFW, model OEW, fuel at model density, cruise Mach and engine. Unsupported maximum seat counts are explicitly marked unconfirmed. The open/closed state is retained when recalculating.
4. **KPI text:** long baseline names no longer spill into `Топливо на место`. The label says `как у базы · N мест`, with full aircraft name in the source catalogue.
5. **Wing finish:** ICAO code D is not a defect and no longer repaints the whole wing box/tips via the warning overlay. This was why the Tu-214 wing looked like cream-coloured composite. True structural/material levers still produce their own colors.
6. **OEI:** for two-engined Tu-214/PS-90A an **independent diagnostic** estimates second-segment gradient with the 17,500 kgf one-off emergency rating (max 3 minutes). The nominal 16,000 kgf OEI result is also shown. If the threshold 2.4% is passed only on emergency rating, status is `warning`, not a red `violation` and not unconditional green certification. Normal mission, engine definition and fuel costs do **not** use the emergency rating. Source: PS-90A FATA-02074 data sheet; applicability to an approved Tu-214 OEI flight procedure remains unverified.

## Numeric regression

`mission_before.json` and `mission_after.json` were compared for the 11 aircraft definition/variant IDs in the supplied snapshot, with **exact** equality for OEW, mission fuel, trip fuel, range, cruise TSFC and ordinary (non-emergency) OEI gradient. Only the extra optional emergency gradient and the constraint display/status for the Tu-214 change.

- Tu-214 OEI at 16,000 kgf: ~1.93%.
- Tu-214 *estimated* OEI at 17,500 kgf: ~3.01%.
- Required second-segment gradient: 2.4% (two-engine aircraft); no certified performance calculation is claimed here.

## Acceptance checklist

- Switch both Tu-214 weight presets: no beta symbols; base passport shows OEW 59.00/61.83 t and MZFW 84.20 t.
- Toggle passport open/closed; change levers: baseline passport stays unchanged and its disclosure state persists.
- Open `Как рассчитано`, both in dark/light themes: mass and engine substitutions must appear as mathematical notation, not red literal `\\text{}`. Report any neutral formula error messages and browser console errors for follow-up.
- Tu-214 top/side/3⁄4 front: no beige filled wing box; wing tips upturned without lower A320 fence; cockpit glass and frames match the prior visual patch.
- A320 and 757 keep their original wings/glazing/materials; natural ICAO code-D wings are not tinted.
- OEI card: Tu-214 1.9% normal / ~3.0% emergency; one-off, 3-minute limit; status **warning**. A320 and 757 unchanged.
- Run `npm ci && npm test && npm run typecheck && npm run build` on the real development machine before pushing; build and full Three.js tests were unavailable in the authoring runtime due to missing installed dependencies.

## Base patch variant

- `Consolidated-After-Factory`: includes **previous Tu-214 Visual v1** and these cleanup changes, applies to repository **after** `Aircraft-Designer-Tu214-Factory-Operational` but **without** visual patch.
- `Incremental-After-Visual`: applies **after** `Aircraft-Designer-Tu214-Visual-v1.patch`, and contains *only* this cleanup.
- **Do not apply both variants.** Always use `git apply --check --index` before `git am`.
