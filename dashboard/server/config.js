// Startup configuration: settings (people + calendars, optionally Home Assistant), the Google
// service-account key, the Home Assistant token, port, time zone and data dir (DASHBOARD_DATA_DIR,
// else data/; opened by store.js). Each item is read from an
// inline env var, else a path env var, else a default file under config/. Anything missing or
// invalid throws a ConfigError naming the item, so the server never starts serving an empty
// calendar. Home Assistant is optional: without settings.homeAssistant there is no weather. A
// person's optional homeAssistant names their person.* entity, for presence on /api/home.
import { createPrivateKey } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export class ConfigError extends Error {}

function readItem(env, cwd, what, inlineVar, pathVar, defaultFile) {
  if (env[inlineVar]) return { text: env[inlineVar], source: inlineVar };
  if (env[pathVar]) {
    const file = resolve(cwd, env[pathVar]);
    if (!existsSync(file)) throw new ConfigError(`${pathVar} points to ${file}, which does not exist`);
    return { text: readFileSync(file, 'utf8'), source: file };
  }
  const file = resolve(cwd, defaultFile);
  if (!existsSync(file)) {
    throw new ConfigError(`No ${what} found: set ${inlineVar} or ${pathVar}, or create ${defaultFile}`);
  }
  return { text: readFileSync(file, 'utf8'), source: file };
}

function readJsonItem(env, cwd, what, inlineVar, pathVar, defaultFile) {
  const { text, source } = readItem(env, cwd, what, inlineVar, pathVar, defaultFile);
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new ConfigError(`${what} from ${source} is not valid JSON: ${e.message}`);
  }
}

const isText = (v) => typeof v === 'string' && v.trim() !== '';

function checkSettings(s) {
  if (!s || typeof s !== 'object') throw new ConfigError('settings must be a JSON object');
  if (!Array.isArray(s.people) || s.people.length === 0) throw new ConfigError('settings.people must be a non-empty list');
  const ids = new Set();
  s.people.forEach((p, i) => {
    for (const key of ['id', 'name', 'colour']) {
      if (!p || !isText(p[key])) throw new ConfigError(`settings.people[${i}].${key} is missing`);
    }
    if (!/^#[0-9a-fA-F]{6}$/.test(p.colour)) throw new ConfigError(`settings.people[${i}].colour "${p.colour}" must be a 6-digit hex colour like #2D5BFF`);
    if (p.id === 'family') throw new ConfigError(`settings.people[${i}].id cannot be "family"`);
    if (ids.has(p.id)) throw new ConfigError(`settings.people[${i}].id "${p.id}" is used twice`);
    if (p.homeAssistant !== undefined && (typeof p.homeAssistant !== 'string' || !/^person\.[a-z0-9_]+$/.test(p.homeAssistant))) {
      throw new ConfigError(`settings.people[${i}].homeAssistant (${p.name}) "${p.homeAssistant}" must be a Home Assistant person entity id like person.${p.id.toLowerCase().replace(/[^a-z0-9_]/g, '_')}`);
    }
    ids.add(p.id);
  });
  if (!Array.isArray(s.calendars)) throw new ConfigError('settings.calendars must be a list');
  s.calendars.forEach((c, i) => {
    if (!c || !isText(c.calendarId)) throw new ConfigError(`settings.calendars[${i}].calendarId is missing`);
    if (c.person !== 'family' && !ids.has(c.person)) {
      throw new ConfigError(`settings.calendars[${i}] has unknown person id "${c.person}" (not in settings.people)`);
    }
  });
  const family = s.calendars.filter((c) => c.person === 'family').length;
  if (family === 0) throw new ConfigError('settings has no calendar with person "family"');
  if (family > 1) throw new ConfigError('settings must have exactly one calendar with person "family"');
  return {
    people: s.people.map((p) => Object.assign({ id: p.id, name: p.name, colour: p.colour }, p.homeAssistant ? { homeAssistant: p.homeAssistant } : {})),
    calendars: s.calendars.map((c) => ({ calendarId: c.calendarId, person: c.person })),
  };
}

// settings.homeAssistant → { url, weatherEntity, label, rooms } (url without a trailing slash), or
// null if absent. label (default "frame") picks the entities on Home controls; rooms orders them.
function checkHomeAssistant(h) {
  if (h === undefined) return null;
  if (!h || typeof h !== 'object' || Array.isArray(h)) throw new ConfigError('settings.homeAssistant must be a JSON object');
  let url;
  try {
    url = new URL(h.url);
  } catch {
    throw new ConfigError(`settings.homeAssistant.url "${h.url}" is not a URL like http://homeassistant.local:8123`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new ConfigError(`settings.homeAssistant.url "${h.url}" must start with http:// or https://`);
  if (!isText(h.weatherEntity) || !/^weather\.[a-z0-9_]+$/.test(h.weatherEntity)) {
    throw new ConfigError(`settings.homeAssistant.weatherEntity "${h.weatherEntity}" must be a weather entity id like weather.pirateweather`);
  }
  if (h.label !== undefined && !isText(h.label)) throw new ConfigError('settings.homeAssistant.label must be the name of a Home Assistant label, like "frame"');
  if (h.rooms !== undefined && (!Array.isArray(h.rooms) || !h.rooms.every(isText))) {
    throw new ConfigError('settings.homeAssistant.rooms must be a list of Home Assistant area names');
  }
  return {
    url: h.url.replace(/\/+$/, ''),
    weatherEntity: h.weatherEntity,
    label: h.label === undefined ? 'frame' : h.label.trim(),
    rooms: h.rooms === undefined ? [] : h.rooms.map((r) => r.trim()),
  };
}

function checkServiceAccount(k) {
  if (!k || typeof k !== 'object') throw new ConfigError('service-account key must be a JSON object');
  if (!isText(k.client_email)) throw new ConfigError('service-account key has no client_email');
  if (!isText(k.private_key)) throw new ConfigError('service-account key has no private_key');
  try {
    createPrivateKey(k.private_key);
  } catch (e) {
    throw new ConfigError(`service-account key private_key cannot be read: ${e.message}`);
  }
  return k;
}

export function loadConfig({ env = process.env, cwd = process.cwd() } = {}) {
  const serviceAccount = checkServiceAccount(readJsonItem(env, cwd, 'service-account key',
    'GOOGLE_SERVICE_ACCOUNT_JSON', 'GOOGLE_SERVICE_ACCOUNT_FILE', 'config/service-account.json'));
  const rawSettings = readJsonItem(env, cwd, 'settings',
    'DASHBOARD_SETTINGS_JSON', 'DASHBOARD_SETTINGS_FILE', 'config/settings.json');
  const settings = checkSettings(rawSettings);
  let homeAssistant = checkHomeAssistant(rawSettings.homeAssistant);
  if (homeAssistant) {
    const token = readItem(env, cwd, 'Home Assistant token',
      'HOME_ASSISTANT_TOKEN', 'HOME_ASSISTANT_TOKEN_FILE', 'config/home-assistant-token').text.trim();
    if (!token) throw new ConfigError('The Home Assistant token is empty');
    homeAssistant = Object.assign(homeAssistant, { token });
  }

  let port = 8080;
  if (env.PORT) {
    port = Number(env.PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ConfigError(`PORT "${env.PORT}" is not a valid port`);
  }
  const dataDir = resolve(cwd, env.DASHBOARD_DATA_DIR || 'data');
  return { settings, serviceAccount, homeAssistant, port, timeZone: env.TZ || null, dataDir };
}
