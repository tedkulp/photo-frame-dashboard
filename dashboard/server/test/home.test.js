import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../app.js';
import { fakeHomeAssistant, serviceAccount, settings } from './helpers.js';

const NOW = Date.parse('2026-10-19T12:00:00Z');

// A small house: labelled entities in several rooms, plus ones that must not show.
function house(over) {
  const reg = (entity_id, more) => Object.assign({ entity_id, labels: ['frame'], area_id: null, device_id: null, disabled_by: null }, more);
  const st = (state, attributes) => ({ state, attributes });
  return Object.assign({
    unit: '°F',
    labels: [{ label_id: 'frame', name: 'Frame' }, { label_id: 'kitchen_stuff', name: 'Kitchen stuff' }],
    areas: [
      { area_id: 'living_room', name: 'Living Room' },
      { area_id: 'office', name: 'Office' },
      { area_id: 'robins_room', name: 'Robin’s Room' },
      { area_id: 'kitchen', name: 'Kitchen' },
      { area_id: 'bedroom', name: 'Bedroom' },
    ],
    devices: [{ id: 'dev_lamp', area_id: 'office' }, { id: 'dev_fan', area_id: 'bedroom' }],
    entities: [
      reg('light.couch', { area_id: 'living_room' }),
      reg('light.desk', { device_id: 'dev_lamp' }),
      reg('light.fan_bulbs', { area_id: 'robins_room' }),
      reg('switch.kettle', { area_id: 'kitchen' }),
      reg('fan.ceiling', { device_id: 'dev_fan' }),
      reg('input_boolean.guest_mode', { area_id: 'living_room' }),
      reg('lock.front'),
      reg('climate.living_room', { area_id: 'living_room' }),
      reg('scene.goodnight'),
      reg('script.away'),
      reg('camera.porch'),
      reg('media_player.kitchen', { area_id: 'kitchen' }),
      reg('light.old_lamp', { area_id: 'office', disabled_by: 'user' }),
      reg('light.hallway', { area_id: 'office', labels: ['kitchen_stuff'] }),
      reg('sensor.outside', { area_id: 'office' }),
    ],
    states: {
      'light.couch': st('on', { friendly_name: 'Couch lamp', brightness: 128, supported_color_modes: ['brightness'] }),
      'light.desk': st('off', { friendly_name: 'Desk lamp', brightness: null, supported_color_modes: ['color_temp', 'hs'] }),
      'light.fan_bulbs': st('on', { friendly_name: 'Fan bulbs', brightness: 0, supported_color_modes: ['brightness'] }),
      'switch.kettle': st('on', { friendly_name: 'Kettle' }),
      'fan.ceiling': st('unavailable', { friendly_name: 'Ceiling fan' }),
      'input_boolean.guest_mode': st('off', { friendly_name: 'Guest mode' }),
      'lock.front': st('locked', { friendly_name: 'Front door' }),
      'climate.living_room': st('heat', {
        friendly_name: 'Thermostat', hvac_modes: ['off', 'heat', 'cool', 'heat_cool', 'fan_only'], hvac_action: 'heating',
        current_temperature: 70.4, current_humidity: 41.2, temperature: 68, target_temp_low: null, target_temp_high: null, min_temp: 45, max_temp: 95,
      }),
      'scene.goodnight': st('2026-10-18T23:00:00+00:00', { friendly_name: 'Goodnight', icon: 'mdi:weather-night' }),
      'script.away': st('off', { friendly_name: 'Away' }),
      'camera.porch': st('idle', { friendly_name: 'Porch' }),
      'media_player.kitchen': st('playing', { friendly_name: 'Kitchen speaker', media_title: 'Song', media_artist: 'Band', entity_picture: '/api/media_player_proxy/media_player.kitchen?token=abc&cache=1' }),
      'light.old_lamp': st('on', { friendly_name: 'Old lamp' }),
      'light.hallway': st('on', { friendly_name: 'Hallway' }),
      'sensor.outside': st('12', { friendly_name: 'Outside' }),
    },
  }, over || {});
}

function quietLog() {
  const lines = [];
  const add = (...a) => lines.push(a.join(' '));
  return { lines, log: add, warn: add, error: add };
}

async function waitFor(fn, what) {
  const until = Date.now() + 3000;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) throw new Error('Timed out waiting for ' + what);
    await new Promise((r) => setTimeout(r, 10));
  }
}

const getHome = async (url) => (await fetch(url + '/api/home')).json();
const post = (url, path, body) => fetch(url + path, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
});

