import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../js/feed.js';
import '../js/house.js';

const House = globalThis.House;
const MIN = 60000;
const T = Date.UTC(2026, 9, 20, 18, 0);

const lamp = { id: 'light.lamp', kind: 'light', name: 'Lamp', available: true, on: true, dimmable: true, level: 40 };
const fanBulbs = { id: 'light.fan', kind: 'light', name: 'Fan bulbs', available: true, on: false, dimmable: false, level: null };
const door = { id: 'lock.front', kind: 'lock', name: 'Front Door', available: true, locked: true, state: 'locked' };
const body = (over) => Object.assign({
  configured: true,
  connected: true,
  updated: '2026-10-20T17:59:00.000Z',
  rooms: [
    { name: 'Living Room', tiles: [fanBulbs, lamp] },
    { name: 'Entry', tiles: [door, { id: 'switch.porch', kind: 'switch', name: 'Porch', available: false, on: false }] },
  ],
  climate: { id: 'climate.living_room', name: 'Living Room', available: true, mode: 'heat', modes: ['heat', 'cool', 'heat_cool', 'off'], action: 'heating', current: 68, humidity: 41, target: 70, low: null, high: null },
  scenes: [{ id: 'scene.goodnight', name: 'Goodnight', icon: 'mdi:weather-night' }],
  cameras: [{ id: 'camera.porch', name: 'Porch', available: true }],
  media: [
    { id: 'media_player.kitchen', name: 'Kitchen', available: true, state: 'paused', title: 'A', artist: 'B', hasArt: true },
    { id: 'media_player.office', name: 'Office', available: true, state: 'playing', title: 'Harvest Moon', artist: 'Neil Young', hasArt: false },
  ],
}, over);

// ------------------------------------------------------------ parse
test('parses the server body, keeping its room and tile order', () => {
  const h = House.parse(body());
  assert.equal(h.configured, true);
  assert.equal(h.connected, true);
  assert.equal(h.updated.getTime(), Date.UTC(2026, 9, 20, 17, 59));
  assert.deepEqual(h.rooms.map((r) => r.name), ['Living Room', 'Entry']);
  assert.deepEqual(h.rooms[0].tiles.map((t) => t.id), ['light.fan', 'light.lamp']);
  assert.deepEqual(h.rooms[0].tiles[1], lamp);
  assert.equal(h.climate.target, 70);
  assert.equal(h.scenes[0].icon, 'mdi:weather-night');
  assert.equal(h.cameras.length, 1);
  assert.equal(h.media.length, 2);
});

test('{ configured: false } is a valid answer', () => {
  assert.deepEqual(House.parse({ configured: false }), { configured: false });
});

test('rejects a body that is not a home response', () => {
  assert.throws(() => House.parse(null));
  assert.throws(() => House.parse({ configured: true }));
  assert.throws(() => House.parse(body({ rooms: 'x' })));
  assert.throws(() => House.parse(body({ scenes: null })));
});

test('drops malformed tiles, unknown kinds and empty rooms instead of failing the whole response', () => {
  const h = House.parse(body({
    rooms: [
      { name: 'Living Room', tiles: [lamp, { id: 'cover.blind', kind: 'blind', name: 'Blind', available: true }, { kind: 'light' }] },
      { name: 'Attic', tiles: [{ id: 3 }] },
      { tiles: [lamp] },
    ],
    climate: { id: 'climate.x' },
  }));
  assert.deepEqual(h.rooms.map((r) => [r.name, r.tiles.map((t) => t.id)]), [['Living Room', ['light.lamp']]]);
  assert.equal(h.climate, null);
});

test('a missing or bad updated time is null', () => {
  assert.equal(House.parse(body({ updated: null })).updated, null);
  assert.equal(House.parse(body({ updated: 'nope' })).updated, null);
});

