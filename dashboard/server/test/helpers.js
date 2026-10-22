// Shared fixtures for the server tests: a throwaway service-account key, sample settings, a temp
// config folder, and a fake Google (OAuth token + Calendar events endpoints) on a local port, plus
// fake ICS links, Home Assistant and Immich.
import { generateKeyPairSync, createHash, createPublicKey, verify } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

// The fixture .ics files in test/fixtures (synthetic, no real calendars). Outlook writes CRLF.
export function icsFixture(name) {
  const text = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', name), 'utf8');
  return name.startsWith('outlook') ? text.replace(/\r?\n/g, '\r\n') : text;
}

// Fake ICS links. `feeds` maps a path name -> { body } (the .ics text), { status } to fail, or
// { hang: true } to never answer. Entries can be changed between requests. `url(name)` is that
// feed's link; `requests` lists the names fetched, in order.
export async function fakeIcs(feeds) {
  const requests = [];
  const server = createServer((req, res) => {
    const name = decodeURIComponent(new URL(req.url, 'http://x').pathname.slice(1));
    requests.push(name);
    const f = feeds[name];
    if (!f) { res.writeHead(404); return res.end('Not found'); }
    if (f.hang) return;
    if (f.status) { res.writeHead(f.status); return res.end('boom'); }
    res.writeHead(200, { 'content-type': 'text/calendar; charset=utf-8' });
    res.end(f.body);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port + '/';
  return {
    url: (name) => base + encodeURIComponent(name),
    requests,
    close: () => new Promise((r) => { server.closeAllConnections(); server.close(r); }),
  };
}

// Server side of a websocket for the fake: the handshake, masked text frames in, unmasked out.
// Close frames are answered and end the socket; pings and fragments aren't needed by the client.
function acceptWebSocket(req, socket, onMessage) {
  const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  socket.on('error', () => {});
  let buf = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 2) {
      const op = buf[0] & 0x0f;
      let len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      const mask = buf[1] & 0x80 ? buf.subarray(off, off + 4) : null;
      if (mask) off += 4;
      if (buf.length < off + len) return;
      const payload = Buffer.from(buf.subarray(off, off + len));
      if (mask) for (let i = 0; i < len; i++) payload[i] ^= mask[i % 4];
      buf = buf.subarray(off + len);
      if (op === 8) return socket.end(Buffer.from([0x88, 0]));
      if (op === 1) onMessage(JSON.parse(payload.toString('utf8')));
    }
  });
  return (obj) => {
    const data = Buffer.from(JSON.stringify(obj));
    let head;
    if (data.length < 126) head = Buffer.from([0x81, data.length]);
    else if (data.length < 65536) { head = Buffer.from([0x81, 126, 0, 0]); head.writeUInt16BE(data.length, 2); }
    else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 127; head.writeBigUInt64BE(BigInt(data.length), 2); }
    if (!socket.destroyed) socket.write(Buffer.concat([head, data]));
  };
}

// Fake Home Assistant. `entities` maps entity id -> { state, attributes, hourly: [...], daily: [...] }
// or { status, body } to make every REST call for that entity fail. Only `token` is accepted.
// Records every REST request in `requests`.
//
// `home` is the websocket side (/api/websocket): { unit, labels, areas, devices, entities (the
// entity registry), states: { entity_id: { state, attributes } }, failService(call) → message or
// null }. `calls` records call_service messages; `push(id, state)` changes a state and sends
// state_changed; `fire(type)` sends a registry-updated event; `drop()` cuts every socket;
// `connections` counts accepted sockets. /api/camera_proxy/:id and entity_picture paths
// (/api/media_player_proxy/…) answer with `picture` bytes for entities in `home.states`.
export async function fakeHomeAssistant(entities, { token = 'ha-token', home = {} } = {}) {
  const requests = [];
  const calls = [];
  const sockets = new Set();
  const subscribers = [];
  let connections = 0;
  home = Object.assign({ unit: '°F', labels: [], areas: [], devices: [], entities: [], states: {} }, home);
  const stamp = () => new Date().toISOString();
  const stateObj = (id) => Object.assign({ entity_id: id, last_updated: home.states[id].last_updated || '2026-10-19T11:55:00+00:00' }, home.states[id]);

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

    const pic = url.pathname.match(/^\/api\/(camera_proxy|media_player_proxy)\/([^/]+)$/);
    if (pic && req.method === 'GET') {
      if (!home.states[decodeURIComponent(pic[2])]) return send(404, { message: 'Entity not found' });
      res.writeHead(200, { 'content-type': 'image/jpeg' });
      return res.end(Buffer.from('jpeg:' + decodeURIComponent(pic[2])));
    }
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

  server.on('upgrade', (req, socket) => {
    if (new URL(req.url, 'http://x').pathname !== '/api/websocket') return socket.destroy();
    connections++;
    sockets.add(socket);
    socket.on('close', () => {
      sockets.delete(socket);
      for (let i = subscribers.length - 1; i >= 0; i--) if (subscribers[i].socket === socket) subscribers.splice(i, 1);
    });
    let authed = false;
    const send = acceptWebSocket(req, socket, (msg) => {
      if (!authed) {
        if (msg.type !== 'auth') return;
        if (msg.access_token !== token) {
          send({ type: 'auth_invalid', message: 'Invalid access token or password' });
          return socket.end();
        }
        authed = true;
        return send({ type: 'auth_ok', ha_version: '2026.10.0' });
      }
      const ok = (result) => send({ id: msg.id, type: 'result', success: true, result });
      const fail = (code, message) => send({ id: msg.id, type: 'result', success: false, error: { code, message } });
      switch (msg.type) {
        case 'get_config': return ok({ unit_system: { temperature: home.unit } });
        case 'get_states': return ok(Object.keys(home.states).map(stateObj));
        case 'config/label_registry/list': return ok(home.labels);
        case 'config/area_registry/list': return ok(home.areas);
        case 'config/device_registry/list': return ok(home.devices);
        case 'config/entity_registry/list': return ok(home.entities);
        case 'subscribe_events':
          subscribers.push({ socket, send, id: msg.id, eventType: msg.event_type });
          return ok(null);
        case 'call_service': {
          calls.push({ domain: msg.domain, service: msg.service, service_data: msg.service_data, target: msg.target });
          const err = home.failService && home.failService(msg);
          return err ? fail('home_assistant_error', err) : ok({ context: { id: 'ctx' } });
        }
        default: return fail('unknown_command', 'Unknown command.');
      }
    });
    send({ type: 'auth_required', ha_version: '2026.10.0' });
  });

  const emit = (eventType, data) => {
    for (const s of subscribers) {
      if (s.eventType === eventType) s.send({ id: s.id, type: 'event', event: { event_type: eventType, data, time_fired: stamp() } });
    }
  };

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: 'http://127.0.0.1:' + server.address().port,
    token,
    requests,
    calls,
    home,
    get connections() { return connections; },
    push(id, state) {
      const old = home.states[id] ? stateObj(id) : null;
      if (state) home.states[id] = Object.assign({ last_updated: stamp() }, state);
      else delete home.states[id];
      emit('state_changed', { entity_id: id, old_state: old, new_state: state ? stateObj(id) : null });
    },
    fire: (type) => emit(type, { action: 'update' }),
    drop() { for (const s of sockets) s.destroy(); },
    close: () => new Promise((r) => { for (const s of sockets) s.destroy(); server.close(r); }),
  };
}