async function withHome(home, fn, { rooms = ["Robin's Room", 'living room'], label, settings: people = settings() } = {}) {
  const ha = await fakeHomeAssistant({}, { home });
  const out = quietLog();
  const homeAssistant = { url: ha.url, weatherEntity: 'weather.home', token: ha.token, label: label || 'frame', rooms };
  const srv = await startServer({
    config: { settings: people, serviceAccount: serviceAccount(), homeAssistant, port: 0, timeZone: null },
    distDir: '/nonexistent',
    now: () => NOW,
    homeRetryMs: 20,
    log: out,
  });
  try {
    await waitFor(async () => (await getHome(srv.url)).connected, 'the first connection');
    await fn({ url: srv.url, ha, log: out.lines });
  } finally {
    await srv.close();
    await ha.close();
  }
}

test('labelled entities are served by room in the dashboard shape', async () => {
  await withHome(house(), async ({ url }) => {
    const body = await getHome(url);
    assert.equal(body.configured, true);
    assert.equal(body.connected, true);
    assert.equal(body.updated, new Date(NOW).toISOString());
    assert.deepEqual(body.rooms, [
      { name: 'Robin’s Room', tiles: [{ id: 'light.fan_bulbs', kind: 'light', name: 'Fan bulbs', available: true, on: true, dimmable: true, level: null }] },
      { name: 'Living Room', tiles: [
        { id: 'light.couch', kind: 'light', name: 'Couch lamp', available: true, on: true, dimmable: true, level: 50 },
        { id: 'input_boolean.guest_mode', kind: 'toggle', name: 'Guest mode', available: true, on: false },
      ] },
      { name: 'Bedroom', tiles: [{ id: 'fan.ceiling', kind: 'fan', name: 'Ceiling fan', available: false, on: false }] },
      { name: 'Kitchen', tiles: [{ id: 'switch.kettle', kind: 'switch', name: 'Kettle', available: true, on: true }] },
      { name: 'Office', tiles: [{ id: 'light.desk', kind: 'light', name: 'Desk lamp', available: true, on: false, dimmable: true, level: null }] },
      { name: 'Other', tiles: [{ id: 'lock.front', kind: 'lock', name: 'Front door', available: true, locked: true, state: 'locked' }] },
    ]);
    assert.deepEqual(body.climate, {
      id: 'climate.living_room', name: 'Thermostat', available: true, mode: 'heat', modes: ['heat', 'cool', 'heat_cool', 'off'],
      action: 'heating', current: 70, humidity: 41, target: 68, low: null, high: null,
    });
    assert.deepEqual(body.scenes, [{ id: 'script.away', name: 'Away', icon: null }, { id: 'scene.goodnight', name: 'Goodnight', icon: 'mdi:weather-night' }]);
    assert.deepEqual(body.cameras, [{ id: 'camera.porch', name: 'Porch', available: true }]);
    assert.deepEqual(body.media, [{ id: 'media_player.kitchen', name: 'Kitchen speaker', available: true, state: 'playing', title: 'Song', artist: 'Band', hasArt: true }]);
    assert.doesNotMatch(JSON.stringify(body), /token=abc|old_lamp|hallway|sensor/);
  });
});

test('warns about listed rooms that are not areas, and a missing label', async () => {
  await withHome(house(), async ({ log }) => {
    assert.ok(log.some((l) => /rooms lists "Nowhere", which is not a Home Assistant area/.test(l)), log.join('\n'));
    assert.ok(!log.some((l) => /Robin/.test(l)));
  }, { rooms: ['Robin\'s Room', 'Nowhere'] });
  await withHome(house(), async ({ url, log }) => {
    assert.ok(log.some((l) => /no label "wall"/.test(l)));
    assert.deepEqual((await getHome(url)).rooms, []);
  }, { label: 'wall' });
});

test('the label can be given by name; brightness is a percentage', async () => {
  const h = house();
  h.states['light.couch'].attributes.brightness = 255;
  h.states['light.fan_bulbs'].attributes.brightness = 1;
  await withHome(h, async ({ url }) => {
    const tiles = (await getHome(url)).rooms.flatMap((r) => r.tiles);
    assert.equal(tiles.find((t) => t.id === 'light.couch').level, 100);
    assert.equal(tiles.find((t) => t.id === 'light.fan_bulbs').level, 1);
  }, { label: 'frame' });
  await withHome(house(), async ({ url }) => {
    assert.deepEqual((await getHome(url)).rooms.map((r) => r.name), ['Office']);
    assert.equal((await getHome(url)).climate, null);
  }, { label: 'KITCHEN STUFF' });
});

