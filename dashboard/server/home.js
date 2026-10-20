// Home controls from Home Assistant: the entities carrying the configured label (default "frame",
// see docs/adr/0003), kept live over one websocket subscription, served in the dashboard's shape,
// and a small allowlist of actions on those entities only. The token never leaves the server.
//
// GET /api/home shape (temperatures in whole °F, names are HA friendly names):
//   { configured: true, connected, updated (ISO time of the last registry/state update, or null),
//     rooms: [{ name, tiles: [tile] }],     // settings order, then A–Z, then "Other" (no area)
//     climate: { id, name, available, mode, modes, action, current, humidity, target, low, high } | null,
//     scenes: [{ id, name, icon }],          // scene.* and script.*, icon is HA's mdi:… or null
//     cameras: [{ id, name, available }],    // snapshot at /api/home/cameras/:id.jpg
//     media: [{ id, name, available, state, title, artist, hasArt }],  // art at /api/home/media/:id/art
//     presence: { [personId]: 'home' | 'away' } }  // linked people HA knows about (see mapPresence)
//   tile: { id, kind: light|switch|fan|lock|toggle, name, available, ... }
//     light: on, dimmable, level (1–100, null when off, not dimmable or on at brightness 0)
//     switch, fan, toggle (input_boolean): on
//     lock: locked, state (HA's: locked, unlocked, locking, unlocking, jammed, open)
import { InputError } from './calendar.js';
import { createSocket, NotConnectedError } from './hasocket.js';
import { HomeAssistantError } from './homeassistant.js';

export const DOMAINS = ['light', 'switch', 'input_boolean', 'fan', 'lock', 'climate', 'scene', 'script', 'camera', 'media_player'];
const TILE_KINDS = { light: 'light', switch: 'switch', fan: 'fan', lock: 'lock', input_boolean: 'toggle' };
// Climate modes the frame offers, in its order (heat_cool is shown as Auto).
const CLIMATE_MODES = ['heat', 'cool', 'heat_cool', 'off'];
// Domains a room's "All off" turns off.
const ROOM_OFF = ['light', 'switch', 'fan'];
export const OTHER_ROOM = 'Other';
const REGISTRY_EVENTS = ['label_registry_updated', 'area_registry_updated', 'device_registry_updated', 'entity_registry_updated'];

// Room names compare ignoring case, surrounding space and curly vs straight apostrophes.
export const roomKey = (s) => String(s).trim().toLowerCase().replace(/[‘’]/g, "'");

const isNum = (v) => typeof v === 'number' && isFinite(v);
const byName = (a, b) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// HA temperature unit → converters to and from whole °F (null for anything that isn't a number).
function units(unit) {
  if (unit === '°C') {
    return { toF: (v) => (isNum(v) ? Math.round(v * 9 / 5 + 32) : null), fromF: (f) => Math.round((f - 32) * 5 / 9 * 2) / 2 };
  }
  return { toF: (v) => (isNum(v) ? Math.round(v) : null), fromF: (f) => f };
}

// The registries → Map entity_id → { id, domain, room } of labelled, enabled entities in supported
// domains. `label` matches a label id, else a label name ignoring case. room is the entity's area,
// else its device's, as the area's name; null when neither has one.
export function selectEntities({ labels, areas, devices, entities }, label) {
  const out = new Map();
  const want = String(label).toLowerCase();
  const found = labels.find((l) => l.label_id === label) || labels.find((l) => String(l.name).toLowerCase() === want);
  if (!found) return out;
  const areaName = new Map(areas.map((a) => [a.area_id, a.name]));
  const deviceArea = new Map(devices.map((d) => [d.id, d.area_id]));
  for (const e of entities) {
    if (!e || typeof e.entity_id !== 'string' || e.disabled_by) continue;
    if (!Array.isArray(e.labels) || !e.labels.includes(found.label_id)) continue;
    const domain = e.entity_id.split('.')[0];
    if (!DOMAINS.includes(domain)) continue;
    const areaId = e.area_id || (e.device_id && deviceArea.get(e.device_id)) || null;
    out.set(e.entity_id, { id: e.entity_id, domain, room: (areaId && areaName.get(areaId)) || null });
  }
  return out;
}

function available(st) {
  return !!st && st.state !== 'unavailable';
}

