import { test } from 'node:test';
import assert from 'node:assert/strict';
import { project, mapTiles, USER_AGENT } from '../radar.js';
import { fakeHomeAssistant, fakeRadar, serviceAccount, settings, startTestServer, tempDir } from './helpers.js';

// ------------------------------------------------------------ Web Mercator maths
test('project puts 0,0 in the middle of the world and the world is 256·2^z px', () => {
  assert.deepEqual(project(0, 0, 0), { x: 128, y: 128 });
  assert.deepEqual(project(0, 0, 8), { x: 32768, y: 32768 });
  const nw = project(85.0511287798, -180, 2);
  assert.equal(nw.x, 0);
  assert.ok(Math.abs(nw.y) < 1e-6);
});

test('a window that lines up with the tile grid takes 2×2 tiles at 0 and 256', () => {
  assert.deepEqual(mapTiles(0, 0, 8), [
    { id: '8-127-127', z: 8, x: 127, y: 127, left: 0, top: 0 },
    { id: '8-128-127', z: 8, x: 128, y: 127, left: 256, top: 0 },
    { id: '8-127-128', z: 8, x: 127, y: 128, left: 0, top: 256 },
    { id: '8-128-128', z: 8, x: 128, y: 128, left: 256, top: 256 },
  ]);
});

test('any other window takes 3×3 tiles that cover it, the home at its centre pixel', () => {
  const lat = 43.65107, lon = -79.347015, z = 8;
  const tiles = mapTiles(lat, lon, z);
  assert.equal(tiles.length, 9);
  const lefts = [...new Set(tiles.map((t) => t.left))], tops = [...new Set(tiles.map((t) => t.top))];
  assert.equal(lefts.length, 3);
  assert.equal(tops.length, 3);
  assert.ok(lefts[0] <= 0 && lefts[0] > -256 && lefts[2] + 256 >= 512);
  assert.ok(tops[0] <= 0 && tops[0] > -256 && tops[2] + 256 >= 512);
  assert.deepEqual([lefts[1] - lefts[0], lefts[2] - lefts[1]], [256, 256]);
  // The tile under the home has it 256 px into the window (rounded to the pixel).
  const p = project(lat, lon, z);
  const under = tiles.find((t) => t.x === Math.floor(p.x / 256) && t.y === Math.floor(p.y / 256));
  assert.ok(Math.abs(under.left + (p.x - under.x * 256) - 256) <= 0.5);
  assert.ok(Math.abs(under.top + (p.y - under.y * 256) - 256) <= 0.5);
});

test('tiles wrap round the date line and stop at the top and bottom of the world', () => {
  const east = mapTiles(0, 179.9, 3);
  assert.ok(east.some((t) => t.x === 0), 'the tile past 180° is x 0');
  assert.ok(east.every((t) => t.x >= 0 && t.x < 8));
  const zero = mapTiles(0, 0, 0);
  assert.ok(zero.every((t) => t.x === 0 && t.y === 0));
  assert.deepEqual(zero.map((t) => t.top), [128, 128, 128].slice(0, zero.length));
  assert.equal(new Set(zero.map((t) => t.left)).size, zero.length, 'one per place across');
});

// ------------------------------------------------------------ the home server's radar
const NOW = Date.parse('2026-10-25T15:40:00Z');
const T = NOW / 1000;
const MIN = 60 * 1000;
const HOME = { latitude: 43.65107, longitude: -79.383186 };

// LibreWXR's frame list with past frames every 10 minutes up to `newest` (8 of them, so 2 fall
// outside the hour) and 6 nowcast frames after it.
function maps(newest, generated) {
  const past = [], nowcast = [];
  for (let i = 7; i >= 0; i--) past.push({ time: newest - i * 600, path: '/v2/radar/' + (newest - i * 600) });
  for (let i = 1; i <= 6; i++) nowcast.push({ time: newest + i * 600, path: '/v2/radar/' + (newest + i * 600) });
  return { version: '2.0', generated: generated || newest + 60, host: 'https://api.librewxr.net', radar: { past, nowcast } };
}

function weatherEntity() {
  return { state: 'cloudy', attributes: { temperature: 50, temperature_unit: '°F' }, hourly: [], daily: [] };
}

// opts: zone (zone.home's attributes), maps, dir (a data dir to reuse), radar (the config block).
async function withRadar(opts, fn) {
  const fake = await fakeRadar(opts.maps || maps(T));
  const ha = await fakeHomeAssistant({ 'zone.home': { state: 'zoning', attributes: 'zone' in opts ? opts.zone : HOME }, 'weather.home': weatherEntity() });
  const own = opts.dir ? null : tempDir();
  const dataDir = opts.dir || own.path('data');
  const clock = { t: NOW };
  const logged = [];
  const log = { log() {}, warn: (...a) => logged.push(['warn', a.join(' ')]), error: (...a) => logged.push(['error', a.join(' ')]) };
  const start = () => startTestServer({
    config: {
      settings: settings(), serviceAccount: serviceAccount(), port: 0, timeZone: null, dataDir,
      homeAssistant: { url: ha.url, weatherEntity: 'weather.home', token: ha.token, label: 'frame', rooms: [], radar: 'radar' in opts ? opts.radar : { zoom: 8 } },
    },
    distDir: '/nonexistent',
    now: () => clock.t,
    radarBase: fake.url,
    tileBase: fake.tileBase,
    log,
  });
  let srv = await start();
  try {
    await fn({
      fake, ha, clock, logged, dataDir,
      get url() { return srv.url; },
      restart: async () => { await srv.close(); srv = await start(); },
    });
  } finally {
    await srv.close();
    await ha.close();
    await fake.close();
    if (own) own.cleanup();
  }
}