test('on/off-only lights are not dimmable', async () => {
  const h = house();
  h.states['light.couch'].attributes.supported_color_modes = ['onoff'];
  await withHome(h, async ({ url }) => {
    const couch = (await getHome(url)).rooms[1].tiles[0];
    assert.deepEqual([couch.dimmable, couch.level], [false, null]);
  });
});

test('auto climate shows a range, converted from °C', async () => {
  const h = house({ unit: '°C' });
  Object.assign(h.states['climate.living_room'], { state: 'heat_cool' });
  Object.assign(h.states['climate.living_room'].attributes, { current_temperature: 21, temperature: null, target_temp_low: 20, target_temp_high: 24.5, min_temp: 7, max_temp: 35 });
  await withHome(h, async ({ url, ha }) => {
    const { climate } = await getHome(url);
    assert.deepEqual([climate.mode, climate.current, climate.target, climate.low, climate.high], ['heat_cool', 70, null, 68, 76]);
    assert.equal((await post(url, '/api/home/climate.living_room', { action: 'range', value: { low: 66, high: 77 } })).status, 204);
    assert.deepEqual(ha.calls.at(-1), { domain: 'climate', service: 'set_temperature', service_data: { target_temp_low: 19, target_temp_high: 25 }, target: { entity_id: 'climate.living_room' } });
    assert.equal((await post(url, '/api/home/climate.living_room', { action: 'target', value: 100 })).status, 400);
    assert.equal((await post(url, '/api/home/climate.living_room', { action: 'range', value: { low: 70, high: 68 } })).status, 400);
  });
});

test('allowed actions become service calls once Home Assistant acknowledges them', async () => {
  await withHome(house(), async ({ url, ha }) => {
    const cases = [
      ['light.couch', { action: 'level', value: 40 }, 'light', 'turn_on', { brightness_pct: 40 }],
      ['light.desk', { action: 'on' }, 'light', 'turn_on', {}],
      ['switch.kettle', { action: 'off' }, 'switch', 'turn_off', {}],
      ['input_boolean.guest_mode', { action: 'on' }, 'input_boolean', 'turn_on', {}],
      ['lock.front', { action: 'unlock' }, 'lock', 'unlock', {}],
      ['climate.living_room', { action: 'mode', value: 'cool' }, 'climate', 'set_hvac_mode', { hvac_mode: 'cool' }],
      ['climate.living_room', { action: 'target', value: 70 }, 'climate', 'set_temperature', { temperature: 70 }],
      ['scene.goodnight', { action: 'run' }, 'scene', 'turn_on', {}],
      ['script.away', { action: 'run' }, 'script', 'turn_on', {}],
      ['media_player.kitchen', { action: 'pause' }, 'media_player', 'media_pause', {}],
    ];
    for (const [id, body, domain, service, data] of cases) {
      const res = await post(url, '/api/home/' + id, body);
      assert.equal(res.status, 204, id + ' ' + JSON.stringify(body));
      assert.deepEqual(ha.calls.at(-1), { domain, service, service_data: data, target: { entity_id: id } });
    }
  });
});

test('the allowlist: unlabelled or unknown entities are 404, other actions 400', async () => {
  await withHome(house(), async ({ url, ha }) => {
    for (const id of ['light.hallway', 'light.old_lamp', 'sensor.outside', 'light.nope']) {
      assert.equal((await post(url, '/api/home/' + id, { action: 'on' })).status, 404, id);
    }
    const bad = [
      ['light.couch', { action: 'toggle' }],
      ['light.couch', { action: 'level', value: 101 }],
      ['light.couch', { action: 'level', value: '50' }],
      ['lock.front', { action: 'on' }],
      ['fan.ceiling', { action: 'level', value: 50 }],
      ['climate.living_room', { action: 'mode', value: 'fan_only' }],
      ['camera.porch', { action: 'on' }],
      ['scene.goodnight', { action: 'off' }],
      ['media_player.kitchen', { action: 'volume', value: 5 }],
      ['light.couch', ['on']],
    ];
    for (const [id, body] of bad) assert.equal((await post(url, '/api/home/' + id, body)).status, 400, id + ' ' + JSON.stringify(body));
    assert.equal((await fetch(url + '/api/home/light.couch', { method: 'POST', body: '{"action":"on"}' })).status, 415);
    assert.equal((await fetch(url + '/api/home/light.couch')).status, 405);
    assert.equal(ha.calls.length, 0);
  });
});

