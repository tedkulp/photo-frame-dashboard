import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../js/feed.js';

const Feed = globalThis.Feed;
const MIN = 60000;

const people = [
  { id: 'ted', name: 'Ted', colour: '#2D5BFF' },
  { id: 'sam', name: 'Sam', colour: '#FFB000' },
];
const body = (over) => Object.assign({
  people,
  events: [
    { id: 'a', title: 'Holiday', start: '2026-10-19', end: '2026-10-21', allDay: true, people: ['ted', 'sam'] },
    { id: 'b', title: 'Dentist', start: '2026-10-19T09:30:00-04:00', end: '2026-10-19T10:00:00-04:00', people: ['sam'], loc: 'Clinic', notes: 'Bring card' },
  ],
  updatedAt: '2026-10-19T12:00:00.000Z',
}, over);

// ------------------------------------------------------------ people
test('derives rgb triplet and a readable ink from colour', () => {
  assert.deepEqual(Feed.person(people[0]), { id: 'ted', name: 'Ted', color: '#2D5BFF', rgb: '45 91 255', ink: '#FFFFFF' });
  assert.equal(Feed.person(people[1]).ink, '#111111');
  assert.equal(Feed.person({ id: 'x', name: 'X', colour: '#ffffff' }).ink, '#111111');
  assert.equal(Feed.person({ id: 'x', name: 'X', colour: '#000000' }).ink, '#FFFFFF');
});

// ------------------------------------------------------------ events
test('all-day events land on that local date; timed events keep their instant', () => {
  const d = Feed.parse(body());
  const [allDay, timed] = d.events;
  assert.ok(allDay.start instanceof Date && allDay.end instanceof Date);
  assert.equal(allDay.allDay, true);
  assert.deepEqual([allDay.start.getFullYear(), allDay.start.getMonth(), allDay.start.getDate(), allDay.start.getHours()], [2026, 9, 19, 0]);
  assert.deepEqual([allDay.end.getMonth(), allDay.end.getDate(), allDay.end.getHours()], [9, 21, 0]);
  assert.equal(timed.start.getTime(), Date.UTC(2026, 9, 19, 13, 30));
  assert.equal(timed.end.getTime(), Date.UTC(2026, 9, 19, 14, 0));
  assert.equal(timed.allDay, undefined);
  assert.equal(timed.loc, 'Clinic');
  assert.equal(timed.notes, 'Bring card');
  assert.equal(timed.travel, undefined);
  assert.deepEqual(timed.people, ['sam']);
  assert.equal(d.people[1].ink, '#111111');
});

test('rejects a response without people or events', () => {
  assert.throws(() => Feed.parse({ events: [] }));
  assert.throws(() => Feed.parse({ people: [], events: [] }));
  assert.throws(() => Feed.parse({ people, events: 'x' }));
  assert.throws(() => Feed.parse(null));
});

test('drops events with unparseable dates instead of failing the whole response', () => {
  const d = Feed.parse(body({ events: [{ id: 'x', title: 'Bad', start: 'nope', end: 'nope', people: [] }] }));
  assert.equal(d.events.length, 0);
});

// ------------------------------------------------------------ mock data reassignment
function mock() {
  return {
    chores: [
      { id: 'c1', who: 'alex' }, { id: 'c2', who: 'jordan' }, { id: 'c3', who: 'maya' },
      { id: 'c4', who: 'otto', doneBy: 'maya' }, { id: 'c5', who: 'any', doneBy: 'otto' }, { id: 'c6', who: 'any', doneBy: 'alex' },
    ],
    stars: { maya: 42, otto: 57 },
    week: { maya: [1], otto: [0] },
    photos: [{ seed: 'p1', from: 'alex' }, { seed: 'p2', from: 'otto' }],
  };
}

test('reassigns mock entries to real people by position and drops the rest', () => {
  const D = mock();
  Feed.remap(D, ['alex', 'jordan', 'maya', 'otto'], ['a', 'b', 'c']);
  assert.deepEqual(D.chores.map((c) => c.who), ['a', 'b', 'c', 'any', 'any']);
  assert.equal(D.chores.filter((c) => c.who === 'any')[0].doneBy, undefined);
  assert.equal(D.chores.filter((c) => c.who === 'any')[1].doneBy, 'a');
  assert.deepEqual(D.stars, { c: 42 });
  assert.deepEqual(D.week, { c: [1] });
  assert.deepEqual(D.photos.map((p) => p.from), ['a']);
});