// Fake Immich. `album` is the album's GET body ({ id, albumName, albumUsers: [{ user: { id, email },
// role }] }); `assets` its assets (AssetResponseDto with exifInfo), returned by POST
// /api/search/metadata for that album id, `pageSize` at a time (Immich's nextPage paging). Asset
// thumbnails answer with 'jpeg:<id>' bytes. GET /api/users answers `users`, or 403 (no user.read)
// without them. Only `apiKey` (x-api-key) is accepted. Set `fail` to an HTTP status to make every
// call fail, or `failSearch` to fail only the album search. Records every request in `requests`.
export async function fakeImmich({ album, assets = [], users, apiKey = 'immich-key', pageSize = 1000 } = {}) {
  const requests = [];
  const state = { fail: null, failSearch: null };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push({ method: req.method, path: url.pathname, search: url.search, headers: req.headers, body });
    const send = (status, obj) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    if (state.fail) return send(state.fail, { message: 'Immich is down', statusCode: state.fail });
    if (req.headers['x-api-key'] !== apiKey) return send(401, { message: 'Invalid API key', statusCode: 401 });

    const al = url.pathname.match(/^\/api\/albums\/([^/]+)$/);
    if (al && req.method === 'GET') {
      if (!album || decodeURIComponent(al[1]) !== album.id) return send(400, { message: 'Not found or no album.read access', statusCode: 400 });
      return send(200, album);
    }
    if (url.pathname === '/api/users' && req.method === 'GET') {
      return users ? send(200, users) : send(403, { message: 'Missing required permission: user.read', statusCode: 403 });
    }
    if (url.pathname === '/api/search/metadata' && req.method === 'POST') {
      if (state.failSearch) return send(state.failSearch, { message: 'search failed', statusCode: state.failSearch });
      const q = JSON.parse(body);
      const items = album && Array.isArray(q.albumIds) && q.albumIds.includes(album.id) ? assets : [];
      const size = Math.min(q.size || 250, pageSize), page = q.page || 1;
      const slice = items.slice((page - 1) * size, page * size);
      const next = page * size < items.length ? String(page + 1) : null;
      return send(200, { albums: { total: 0, count: 0, items: [], facets: [] }, assets: { total: slice.length, count: slice.length, items: slice, facets: [], nextPage: next } });
    }
    const th = url.pathname.match(/^\/api\/assets\/([^/]+)\/thumbnail$/);
    if (th && req.method === 'GET') {
      const id = decodeURIComponent(th[1]);
      if (!assets.some((a) => a.id === id)) return send(400, { message: 'Not found or no asset.view access', statusCode: 400 });
      res.writeHead(200, { 'content-type': 'image/jpeg', 'x-immich-secret': apiKey });
      return res.end(Buffer.from('jpeg:' + id + ':' + url.searchParams.get('size')));
    }
    send(404, { message: 'Cannot ' + req.method + ' ' + url.pathname, statusCode: 404 });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: 'http://127.0.0.1:' + server.address().port,
    apiKey,
    requests,
    set fail(status) { state.fail = status; },
    set failSearch(status) { state.failSearch = status; },
    close: () => new Promise((r) => { server.closeAllConnections(); server.close(r); }),
  };
}