function tile(sel, st) {
  const a = (st && st.attributes) || {};
  const t = { id: sel.id, kind: TILE_KINDS[sel.domain], name: a.friendly_name || sel.id, available: available(st) };
  const on = !!st && st.state === 'on';
  if (t.kind === 'light') {
    const modes = Array.isArray(a.supported_color_modes) ? a.supported_color_modes : [];
    t.on = on;
    t.dimmable = modes.some((m) => m !== 'onoff');
    t.level = on && t.dimmable && isNum(a.brightness) && a.brightness > 0 ? Math.max(1, Math.round(a.brightness * 100 / 255)) : null;
  } else if (t.kind === 'lock') {
    t.locked = !!st && st.state === 'locked';
    t.state = st ? st.state : 'unavailable';
  } else {
    t.on = on;
  }
  return t;
}

function climate(sel, st, u) {
  const a = (st && st.attributes) || {};
  const modes = Array.isArray(a.hvac_modes) ? CLIMATE_MODES.filter((m) => a.hvac_modes.includes(m)) : [];
  return {
    id: sel.id,
    name: a.friendly_name || sel.id,
    available: available(st),
    mode: available(st) ? st.state : null,
    modes,
    action: a.hvac_action || null,
    current: u.toF(a.current_temperature),
    humidity: isNum(a.current_humidity) ? Math.round(a.current_humidity) : null,
    target: u.toF(a.temperature),
    low: u.toF(a.target_temp_low),
    high: u.toF(a.target_temp_high),
  };
}

// Pure: selected entities (from selectEntities) + states (Map entity_id → HA state object) →
// { rooms, climate, scenes, cameras, media }. `rooms` is the settings' room order; `unit` HA's
// temperature unit. With several labelled climate entities the first by entity id is used.
export function mapHome({ selected, states, unit, rooms = [] }) {
  const u = units(unit);
  const order = rooms.map(roomKey);
  const byRoom = new Map();
  const out = { rooms: [], climate: null, scenes: [], cameras: [], media: [] };
  const climates = [];
  for (const sel of selected.values()) {
    const st = states.get(sel.id);
    const a = (st && st.attributes) || {};
    const name = a.friendly_name || sel.id;
    if (TILE_KINDS[sel.domain]) {
      const room = sel.room || OTHER_ROOM;
      const key = sel.room ? roomKey(sel.room) : null;
      if (!byRoom.has(key)) byRoom.set(key, { name: room, tiles: [] });
      byRoom.get(key).tiles.push(tile(sel, st));
    } else if (sel.domain === 'climate') {
      climates.push(sel);
    } else if (sel.domain === 'scene' || sel.domain === 'script') {
      out.scenes.push({ id: sel.id, name, icon: a.icon || null });
    } else if (sel.domain === 'camera') {
      out.cameras.push({ id: sel.id, name, available: available(st) });
    } else if (sel.domain === 'media_player') {
      out.media.push({
        id: sel.id, name, available: available(st), state: st ? st.state : 'unavailable',
        title: a.media_title || null, artist: a.media_artist || a.media_album_artist || null, hasArt: !!a.entity_picture,
      });
    }
  }
  const rank = (key) => {
    if (key === null) return Infinity;
    const i = order.indexOf(key);
    return i === -1 ? order.length : i;
  };
  out.rooms = [...byRoom.entries()]
    .sort(([ka, a], [kb, b]) => rank(ka) - rank(kb) || a.name.localeCompare(b.name))
    .map(([, r]) => ({ name: r.name, tiles: r.tiles.sort(byName) }));
  climates.sort((a, b) => (a.id < b.id ? -1 : 1));
  if (climates.length) out.climate = climate(climates[0], states.get(climates[0].id), u);
  out.scenes.sort(byName);
  out.cameras.sort(byName);
  out.media.sort(byName);
  return out;
}

// Pure: people ([{ id, homeAssistant? }]) + states → { [personId]: 'home' | 'away' }. A person's
// person.* entity in `home` is home, in any other known state (not_home, a zone) away; unlinked
// people and entities missing, unknown or unavailable are left out. Person entities are never
// Home controls tiles or service-call targets (person isn't in DOMAINS).
export function mapPresence(people, states) {
  const out = {};
  for (const p of people) {
    const st = p.homeAssistant && states.get(p.homeAssistant);
    if (!st || typeof st.state !== 'string' || st.state === 'unknown' || st.state === 'unavailable') continue;
    out[p.id] = st.state === 'home' ? 'home' : 'away';
  }
  return out;
}

