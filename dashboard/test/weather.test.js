import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../js/feed.js';
import '../js/advice.js';
import '../js/weather.js';

const { Feed, Weather, Advice } = globalThis;
const MIN = 60000, HOUR = 60 * MIN;

// Local times today (the frame's time zone), so these tests pass in any TZ.
const at = (h, m) => new Date(2026, 9, 19, h, m || 0);
const iso = (d) => d.toISOString();

// Hourly forecast from 0:00 today for 36 hours; `pops` / `conds` override by hour index.
function body(over) {
  const o = Object.assign({ temps: {}, pops: {}, conds: {}, reading: { temp: 61, cond: 'partly' }, updatedAt: at(14, 2), daily: true }, over);
  const hourly = [];
  for (let h = 0; h < 36; h++) {
    hourly.push({ at: iso(at(h)), temp: h in o.temps ? o.temps[h] : 50 + (h % 24 > 12 ? 24 - h % 24 : h % 24), cond: o.conds[h] || 'cloud', pop: o.pops[h] || 0 });
  }
  return {
    configured: true,
    now: o.reading,
    hourly,
    daily: o.daily ? [{ at: iso(at(0)), hi: 66, lo: 47, cond: 'rain' }, { at: iso(new Date(2026, 9, 20)), hi: 50, lo: 40, cond: 'sun' }] : [],
    updatedAt: iso(o.updatedAt),
  };
}
const show = (b, now, count) => Weather.at(Weather.parse(b), now || at(14, 30), count);

// ------------------------------------------------------------ parse
test('parses the server body into Dates; not-configured passes through', () => {
  const d = Weather.parse(body());
  assert.equal(d.configured, true);
  assert.deepEqual([d.reading.temp, d.reading.cond], [61, 'partly']);
  assert.ok(d.hourly[0].at instanceof Date);
  assert.equal(d.hourly.length, 36);
  assert.equal(d.daily[0].hi, 66);
  assert.deepEqual(Weather.parse({ configured: false }), { configured: false });
});

test('rejects a body that is not weather', () => {
  for (const b of [null, {}, { configured: true }, { configured: true, now: {}, hourly: [], daily: [] },
    Object.assign(body(), { updatedAt: 'nope' }), Object.assign(body(), { hourly: 'x' })]) {
    assert.throws(() => Weather.parse(b), /Unexpected weather response/);
  }
});

test('only the weather itself counts as a change, not updatedAt', () => {
  assert.equal(Weather.changeKey(body()), Weather.changeKey(body({ updatedAt: at(14, 12) })));
  assert.notEqual(Weather.changeKey(body()), Weather.changeKey(body({ reading: { temp: 62, cond: 'partly' } })));
  assert.equal(typeof Weather.changeKey({ configured: false }), 'string');
});

// ------------------------------------------------------------ what's shown
test('now uses the current reading, then the next hours; H/L from today\'s daily forecast', () => {
  const w = show(body());
  assert.equal(w.temp, 61);
  assert.equal(w.cond, 'partly');
  assert.equal(w.label, 'Partly cloudy');
  assert.deepEqual([w.hi, w.lo], [66, 47]);
  assert.deepEqual(w.hours.map((h) => h.label), ['Now', '3p', '4p', '5p', '6p', '7p', '8p']);
  assert.deepEqual(w.hours[0], { label: 'Now', temp: 61, cond: 'partly', wet: false, pop: 0, wind: null, dir: '' });
  assert.equal(w.hours[1].temp, 50 + 9);
});

test('the strip runs past midnight into tomorrow', () => {
  const w = show(body({ updatedAt: at(22, 5) }), at(22, 30));
  assert.deepEqual(w.hours.map((h) => h.label), ['Now', '11p', '12a', '1a', '2a', '3a', '4a']);
});

test('an old reading gives way to the forecast for this hour', () => {
  const w = show(body({ updatedAt: at(12, 0), temps: { 14: 70 }, conds: { 14: 'sun' } }), at(14, 30));
  assert.equal(w.temp, 70);
  assert.equal(w.cond, 'sun');
  assert.equal(w.hours[0].temp, 70);
});

test('without a daily forecast for today, H/L come from the rest of today\'s hours', () => {
  const w = show(body({ daily: false, temps: { 20: 40, 18: 75 } }));
  assert.deepEqual([w.hi, w.lo], [75, 40]);
});

test('nothing to show when the forecast doesn\'t cover this hour', () => {
  assert.equal(show(body(), new Date(2026, 9, 21, 9)), null);
  assert.equal(show(body(), new Date(2026, 9, 18, 23)), null);
});

