import assert from 'node:assert/strict';
import { test } from 'node:test';
import { auditBaseConstraints } from '../scripts/audit-base-constraints.ts';
import { AIRCRAFT } from '../web/aircraftCatalog.ts';
import { contextFor } from '../src/aircraft/contextFor.ts';
import { evaluate, DEFAULT_MISSION } from '../src/evaluate.ts';
import { dragBuildup } from '../src/drag.ts';
import { isa } from '../src/atmosphere.ts';
import { bypassRatio, nacelleRaise, thrustRating } from '../src/levers.ts';
import { constraintTints } from '../web/constraintPresentation.ts';

const byId = (e: ReturnType<typeof evaluate>, id: string) => e.constraints.find(c => c.id === id)!;

test('all 13 UI baseline configurations retain both mass points and explicit model limitations', () => {
  const reports = auditBaseConstraints();
  assert.equal(reports.length, 13);
  for (const r of reports) {
    assert.deepEqual(r.tints, {}, r.id + ': no baseline aggregate is declared faulty');
    assert.ok(r.missionOeiPct > 2.4, r.id);
    assert.notEqual(r.missionCd0, r.cruiseCd0, r.id + ': takeoff must not reuse cruise drag');
  }
  for (const id of ['a319ceo', 'b757-200-rb', 'b757-200-pw']) {
    const r = reports.find(r => r.id === id)!;
    assert.ok(r.mtowOeiPct < 2.4, id + ': the unresolved MTOW discrepancy must not disappear');
    assert.equal(r.constraints.find(c => c.id === 'oei-mtow')!.status, 'warning');
  }
});

test('OEI uses mission mass and low-speed component drag without changing the cruise calibration', () => {
  const d = AIRCRAFT['b757-200-pw'], ctx = contextFor(d), e = evaluate(d, [], ctx);
  const mach = e.oei.v2Ms / isa(0).speedOfSoundMs;
  const expectedCd0 = dragBuildup(d, mach, 0).cd0 * ctx.aero.cd0Factor!;
  assert.ok(Math.abs(e.oei.cd0 - expectedCd0) < 1e-12);
  assert.ok(Math.abs(e.oei.gradient - (e.oei.thrustN / (e.oei.massKg * 9.80665) - 1 / e.oei.ld)) < 1e-12);
  const longer = evaluate(d, [], ctx, { ...DEFAULT_MISSION, distanceNm: 1500 });
  assert.ok(longer.oei.massKg > e.oei.massKg);
  assert.ok(longer.oei.gradient < e.oei.gradient);
  assert.equal(longer.oeiAtMtow.gradient, e.oeiAtMtow.gradient);
});

test('documented installed 757 ratings are not replaced by larger bare engine values', () => {
  assert.equal(AIRCRAFT['b757-200-rb'].engine.takeoffThrustKn, 39610 * 4.44822 / 1000);
  assert.equal(AIRCRAFT['b757-200-pw'].engine.takeoffThrustKn, 37530 * 4.44822 / 1000);
});

test('empirical BPR domain checks both endpoints only when the relation is used', () => {
  for (const id of ['b737-300','b757-200-rb','tu214-ps90a']) {
    const d = AIRCRAFT[id], ctx = contextFor(d);
    assert.equal(byId(evaluate(d, [], ctx), 'bpr-range').status, 'info');
    assert.equal(byId(evaluate(d, [bypassRatio(8)], ctx), 'bpr-range').status, 'warning');
  }
  const d = AIRCRAFT.a320ceo, ctx = contextFor(d);
  assert.equal(byId(evaluate(d, [bypassRatio(11)], ctx), 'bpr-range').status, 'ok');
  assert.equal(byId(evaluate(d, [bypassRatio(12.5)], ctx), 'bpr-range').status, 'warning');
});

test('own-type clearance references preserve uncertainty and still flag reduced clearance and contact', () => {
  assert.equal(contextFor(AIRCRAFT['b737-8']).constraintsRef.provenMinClearanceM, .43);
  assert.equal(contextFor(AIRCRAFT['tu214-ps90a']).constraintsRef.provenMinClearanceM, undefined);
  assert.equal(contextFor(AIRCRAFT.a321ceo).constraintsRef.provenMinClearanceM, .599);
  for (const id of ['a320ceo','b737-8','tu214-ps90a']) {
    const d = AIRCRAFT[id], ctx = contextFor(d);
    const reduced = evaluate(d, [nacelleRaise(-.1)], ctx);
    assert.equal(byId(reduced, 'nacelle-clearance').status, 'warning');
    assert.equal(constraintTints(reduced.constraints).get('nacelles'), 'warn');
    const touching = evaluate(d, [nacelleRaise(-2)], ctx);
    assert.equal(byId(touching, 'nacelle-clearance').status, 'violation');
    assert.equal(constraintTints(touching.constraints).get('nacelles'), 'bad');
  }
});

test('insufficient mission thrust and unreachable range remain real calculation violations', () => {
  const d = AIRCRAFT.a320ceo, ctx = contextFor(d);
  const weak = evaluate(d, [thrustRating(35)], ctx);
  assert.equal(byId(weak, 'oei-climb').status, 'violation');
  assert.equal(constraintTints(weak.constraints).get('engines'), 'bad');
  const impossible = evaluate(d, [], ctx, { ...DEFAULT_MISSION, distanceNm: 20000 });
  assert.equal(byId(impossible, 'mission-distance').status, 'violation');
});
