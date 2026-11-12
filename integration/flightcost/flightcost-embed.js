/**
 * No build dependency. Copy this file into FlightCost's existing public JS assets.
 * Uses same-origin FlightCost save callback, not cross-domain cookies or guessed APIs.
 */
const DESIGNER = 'https://aircraft-designer.app';
const PROTOCOL = 'aircraft-designer/flightcost-design';
const V = 1;

export function isValidDesign(d, icao, engine) {
  const acceptedEngines = Array.isArray(engine) ? engine : [engine];
  if (!d || d.protocol !== PROTOCOL || d.version !== V || !d.aircraft || !d.weights) return false;
  const a = d.aircraft;
  if (a.icao !== icao || !acceptedEngines.includes(a.engine) || !Array.isArray(a.cabin)) return false;
  const seats = a.cabin.reduce((sum, z) => {
    if (!Number.isInteger(z.rows) || z.rows < 1 || !Number.isInteger(z.seatsPerRow) || z.seatsPerRow < 2 || z.seatsPerRow > 10 ||
      !Number.isFinite(z.pitchM) || z.pitchM < 0.65 || z.pitchM > 1.5 ||
      (z.lastRowSeats !== undefined && (!Number.isInteger(z.lastRowSeats) || z.lastRowSeats < 1 || z.lastRowSeats > z.seatsPerRow))) return NaN;
    return sum + (z.rows - 1) * z.seatsPerRow + (z.lastRowSeats ?? z.seatsPerRow);
  }, 0);
  if (!Number.isInteger(a.seats) || a.seats < 1 || a.seats > 400 || seats !== a.seats) return false;
  const w = d.weights;
  for (const key of ['oew_kg', 'mtow_kg', 'mlw_kg', 'mzfw_kg', 'fuel_capacity_kg']) {
    if (!Number.isFinite(w[key]) || w[key] < 0 || w[key] > 1e6) return false;
  }
  if (!(w.oew_kg < w.mzfw_kg && w.mzfw_kg <= w.mtow_kg && w.mlw_kg <= w.mtow_kg)) return false;
  return true;
}

/**
 * @param {{container:Element, icao:string, engine:string, layoutId?:string,
 *  aircraftId?:string, supportedEngines?:string[], saveDesign?:(design:object)=>Promise<{id:string}|void>}} options
 * saveDesign MUST persist into the current visitor's FlightCost workspace on
 * FlightCost's own origin and reject failed writes. Do not ack until it resolves.
 */
export function mountAircraftDesigner(options) {
  const { container, icao, engine, layoutId, aircraftId, saveDesign } = options;
  const acceptedEngines = options.supportedEngines ?? [engine];
  if (!container || !/^[A-Z0-9]{2,5}$/.test(icao) || !engine) throw new Error('Valid FlightCost type and engine are required');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = 'Покрутить в 3D · Aircraft Designer';
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  const dialog = document.createElement('dialog');
  dialog.style.cssText = 'width:min(1200px,96vw);height:min(850px,93vh);padding:0;border:1px solid #536877;border-radius:12px;background:#142230;color:white';
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = 'Закрыть 3D';
  close.style.cssText = 'position:absolute;right:12px;top:12px;z-index:2;padding:8px;';
  close.addEventListener('click', () => dialog.close());
  const frame = document.createElement('iframe');
  frame.title = `${icao}: 3D-конструктор Aircraft Designer`;
  frame.style.cssText = 'width:100%;height:100%;border:0;display:block';
  frame.referrerPolicy = 'strict-origin-when-cross-origin';
  const url = new URL('/', DESIGNER);
  url.searchParams.set('embed', 'flightcost');
  url.searchParams.set('ac', icao);
  url.searchParams.set('engine', engine);
  if (aircraftId) url.searchParams.set('aircraft', aircraftId);
  if (layoutId) url.searchParams.set('layout', layoutId);
  frame.src = url.href;
  dialog.append(close, frame);
  container.append(btn, status, dialog);
  btn.addEventListener('click', () => dialog.showModal());
  let saving = false;
  const onMessage = async (event) => {
    if (event.origin !== DESIGNER || event.source !== frame.contentWindow || saving) return;
    const msg = event.data;
    if (!msg || msg.protocol !== PROTOCOL || msg.version !== V || msg.type !== 'DESIGN_EXPORT' || typeof msg.requestId !== 'string') return;
    const ack = (saved, error) => frame.contentWindow?.postMessage({ protocol: PROTOCOL, version: V, type: 'DESIGN_ACK', requestId: msg.requestId, saved, ...(error ? { error } : {}) }, DESIGNER);
    if (!isValidDesign(msg.design, icao, acceptedEngines)) {
      status.textContent = 'Данные не прошли проверку компоновки и масс';
      ack(false, status.textContent);
      return;
    }
    if (typeof saveDesign !== 'function') {
      status.textContent = 'Встраивание работает. Сохранение в workspace ещё не подключено на FlightCost';
      ack(false, status.textContent);
      return;
    }
    saving = true;
    status.textContent = 'Сохраняем самолёт в FlightCost…';
    try {
      const saved = await saveDesign(msg.design); // Caller owns authentication, CSRF, persistence and rate limits.
      if (!saved || typeof saved.id !== 'string' || !saved.id) throw new Error('Workspace did not return a saved configuration id');
      status.textContent = `Самолёт сохранён в FlightCost: ${saved.id}`;
      ack(true);
    } catch (error) {
      status.textContent = `Ошибка сохранения: ${error instanceof Error ? error.message : 'неизвестная'}`;
      ack(false, status.textContent);
    } finally { saving = false; }
  };
  window.addEventListener('message', onMessage);
  return { destroy: () => { window.removeEventListener('message', onMessage); dialog.remove(); btn.remove(); status.remove(); }, url: url.href };
}
