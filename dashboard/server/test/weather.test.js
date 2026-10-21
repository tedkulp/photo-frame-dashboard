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
      now: { temp: 61, cond: 'partly', humidity: 71 },
      hourly: [
        { at: '2026-10-19T12:00:00+00:00', temp: 61, cond: 'partly', pop: 5 },
        { at: '2026-10-19T13:00:00+00:00', temp: 60, cond: 'rain', pop: 62 },
        { at: '2026-10-19T14:00:00+00:00', temp: 58, cond: 'storm', pop: 0 },
      ],
      daily: [
        { at: '2026-10-19T04:00:00+00:00', hi: 63, lo: 48, cond: 'rain', pop: 80 },
        { at: '2026-10-20T04:00:00+00:00', hi: 40, lo: 30, cond: 'snow', pop: 0 },
      ],
      updatedAt: new Date(NOW).toISOString(),
    });
    const calls = ha.requests.filter((r) => r.method === 'POST').map((r) => JSON.parse(r.body));
    assert.deepEqual(calls.map((c) => c.type).sort(), ['daily', 'hourly']);
    assert.ok(calls.every((c) => c.entity_id === ENTITY));
  });
});

// What PirateWeather gives (2026-10): wind, humidity, feels-like and UV on top of the basics.
function richEntity(unit) {
  return entity({
    attributes: {
      temperature: 61.4, temperature_unit: '°F', humidity: 71.4,
      wind_speed: 10, wind_gust_speed: 20, wind_bearing: 225.4, wind_speed_unit: unit || 'mph',
    },
    hourly: [
      { datetime: '2026-10-19T11:00:00+00:00', condition: 'sunny', temperature: 60, apparent_temperature: 50, uv_index: 9 },
      { datetime: '2026-10-19T12:00:00+00:00', condition: 'partlycloudy', temperature: 61.4, apparent_temperature: 58.6,
        uv_index: 3.4, humidity: 70.6, wind_speed: 10, wind_gust_speed: 18, wind_bearing: 359.6, precipitation_probability: 5 },
      { datetime: '2026-10-19T13:00:00+00:00', condition: 'rainy', temperature: 59.6, humidity: 88, wind_speed: 20, wind_bearing: 90 },
    ],
    daily: [
      { datetime: '2026-10-19T04:00:00+00:00', condition: 'rainy', temperature: 63.2, templow: 47.5, precipitation_probability: 80.4,
        humidity: 75, wind_speed: 12.4, wind_gust_speed: 30, wind_bearing: 180 },
    ],
  });
}
const SUN = { state: 'above_horizon', attributes: { next_rising: '2026-10-20T11:31:12+00:00', next_setting: '2026-10-19T22:41:05+00:00' } };

test('adds feels-like, humidity, wind, UV and sunrise/sunset when the entities have them', async () => {
  await withServer({ [ENTITY]: richEntity(), 'sun.sun': SUN }, async ({ url }) => {
    const { body } = await getWeather(url);
    assert.deepEqual(body.now, {
      temp: 61, cond: 'partly', feels: 59, humidity: 71, wind: 10, gust: 20, bearing: 225, uv: 3,
      sunrise: '2026-10-20T11:31:12+00:00', sunset: '2026-10-19T22:41:05+00:00',
    });
    assert.deepEqual(body.hourly[1], { at: '2026-10-19T12:00:00+00:00', temp: 61, cond: 'partly', pop: 5, wind: 10, bearing: 0, humidity: 71 });
    assert.deepEqual(body.hourly[2], { at: '2026-10-19T13:00:00+00:00', temp: 60, cond: 'rain', pop: 0, wind: 20, bearing: 90, humidity: 88 });
    assert.deepEqual(body.daily[0], { at: '2026-10-19T04:00:00+00:00', hi: 63, lo: 48, cond: 'rain', pop: 80, wind: 12, gust: 30, bearing: 180, humidity: 75 });
  });
});

test('wind is converted to whole mph from km/h and m/s', async () => {
  await withServer({ [ENTITY]: richEntity('km/h'), 'sun.sun': SUN }, async ({ url }) => {
    const { body } = await getWeather(url);
    assert.deepEqual([body.now.wind, body.now.gust, body.hourly[2].wind, body.daily[0].wind, body.daily[0].gust], [6, 12, 12, 8, 19]);
  });
  await withServer({ [ENTITY]: richEntity('m/s'), 'sun.sun': SUN }, async ({ url }) => {
    const { body } = await getWeather(url);
    assert.deepEqual([body.now.wind, body.now.gust, body.hourly[2].wind, body.daily[0].wind, body.daily[0].gust], [22, 45, 45, 28, 67]);
  });
});

test('a wind speed in an unknown unit, or without one, is left out; the rest still loads', async () => {
  const e = richEntity('furlongs/fortnight');
  await withServer({ [ENTITY]: e, 'sun.sun': SUN }, async ({ url }) => {
    const { status, body } = await getWeather(url);
    assert.equal(status, 200);
    assert.equal('wind' in body.now, false);
    assert.equal('gust' in body.now, false);
    assert.equal(body.now.bearing, 225);
    assert.equal('wind' in body.hourly[2], false);
    assert.equal(body.hourly[2].humidity, 88);
  });
  const bare = richEntity();
  delete bare.attributes.wind_speed_unit;
  await withServer({ [ENTITY]: bare }, async ({ url }) => {
    const { body } = await getWeather(url);
    assert.equal('wind' in body.now, false);
  });
});

test('missing fields are left out without error; without sun.sun there is no sunrise or sunset', async () => {
  await withServer({ [ENTITY]: entity({ attributes: { temperature: 61.4, temperature_unit: '°F' } }) }, async ({ url }) => {
    const { status, body } = await getWeather(url);
    assert.equal(status, 200);
    assert.deepEqual(body.now, { temp: 61, cond: 'partly' });
    assert.deepEqual(body.hourly[0], { at: '2026-10-19T12:00:00+00:00', temp: 61, cond: 'partly', pop: 5 });
    assert.deepEqual(body.daily[1], { at: '2026-10-20T04:00:00+00:00', hi: 40, lo: 30, cond: 'snow', pop: 0 });
  });
  // sun.sun failing, or without its attributes, is the same as missing
  for (const sun of [{ status: 500 }, { state: 'unknown', attributes: {} }]) {
    await withServer({ [ENTITY]: richEntity(), 'sun.sun': sun }, async ({ url }) => {
      const { status, body } = await getWeather(url);
      assert.equal(status, 200);
      assert.equal('sunrise' in body.now, false);
      assert.equal('sunset' in body.now, false);
      assert.equal(body.now.feels, 59);
    });
  }
});

test('feels-like and UV come from the hour covering now, else the entity', async () => {
  // No forecast hour covers 12:00: use the entity's own attributes, if any
  const e = richEntity();
  e.hourly = e.hourly.slice(2);
  Object.assign(e.attributes, { apparent_temperature: 55.2, uv_index: 1.6 });
  await withServer({ [ENTITY]: e }, async ({ url }) => {
    const { body } = await getWeather(url);
    assert.equal(body.now.feels, 55);
    assert.equal(body.now.uv, 2);
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
