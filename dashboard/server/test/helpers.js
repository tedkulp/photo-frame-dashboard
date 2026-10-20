// Shared fixtures for the server tests: a throwaway service-account key, sample settings, a temp
// config folder, and a fake Google (OAuth token + Calendar events endpoints) on a local port.
import { generateKeyPairSync, createPublicKey, verify } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' });

export function serviceAccount(extra) {
  return Object.assign(
    { type: 'service_account', client_email: 'frame@example-project.iam.gserviceaccount.com', private_key: PEM },
    extra || {},
  );
}

export function settings(extra) {
  return Object.assign(
    {
      people: [
        { id: 'alex', name: 'Alex', colour: '#2D5BFF' },
        { id: 'sam', name: 'Sam', colour: '#E4007C' },
      ],
      calendars: [
        { calendarId: 'family@group.calendar.google.com', person: 'family' },
        { calendarId: 'alex@example.com', person: 'alex' },
        { calendarId: 'sam@example.com', person: 'sam' },
      ],
    },
    extra || {},
  );
}

// A temp directory to act as the server's working directory. `files` maps relative paths to
// contents (objects are written as JSON).
export function tempDir(files) {
  const dir = mkdtempSync(join(tmpdir(), 'pfd-server-'));
  for (const [rel, body] of Object.entries(files || {})) {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, typeof body === 'string' ? body : JSON.stringify(body));
  }
  return { dir, path: (rel) => join(dir, rel), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// Fake Google. `calendars` maps calendarId -> { timeZone, pages: [[item, ...], ...] } or
// { status, body } to make that calendar fail. Inserted events are added to the first page (so a
// later list returns them) and deleted ones removed from every page. Records every request in
// `requests`.
export async function fakeGoogle(calendars) {
  const requests = [];
  let tokensIssued = 0, eventsInserted = 0;
  const deleted = new Set();
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: req.headers, body });
    const send = (status, obj) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(obj));
    };

    if (url.pathname === '/token') {
      const form = new URLSearchParams(body);
      if (form.get('grant_type') !== 'urn:ietf:params:oauth:grant-type:jwt-bearer') return send(400, { error: 'unsupported_grant_type' });
      const [h, c, s] = form.get('assertion').split('.');
      const ok = verify('RSA-SHA256', Buffer.from(h + '.' + c), createPublicKey(PEM), Buffer.from(s, 'base64url'));
      if (!ok) return send(400, { error: 'invalid_grant' });
      tokensIssued++;
      return send(200, { access_token: 'token-' + tokensIssued, expires_in: 3600, token_type: 'Bearer' });
    }

    const m = url.pathname.match(/^\/calendar\/v3\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/);
    if (m) {
      if (!/^Bearer token-\d+$/.test(req.headers.authorization || '')) return send(401, { error: { code: 401, message: 'no token' } });
      const cal = calendars[decodeURIComponent(m[1])];
      if (!cal) return send(404, { error: { code: 404, message: 'Not Found' } });
      if (cal.status) return send(cal.status, cal.body || { error: { code: cal.status, message: 'boom' } });
      cal.pages = cal.pages || [[]];
      if (req.method === 'POST' && !m[2]) {
        const item = Object.assign({ id: 'new' + ++eventsInserted, status: 'confirmed' }, JSON.parse(body));
        item.iCalUID = item.id + '@google.com';
        cal.pages[0].push(item);
        return send(200, item);
      }
      if (req.method === 'DELETE' && m[2]) {
        const id = decodeURIComponent(m[2]);
        const page = cal.pages.find((p) => p.some((i) => i.id === id));
        if (deleted.has(id)) return send(410, { error: { code: 410, message: 'Resource has been deleted' } });
        if (!page) return send(404, { error: { code: 404, message: 'Not Found' } });
        page.splice(page.findIndex((i) => i.id === id), 1);
        deleted.add(id);
        res.writeHead(204);
        return res.end();
      }
      if (req.method !== 'GET' || m[2]) return send(405, { error: { code: 405, message: 'Method not allowed' } });
      const page = Number(url.searchParams.get('pageToken') || 0);
      const pages = cal.pages;
      const out = { kind: 'calendar#events', timeZone: cal.timeZone || 'America/Toronto', items: pages[page] || [] };
      if (page + 1 < pages.length) out.nextPageToken = String(page + 1);
      return send(200, out);
    }
    send(404, { error: { code: 404, message: 'Not Found' } });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  return {
    tokenUrl: base + '/token',
    apiBase: base + '/calendar/v3',
    requests,
    get tokensIssued() { return tokensIssued; },
    close: () => new Promise((r) => server.close(r)),
  };
}

// Fake Home Assistant. `entities` maps entity id -> { state, attributes, hourly: [...], daily: [...] }
// or { status, body } to make every call for that entity fail. Only `token` is accepted. Records
// every request in `requests`.
export async function fakeHomeAssistant(entities, { token = 'ha-token' } = {}) {
  const requests = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push({ method: req.method, path: url.pathname, search: url.search, headers: req.headers, body });
    const send = (status, obj) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    if (req.headers.authorization !== 'Bearer ' + token) return send(401, { message: 'Invalid access token' });

    const st = url.pathname.match(/^\/api\/states\/([^/]+)$/);
    if (st && req.method === 'GET') {
      const id = decodeURIComponent(st[1]);
      const e = entities[id];
      if (!e) return send(404, { message: 'Entity not found.' });
      if (e.status) return send(e.status, e.body || { message: 'boom' });
      return send(200, { entity_id: id, state: e.state, attributes: e.attributes, last_updated: '2026-10-19T11:55:00+00:00' });
    }
    if (url.pathname === '/api/services/weather/get_forecasts' && req.method === 'POST') {
      if (url.search !== '?return_response') return send(400, { message: 'Service call requires responses but caller did not ask for responses' });
      const { entity_id: id, type } = JSON.parse(body);
      const e = entities[id];
      if (!e) return send(400, { message: 'Referenced entities ' + id + ' are missing or not currently available' });
      if (e.status) return send(e.status, e.body || { message: 'boom' });
      return send(200, { changed_states: [], service_response: { [id]: { forecast: e[type] || [] } } });
    }
    send(404, { message: 'Not Found' });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: 'http://127.0.0.1:' + server.address().port,
    token,
    requests,
    close: () => new Promise((r) => server.close(r)),
  };
}
