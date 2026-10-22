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
    assert.equal(c.dataDir, t.path('data'));
  });
});

test('DASHBOARD_DATA_DIR sets the data dir, relative to the working directory', () => {
  withDir({ 'config/settings.json': settings(), 'config/service-account.json': serviceAccount() }, (t) => {
    assert.equal(loadConfig({ env: { DASHBOARD_DATA_DIR: 'state' }, cwd: t.dir }).dataDir, t.path('state'));
    assert.equal(loadConfig({ env: { DASHBOARD_DATA_DIR: '/srv/frame' }, cwd: t.dir }).dataDir, '/srv/frame');
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

test('Home Assistant is optional', () => {
  withDir({ 'config/settings.json': settings(), 'config/service-account.json': serviceAccount() }, (t) => {
    assert.equal(loadConfig({ env: { HOME_ASSISTANT_TOKEN: 'ignored' }, cwd: t.dir }).homeAssistant, null);
  });
});

test('Home Assistant settings + token from env, path env or default file', () => {
  const s = settings({ homeAssistant: { url: 'http://ha.local:8123/', weatherEntity: 'weather.pirateweather' } });
  withDir({
    'config/settings.json': s,
    'config/service-account.json': serviceAccount(),
    'config/home-assistant-token': 'from-file\n',
    'other/token': 'from-path',
  }, (t) => {
    const ha = (env) => loadConfig({ env, cwd: t.dir }).homeAssistant;
    assert.deepEqual(ha({}), { url: 'http://ha.local:8123', weatherEntity: 'weather.pirateweather', label: 'frame', rooms: [], token: 'from-file' });
    assert.equal(ha({ HOME_ASSISTANT_TOKEN_FILE: t.path('other/token') }).token, 'from-path');
    assert.equal(ha({ HOME_ASSISTANT_TOKEN_FILE: t.path('other/token'), HOME_ASSISTANT_TOKEN: 'inline' }).token, 'inline');
  });
});

test('Home Assistant settings without a token are named', () => {
  const s = settings({ homeAssistant: { url: 'http://ha.local:8123', weatherEntity: 'weather.home' } });
  withDir({ 'config/settings.json': s, 'config/service-account.json': serviceAccount() }, (t) => {
    assert.throws(() => loadConfig({ env: {}, cwd: t.dir }), named(/Home Assistant token.*HOME_ASSISTANT_TOKEN.*HOME_ASSISTANT_TOKEN_FILE.*config\/home-assistant-token/s));
  });
  withDir({ 'config/settings.json': s, 'config/service-account.json': serviceAccount(), 'config/home-assistant-token': '  \n' }, (t) => {
    assert.throws(() => loadConfig({ env: {}, cwd: t.dir }), named(/token is empty/));
  });
});

test('bad Home Assistant settings are named', () => {
  const bad = (homeAssistant, re) => withDir({
    'config/settings.json': settings({ homeAssistant }),
    'config/service-account.json': serviceAccount(),
    'config/home-assistant-token': 't',
  }, (t) => assert.throws(() => loadConfig({ env: {}, cwd: t.dir }), named(re)));
  bad('http://ha', /homeAssistant must be a JSON object/);
  bad({ url: 'ha.local', weatherEntity: 'weather.home' }, /homeAssistant\.url "ha\.local"/);
  bad({ url: 'ftp://ha.local', weatherEntity: 'weather.home' }, /http:\/\/ or https:\/\//);
  bad({ url: 'http://ha.local' }, /weatherEntity "undefined"/);
  bad({ url: 'http://ha.local', weatherEntity: 'sensor.temp' }, /weatherEntity "sensor\.temp"/);
  bad({ url: 'http://ha.local', weatherEntity: 'weather.home', label: '' }, /homeAssistant\.label must be/);
  bad({ url: 'http://ha.local', weatherEntity: 'weather.home', label: 3 }, /homeAssistant\.label must be/);
  bad({ url: 'http://ha.local', weatherEntity: 'weather.home', rooms: 'Kitchen' }, /homeAssistant\.rooms must be a list/);
  bad({ url: 'http://ha.local', weatherEntity: 'weather.home', rooms: ['Kitchen', ''] }, /homeAssistant\.rooms must be a list/);
});

test('Home Assistant label and rooms are read', () => {
  const s = settings({ homeAssistant: { url: 'http://ha.local', weatherEntity: 'weather.home', label: ' wall ', rooms: ['Kitchen', ' Robin’s Room'] } });
  withDir({ 'config/settings.json': s, 'config/service-account.json': serviceAccount(), 'config/home-assistant-token': 't' }, (t) => {
    const ha = loadConfig({ env: {}, cwd: t.dir }).homeAssistant;
    assert.equal(ha.label, 'wall');
    assert.deepEqual(ha.rooms, ['Kitchen', 'Robin’s Room']);
  });
});

test("a person's Home Assistant link is read, and must be a person entity", () => {
  const people = [
    { id: 'alex', name: 'Alex', colour: '#2D5BFF', homeAssistant: 'person.alex' },
    { id: 'sam', name: 'Sam', colour: '#E4007C' },
  ];
  withDir({ 'config/settings.json': settings({ people }), 'config/service-account.json': serviceAccount() }, (t) => {
    assert.deepEqual(loadConfig({ env: {}, cwd: t.dir }).settings.people, people);
  });
  for (const link of ['device_tracker.alex_phone', 'person.', 'Person.Alex', 3, '']) {
    const s = settings({ people: [people[0], Object.assign({}, people[1], { homeAssistant: link })] });
    withDir({ 'config/settings.json': s, 'config/service-account.json': serviceAccount() }, (t) => {
      assert.throws(() => loadConfig({ env: {}, cwd: t.dir }), named(/people\[1\]\.homeAssistant .*Sam.*person\./), String(link));
    });
  }
});

const ALBUM = '11111111-2222-4333-8444-555555555555';

test('Immich is optional', () => {
  withDir({ 'config/settings.json': settings(), 'config/service-account.json': serviceAccount() }, (t) => {
    assert.equal(loadConfig({ env: { IMMICH_API_KEY: 'ignored' }, cwd: t.dir }).immich, null);
  });
});

test('Immich settings + API key from env, path env or default file', () => {
  const s = settings({ immich: { url: 'http://immich.local:2283/', albumId: ' ' + ALBUM + ' ' } });
  withDir({
    'config/settings.json': s,
    'config/service-account.json': serviceAccount(),
    'config/immich-api-key': 'from-file\n',
    'other/key': 'from-path',
  }, (t) => {
    const im = (env) => loadConfig({ env, cwd: t.dir }).immich;
    assert.deepEqual(im({}), { url: 'http://immich.local:2283', albumId: ALBUM, apiKey: 'from-file' });
    assert.equal(im({ IMMICH_API_KEY_FILE: t.path('other/key') }).apiKey, 'from-path');
    assert.equal(im({ IMMICH_API_KEY_FILE: t.path('other/key'), IMMICH_API_KEY: 'inline' }).apiKey, 'inline');
  });
});

test('Immich settings without an API key are named', () => {
  const s = settings({ immich: { url: 'http://immich.local:2283', albumId: ALBUM } });
  withDir({ 'config/settings.json': s, 'config/service-account.json': serviceAccount() }, (t) => {
    assert.throws(() => loadConfig({ env: {}, cwd: t.dir }), named(/Immich API key.*IMMICH_API_KEY.*IMMICH_API_KEY_FILE.*config\/immich-api-key/s));
  });
  withDir({ 'config/settings.json': s, 'config/service-account.json': serviceAccount(), 'config/immich-api-key': ' \n' }, (t) => {
    assert.throws(() => loadConfig({ env: {}, cwd: t.dir }), named(/Immich API key is empty/));
  });
});

test('bad Immich settings are named', () => {
  const bad = (immich, re) => withDir({
    'config/settings.json': settings({ immich }),
    'config/service-account.json': serviceAccount(),
    'config/immich-api-key': 'k',
  }, (t) => assert.throws(() => loadConfig({ env: {}, cwd: t.dir }), named(re)));
  bad('http://immich', /immich must be a JSON object/);
  bad({ url: 'immich.local', albumId: ALBUM }, /immich\.url "immich\.local"/);
  bad({ url: 'ftp://immich.local', albumId: ALBUM }, /http:\/\/ or https:\/\//);
  bad({ url: 'http://immich.local' }, /albumId "undefined"/);
  bad({ url: 'http://immich.local', albumId: 'Family' }, /albumId "Family"/);
});

test("a person's Immich email is read, and must look like an email", () => {
  const people = [
    { id: 'alex', name: 'Alex', colour: '#2D5BFF', immich: 'alex@example.com' },
    { id: 'sam', name: 'Sam', colour: '#E4007C' },
  ];
  withDir({ 'config/settings.json': settings({ people }), 'config/service-account.json': serviceAccount() }, (t) => {
    assert.deepEqual(loadConfig({ env: {}, cwd: t.dir }).settings.people, people);
  });
  for (const email of ['alex', 'a b@example.com', 3, '']) {
    const s = settings({ people: [people[0], Object.assign({}, people[1], { immich: email })] });
    withDir({ 'config/settings.json': s, 'config/service-account.json': serviceAccount() }, (t) => {
      assert.throws(() => loadConfig({ env: {}, cwd: t.dir }), named(/people\[1\]\.immich .*Sam.*email/), String(email));
    });
  }
});

// ------------------------------------------------------------ read-only calendars (ICS links)
const withIcs = () => settings({
  calendars: settings().calendars.concat(
    { ics: 'alex-fastmail', person: 'alex' },
    { ics: 'sam-work', person: 'sam' },
  ),
});
const urls = { 'alex-fastmail': 'https://caldav.example.com/alex.ics', 'sam-work': 'http://outlook.example.com/sam/calendar.ics' };
const urlFiles = (u) => Object.fromEntries(Object.entries(u || urls).map(([name, url]) => ['config/' + name, url + '\n']));
const icsDir = (s, u) => Object.assign({ 'config/settings.json': s || withIcs(), 'config/service-account.json': serviceAccount() }, urlFiles(u));

test('read-only calendars take their ICS link from the file config/<ics>', () => {
  withDir(icsDir(), (t) => {
    const c = loadConfig({ env: {}, cwd: t.dir });
    assert.deepEqual(c.settings.calendars.slice(3), [
      { ics: 'alex-fastmail', url: 'https://caldav.example.com/alex.ics', person: 'alex' },
      { ics: 'sam-work', url: 'http://outlook.example.com/sam/calendar.ics', person: 'sam' },
    ]);
    assert.deepEqual(c.settings.calendars[1], { calendarId: 'alex@example.com', person: 'alex' });
  });
});

test('without read-only calendars no ICS links are needed', () => {
  withDir({ 'config/settings.json': settings(), 'config/service-account.json': serviceAccount() }, (t) => {
    assert.equal(loadConfig({ env: {}, cwd: t.dir }).settings.calendars.length, 3);
  });
});

test('an ICS name with no link file is named', () => {
  withDir(icsDir(null, { 'alex-fastmail': urls['alex-fastmail'] }), (t) => {
    assert.throws(() => loadConfig({ env: {}, cwd: t.dir }), named(/calendars\[4\].*"sam-work".*create config\/sam-work/));
  });
});

test('an ICS link that is not http(s) is named', () => {
  for (const bad of ['webcal://outlook.example.com/sam.ics', 'not a url', '']) {
    withDir(icsDir(null, Object.assign({}, urls, { 'sam-work': bad })), (t) => {
      assert.throws(() => loadConfig({ env: {}, cwd: t.dir }), named(/config\/sam-work.*http:\/\/ or https:\/\//), String(bad));
    });
  }
});

test('an ICS name must be a plain file name that is not another secret', () => {
  for (const name of ['../settings.json', 'Alex', 'a b', 'settings.json', 'home-assistant-token', 'immich-api-key']) {
    const s = settings();
    s.calendars.push({ ics: name, person: 'alex' });
    withDir(icsDir(s), (t) => {
      assert.throws(() => loadConfig({ env: {}, cwd: t.dir }), named(/calendars\[3\]\.ics.*file name/), name);
    });
  }
});

test('a read-only Family calendar is refused', () => {
  const s = settings({ calendars: [{ ics: 'family-feed', person: 'family' }, { calendarId: 'alex@example.com', person: 'alex' }] });
  withDir(icsDir(s, { 'family-feed': 'https://a.example/f.ics' }), (t) => {
    assert.throws(() => loadConfig({ env: {}, cwd: t.dir }), named(/Family calendar must be a Google calendar/));
  });
});

test('a calendar needs exactly one of calendarId and ics', () => {
  for (const c of [{ person: 'alex' }, { calendarId: 'x@example.com', ics: 'alex-fastmail', person: 'alex' }, { ics: '  ', person: 'alex' }]) {
    const s = settings();
    s.calendars.push(c);
    withDir(icsDir(s), (t) => {
      assert.throws(() => loadConfig({ env: {}, cwd: t.dir }), named(/calendars\[3\].*calendarId.*ics/), JSON.stringify(c));
    });
  }
});
