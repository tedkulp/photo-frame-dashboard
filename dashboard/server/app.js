// HTTP server: the built dashboard (dist) and GET /api/calendar from one origin. LAN-only, no auth.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { createGoogle } from './google.js';
import { createCalendar } from './calendar.js';

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
        try {
          return sendJson(res, 200, await calendar.load());
        } catch (e) {
          console.error('[calendar]', e.message);
          return sendJson(res, 502, { error: e.message });
        }
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
