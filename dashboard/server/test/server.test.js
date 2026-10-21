import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { startServer } from '../app.js';
import { decodeEventId } from '../calendar.js';
import { fakeGoogle, serviceAccount, settings, tempDir } from './helpers.js';

const NOW = Date.parse('2026-10-19T12:00:00Z');
const FAMILY = 'family@group.calendar.google.com';

function timed(id, summary, start, end, extra) {
  return Object.assign({ id, iCalUID: id + '@google.com', status: 'confirmed', summary, start: { dateTime: start }, end: { dateTime: end } }, extra || {});
}

// A valid key the fake Google does not know, so its token request is refused.
const otherKey = () => generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });

async function withServer(calendars, fn, opts) {
  const google = await fakeGoogle(calendars);
  let clock = NOW;
  const config = Object.assign({ settings: settings(), serviceAccount: serviceAccount(), port: 0, timeZone: null }, (opts && opts.config) || {});
  const srv = await startServer({
    config,
    distDir: (opts && opts.distDir) || '/nonexistent',
    tokenUrl: google.tokenUrl,
    apiBase: google.apiBase,
    now: () => clock,
  });
  try {
    await fn({ url: srv.url, google, advance: (ms) => { clock += ms; } });
  } finally {
    await srv.close();
    await google.close();
  }
}

async function getCalendar(url) {
  const res = await fetch(url + '/api/calendar');
  return { status: res.status, type: res.headers.get('content-type'), body: await res.json() };
}

test('maps Google events into the dashboard shape', async () => {
  await withServer({
    [FAMILY]: { timeZone: 'America/Toronto', pages: [[
      timed('dinner', 'Dinner', '2026-10-20T18:30:00-04:00', '2026-10-20T19:30:00-04:00', { location: "Nonna's", description: 'Bring cake' }),
      { id: 'garbage', iCalUID: 'garbage@google.com', status: 'confirmed', summary: 'Garbage night', start: { date: '2026-10-21' }, end: { date: '2026-10-22' } },
      timed('gone', 'Cancelled', '2026-10-22T10:00:00-04:00', '2026-10-22T11:00:00-04:00', { status: 'cancelled' }),
    ]] },
    'alex@example.com': { pages: [[]] },
    'sam@example.com': { pages: [[]] },
  }, async ({ url }) => {
    const { status, body } = await getCalendar(url);
    assert.equal(status, 200);
    assert.deepEqual(body.people, settings().people);
    assert.equal(body.updatedAt, new Date(NOW).toISOString());
    assert.equal(body.events.length, 2);

    const [dinner, garbage] = body.events;
    assert.deepEqual(Object.assign({}, dinner, { id: undefined }), {
      id: undefined, title: 'Dinner', start: '2026-10-20T18:30:00-04:00', end: '2026-10-20T19:30:00-04:00',
      people: ['alex', 'sam'], loc: "Nonna's", notes: 'Bring cake',
    });
    assert.deepEqual(Object.assign({}, garbage, { id: undefined }), {
      id: undefined, title: 'Garbage night', start: '2026-10-21', end: '2026-10-22', people: ['alex', 'sam'], allDay: true,
    });
    assert.deepEqual(decodeEventId(dinner.id), { calendarId: FAMILY, eventId: 'dinner' });
    assert.equal(typeof garbage.id, 'string');
  });
});

test('per-person events get that person; duplicates across calendars merge', async () => {
  const shared = { iCalUID: 'lunch@google.com', status: 'confirmed', summary: 'Lunch', start: { dateTime: '2026-10-21T12:00:00-04:00' }, end: { dateTime: '2026-10-21T13:00:00-04:00' } };
  await withServer({
    [FAMILY]: { pages: [[]] },
    'alex@example.com': { pages: [[timed('gym', 'Gym', '2026-10-20T07:00:00-04:00', '2026-10-20T08:00:00-04:00'), Object.assign({ id: 'lunch-a' }, shared)]] },
    // Sam's copy of the same event; same instant written in another offset.
    'sam@example.com': { pages: [[Object.assign({ id: 'lunch-s' }, shared, { start: { dateTime: '2026-10-21T16:00:00Z' } })]] },
  }, async ({ url }) => {
    const { body } = await getCalendar(url);
    assert.deepEqual(body.events.map((e) => [e.title, e.people]), [['Gym', ['alex']], ['Lunch', ['alex', 'sam']]]);
    assert.deepEqual(decodeEventId(body.events[1].id), { calendarId: 'alex@example.com', eventId: 'lunch-a' });
  });
});