// ------------------------------------------------------------ what a tap expects
test('expect: each action has what to show now and what confirms it', () => {
  assert.deepEqual(House.expect('on'), { show: { on: true }, match: { on: true } });
  assert.deepEqual(House.expect('off'), { show: { on: false, level: null }, match: { on: false } });
  assert.deepEqual(House.expect('level', 55), { show: { on: true, level: 55 }, match: { on: true, level: 55 } });
  assert.deepEqual(House.expect('unlock'), { show: { locked: false, state: 'unlocked' }, match: { state: 'unlocked' } });
  assert.deepEqual(House.expect('lock'), { show: { locked: true, state: 'locked' }, match: { state: 'locked' } });
  assert.deepEqual(House.expect('mode', 'cool'), { show: { mode: 'cool' }, match: { mode: 'cool' } });
  assert.deepEqual(House.expect('target', 72), { show: { target: 72 }, match: { target: 72 } });
  assert.deepEqual(House.expect('range', { low: 66, high: 74 }), { show: { low: 66, high: 74 }, match: { low: 66, high: 74 } });
  assert.deepEqual(House.expect('pause'), { show: { state: 'paused' }, match: { state: 'paused' } });
  assert.equal(House.expect('run'), null);
});

// ------------------------------------------------------------ optimistic view + settle
const pend = (id, action, value, at, key) => {
  const e = House.expect(action, value);
  return { [key || id]: { id, name: id, show: e.show, match: e.match, at } };
};

test('view shows pending changes over the data, marked pending, without touching the data', () => {
  const h = House.parse(body());
  const v = House.view(h, Object.assign(pend('light.lamp', 'off', null, T), pend('climate.living_room', 'target', 72, null, 'climate.living_room:target')));
  const t = v.rooms[0].tiles[1];
  assert.equal(t.on, false);
  assert.equal(t.level, null);
  assert.equal(t.pending, true);
  assert.equal(v.rooms[0].tiles[0].pending, undefined);
  assert.equal(v.climate.target, 72);
  assert.equal(v.climate.pending, true);
  assert.equal(h.rooms[0].tiles[1].on, true, 'data untouched');
  assert.equal(h.climate.target, 70);
});

test('view of nothing or an unconfigured home is itself', () => {
  assert.equal(House.view(null, {}), null);
  assert.deepEqual(House.view({ configured: false }, pend('light.lamp', 'on', null, T)), { configured: false });
});

test('settle confirms a change once the data shows it', () => {
  const pending = pend('light.lamp', 'off', null, T);
  assert.deepEqual(House.settle(House.parse(body()), pending, T + 1000), { confirmed: [], expired: [] });
  assert.ok(pending['light.lamp']);
  const off = body({ rooms: [{ name: 'Living Room', tiles: [Object.assign({}, lamp, { on: false, level: null })] }] });
  assert.deepEqual(House.settle(House.parse(off), pending, T + 2000), { confirmed: ['light.lamp'], expired: [] });
  assert.deepEqual(pending, {});
});

test('a brightness within 1% confirms (HA rounds through 0–255)', () => {
  const pending = pend('light.lamp', 'level', 55, T);
  const d = House.parse(body({ rooms: [{ name: 'Living Room', tiles: [Object.assign({}, lamp, { level: 54 })] }] }));
  assert.deepEqual(House.settle(d, pending, T + 1000).confirmed, ['light.lamp']);
});

test('settle expires a change not seen within 5 s, and returns it for the toast', () => {
  const pending = pend('light.lamp', 'off', null, T);
  const d = House.parse(body());
  assert.deepEqual(House.settle(d, pending, T + 4999).expired, []);
  const r = House.settle(d, pending, T + 5000);
  assert.deepEqual(r.expired.map((e) => e.name), ['light.lamp']);
  assert.deepEqual(pending, {});
});

test('a change not sent yet (debouncing, at null) never expires', () => {
  const pending = pend('climate.living_room', 'target', 75, null, 'k');
  assert.deepEqual(House.settle(House.parse(body()), pending, T + 60 * MIN), { confirmed: [], expired: [] });
  assert.ok(pending.k);
});

test('settle with no data still expires by time', () => {
  const pending = pend('light.lamp', 'on', null, T);
  assert.equal(House.settle(null, pending, T + 6000).expired.length, 1);
});

