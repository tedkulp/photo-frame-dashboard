// The frame's time zone and today's local date (framezone.js), with an injected lookup and clock:
// no HTTP server, no fake Google.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFrameZone, localDate } from '../framezone.js';
import { createCalendar, familyZoneLookup } from '../calendar.js';
import { settings } from './helpers.js';

const FAMILY = 'family@group.calendar.google.com';

const LOCAL = Intl.DateTimeFormat().resolvedOptions().timeZone;
// 23:30 on Monday in Toronto, 03:30 on Tuesday in UTC.
const T = Date.parse('2026-10-20T03:30:00Z');

// A lookup that answers from `answers` in turn (a string, or an Error to reject with) and counts calls.
function lookupOf(...answers) {
  const fn = async () => {
    const a = answers[Math.min(fn.calls++, answers.length - 1)];
    if (a instanceof Error) throw a;
    return a;
  };
  fn.calls = 0;
  return fn;
}

function quietLog() {
  const errors = [];
  return { errors, error: (m) => errors.push(m), warn() {}, log() {} };
}

test('TZ wins and the lookup is never called', async () => {
  const lookup = lookupOf('Asia/Tokyo');
  const fz = createFrameZone({ timeZone: 'America/Toronto', lookup, now: () => T });
  assert.equal(await fz.settle('Europe/Paris'), 'America/Toronto');
  assert.equal(await fz.zone(), 'America/Toronto');
  assert.equal(await fz.today(), '2026-10-19');
  assert.equal(lookup.calls, 0);
});

test('a reported zone is used and the lookup is skipped', async () => {
  const lookup = lookupOf('Asia/Tokyo');
  const fz = createFrameZone({ lookup, now: () => T });
  await fz.settle('America/Vancouver');
  assert.equal(await fz.zone(), 'America/Vancouver');
  assert.equal(await fz.today(), '2026-10-19');
  assert.equal(lookup.calls, 0);
});

test('a newer reported zone replaces an older one; an empty one is ignored', async () => {
  const fz = createFrameZone({ lookup: lookupOf('UTC'), now: () => T });
  await fz.settle('America/Vancouver');
  await fz.settle('Asia/Tokyo');
  assert.equal(await fz.settle(undefined), 'Asia/Tokyo');
  assert.equal(await fz.zone(), 'Asia/Tokyo');
  assert.equal(await fz.today(), '2026-10-20');
});

test('a reported zone replaces a looked-up one', async () => {
  const lookup = lookupOf('America/Vancouver');
  const fz = createFrameZone({ lookup, now: () => T });
  assert.equal(await fz.zone(), 'America/Vancouver');
  assert.equal(await fz.settle('Asia/Tokyo'), 'Asia/Tokyo');
  assert.equal(await fz.zone(), 'Asia/Tokyo');
  assert.equal(lookup.calls, 1);
});

test('a successful lookup is cached', async () => {
  const lookup = lookupOf('Asia/Tokyo');
  const fz = createFrameZone({ lookup, now: () => T });
  assert.equal(await fz.zone(), 'Asia/Tokyo');
  assert.equal(await fz.today(), '2026-10-20');
  assert.equal(await fz.settle(undefined), 'Asia/Tokyo');
  assert.equal(lookup.calls, 1);
});

test('a failed lookup falls back to the local zone for that call, logs, and retries on the next', async () => {
  const lookup = lookupOf(new Error('boom'), new Error('boom'), 'Asia/Tokyo');
  const log = quietLog();
  const fz = createFrameZone({ lookup, now: () => T, log });
  assert.equal(await fz.zone(), LOCAL);
  assert.equal(log.errors.length, 1);
  assert.match(log.errors[0], /^frame zone: .*local time zone.*boom/);
  assert.equal(await fz.today(), localDate(T, LOCAL));
  assert.equal(log.errors.length, 2);
  assert.equal(await fz.zone(), 'Asia/Tokyo');
  assert.equal(await fz.zone(), 'Asia/Tokyo');
  assert.equal(lookup.calls, 3);
  assert.equal(log.errors.length, 2);
});

