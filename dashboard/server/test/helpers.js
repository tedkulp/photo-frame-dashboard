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
// { status, body } to make that calendar fail. Records every request in `requests`.
export async function fakeGoogle(calendars) {
  const requests = [];
  let tokensIssued = 0;
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

    const m = url.pathname.match(/^\/calendar\/v3\/calendars\/([^/]+)\/events$/);
    if (m) {
      if (!/^Bearer token-\d+$/.test(req.headers.authorization || '')) return send(401, { error: { code: 401, message: 'no token' } });
      const cal = calendars[decodeURIComponent(m[1])];
      if (!cal) return send(404, { error: { code: 404, message: 'Not Found' } });
      if (cal.status) return send(cal.status, cal.body || { error: { code: cal.status, message: 'boom' } });
      const page = Number(url.searchParams.get('pageToken') || 0);
      const pages = cal.pages || [[]];
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
