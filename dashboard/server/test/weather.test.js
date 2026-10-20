import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../app.js';
import { fakeHomeAssistant, serviceAccount, settings } from './helpers.js';

const NOW = Date.parse('2026-10-19T12:00:00Z');
const ENTITY = 'weather.pirateweather';

function entity(over) {
  return Object.assign({
    state: 'partlycloudy',
    attributes: { temperature: 61.4, temperature_unit: '°F', humidity: 71 },
    hourly: [
      { datetime: '2026-10-19T12:00:00+00:00', condition: 'partlycloudy', temperature: 61.4, precipitation_probability: 5 },
      { datetime: '2026-10-19T13:00:00+00:00', condition: 'rainy', temperature: 59.6, precipitation_probability: 62.4 },
      { datetime: '2026-10-19T14:00:00+00:00', condition: 'lightning-rainy', temperature: 58, precipitation_probability: null },
    ],
    daily: [
      { datetime: '2026-10-19T04:00:00+00:00', condition: 'rainy', temperature: 63.2, templow: 47.5, precipitation_probability: 80 },
      { datetime: '2026-10-20T04:00:00+00:00', condition: 'snowy-rainy', temperature: 40, templow: 30 },
    ],
  }, over || {});
}

async function withServer(entities, fn, opts) {
  const ha = await fakeHomeAssistant(entities);
  // opts.homeAssistant: the config to use instead, or a function of the fake that returns it.
  let homeAssistant = { url: ha.url, weatherEntity: ENTITY, token: ha.token };
  if (opts && 'homeAssistant' in opts) homeAssistant = typeof opts.homeAssistant === 'function' ? opts.homeAssistant(ha) : opts.homeAssistant;
  const srv = await startServer({
    config: { settings: settings(), serviceAccount: serviceAccount(), homeAssistant, port: 0, timeZone: null },
    distDir: '/nonexistent',
    now: () => NOW,
    log: { log() {}, warn() {}, error() {} },
  });
  try {
    await fn({ url: srv.url, ha });
  } finally {
    await srv.close();
    await ha.close();
  }
}

async function getWeather(url) {
  const res = await fetch(url + '/api/weather');
  return { status: res.status, body: await res.json() };
}

test('maps the entity and its forecasts into the dashboard shape', async () => {
  await withServer({ [ENTITY]: entity() }, async ({ url, ha }) => {
    const { status, body } = await getWeather(url);
    assert.equal(status, 200);
    assert.deepEqual(body, {
      configured: true,
      now: { temp: 61, cond: 'partly' },
      hourly: [
        { at: '2026-10-19T12:00:00+00:00', temp: 61, cond: 'partly', pop: 5 },
        { at: '2026-10-19T13:00:00+00:00', temp: 60, cond: 'rain', pop: 62 },
        { at: '2026-10-19T14:00:00+00:00', temp: 58, cond: 'storm', pop: 0 },
      ],
      daily: [
        { at: '2026-10-19T04:00:00+00:00', hi: 63, lo: 48, cond: 'rain' },
        { at: '2026-10-20T04:00:00+00:00', hi: 40, lo: 30, cond: 'snow' },
      ],
      updatedAt: new Date(NOW).toISOString(),
    });
    const calls = ha.requests.filter((r) => r.method === 'POST').map((r) => JSON.parse(r.body));
    assert.deepEqual(calls.map((c) => c.type).sort(), ['daily', 'hourly']);
    assert.ok(calls.every((c) => c.entity_id === ENTITY));
  });
});

test('converts a Celsius entity to whole degrees Fahrenheit', async () => {
  const e = entity({
    attributes: { temperature: 16.5, temperature_unit: '°C' },
    hourly: [{ datetime: '2026-10-19T12:00:00+00:00', condition: 'sunny', temperature: -1, precipitation_probability: 0 }],
    daily: [{ datetime: '2026-10-19T04:00:00+00:00', condition: 'sunny', temperature: 17.2, templow: 0 }],
  });
  await withServer({ [ENTITY]: e }, async ({ url }) => {
    const { body } = await getWeather(url);
    assert.equal(body.now.temp, 62);
    assert.equal(body.hourly[0].temp, 30);
    assert.deepEqual([body.daily[0].hi, body.daily[0].lo], [63, 32]);
  });
});

test('unknown conditions show as cloud; entries without numbers are dropped', async () => {
  const e = entity({
    state: 'something-new',
    hourly: [
      { datetime: '2026-10-19T12:00:00+00:00', condition: 'clear-night', temperature: 50 },
      { datetime: '2026-10-19T13:00:00+00:00', condition: 'sunny', temperature: null },
    ],
    daily: [{ datetime: '2026-10-19T04:00:00+00:00', condition: 'sunny', temperature: 60 }],
  });
  await withServer({ [ENTITY]: e }, async ({ url }) => {
    const { body } = await getWeather(url);
    assert.equal(body.now.cond, 'cloud');
    assert.deepEqual(body.hourly, [{ at: '2026-10-19T12:00:00+00:00', temp: 50, cond: 'moon', pop: 0 }]);
    assert.deepEqual(body.daily, []);
  });
});

test('without Home Assistant settings, says weather is not configured', async () => {
  await withServer({}, async ({ url, ha }) => {
    assert.deepEqual(await getWeather(url), { status: 200, body: { configured: false } });
    assert.equal(ha.requests.length, 0);
  }, { homeAssistant: null });
});

test('Home Assistant failures are 502s naming the problem', async () => {
  await withServer({ [ENTITY]: { status: 500 } }, async ({ url }) => {
    const { status, body } = await getWeather(url);
    assert.equal(status, 502);
    assert.match(body.error, /Home Assistant.*500/);
  });
  // Wrong token
  await withServer({ [ENTITY]: entity() }, async ({ url }) => {
    const { status, body } = await getWeather(url);
    assert.equal(status, 502);
    assert.match(body.error, /401 Invalid access token/);
  }, { homeAssistant: (ha) => ({ url: ha.url, weatherEntity: ENTITY, token: 'wrong' }) });
  // Unavailable entity: no temperature
  await withServer({ [ENTITY]: entity({ state: 'unavailable', attributes: {} }) }, async ({ url }) => {
    const { status, body } = await getWeather(url);
    assert.equal(status, 502);
    assert.match(body.error, /no current temperature.*unavailable/);
  });
  // Unknown unit
  await withServer({ [ENTITY]: entity({ attributes: { temperature: 3, temperature_unit: '°X' } }) }, async ({ url }) => {
    const { status, body } = await getWeather(url);
    assert.equal(status, 502);
    assert.match(body.error, /°X/);
  });
});

test('Home Assistant unreachable is a 502', async () => {
  await withServer({}, async ({ url }) => {
    const { status, body } = await getWeather(url);
    assert.equal(status, 502);
    assert.match(body.error, /^Home Assistant/);
  }, { homeAssistant: { url: 'http://127.0.0.1:1', weatherEntity: ENTITY, token: 't' } });
});

test('only GET is allowed', async () => {
  await withServer({ [ENTITY]: entity() }, async ({ url }) => {
    const res = await fetch(url + '/api/weather', { method: 'POST' });
    assert.equal(res.status, 405);
  });
});
