// Read-only calendars from ICS links (ADR 0005): GET /api/calendar, deletes and adds against a fake
// Google plus fake ICS links serving the synthetic fixtures in test/fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../app.js';
import { decodeEventId, encodeReadOnlyId } from '../calendar.js';
import { expandIcs, parseIcs } from '../ics.js';
import { fakeGoogle, fakeIcs, icsFixture, serviceAccount } from './helpers.js';

const NOW = Date.parse('2026-10-19T12:00:00Z');
const MIN = 60000;
const FAMILY = 'family@group.calendar.google.com';
const PEOPLE = [
  { id: 'alex', name: 'Alex', colour: '#2D5BFF' },
  { id: 'sam', name: 'Sam', colour: '#E4007C' },
];

// Alex has a Google calendar and a Fastmail-style feed; Sam only an Outlook-style feed. Both feeds
// also carry a dinner Alex's Google calendar has (same UID + start).
const dinner = {
  id: 'dinner-g', iCalUID: 'shared-dinner@example.org', status: 'confirmed', summary: 'Dinner with friends',
  start: { dateTime: '2026-10-24T18:00:00-04:00' }, end: { dateTime: '2026-10-24T20:00:00-04:00' },
};

async function withServer(fn, opts) {
  opts = opts || {};
  const google = await fakeGoogle({
    [FAMILY]: { timeZone: 'America/Toronto', pages: [[]] },
    'alex@example.com': { pages: [[Object.assign({}, dinner)]] },
  });
  const feeds = Object.assign({
    'alex-fastmail': { body: icsFixture('fastmail.ics') },
    'sam-work': { body: icsFixture('outlook.ics') },
  }, opts.feeds || {});
  const ics = await fakeIcs(feeds);
  const logs = [];
  const log = { log: () => {}, warn: (m) => logs.push(['warn', m]), error: (m) => logs.push(['error', m]) };
  let clock = NOW;
  const settings = {
    people: PEOPLE,
    calendars: [
      { calendarId: FAMILY, person: 'family' },
      { ics: 'sam-work', url: ics.url('sam-work'), person: 'sam' },
      { ics: 'alex-fastmail', url: ics.url('alex-fastmail'), person: 'alex' },
      { calendarId: 'alex@example.com', person: 'alex' },
    ],
  };
  const srv = await startServer({
    config: { settings, serviceAccount: serviceAccount(), port: 0, timeZone: null },
    distDir: '/nonexistent', tokenUrl: google.tokenUrl, apiBase: google.apiBase,
    now: () => clock, log, icsTimeoutMs: 300,
  });
  try {
    await fn({ url: srv.url, google, ics, feeds, logs, advance: (ms) => { clock += ms; } });
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
const brief = (e) => [e.title, e.start, e.people.join('+')];

const EXPECTED = [
  ['Swim practice', '2026-10-14T17:00:00-04:00', 'alex'],
  ['Piano lesson', '2026-10-21T13:00:00-04:00', 'alex'],
  ['Quarterly review', '2026-10-22T12:00:00-04:00', 'sam'],
  ['School holiday', '2026-10-23', 'alex'],
  ['Dinner with friends', '2026-10-24T18:00:00-04:00', 'alex+sam'],
  ['Offsite', '2026-10-26T09:00:00-04:00', 'sam'],
  ['Offsite dinner', '2026-10-26T19:00:00-04:00', 'sam'],
  ['Swim practice (moved)', '2026-10-29T18:00:00-04:00', 'alex'],
  ['Planning', '2026-11-02T12:00:00-05:00', 'sam'],
  ['Swim practice', '2026-11-04T17:00:00-05:00', 'alex'],
  ['Swim practice', '2026-11-11T17:00:00-05:00', 'alex'],
  ['Swim practice', '2026-11-18T17:00:00-05:00', 'alex'],
  ['Swim practice', '2026-11-25T17:00:00-05:00', 'alex'],
];

// ------------------------------------------------------------ reading
test('feed events are listed at the right local times, owned by the configured person', async () => {
  await withServer(async ({ url }) => {
    const events = await calendar(url);
    assert.deepEqual(events.map(brief), EXPECTED);
    const piano = events[1];
    assert.deepEqual(Object.assign({}, piano, { id: undefined }), {
      id: undefined, title: 'Piano lesson', start: '2026-10-21T13:00:00-04:00', end: '2026-10-21T14:00:00-04:00',
      people: ['alex'], loc: 'Music room', notes: 'Bring the blue book', deletable: false,
    });
    assert.equal(events[2].end, '2026-10-22T13:00:00-04:00');
    assert.equal(events[2].loc, 'Room 4');
  });
});

test('a weekly event skips its EXDATE and shows the moved occurrence at its new time', async () => {
  await withServer(async ({ url }) => {
    const swims = (await calendar(url)).filter((e) => e.title.startsWith('Swim'));
    assert.deepEqual(swims.map((e) => [e.title, e.start, e.end]), [
      ['Swim practice', '2026-10-14T17:00:00-04:00', '2026-10-14T18:00:00-04:00'],
      ['Swim practice (moved)', '2026-10-29T18:00:00-04:00', '2026-10-29T19:00:00-04:00'],
      ['Swim practice', '2026-11-04T17:00:00-05:00', '2026-11-04T18:00:00-05:00'],
      ['Swim practice', '2026-11-11T17:00:00-05:00', '2026-11-11T18:00:00-05:00'],
      ['Swim practice', '2026-11-18T17:00:00-05:00', '2026-11-18T18:00:00-05:00'],
      ['Swim practice', '2026-11-25T17:00:00-05:00', '2026-11-25T18:00:00-05:00'],
    ]);
    assert.equal(new Set(swims.map((e) => e.id)).size, swims.length);
  });
});

test('an all-day feed event stays all-day on its dates', async () => {
  await withServer(async ({ url }) => {
    const hol = (await calendar(url)).find((e) => e.title === 'School holiday');
    assert.equal(hol.allDay, true);
    assert.equal(hol.start, '2026-10-23');
    assert.equal(hol.end, '2026-10-25');
  });
});

test('a TZID the file does not define is read in the frame zone, with one warning per feed', async () => {
  await withServer(async ({ url, logs, advance }) => {
    await calendar(url);
    advance(11 * MIN);
    const events = await calendar(url);
    assert.equal(events.find((e) => e.title === 'Offsite').start, '2026-10-26T09:00:00-04:00');
    const warns = logs.filter(([level]) => level === 'warn');
    assert.equal(warns.length, 1);
    assert.match(warns[0][1], /sam-work/);
    assert.match(warns[0][1], /Mystery Standard Time/);
  });
});

test('the same event on Google and a feed is listed once with both people, deletable by its Google copy', async () => {
  await withServer(async ({ url }) => {
    const d = (await calendar(url)).find((e) => e.title === 'Dinner with friends');
    assert.deepEqual(d.people, ['alex', 'sam']);
    assert.equal(d.deletable, true);
    assert.deepEqual(decodeEventId(d.id), { calendarId: 'alex@example.com', eventId: 'dinner-g' });
  });
});

// ------------------------------------------------------------ writing
test('a read-only event cannot be deleted: 4xx and nothing written', async () => {
  await withServer(async ({ url, google }) => {
    const piano = (await calendar(url)).find((e) => e.title === 'Piano lesson');
    assert.equal(piano.deletable, false);
    assert.equal(decodeEventId(piano.id).ics, 'alex-fastmail');
    const before = google.requests.length;
    const res = await call(url, 'DELETE', '/api/events/' + piano.id);
    assert.ok(res.status >= 400 && res.status < 500, 'status ' + res.status);
    assert.match(res.body.error, /read-only/);
    assert.equal((await call(url, 'DELETE', '/api/events/' + encodeReadOnlyId('not-configured', 'x'))).status, 404);
    assert.equal(google.requests.length, before);
  });
});

test('deleting a merged event removes the Google copy; the feed copy keeps showing', async () => {
  await withServer(async ({ url, google }) => {
    const d = (await calendar(url)).find((e) => e.title === 'Dinner with friends');
    assert.equal((await call(url, 'DELETE', '/api/events/' + d.id)).status, 204);
    assert.deepEqual(google.requests.filter((r) => r.method === 'DELETE').map((r) => r.path), ['/calendar/v3/calendars/' + encodeURIComponent('alex@example.com') + '/events/dinner-g']);
    const after = (await calendar(url)).find((e) => e.title === 'Dinner with friends');
    assert.deepEqual(after.people, ['sam']);
    assert.equal(after.deletable, false);
  });
});

test('adding an event for a person with only read-only calendars writes it to the Family calendar', async () => {
  await withServer(async ({ url, google }) => {
    const res = await call(url, 'POST', '/api/events', { title: 'Dentist', start: '2026-10-20T15:30:00Z', end: '2026-10-20T16:30:00Z', people: ['sam'] });
    assert.equal(res.status, 201);
    assert.equal(res.body.deletable, true);
    const writes = google.requests.filter((r) => r.method === 'POST' && r.path !== '/token');
    assert.deepEqual(writes.map((r) => r.path), ['/calendar/v3/calendars/' + encodeURIComponent(FAMILY) + '/events']);
  });
});

test('Google events say they can be deleted', async () => {
  await withServer(async ({ url }) => {
    const added = (await call(url, 'POST', '/api/events', { title: 'Dentist', start: '2026-10-20T15:30:00Z', end: '2026-10-20T16:30:00Z', people: ['alex'] })).body;
    const listed = (await calendar(url)).find((e) => e.id === added.id);
    assert.equal(listed.deletable, true);
  });
});

// ------------------------------------------------------------ caching and failures
test('each feed is cached about 10 minutes', async () => {
  await withServer(async ({ url, ics, advance }) => {
    await calendar(url);
    advance(9 * MIN);
    await calendar(url);
    assert.deepEqual(ics.requests.slice().sort(), ['alex-fastmail', 'sam-work']);
    advance(2 * MIN);
    await calendar(url);
    assert.equal(ics.requests.length, 4);
  });
});

for (const [name, broken] of [['returning 500', { status: 500 }], ['timing out', { hang: true }]]) {
  test('a feed ' + name + ' after a good fetch still has its events served; the others load normally', async () => {
    await withServer(async ({ url, feeds, logs, advance }) => {
      await calendar(url);
      feeds['sam-work'] = broken;
      feeds['alex-fastmail'] = { body: icsFixture('fastmail.ics').replace('SUMMARY:Piano lesson', 'SUMMARY:Piano lesson (new)') };
      advance(11 * MIN);
      const res = await call(url, 'GET', '/api/calendar');
      assert.equal(res.status, 200);
      const titles = res.body.events.map((e) => e.title);
      assert.ok(titles.includes('Quarterly review'), 'kept the last good copy');
      assert.ok(titles.includes('Piano lesson (new)'), 'other feed refreshed');
      assert.ok(logs.some(([level, m]) => level === 'error' && /sam-work/.test(m)), 'failure logged');
    });
  });
}

test('a failing feed is retried after 2 minutes, not on every load', async () => {
  await withServer(async ({ url, ics, feeds, advance }) => {
    await calendar(url);
    feeds['sam-work'] = { status: 500 };
    advance(11 * MIN);
    await calendar(url);
    const samFetches = () => ics.requests.filter((n) => n === 'sam-work').length;
    assert.equal(samFetches(), 2);
    advance(MIN);
    await calendar(url);
    assert.equal(samFetches(), 2);
    feeds['sam-work'] = { body: icsFixture('outlook.ics').replace('SUMMARY:Planning', 'SUMMARY:Planning (new)') };
    advance(2 * MIN);
    assert.ok((await calendar(url)).some((e) => e.title === 'Planning (new)'));
    assert.equal(samFetches(), 3);
  });
});

test('a feed that has never loaded shows nothing, and the rest of the calendar still loads', async () => {
  await withServer(async ({ url, logs }) => {
    const res = await call(url, 'GET', '/api/calendar');
    assert.equal(res.status, 200);
    const titles = res.body.events.map((e) => e.title);
    assert.ok(!titles.includes('Quarterly review'));
    assert.ok(titles.includes('Piano lesson'));
    assert.deepEqual(res.body.events.find((e) => e.title === 'Dinner with friends').people, ['alex']);
    assert.ok(logs.some(([level, m]) => level === 'error' && /sam-work/.test(m)));
  }, { feeds: { 'sam-work': { status: 500 } } });
});

test('a feed that is not iCalendar counts as failed', async () => {
  await withServer(async ({ url, logs }) => {
    const res = await call(url, 'GET', '/api/calendar');
    assert.equal(res.status, 200);
    assert.ok(!res.body.events.some((e) => e.people.includes('sam')));
    assert.ok(logs.some(([level, m]) => level === 'error' && /sam-work/.test(m)));
  }, { feeds: { 'sam-work': { body: '<html>Sign in</html>' } } });
});

// Every minute since 2020: the walk from DTSTART stops after MAX_STEPS (about 69 days) long
// before the window, which is logged once per parsed copy, naming the event and not the link.
test('a series too dense to walk to the window is logged once', async () => {
  const dense = 'BEGIN:VEVENT\nUID:dense@example.org\nDTSTART:20200101T000000Z\nDTEND:20200101T000100Z\nRRULE:FREQ=MINUTELY\nSUMMARY:Tick\nEND:VEVENT\n';
  const body = icsFixture('outlook.ics').replace(/(BEGIN:VEVENT)/, dense.replace(/\n/g, '\r\n') + '$1');
  await withServer(async ({ url, ics, logs }) => {
    for (let i = 0; i < 2; i++) {
      const res = await call(url, 'GET', '/api/calendar');
      assert.equal(res.status, 200);
      assert.ok(!res.body.events.some((e) => e.title === 'Tick'));
      assert.ok(res.body.events.some((e) => e.people.includes('sam'))); // the feed's other events still show
    }
    const warns = logs.filter(([level, m]) => level === 'warn' && /dense@example\.org/.test(m));
    assert.equal(warns.length, 1);
    assert.match(warns[0][1], /"sam-work".*"Tick"/);
    assert.ok(!warns[0][1].includes(ics.url('sam-work')));
  }, { feeds: { 'sam-work': { body } } });
});

// ------------------------------------------------------------ expansion edge cases
const vcal = (events) => parseIcs(icsFixture('fastmail.ics').replace(/BEGIN:VEVENT[\s\S]*END:VEVENT\n/, events));
const RANGE = { timeMin: new Date(NOW - 7 * 864e5).toISOString(), timeMax: new Date(NOW + 42 * 864e5).toISOString(), zone: 'America/Toronto' };

test('an endless daily event from long ago expands only inside the window', () => {
  const items = expandIcs(vcal('BEGIN:VEVENT\nUID:daily@example.org\nDTSTART;TZID=America/Toronto:20000101T070000\nDTEND;TZID=America/Toronto:20000101T073000\nRRULE:FREQ=DAILY\nSUMMARY:Walk the dog\nEND:VEVENT\n'), RANGE);
  assert.equal(items.length, 48); // 13 Oct … 29 Nov: the 30th's 7:00 is exactly timeMax
  assert.equal(items[0].start.dateTime, '2026-10-13T07:00:00-04:00');
  assert.equal(items[47].start.dateTime, '2026-11-29T07:00:00-05:00');
});

test('an EXDATE written in UTC still removes its occurrence', () => {
  const items = expandIcs(vcal('BEGIN:VEVENT\nUID:w@example.org\nDTSTART;TZID=America/Toronto:20261007T170000\nDTEND;TZID=America/Toronto:20261007T180000\nRRULE:FREQ=WEEKLY;COUNT=4\nEXDATE:20261014T210000Z\nSUMMARY:Weekly\nEND:VEVENT\n'), RANGE);
  assert.deepEqual(items.map((i) => i.start.dateTime), ['2026-10-21T17:00:00-04:00', '2026-10-28T17:00:00-04:00']);
});

test('floating times and an edited occurrence without its series are read in the frame zone', () => {
  const items = expandIcs(vcal('BEGIN:VEVENT\nUID:f@example.org\nDTSTART:20261020T080000\nDTEND:20261020T090000\nSUMMARY:Floating\nEND:VEVENT\nBEGIN:VEVENT\nUID:orphan@example.org\nRECURRENCE-ID:20261021T120000Z\nDTSTART:20261021T130000Z\nDTEND:20261021T140000Z\nSUMMARY:Orphan\nEND:VEVENT\n'), RANGE);
  assert.deepEqual(items.map((i) => [i.summary, i.start.dateTime]), [['Floating', '2026-10-20T08:00:00-04:00'], ['Orphan', '2026-10-21T09:00:00-04:00']]);
});

test('two series with the same UID both show', () => {
  const items = expandIcs(vcal('BEGIN:VEVENT\nUID:dup@example.org\nDTSTART:20261020T130000Z\nDTEND:20261020T140000Z\nSUMMARY:One\nEND:VEVENT\nBEGIN:VEVENT\nUID:dup@example.org\nDTSTART:20261022T130000Z\nDTEND:20261022T140000Z\nSUMMARY:Two\nEND:VEVENT\n'), RANGE);
  assert.deepEqual(items.map((i) => i.summary), ['One', 'Two']);
});

test('an all-day event without DTEND lasts one day', () => {
  const [item] = expandIcs(vcal('BEGIN:VEVENT\nUID:b@example.org\nDTSTART;VALUE=DATE:20261031\nSUMMARY:Halloween\nEND:VEVENT\n'), RANGE);
  assert.deepEqual([item.start, item.end], [{ date: '2026-10-31' }, { date: '2026-11-01' }]);
});