test('fewer hours at the end of the forecast', () => {
  const w = show(body({ updatedAt: at(33, 0) }), at(33, 10));
  assert.equal(w.hours.length, 3);
});

// ------------------------------------------------------------ summary + advice
test('dry and mild', () => {
  const w = show(body());
  assert.equal(w.summary, 'Dry all day');
  assert.equal(w.advice, 'Light layers');
});

test('dry and cool below 55°F', () => {
  const w = show(body({ reading: { temp: 54, cond: 'cloud' } }));
  assert.equal(w.summary, 'Dry and cool');
  assert.equal(w.advice, 'Jacket weather');
  assert.equal(show(body({ reading: { temp: 55, cond: 'cloud' } })).advice, 'Light layers');
});

test('rain later today', () => {
  const w = show(body({ pops: { 16: 50, 17: 80 } }));
  assert.equal(w.summary, 'Rain from 4 PM');
  assert.equal(w.advice, 'Grab a rain jacket');
  assert.deepEqual(w.hours.map((h) => h.wet), [false, false, true, true, false, false, false]);
});

test('49% is not a wet hour; rain tomorrow does not count today', () => {
  const w = show(body({ pops: { 16: 49, 25: 90 } }));
  assert.equal(w.summary, 'Dry all day');
});

test('raining now, until it stops', () => {
  const w = show(body({ pops: { 14: 90, 15: 70 } }));
  assert.equal(w.summary, 'Rain until 4 PM');
  assert.equal(w.advice, 'Umbrella weather');
});

test('raining for the rest of the day', () => {
  const pops = {};
  for (let h = 14; h < 30; h++) pops[h] = 80;
  assert.equal(show(body({ pops })).summary, 'Rain for the rest of the day');
});

test('snow and storms are named, and snow gets its own advice', () => {
  let w = show(body({ pops: { 17: 70 }, conds: { 17: 'snow' } }));
  assert.equal(w.summary, 'Snow from 5 PM');
  assert.equal(w.advice, 'Boots and a warm coat');
  w = show(body({ pops: { 14: 70 }, conds: { 14: 'storm' } }));
  assert.equal(w.summary, 'Storms until 3 PM');
  assert.equal(w.advice, 'Umbrella weather');
});

test('pick takes the first matching rule; string or function says', () => {
  const rules = [
    { when: (wx) => wx.temp > 90, say: 'Hot' },
    { when: (wx) => wx.temp > 80, say: (wx) => 'Warm ' + wx.temp },
    { when: () => true, say: 'Fine' },
  ];
  assert.equal(Advice.pick(rules, { temp: 95 }), 'Hot');
  assert.equal(Advice.pick(rules, { temp: 85 }), 'Warm 85');
  assert.equal(Advice.pick(rules, { temp: 20 }), 'Fine');
  assert.equal(Advice.pick([], {}), '');
});

// ------------------------------------------------------------ the shared refresh loop
test('the weather feed uses its own cache key, timings, parser and change key', async () => {
  let t = at(14, 0).getTime(), body1 = body(), calls = 0;
  const store = {}, timers = [], changes = [];
  const feed = Feed.create({
    url: '/api/weather', cacheKey: 'homehq.weather', refresh: Weather.REFRESH, stale: Weather.STALE,
    parse: Weather.parse, changeKey: Weather.changeKey,
    fetch: () => { calls++; return Promise.resolve({ ok: true, json: () => Promise.resolve(body1) }); },
    storage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } },
    now: () => t,
    setTimeout: (fn, ms) => { const x = { fn, ms }; timers.push(x); return x; },
    clearTimeout: (x) => { const i = timers.indexOf(x); if (i > -1) timers.splice(i, 1); },
    onChange: (d) => changes.push(d),
  });
  await feed.start();
  assert.equal(changes.length, 1);
  assert.equal(changes[0].configured, true);
  assert.ok(store['homehq.weather']);
  assert.equal(store['homehq.calendar'], undefined);
  assert.equal(timers[0].ms, 10 * MIN);

  body1 = body({ updatedAt: at(14, 10) });
  timers.shift().fn();
  await new Promise((r) => setImmediate(r));
  assert.equal(calls, 2);
  assert.equal(changes.length, 1);

  t += 59 * MIN;
  assert.equal(feed.state().stale, false);
  t += 2 * MIN;
  assert.equal(feed.state().stale, true);
});

