// Weather alerts (ADR 0007): the National Weather Service's active alerts for Home Assistant's
// zone.home, from api.weather.gov rather than Home Assistant. Nothing is fetched until a frame asks,
// and then at most once per POLL_MS, so the NWS is only asked while a frame is asking (every
// minute). After a refusal (429), a 5xx or no answer the last good copy stands, with its age, until
// the next minute's try; ended alerts are dropped from it as they end, so an outage never reads as
// "no alerts". US only.

export const POLL_MS = 60 * 1000;
const TIMEOUT_MS = 15 * 1000;
const APP = 'photo-frame-dashboard';
const REPO = 'https://github.com/wesbos/photo-frame-dashboard';

// The NWS asks for a User-Agent that identifies the app and, ideally, how to reach its owner.
export function userAgent(contact) {
  return '(' + APP + ', ' + REPO + (contact ? ', ' + contact : '') + ')';
}

const isText = (v) => typeof v === 'string' && v !== '';
const iso = (v) => {
  const t = isText(v) ? Date.parse(v) : NaN;
  return isNaN(t) ? null : new Date(t).toISOString();
};

// An NWS alerts FeatureCollection → [{ id, references (the ids it updates), event, severity,
// urgency, headline, description, instruction, onset, ends }] with ISO times. Only real alerts:
// test and draft messages and cancellations are left out. ends falls back to the message's expiry,
// onset to when it took effect.
export function mapAlerts(body) {
  const features = body && Array.isArray(body.features) ? body.features : [];
  return features.map((f) => f && f.properties).filter((p) => p && isText(p.id) && isText(p.event)
    && (p.status === undefined || p.status === 'Actual') && p.messageType !== 'Cancel').map((p) => ({
    id: p.id,
    references: Array.isArray(p.references) ? p.references.map((r) => r && r.identifier).filter(isText) : [],
    event: p.event,
    severity: isText(p.severity) ? p.severity : 'Unknown',
    urgency: isText(p.urgency) ? p.urgency : 'Unknown',
    headline: isText(p.headline) ? p.headline : '',
    description: isText(p.description) ? p.description : '',
    instruction: isText(p.instruction) ? p.instruction : '',
    onset: iso(p.onset) || iso(p.effective),
    ends: iso(p.ends) || iso(p.expires),
  }));
}

// ha: the Home Assistant REST client (its home() gives zone.home's { lat, lon } or null).
export function createAlerts({ ha, contact, now = Date.now, log = console, apiBase = 'https://api.weather.gov', pollMs = POLL_MS }) {
  const agent = userAgent(contact);
  let place = null; // { lat, lon } to 4 decimals (the NWS redirects anything finer)
  let warned = false; // the no-coordinates warning is logged once
  let alerts = []; // the last good copy
  let goodAt = null; // when it was read
  let failed = false; // the last try failed
  let triedAt = null;
  let loading = null;

  // zone.home's coordinates, or null when Home Assistant has none (warned once). While Home
  // Assistant can't be read, the last place known stands.
  async function locate() {
    let loc;
    try {
      loc = await ha.home();
    } catch (e) {
      if (!place) log.error('[alerts]', e.message);
      return place;
    }
    if (!loc) {
      if (!warned) log.warn('[alerts] zone.home has no latitude/longitude in Home Assistant, so there are no weather alerts');
      warned = true;
      return null;
    }
    warned = false;
    return { lat: Number(loc.lat.toFixed(4)), lon: Number(loc.lon.toFixed(4)) };
  }

  async function refresh() {
    triedAt = now();
    const loc = await locate();
    if (!loc || !place || loc.lat !== place.lat || loc.lon !== place.lon) {
      alerts = []; // a new place (or none): nothing kept is for it
      goodAt = null;
    }
    place = loc;
    if (!place) { failed = false; return; }
    try {
      let res;
      try {
        res = await fetch(`${apiBase}/alerts/active?point=${place.lat},${place.lon}`, {
          headers: { 'user-agent': agent, accept: 'application/geo+json' },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (e) {
        throw new Error(`NWS alerts: ${e.message}`);
      }
      if (!res.ok) throw new Error(`NWS alerts: ${res.status} ${res.statusText}`);
      const body = await res.json().catch(() => null);
      if (!body || !Array.isArray(body.features)) throw new Error('NWS alerts: the answer is not a list of alerts');
      alerts = mapAlerts(body);
      goodAt = now();
      failed = false;
    } catch (e) {
      log.error('[alerts]', e.message);
      failed = true;
    }
  }

  // Asks the NWS again once pollMs has passed since the last try; one try at a time.
  function update() {
    if (!loading && (triedAt == null || now() - triedAt >= pollMs)) loading = refresh().finally(() => { loading = null; });
    return loading || Promise.resolve();
  }

  // The listing: { configured, available (there is a good copy), alerts (minus any that have ended),
  // fetched (when the copy was read, ISO, null if never), age (whole minutes since then, null if
  // never), stale (the last try failed) }.
  async function load() {
    await update();
    const t = now();
    return {
      configured: true,
      available: goodAt != null,
      alerts: alerts.filter((a) => !a.ends || Date.parse(a.ends) > t),
      fetched: goodAt == null ? null : new Date(goodAt).toISOString(),
      age: goodAt == null ? null : Math.floor((t - goodAt) / 60000),
      stale: failed,
    };
  }

  return { load };
}
