// Startup configuration: settings (people + calendars, optionally Home Assistant and Immich), the
// Google service-account key, the Home Assistant token, the Immich API key, port, time zone and
// data dir (DASHBOARD_DATA_DIR, else data/; opened by store.js). Each item is read from an
// inline env var, else a path env var, else a default file under config/. Anything missing or
// invalid throws a ConfigError naming the item, so the server never starts serving an empty
// calendar. Home Assistant is optional: without settings.homeAssistant there is no weather. A
// person's optional homeAssistant names their person.* entity, for presence on /api/home. Immich is
// optional too: settings.immich names the album the photos come from, and a person's optional
// immich is their Immich user's email, which credits them with the photos they uploaded. A
// calendar is a Google calendar ({ calendarId, person }) or a read-only one from an ICS link
// ({ ics, person }, ADR 0005); the link is a secret, read from the file config/<ics> (one per link,
// like config/immich-api-key). A calendar's person is a person id, "family" (exactly one, a Google
// calendar) or "none" (a holiday calendar: its all-day events belong to no one).
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

// A settings.calendars entry is Google ({ calendarId }) or read-only from an ICS link ({ ics, url }).
export const isReadOnly = (cal) => isText(cal.ics);
// A holiday calendar ({ person: "none" }, Google or ICS): its all-day events belong to no one.
export const isHoliday = (cal) => cal.person === 'none';
// Calendar person values that are not people.
const RESERVED = ['family', 'none'];

function checkSettings(s) {
  if (!s || typeof s !== 'object') throw new ConfigError('settings must be a JSON object');
  if (!Array.isArray(s.people) || s.people.length === 0) throw new ConfigError('settings.people must be a non-empty list');
  const ids = new Set();
  s.people.forEach((p, i) => {
    for (const key of ['id', 'name', 'colour']) {
      if (!p || !isText(p[key])) throw new ConfigError(`settings.people[${i}].${key} is missing`);
    }
    if (!/^#[0-9a-fA-F]{6}$/.test(p.colour)) throw new ConfigError(`settings.people[${i}].colour "${p.colour}" must be a 6-digit hex colour like #2D5BFF`);
    if (RESERVED.includes(p.id)) throw new ConfigError(`settings.people[${i}].id cannot be "${p.id}" (reserved for calendars: "family" is everyone's, "none" no one's)`);
    if (ids.has(p.id)) throw new ConfigError(`settings.people[${i}].id "${p.id}" is used twice`);
    if (p.homeAssistant !== undefined && (typeof p.homeAssistant !== 'string' || !/^person\.[a-z0-9_]+$/.test(p.homeAssistant))) {
      throw new ConfigError(`settings.people[${i}].homeAssistant (${p.name}) "${p.homeAssistant}" must be a Home Assistant person entity id like person.alex`);
    }
    if (p.immich !== undefined && (typeof p.immich !== 'string' || !/^[^\s@]+@[^\s@]+$/.test(p.immich.trim()))) {
      throw new ConfigError(`settings.people[${i}].immich (${p.name}) "${p.immich}" must be the email of their Immich user, like alex@example.com`);
    }
    ids.add(p.id);
  });
  if (!Array.isArray(s.calendars)) throw new ConfigError('settings.calendars must be a list');
  s.calendars.forEach((c, i) => {
    if (!c || isText(c.calendarId) === isReadOnly(c)) {
      throw new ConfigError(`settings.calendars[${i}] needs either a calendarId (a Google calendar) or an ics name (a read-only calendar from an ICS link)`);
    }
    if (!RESERVED.includes(c.person) && !ids.has(c.person)) {
      throw new ConfigError(`settings.calendars[${i}] has unknown person id "${c.person}" (not in settings.people, "family" or "none")`);
    }
  });
  const family = s.calendars.filter((c) => c.person === 'family').length;
  if (family === 0) throw new ConfigError('settings has no calendar with person "family"');
  if (family > 1) throw new ConfigError('settings must have exactly one calendar with person "family"');
  if (isReadOnly(s.calendars.find((c) => c.person === 'family'))) {
    throw new ConfigError('The Family calendar must be a Google calendar (a calendarId, not an ics link): events added on the frame go there');
  }
  return {
    people: s.people.map((p) => Object.assign({ id: p.id, name: p.name, colour: p.colour },
      p.homeAssistant ? { homeAssistant: p.homeAssistant } : {}, p.immich ? { immich: p.immich.trim() } : {})),
    calendars: s.calendars.map((c) => (isReadOnly(c) ? { ics: c.ics.trim(), person: c.person } : { calendarId: c.calendarId, person: c.person })),
  };
}

// An ics name is also its link's file name in config/, so it can't leave config/ or be another
// secret's file.
const ICS_NAME = /^[a-z0-9][a-z0-9_-]*$/;
const NOT_ICS_NAMES = ['home-assistant-token', 'immich-api-key'];

// Adds each read-only calendar's link (the text of config/<ics>) to its entry.
function addIcsUrls(calendars, cwd) {
  calendars.forEach((c, i) => {
    if (!isReadOnly(c)) return;
    if (!ICS_NAME.test(c.ics) || NOT_ICS_NAMES.includes(c.ics)) {
      throw new ConfigError(`settings.calendars[${i}].ics "${c.ics}" must be a file name like alex-fastmail (lowercase letters, digits, - and _), not ${NOT_ICS_NAMES.join(' or ')}`);
    }
    const file = resolve(cwd, 'config', c.ics);
    if (!existsSync(file)) throw new ConfigError(`settings.calendars[${i}] names the ICS link "${c.ics}": create config/${c.ics} holding its URL`);
    const text = readFileSync(file, 'utf8').trim();
    let url;
    try {
      url = new URL(text);
    } catch {}
    if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
      throw new ConfigError(`The ICS link in config/${c.ics} must start with http:// or https:// (for a webcal:// link, change webcal to https)`);
    }
    c.url = url.href;
  });
}

