// Minimal Home Assistant REST client: a long-lived access token and global fetch. The base URL is
// the configured one, so tests can point it at a local fake.

const TIMEOUT_MS = 15 * 1000;

export class HomeAssistantError extends Error {}

async function readError(res) {
  const text = await res.text().catch(() => '');
  let msg = text;
  try {
    const j = JSON.parse(text);
    msg = j.message || j.error || text;
  } catch {}
  return String(msg || res.statusText).slice(0, 200);
}

export function createHomeAssistant({ url, token }) {
  async function call(path, init) {
    let res;
    try {
      res = await fetch(url + '/api' + path, Object.assign({}, init, {
        headers: Object.assign({ authorization: 'Bearer ' + token }, init && init.headers),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }));
    } catch (e) {
      throw new HomeAssistantError(`Home Assistant: ${e.message}`);
    }
    if (!res.ok) throw new HomeAssistantError(`Home Assistant ${path}: ${res.status} ${await readError(res)}`);
    return res.json();
  }

  // An entity's { state, attributes, ... }.
  function state(entityId) {
    return call('/states/' + encodeURIComponent(entityId));
  }

  // A weather entity's forecast list; type is 'hourly' or 'daily'. Values are in the entity's units.
  async function forecasts(entityId, type) {
    const body = await call('/services/weather/get_forecasts?return_response', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entity_id: entityId, type }),
    });
    const out = body && body.service_response && body.service_response[entityId];
    if (!out || !Array.isArray(out.forecast)) throw new HomeAssistantError(`Home Assistant returned no ${type} forecast for ${entityId}`);
    return out.forecast;
  }

  return { state, forecasts };
}