test('events sort by local time, all-day first on its day; Z timestamps pass through', async () => {
  await withServer({
    [FAMILY]: { pages: [[
      timed('late', 'Late', '2026-10-20T22:00:00-04:00', '2026-10-20T23:00:00-04:00'),
      { id: 'ad', iCalUID: 'ad@google.com', summary: 'All day 21st', start: { date: '2026-10-21' }, end: { date: '2026-10-22' } },
      timed('utc', 'UTC', '2026-10-21T09:00:00Z', '2026-10-21T10:00:00Z'),
    ]] },
    'alex@example.com': { pages: [[]] },
    'sam@example.com': { pages: [[]] },
  }, async ({ url }) => {
    const { body } = await getCalendar(url);
    assert.deepEqual(body.events.map((e) => e.title), ['Late', 'All day 21st', 'UTC']);
    assert.equal(body.events[2].start, '2026-10-21T09:00:00Z');
  });
});

test('recurring instances are returned and pagination is followed', async () => {
  const inst = (d) => timed('piano_202610' + d, 'Piano', `2026-10-${d}T15:45:00-04:00`, `2026-10-${d}T16:30:00-04:00`, { iCalUID: 'piano@google.com', recurringEventId: 'piano' });
  await withServer({
    [FAMILY]: { pages: [[inst('20'), inst('27')], [inst('29')], [timed('last', 'Last page', '2026-11-01T09:00:00-04:00', '2026-11-01T10:00:00-04:00')]] },
    'alex@example.com': { pages: [[]] },
    'sam@example.com': { pages: [[]] },
  }, async ({ url, google }) => {
    const { body } = await getCalendar(url);
    assert.deepEqual(body.events.map((e) => e.start), [
      '2026-10-20T15:45:00-04:00', '2026-10-27T15:45:00-04:00', '2026-10-29T15:45:00-04:00', '2026-11-01T09:00:00-04:00',
    ]);
    const familyCalls = google.requests.filter((r) => r.path.includes(encodeURIComponent(FAMILY)));
    assert.deepEqual(familyCalls.map((r) => r.query.pageToken), [undefined, '1', '2']);
  });
});

test('asks Google for expanded events from 7 days ago to 42 days ahead in the family time zone', async () => {
  await withServer({
    [FAMILY]: { timeZone: 'Europe/Paris', pages: [[]] },
    'alex@example.com': { pages: [[]] },
    'sam@example.com': { pages: [[]] },
  }, async ({ url, google }) => {
    await getCalendar(url);
    const calls = google.requests.filter((r) => r.path.endsWith('/events'));
    assert.equal(calls.length, 3);
    for (const c of calls) {
      assert.equal(c.query.singleEvents, 'true');
      assert.equal(c.query.timeMin, new Date(NOW - 7 * 864e5).toISOString());
      assert.equal(c.query.timeMax, new Date(NOW + 42 * 864e5).toISOString());
      assert.equal(c.headers.authorization, 'Bearer token-1');
    }
    assert.deepEqual(calls.filter((c) => !c.path.includes('family')).map((c) => c.query.timeZone), ['Europe/Paris', 'Europe/Paris']);
  });
});

test('TZ overrides the family calendar time zone', async () => {
  await withServer({
    [FAMILY]: { timeZone: 'Europe/Paris', pages: [[]] },
    'alex@example.com': { pages: [[]] },
    'sam@example.com': { pages: [[]] },
  }, async ({ url, google }) => {
    await getCalendar(url);
    const calls = google.requests.filter((r) => r.path.endsWith('/events'));
    assert.deepEqual(calls.map((c) => c.query.timeZone), ['America/Vancouver', 'America/Vancouver', 'America/Vancouver']);
  }, { config: { timeZone: 'America/Vancouver' } });
});