test("Home Assistant's error is passed on as a 502", async () => {
  const h = house({ failService: (m) => (m.domain === 'lock' ? 'Lock is jammed' : null) });
  await withHome(h, async ({ url }) => {
    const res = await post(url, '/api/home/lock.front', { action: 'lock' });
    assert.equal(res.status, 502);
    assert.match((await res.json()).error, /Lock is jammed/);
  });
});

test('All off turns off a room\'s available lights, switches and fans', async () => {
  const h = house();
  h.entities.push({ entity_id: 'switch.desk_fan', labels: ['frame'], area_id: 'office' }, { entity_id: 'fan.office', labels: ['frame'], area_id: 'office' });
  h.states['switch.desk_fan'] = { state: 'on', attributes: { friendly_name: 'Desk fan' } };
  h.states['fan.office'] = { state: 'unavailable', attributes: {} };
  await withHome(h, async ({ url, ha }) => {
    assert.equal((await post(url, '/api/home/rooms/office/off')).status, 204);
    assert.deepEqual(ha.calls.map((c) => [c.domain, c.service, c.target.entity_id]), [['light', 'turn_off', ['light.desk']], ['switch', 'turn_off', ['switch.desk_fan']]]);
    ha.calls.length = 0;
    assert.equal((await post(url, '/api/home/rooms/' + encodeURIComponent("robin's room") + '/off')).status, 204);
    assert.deepEqual(ha.calls.map((c) => c.target.entity_id), [['light.fan_bulbs']]);
    ha.calls.length = 0;
    // Living Room's toggle is not turned off; Other has only a lock.
    assert.equal((await post(url, '/api/home/rooms/Living%20Room/off')).status, 204);
    assert.deepEqual(ha.calls.map((c) => c.target.entity_id), [['light.couch']]);
    assert.equal((await post(url, '/api/home/rooms/Other/off')).status, 404);
    assert.equal((await post(url, '/api/home/rooms/Garage/off')).status, 404);
  });
});

test('a pushed state_changed shows up in the next GET', async () => {
  await withHome(house(), async ({ url, ha }) => {
    ha.push('light.couch', { state: 'off', attributes: { friendly_name: 'Couch lamp', brightness: null, supported_color_modes: ['brightness'] } });
    ha.push('fan.ceiling', { state: 'on', attributes: { friendly_name: 'Ceiling fan' } });
    const tiles = await waitFor(async () => {
      const t = (await getHome(url)).rooms.flatMap((r) => r.tiles);
      return t.find((x) => x.id === 'light.couch').on === false && t;
    }, 'the pushed state');
    assert.deepEqual(tiles.find((t) => t.id === 'fan.ceiling'), { id: 'fan.ceiling', kind: 'fan', name: 'Ceiling fan', available: true, on: true });
  });
});

test('a registry update re-reads the label and areas', async () => {
  await withHome(house(), async ({ url, ha }) => {
    const hallway = ha.home.entities.find((e) => e.entity_id === 'light.hallway');
    hallway.labels = ['frame'];
    ha.home.areas.find((a) => a.area_id === 'office').name = 'Florida Room';
    ha.fire('entity_registry_updated');
    const office = await waitFor(async () => (await getHome(url)).rooms.find((r) => r.name === 'Florida Room'), 'the renamed room');
    assert.deepEqual(office.tiles.map((t) => t.id), ['light.desk', 'light.hallway']);
  });
});

test('after a drop it serves the last-known state, refuses actions, then reconnects', async () => {
  await withHome(house(), async ({ url, ha }) => {
    const before = await getHome(url);
    ha.home.states['light.couch'].state = 'off';
    ha.drop();
    const down = await waitFor(async () => { const b = await getHome(url); return !b.connected && b; }, 'the drop to be noticed');
    assert.deepEqual(down.rooms, before.rooms);
    const res = await post(url, '/api/home/light.couch', { action: 'off' });
    assert.equal(res.status, 503);
    assert.match((await res.json()).error, /not connected/);
    await waitFor(async () => (await getHome(url)).connected, 'the reconnect');
    assert.equal(ha.connections, 2);
    assert.equal((await getHome(url)).rooms[1].tiles[0].on, false);
    assert.equal((await post(url, '/api/home/light.couch', { action: 'on' })).status, 204);
    ha.push('light.couch', { state: 'on', attributes: { friendly_name: 'Couch lamp', brightness: 26, supported_color_modes: ['brightness'] } });
    await waitFor(async () => (await getHome(url)).rooms[1].tiles[0].level === 10, 'a push on the new connection');
  });
});

