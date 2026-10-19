import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, ConfigError } from '../config.js';
import { serviceAccount, settings, tempDir } from './helpers.js';

function withDir(files, fn) {
  const t = tempDir(files);
  try { return fn(t); } finally { t.cleanup(); }
}

const named = (re) => (err) => err instanceof ConfigError && re.test(err.message);

test('reads the default files under config/', () => {
  withDir({ 'config/settings.json': settings(), 'config/service-account.json': serviceAccount() }, (t) => {
    const c = loadConfig({ env: {}, cwd: t.dir });
    assert.equal(c.settings.people.length, 2);
    assert.equal(c.serviceAccount.client_email, 'frame@example-project.iam.gserviceaccount.com');
    assert.equal(c.port, 8080);
    assert.equal(c.timeZone, null);
  });
});

test('inline env beats path env beats default file', () => {
  const inline = settings({ people: [{ id: 'inline', name: 'Inline', colour: '#000000' }], calendars: [{ calendarId: 'f', person: 'family' }] });
  const viaPath = settings({ people: [{ id: 'path', name: 'Path', colour: '#000000' }], calendars: [{ calendarId: 'f', person: 'family' }] });
  withDir({
    'config/settings.json': settings(),
    'other/settings.json': viaPath,
    'config/service-account.json': serviceAccount({ client_email: 'default@x' }),
    'other/key.json': serviceAccount({ client_email: 'path@x' }),
  }, (t) => {
    const pathEnv = { DASHBOARD_SETTINGS_FILE: t.path('other/settings.json'), GOOGLE_SERVICE_ACCOUNT_FILE: t.path('other/key.json') };
    let c = loadConfig({ env: pathEnv, cwd: t.dir });
    assert.equal(c.settings.people[0].id, 'path');
    assert.equal(c.serviceAccount.client_email, 'path@x');

    c = loadConfig({
      env: Object.assign({}, pathEnv, {
        DASHBOARD_SETTINGS_JSON: JSON.stringify(inline),
        GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify(serviceAccount({ client_email: 'inline@x' })),
      }),
      cwd: t.dir,
    });
    assert.equal(c.settings.people[0].id, 'inline');
    assert.equal(c.serviceAccount.client_email, 'inline@x');
  });
});

test('PORT and TZ come from the environment', () => {
  withDir({ 'config/settings.json': settings(), 'config/service-account.json': serviceAccount() }, (t) => {
    const c = loadConfig({ env: { PORT: '9123', TZ: 'Europe/Paris' }, cwd: t.dir });
    assert.equal(c.port, 9123);
    assert.equal(c.timeZone, 'Europe/Paris');
    assert.throws(() => loadConfig({ env: { PORT: 'abc' }, cwd: t.dir }), named(/PORT/));
  });
});

test('missing service-account key is named', () => {
  withDir({ 'config/settings.json': settings() }, (t) => {
    assert.throws(() => loadConfig({ env: {}, cwd: t.dir }), named(/service-account key.*GOOGLE_SERVICE_ACCOUNT_JSON.*GOOGLE_SERVICE_ACCOUNT_FILE.*config\/service-account\.json/s));
    assert.throws(() => loadConfig({ env: { GOOGLE_SERVICE_ACCOUNT_FILE: t.path('nope.json') }, cwd: t.dir }), named(/GOOGLE_SERVICE_ACCOUNT_FILE.*nope\.json/));
  });
});

test('missing settings are named', () => {
  withDir({ 'config/service-account.json': serviceAccount() }, (t) => {
    assert.throws(() => loadConfig({ env: {}, cwd: t.dir }), named(/settings.*DASHBOARD_SETTINGS_JSON.*DASHBOARD_SETTINGS_FILE.*config\/settings\.json/s));
    assert.throws(() => loadConfig({ env: { DASHBOARD_SETTINGS_FILE: t.path('gone.json') }, cwd: t.dir }), named(/DASHBOARD_SETTINGS_FILE.*gone\.json/));
  });
});

test('bad JSON is named with its source', () => {
  withDir({ 'config/settings.json': '{ nope', 'config/service-account.json': serviceAccount() }, (t) => {
    assert.throws(() => loadConfig({ env: {}, cwd: t.dir }), named(/settings\.json.*not valid JSON/));
    assert.throws(() => loadConfig({ env: { DASHBOARD_SETTINGS_JSON: '[' }, cwd: t.dir }), named(/DASHBOARD_SETTINGS_JSON.*not valid JSON/));
  });
});

test('unknown person id is named', () => {
  const s = settings();
  s.calendars.push({ calendarId: 'x@example.com', person: 'robin' });
  withDir({ 'config/settings.json': s, 'config/service-account.json': serviceAccount() }, (t) => {
    assert.throws(() => loadConfig({ env: {}, cwd: t.dir }), named(/unknown person id "robin"/));
  });
});

test('no family calendar is named', () => {
  const s = settings({ calendars: [{ calendarId: 'alex@example.com', person: 'alex' }] });
  withDir({ 'config/settings.json': s, 'config/service-account.json': serviceAccount() }, (t) => {
    assert.throws(() => loadConfig({ env: {}, cwd: t.dir }), named(/no calendar with person "family"/));
  });
});

test('two family calendars are rejected', () => {
  const s = settings();
  s.calendars.push({ calendarId: 'other@group.calendar.google.com', person: 'family' });
  withDir({ 'config/settings.json': s, 'config/service-account.json': serviceAccount() }, (t) => {
    assert.throws(() => loadConfig({ env: {}, cwd: t.dir }), named(/exactly one calendar.*"family"/));
  });
});

test('people need id, name and colour', () => {
  const s = settings({ people: [{ id: 'alex', name: 'Alex' }] });
  withDir({ 'config/settings.json': s, 'config/service-account.json': serviceAccount() }, (t) => {
    assert.throws(() => loadConfig({ env: {}, cwd: t.dir }), named(/people\[0\]\.colour/));
  });
});

test('colour must be a 6-digit hex colour', () => {
  const s = settings({ people: [{ id: 'alex', name: 'Alex', colour: '#2D5BFFCC' }] });
  s.calendars = [{ calendarId: 'f', person: 'family' }];
  withDir({ 'config/settings.json': s, 'config/service-account.json': serviceAccount() }, (t) => {
    assert.throws(() => loadConfig({ env: {}, cwd: t.dir }), named(/people\[0\]\.colour.*6-digit/));
  });
});

test('a key without private_key or client_email is named', () => {
  withDir({ 'config/settings.json': settings(), 'config/service-account.json': { client_email: 'a@b' } }, (t) => {
    assert.throws(() => loadConfig({ env: {}, cwd: t.dir }), named(/private_key/));
  });
  withDir({ 'config/settings.json': settings(), 'config/service-account.json': serviceAccount({ private_key: 'not a key' }) }, (t) => {
    assert.throws(() => loadConfig({ env: {}, cwd: t.dir }), named(/private_key/));
  });
});