test('not configured is data, not a failure', async () => {
  const changes = [];
  const feed = Feed.create({
    url: '/api/weather', cacheKey: 'homehq.weather', parse: Weather.parse, changeKey: Weather.changeKey,
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ configured: false }) }),
    storage: null, now: () => 0, setTimeout: () => ({}), clearTimeout: () => {},
    onChange: (d) => changes.push(d),
  });
  await feed.start();
  assert.deepEqual(changes, [{ configured: false }]);
  assert.equal(feed.state().status, 'ok');
  assert.equal(feed.state().failed, false);
});

// ------------------------------------------------------------ review fixes
test('a forecast that starts at the next hour still shows the fresh reading', () => {
  const b = body();
  b.hourly = b.hourly.filter((h) => new Date(h.at) > at(14, 30));
  b.hourly[1].pop = 80; // 4 PM
  const w = show(b);
  assert.equal(w.temp, 61);
  assert.deepEqual(w.hours.map((h) => h.label), ['Now', '3p', '4p', '5p', '6p', '7p', '8p']);
  assert.equal(w.summary, 'Rain from 4 PM');
  // ...but not once the reading is old.
  assert.equal(show(Object.assign(b, { updatedAt: iso(at(12, 0)) })), null);
});

test('unknown conditions show as cloud', () => {
  const b = body({ reading: { temp: 60 }, conds: { 15: 'tornado' } });
  const w = show(b);
  assert.equal(w.cond, 'cloud');
  assert.equal(w.label, 'Cloudy');
  assert.equal(w.hours[1].cond, 'cloud');
});

test('snow for the rest of the day', () => {
  const pops = {}, conds = {};
  for (let h = 14; h < 30; h++) { pops[h] = 80; conds[h] = 'snow'; }
  const w = show(body({ pops, conds }));
  assert.equal(w.summary, 'Snow for the rest of the day');
  assert.equal(w.advice, 'Boots and a warm coat');
});

test('storms later today', () => {
  const w = show(body({ pops: { 18: 60 }, conds: { 18: 'storm' } }));
  assert.equal(w.summary, 'Storms from 6 PM');
  assert.equal(w.advice, 'Grab a rain jacket');
});

test('an HTTP error is answered (server up, Home Assistant down); a network error is not', async () => {
  const make = (fetch) => Feed.create({
    url: '/api/weather', parse: Weather.parse, changeKey: Weather.changeKey, fetch,
    storage: null, now: () => 0, setTimeout: () => ({}), clearTimeout: () => {}, onChange: () => {},
  });
  let feed = make(() => Promise.resolve({ ok: false, status: 502, json: () => Promise.resolve({ error: 'Home Assistant: 401' }) }));
  await feed.start();
  assert.deepEqual([feed.state().status, feed.state().answered], ['offline', true]);
  feed = make(() => Promise.reject(new TypeError('Failed to fetch')));
  await feed.start();
  assert.deepEqual([feed.state().status, feed.state().answered], ['offline', false]);
});

// ------------------------------------------------------------ Weather page
// body() plus what PirateWeather adds: wind, humidity, feels-like, UV, sun, and a week of days.
function richBody(over) {
  const b = body(over);
  Object.assign(b.now, { feels: 58, humidity: 71, wind: 9, gust: 21, bearing: 225, uv: 3,
    sunrise: iso(at(7, 31)), sunset: iso(at(18, 41)) });
  b.hourly.forEach((h, i) => Object.assign(h, { wind: i, bearing: (i * 45) % 360, humidity: 60 + i }));
  b.daily = [];
  for (let d = -1; d < 8; d++) {
    b.daily.push({ at: iso(new Date(2026, 9, 19 + d)), hi: 60 + d, lo: 40 + d, cond: d % 2 ? 'rain' : 'sun', pop: d * 10, wind: 5 + d, gust: 15 + d, bearing: 90, humidity: 70 });
  }
  return b;
}

test('compass points from degrees', () => {
  assert.deepEqual([0, 22, 23, 45, 90, 180, 225, 270, 315, 337, 338, 359].map(Weather.compass),
    ['N', 'N', 'NE', 'NE', 'E', 'S', 'SW', 'W', 'NW', 'NW', 'N', 'N']);
  assert.equal(Weather.compass(undefined), '');
  assert.equal(Weather.compass(null), '');
});