// ------------------------------------------------------------ stats, now playing, scene icons
test('stats: lights on and in how many rooms, locks, unlocked names, inside temperature', () => {
  const v = House.view(House.parse(body()), pend('lock.front', 'unlock', null, T));
  assert.deepEqual(House.stats(v), { lightsOn: 1, lightRooms: 1, locks: 1, unlocked: ['Front Door'], locksOffline: 0, inside: 68 });
  assert.deepEqual(House.stats(House.parse(body({ rooms: [], climate: null }))), { lightsOn: 0, lightRooms: 0, locks: 0, unlocked: [], locksOffline: 0, inside: null });
});

test('an offline lock does not count as unlocked', () => {
  const h = House.parse(body({ rooms: [{ name: 'Entry', tiles: [Object.assign({}, door, { available: false, locked: false, state: 'unavailable' })] }] }));
  assert.deepEqual(House.stats(h).unlocked, []);
  assert.equal(House.stats(h).locksOffline, 1);
});

// ------------------------------------------------------------ night lock line
const lockTile = (name, over) => Object.assign({ id: 'lock.' + name.toLowerCase().replace(/ /g, '_'), kind: 'lock', name, available: true, locked: true, state: 'locked' }, over);
const withLocks = (...tiles) => House.parse(body({ rooms: [{ name: 'Living Room', tiles: [lamp] }, { name: 'Entry', tiles }] }));

test('nightLock: every lock locked reads "House locked", no alarm wording', () => {
  assert.deepEqual(House.nightLock(withLocks(lockTile('Front door'), lockTile('Back door')), ''), { warn: false, text: 'House locked' });
});

test('nightLock: one lock unlocked is a warning naming it', () => {
  const h = withLocks(lockTile('Front door', { locked: false, state: 'unlocked' }), lockTile('Back door'));
  assert.deepEqual(House.nightLock(h, ''), { warn: true, text: 'Front door unlocked' });
});

test('nightLock: several unlocked names the first, then +N', () => {
  const open = { locked: false, state: 'unlocked' };
  const h = withLocks(lockTile('Front door', open), lockTile('Back door', open), lockTile('Garage', open));
  assert.deepEqual(House.nightLock(h, ''), { warn: true, text: 'Front door unlocked +2' });
});

test('nightLock: an unavailable lock hides the line unless another is known unlocked', () => {
  const gone = { available: false, locked: false, state: 'unavailable' };
  assert.equal(House.nightLock(withLocks(lockTile('Front door'), lockTile('Back door', gone)), ''), null);
  const h = withLocks(lockTile('Front door', { locked: false, state: 'unlocked' }), lockTile('Back door', gone));
  assert.deepEqual(House.nightLock(h, ''), { warn: true, text: 'Front door unlocked' });
});

test('nightLock: a pending unlock from the frame shows as unlocked', () => {
  const v = House.view(House.parse(body()), pend('lock.front', 'unlock', null, T));
  assert.deepEqual(House.nightLock(v, ''), { warn: true, text: 'Front Door unlocked' });
});

test('nightLock: no locks hides the line', () => {
  assert.equal(House.nightLock(withLocks(), ''), null);
  assert.equal(House.nightLock(House.parse(body({ rooms: [] })), ''), null);
});

test('nightLock: any home note hides the line, even over data that says locked', () => {
  const h = withLocks(lockTile('Front door'));
  assert.equal(House.nightLock(h, 'Home Assistant unreachable · updated 3 min ago'), null);
  assert.equal(House.nightLock(h, 'Loading Home Assistant…'), null);
  assert.equal(House.nightLock(null, 'Can’t reach the home server · retrying'), null);
});

test('nightLock: Home Assistant not set up (or no data) hides the line', () => {
  assert.equal(House.nightLock(House.parse({ configured: false }), ''), null);
  assert.equal(House.nightLock(null, ''), null);
  assert.equal(House.nightLock(undefined, ''), null);
});

test('nowPlaying: the first playing player, else the one last shown if it is only paused', () => {
  const m = House.parse(body()).media;
  assert.equal(House.nowPlaying(m).id, 'media_player.office');
  const paused = m.map((p) => Object.assign({}, p, { state: 'paused' }));
  assert.equal(House.nowPlaying(paused, 'media_player.office').id, 'media_player.office');
  assert.equal(House.nowPlaying(paused), null);
  assert.equal(House.nowPlaying(paused.map((p) => Object.assign({}, p, { state: 'off' })), 'media_player.office'), null);
});

