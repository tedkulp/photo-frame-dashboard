import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapAlerts, userAgent } from '../alerts.js';
import { fakeHomeAssistant, fakeNws, nwsAlert, serviceAccount, settings, startTestServer } from './helpers.js';

const NOW = Date.parse('2026-10-25T19:40:00Z'); // 3:40 pm EDT
const MIN = 60 * 1000;
const HOME = { latitude: 43.65107, longitude: -79.383186 };

// opts: zone (zone.home's attributes), features (the NWS's), alerts (the config block).
async function withAlerts(opts, fn) {
  const nws = await fakeNws(opts.features || [nwsAlert()]);
  const ha = await fakeHomeAssistant({ 'zone.home': { state: 'zoning', attributes: 'zone' in opts ? opts.zone : HOME }, 'weather.home': { state: 'cloudy', attributes: { temperature: 50, temperature_unit: '°F' }, hourly: [], daily: [] } });
  const clock = { t: NOW };
  const logged = [];
  const log = { log() {}, warn: (...a) => logged.push(['warn', a.join(' ')]), error: (...a) => logged.push(['error', a.join(' ')]) };
  const srv = await startTestServer({
    config: {
      settings: settings(), serviceAccount: serviceAccount(), port: 0, timeZone: null, dataDir: null,
      homeAssistant: { url: ha.url, weatherEntity: 'weather.home', token: ha.token, label: 'frame', rooms: [], radar: null, alerts: 'alerts' in opts ? opts.alerts : { contact: null } },
    },
    distDir: '/nonexistent',
    now: () => clock.t,
    nwsBase: nws.url,
    log,
  });
  try {
    await fn({ url: srv.url, nws, ha, clock, logged });
  } finally {
    await srv.close();
    await ha.close();
    await nws.close();
  }
}

async function get(url) {
  const res = await fetch(url);
  const text = await res.text();
  let body = text;
  try { body = JSON.parse(text); } catch {}
  return { status: res.status, headers: res.headers, body };
}

// ------------------------------------------------------------ mapping
test('NWS features map to the dashboard shape; tests, drafts and cancels are left out', () => {
  const out = mapAlerts({
    features: [
      nwsAlert({ id: 'A', references: [{ '@id': 'https://api.weather.gov/alerts/Z', identifier: 'Z', sender: 'x', sent: 'y' }] }),
      nwsAlert({ id: 'B', ends: null, onset: null }),
      nwsAlert({ id: 'T', status: 'Test' }),
      nwsAlert({ id: 'C', messageType: 'Cancel' }),
      { properties: { id: 'no-event' } },
      null,
    ],
  });
  assert.deepEqual(out.map((a) => a.id), ['A', 'B']);
  assert.deepEqual(out[0], {
    id: 'A', references: ['Z'], event: 'Winter Storm Warning', severity: 'Severe', urgency: 'Expected',
    headline: 'Winter Storm Warning issued October 25 at 3:00PM EDT by NWS Test', description: '* WHAT...Heavy snow.\n\n* WHERE...Test County.',
    instruction: 'Travel could be very difficult.',
    onset: '2026-10-25T19:00:00.000Z', ends: '2026-10-26T10:00:00.000Z',
  });
  // Without ends, the message's expiry; without onset, when it took effect.
  assert.deepEqual([out[1].onset, out[1].ends], ['2026-10-25T19:00:00.000Z', '2026-10-26T03:00:00.000Z']);
  assert.deepEqual(mapAlerts({}), []);
  assert.deepEqual(mapAlerts(null), []);
});

test('the User-Agent names the app, plus the contact when set', () => {
  assert.match(userAgent(null), /^\(photo-frame-dashboard, https:\/\/github\.com\/[\w-]+\/photo-frame-dashboard\)$/);
  assert.match(userAgent('me@example.com'), /^\(photo-frame-dashboard, https:\/\/github\.com\/[\w-]+\/photo-frame-dashboard, me@example\.com\)$/);
});

// ------------------------------------------------------------ the home server's alerts
test('the listing: the NWS alerts at zone.home, asked with the User-Agent and contact', async () => {
  await withAlerts({ alerts: { contact: 'me@example.com' } }, async ({ url, nws }) => {
    const res = await get(url + '/api/alerts');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const l = res.body;
    assert.deepEqual([l.configured, l.available, l.stale, l.age, l.fetched], [true, true, false, 0, new Date(NOW).toISOString()]);
    assert.deepEqual(l.alerts.map((a) => [a.id, a.event]), [['urn:oid:2.49.0.1.840.0.test.1.1', 'Winter Storm Warning']]);
    assert.equal(nws.requests.length, 1);
    const r = nws.requests[0];
    assert.equal(r.path, '/alerts/active');
    assert.equal(r.point, '43.6511,-79.3832', 'NWS takes at most 4 decimals');
    assert.equal(r.headers['user-agent'], userAgent('me@example.com'));
    assert.match(r.headers['user-agent'], /photo-frame-dashboard.*me@example\.com/);
    assert.match(r.headers.accept, /application\/geo\+json/);
    assert.equal((await fetch(url + '/api/alerts', { method: 'POST' })).status, 405);
  });
});