// { action, value? } for an entity → the service call, or an InputError(400). The allowlist.
export function serviceCall(sel, body, st, unit) {
  const bad = (msg) => new InputError(400, msg);
  if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.action !== 'string') throw bad('Send { action, value? }');
  const { action, value } = body;
  const d = sel.domain;
  const call = (domain, service, data) => ({ domain, service, service_data: data || {}, target: { entity_id: sel.id } });
  const a = (st && st.attributes) || {};
  const u = units(unit);
  const temp = (v, what) => {
    if (!isNum(v)) throw bad(`${what} must be a number of °F`);
    if (isNum(a.min_temp) && v < u.toF(a.min_temp)) throw bad(`${what} ${v}°F is below the minimum ${u.toF(a.min_temp)}°F`);
    if (isNum(a.max_temp) && v > u.toF(a.max_temp)) throw bad(`${what} ${v}°F is above the maximum ${u.toF(a.max_temp)}°F`);
    return u.fromF(v);
  };

  if (d === 'light') {
    if (action === 'on' || action === 'off') return call('light', 'turn_' + action);
    if (action === 'level') {
      if (!Number.isInteger(value) || value < 0 || value > 100) throw bad('level must be a whole number from 0 to 100');
      return call('light', 'turn_on', { brightness_pct: value });
    }
  } else if (d === 'switch' || d === 'input_boolean' || d === 'fan') {
    if (action === 'on' || action === 'off') return call(d, 'turn_' + action);
  } else if (d === 'lock') {
    if (action === 'lock' || action === 'unlock') return call('lock', action);
  } else if (d === 'climate') {
    if (action === 'mode') {
      const modes = Array.isArray(a.hvac_modes) ? CLIMATE_MODES.filter((m) => a.hvac_modes.includes(m)) : [];
      if (!modes.includes(value)) throw bad(`mode must be one of: ${modes.join(', ') || '(none available)'}`);
      return call('climate', 'set_hvac_mode', { hvac_mode: value });
    }
    if (action === 'target') return call('climate', 'set_temperature', { temperature: temp(value, 'target') });
    if (action === 'range') {
      if (!value || typeof value !== 'object') throw bad('range needs { low, high } in °F');
      const low = temp(value.low, 'low'), high = temp(value.high, 'high');
      if (!(value.low < value.high)) throw bad('low must be below high');
      return call('climate', 'set_temperature', { target_temp_low: low, target_temp_high: high });
    }
  } else if (d === 'scene' || d === 'script') {
    if (action === 'run') return call(d, 'turn_on');
  } else if (d === 'media_player') {
    if (action === 'play' || action === 'pause') return call('media_player', 'media_' + action);
  }
  throw bad(`"${action}" is not an action for ${d}`);
}