test('sceneIcon maps HA mdi icons to the nearest frame icon, with a fallback', () => {
  assert.equal(House.sceneIcon('mdi:weather-night'), 'moon');
  assert.equal(House.sceneIcon('mdi:bed'), 'moon');
  assert.equal(House.sceneIcon('mdi:movie-open'), 'film');
  assert.equal(House.sceneIcon('mdi:silverware-fork-knife'), 'utensils');
  assert.equal(House.sceneIcon('mdi:weather-sunset-up'), 'sunrise');
  assert.equal(House.sceneIcon('mdi:exit-run'), 'away');
  assert.equal(House.sceneIcon('mdi:lightbulb-group'), 'bulb');
  assert.equal(House.sceneIcon('mdi:something-new'), 'star');
  assert.equal(House.sceneIcon(null), 'star');
});

// ------------------------------------------------------------ cameras
const cam = (n, available) => ({ id: 'camera.c' + n, name: 'Cam ' + n, available: available !== false });

test('cameras: up to the first four in the server\'s order, offline ones included', () => {
  assert.equal(House.CAMERAS_MAX, 4);
  [0, 1, 2, 3, 4].forEach((n) => {
    const list = Array.from({ length: n }, (_, i) => cam(i + 1, i !== 1));
    assert.deepEqual(House.cameras(House.parse(body({ cameras: list }))), list);
  });
  const six = [1, 2, 3, 4, 5, 6].map((n) => cam(n));
  assert.deepEqual(House.cameras(House.parse(body({ cameras: six }))).map((c) => c.id), ['camera.c1', 'camera.c2', 'camera.c3', 'camera.c4']);
});

test('cameras of no data or an unconfigured home is none', () => {
  assert.deepEqual(House.cameras(null), []);
  assert.deepEqual(House.cameras({ configured: false }), []);
});

// ------------------------------------------------------------ notes
const st = (over) => Object.assign({ status: 'ok', age: 0, stale: false, failed: false, answered: false }, over);

test('note: loading, unreachable server, not set up, HA disconnected, stale, fine', () => {
  const h = House.parse(body());
  assert.equal(House.note(st({ status: 'loading' }), null, T), 'Loading Home Assistant…');
  assert.equal(House.note(st({ status: 'offline' }), null, T), globalThis.Feed.UNREACHABLE + ' · retrying');
  assert.equal(House.note(st(), { configured: false }, T), 'Home Assistant isn’t set up');
  assert.equal(House.note(st(), House.parse(body({ connected: false })), T + 3 * MIN), 'Home Assistant unreachable · updated 4 min ago');
  assert.equal(House.note(st({ failed: true, age: 0 }), h, T), 'Home Assistant unreachable · updated just now');
  assert.equal(House.note(st({ stale: true, age: 7 }), h, T), 'Home Assistant unreachable · updated 7 min ago');
  assert.equal(House.note(st(), House.parse(body({ connected: false, updated: null })), T), 'Home Assistant unreachable');
  assert.equal(House.note(st(), h, T), '');
});

test('an unlock is not confirmed while the lock is still unlocking', () => {
  const pending = pend('lock.front', 'unlock', null, T);
  const at = (state) => House.parse(body({ rooms: [{ name: 'Entry', tiles: [Object.assign({}, door, { locked: false, state })] }] }));
  assert.deepEqual(House.settle(at('unlocking'), pending, T + 1000).confirmed, []);
  assert.deepEqual(House.settle(at('unlocked'), pending, T + 2000).confirmed, ['lock.front']);
});

test('turnsOff: what a room\'s All off turns off (available lights, switches and fans that are on)', () => {
  const on = (kind, available) => ({ id: 'x.y', kind, name: 'Y', available: available !== false, on: true });
  assert.deepEqual(['light', 'switch', 'fan', 'toggle'].map((k) => House.turnsOff(on(k))), [true, true, true, false]);
  assert.equal(House.turnsOff(on('light', false)), false);
  assert.equal(House.turnsOff(Object.assign(on('light'), { on: false })), false);
  assert.equal(House.turnsOff(door), false);
});

