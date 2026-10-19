// HTTP server: the built dashboard (dist), GET /api/calendar, POST /api/events and
// DELETE /api/events/:id from one origin. LAN-only, no auth.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { createGoogle } from './google.js';
import { createCalendar, InputError } from './calendar.js';

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
  if (!/^application\/json\s*(;|$)/i.test(req.headers['content-type'] || '')) throw new InputError(415, 'Send the event as application/json');
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (text.length > BODY_MAX) throw new InputError(413, 'Request body is too large');
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new InputError(400, 'Request body is not valid JSON');
  }
}

// Runs a calendar call: InputError → its status, anything else (Google) → 502.
async function calendarCall(res, what, status, fn) {
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

function createHandler({ calendar, distDir }) {
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
        return await calendarCall(res, 'calendar', 200, () => calendar.load());
      }
      if (pathname === '/api/events') {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
        return await calendarCall(res, 'add event', 201, async () => calendar.create(await readJson(req)));
      }
      if (pathname.startsWith('/api/events/')) {
        if (req.method !== 'DELETE') return sendJson(res, 405, { error: 'Method not allowed' });
        let id;
        try {
          id = decodeURIComponent(pathname.slice('/api/events/'.length));
        } catch {
          return sendJson(res, 404, { error: 'No such event' });
        }
        return await calendarCall(res, 'delete event', 204, () => calendar.remove(id));
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

// config comes from loadConfig(); tokenUrl/apiBase/now are overridable for tests.
export async function startServer({ config, distDir, tokenUrl, apiBase, now = Date.now }) {
  const google = createGoogle({ serviceAccount: config.serviceAccount, tokenUrl, apiBase, now });
  const calendar = createCalendar({ settings: config.settings, google, timeZone: config.timeZone, now });
  const server = createServer(createHandler({ calendar, distDir }));
  await new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(config.port, () => { server.off('error', fail); ok(); });
  });
  return {
    server,
    url: 'http://127.0.0.1:' + server.address().port,
    close: () => new Promise((ok) => { server.closeAllConnections(); server.close(ok); }),
  };
}
