// Holiday calendars ({ person: "none" }): a Google one and an ICS link whose all-day events belong
// to no one. GET /api/calendar, deletes and adds against a fake Google plus a fake ICS link.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../app.js';
import { decodeEventId, encodeEventId } from '../calendar.js';
import { fakeGoogle, fakeIcs, icsFixture, serviceAccount } from './helpers.js';

const NOW = Date.parse('2026-10-19T12:00:00Z');
const FAMILY = 'family@group.calendar.google.com';
const HOLIDAYS = 'en.usa#holiday@group.v.calendar.google.com';
const PEOPLE = [
  { id: 'alex', name: 'Alex', colour: '#2D5BFF' },
  { id: 'sam', name: 'Sam', colour: '#E4007C' },
];

const allDay = (id, uid, summary, date, end) => ({ id, iCalUID: uid, status: 'confirmed', summary, start: { date }, end: { date: end } });

async function withServer(fn) {
  const google = await fakeGoogle({
    [FAMILY]: { timeZone: 'America/Toronto', pages: [[]] },
    // Alex also has Halloween on their own calendar: the same UID + start as both holiday copies.
    'alex@example.com': { pages: [[allDay('hw-alex', 'halloween-2026@holidays.example', 'Halloween', '2026-10-31', '2026-11-01')]] },
    [HOLIDAYS]: {
      pages: [[
        allDay('hw-g', 'halloween-2026@holidays.example', 'Halloween', '2026-10-31', '2026-11-01'),
        allDay('vet-g', 'veterans-2026@holidays.example', 'Veterans Day', '2026-11-11', '2026-11-12'),
        { id: 'dst-g', iCalUID: 'dst@holidays.example', status: 'confirmed', summary: 'Clocks go back',
          start: { dateTime: '2026-11-01T02:00:00-05:00' }, end: { dateTime: '2026-11-01T03:00:00-05:00' } },
      ]],
    },
  });
  const ics = await fakeIcs({ 'us-holidays': { body: icsFixture('holidays.ics') } });
  const settings = {
    people: PEOPLE,
    // The holiday calendars come first, so the merge can't depend on the order they are listed in.
    calendars: [
      { calendarId: HOLIDAYS, person: 'none' },
      { ics: 'us-holidays', url: ics.url('us-holidays'), person: 'none' },
      { calendarId: FAMILY, person: 'family' },
      { calendarId: 'alex@example.com', person: 'alex' },
    ],
  };
  const log = { log: () => {}, warn: () => {}, error: () => {} };
  const srv = await startServer({
    config: { settings, serviceAccount: serviceAccount(), port: 0, timeZone: null },
    distDir: '/nonexistent', tokenUrl: google.tokenUrl, apiBase: google.apiBase, now: () => NOW, log, icsTimeoutMs: 300,
  });
  try {
    await fn({ url: srv.url, google });
  } finally {
    await srv.close();
    await ics.close();
    await google.close();
  }
}

async function call(url, method, path, body) {
  const res = await fetch(url + path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
const calendar = async (url) => (await call(url, 'GET', '/api/calendar')).body.events;
const writes = (google) => google.requests.filter((r) => r.method !== 'GET' && r.path !== '/token');

test('holiday all-day events belong to no one and cannot be deleted; their timed events are not served', async () => {
  await withServer(async ({ url }) => {
    const events = await calendar(url);
    assert.deepEqual(events.map((e) => [e.title, e.start, e.people.join('+'), e.deletable]), [
      ['Halloween', '2026-10-31', 'alex', true],
      ['Diwali', '2026-11-08', '', false],
      ['Veterans Day', '2026-11-11', '', false],
    ]);
    const vet = events.find((e) => e.title === 'Veterans Day');
    assert.deepEqual(Object.assign({}, vet, { id: undefined }), {
      id: undefined, title: 'Veterans Day', start: '2026-11-11', end: '2026-11-12', people: [], allDay: true, deletable: false,
    });
  });
});

test('an event on a person’s calendar and a holiday calendar is served once, as that person’s', async () => {
  await withServer(async ({ url }) => {
    const hw = (await calendar(url)).filter((e) => e.title === 'Halloween');
    assert.equal(hw.length, 1);
    assert.deepEqual(hw[0].people, ['alex']);
    assert.equal(hw[0].deletable, true);
    assert.deepEqual(decodeEventId(hw[0].id), { calendarId: 'alex@example.com', eventId: 'hw-alex' });
  });
});

test('a holiday event cannot be deleted: 403, and Google is not called', async () => {
  await withServer(async ({ url, google }) => {
    const events = await calendar(url);
    for (const title of ['Veterans Day', 'Diwali']) {
      const res = await call(url, 'DELETE', '/api/events/' + events.find((e) => e.title === title).id);
      assert.equal(res.status, 403, title);
      assert.match(res.body.error, /can’t be deleted/);
    }
    // Even one the frame never listed, like the timed one.
    assert.equal((await call(url, 'DELETE', '/api/events/' + encodeEventId(HOLIDAYS, 'dst-g'))).status, 403);
    assert.deepEqual(writes(google), []);
  });
});

test('adding events never writes to a holiday calendar', async () => {
  await withServer(async ({ url, google }) => {
    for (const people of [[], ['alex'], ['sam'], ['alex', 'sam']]) {
      const res = await call(url, 'POST', '/api/events', { title: 'Dentist', start: '2026-10-20T15:30:00Z', end: '2026-10-20T16:30:00Z', people });
      assert.equal(res.status, 201);
      assert.equal(res.body.deletable, true);
    }
    assert.deepEqual(writes(google).map((r) => decodeURIComponent(r.path.split('/')[4])), [FAMILY, 'alex@example.com', FAMILY, FAMILY]);
  });
});
