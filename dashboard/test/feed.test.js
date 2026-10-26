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

test('an event says whether it can be deleted; read-only ones (deletable: false) cannot', () => {
  const d = Feed.parse(body({ events: [
    { id: 'g', title: 'Google', start: '2026-10-19T09:30:00-04:00', end: '2026-10-19T10:00:00-04:00', people: [], deletable: true },
    { id: 'r', title: 'Work', start: '2026-10-19T11:00:00-04:00', end: '2026-10-19T12:00:00-04:00', people: [], deletable: false },
    // A response cached from a server before read-only calendars: every event was on Google.
    { id: 'old', title: 'Old', start: '2026-10-19T13:00:00-04:00', end: '2026-10-19T14:00:00-04:00', people: [] },
  ] }));
  assert.deepEqual(d.events.map((e) => e.deletable), [true, false, true]);
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
// Mock photos (shown without an Immich album); chores come from the home server.
function mock() {
  return {
    photos: [{ seed: 'p1', from: 'alex' }, { seed: 'p2', from: 'otto' }, { seed: 'p3', from: 'maya' }],
    chores: { date: '2026-10-21', chores: [{ id: '1', owner: 'otto' }] },
  };
}

test('reassigns mock photos to real people by position and drops the rest', () => {
  const D = mock();
  const photos = Feed.remap(D.photos, ['alex', 'jordan', 'maya', 'otto'], ['a', 'b', 'c']);
  assert.deepEqual(photos.map((p) => p.from), ['a', 'c']);
});

test('real people beyond the mock list get nothing, and real chores are left alone', () => {
  const D = mock();
  const photos = Feed.remap(D.photos, ['alex', 'jordan', 'maya', 'otto'], ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(photos.map((p) => p.from), ['a', 'd', 'c']);
  assert.deepEqual(D.chores, mock().chores);
});

// ------------------------------------------------------------ refresh loop
function harness(opts) {
  opts = opts || {};
  const h = {
    t: Date.UTC(2026, 9, 19, 12, 0),
    timers: [],
    store: opts.store || {},
    calls: 0,
    requests: [],
    changes: [],
    states: 0,
    seen: [],
    respond: opts.respond || (() => ({ ok: true, json: () => Promise.resolve(body()) })),
  };
  h.feed = Feed.calendar(Object.assign({
    url: '/api/calendar',
    data: { events: [] },
    fetch: (url, init) => { h.calls++; h.requests.push({ url, init }); return Promise.resolve().then(() => h.respond(url, init)); },
    storage: opts.storage || {
      getItem: (k) => (k in h.store ? h.store[k] : null),
      setItem: (k, v) => { h.store[k] = v; },
    },
    now: () => h.t,
    setTimeout: (fn, ms) => { const t = { fn, at: h.t + ms, ms }; h.timers.push(t); return t; },
    clearTimeout: (t) => { h.timers = h.timers.filter((x) => x !== t); },
    onChange: (d) => { h.changes.push(d); h.seen.push(h.feed.state()); },
    onState: () => h.states++,
  }, opts.create));
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

test('a refresh that only changes updatedAt does not report a change', async () => {
  const h = harness();
  h.feed.start();
  await h.settle();
  h.respond = () => ({ ok: true, json: () => Promise.resolve(body({ updatedAt: '2026-10-19T12:05:00.000Z' })) });
  await h.next();
  assert.equal(h.changes.length, 1);
  assert.equal(h.timers[0].ms, 5 * MIN);
});

test('an error while applying data is not a fetch failure: cached and on the normal schedule', async () => {
  const h = harness();
  h.feed = Feed.create({
    url: '/api/calendar', fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve(body()) }),
    storage: { getItem: () => null, setItem: (k, v) => { h.store[k] = v; } },
    now: () => h.t, setTimeout: (fn, ms) => { const t = { fn, at: h.t + ms, ms }; h.timers.push(t); return t; },
    clearTimeout: (t) => { h.timers = h.timers.filter((x) => x !== t); }, onChange: () => { throw new Error('render bug'); }, onError: (e) => h.errors.push(e.message),
  });
  h.errors = [];
  h.feed.start();
  await h.settle();
  assert.deepEqual(h.errors, ['render bug']);
  assert.equal(h.feed.state().status, 'ok');
  assert.ok(h.store['homehq.calendar']);
  assert.equal(h.timers[0].ms, 5 * MIN);
});

test('a fetch that never settles times out and is retried', async () => {
  const h = harness({ respond: () => new Promise(() => {}) });
  h.feed.start();
  await h.settle();
  assert.equal(h.timers[0].ms, 30000, 'timeout armed');
  await h.next();
  assert.equal(h.feed.state().status, 'offline');
  assert.equal(h.timers[0].ms, 5000);
  h.respond = () => ({ ok: true, json: () => Promise.resolve(body()) });
  await h.next();
  assert.equal(h.feed.state().status, 'ok');
  assert.equal(h.timers.length, 1, 'no stray timeout timers left');
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

// ------------------------------------------------------------ add + remove
const json = (status, obj) => ({ ok: status < 300, status, json: () => Promise.resolve(obj) });
const added = { id: 'new1', title: 'Dentist', start: '2026-10-20T15:30:00Z', end: '2026-10-20T16:30:00Z', people: ['sam'] };
const input = { title: 'Dentist', start: '2026-10-20T15:30:00.000Z', end: '2026-10-20T16:30:00.000Z', people: ['sam'] };
// Answers GETs with the normal body and everything else with `write`.
const routes = (write) => (url, init) => (init && init.method && init.method !== 'GET' ? write(url, init) : json(200, body()));

test('add posts the event as JSON and resolves with it parsed, then refreshes the calendar', async () => {
  const h = harness({ respond: routes(() => json(201, added)) });
  h.feed.start();
  await h.settle();
  let got;
  h.feed.add(input).then((e) => { got = e; });
  await h.settle();
  const post = h.requests[1];
  assert.equal(post.url, '/api/events');
  assert.equal(post.init.method, 'POST');
  assert.equal(post.init.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(post.init.body), input);
  assert.equal(got.id, 'new1');
  assert.ok(got.start instanceof Date);
  assert.equal(got.start.getTime(), Date.UTC(2026, 9, 20, 15, 30));
  assert.deepEqual(h.timers.map((t) => t.ms), [0], 'calendar refresh queued right away');
});

test('add rejects with the server error and changes nothing when the input is refused', async () => {
  const h = harness({ respond: routes(() => json(400, { error: 'title is missing' })) });
  h.feed.start();
  await h.settle();
  const err = await h.feed.add(input).then(() => null, (e) => e);
  assert.equal(err.message, 'title is missing');
  assert.equal(h.feed.state().failed, false);
  assert.deepEqual(h.timers.map((t) => t.ms), [5 * MIN]);
});

test('add rejects when Google fails, with its message, and counts as a failed request', async () => {
  const h = harness({ respond: routes(() => json(502, { error: 'Google Calendar x: 403 Writer access required' })) });
  h.feed.start();
  await h.settle();
  const err = await h.feed.add(input).then(() => null, (e) => e);
  assert.match(err.message, /Writer access required/);
  assert.equal(h.feed.state().failed, true);
  assert.deepEqual(h.timers.map((t) => t.ms), [5000]);
});

test('add with an empty 2xx answer rejects clearly', async () => {
  const h = harness({ respond: routes(() => ({ ok: true, status: 201, json: () => Promise.reject(new SyntaxError('empty')) })) });
  h.feed.start();
  await h.settle();
  const err = await h.feed.add(input).then(() => null, (e) => e);
  assert.match(err.message, /Unexpected response/);
});

test('add that cannot reach the server rejects, marks the feed failed and retries the calendar soon', async () => {
  const h = harness({ respond: routes(failing) });
  h.feed.start();
  await h.settle();
  const err = await h.feed.add(input).then(() => null, (e) => e);
  assert.match(err.message, /Can’t reach the home server/);
  assert.equal(h.feed.state().failed, true);
  assert.equal(h.feed.state().status, 'ok', 'the calendar data is still there');
  assert.ok(h.states >= 2, 'told about it so the add button can turn off');
  assert.deepEqual(h.timers.map((t) => t.ms), [5000]);
  await h.next();
  assert.equal(h.feed.state().failed, false, 'cleared by the next good fetch');
});

test('add that never settles times out and says it may still have been added', async () => {
  const h = harness({ respond: routes(() => new Promise(() => {})) });
  h.feed.start();
  await h.settle();
  let err;
  h.feed.add(input).catch((e) => { err = e; });
  await h.settle();
  h.timers.sort((a, b) => a.at - b.at);
  const timeout = h.timers.find((t) => t.ms === 30000);
  h.timers = h.timers.filter((t) => t !== timeout);
  timeout.fn();
  await h.settle();
  assert.match(err.message, /No answer from the home server · check the calendar/);
  assert.equal(h.feed.state().failed, true);
});

test('remove sends DELETE for the encoded id, then refreshes the calendar', async () => {
  const h = harness({ respond: routes(() => ({ ok: true, status: 204, json: () => Promise.reject(new Error('no body')) })) });
  h.feed.start();
  await h.settle();
  await h.feed.remove('a/b=');
  assert.equal(h.requests[1].url, '/api/events/a%2Fb%3D');
  assert.equal(h.requests[1].init.method, 'DELETE');
  assert.deepEqual(h.timers.map((t) => t.ms), [0]);
});

// The calendar feed owns the events list (window.DATA.events in the page): the only writer of it.
test('with a data object, the feed keeps its events: fetched, added, then removed', async () => {
  const data = { events: [] };
  let added2 = false;
  const h = harness({
    create: { data },
    respond: routes((url, init) => (init.method === 'POST' ? json(201, added) : { ok: true, status: 204, json: () => Promise.reject(new Error('no body')) })),
  });
  h.feed.start();
  await h.settle();
  assert.deepEqual(data.events.map((e) => e.id), ['a', 'b']);
  const fetched = data.events;
  await h.feed.add(input).then((e) => { added2 = data.events.indexOf(e) > -1; });
  assert.equal(added2, true, 'in the list by the time add resolves');
  assert.deepEqual(data.events.map((e) => e.id), ['a', 'b', 'new1']);
  assert.deepEqual(fetched.map((e) => e.id), ['a', 'b'], 'a new list, the old one left alone');
  await h.feed.remove('new1');
  assert.deepEqual(data.events.map((e) => e.id), ['a', 'b'], 'gone by the time remove resolves');
});

test('a plain feed hands newly parsed data to store, before onChange, and has no add or remove', async () => {
  const order = [];
  const h = harness();
  const feed = Feed.create({
    url: '/api/calendar', fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve(body()) }), storage: null,
    now: () => h.t, setTimeout: () => ({}), clearTimeout: () => {},
    store: (d) => order.push(['store', d.events.length]), onChange: (d) => order.push(['change', d.events.length]),
  });
  await feed.start();
  assert.deepEqual(order, [['store', 2], ['change', 2]]);
  assert.equal(feed.add, undefined);
  assert.equal(feed.remove, undefined);
});

test('a failed add or remove leaves the data’s events alone', async () => {
  const data = { events: [] };
  const h = harness({ create: { data }, respond: routes(() => json(502, { error: 'boom' })) });
  h.feed.start();
  await h.settle();
  const before = data.events;
  await h.feed.add(input).catch(() => {});
  await h.feed.remove('a').catch(() => {});
  assert.equal(data.events, before);
});

test('remove rejects with the server error', async () => {
  const h = harness({ respond: routes(() => json(502, { error: 'Google Calendar x: 500 boom' })) });
  h.feed.start();
  await h.settle();
  const err = await h.feed.remove('x').then(() => null, (e) => e);
  assert.match(err.message, /boom/);
});

// Calendar writes in flight (feed.busy): App.busy() holds a reload off until each one settles.
// Answers every write with a promise the test settles by hand, in any order.
function heldWrites() {
  const held = [];
  const respond = routes(() => new Promise((ok, no) => { held.push({ ok, no }); }));
  return { held, respond };
}

test('busy while an add is unanswered, not before or after', async () => {
  const w = heldWrites();
  const h = harness({ respond: w.respond });
  h.feed.start();
  await h.settle();
  assert.equal(h.feed.busy(), false);
  const p = h.feed.add(input);
  assert.equal(h.feed.busy(), true, 'from the moment it is sent');
  await h.settle();
  assert.equal(h.feed.busy(), true, 'still unanswered');
  w.held[0].ok(json(201, added));
  await p;
  assert.equal(h.feed.busy(), false);
});

test('busy while a remove is unanswered', async () => {
  const w = heldWrites();
  const h = harness({ respond: w.respond });
  h.feed.start();
  await h.settle();
  const p = h.feed.remove('x');
  assert.equal(h.feed.busy(), true);
  await h.settle();
  w.held[0].ok({ ok: true, status: 204, json: () => Promise.reject(new Error('no body')) });
  await p;
  assert.equal(h.feed.busy(), false);
});

test('several writes in flight: busy clears only when the last one settles', async () => {
  const w = heldWrites();
  const h = harness({ respond: w.respond });
  h.feed.start();
  await h.settle();
  const a = h.feed.add(input).catch(() => {});
  const r = h.feed.remove('x').catch(() => {});
  await h.settle();
  w.held[1].ok({ ok: true, status: 204, json: () => Promise.resolve(null) });
  await r;
  assert.equal(h.feed.busy(), true, 'the add is still out');
  w.held[0].ok(json(201, added));
  await a;
  assert.equal(h.feed.busy(), false);
});

test('a failed add or remove clears its share of busy', async () => {
  const w = heldWrites();
  const h = harness({ respond: w.respond });
  h.feed.start();
  await h.settle();
  const a = h.feed.add(input).then(() => null, (e) => e);
  const r = h.feed.remove('x').then(() => null, (e) => e);
  await h.settle();
  w.held[0].ok(json(502, { error: 'boom' }));
  assert.ok(await a);
  assert.equal(h.feed.busy(), true);
  w.held[1].no(new TypeError('Failed to fetch'));
  assert.ok(await r);
  assert.equal(h.feed.busy(), false);
});

test('an add answered with a bad body still clears busy', async () => {
  const h = harness({ respond: routes(() => json(201, null)) });
  h.feed.start();
  await h.settle();
  const err = await h.feed.add(input).then(() => null, (e) => e);
  assert.match(err.message, /Unexpected response/);
  assert.equal(h.feed.busy(), false);
});

test('an answer whose body never arrives times out and clears busy', async () => {
  const h = harness({ respond: routes(() => ({ ok: true, status: 201, json: () => new Promise(() => {}) })) });
  h.feed.start();
  await h.settle();
  let err;
  h.feed.add(input).catch((e) => { err = e; });
  await h.settle();
  assert.equal(h.feed.busy(), true);
  const timeout = h.timers.find((t) => t.ms === 30000);
  h.timers = h.timers.filter((t) => t !== timeout);
  timeout.fn();
  await h.settle();
  assert.match(err.message, /No answer from the home server/);
  assert.equal(h.feed.busy(), false);
});

test('any send counts as busy until it settles, not only calendar adds and removes', async () => {
  const w = heldWrites();
  const h = harness({ respond: w.respond });
  h.feed.start();
  await h.settle();
  const a = h.feed.send('PATCH', '/api/chores/7', { title: 'x' });
  const b = h.feed.send('DELETE', '/api/chores/8').catch(() => {});
  assert.equal(h.feed.busy(), true);
  await h.settle();
  w.held[0].ok(json(200, { id: 7 }));
  await a;
  assert.equal(h.feed.busy(), true, 'the delete is still out');
  w.held[1].no(new TypeError('Failed to fetch'));
  await b;
  assert.equal(h.feed.busy(), false);
});

test('a fetch that throws at once rejects as unreachable and clears busy', async () => {
  const h = harness();
  h.feed = Feed.create({
    url: '/api/calendar', storage: { getItem: () => null, setItem: () => {} }, now: () => h.t,
    setTimeout: (fn, ms) => { const t = { fn, ms }; h.timers.push(t); return t; }, clearTimeout: () => {},
    fetch: (url, init) => { if (init.method) throw new TypeError('bad'); return Promise.resolve(json(200, body())); },
    onChange: () => {},
  });
  h.feed.start();
  await h.settle();
  const err = await h.feed.send('PUT', '/api/chores/7/done').then(() => null, (e) => e);
  assert.match(err.message, /Can’t reach the home server/);
  assert.equal(h.feed.busy(), false);
});

// ------------------------------------------------------------ other writes (chores ticks)
test('send makes any write without a body, resolves with null on 204, then refreshes', async () => {
  const h = harness({ respond: routes(() => ({ ok: true, status: 204, json: () => Promise.reject(new Error('no body')) })) });
  h.feed.start();
  await h.settle();
  const out = await h.feed.send('PUT', '/api/chores/7/done');
  assert.equal(out, null);
  assert.equal(h.requests[1].url, '/api/chores/7/done');
  assert.equal(h.requests[1].init.method, 'PUT');
  assert.equal(h.requests[1].init.body, undefined);
  assert.deepEqual(h.timers.map((t) => t.ms), [0]);
});

test('send rejects with the server error for a refused write, without failing the feed', async () => {
  const h = harness({ respond: routes(() => json(409, { error: 'Chore is not scheduled today' })) });
  h.feed.start();
  await h.settle();
  const err = await h.feed.send('PUT', '/api/chores/7/done').then(() => null, (e) => e);
  assert.equal(err.message, 'Chore is not scheduled today');
  assert.equal(h.feed.state().failed, false);
});

test('a feed can say what to check when a write gets no answer', async () => {
  const h = harness({ respond: routes(() => new Promise(() => {})), create: { noAnswer: 'No answer · check the chores' } });
  h.feed.start();
  await h.settle();
  let err;
  h.feed.send('PUT', '/api/chores/7/done').catch((e) => { err = e; });
  await h.settle();
  const timeout = h.timers.find((t) => t.ms === 30000);
  h.timers = h.timers.filter((t) => t !== timeout);
  timeout.fn();
  await h.settle();
  assert.equal(err.message, 'No answer · check the chores');
});

test('failed is set by a failed calendar fetch even with data, and cleared by a good one', async () => {
  const h = harness();
  h.feed.start();
  await h.settle();
  assert.equal(h.feed.state().failed, false);
  h.respond = failing;
  await h.next();
  assert.equal(h.feed.state().failed, true);
  assert.equal(h.feed.state().stale, false);
  h.respond = () => json(200, body());
  await h.next();
  assert.equal(h.feed.state().failed, false);
});

test('setRefresh changes the interval; with now it fetches straight away', async () => {
  const h = harness();
  h.feed.start();
  await h.settle();
  h.feed.setRefresh(3000);
  assert.deepEqual(h.timers.map((t) => t.ms), [3000]);
  assert.equal(await h.next(), 3000);
  assert.deepEqual(h.timers.map((t) => t.ms), [3000], 'later refreshes keep the new interval');
  h.feed.setRefresh(MIN, true);
  assert.equal(await h.next(), 0);
  assert.equal(h.calls, 3);
  assert.deepEqual(h.timers.map((t) => t.ms), [MIN]);
});

test('setRefresh leaves a fetch in flight or a failure backoff alone', async () => {
  const h = harness({ respond: failing });
  h.feed.start();
  await h.settle();
  h.feed.setRefresh(3000, true);
  assert.deepEqual(h.timers.map((t) => t.ms), [5000], 'still backing off');
  h.respond = () => new Promise(() => {});
  await h.next();
  h.feed.setRefresh(3000, true);
  assert.deepEqual(h.timers.map((t) => t.ms), [30000], 'only the in-flight timeout');
});

// ------------------------------------------------------------ calendar notes
const st = (over) => Object.assign({ status: 'ok', failed: false, stale: false, age: 0, answered: true }, over);

test('mins: whole minutes, then hours and minutes', () => {
  assert.equal(Feed.mins(0), '0 min');
  assert.equal(Feed.mins(16), '16 min');
  assert.equal(Feed.mins(59.6), '1 hr');
  assert.equal(Feed.mins(135), '2 hr 15 min');
  assert.equal(Feed.mins(-3), '0 min');
});

test('calendarNote: loading, offline, stale with its age, fine (a failed fetch alone says nothing)', () => {
  assert.equal(Feed.calendarNote(st({ status: 'loading' }), null, 0), 'Loading the calendar…');
  assert.equal(Feed.calendarNote(st({ status: 'offline', answered: false }), null, 0), Feed.UNREACHABLE + ' · retrying');
  assert.equal(Feed.calendarNote(st({ stale: true, age: 16 }), null, 0), 'Updated 16 min ago');
  assert.equal(Feed.calendarNote(st({ failed: true, age: 2 }), null, 0), '');
  assert.equal(Feed.calendarNote(st(), null, 0), '');
});

test('addBlocked: loading, offline, failed, stale with its age, fine', () => {
  assert.equal(Feed.addBlocked(st({ status: 'loading' }), null, 0), 'Loading the calendar…');
  assert.equal(Feed.addBlocked(st({ status: 'offline' }), null, 0), Feed.UNREACHABLE);
  assert.equal(Feed.addBlocked(st({ failed: true, age: 2 }), null, 0), 'The last calendar request failed · retrying');
  assert.equal(Feed.addBlocked(st({ failed: true, stale: true, age: 20 }), null, 0), 'The last calendar request failed · retrying');
  assert.equal(Feed.addBlocked(st({ stale: true, age: 75 }), null, 0), 'Calendar not updated for 1 hr 15 min');
  assert.equal(Feed.addBlocked(st(), null, 0), '');
});

// ------------------------------------------------------------ get: a read beside the loop
// Another day's chores: fetched through the feed's timeout, but not a write, so never busy, no
// refresh after it and no effect on the feed's state when it fails.
test('get resolves with the JSON body, is never busy and does not refresh the feed', async () => {
  const held = [];
  const h = harness({ respond: (url) => (url === '/other' ? new Promise((ok) => { held.push(ok); }) : json(200, body())) });
  h.feed.start();
  await h.settle();
  const timers = h.timers.length, calls = h.calls;
  let got;
  h.feed.get('/other').then((b) => { got = b; });
  await h.settle();
  assert.equal(h.feed.busy(), false);
  held[0](json(200, { date: '2026-10-19' }));
  await h.settle();
  assert.deepEqual(got, { date: '2026-10-19' });
  assert.equal(h.calls, calls + 1, 'only the get itself');
  assert.equal(h.timers.length, timers, 'no refresh scheduled');
});

test('a failed get rejects with the reason and leaves the feed\'s state alone', async () => {
  let mode = 'error';
  const h = harness({ respond: (url) => (url !== '/other' ? json(200, body())
    : mode === 'error' ? json(400, { error: 'date must be a day as YYYY-MM-DD' }) : mode === '5xx' ? json(502, {}) : failing()) });
  h.feed.start();
  await h.settle();
  const before = h.feed.state(), states = h.states;
  await assert.rejects(h.feed.get('/other'), /date must be a day/);
  mode = '5xx';
  await assert.rejects(h.feed.get('/other'), /HTTP 502/);
  mode = 'down';
  await assert.rejects(h.feed.get('/other'), (e) => e.message === Feed.UNREACHABLE);
  assert.deepEqual(h.feed.state(), before);
  assert.equal(h.states, states, 'no onState');
});

test('a get that never answers times out', async () => {
  const h = harness({ respond: (url) => (url === '/other' ? new Promise(() => {}) : json(200, body())) });
  h.feed.start();
  await h.settle();
  let err;
  h.feed.get('/other').catch((e) => { err = e; });
  await h.settle();
  const timeout = h.timers.find((t) => t.ms === 30000);
  h.timers = h.timers.filter((t) => t !== timeout);
  timeout.fn();
  await h.settle();
  assert.equal(err.message, Feed.UNREACHABLE);
});
