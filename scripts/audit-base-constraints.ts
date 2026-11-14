import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { AIRCRAFT } from '../web/aircraftCatalog.ts';
import { defaults, leversFor } from '../web/controls.ts';
import { layoutFor, withCabinLayout } from '../src/integration/flightcost.ts';
import { evaluateConfiguration } from '../src/integration/configuration.ts';
import { contextFor } from '../src/aircraft/contextFor.ts';
import { evaluate } from '../src/evaluate.ts';
import { constraintTints, isReferenceConstraint } from '../web/constraintPresentation.ts';

export function auditBaseConstraints() {
  assert.equal(Object.keys(AIRCRAFT).length, 13);
  return Object.entries(AIRCRAFT).map(([id, definition]) => {
    const layout = layoutFor(id);
    const d = layout ? withCabinLayout(definition, layout) : definition;
    const levers = leversFor(d, defaults(d));
    assert.equal(levers.length, 0, id);
    const base = evaluate(definition, [], contextFor(definition));
    const e = evaluateConfiguration(d, levers, 'fixed', base).ev;
    assert.ok(e.missionResult.feasible, id + ': base mission must be feasible');
    assert.ok(Math.abs(e.oei.massKg - e.oewKg - e.payloadKg - e.missionFuelKg) < 1e-6, id + ': mission mass balance');
    assert.equal(e.oeiAtMtow.massKg, d.weights.mtowKg);
    const active = e.constraints.filter(c => !isReferenceConstraint(c));
    assert.equal(active.filter(c => c.status === 'violation').length, 0, id + ': unexpected active violation');
    assert.ok(e.constraints.some(c => c.id === 'oei-mtow' && c.kind === 'model'), id + ': MTOW estimate must remain visible');
    assert.match(e.constraints.find(c => c.id === 'bpr-range')!.message, /не применялась/);
    return { id, takeoffMassKg: e.oei.massKg, mtowKg: e.oeiAtMtow.massKg,
      missionOeiPct: e.oei.gradient * 100, mtowOeiPct: e.oeiAtMtow.gradient * 100,
      missionCd0: e.oei.cd0, mtowCd0: e.oeiAtMtow.cd0, cruiseCd0: e.aero.cd0,
      tints: Object.fromEntries(constraintTints(e.constraints)), constraints: e.constraints };
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify({ bases: auditBaseConstraints() }, null, 2));
}
