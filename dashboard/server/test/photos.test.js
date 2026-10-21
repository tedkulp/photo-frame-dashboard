import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../app.js';
import { fakeImmich, serviceAccount, settings } from './helpers.js';

const ALBUM = '11111111-2222-4333-8444-555555555555';
const ALEX = 'aaaaaaaa-0000-4000-8000-000000000001';
const SAM = 'aaaaaaaa-0000-4000-8000-000000000002';
const GUEST = 'aaaaaaaa-0000-4000-8000-000000000003';

const album = {
  id: ALBUM,
  albumName: 'Frame',
  albumUsers: [
    { user: { id: ALEX, email: 'Alex@Example.com', name: 'Alex' }, role: 'owner' },
    { user: { id: SAM, email: 'sam@example.com', name: 'Sam' }, role: 'editor' },
    { user: { id: GUEST, email: 'guest@example.com', name: 'Guest' }, role: 'editor' },
  ],
};

let n = 0;
function asset(over, exif) {
  const id = 'b0000000-0000-4000-8000-' + String(++n).padStart(12, '0');
  return Object.assign({
    id, type: 'IMAGE', ownerId: ALEX, isFavorite: false, isTrashed: false,
    localDateTime: '2024-05-19T14:23:00.000Z', fileCreatedAt: '2024-05-19T18:23:00.000Z',
    width: 4000, height: 3000,
    exifInfo: Object.assign({ exifImageWidth: 4000, exifImageHeight: 3000, orientation: '1', city: 'Toronto', state: 'Ontario', country: 'Canada' }, exif),
  }, over);
}

// People with Immich emails: Alex (matched ignoring case) and Sam; the guest uploader is nobody.
const people = [
  { id: 'alex', name: 'Alex', colour: '#2D5BFF', immich: 'alex@example.com' },
  { id: 'sam', name: 'Sam', colour: '#E4007C', immich: 'sam@example.com' },
];

async function withServer(opts, fn) {
  const im = await fakeImmich(opts);
  const srv = await startServer({
    config: {
      settings: settings({ people }), serviceAccount: serviceAccount(), homeAssistant: null, port: 0, timeZone: null,
      immich: 'immich' in opts ? opts.immich : { url: im.url, albumId: ALBUM, apiKey: opts.configKey || im.apiKey },
    },
    distDir: '/nonexistent',
    now: opts.now || Date.now,
  });
  try {
    await fn({ url: srv.url, im });
  } finally {
    await srv.close();
    await im.close();
  }
}

async function get(url) {
  const res = await fetch(url);
  const text = await res.text();
  let body = text;
  try { body = JSON.parse(text); } catch {}
  return { status: res.status, headers: res.headers, text, body };
}

test('without settings.immich, /api/photos is { configured: false } and images are 404', async () => {
  await withServer({ immich: null }, async ({ url, im }) => {
    const r = await get(url + '/api/photos');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { configured: false });
    assert.equal((await get(url + '/api/photos/' + ALBUM + '.jpg')).status, 404);
    assert.equal(im.requests.length, 0);
  });
});

test('maps the album into the dashboard photo shape', async () => {
  const assets = [
    asset({}, {}),
    asset({ ownerId: SAM, isFavorite: true, localDateTime: '2025-10-12T23:30:00.000Z' }, { exifImageWidth: 3000, exifImageHeight: 4000, city: null }),
    asset({ ownerId: GUEST }, { orientation: '6', city: '', state: '' }),
    asset({}, { orientation: '8', city: null, state: null, country: null }),
    asset({ type: 'VIDEO' }),
    asset({}, { exifImageWidth: null, exifImageHeight: null }),
    asset({ width: 3000, height: 4000 }, { exifImageWidth: null, exifImageHeight: null }),
  ];
  await withServer({ album, assets }, async ({ url, im }) => {
    const r = await get(url + '/api/photos');
    assert.equal(r.status, 200);
    assert.equal(r.body.configured, true);
    assert.ok(!isNaN(Date.parse(r.body.updatedAt)));
    const id = (i) => assets[i].id;
    assert.deepEqual(r.body.photos, [
      { id: id(0), o: 'l', date: '2024-05-19', place: 'Toronto', tag: '2024-05-19', fav: false, from: 'alex' },
      { id: id(1), o: 'p', date: '2025-10-12', place: 'Ontario', tag: '2025-10-12', fav: true, from: 'sam' },
      { id: id(2), o: 'p', date: '2024-05-19', place: 'Canada', tag: '2024-05-19', fav: false },
      { id: id(3), o: 'p', date: '2024-05-19', place: '', tag: '2024-05-19', fav: false, from: 'alex' },
      { id: id(5), o: 'l', date: '2024-05-19', place: 'Toronto', tag: '2024-05-19', fav: false, from: 'alex' },
      { id: id(6), o: 'p', date: '2024-05-19', place: 'Toronto', tag: '2024-05-19', fav: false, from: 'alex' },
    ]);
    const search = im.requests.find((q) => q.path === '/api/search/metadata');
    assert.deepEqual(JSON.parse(search.body).albumIds, [ALBUM]);
    assert.equal(JSON.parse(search.body).withExif, true);
    assert.ok(!r.text.includes(im.apiKey));
  });
});

