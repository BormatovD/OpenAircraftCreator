import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../integration/flightcost/flightcost-embed.nomodule.js', import.meta.url), 'utf8');
const good = {
  protocol: 'aircraft-designer/flightcost-design', version: 1,
  aircraft: { icao: 'B752', engine: 'RB211-535E4', seats: 225, cabin: [
    { class: 'economy', rows: 37, seatsPerRow: 6, pitchM: 0.745 },
    { class: 'economy', rows: 1, seatsPerRow: 6, pitchM: 0.745, lastRowSeats: 3 },
  ] },
  weights: { oew_kg: 56034, mtow_kg: 108862, mzfw_kg: 83461, mlw_kg: 89811, fuel_capacity_kg: 33508 },
  model: { mode: 'fixed', provisional: true, controls: {} },
};

function browser() {
  const handlers = new Map();
  class FakeNode {
    constructor(tag) {
      this.tagName = tag;
      this.children = [];
      this.attributes = {};
      this.listeners = {};
      this.style = {};
      this.contentWindow = tag === 'iframe' ? { messages: [], postMessage: (m, origin) => this.contentWindow.messages.push({ m, origin }) } : undefined;
    }
    append(...children) { this.children.push(...children); }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(type, fn) { this.listeners[type] = fn; }
    remove() { this.removed = true; }
    showModal() { this.open = true; }
    close() { this.open = false; }
    click() { this.listeners.click(); }
  }
  const window = {
    addEventListener: (event, fn) => { handlers.set(event, fn); },
    removeEventListener: (event, fn) => { if (handlers.get(event) === fn) handlers.delete(event); },
  };
  vm.runInNewContext(source, { window, document: { createElement: tag => new FakeNode(tag) }, URL, Number, Array, Object, Error, String }, { filename: 'flightcost-embed.nomodule.js' });
  return { window, handlers, FakeNode };
}

test('No-module bridge validates version, engine, cabin/seat parity and masses', () => {
  const { window } = browser();
  const valid = window.AircraftDesignerFlightCost.isValidDesign;
  assert.equal(valid(good, 'B752', ['RB211-535E4', 'PW2037']), true);
  assert.equal(valid(good, 'B752', 'PW2037'), false);
  assert.equal(valid({ ...good, version: 2 }, 'B752', 'RB211-535E4'), false);
  assert.equal(valid({ ...good, aircraft: { ...good.aircraft, seats: 226 } }, 'B752', 'RB211-535E4'), false);
  assert.equal(valid({ ...good, aircraft: { ...good.aircraft, cabin: [{ ...good.aircraft.cabin[0], class: 'cockpit' }] } }, 'B752', 'RB211-535E4'), false);
  assert.equal(valid({ ...good, weights: { ...good.weights, fuel_capacity_kg: -1 } }, 'B752', 'RB211-535E4'), false);
  assert.equal(valid({ ...good, model: { provisional: false } }, 'B752', 'RB211-535E4'), false);
});

test('Only actual Designer frame + origin can save; ack follows committed ID', async () => {
  const { window, handlers, FakeNode } = browser();
  const container = new FakeNode('div');
  let calls = 0;
  let resolveSave;
  const savedPromise = new Promise(resolve => { resolveSave = resolve; });
  const instance = window.AircraftDesignerFlightCost.mount({
    container, icao: 'B752', engine: 'RB211-535E4', layoutId: 'b752-225',
    saveDesign: async () => { calls++; return await savedPromise; },
  });
  assert.ok(instance.url.includes('layout=b752-225'));
  const [button, status, dialog] = container.children;
  button.click();
  assert.equal(dialog.open, true);
  const frame = dialog.children[1];
  assert.equal(new URL(frame.src).origin, 'https://aircraft-designer.app');
  const event = {
    origin: 'https://aircraft-designer.app', source: frame.contentWindow,
    data: { protocol: good.protocol, version: 1, type: 'DESIGN_EXPORT', requestId: '12345678-abcd', design: good },
  };
  const handle = handlers.get('message');
  await handle({ ...event, origin: 'https://evil.example' });
  await handle({ ...event, source: {} });
  assert.equal(calls, 0);
  const pending = handle(event);
  assert.equal(calls, 1);
  assert.equal(frame.contentWindow.messages.length, 0, 'must NOT ACK while write is pending');
  resolveSave({ id: 'user-owned-123' });
  await pending;
  assert.equal(status.textContent, 'Самолёт сохранён в FlightCost');
  assert.equal(frame.contentWindow.messages.length, 1);
  assert.equal(frame.contentWindow.messages[0].m.saved, true);
  assert.equal(frame.contentWindow.messages[0].m.requestId, '12345678-abcd');
  assert.equal(frame.contentWindow.messages[0].origin, 'https://aircraft-designer.app');
  instance.destroy();
  assert.equal(handlers.has('message'), false);
});

test('Missing or failed workspace writes never acknowledge success', async () => {
  const { window, handlers, FakeNode } = browser();
  const container = new FakeNode('div');
  window.AircraftDesignerFlightCost.mount({ container, icao: 'B752', engine: 'RB211-535E4' });
  const frame = container.children[2].children[1];
  await handlers.get('message')({
    origin: 'https://aircraft-designer.app', source: frame.contentWindow,
    data: { protocol: good.protocol, version: 1, type: 'DESIGN_EXPORT', requestId: '87654321-abcd', design: good },
  });
  assert.equal(frame.contentWindow.messages.at(-1).m.saved, false);
});