test('settle never falls back: with nothing reported, a failed lookup rejects, and is retried', async () => {
  const lookup = lookupOf(new Error('set TZ'), 'Asia/Tokyo');
  const log = quietLog();
  const fz = createFrameZone({ lookup, now: () => T, log });
  await assert.rejects(fz.settle(undefined), /set TZ/);
  assert.equal(await fz.settle(undefined), 'Asia/Tokyo');
  assert.equal(log.errors.length, 0);
});

test('settle learns what a load reported and answers without a lookup; TZ still wins', async () => {
  const lookup = lookupOf('UTC');
  const fz = createFrameZone({ lookup, now: () => T });
  assert.equal(fz.configured, null);
  assert.equal(await fz.settle('America/Vancouver'), 'America/Vancouver');
  assert.equal(await fz.settle(undefined), 'America/Vancouver');
  assert.equal(await fz.today(), '2026-10-19');
  assert.equal(lookup.calls, 0);
  const tz = createFrameZone({ timeZone: 'Asia/Tokyo', lookup, now: () => T });
  assert.equal(tz.configured, 'Asia/Tokyo');
  assert.equal(await tz.settle('America/Vancouver'), 'Asia/Tokyo');
});

test('today() changes date across local midnight in the chosen zone', async () => {
  const clock = { now: Date.parse('2026-10-20T03:59:00Z') }; // 23:59 Monday in Toronto
  const fz = createFrameZone({ timeZone: 'America/Toronto', lookup: lookupOf('UTC'), now: () => clock.now });
  assert.equal(await fz.today(), '2026-10-19');
  clock.now += 60 * 1000;
  assert.equal(await fz.today(), '2026-10-20');
  const tokyo = createFrameZone({ lookup: lookupOf('Asia/Tokyo'), now: () => clock.now });
  clock.now = Date.parse('2026-10-20T14:59:00Z'); // 23:59 Tuesday in Tokyo
  assert.equal(await tokyo.today(), '2026-10-20');
  clock.now += 60 * 1000;
  assert.equal(await tokyo.today(), '2026-10-21');
});

test('localDate is the date at an instant in a zone', () => {
  assert.equal(localDate(T, 'America/Toronto'), '2026-10-19');
  assert.equal(localDate(T, 'UTC'), '2026-10-20');
});

// ------------------------------------------------------------ with the calendar
// A Google that answers every list with no events; the Family calendar's timeZone comes from
// `familyZones` in turn (undefined: Google said nothing). Records [calendarId, opts] per call.
function googleOf(...familyZones) {
  const calls = [];
  let n = 0;
  return {
    calls,
    async listEvents(calendarId, opts) {
      calls.push([calendarId, opts]);
      if (calendarId !== FAMILY) return { items: [], timeZone: 'UTC' };
      return { items: [], timeZone: familyZones[Math.min(n++, familyZones.length - 1)] };
    },
  };
}
function calendarWith(google) {
  const s = settings();
  const frameZone = createFrameZone({ lookup: familyZoneLookup({ settings: s, google, now: () => T }), now: () => T, log: quietLog() });
  return createCalendar({ settings: s, google, frameZone, now: () => T, log: quietLog() });
}

test('TZ unset and the Family events say no zone, none reported yet: one more lookup, then "set TZ"', async () => {
  const google = googleOf(undefined, undefined);
  await assert.rejects(calendarWith(google).load(), /Family calendar.*set TZ/);
  assert.deepEqual(google.calls.map(([id]) => id), [FAMILY, FAMILY], 'the load, then the lookup; no other calendar');
  assert.equal(google.calls[0][1].timeZone, null);
  assert.equal(Date.parse(google.calls[1][1].timeMax) - Date.parse(google.calls[1][1].timeMin), 60000);
});

test('TZ unset and the Family events say no zone: a lookup that finds one lets the load go on in it', async () => {
  const google = googleOf(undefined, 'Europe/Paris');
  const out = await calendarWith(google).load();
  assert.deepEqual(out.events, []);
  assert.deepEqual(google.calls.map(([id]) => id), [FAMILY, FAMILY, 'alex@example.com', 'sam@example.com']);
  assert.deepEqual(google.calls.slice(2).map(([, o]) => o.timeZone), ['Europe/Paris', 'Europe/Paris']);
});
