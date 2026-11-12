import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isValidDesign } from '../integration/flightcost/flightcost-embed.js';
const good = {
  protocol: 'aircraft-designer/flightcost-design', version: 1,
  aircraft: { icao: 'B752', engine: 'RB211-535E4', seats: 225, cabin: [
    { class: 'economy', rows: 37, seatsPerRow: 6, pitchM: .745 },
    { class: 'economy', rows: 1, seatsPerRow: 6, pitchM: .745, lastRowSeats: 3 },
  ] },
  weights: { oew_kg: 56034, mtow_kg: 108862, mzfw_kg: 83461, mlw_kg: 89811, fuel_capacity_kg: 33508 },
};
test('FlightCost rejects unknown versions, engines, and inconsistent rows', () => {
  assert.ok(isValidDesign(good, 'B752', 'RB211-535E4'));
  assert.equal(isValidDesign(good, 'B752', 'PW2037'), false);
  assert.ok(isValidDesign(good, 'B752', ['RB211-535E4', 'PW2037']));
  assert.equal(isValidDesign({ ...good, version: 2 }, 'B752', 'RB211-535E4'), false);
  assert.equal(isValidDesign({ ...good, aircraft: { ...good.aircraft, seats: 226 } }, 'B752', 'RB211-535E4'), false);
  assert.equal(isValidDesign({ ...good, weights: { ...good.weights, mzfw_kg: 1000 } }, 'B752', 'RB211-535E4'), false);
});