test('real people beyond the mock list get nothing', () => {
  const D = mock();
  Feed.remap(D, ['alex', 'jordan', 'maya', 'otto'], ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(D.chores.map((c) => c.who), ['a', 'b', 'c', 'd', 'any', 'any']);
  assert.equal(D.chores[3].doneBy, 'c');
  assert.deepEqual(D.stars, { c: 42, d: 57 });
  assert.equal(D.chores.some((c) => c.who === 'e'), false);
});

// ------------------------------------------------------------ refresh loop
function harness(opts) {
  opts = opts || {};
  const h = {
    t: Date.UTC(2026, 9, 19, 12, 0),
    timers: [],
    store: opts.store || {},
    calls: 0,
    changes: [],
    states: 0,
    seen: [],
    respond: opts.respond || (() => ({ ok: true, json: () => Promise.resolve(body()) })),
  };
  h.feed = Feed.create({
    url: '/api/calendar',
    fetch: () => { h.calls++; return Promise.resolve().then(() => h.respond()); },
    storage: opts.storage || {
      getItem: (k) => (k in h.store ? h.store[k] : null),
      setItem: (k, v) => { h.store[k] = v; },
    },
    now: () => h.t,
    setTimeout: (fn, ms) => { const t = { fn, at: h.t + ms, ms }; h.timers.push(t); return t; },
    clearTimeout: (t) => { h.timers = h.timers.filter((x) => x !== t); },
    onChange: (d) => { h.changes.push(d); h.seen.push(h.feed.state()); },
    onState: () => h.states++,
  });
  h.settle = () => new Promise((r) => setImmediate(r));
  // Run the next timer (advancing the clock to it) and let its fetch settle.
  h.next = async () => {
    h.timers.sort((a, b) => a.at - b.at);
    const t = h.timers.shift();
    h.t = t.at;
    t.fn();
    await h.settle();
    return t.ms;
  };
  return h;
}
const failing = () => { throw new Error('offline'); };

test('first fetch fills data, caches it and schedules a 5 minute refresh', async () => {
  const h = harness();
  h.feed.start();
  assert.equal(h.feed.state().status, 'loading');
  await h.settle();
  assert.equal(h.changes.length, 1);
  assert.equal(h.changes[0].events.length, 2);
  assert.equal(h.feed.state().status, 'ok');
  assert.ok(h.store['homehq.calendar']);
  assert.equal(h.timers.length, 1);
  assert.equal(h.timers[0].ms, 5 * MIN);
});

test('state is already fresh and ok when onChange runs, so views render the new data', async () => {
  const stale = harness();
  stale.feed.start();
  await stale.settle();
  const store = { 'homehq.calendar': JSON.stringify({ at: Date.UTC(2026, 9, 19, 11, 0), body: body() }) };
  const h = harness({ store, respond: () => ({ ok: true, json: () => Promise.resolve(body({ events: [] })) }) });
  h.feed.start();
  await h.settle();
  assert.deepEqual(stale.seen.map((s) => [s.status, s.stale]), [['ok', false]]);
  assert.deepEqual(h.seen.map((s) => [s.status, s.stale]), [['ok', true], ['ok', false]]);
});

test('an unchanged refresh does not report a change', async () => {
  const h = harness();
  h.feed.start();
  await h.settle();
  await h.next();
  assert.equal(h.calls, 2);
  assert.equal(h.changes.length, 1);
});

test('a cached response is used before any fetch, even when offline', async () => {
  const first = harness();
  first.feed.start();
  await first.settle();

  const h = harness({ store: first.store, respond: failing });
  h.feed.start();
  assert.equal(h.changes.length, 1, 'cache applied synchronously');
  assert.equal(h.changes[0].events[0].start.getDate(), 19);
  await h.settle();
  assert.equal(h.feed.state().status, 'ok');
});

test('failures retry with growing backoff and never give up', async () => {
  const h = harness({ respond: failing });
  h.feed.start();
  await h.settle();
  assert.equal(h.feed.state().status, 'offline');
  assert.equal(h.states, 1, 'told about the failure so the offline note can show');
  const waits = [];
  for (let i = 0; i < 9; i++) waits.push(await h.next());
  assert.deepEqual(waits, [5000, 10000, 20000, 40000, 80000, 160000, 300000, 300000, 300000]);
  h.respond = () => ({ ok: true, json: () => Promise.resolve(body()) });
  await h.next();
  assert.equal(h.feed.state().status, 'ok');
  assert.equal(h.changes.length, 1);
  assert.equal(h.timers[0].ms, 5 * MIN, 'back on the normal refresh after recovering');
});

test('HTTP errors and bad JSON count as failures', async () => {
  const h = harness({ respond: () => ({ ok: false, status: 502, json: () => Promise.resolve({ error: 'x' }) }) });
  h.feed.start();
  await h.settle();
  assert.equal(h.feed.state().status, 'offline');
  h.respond = () => ({ ok: true, json: () => Promise.reject(new SyntaxError('html')) });
  await h.next();
  assert.equal(h.feed.state().status, 'offline');
  assert.equal(h.changes.length, 0);
});

test('stale after 15 minutes without a successful fetch, with the age in minutes', async () => {
  const h = harness();
  h.feed.start();
  await h.settle();
  h.respond = failing;
  h.t += 14 * MIN;
  assert.equal(h.feed.state().stale, false);
  h.t += 1 * MIN;
  assert.equal(h.feed.state().stale, true);
  assert.equal(h.feed.state().age, 15);
  h.respond = () => ({ ok: true, json: () => Promise.resolve(body()) });
  await h.next();
  assert.equal(h.feed.state().stale, false);
});

test('a cached response older than 15 minutes is stale at boot', () => {
  const store = { 'homehq.calendar': JSON.stringify({ at: Date.UTC(2026, 9, 19, 11, 0), body: body() }) };
  const h = harness({ store, respond: failing });
  h.feed.start();
  assert.equal(h.feed.state().stale, true);
  assert.equal(h.feed.state().age, 60);
});

test('broken or unavailable storage is ignored', async () => {
  const h = harness({ store: { 'homehq.calendar': '{not json' } });
  h.feed.start();
  assert.equal(h.changes.length, 0);
  await h.settle();
  assert.equal(h.changes.length, 1);

  const boom = () => { throw new Error('SecurityError'); };
  const h2 = harness({ storage: { getItem: boom, setItem: boom } });
  h2.feed.start();
  await h2.settle();
  assert.equal(h2.feed.state().status, 'ok');
});