// ------------------------------------------------------------ presence
test('presence parses from the body: home, away, and unknown for anyone else', () => {
  const h = House.parse(body({ presence: { alex: 'home', sam: 'away', kit: 'elsewhere', robin: 3 } }));
  assert.equal(House.presence(h, 'alex'), 'home');
  assert.equal(House.presence(h, 'sam'), 'away');
  assert.equal(House.presence(h, 'kit'), 'unknown');
  assert.equal(House.presence(h, 'robin'), 'unknown');
  assert.equal(House.presence(h, 'nobody'), 'unknown');
});

test('a missing or malformed presence, or no data, is unknown for everyone', () => {
  for (const presence of [undefined, null, 'home', ['alex']]) {
    const h = House.parse(body({ presence }));
    assert.equal(House.presence(h, 'alex'), 'unknown', JSON.stringify(presence));
  }
  assert.equal(House.presence(House.parse({ configured: false }), 'alex'), 'unknown');
  assert.equal(House.presence(null, 'alex'), 'unknown');
  assert.equal(House.presence(House.parse(body({ connected: false, presence: { alex: 'away' } })), 'alex'), 'unknown');
  assert.equal(House.presence(House.view(House.parse(body({ presence: { alex: 'away' } })), { k: { id: 'light.lamp', show: { on: false }, match: { on: false }, at: 1 } }), 'alex'), 'away');
});

// ------------------------------------------------------------ store (pending changes)
// A fake clock and timers, and a send whose answers the test gives one by one.
function rig() {
  let now = T, seq = 0;
  const timers = new Map(), sent = [];
  const store = House.store({
    send: (method, path, body) => new Promise((ok, no) => { sent.push({ method, path, body, ok, no }); }),
    now: () => now,
    setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { fn, at: now + ms }); return id; },
    clearTimeout: (id) => { timers.delete(id); },
  });
  return {
    store, sent, timers,
    // Moves the clock on, firing timers that come due.
    advance(ms) {
      now += ms;
      for (const [id, t] of [...timers]) if (t.at <= now) { timers.delete(id); t.fn(); }
    },
  };
}
const req = (id, b) => ({ method: 'POST', path: '/api/home/' + id, body: b });

test('entry: a pending change built from expect, not sent yet; null for an action with nothing to show', () => {
  assert.deepEqual(House.entry(lamp, 'off'), { id: 'light.lamp', name: 'Lamp', show: { on: false, level: null }, match: { on: false }, at: null });
  assert.equal(House.entry({ id: 'scene.goodnight', name: 'Goodnight' }, 'run'), null);
});

test('store: a tap shows at once, is sent once, and resolves true when the server takes it', async () => {
  const r = rig();
  const p = r.store.act([House.entry(lamp, 'off')], req('light.lamp', { action: 'off' }));
  assert.equal(r.sent.length, 1);
  assert.deepEqual([r.sent[0].method, r.sent[0].path, r.sent[0].body], ['POST', '/api/home/light.lamp', { action: 'off' }]);
  const v = r.store.view(House.parse(body()));
  assert.equal(v.rooms[0].tiles[1].on, false);
  assert.equal(v.rooms[0].tiles[1].pending, true);
  assert.equal(r.store.busy(), true);
  r.sent[0].ok({});
  assert.equal(await p, true);
  assert.equal(r.store.busy(), true, 'still pending until a poll confirms it');
});

test('store: a matching poll confirms an entry; an unconfirmed one expires after CONFIRM_MS', () => {
  const r = rig();
  r.store.act([House.entry(lamp, 'off')], req('light.lamp'));
  r.store.act([House.entry(door, 'unlock')], req('lock.front'));
  const off = House.parse(body({ rooms: [{ name: 'Living Room', tiles: [Object.assign({}, lamp, { on: false, level: null })] }, { name: 'Entry', tiles: [door] }] }));
  r.advance(1000);
  assert.deepEqual(r.store.settle(off), { confirmed: ['light.lamp'], expired: [] });
  r.advance(House.CONFIRM_MS - 1001);
  assert.deepEqual(r.store.settle(off), { confirmed: [], expired: [] });
  r.advance(1);
  const s = r.store.settle(off);
  assert.deepEqual(s.confirmed, []);
  assert.deepEqual(s.expired.map((e) => e.id), ['lock.front']);
  assert.equal(r.store.busy(), false);
  assert.equal(r.store.view(off), off, 'nothing pending: the data itself');
});