test('NWS is asked at most once a minute, and not at all until a frame asks', async () => {
  await withAlerts({}, async ({ url, nws, clock }) => {
    await new Promise((r) => setTimeout(r, 30));
    clock.t += 5 * MIN;
    assert.equal(nws.requests.length, 0, 'nothing before a frame asks');
    await Promise.all([get(url + '/api/alerts'), get(url + '/api/alerts'), get(url + '/api/alerts')]);
    assert.equal(nws.requests.length, 1);
    clock.t += 59 * 1000;
    await get(url + '/api/alerts');
    assert.equal(nws.requests.length, 1);
    clock.t += 1000;
    await get(url + '/api/alerts');
    assert.equal(nws.requests.length, 2);
    // No frame asking: nothing more, however long.
    clock.t += 60 * MIN;
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(nws.requests.length, 2);
    assert.equal(nws.requests[0].headers['user-agent'], userAgent(null));
  });
});

test('ended alerts are left out of the listing', async () => {
  await withAlerts({ features: [nwsAlert({ id: 'A', ends: '2026-10-25T19:30:00Z' }), nwsAlert({ id: 'B' })] }, async ({ url }) => {
    assert.deepEqual((await get(url + '/api/alerts')).body.alerts.map((a) => a.id), ['B']);
  });
});

test('on NWS failure: the last good alerts minus ended ones, with their age; no retry before the minute', async () => {
  for (const fail of [503, 429, 'drop']) {
    await withAlerts({ features: [nwsAlert({ id: 'A', ends: '2026-10-25T19:50:00Z' }), nwsAlert({ id: 'B' })] }, async ({ url, nws, clock, logged }) => {
      await get(url + '/api/alerts');
      nws.fail = fail;
      clock.t += 5 * MIN;
      let l = (await get(url + '/api/alerts')).body;
      assert.deepEqual([l.available, l.stale, l.age, l.fetched], [true, true, 5, new Date(NOW).toISOString()], String(fail));
      assert.deepEqual(l.alerts.map((a) => a.id), ['A', 'B']);
      assert.ok(logged.some(([k, m]) => k === 'error' && /^\[alerts\] NWS alerts/.test(m)), JSON.stringify(logged));
      const asked = nws.requests.length;
      clock.t += 30 * 1000;
      await get(url + '/api/alerts');
      assert.equal(nws.requests.length, asked, 'waits for the next minute');
      clock.t += 10 * MIN; // A has ended by now
      l = (await get(url + '/api/alerts')).body;
      assert.deepEqual(l.alerts.map((a) => a.id), ['B']);
      assert.equal(l.age, 15);
      nws.fail = null;
      clock.t += MIN;
      l = (await get(url + '/api/alerts')).body;
      assert.deepEqual([l.stale, l.age], [false, 0]);
    });
  }
});

test('never a good copy: unavailable, no alerts', async () => {
  await withAlerts({}, async ({ url, nws }) => {
    nws.fail = 500;
    const l = (await get(url + '/api/alerts')).body;
    assert.deepEqual([l.configured, l.available, l.alerts, l.stale, l.age, l.fetched], [true, false, [], true, null, null]);
  });
  // A body that isn't a FeatureCollection counts as a failure too.
  await withAlerts({ features: 'nope' }, async ({ url }) => {
    const l = (await get(url + '/api/alerts')).body;
    assert.deepEqual([l.available, l.alerts], [false, []]);
  });
});

test('zone.home without coordinates: one warning, unavailable, NWS never asked', async () => {
  await withAlerts({ zone: { friendly_name: 'Home' } }, async ({ url, nws, clock, logged }) => {
    for (let i = 0; i < 3; i++) {
      const l = (await get(url + '/api/alerts')).body;
      assert.deepEqual([l.configured, l.available, l.alerts], [true, false, []]);
      clock.t += MIN;
    }
    assert.deepEqual(logged.filter(([k]) => k === 'warn').map(([, m]) => m), ['[alerts] zone.home has no latitude/longitude in Home Assistant, so there are no weather alerts']);
    assert.equal(nws.requests.length, 0);
  });
});

test('without settings.homeAssistant.alerts: { configured: false }, other requests 404, NWS never asked', async () => {
  await withAlerts({ alerts: null }, async ({ url, nws }) => {
    assert.deepEqual(await get(url + '/api/alerts').then((r) => [r.status, r.body]), [200, { configured: false }]);
    assert.deepEqual(await get(url + '/api/alerts/x').then((r) => [r.status, r.body]), [404, { error: 'Weather alerts are not set up' }]);
    assert.equal((await fetch(url + '/api/alerts', { method: 'POST' })).status, 404);
    assert.equal(nws.requests.length, 0);
  });
});