// settings.homeAssistant (+ token) → the live Home controls, plus presence for `people` (settings
// people, linked by homeAssistant). retryMs is the first reconnect delay.
export function createHome({ url, token, label = 'frame', rooms = [], people = [], retryMs, now = Date.now, log = console }) {
  const linked = new Set(people.map((p) => p.homeAssistant).filter(Boolean));
  let registries = null, selected = new Map(), states = new Map(), unit = '°F', updated = null;
  let loading = false, buffered = [], registryReload = null, registryAgain = false;

  const touch = () => { updated = new Date(now()).toISOString(); };

  // A newer state (by last_updated) replaces an older one; null new_state removes the entity.
  function applyState(id, st) {
    if (!st) return states.delete(id);
    const old = states.get(id);
    if (old && old.last_updated && st.last_updated && Date.parse(st.last_updated) < Date.parse(old.last_updated)) return;
    states.set(id, st);
  }

  async function readRegistries(command) {
    const [labels, areas, devices, entities] = await Promise.all([
      command({ type: 'config/label_registry/list' }),
      command({ type: 'config/area_registry/list' }),
      command({ type: 'config/device_registry/list' }),
      command({ type: 'config/entity_registry/list' }),
    ]);
    registries = { labels, areas, devices, entities };
    selected = selectEntities(registries, label);
    return registries;
  }

  function warnSetup() {
    const want = String(label).toLowerCase();
    if (!registries.labels.some((l) => l.label_id === label || String(l.name).toLowerCase() === want)) {
      log.warn(`Home Assistant has no label "${label}"; Home controls will be empty until entities are tagged with it`);
    }
    const areaKeys = new Set(registries.areas.map((a) => roomKey(a.name)));
    for (const r of rooms) {
      if (!areaKeys.has(roomKey(r))) log.warn(`settings.homeAssistant.rooms lists "${r}", which is not a Home Assistant area`);
    }
  }

  async function onOpen(command) {
    loading = true;
    buffered = [];
    try {
      for (const event_type of ['state_changed', ...REGISTRY_EVENTS]) await command({ type: 'subscribe_events', event_type });
      const [config, list] = await Promise.all([command({ type: 'get_config' }), command({ type: 'get_states' }), readRegistries(command)]);
      unit = (config && config.unit_system && config.unit_system.temperature) || '°F';
      states = new Map(list.map((s) => [s.entity_id, s]));
      for (const ev of buffered) onEvent(ev);
      touch();
      warnSetup();
      for (const id of linked) if (!states.has(id)) log.warn(`settings.people links ${id}, which Home Assistant doesn't have; that person shows no presence`);
      log.log(`Home Assistant connected: ${selected.size} entities labelled "${label}"`);
    } finally {
      loading = false;
      buffered = [];
    }
  }

  // Re-reads the registries after an *_registry_updated event; one more pass if another arrives meanwhile.
  function reloadRegistries() {
    if (registryReload) { registryAgain = true; return; }
    registryReload = readRegistries(socket.command)
      .then(() => { touch(); warnSetup(); })
      .catch((e) => log.warn(`Could not re-read Home Assistant registries: ${e.message}`))
      .finally(() => {
        registryReload = null;
        if (registryAgain) { registryAgain = false; reloadRegistries(); }
      });
  }

  function onEvent(ev) {
    if (loading) return buffered.push(ev);
    if (!ev) return;
    if (ev.event_type === 'state_changed' && ev.data) {
      applyState(ev.data.entity_id, ev.data.new_state);
      if (selected.has(ev.data.entity_id) || linked.has(ev.data.entity_id)) touch();
    } else if (REGISTRY_EVENTS.includes(ev.event_type)) {
      reloadRegistries();
    }
  }

  const socket = createSocket({ url, token, onOpen, onEvent, retryMs, log });

  function find(entityId) {
    const sel = selected.get(entityId);
    if (!sel) throw new InputError(404, `${entityId} is not on the frame (no "${label}" label in Home Assistant)`);
    return sel;
  }

  async function callService(call) {
    try {
      await socket.command(Object.assign({ type: 'call_service' }, call));
    } catch (e) {
      if (e instanceof NotConnectedError) throw new InputError(503, 'Home Assistant is not connected');
      throw e;
    }
  }

  function requireConnected() {
    if (!socket.connected) throw new InputError(503, 'Home Assistant is not connected');
  }

  // Fetches an image from HA (path on HA, with the token) → { type, body }.
  async function image(path) {
    let res;
    try {
      res = await fetch(url + path, { headers: { authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(15 * 1000) });
    } catch (e) {
      throw new HomeAssistantError(`Home Assistant: ${e.message}`);
    }
    if (res.status === 404) throw new InputError(404, 'No picture');
    if (!res.ok) throw new HomeAssistantError(`Home Assistant ${path.split('?')[0]}: ${res.status}`);
    return { type: res.headers.get('content-type') || 'image/jpeg', body: Buffer.from(await res.arrayBuffer()) };
  }

  return {
    load() {
      return Object.assign({ configured: true, connected: socket.connected, updated }, mapHome({ selected, states, unit, rooms }),
        { presence: mapPresence(people, states) });
    },
    // POST /api/home/:entityId { action, value? }: resolves once HA has acknowledged the call.
    async act(entityId, body) {
      const sel = find(entityId);
      const call = serviceCall(sel, body, states.get(entityId), unit);
      requireConnected();
      await callService(call);
    },
    // A room's "All off": its available lights, switches and fans. `name` matches like settings rooms.
    async roomOff(name) {
      const key = roomKey(name);
      const ids = [...selected.values()].filter((s) => ROOM_OFF.includes(s.domain) && (s.room ? roomKey(s.room) === key : key === roomKey(OTHER_ROOM)));
      if (!ids.length) throw new InputError(404, `No room "${name}" with lights, switches or fans`);
      requireConnected();
      for (const domain of ROOM_OFF) {
        const entity_id = ids.filter((s) => s.domain === domain && available(states.get(s.id))).map((s) => s.id);
        if (entity_id.length) await callService({ domain, service: 'turn_off', service_data: {}, target: { entity_id } });
      }
    },
    camera(entityId) {
      const sel = find(entityId);
      if (sel.domain !== 'camera') throw new InputError(404, `${entityId} is not a camera`);
      return image('/api/camera_proxy/' + encodeURIComponent(entityId));
    },
    // Media art: the player's entity_picture, which HA serves (with its own token in the query).
    // Only paths on HA are fetched, so the token is never sent anywhere else.
    mediaArt(entityId) {
      const sel = find(entityId);
      if (sel.domain !== 'media_player') throw new InputError(404, `${entityId} is not a media player`);
      const st = states.get(entityId);
      const pic = st && st.attributes && st.attributes.entity_picture;
      if (typeof pic !== 'string' || !pic.startsWith('/')) throw new InputError(404, 'No picture');
      return image(pic);
    },
    close: () => socket.close(),
  };
}
