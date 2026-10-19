// POST /api/events and DELETE /api/events/:id against the fake Google.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../app.js';
import { decodeEventId, encodeEventId } from '../calendar.js';
import { fakeGoogle, serviceAccount, settings } from './helpers.js';

const NOW = Date.parse('2026-10-19T12:00:00Z');
const FAMILY = 'family@group.calendar.google.com';

// Alex and Sam have their own calendars; Kit does not.
const SETTINGS = settings({
  people: settings().people.concat({ id: 'kit', name: 'Kit', colour: '#00A86B' }),
});
const empty = () => ({ [FAMILY]: { pages: [[]] }, 'alex@example.com': { pages: [[]] }, 'sam@example.com': { pages: [[]] } });

async function withServer(calendars, fn) {
  const google = await fakeGoogle(calendars);
  const srv = await startServer({
    config: { settings: SETTINGS, serviceAccount: serviceAccount(), port: 0, timeZone: null },
    distDir: '/nonexistent', tokenUrl: google.tokenUrl, apiBase: google.apiBase, now: () => NOW,
  });
  try {
    await fn({ url: srv.url, google, writes: () => google.requests.filter((r) => r.method === 'POST' && r.path !== '/token') });
  } finally {
    await srv.close();
    await google.close();
  }
}

async function call(url, method, path, body, headers) {
  const res = await fetch(url + path, {
    method,
    headers: Object.assign(body === undefined ? {} : { 'content-type': 'application/json' }, headers || {}),
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, type: res.headers.get('content-type'), body: text ? JSON.parse(text) : null };
}

const dentist = (people) => ({ title: 'Dentist', start: '2026-10-20T15:30:00Z', end: '2026-10-20T16:30:00Z', people });

// ------------------------------------------------------------ which calendar
for (const [name, people, calendarId, shown] of [
  ['one person with their own calendar → that calendar', ['alex'], 'alex@example.com', ['alex']],
  ['one person without their own calendar → Family', ['kit'], FAMILY, ['alex', 'sam', 'kit']],
  ['several people → Family', ['sam', 'alex'], FAMILY, ['alex', 'sam', 'kit']],
  ['nobody picked → Family', [], FAMILY, ['alex', 'sam', 'kit']],
]) {
  test(name, async () => {
    await withServer(empty(), async ({ url, writes }) => {
      const { status, body } = await call(url, 'POST', '/api/events', dentist(people));
      assert.equal(status, 201);
      const [w] = writes();
      assert.equal(writes().length, 1);
      assert.equal(w.path, '/calendar/v3/calendars/' + encodeURIComponent(calendarId) + '/events');
      assert.deepEqual(JSON.parse(w.body), { summary: 'Dentist', start: { dateTime: '2026-10-20T15:30:00Z' }, end: { dateTime: '2026-10-20T16:30:00Z' } });
      // The same shape GET /api/calendar uses, with the people GET would give it.
      assert.deepEqual(Object.assign({}, body, { id: undefined }), {
        id: undefined, title: 'Dentist', start: '2026-10-20T15:30:00Z', end: '2026-10-20T16:30:00Z', people: shown,
      });
      assert.equal(decodeEventId(body.id).calendarId, calendarId);
    });
  });
}

test('an added event is in the next GET /api/calendar with the same id', async () => {
  await withServer(empty(), async ({ url }) => {
    const added = (await call(url, 'POST', '/api/events', dentist(['sam']))).body;
    const { body } = await call(url, 'GET', '/api/calendar');
    assert.deepEqual(body.events, [added]);
  });
});

test('all-day events are written as dates', async () => {
  await withServer(empty(), async ({ url, writes }) => {
    const { status, body } = await call(url, 'POST', '/api/events', { title: 'Holiday', start: '2026-10-21', end: '2026-10-23', allDay: true, people: [] });
    assert.equal(status, 201);
    assert.deepEqual(JSON.parse(writes()[0].body), { summary: 'Holiday', start: { date: '2026-10-21' }, end: { date: '2026-10-23' } });
    assert.equal(body.allDay, true);
    assert.equal(body.start, '2026-10-21');
  });
});

test('the title is trimmed', async () => {
  await withServer(empty(), async ({ url, writes }) => {
    await call(url, 'POST', '/api/events', Object.assign(dentist([]), { title: '  Dentist \n' }));
    assert.equal(JSON.parse(writes()[0].body).summary, 'Dentist');
  });
});

// ------------------------------------------------------------ bad input
for (const [name, body] of [
  ['no title', Object.assign(dentist([]), { title: '   ' })],
  ['title not a string', Object.assign(dentist([]), { title: 7 })],
  ['title over 200 characters', Object.assign(dentist([]), { title: 'x'.repeat(201) })],
  ['start after end', Object.assign(dentist([]), { start: '2026-10-20T17:00:00Z' })],
  ['start equal to end', Object.assign(dentist([]), { end: '2026-10-20T15:30:00Z' })],
  ['start without an offset', Object.assign(dentist([]), { start: '2026-10-20T15:30:00' })],
  ['end not a date', Object.assign(dentist([]), { end: 'soon' })],
  ['all-day with times', Object.assign(dentist([]), { allDay: true })],
  ['all-day ending before it starts', { title: 'Holiday', start: '2026-10-21', end: '2026-10-21', allDay: true, people: [] }],
  ['impossible date', { title: 'Holiday', start: '2026-02-30', end: '2026-03-01', allDay: true, people: [] }],
  ['unknown person', dentist(['alex', 'zed'])],
  ['family as a person', dentist(['family'])],
  ['people missing', { title: 'Dentist', start: '2026-10-20T15:30:00Z', end: '2026-10-20T16:30:00Z' }],
  ['people not a list', dentist('alex')],
  ['not an object', [1, 2]],
  ['not JSON', '{"title":'],
]) {
  test('bad input → 400 and no Google call: ' + name, async () => {
    await withServer(empty(), async ({ url, google }) => {
      const res = await call(url, 'POST', '/api/events', body);
      assert.equal(res.status, 400);
      assert.match(res.type, /application\/json/);
      assert.equal(typeof res.body.error, 'string');
      assert.equal(google.requests.length, 0);
    });
  });
}

test('a POST that is not JSON is refused, so another site cannot post a plain form', async () => {
  await withServer(empty(), async ({ url, google }) => {
    const res = await call(url, 'POST', '/api/events', JSON.stringify(dentist([])), { 'content-type': 'text/plain' });
    assert.equal(res.status, 415);
    assert.equal(google.requests.length, 0);
  });
});

test('an oversized body is refused', async () => {
  await withServer(empty(), async ({ url, google }) => {
    const res = await call(url, 'POST', '/api/events', Object.assign(dentist([]), { pad: 'x'.repeat(70000) }));
    assert.equal(res.status, 413);
    assert.equal(google.requests.length, 0);
  });
});

test('only POST on /api/events and DELETE on /api/events/:id', async () => {
  await withServer(empty(), async ({ url }) => {
    assert.equal((await call(url, 'GET', '/api/events')).status, 405);
    assert.equal((await call(url, 'DELETE', '/api/events')).status, 405);
    assert.equal((await call(url, 'GET', '/api/events/abc')).status, 405);
    assert.equal((await call(url, 'POST', '/api/events/abc', {})).status, 405);
  });
});

// ------------------------------------------------------------ Google failures
test('a Google failure on insert is a non-2xx JSON error', async () => {
  const cals = empty();
  cals['alex@example.com'] = { status: 403, body: { error: { code: 403, message: 'Writer access required' } } };
  await withServer(cals, async ({ url }) => {
    const res = await call(url, 'POST', '/api/events', dentist(['alex']));
    assert.equal(res.status, 502);
    assert.match(res.type, /application\/json/);
    assert.match(res.body.error, /403/);
    assert.match(res.body.error, /Writer access required/);
  });
});

// ------------------------------------------------------------ delete
test('DELETE maps the opaque id to the right calendar and event', async () => {
  await withServer(empty(), async ({ url, google }) => {
    const added = (await call(url, 'POST', '/api/events', dentist(['sam']))).body;
    const res = await call(url, 'DELETE', '/api/events/' + added.id);
    assert.equal(res.status, 204);
    const del = google.requests.filter((r) => r.method === 'DELETE');
    assert.deepEqual(del.map((r) => r.path), ['/calendar/v3/calendars/' + encodeURIComponent('sam@example.com') + '/events/' + decodeEventId(added.id).eventId]);
    assert.deepEqual((await call(url, 'GET', '/api/calendar')).body.events, []);
  });
});

test('DELETE of an event Google already deleted succeeds', async () => {
  await withServer(empty(), async ({ url }) => {
    const added = (await call(url, 'POST', '/api/events', dentist([]))).body;
    assert.equal((await call(url, 'DELETE', '/api/events/' + added.id)).status, 204);
    assert.equal((await call(url, 'DELETE', '/api/events/' + added.id)).status, 204);
  });
});

test('DELETE of an unknown event is a non-2xx JSON error', async () => {
  await withServer(empty(), async ({ url }) => {
    const res = await call(url, 'DELETE', '/api/events/' + encodeEventId(FAMILY, 'nope'));
    assert.equal(res.status, 502);
    assert.match(res.body.error, /404/);
  });
});

test('DELETE refuses bad ids and calendars that are not configured, without calling Google', async () => {
  await withServer(empty(), async ({ url, google }) => {
    assert.equal((await call(url, 'DELETE', '/api/events/not-an-id')).status, 404);
    assert.equal((await call(url, 'DELETE', '/api/events/%E0%A4%A')).status, 404);
    assert.equal((await call(url, 'DELETE', '/api/events/' + encodeEventId('someone-else@example.com', 'x'))).status, 404);
    assert.equal(google.requests.length, 0);
  });
});