test('store: a failed send puts the entry back and rejects with the reason', async () => {
  const r = rig();
  const p = r.store.act([House.entry(lamp, 'off')], req('light.lamp'));
  r.sent[0].no(new Error('HTTP 502'));
  await assert.rejects(p, /HTTP 502/);
  assert.equal(r.store.busy(), false);
  assert.equal(r.store.view(House.parse(body())).rooms[0].tiles[1].pending, undefined);
});

test('store: a later tap owns the key, so an earlier send failing or answering late leaves it alone', async () => {
  const r = rig();
  const first = r.store.act([House.entry(lamp, 'off')], req('light.lamp'));
  const second = r.store.act([House.entry(lamp, 'on')], req('light.lamp'));
  r.sent[0].no(new Error('HTTP 502'));
  assert.equal(await first, false, 'failed, but the later tap owns the lamp: nothing to say');
  let v = r.store.view(House.parse(body({ rooms: [{ name: 'Living Room', tiles: [Object.assign({}, lamp, { on: false })] }] })));
  assert.equal(v.rooms[0].tiles[0].on, true, 'the newer tap still shows');
  assert.equal(v.rooms[0].tiles[0].pending, true);
  // A late success for an earlier send changes nothing either.
  const third = r.store.act([House.entry(lamp, 'off')], req('light.lamp'));
  r.sent[1].ok({});
  assert.equal(await second, true);
  v = r.store.view(House.parse(body()));
  assert.equal(v.rooms[0].tiles[1].on, false);
  assert.equal(v.rooms[0].tiles[1].pending, true);
  r.sent[2].ok({});
  assert.equal(await third, true);
});

test('store: debounce shows the entry with at null, restarts on each tap and sends once', async () => {
  const r = rig();
  const c = House.parse(body()).climate, key = c.id + ':target';
  const first = r.store.act([House.entry(c, 'target', 71)], req(c.id, { action: 'target', value: 71 }), { key, delay: 1000 });
  assert.equal(r.sent.length, 0);
  assert.equal(r.store.view(House.parse(body())).climate.target, 71);
  // Not sent yet: settling leaves it alone however long it waits.
  assert.deepEqual(r.store.settle(House.parse(body())), { confirmed: [], expired: [] });
  assert.equal(r.store.busy(), true);
  r.advance(900);
  const second = r.store.act([House.entry(c, 'target', 72)], req(c.id, { action: 'target', value: 72 }), { key, delay: 1000 });
  r.advance(900);
  assert.equal(r.sent.length, 0, 'the second tap restarted the timer');
  assert.equal(r.store.view(House.parse(body())).climate.target, 72);
  r.advance(100);
  assert.equal(r.sent.length, 1);
  assert.deepEqual(r.sent[0].body, { action: 'target', value: 72 });
  assert.equal(r.timers.size, 0);
  assert.equal(await first, undefined, 'the replaced tap was never sent');
  // at is set when it goes out: CONFIRM_MS from the send, not from the tap.
  r.advance(House.CONFIRM_MS - 1);
  assert.deepEqual(r.store.settle(House.parse(body())).expired, []);
  r.advance(1);
  assert.equal(r.store.settle(House.parse(body())).expired.length, 1);
  r.sent[0].ok({});
  assert.equal(await second, true);
  assert.equal(r.store.busy(), false);
});

test('store: a debounced act with nothing to show is busy while it waits to be sent', () => {
  const r = rig();
  r.store.act([], req('scene.x'), { key: 'scene.x', delay: 500 });
  assert.equal(r.store.busy(), true);
  r.advance(500);
  assert.equal(r.sent.length, 1);
  assert.equal(r.store.busy(), false);
});