async function get(url) {
  const res = await fetch(url);
  const text = await res.text();
  let body = text;
  try { body = JSON.parse(text); } catch {}
  return { status: res.status, headers: res.headers, text, body };
}
const listRequests = (fake) => fake.requests.filter((r) => r.path === '/public/weather-maps.json').length;
const frameRequests = (fake) => fake.requests.filter((r) => r.path.startsWith('/v2/radar/')).map((r) => Number(r.path.split('/')[3]));

test('the listing: the last hour of past frames and up to 5 nowcast, oldest first; one frame list per 10 minutes', async () => {
  await withRadar({}, async ({ url, fake, clock }) => {
    const res = await get(url + '/api/radar');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const l = res.body;
    assert.equal(l.configured, true);
    assert.equal(l.available, true);
    assert.deepEqual(l.frames.map((f) => f.nowcast), [false, false, false, false, false, false, true, true, true, true, true]);
    assert.deepEqual(l.frames.map((f) => Date.parse(f.at) / 1000), [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5].map((i) => T + i * 600));
    assert.equal(l.latest, 5);
    assert.deepEqual([l.stale, l.age, l.size, l.tile], [false, 0, 512, 256]);
    assert.equal(l.frames[5].url, '/api/radar/frames/p' + T + '.png');
    assert.match(l.frames[6].url, /^\/api\/radar\/frames\/n\d+-\d+\.png$/);
    assert.equal(l.map.length, 9);
    // LibreWXR draws zoom 8 at OSM's zoom 9 scale (its world is 512·2^z px), so the map is zoom 9.
    assert.match(l.map[0].url, /^\/api\/radar\/map\/9-\d+-\d+\.png$/);

    // The image asked for is the home's, at the configured zoom, 512 px, colour scheme 10, smoothed + snow.
    assert.ok(fake.requests.some((r) => r.path === `/v2/radar/${T}/512/8/43.65107/-79.38319/10/1_1.png`), JSON.stringify(fake.requests.map((r) => r.path)));
    const img = await fetch(url + l.frames[5].url);
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/png');
    assert.equal(img.headers.get('cache-control'), 'private, max-age=3600');
    assert.equal(await img.text(), `png:/v2/radar/${T}/512/8/43.65107/-79.38319/10/1_1.png`);

    clock.t += 9 * MIN;
    assert.equal((await get(url + '/api/radar')).body.age, 9);
    await Promise.all([get(url + '/api/radar'), get(url + '/api/radar')]);
    assert.equal(listRequests(fake), 1);
    clock.t += MIN;
    await Promise.all([get(url + '/api/radar'), get(url + '/api/radar')]);
    assert.equal(listRequests(fake), 2);
  });
});

test('a past frame is fetched once; a new frame list fetches only the new past frame and the nowcast', async () => {
  await withRadar({}, async ({ url, fake, clock }) => {
    const first = (await get(url + '/api/radar')).body;
    assert.deepEqual(frameRequests(fake).sort(), [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5].map((i) => T + i * 600));
    fake.requests.length = 0;
    // Same frame list again: nothing new to fetch.
    clock.t += 10 * MIN;
    await get(url + '/api/radar');
    assert.deepEqual(frameRequests(fake), []);

    fake.maps = maps(T + 600);
    clock.t += 10 * MIN;
    const next = (await get(url + '/api/radar')).body;
    assert.deepEqual(frameRequests(fake).sort(), [1, 2, 3, 4, 5, 6].map((i) => T + i * 600));
    assert.deepEqual(next.frames.filter((f) => !f.nowcast).map((f) => Date.parse(f.at) / 1000), [-4, -3, -2, -1, 0, 1].map((i) => T + i * 600));
    assert.notEqual(next.frames[6].id, first.frames[6].id, 'new nowcast images get new ids');
    // The frame that fell out of the hour is gone, the old nowcast too.
    assert.equal((await get(url + first.frames[0].url)).status, 404);
    assert.equal((await get(url + first.frames[6].url)).status, 404);
    assert.equal((await get(url + next.frames[0].url)).status, 200);
  });
});