test('camera snapshots and media art are proxied for labelled entities only', async () => {
  const h = house();
  h.entities.push({ entity_id: 'camera.garage', labels: [], area_id: null });
  h.states['camera.garage'] = { state: 'idle', attributes: {} };
  await withHome(h, async ({ url, ha }) => {
    let res = await fetch(url + '/api/home/cameras/camera.porch.jpg');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('content-type'), 'image/jpeg');
    assert.equal(await res.text(), 'jpeg:camera.porch');
    res = await fetch(url + '/api/home/media/media_player.kitchen/art');
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'jpeg:media_player.kitchen');
    const art = ha.requests.find((r) => r.path.startsWith('/api/media_player_proxy/'));
    assert.equal(art.search, '?token=abc&cache=1');
    assert.equal(art.headers.authorization, 'Bearer ' + ha.token);
    for (const path of ['/api/home/cameras/camera.garage.jpg', '/api/home/cameras/light.couch.jpg', '/api/home/media/media_player.nope/art', '/api/home/media/camera.porch/art']) {
      assert.equal((await fetch(url + path)).status, 404, path);
    }
  });
});

test('without Home Assistant settings, says Home controls are not configured', async () => {
  const srv = await startServer({
    config: { settings: settings(), serviceAccount: serviceAccount(), homeAssistant: null, port: 0, timeZone: null },
    distDir: '/nonexistent',
  });
  try {
    assert.deepEqual(await getHome(srv.url), { configured: false });
    assert.equal((await post(srv.url, '/api/home/light.couch', { action: 'on' })).status, 404);
  } finally {
    await srv.close();
  }
});

// Sam is linked to person.sam, Alex to person.alex, Kit to nobody.
const linked = settings({
  people: [
    { id: 'alex', name: 'Alex', colour: '#2D5BFF', homeAssistant: 'person.alex' },
    { id: 'sam', name: 'Sam', colour: '#E4007C', homeAssistant: 'person.sam' },
    { id: 'kit', name: 'Kit', colour: '#00A86B' },
  ],
});
function withPeople(states, fn) {
  const h = house();
  for (const [id, state] of Object.entries(states)) h.states[id] = { state, attributes: { friendly_name: id } };
  return withHome(h, fn, { settings: linked });
}

test("presence: a linked person's HA state as home or away, unknown ones left out", async () => {
  const cases = [
    [{ 'person.alex': 'home', 'person.sam': 'not_home' }, { alex: 'home', sam: 'away' }],
    [{ 'person.alex': 'School', 'person.sam': 'home' }, { alex: 'away', sam: 'home' }],
    [{ 'person.alex': 'unavailable', 'person.sam': 'unknown' }, {}],
    [{ 'person.sam': 'home' }, { sam: 'home' }],
    [{ 'person.kit': 'home' }, {}],
  ];
  for (const [states, presence] of cases) {
    await withPeople(states, async ({ url }) => {
      assert.deepEqual((await getHome(url)).presence, presence, JSON.stringify(states));
    });
  }
});

test('presence: a state_changed for a linked person shows in the next GET', async () => {
  await withPeople({ 'person.alex': 'home', 'person.sam': 'home' }, async ({ url, ha }) => {
    ha.push('person.alex', { state: 'Work', attributes: { friendly_name: 'Alex' } });
    await waitFor(async () => (await getHome(url)).presence.alex === 'away', 'Alex to be away');
    ha.push('person.sam', null);
    await waitFor(async () => !('sam' in (await getHome(url)).presence), 'Sam to be unknown');
  });
});

test('person entities are not Home controls and cannot be acted on', async () => {
  const h = house();
  h.entities.push({ entity_id: 'person.alex', labels: ['frame'], area_id: 'office' });
  h.states['person.alex'] = { state: 'home', attributes: { friendly_name: 'Alex' } };
  await withHome(h, async ({ url, ha }) => {
    const body = await getHome(url);
    assert.doesNotMatch(JSON.stringify(body.rooms), /person\./);
    assert.equal((await post(url, '/api/home/person.alex', { action: 'on' })).status, 404);
    assert.equal(ha.calls.length, 0);
  }, { settings: linked });
});

test('without links, presence is empty', async () => {
  await withHome(house(), async ({ url }) => {
    assert.deepEqual((await getHome(url)).presence, {});
  });
});