test('signs a service-account JWT and caches the token until shortly before expiry', async () => {
  await withServer({ [FAMILY]: { pages: [[]] }, 'alex@example.com': { pages: [[]] }, 'sam@example.com': { pages: [[]] } }, async ({ url, google, advance }) => {
    await getCalendar(url);
    await getCalendar(url);
    assert.equal(google.tokensIssued, 1);

    const tokenReq = google.requests.find((r) => r.path === '/token');
    const claims = JSON.parse(Buffer.from(new URLSearchParams(tokenReq.body).get('assertion').split('.')[1], 'base64url'));
    assert.equal(claims.iss, 'frame@example-project.iam.gserviceaccount.com');
    assert.equal(claims.scope, 'https://www.googleapis.com/auth/calendar.events');
    assert.equal(claims.aud, google.tokenUrl);
    assert.equal(claims.iat, NOW / 1000);

    advance(3590 * 1000);
    await getCalendar(url);
    assert.equal(google.tokensIssued, 2);
  });
});

test('a Google failure is a non-2xx JSON error, not an empty list', async () => {
  await withServer({
    [FAMILY]: { pages: [[timed('a', 'A', '2026-10-20T09:00:00-04:00', '2026-10-20T10:00:00-04:00')]] },
    'alex@example.com': { status: 403, body: { error: { code: 403, message: 'Not shared with the service account' } } },
    'sam@example.com': { pages: [[]] },
  }, async ({ url }) => {
    const { status, type, body } = await getCalendar(url);
    assert.equal(status, 502);
    assert.match(type, /application\/json/);
    assert.match(body.error, /alex@example\.com/);
    assert.match(body.error, /403/);
    assert.equal(body.events, undefined);
  });
});

test('a token failure is a non-2xx JSON error', async () => {
  await withServer({ [FAMILY]: { pages: [[]] } }, async ({ url }) => {
    const { status, body } = await getCalendar(url);
    assert.equal(status, 502);
    assert.match(body.error, /token/i);
  }, { config: { serviceAccount: serviceAccount({ private_key: otherKey() }) } });
});

let site;
before(() => {
  site = tempDir({
    'index.html': '<!doctype html><title>Home</title>',
    'assets/index-abc123.js': 'console.log(1)',
    'manifest.webmanifest': '{}',
  });
});
after(() => site.cleanup());

test('serves index.html with no-cache and hashed assets with a long cache', async () => {
  await withServer({}, async ({ url }) => {
    let res = await fetch(url + '/');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-cache');
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.match(await res.text(), /<title>Home/);

    res = await fetch(url + '/index.html');
    assert.equal(res.headers.get('cache-control'), 'no-cache');

    res = await fetch(url + '/assets/index-abc123.js');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /javascript/);
    assert.match(res.headers.get('cache-control'), /max-age=31536000/);

    res = await fetch(url + '/manifest.webmanifest');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-cache');
  }, { distDir: site.dir });
});

test('missing files, traversal and non-GET are refused', async () => {
  await withServer({}, async ({ url }) => {
    assert.equal((await fetch(url + '/nope.js')).status, 404);
    assert.equal((await fetch(url + '/%2e%2e/%2e%2e/etc/passwd')).status, 404);
    assert.equal((await fetch(url + '/assets/..%2f..%2fpackage.json')).status, 404);
    assert.equal((await fetch(url + '/', { method: 'POST' })).status, 405);
    assert.equal((await fetch(url + '/api/calendar', { method: 'POST' })).status, 405);
    const res = await fetch(url + '/api/nope');
    assert.equal(res.status, 404);
    assert.match(res.headers.get('content-type'), /application\/json/);
  }, { distDir: site.dir });
});

test('GET /api/version reports the served build id, not cached', async () => {
  const built = tempDir({ 'index.html': '<!doctype html>', 'version.json': { build: 'build-a' } });
  try {
    await withServer({}, async ({ url }) => {
      const res = await fetch(url + '/api/version');
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await res.json(), { build: 'build-a' });
      // A new build in place (npm run build while the server runs) is reported straight away.
      writeFileSync(built.path('version.json'), JSON.stringify({ build: 'build-b' }));
      assert.deepEqual(await (await fetch(url + '/api/version')).json(), { build: 'build-b' });
      assert.equal((await fetch(url + '/api/version', { method: 'POST' })).status, 405);
    }, { distDir: built.dir });
  } finally {
    built.cleanup();
  }
});

test('GET /api/version says null without a stamped build', async () => {
  const bad = tempDir({ 'version.json': 'not json' });
  try {
    for (const distDir of ['/nonexistent', site.dir, bad.dir]) {
      await withServer({}, async ({ url }) => {
        const res = await fetch(url + '/api/version');
        assert.equal(res.status, 200);
        assert.deepEqual(await res.json(), { build: null });
      }, { distDir });
    }
  } finally {
    bad.cleanup();
  }
});
