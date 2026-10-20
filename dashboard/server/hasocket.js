// Home Assistant websocket client (Node's global WebSocket, no deps): one connection authenticated
// with the long-lived token, commands matched to their results by id, and events handed to onEvent.
// After every (re)connect onOpen(command) runs (subscribe, read registries and states); the
// connection only counts as up once it resolves. Any drop or failed onOpen reconnects after a
// delay that doubles from retryMs up to maxRetryMs and resets once a connection is up.
import { HomeAssistantError } from './homeassistant.js';

export class NotConnectedError extends HomeAssistantError {}

export function createSocket({ url, token, onOpen, onEvent, onDown, retryMs = 1000, maxRetryMs = 60 * 1000, timeoutMs = 15 * 1000, log = console }) {
  const wsUrl = url.replace(/^http/, 'ws') + '/api/websocket';
  let ws = null, up = false, closed = false, nextId = 1, delay = retryMs, timer = null;
  const pending = new Map();

  function failPending(msg) {
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(new NotConnectedError(msg));
    }
    pending.clear();
  }

  // Sends { type, ... } on this connection and resolves with its result, or rejects with HA's error.
  function send(sock, msg) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new HomeAssistantError(`Home Assistant did not answer ${msg.type} within ${timeoutMs / 1000} s`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      try {
        sock.send(JSON.stringify(Object.assign({ id }, msg)));
      } catch (e) {
        clearTimeout(timer);
        pending.delete(id);
        reject(new NotConnectedError(`Home Assistant: ${e.message}`));
      }
    });
  }

  function retry() {
    if (closed || timer) return;
    timer = setTimeout(() => { timer = null; connect(); }, delay);
    delay = Math.min(delay * 2, maxRetryMs);
  }

  function connect() {
    if (closed) return;
    const sock = new WebSocket(wsUrl);
    ws = sock;
    let reason = '';
    sock.addEventListener('message', async (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.type === 'auth_required') {
        sock.send(JSON.stringify({ type: 'auth', access_token: token }));
      } else if (msg.type === 'auth_invalid') {
        reason = 'token refused: ' + (msg.message || 'auth_invalid');
        delay = maxRetryMs;
        sock.close();
      } else if (msg.type === 'auth_ok') {
        try {
          await onOpen((m) => send(sock, m));
          if (ws !== sock) return;
          up = true;
          delay = retryMs;
        } catch (e) {
          reason = e.message;
          sock.close();
        }
      } else if (msg.type === 'result') {
        const p = pending.get(msg.id);
        if (!p) return;
        pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.success) p.resolve(msg.result);
        else p.reject(new HomeAssistantError('Home Assistant: ' + ((msg.error && msg.error.message) || 'command failed')));
      } else if (msg.type === 'event') {
        onEvent(msg.event);
      }
    });
    sock.addEventListener('error', (ev) => {
      reason = reason || (ev.error && ev.error.message) || ev.message || 'connection error';
    });
    sock.addEventListener('close', () => {
      if (ws !== sock) return;
      const was = up;
      up = false;
      ws = null;
      failPending('Home Assistant connection closed');
      if (closed) return;
      log.warn(`Home Assistant websocket ${was ? 'dropped' : 'could not connect'}${reason ? ' (' + reason + ')' : ''}; retrying in ${Math.round(delay / 1000)} s`);
      if (onDown) onDown();
      retry();
    });
  }

  connect();

  return {
    get connected() { return up; },
    // Sends a command on the live connection; NotConnectedError while down.
    command(msg) {
      if (!up || !ws) return Promise.reject(new NotConnectedError('Home Assistant is not connected'));
      return send(ws, msg);
    },
    close() {
      closed = true;
      up = false;
      clearTimeout(timer);
      failPending('Home Assistant connection closed');
      if (ws) ws.close();
      ws = null;
    },
  };
}
