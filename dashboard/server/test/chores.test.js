// /api/chores against a store on a temp data dir. The clock is a variable so a test can move
// from one day to the next; "today" is in the configured TZ (America/Toronto unless a test says).
// Most tests mount the chores routes alone, with "today" from a frame zone fixed by TZ: no Google.
// The last few go through startServer and a fake Google for the Family calendar's zone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { startServer } from '../app.js';
import { createHandler } from '../http.js';
import { createChores } from '../chores.js';
import { createFrameZone } from '../framezone.js';
import { choresRoutes } from '../routes/chores.js';
import { openStore } from '../store.js';
import { fakeGoogle, serviceAccount, settings, tempDir } from './helpers.js';

const FAMILY = 'family@group.calendar.google.com';
// Tue 2026-10-20, 12:00 in Toronto.
const TUE = Date.parse('2026-10-20T16:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
// A week row with nothing scheduled: every person in settings gets one.
const EMPTY = [null, null, null, null, null, null, null];

// The chores routes alone on a temp store, "today" in opts.timeZone (default America/Toronto).
async function withServer(fn, opts) {
  opts = opts || {};
  const t = tempDir();
  const clock = { now: opts.now || TUE };
  const now = () => clock.now;
  const frameZone = createFrameZone({ timeZone: opts.timeZone || 'America/Toronto', lookup: async () => { throw new Error('no lookup with TZ'); }, now });
  let store = openStore(t.path('data'));
  let srv;
  const start = async (s) => {
    const chores = createChores({ db: store.db, settings: s || settings(), now, today: frameZone.today });
    const server = createServer(createHandler({ routes: [choresRoutes(chores)], distDir: '/nonexistent' }));
    await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
    srv = {
      url: 'http://127.0.0.1:' + server.address().port,
      close: () => new Promise((ok) => { server.closeAllConnections(); server.close(ok); }),
    };
  };
  await start();
  const ctx = {
    clock,
    get url() { return srv.url; },
    call: (method, path, body) => call(srv.url, method, path, body),
    // Restarts the server with other settings on the same store.
    restart: async (s) => { await srv.close(); await start(s); },
    // Closes and reopens the database too, like a container restart.
    reopen: async () => { await srv.close(); store.close(); store = openStore(t.path('data')); await start(); },
  };
  try {
    await fn(ctx);
  } finally {
    await srv.close();
    store.close();
    t.cleanup();
  }
}

// End to end through startServer without TZ: the Family calendar (fake Google) gives the zone.
async function withFullServer(fn, { now, familyZone, family }) {
  const t = tempDir();
  const calendars = { [FAMILY]: Object.assign({ timeZone: familyZone, pages: [[]] }, family), 'alex@example.com': {}, 'sam@example.com': {} };
  const google = await fakeGoogle(calendars);
  const store = openStore(t.path('data'));
  const log = { error() {}, warn() {}, log() {} };
  const srv = await startServer({
    config: { settings: settings(), serviceAccount: serviceAccount(), port: 0, timeZone: null },
    store, distDir: '/nonexistent', tokenUrl: google.tokenUrl, apiBase: google.apiBase, now: () => now, log,
  });
  try {
    await fn({ calendars, call: (method, path, body) => call(srv.url, method, path, body) });
  } finally {
    await srv.close();
    store.close();
    await google.close();
    t.cleanup();
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

const trash = (over) => Object.assign({ title: 'Garbage to curb', emoji: '🗑️', owner: 'alex', routine: 'evening', days: [0, 3] }, over || {});
const daily = (over) => trash(Object.assign({ title: 'Make bed', emoji: '🛏️', routine: 'morning', days: [0, 1, 2, 3, 4, 5, 6] }, over || {}));

test('starts with no chores', async () => {
  await withServer(async ({ call }) => {
    const { status, body } = await call('GET', '/api/chores');
    assert.equal(status, 200);
    assert.equal(body.date, '2026-10-20');
    assert.deepEqual(body.chores, []);
    assert.deepEqual(body.done, []);
    assert.deepEqual(body.week, { alex: EMPTY, sam: EMPTY });
    assert.equal(body.updatedAt, new Date(TUE).toISOString());
  });
});

test('a created chore is returned and listed', async () => {
  await withServer(async ({ call }) => {
    const created = await call('POST', '/api/chores', trash({ title: '  Garbage to curb ' }));
    assert.equal(created.status, 201);
    assert.deepEqual(Object.assign({}, created.body, { id: undefined }), {
      id: undefined, title: 'Garbage to curb', emoji: '🗑️', owner: 'alex', routine: 'evening', days: [0, 3],
    });
    const { body } = await call('GET', '/api/chores');
    assert.deepEqual(body.chores, [created.body]);
  });
});

test('PATCH changes only the fields sent', async () => {
  await withServer(async ({ call }) => {
    const { body: c } = await call('POST', '/api/chores', trash());
    const edited = await call('PATCH', '/api/chores/' + c.id, { title: 'Bins out', owner: 'sam', days: [3, 0, 5] });
    assert.equal(edited.status, 200);
    assert.deepEqual(edited.body, { id: c.id, title: 'Bins out', emoji: '🗑️', owner: 'sam', routine: 'evening', days: [0, 3, 5] });
    const { body } = await call('GET', '/api/chores');
    assert.deepEqual(body.chores, [edited.body]);
  });
});

test('DELETE hides the chore; it then answers 404', async () => {
  await withServer(async ({ call }) => {
    const { body: a } = await call('POST', '/api/chores', trash());
    const { body: b } = await call('POST', '/api/chores', daily());
    assert.equal((await call('DELETE', '/api/chores/' + a.id)).status, 204);
    assert.deepEqual((await call('GET', '/api/chores')).body.chores.map((c) => c.id), [b.id]);
    for (const [method, path, body] of [
      ['DELETE', '/api/chores/' + a.id],
      ['PATCH', '/api/chores/' + a.id, { title: 'Back' }],
      ['PUT', '/api/chores/' + a.id + '/done'],
      ['DELETE', '/api/chores/999'],
      ['PATCH', '/api/chores/abc', { title: 'x' }],
    ]) {
      const res = await call(method, path, body);
      assert.equal(res.status, 404, method + ' ' + path);
      assert.equal(res.body.error, 'No such chore');
    }
  });
});

test('chores and ticks survive a restart', async () => {
  await withServer(async ({ call, reopen }) => {
    const { body: c } = await call('POST', '/api/chores', daily());
    await call('PUT', `/api/chores/${c.id}/done`);
    await reopen();
    const { body } = await call('GET', '/api/chores');
    assert.deepEqual(body.chores, [c]);
    assert.deepEqual(body.done, [c.id]);
  });
});

// ------------------------------------------------------------ done
test('ticking and unticking today are idempotent', async () => {
  await withServer(async ({ call }) => {
    const { body: c } = await call('POST', '/api/chores', daily());
    assert.equal((await call('PUT', `/api/chores/${c.id}/done`)).status, 204);
    assert.equal((await call('PUT', `/api/chores/${c.id}/done`)).status, 204);
    assert.deepEqual((await call('GET', '/api/chores')).body.done, [c.id]);
    assert.equal((await call('DELETE', `/api/chores/${c.id}/done`)).status, 204);
    assert.equal((await call('DELETE', `/api/chores/${c.id}/done`)).status, 204);
    assert.deepEqual((await call('GET', '/api/chores')).body.done, []);
  });
});

test('a chore not scheduled today cannot be ticked', async () => {
  await withServer(async ({ call }) => {
    // Tuesday; trash is Sunday and Wednesday.
    const { body: c } = await call('POST', '/api/chores', trash());
    const res = await call('PUT', `/api/chores/${c.id}/done`);
    assert.equal(res.status, 409);
    assert.match(res.body.error, /not scheduled today/);
    assert.deepEqual((await call('GET', '/api/chores')).body.done, []);
  });
});

test('each day starts with nothing done; yesterday stays done', async () => {
  await withServer(async ({ call, clock }) => {
    clock.now = TUE - DAY;
    const { body: c } = await call('POST', '/api/chores', daily());
    await call('PUT', `/api/chores/${c.id}/done`);
    clock.now = TUE;
    const { body } = await call('GET', '/api/chores');
    assert.deepEqual(body.done, []);
    assert.deepEqual(body.week.alex, ['hit', 'miss', 'due', 'due', 'due', 'due', 'due']);
    // Unticking today never touches yesterday.
    await call('DELETE', `/api/chores/${c.id}/done`);
    assert.deepEqual((await call('GET', '/api/chores')).body.week.alex[0], 'hit');
  });
});

// ------------------------------------------------------------ dated history (ADR 0002)
test("changing owner or days today leaves yesterday's hit/miss as it was", async () => {
  await withServer(async ({ call, clock }) => {
    clock.now = TUE - DAY;
    const { body: c } = await call('POST', '/api/chores', daily());
    await call('PUT', `/api/chores/${c.id}/done`);
    clock.now = TUE;
    await call('PATCH', '/api/chores/' + c.id, { owner: 'sam' });
    let week = (await call('GET', '/api/chores')).body.week;
    assert.deepEqual(week, {
      alex: ['hit', null, null, null, null, null, null],
      sam: [null, 'miss', 'due', 'due', 'due', 'due', 'due'],
    });
    // Wednesday only: Sam has nothing today; tomorrow is due.
    await call('PATCH', '/api/chores/' + c.id, { days: [3] });
    week = (await call('GET', '/api/chores')).body.week;
    assert.deepEqual(week, {
      alex: ['hit', null, null, null, null, null, null],
      sam: [null, null, 'due', null, null, null, null],
    });
  });
});

test('deleting today leaves earlier days as they were', async () => {
  await withServer(async ({ call, clock }) => {
    clock.now = TUE - DAY;
    const { body: c } = await call('POST', '/api/chores', daily());
    clock.now = TUE;
    await call('DELETE', '/api/chores/' + c.id);
    assert.deepEqual((await call('GET', '/api/chores')).body.week, { alex: ['miss', null, null, null, null, null, null], sam: EMPTY });
  });
});

test('a chore created today is absent from earlier days', async () => {
  await withServer(async ({ call }) => {
    await call('POST', '/api/chores', daily());
    assert.deepEqual((await call('GET', '/api/chores')).body.week, { alex: [null, 'miss', 'due', 'due', 'due', 'due', 'due'], sam: EMPTY });
  });
});

test('two changes on the same day make one change, effective today', async () => {
  await withServer(async ({ call, clock }) => {
    clock.now = TUE - DAY;
    const { body: c } = await call('POST', '/api/chores', daily());
    await call('PUT', `/api/chores/${c.id}/done`);
    clock.now = TUE;
    await call('PATCH', '/api/chores/' + c.id, { owner: 'sam' });
    const second = await call('PATCH', '/api/chores/' + c.id, { days: [2, 4] });
    // The second change keeps the first one's owner rather than starting from yesterday's.
    assert.equal(second.body.owner, 'sam');
    assert.deepEqual(second.body.days, [2, 4]);
    // Changing back today undoes today's change entirely.
    await call('PATCH', '/api/chores/' + c.id, { owner: 'alex', days: [0, 1, 2, 3, 4, 5, 6] });
    assert.deepEqual((await call('GET', '/api/chores')).body.week, { alex: ['hit', 'miss', 'due', 'due', 'due', 'due', 'due'], sam: EMPTY });
  });
});

// ------------------------------------------------------------ hit days
test('Anyone chores count toward nobody', async () => {
  await withServer(async ({ call }) => {
    const { body: mine } = await call('POST', '/api/chores', daily());
    await call('POST', '/api/chores', daily({ title: 'Feed cat', owner: 'any' }));
    await call('PUT', `/api/chores/${mine.id}/done`);
    const { body } = await call('GET', '/api/chores');
    assert.deepEqual(body.week, { alex: [null, 'hit', 'due', 'due', 'due', 'due', 'due'], sam: EMPTY });
    assert.equal(body.chores.length, 2);
  });
});

test('days still to come with a chore are due; days with nothing stay null', async () => {
  await withServer(async ({ call }) => {
    await call('POST', '/api/chores', trash({ days: [5] })); // Friday
    assert.deepEqual((await call('GET', '/api/chores')).body.week, { alex: [null, null, null, null, 'due', null, null], sam: EMPTY });
  });
});

test('a hit day needs every scheduled chore across both routines', async () => {
  await withServer(async ({ call }) => {
    const { body: a } = await call('POST', '/api/chores', daily());
    const { body: b } = await call('POST', '/api/chores', daily({ title: 'Dishes', routine: 'evening' }));
    await call('PUT', `/api/chores/${a.id}/done`);
    assert.equal((await call('GET', '/api/chores')).body.week.alex[1], 'miss');
    await call('PUT', `/api/chores/${b.id}/done`);
    assert.equal((await call('GET', '/api/chores')).body.week.alex[1], 'hit');
  });
});

test('people removed from settings have their chores hidden, not deleted', async () => {
  await withServer(async ({ call, restart }) => {
    const { body: s } = await call('POST', '/api/chores', daily({ owner: 'sam' }));
    const { body: a } = await call('POST', '/api/chores', daily());
    const onlyAlex = settings();
    onlyAlex.people = onlyAlex.people.filter((p) => p.id !== 'sam');
    onlyAlex.calendars = onlyAlex.calendars.filter((c) => c.person !== 'sam');
    await restart(onlyAlex);
    let body = (await call('GET', '/api/chores')).body;
    assert.deepEqual(body.chores.map((c) => c.id), [a.id]);
    assert.deepEqual(Object.keys(body.week), ['alex']);
    assert.equal((await call('PATCH', '/api/chores/' + s.id, { title: 'x' })).status, 404);
    assert.equal((await call('POST', '/api/chores', daily({ owner: 'sam' }))).status, 400);
    await restart();
    body = (await call('GET', '/api/chores')).body;
    assert.deepEqual(body.chores.map((c) => c.id), [s.id, a.id]);
  });
});

// ------------------------------------------------------------ validation
for (const [name, over, message] of [
  ['blank title', { title: '   ' }, /title is missing/],
  ['long title', { title: 'x'.repeat(61) }, /title is longer than 60/],
  ['missing emoji', { emoji: '' }, /emoji is missing/],
  ['long emoji', { emoji: '😀'.repeat(9) }, /emoji is longer than 16/],
  ['unknown owner', { owner: 'kit' }, /owner must be a person id or "any"/],
  ['bad routine', { routine: 'afterschool' }, /routine must be "morning" or "evening"/],
  ['no days', { days: [] }, /days must be a non-empty list/],
  ['repeated day', { days: [1, 1] }, /days must be/],
  ['day out of range', { days: [7] }, /days must be/],
  ['day not an integer', { days: ['1'] }, /days must be/],
]) {
  test('400 for ' + name, async () => {
    await withServer(async ({ call }) => {
      const res = await call('POST', '/api/chores', trash(over));
      assert.equal(res.status, 400);
      assert.match(res.body.error, message);
      const { body: c } = await call('POST', '/api/chores', trash());
      const edit = await call('PATCH', '/api/chores/' + c.id, over);
      assert.equal(edit.status, 400);
      assert.match(edit.body.error, message);
      assert.deepEqual((await call('GET', '/api/chores')).body.chores, [c]);
    });
  });
}

test('a 60-character title and a 16-unit emoji are allowed', async () => {
  await withServer(async ({ call }) => {
    const res = await call('POST', '/api/chores', trash({ title: 'x'.repeat(60), emoji: '😀'.repeat(8) }));
    assert.equal(res.status, 201);
  });
});

test('400 for a missing field on create, and for a body that is not an object', async () => {
  await withServer(async ({ call }) => {
    const noDays = trash();
    delete noDays.days;
    assert.equal((await call('POST', '/api/chores', noDays)).status, 400);
    assert.equal((await call('POST', '/api/chores', [1])).status, 400);
    assert.deepEqual((await call('GET', '/api/chores')).body.chores, []);
  });
});

test('405 for other methods', async () => {
  await withServer(async ({ call }) => {
    assert.equal((await call('PUT', '/api/chores')).status, 405);
    assert.equal((await call('GET', '/api/chores/1')).status, 405);
    assert.equal((await call('POST', '/api/chores/1/done')).status, 405);
  });
});

// ------------------------------------------------------------ today
test('"today" follows TZ across midnight', async () => {
  // 23:30 on Monday in Toronto, 03:30 on Tuesday in UTC.
  const t = Date.parse('2026-10-20T03:30:00Z');
  await withServer(async ({ call, clock }) => {
    assert.equal((await call('GET', '/api/chores')).body.date, '2026-10-19');
    const { body: c } = await call('POST', '/api/chores', daily());
    await call('PUT', `/api/chores/${c.id}/done`);
    clock.now = t + 60 * 60 * 1000;
    const { body } = await call('GET', '/api/chores');
    assert.equal(body.date, '2026-10-20');
    assert.deepEqual(body.done, []);
    assert.deepEqual(body.week.alex, ['hit', 'miss', 'due', 'due', 'due', 'due', 'due']);
  }, { now: t, timeZone: 'America/Toronto' });
  await withServer(async ({ call }) => {
    assert.equal((await call('GET', '/api/chores')).body.date, '2026-10-20');
  }, { now: t, timeZone: 'UTC' });
});

test('without TZ, "today" is in the Family calendar\'s time zone', async () => {
  const t = Date.parse('2026-10-20T03:30:00Z');
  await withFullServer(async ({ call }) => {
    assert.equal((await call('GET', '/api/chores')).body.date, '2026-10-19');
  }, { now: t, familyZone: 'America/Vancouver' });
  await withFullServer(async ({ call }) => {
    assert.equal((await call('GET', '/api/chores')).body.date, '2026-10-20');
  }, { now: t, familyZone: 'Asia/Tokyo' });
});

test('without TZ, chores still load while Google is down, and pick up the Family zone later', async () => {
  const t = Date.parse('2026-10-20T03:30:00Z');
  const d = new Date(t);
  const local = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  await withFullServer(async ({ call, calendars }) => {
    const down = await call('GET', '/api/chores');
    assert.equal(down.status, 200);
    assert.equal(down.body.date, local);
    delete calendars[FAMILY].status;
    assert.equal((await call('GET', '/api/chores')).body.date, '2026-10-20');
  }, { now: t, familyZone: 'Asia/Tokyo', family: { status: 500 } });
});

test('without TZ, a calendar load teaches chores the Family zone', async () => {
  const t = Date.parse('2026-10-20T03:30:00Z');
  await withFullServer(async ({ call, calendars }) => {
    assert.equal((await call('GET', '/api/chores')).body.date, '2026-10-20');
    calendars[FAMILY].timeZone = 'America/Vancouver';
    assert.equal((await call('GET', '/api/calendar')).status, 200);
    assert.equal((await call('GET', '/api/chores')).body.date, '2026-10-19');
  }, { now: t, familyZone: 'Asia/Tokyo' });
});
