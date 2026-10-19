// Startup configuration: settings (people + calendars), the Google service-account key, port and
// time zone. Each JSON item is read from an inline env var, else a path env var, else a default
// file under config/. Anything missing or invalid throws a ConfigError naming the item, so the
// server never starts serving an empty calendar.
import { createPrivateKey } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export class ConfigError extends Error {}

function readJsonItem(env, cwd, what, inlineVar, pathVar, defaultFile) {
  let text, source;
  if (env[inlineVar]) {
    text = env[inlineVar];
    source = inlineVar;
  } else if (env[pathVar]) {
    const file = resolve(cwd, env[pathVar]);
    if (!existsSync(file)) throw new ConfigError(`${pathVar} points to ${file}, which does not exist`);
    text = readFileSync(file, 'utf8');
    source = file;
  } else {
    const file = resolve(cwd, defaultFile);
    if (!existsSync(file)) {
      throw new ConfigError(`No ${what} found: set ${inlineVar} or ${pathVar}, or create ${defaultFile}`);
    }
    text = readFileSync(file, 'utf8');
    source = file;
  }
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
    people: s.people.map((p) => ({ id: p.id, name: p.name, colour: p.colour })),
    calendars: s.calendars.map((c) => ({ calendarId: c.calendarId, person: c.person })),
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
  const settings = checkSettings(readJsonItem(env, cwd, 'settings',
    'DASHBOARD_SETTINGS_JSON', 'DASHBOARD_SETTINGS_FILE', 'config/settings.json'));

  let port = 8080;
  if (env.PORT) {
    port = Number(env.PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ConfigError(`PORT "${env.PORT}" is not a valid port`);
  }
  return { settings, serviceAccount, port, timeZone: env.TZ || null };
}