test('reads every page of a large album', async () => {
  const assets = Array.from({ length: 5 }, () => asset());
  await withServer({ album, assets, pageSize: 2 }, async ({ url, im }) => {
    const r = await get(url + '/api/photos');
    assert.deepEqual(r.body.photos.map((p) => p.id), assets.map((a) => a.id));
    assert.equal(im.requests.filter((q) => q.path === '/api/search/metadata').length, 3);
  });
});

test('caches the listing for a few minutes', async () => {
  let t = Date.parse('2026-10-21T12:00:00Z');
  await withServer({ album, assets: [asset()], now: () => t }, async ({ url, im }) => {
    const searches = () => im.requests.filter((q) => q.path === '/api/search/metadata').length;
    await get(url + '/api/photos');
    await get(url + '/api/photos');
    assert.equal(searches(), 1);
    t += 5 * 60 * 1000;
    await get(url + '/api/photos');
    assert.equal(searches(), 2);
  });
});

test('serves an album image through the proxy, and 404 for anything else', async () => {
  const assets = [asset()];
  await withServer({ album, assets }, async ({ url, im }) => {
    const r = await get(url + '/api/photos/' + assets[0].id + '.jpg');
    assert.equal(r.status, 200);
    assert.equal(r.text, 'jpeg:' + assets[0].id + ':preview');
    assert.equal(r.headers.get('content-type'), 'image/jpeg');
    assert.equal(r.headers.get('x-immich-secret'), null);
    for (const [k, v] of r.headers) assert.ok(!v.includes(im.apiKey), k);
    const thumb = im.requests.find((q) => q.path.endsWith('/thumbnail'));
    assert.equal(thumb.headers['x-api-key'], im.apiKey);

    assert.equal((await get(url + '/api/photos/c0000000-0000-4000-8000-000000000000.jpg')).status, 404);
    assert.equal((await get(url + '/api/photos/' + assets[0].id)).status, 404);
    assert.equal((await get(url + '/api/photos/..%2Fx.jpg')).status, 404);
    assert.equal(im.requests.filter((q) => q.path.endsWith('/thumbnail')).length, 1);
    assert.equal((await fetch(url + '/api/photos', { method: 'POST' })).status, 405);
  });
});

test('Immich unreachable: an error answer, no crash, and it recovers', async () => {
  const assets = [asset()];
  await withServer({ album, assets }, async ({ url, im }) => {
    im.fail = 500;
    const r = await get(url + '/api/photos');
    assert.equal(r.status, 502);
    assert.match(r.body.error, /Immich .*500 Immich is down/);
    assert.ok(!r.text.includes(im.apiKey));
    assert.equal((await get(url + '/api/photos/' + assets[0].id + '.jpg')).status, 502);
    im.fail = null;
    assert.equal((await get(url + '/api/photos')).body.photos.length, 1);
  });
});

test('a wrong API key is reported, not hidden', async () => {
  await withServer({ album, assets: [asset()], configKey: 'wrong-key' }, async ({ url }) => {
    const r = await get(url + '/api/photos');
    assert.equal(r.status, 502);
    assert.match(r.body.error, /401 Invalid API key/);
    assert.ok(!r.text.includes('wrong-key'));
  });
});

test("an uploader who isn't an album user is found in Immich's user list, if the key may read it", async () => {
  const assets = [asset({ ownerId: 'aaaaaaaa-0000-4000-8000-000000000009' })];
  const admin = { id: assets[0].ownerId, email: 'SAM@example.com', name: 'Sam' };
  await withServer({ album, assets, users: [admin] }, async ({ url }) => {
    assert.equal((await get(url + '/api/photos')).body.photos[0].from, 'sam');
  });
  await withServer({ album, assets }, async ({ url, im }) => {
    const r = await get(url + '/api/photos');
    assert.equal(r.status, 200);
    assert.equal(r.body.photos[0].from, undefined);
    assert.equal(im.requests.filter((q) => q.path === '/api/users').length, 1);
  });
});

test('the user list is not asked for when every uploader is known', async () => {
  await withServer({ album, assets: [asset()] }, async ({ url, im }) => {
    await get(url + '/api/photos');
    assert.equal(im.requests.filter((q) => q.path === '/api/users').length, 0);
  });
});

test('while the album search fails, images of the last listing still load', async () => {
  let t = Date.parse('2026-10-21T12:00:00Z');
  const assets = [asset()];
  await withServer({ album, assets, now: () => t }, async ({ url, im }) => {
    await get(url + '/api/photos');
    t += 10 * 60 * 1000;
    im.failSearch = 500;
    assert.equal((await get(url + '/api/photos')).status, 502);
    assert.equal((await get(url + '/api/photos/' + assets[0].id + '.jpg')).status, 200);
    assert.equal((await get(url + '/api/photos/c0000000-0000-4000-8000-000000000000.jpg')).status, 404);
  });
});