test('store: one failed Room all-off send rolls back every entry it added', async () => {
  const r = rig();
  const tiles = House.parse(body({ rooms: [{ name: 'Living Room', tiles: [lamp, Object.assign({}, fanBulbs, { on: true })] }] })).rooms[0].tiles;
  const p = r.store.act(tiles.map((t) => House.entry(t, 'off')), { method: 'POST', path: '/api/home/rooms/Living%20Room/off' });
  assert.equal(r.sent.length, 1, 'one send for the room');
  assert.deepEqual(r.store.view(House.parse(body())).rooms[0].tiles.map((t) => [t.on, t.pending]), [[false, true], [false, true]]);
  r.sent[0].no(new Error('HTTP 502'));
  await assert.rejects(p, /HTTP 502/);
  assert.equal(r.store.busy(), false);
  assert.deepEqual(r.store.view(House.parse(body())).rooms[0].tiles.map((t) => t.pending), [undefined, undefined]);
});

test('store: a tap after a Room all-off owns its tile when the all-off fails', async () => {
  const r = rig();
  const tiles = House.parse(body({ rooms: [{ name: 'Living Room', tiles: [lamp, Object.assign({}, fanBulbs, { on: true })] }] })).rooms[0].tiles;
  const p = r.store.act(tiles.map((t) => House.entry(t, 'off')), { method: 'POST', path: '/api/home/rooms/Living%20Room/off' });
  r.store.act([House.entry(lamp, 'on')], req('light.lamp'));
  r.sent[0].no(new Error('HTTP 502'));
  await assert.rejects(p);
  const after = r.store.view(House.parse(body({ rooms: [{ name: 'Living Room', tiles: [Object.assign({}, lamp, { on: false }), fanBulbs] }] }))).rooms[0].tiles;
  assert.deepEqual([after[0].on, after[0].pending], [true, true], 'the lamp keeps the later tap');
  assert.equal(after[1].pending, undefined, 'the fan bulbs are put back');
});

test('store: a send failing after settle expired its entry resolves false (one toast, not two)', async () => {
  const r = rig();
  const p = r.store.act([House.entry(lamp, 'off')], req('light.lamp'));
  r.advance(House.CONFIRM_MS);
  assert.equal(r.store.settle(House.parse(body())).expired.length, 1, 'settle reports it (the "Couldn’t reach" toast)');
  r.sent[0].no(new Error('No answer'));
  assert.equal(await p, false);
  assert.equal(r.store.busy(), false);
});

test('store: a send failing after a poll confirmed its entry resolves false', async () => {
  const r = rig();
  const p = r.store.act([House.entry(lamp, 'off')], req('light.lamp'));
  const off = House.parse(body({ rooms: [{ name: 'Living Room', tiles: [Object.assign({}, lamp, { on: false })] }] }));
  assert.deepEqual(r.store.settle(off).confirmed, ['light.lamp']);
  r.sent[0].no(new Error('No answer'));
  assert.equal(await p, false);
});

test('store: an act with nothing to show always rejects a failure', async () => {
  const r = rig();
  const p = r.store.act([], req('scene.x'));
  r.sent[0].no(new Error('HTTP 502'));
  await assert.rejects(p, /HTTP 502/);
});

test('store: Room all-off replaces a waiting send on any of its tiles, not just the first', async () => {
  const r = rig();
  const tiles = House.parse(body({ rooms: [{ name: 'Living Room', tiles: [lamp, Object.assign({}, fanBulbs, { on: true })] }] })).rooms[0].tiles;
  const waiting = r.store.act([House.entry(tiles[1], 'level', 40)], req(tiles[1].id, { action: 'level', value: 40 }), { delay: 1000 });
  r.store.act(tiles.map((t) => House.entry(t, 'off')), { method: 'POST', path: '/api/home/rooms/Living%20Room/off' });
  assert.equal(await waiting, undefined, 'replaced before it was sent');
  r.advance(1000);
  assert.deepEqual(r.sent.map((s) => s.path), ['/api/home/rooms/Living%20Room/off'], 'only the room-off goes out');
  assert.equal(r.timers.size, 0);
});

test('store: a keyed act holds one entry at most', () => {
  const r = rig();
  const tiles = House.parse(body({ rooms: [{ name: 'Living Room', tiles: [lamp, Object.assign({}, fanBulbs, { on: true })] }] })).rooms[0].tiles;
  assert.throws(() => r.store.act(tiles.map((t) => House.entry(t, 'off')), req('x'), { key: 'room' }), /one entry at most/);
});