// settings.homeAssistant.radar → { zoom } (default 8), or null if absent: the Weather page's radar
// around zone.home, from LibreWXR (ADR 0006). LibreWXR's zooms are 0–12.
function checkRadar(r) {
  if (r === undefined) return null;
  if (!r || typeof r !== 'object' || Array.isArray(r)) throw new ConfigError('settings.homeAssistant.radar must be a JSON object, like { "zoom": 8 }');
  const zoom = r.zoom === undefined ? 8 : r.zoom;
  if (!Number.isInteger(zoom) || zoom < 0 || zoom > 12) {
    throw new ConfigError(`settings.homeAssistant.radar.zoom ${JSON.stringify(zoom)} must be a whole number from 0 to 12 (8 shows about 150 miles across)`);
  }
  return { zoom };
}

// settings.homeAssistant → { url, weatherEntity, label, rooms, radar } (url without a trailing
// slash), or null if absent. label (default "frame") picks the entities on Home controls; rooms
// orders them; radar is checkRadar's.
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
    radar: checkRadar(h.radar),
  };
}

// settings.immich → { url, albumId } (url without a trailing slash), or null if absent.
function checkImmich(m) {
  if (m === undefined) return null;
  if (!m || typeof m !== 'object' || Array.isArray(m)) throw new ConfigError('settings.immich must be a JSON object');
  let url;
  try {
    url = new URL(m.url);
  } catch {
    throw new ConfigError(`settings.immich.url "${m.url}" is not a URL like http://immich.local:2283`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new ConfigError(`settings.immich.url "${m.url}" must start with http:// or https://`);
  if (!isText(m.albumId) || !/^[0-9a-fA-F-]{36}$/.test(m.albumId.trim())) {
    throw new ConfigError(`settings.immich.albumId "${m.albumId}" must be an Immich album id (the last part of the album's URL, like 1b2c3d4e-…)`);
  }
  return { url: m.url.replace(/\/+$/, ''), albumId: m.albumId.trim() };
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
  addIcsUrls(settings.calendars, cwd);
  let homeAssistant = checkHomeAssistant(rawSettings.homeAssistant);
  if (homeAssistant) {
    const token = readItem(env, cwd, 'Home Assistant token',
      'HOME_ASSISTANT_TOKEN', 'HOME_ASSISTANT_TOKEN_FILE', 'config/home-assistant-token').text.trim();
    if (!token) throw new ConfigError('The Home Assistant token is empty');
    homeAssistant = Object.assign(homeAssistant, { token });
  }

  let immich = checkImmich(rawSettings.immich);
  if (immich) {
    const apiKey = readItem(env, cwd, 'Immich API key',
      'IMMICH_API_KEY', 'IMMICH_API_KEY_FILE', 'config/immich-api-key').text.trim();
    if (!apiKey) throw new ConfigError('The Immich API key is empty');
    immich = Object.assign(immich, { apiKey });
  }

  let port = 8080;
  if (env.PORT) {
    port = Number(env.PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ConfigError(`PORT "${env.PORT}" is not a valid port`);
  }
  const dataDir = resolve(cwd, env.DASHBOARD_DATA_DIR || 'data');
  return { settings, serviceAccount, homeAssistant, immich, port, timeZone: env.TZ || null, dataDir };
}
