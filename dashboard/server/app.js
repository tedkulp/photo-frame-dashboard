// HTTP server: the built dashboard (dist), GET /api/calendar, POST /api/events,
// DELETE /api/events/:id, GET /api/weather, /api/chores, /api/home, GET /api/photos (+ the photo
// images) and GET /api/version from one origin. LAN-only, no auth.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { extname, join, resolve, sep } from 'node:path';
import { createGoogle } from './google.js';
import { createCalendar, InputError } from './calendar.js';
import { createIcsFeeds } from './ics.js';
import { createHomeAssistant } from './homeassistant.js';
import { createWeather } from './weather.js';
import { createHome } from './home.js';
import { createChores, localDate } from './chores.js';
import { createImmich } from './immich.js';
import { createPhotos } from './photos.js';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function sendJson(res, status, obj) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}

const BODY_MAX = 64 * 1024;

// The request's JSON body. Only application/json is accepted: another web page can post a plain
// form or text/plain to this LAN server without asking, but not JSON.
async function readJson(req) {
  if (!/^application\/json\s*(;|$)/i.test(req.headers['content-type'] || '')) throw new InputError(415, 'Send the body as application/json');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > BODY_MAX) throw new InputError(413, 'Request body is too large');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new InputError(400, 'Request body is not valid JSON');
  }
}

// Runs an API call: InputError → its status, anything else (Google, Home Assistant) → 502.
async function apiCall(res, what, status, fn) {
  try {
    const out = await fn();
    if (out === undefined) {
      res.writeHead(status, { 'cache-control': 'no-store' });
      return res.end();
    }
    return sendJson(res, status, out);
  } catch (e) {
    if (e instanceof InputError) return sendJson(res, e.status, { error: e.message });
    console.error('[' + what + ']', e.message);
    return sendJson(res, 502, { error: e.message });
  }
}

// The build id `npm run build` stamps into dist/version.json (null without one). Read on every
// request so a build swapped in under a running server is reported straight away.
async function buildId(root) {
  try {
    const { build } = JSON.parse(await readFile(join(root, 'version.json'), 'utf8'));
    return typeof build === 'string' && build ? build : null;
  } catch {
    return null;
  }
}

