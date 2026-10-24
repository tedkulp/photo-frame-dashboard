// A timed event from local midnight to a later local midnight (how Outlook → Google conversion
// writes all-day events) is served as an all-day event, from Google and read-only calendars alike.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeEventId } from '../calendar.js';
import { fakeGoogle, fakeIcs, serviceAccount, startTestServer } from './helpers.js';

const NOW = Date.parse('2026-10-19T12:00:00Z');
const FAMILY = 'family@group.calendar.google.com';
const PEOPLE = [{ id: 'alex', name: 'Alex', colour: '#2D5BFF' }];

const timed = (id, summary, start, end) => ({ id, status: 'confirmed', summary, start: { dateTime: start }, end: { dateTime: end } });
const allDay = (id, summary, start, end) => ({ id, status: 'confirmed', summary, start: { date: start }, end: { date: end } });

function vcal(events) {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//EN']
    .concat(...events.map(([uid, summary, start, end]) => ['BEGIN:VEVENT', 'UID:' + uid, 'SUMMARY:' + summary, 'DTSTAMP:20261001T120000Z', 'DTSTART;TZID=America/New_York:' + start, 'DTEND;TZID=America/New_York:' + end, 'END:VEVENT']),
      ['END:VCALENDAR']).join('\r\n') + '\r\n';
}

async function withServer(items, fn, icsEvents) {
  const google = await fakeGoogle({ [FAMILY]: { timeZone: 'America/New_York', pages: [items] } });
  const ics = await fakeIcs({ work: { body: vcal(icsEvents || []) } });
  const settings = {
    people: PEOPLE,
    calendars: [{ calendarId: FAMILY, person: 'family' }, { ics: 'work', url: ics.url('work'), person: 'alex' }],
  };
  const log = { log: () => {}, warn: () => {}, error: () => {} };
  const srv = await startTestServer({
    config: { settings, serviceAccount: serviceAccount(), port: 0, timeZone: 'America/New_York' },
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

const events = async (url) => (await (await fetch(url + '/api/calendar')).json()).events;
const shape = (e) => ({ title: e.title, allDay: e.allDay, start: e.start, end: e.end });

test('a Google item from midnight to the next midnight is served as a one-day all-day event', async () => {
  await withServer([timed('o1', 'Holiday', '2026-10-24T00:00:00-04:00', '2026-10-25T00:00:00-04:00')], async ({ url }) => {
    const [e] = await events(url);
    assert.deepEqual(shape(e), { title: 'Holiday', allDay: true, start: '2026-10-24', end: '2026-10-25' });
    assert.equal(e.deletable, true);
  });
});

test('a multi-day midnight-to-midnight item covers its dates, also across a DST change', async () => {
  await withServer([
    timed('o1', 'Trip', '2026-10-24T00:00:00-04:00', '2026-10-27T00:00:00-04:00'),
    timed('o2', 'Fall back', '2026-10-31T00:00:00-04:00', '2026-11-02T00:00:00-05:00'),
  ], async ({ url }) => {
    assert.deepEqual((await events(url)).map(shape), [
      { title: 'Trip', allDay: true, start: '2026-10-24', end: '2026-10-27' },
      { title: 'Fall back', allDay: true, start: '2026-10-31', end: '2026-11-02' },
    ]);
  });
});

test('a read-only timed event from midnight to midnight is served as all-day', async () => {
  await withServer([], async ({ url }) => {
    const [e] = await events(url);
    assert.deepEqual(shape(e), { title: 'Conference', allDay: true, start: '2026-10-22', end: '2026-10-24' });
    assert.equal(e.deletable, false);
  }, [['conf@example.org', 'Conference', '20261022T000000', '20261024T000000']]);
});

test('items that do not start and end at midnight on different dates stay timed', async () => {
  await withServer([
    timed('a', 'Until 23:59', '2026-10-24T00:00:00-04:00', '2026-10-24T23:59:00-04:00'),
    timed('b', 'Half hour', '2026-10-25T00:00:00-04:00', '2026-10-25T00:30:00-04:00'),
    timed('c', 'Instant', '2026-10-26T00:00:00-04:00', '2026-10-26T00:00:00-04:00'),
    timed('d', 'Ends at midnight', '2026-10-27T09:00:00-04:00', '2026-10-28T00:00:00-04:00'),
  ], async ({ url }) => {
    const list = await events(url);
    assert.deepEqual(list.map((e) => [e.title, e.allDay, e.start, e.end]), [
      ['Until 23:59', undefined, '2026-10-24T00:00:00-04:00', '2026-10-24T23:59:00-04:00'],
      ['Half hour', undefined, '2026-10-25T00:00:00-04:00', '2026-10-25T00:30:00-04:00'],
      ['Instant', undefined, '2026-10-26T00:00:00-04:00', '2026-10-26T00:00:00-04:00'],
      ['Ends at midnight', undefined, '2026-10-27T09:00:00-04:00', '2026-10-28T00:00:00-04:00'],
    ]);
  });
});

test('a converted event can be deleted, and the delete reaches the original Google item', async () => {
  await withServer([timed('outlook-1', 'Holiday', '2026-10-24T00:00:00-04:00', '2026-10-25T00:00:00-04:00')], async ({ url, google }) => {
    const [e] = await events(url);
    assert.deepEqual(decodeEventId(e.id), { calendarId: FAMILY, eventId: 'outlook-1' });
    const res = await fetch(url + '/api/events/' + e.id, { method: 'DELETE' });
    assert.equal(res.status, 204);
    assert.deepEqual(google.requests.filter((r) => r.method === 'DELETE').map((r) => r.path), ['/calendar/v3/calendars/' + encodeURIComponent(FAMILY) + '/events/outlook-1']);
    assert.deepEqual(await events(url), []);
  });
});

test('converted events sort with the all-day events of their start day, before its timed ones', async () => {
  await withServer([
    timed('t', 'Breakfast', '2026-10-24T08:00:00-04:00', '2026-10-24T09:00:00-04:00'),
    timed('late', 'Late night', '2026-10-23T23:00:00-04:00', '2026-10-23T23:30:00-04:00'),
    timed('c', 'Converted', '2026-10-24T00:00:00-04:00', '2026-10-25T00:00:00-04:00'),
    timed('m', 'Midnight snack', '2026-10-24T00:00:00-04:00', '2026-10-24T00:15:00-04:00'),
    allDay('n', 'Native', '2026-10-24', '2026-10-25'),
  ], async ({ url }) => {
    const list = await events(url);
    assert.deepEqual(list.map((e) => e.title), ['Late night', 'Converted', 'Native', 'Midnight snack', 'Breakfast']);
  });
});
