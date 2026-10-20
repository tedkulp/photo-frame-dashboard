import { test } from 'node:test';
import assert from 'node:assert/strict';
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
  assert.deepEqual(House.stats(v), { lightsOn: 1, lightRooms: 1, locks: 1, unlocked: ['Front Door'], inside: 68 });
  assert.deepEqual(House.stats(House.parse(body({ rooms: [], climate: null }))), { lightsOn: 0, lightRooms: 0, locks: 0, unlocked: [], inside: null });
});

test('an offline lock does not count as unlocked', () => {
  const h = House.parse(body({ rooms: [{ name: 'Entry', tiles: [Object.assign({}, door, { available: false, locked: false, state: 'unavailable' })] }] }));
  assert.deepEqual(House.stats(h).unlocked, []);
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

// ------------------------------------------------------------ notes
const st = (over) => Object.assign({ status: 'ok', age: 0, stale: false, failed: false, answered: false }, over);

test('note: loading, unreachable server, not set up, HA disconnected, stale, fine', () => {
  const h = House.parse(body());
  assert.equal(House.note(st({ status: 'loading' }), null, T), 'Loading Home Assistant…');
  assert.equal(House.note(st({ status: 'offline' }), null, T), 'Can’t reach the home server · retrying');
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