test('map tiles are fetched once with a User-Agent, kept in the data dir and survive a restart', async () => {
  const dir = tempDir();
  try {
    await withRadar({ dir: dir.path('data') }, async (s) => {
      const l = (await get(s.url + '/api/radar')).body;
      const tile = await fetch(s.url + l.map[4].url);
      assert.equal(tile.status, 200);
      assert.equal(tile.headers.get('content-type'), 'image/png');
      assert.equal(tile.headers.get('cache-control'), 'private, max-age=86400');
      const id = l.map[4].url.match(/map\/(.+)\.png$/)[1];
      assert.equal(await tile.text(), 'tile:' + id.split('-').join('/'));
      await Promise.all([fetch(s.url + l.map[4].url).then((r) => r.text()), fetch(s.url + l.map[4].url).then((r) => r.text())]);
      const osm = () => s.fake.requests.filter((r) => r.path.startsWith('/osm/'));
      assert.equal(osm().length, 1);
      assert.equal(osm()[0].headers['user-agent'], USER_AGENT);

      await s.restart();
      await get(s.url + '/api/radar');
      assert.equal(await (await fetch(s.url + l.map[4].url)).text(), 'tile:' + id.split('-').join('/'));
      assert.equal(osm().length, 1, 'read back from the data dir');
      assert.ok(s.fake.requests.filter((r) => r.path === '/public/weather-maps.json').every((r) => r.headers['user-agent'] === USER_AGENT));
    });
  } finally {
    dir.cleanup();
  }
});

test('image routes serve only ids in the listing and take no coordinates', async () => {
  await withRadar({}, async ({ url, fake }) => {
    // Nothing listed yet: no place, nothing allowed.
    assert.equal((await get(url + '/api/radar/map/8-71-93.png')).status, 404);
    await get(url + '/api/radar');
    for (const path of ['/api/radar/frames/p1.png', '/api/radar/map/8-0-0.png', '/api/radar/map/3-2-2.png',
      '/api/radar/frames/p' + T, '/api/radar/frames/../map.png', '/api/radar/512/8/43.6/-79.3.png', '/api/radar/frames/p' + T + '.png?lat=1']) {
      const res = await get(url + path);
      if (path.endsWith('?lat=1')) { assert.equal(res.status, 200); continue; } // the query is ignored
      assert.equal(res.status, 404, path);
    }
    assert.equal(fake.requests.filter((r) => r.path.startsWith('/osm/')).length, 0);
    assert.equal((await fetch(url + '/api/radar', { method: 'POST' })).status, 405);
  });
});

test('when LibreWXR fails after a good load, the last frames stay with their age; never loaded, unavailable', async () => {
  await withRadar({}, async ({ url, fake, clock, logged }) => {
    await get(url + '/api/radar');
    fake.fail = 503;
    clock.t += 25 * MIN;
    const l = (await get(url + '/api/radar')).body;
    assert.equal(l.available, true);
    assert.equal(l.frames.length, 11);
    assert.deepEqual([l.stale, l.age], [true, 25]);
    assert.equal((await get(url + l.frames[l.latest].url)).status, 200);
    assert.ok(logged.some(([k, m]) => k === 'error' && /LibreWXR frame list: 503/.test(m)));
    fake.fail = null;
    clock.t += 10 * MIN;
    assert.deepEqual(await get(url + '/api/radar').then((r) => [r.body.stale, r.body.age]), [false, 0]);
  });
  await withRadar({}, async ({ url, fake }) => {
    fake.fail = 503;
    const l = (await get(url + '/api/radar')).body;
    assert.deepEqual([l.configured, l.available, l.frames, l.latest, l.stale, l.age], [true, false, [], -1, true, null]);
    assert.equal(l.map.length, 9, 'the map is still there');
    assert.equal((await get(url + l.map[0].url)).status, 200);
  });
});

test('zone.home without coordinates: one warning, no radar, the weather unaffected', async () => {
  await withRadar({ zone: { friendly_name: 'Home' } }, async ({ url, fake, clock, logged }) => {
    for (let i = 0; i < 3; i++) {
      const l = (await get(url + '/api/radar')).body;
      assert.deepEqual([l.configured, l.available, l.frames, l.map], [true, false, [], []]);
      clock.t += 10 * MIN;
    }
    assert.deepEqual(logged.filter(([k]) => k === 'warn').map(([, m]) => m), ['[radar] zone.home has no latitude/longitude in Home Assistant, so there is no radar']);
    assert.equal(listRequests(fake), 0);
    const w = await get(url + '/api/weather');
    assert.equal(w.status, 200);
    assert.equal(w.body.now.temp, 50);
  });
});

test('without settings.homeAssistant.radar: { configured: false }, other paths 404, nothing fetched', async () => {
  await withRadar({ radar: null }, async ({ url, fake }) => {
    assert.deepEqual(await get(url + '/api/radar').then((r) => [r.status, r.body]), [200, { configured: false }]);
    assert.deepEqual(await get(url + '/api/radar/frames/p1.png').then((r) => [r.status, r.body]), [404, { error: 'Radar is not set up' }]);
    assert.equal(fake.requests.length, 0);
  });
});