function createHandler({ calendar, weather, chores, home, photos, distDir }) {
  const root = resolve(distDir);

  async function serveStatic(req, res, pathname) {
    let rel;
    try {
      rel = decodeURIComponent(pathname);
    } catch {
      return sendJson(res, 400, { error: 'Bad path' });
    }
    if (rel.endsWith('/')) rel += 'index.html';
    const file = resolve(join(root, rel));
    if (!file.startsWith(root + sep)) return sendJson(res, 404, { error: 'Not found' });
    try {
      if (!(await stat(file)).isFile()) throw new Error('not a file');
    } catch {
      return sendJson(res, 404, { error: 'Not found' });
    }
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] || 'application/octet-stream',
      'content-length': body.length,
      // Vite puts content-hashed files under /assets; everything else (index.html first) is revalidated.
      'cache-control': rel.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  return async (req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    try {
      if (pathname === '/api/calendar') {
        if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
        return await apiCall(res, 'calendar', 200, () => calendar.load());
      }
      if (pathname === '/api/events') {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
        return await apiCall(res, 'add event', 201, async () => calendar.create(await readJson(req)));
      }
      if (pathname.startsWith('/api/events/')) {
        if (req.method !== 'DELETE') return sendJson(res, 405, { error: 'Method not allowed' });
        let id;
        try {
          id = decodeURIComponent(pathname.slice('/api/events/'.length));
        } catch {
          return sendJson(res, 404, { error: 'No such event' });
        }
        return await apiCall(res, 'delete event', 204, () => calendar.remove(id));
      }
      if (pathname === '/api/weather') {
        if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
        if (!weather) return sendJson(res, 200, { configured: false });
        return await apiCall(res, 'weather', 200, () => weather.load());
      }
      if (pathname === '/api/chores' || pathname.startsWith('/api/chores/')) {
        if (!chores) return sendJson(res, 503, { error: 'Chores need a data dir' });
        return await routeChores(req, res, pathname, chores);
      }
      if (pathname === '/api/home' || pathname.startsWith('/api/home/')) {
        if (!home) {
          if (pathname === '/api/home' && req.method === 'GET') return sendJson(res, 200, { configured: false });
          return sendJson(res, 404, { error: 'Home Assistant is not set up' });
        }
        return await routeHome(req, res, pathname, home);
      }
      if (pathname === '/api/photos' || pathname.startsWith('/api/photos/')) {
        if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
        if (pathname === '/api/photos') return photos ? await apiCall(res, 'photos', 200, () => photos.load()) : sendJson(res, 200, { configured: false });
        const m = pathname.match(/^\/api\/photos\/([0-9A-Za-z-]+)\.jpg$/);
        if (!photos || !m) return sendJson(res, 404, { error: 'No such photo' });
        return await sendPhoto(res, photos, m[1]);
      }
      if (pathname === '/api/version') {
        if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
        return sendJson(res, 200, { build: await buildId(root) });
      }
      if (pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Not found' });
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Method not allowed' });
      return await serveStatic(req, res, pathname);
    } catch (e) {
      console.error('[server]', e);
      if (!res.headersSent) sendJson(res, 500, { error: 'Internal error' });
      else res.destroy();
    }
  };
}

// /api/chores, /api/chores/:id and /api/chores/:id/done.
async function routeChores(req, res, pathname, chores) {
  const m = pathname.match(/^\/api\/chores(?:\/([^/]+)(\/done)?)?$/);
  if (!m) return sendJson(res, 404, { error: 'Not found' });
  const [, id, done] = m;
  const allow = (...methods) => methods.includes(req.method);
  if (!id) {
    if (allow('GET')) return apiCall(res, 'chores', 200, () => chores.load());
    if (allow('POST')) return apiCall(res, 'add chore', 201, async () => chores.create(await readJson(req)));
  } else if (!done) {
    if (allow('PATCH')) return apiCall(res, 'edit chore', 200, async () => chores.update(id, await readJson(req)));
    if (allow('DELETE')) return apiCall(res, 'delete chore', 204, () => chores.remove(id));
  } else {
    if (allow('PUT')) return apiCall(res, 'tick chore', 204, () => chores.setDone(id, true));
    if (allow('DELETE')) return apiCall(res, 'untick chore', 204, () => chores.setDone(id, false));
  }
  return sendJson(res, 405, { error: 'Method not allowed' });
}

// An image from Home Assistant (camera snapshot, media art), never cached.
async function sendImage(res, what, fn) {
  let img;
  try {
    img = await fn();
  } catch (e) {
    if (e instanceof InputError) return sendJson(res, e.status, { error: e.message });
    console.error('[' + what + ']', e.message);
    return sendJson(res, 502, { error: e.message });
  }
  res.writeHead(200, { 'content-type': img.type, 'content-length': img.body.length, 'cache-control': 'no-store' });
  res.end(img.body);
}

// An album photo's preview image, streamed from Immich as it arrives. Only the content type and
// length are passed on. The browser may keep it for an hour (the frame shows the same photos again
// and again); the server keeps nothing.
async function sendPhoto(res, photos, id) {
  let upstream;
  try {
    upstream = await photos.image(id);
  } catch (e) {
    console.error('[photo]', e.message);
    return sendJson(res, 502, { error: e.message });
  }
  if (!upstream) return sendJson(res, 404, { error: 'No such photo' });
  const headers = { 'content-type': upstream.headers.get('content-type') || 'image/jpeg', 'cache-control': 'private, max-age=3600' };
  // fetch has already undone any content-encoding, so Immich's length only holds without one.
  const length = upstream.headers.get('content-length');
  if (length && !upstream.headers.get('content-encoding')) headers['content-length'] = length;
  res.writeHead(200, headers);
  const body = Readable.fromWeb(upstream.body);
  body.on('error', (e) => { console.error('[photo]', e.message); res.destroy(); });
  res.on('close', () => body.destroy()); // the frame gave up: stop reading from Immich
  body.pipe(res);
}

const ENTITY = /^[a-z_]+\.[a-z0-9_]+$/;

// /api/home, /api/home/:entityId, /api/home/rooms/:name/off, /api/home/cameras/:entityId.jpg and
// /api/home/media/:entityId/art.
async function routeHome(req, res, pathname, home) {
  const parts = pathname.split('/').slice(3);
  let seg;
  try {
    seg = parts.map(decodeURIComponent);
  } catch {
    return sendJson(res, 404, { error: 'Not found' });
  }
  const method = (m) => req.method === m;
  const notAllowed = () => sendJson(res, 405, { error: 'Method not allowed' });
  if (seg.length === 0) return method('GET') ? sendJson(res, 200, home.load()) : notAllowed();
  if (seg.length === 1 && ENTITY.test(seg[0])) {
    if (!method('POST')) return notAllowed();
    return apiCall(res, 'home action', 204, async () => home.act(seg[0], await readJson(req)));
  }
  if (seg.length === 3 && seg[0] === 'rooms' && seg[2] === 'off') {
    if (!method('POST')) return notAllowed();
    return apiCall(res, 'room off', 204, () => home.roomOff(seg[1]));
  }
  if (seg.length === 2 && seg[0] === 'cameras' && /\.jpg$/.test(seg[1]) && ENTITY.test(seg[1].slice(0, -4))) {
    if (!method('GET')) return notAllowed();
    return sendImage(res, 'camera', () => home.camera(seg[1].slice(0, -4)));
  }
  if (seg.length === 3 && seg[0] === 'media' && ENTITY.test(seg[1]) && seg[2] === 'art') {
    if (!method('GET')) return notAllowed();
    return sendImage(res, 'media art', () => home.mediaArt(seg[1]));
  }
  return sendJson(res, 404, { error: 'Not found' });
}

// config comes from loadConfig(), store from openStore() (without one, /api/chores answers 503);
// tokenUrl/apiBase/now/homeRetryMs/icsTimeoutMs/log are overridable for tests.
export async function startServer({ config, store, distDir, tokenUrl, apiBase, now = Date.now, homeRetryMs, icsTimeoutMs, log = console }) {
  const google = createGoogle({ serviceAccount: config.serviceAccount, tokenUrl, apiBase, now });
  const feeds = config.settings.calendars.filter((c) => c.ics !== undefined);
  const icsFeeds = feeds.length ? createIcsFeeds({ feeds, now, timeoutMs: icsTimeoutMs, log }) : null;
  const calendar = createCalendar({ settings: config.settings, google, icsFeeds, timeZone: config.timeZone, now });
  const ha = config.homeAssistant;
  const weather = ha ? createWeather({ ha: createHomeAssistant(ha), entity: ha.weatherEntity, now }) : null;
  const home = ha ? createHome({ url: ha.url, token: ha.token, label: ha.label, rooms: ha.rooms, people: config.settings.people, retryMs: homeRetryMs, now, log }) : null;
  // Chores must not depend on Google being up: until the Family zone has been read once, a failed
  // lookup falls back to this process's own zone for that request (not cached, so it retries).
  const choreZone = () => calendar.zone().catch((e) => {
    console.error(`chores: using the server's local time zone, could not read the Family calendar's: ${e.message}`);
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  });
  const im = config.immich;
  const photos = im ? createPhotos({ immich: createImmich(im), albumId: im.albumId, people: config.settings.people, now }) : null;
  const chores = store ? createChores({ db: store.db, settings: config.settings, now, today: async () => localDate(now(), await choreZone()) }) : null;
  const server = createServer(createHandler({ calendar, weather, chores, home, photos, distDir }));
  await new Promise((ok, fail) => {
    server.once('error', (e) => { if (home) home.close(); fail(e); });
    server.listen(config.port, () => { server.off('error', fail); ok(); });
  });
  return {
    server,
    url: 'http://127.0.0.1:' + server.address().port,
    close: () => new Promise((ok) => { if (home) home.close(); server.closeAllConnections(); server.close(ok); }),
  };
}
