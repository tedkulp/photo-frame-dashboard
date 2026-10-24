// The home server's shared HTTP mechanics (HttpError is re-exported from errors.js): JSON bodies and answers,
// the one error → status map, the one image responder, and the request handler that runs the
// route modules (routes/*.js) and then serves GET /api/version and the built dashboard (dist).
// What each feature mounts and its method checks live in its route module; an optional feature that
// isn't set up answers with notSetUp.
import { readFile, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { extname, join, resolve, sep } from 'node:path';
import { HttpError } from './errors.js';

export { HttpError };

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

export function sendJson(res, status, obj) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}

export const notAllowed = (res) => sendJson(res, 405, { error: 'Method not allowed' });

// The one answer of an optional feature that isn't set up: GET on its top-level path (`top`) is 200
// { configured: false }, which the dashboard reads; anything else (any method, any sub-path) is 404
// { error } (e.g. 'Photos are not set up'; the feed shows a 4xx's error text).
export function notSetUp(req, res, pathname, top, error) {
  if (pathname === top && req.method === 'GET') return sendJson(res, 200, { configured: false });
  return sendJson(res, 404, { error });
}

const BODY_MAX = 64 * 1024;

// The request's JSON body. Only application/json is accepted: another web page can post a plain
// form or text/plain to this LAN server without asking, but not JSON.
export async function readJson(req) {
  if (!/^application\/json\s*(;|$)/i.test(req.headers['content-type'] || '')) throw new HttpError(415, 'Send the body as application/json');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > BODY_MAX) throw new HttpError(413, 'Request body is too large');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Request body is not valid JSON');
  }
}

// The one place a thrown error becomes a status: HttpError → its status, anything else (Google,
// Home Assistant, Immich) → 502, logged under `what`.
export function sendError(res, what, e) {
  if (e instanceof HttpError) return sendJson(res, e.status, { error: e.message });
  console.error('[' + what + ']', e.message);
  return sendJson(res, 502, { error: e.message });
}

// Runs an API call and answers with its result as JSON, or an empty body when it returns nothing.
export async function apiCall(res, what, status, fn) {
  try {
    const out = await fn();
    if (out === undefined) {
      res.writeHead(status, { 'cache-control': 'no-store' });
      return res.end();
    }
    return sendJson(res, status, out);
  } catch (e) {
    return sendError(res, what, e);
  }
}

// Answers with an image: fn → { type, length?, body } where body is a Buffer or a web stream, which
// is piped as it arrives (and dropped if the client goes away). `cache` is the cache-control.
export async function sendImage(res, what, fn, cache) {
  let img;
  try {
    img = await fn();
  } catch (e) {
    return sendError(res, what, e);
  }
  const headers = { 'content-type': img.type };
  if (Buffer.isBuffer(img.body)) headers['content-length'] = img.body.length;
  else if (img.length) headers['content-length'] = img.length;
  headers['cache-control'] = cache;
  res.writeHead(200, headers);
  if (Buffer.isBuffer(img.body)) return res.end(img.body);
  const body = Readable.fromWeb(img.body);
  body.on('error', (e) => { console.error('[' + what + ']', e.message); res.destroy(); });
  res.on('close', () => body.destroy()); // the client gave up: stop reading upstream
  body.pipe(res);
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

// routes: route modules, each { match(pathname), handle(req, res, pathname) }; the first match answers.
export function createHandler({ routes, distDir }) {
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
      const route = routes.find((r) => r.match(pathname));
      if (route) return await route.handle(req, res, pathname);
      if (pathname === '/api/version') {
        if (req.method !== 'GET') return notAllowed(res);
        return sendJson(res, 200, { build: await buildId(root) });
      }
      if (pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Not found' });
      if (req.method !== 'GET' && req.method !== 'HEAD') return notAllowed(res);
      return await serveStatic(req, res, pathname);
    } catch (e) {
      console.error('[server]', e);
      if (!res.headersSent) sendJson(res, 500, { error: 'Internal error' });
      else res.destroy();
    }
  };
}
