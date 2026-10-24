// Route modules mounted on their own: fake feature objects, no config and no Google key. Also pins
// the one "not set up" answer (http.js notSetUp) that every optional feature gives.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHandler, HttpError } from '../http.js';
import { weatherRoutes } from '../routes/weather.js';
import { choresRoutes } from '../routes/chores.js';
import { homeRoutes } from '../routes/home.js';
import { photosRoutes } from '../routes/photos.js';

async function withRoutes(routes, fn) {
  const server = createServer(createHandler({ routes, distDir: '/nonexistent' }));
  await new Promise((ok) => server.listen(0, ok));
  try {
    await fn('http://127.0.0.1:' + server.address().port);
  } finally {
    server.closeAllConnections();
    await new Promise((ok) => server.close(ok));
  }
}

async function call(url, method, path, body) {
  const init = { method };
  if (body !== undefined) Object.assign(init, { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const res = await fetch(url + path, init);
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : undefined };
}

test('weather routes answer from a fake feature object', async () => {
  const weather = { load: async () => ({ configured: true, now: { temp: 61 } }) };
  await withRoutes([weatherRoutes(weather)], async (url) => {
    const res = await call(url, 'GET', '/api/weather');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.deepEqual(res.body, { configured: true, now: { temp: 61 } });
    assert.equal((await call(url, 'POST', '/api/weather')).status, 405);
  });
});

test('chores routes answer from a fake feature object; an HttpError keeps its status', async () => {
  const chores = {
    load: async () => ({ chores: [] }),
    setDone: async (id) => { if (id !== 'bins') throw new HttpError(404, 'No such chore'); },
  };
  await withRoutes([choresRoutes(chores)], async (url) => {
    assert.deepEqual((await call(url, 'GET', '/api/chores')).body, { chores: [] });
    assert.equal((await call(url, 'PUT', '/api/chores/bins/done')).status, 204);
    const missing = await call(url, 'PUT', '/api/chores/nope/done');
    assert.equal(missing.status, 404);
    assert.deepEqual(missing.body, { error: 'No such chore' });
  });
});

test('a feature that throws anything else answers 502', async () => {
  const weather = { load: async () => { throw new Error('Home Assistant: timeout'); } };
  const error = console.error;
  console.error = () => {};
  try {
    await withRoutes([weatherRoutes(weather)], async (url) => {
      const res = await call(url, 'GET', '/api/weather');
      assert.equal(res.status, 502);
      assert.deepEqual(res.body, { error: 'Home Assistant: timeout' });
    });
  } finally {
    console.error = error;
  }
});

test('an unconfigured feature: its top-level GET is { configured: false }, anything else 404 not set up', async () => {
  await withRoutes([weatherRoutes(null), homeRoutes(null), photosRoutes(null)], async (url) => {
    const answer = (method, path, body) => call(url, method, path, body).then((r) => [r.status, r.body]);
    for (const path of ['/api/weather', '/api/home', '/api/photos']) {
      assert.deepEqual(await answer('GET', path), [200, { configured: false }], path);
    }
    const weather = [404, { error: 'Weather is not set up' }];
    const home = [404, { error: 'Home Assistant is not set up' }];
    const photos = [404, { error: 'Photos are not set up' }];
    assert.deepEqual(await answer('POST', '/api/weather'), weather);
    assert.deepEqual(await answer('POST', '/api/home/light.kitchen', { action: 'toggle' }), home);
    assert.deepEqual(await answer('GET', '/api/home/cameras/camera.door.jpg'), home);
    assert.deepEqual(await answer('POST', '/api/home'), home);
    assert.deepEqual(await answer('GET', '/api/home/x/y/z'), home);
    assert.deepEqual(await answer('GET', '/api/photos/abc-123.jpg'), photos);
    assert.deepEqual(await answer('POST', '/api/photos'), photos);
    assert.deepEqual(await answer('GET', '/api/photos/nope'), photos);
  });
});

test('the shared handler answers the rest: version, unknown /api paths, static 404', async () => {
  await withRoutes([], async (url) => {
    assert.deepEqual(await call(url, 'GET', '/api/version').then((r) => [r.status, r.body]), [200, { build: null }]);
    assert.deepEqual(await call(url, 'GET', '/api/weather').then((r) => [r.status, r.body]), [404, { error: 'Not found' }]);
    assert.equal((await call(url, 'GET', '/index.html')).status, 404);
    assert.equal((await call(url, 'POST', '/index.html')).status, 405);
  });
});

test('a photo image streams with a private one-hour cache; a missing one is 404', async () => {
  const photos = {
    image: async (id) => {
      if (id === 'abc') return new Response('JPEGDATA', { headers: { 'content-type': 'image/jpeg', 'content-length': '8' } });
      // fetch has already decoded this one, so the upstream length no longer holds.
      if (id === 'gz') return new Response('JPEGDATA', { headers: { 'content-type': 'image/jpeg', 'content-length': '5', 'content-encoding': 'gzip' } });
      return null;
    },
  };
  await withRoutes([photosRoutes(photos)], async (url) => {
    const res = await fetch(url + '/api/photos/abc.jpg');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'private, max-age=3600');
    assert.equal(res.headers.get('content-length'), '8');
    assert.equal(await res.text(), 'JPEGDATA');
    const gz = await fetch(url + '/api/photos/gz.jpg');
    assert.equal(gz.headers.get('content-length'), null);
    assert.equal(gz.headers.get('content-encoding'), null);
    assert.equal(await gz.text(), 'JPEGDATA');
    assert.deepEqual(await call(url, 'GET', '/api/photos/zzz.jpg').then((r) => [r.status, r.body]), [404, { error: 'No such photo' }]);
    assert.equal((await call(url, 'POST', '/api/photos')).status, 405);
  });
});

test('a Home Assistant image is never cached', async () => {
  const home = { camera: async () => ({ type: 'image/png', body: Buffer.from('PNG') }) };
  await withRoutes([homeRoutes(home)], async (url) => {
    const res = await fetch(url + '/api/home/cameras/camera.door.jpg');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/png');
    assert.equal(res.headers.get('content-length'), '3');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(await res.text(), 'PNG');
  });
});