test('parse keeps the extra fields; sunrise and sunset become Dates', () => {
  const d = Weather.parse(richBody());
  assert.deepEqual(Object.assign({}, d.reading, { sunrise: +d.reading.sunrise, sunset: +d.reading.sunset }), {
    temp: 61, cond: 'partly', feels: 58, humidity: 71, wind: 9, gust: 21, bearing: 225, uv: 3,
    sunrise: +at(7, 31), sunset: +at(18, 41),
  });
  assert.deepEqual([d.hourly[3].wind, d.hourly[3].bearing, d.hourly[3].humidity], [3, 135, 63]);
  assert.deepEqual([d.daily[1].cond, d.daily[1].pop, d.daily[1].wind, d.daily[1].gust, d.daily[1].bearing], ['sun', 0, 5, 15, 90]);
  // An older server: the extras are null, not missing numbers that throw
  const old = Weather.parse(body());
  assert.equal(old.reading.wind, null);
  assert.equal(old.reading.sunrise, null);
  assert.equal(old.hourly[0].wind, null);
  assert.equal(old.daily[0].pop, 0);
});

test('the page details use the fresh reading', () => {
  const w = show(richBody(), at(14, 30), 25);
  assert.deepEqual([w.feels, w.humidity, w.wind, w.gust, w.dir, w.uv], [58, 71, 9, 21, 'SW', 3]);
  assert.equal(+w.sunrise, +at(7, 31));
  assert.equal(+w.sunset, +at(18, 41));
  assert.equal(w.hours.length, 22); // Now + 3 PM to 11 AM tomorrow, the end of the forecast
  assert.deepEqual(w.hours[0], { label: 'Now', temp: 61, cond: 'partly', wet: false, pop: 0, wind: 9, dir: 'SW' });
  assert.deepEqual(w.hours[1], { label: '3p', temp: 59, cond: 'cloud', wet: false, pop: 0, wind: 15, dir: 'NW' });
});

test('with an old reading, wind and humidity come from this hour; feels-like, gust and UV are unknown', () => {
  const w = show(richBody({ updatedAt: at(12, 0), pops: { 14: 70 } }), at(14, 30), 25);
  assert.deepEqual([w.feels, w.humidity, w.wind, w.gust, w.dir, w.uv], [null, 74, 14, null, 'W', null]);
  assert.deepEqual(w.hours[0], { label: 'Now', temp: 60, cond: 'cloud', wet: true, pop: 70, wind: 14, dir: 'W' });
});

test('the week is seven days from today', () => {
  const days = Weather.week(Weather.parse(richBody()), at(14, 30));
  assert.equal(days.length, 7);
  assert.equal(+days[0].at, +at(0));
  assert.deepEqual(days[0], { at: days[0].at, hi: 60, lo: 40, cond: 'sun', pop: 0, wind: 5, dir: 'E', wet: false });
  assert.deepEqual([days[1].cond, days[1].pop, days[1].wet], ['rain', 10, false]);
  assert.equal(days[5].wet, true);
  assert.equal(+days[6].at, +new Date(2026, 9, 25));
  // Fewer days at the end of the forecast; none without a forecast
  assert.equal(Weather.week(Weather.parse(richBody()), new Date(2026, 9, 24, 9)).length, 3);
  assert.deepEqual(Weather.week(Weather.parse(body({ daily: false })), at(14, 30)), []);
});

// ------------------------------------------------------------ N-hour steps
test('steps group the hours n at a time: first label and temp, highest chance, strongest wind, wet if any hour is', () => {
  const h = (label, temp, cond, pop, wind, dir) => ({ label, temp, cond, wet: pop >= Advice.WET, pop, wind, dir });
  const hours = [
    h('Now', 61, 'partly', 0, 5, 'N'), h('3p', 60, 'cloud', 20, 12, 'SW'), h('4p', 59, 'cloud', 10, 8, 'S'),
    h('5p', 58, 'cloud', 10, null, ''), h('6p', 57, 'rain', 70, 6, 'W'), h('7p', 56, 'storm', 40, 4, 'W'),
    h('8p', 55, 'cloud', 5, 3, 'E'),
  ];
  assert.deepEqual(Weather.steps(hours, 3), [
    { label: 'Now', temp: 61, cond: 'partly', wet: false, pop: 20, wind: 12, dir: 'SW' },
    { label: '5p', temp: 58, cond: 'rain', wet: true, pop: 70, wind: 6, dir: 'W' },
    { label: '8p', temp: 55, cond: 'cloud', wet: false, pop: 5, wind: 3, dir: 'E' },
  ]);
  // No wind in any hour of a step: none for the step.
  assert.equal(Weather.steps([h('Now', 61, 'sun', 0, null, '')], 3)[0].wind, null);
  // One hour a step is the hours as they are.
  assert.deepEqual(Weather.steps(hours, 1), hours);
  assert.deepEqual(Weather.steps([], 3), []);
});
