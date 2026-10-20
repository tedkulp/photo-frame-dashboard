// Weather from the home server's GET /api/weather (Home Assistant, already in °F), and what the
// views show for a given moment: current temperature and condition, today's high and low, the
// summary and advice lines (advice.js) and the hourly strip. The refresh loop is Feed.create's.
// Also loads in Node for dashboard/test/weather.test.js.
(function (root) {
  'use strict';
  var Weather = root.Weather = {};
  var MIN = 60000, HOUR = 60 * MIN;
  Weather.REFRESH = 10 * MIN;
  Weather.STALE = 60 * MIN;      // say how old the weather is once no fetch has worked for this long
  Weather.READING_MAX = 60 * MIN; // the current reading stands for "now" only within this of when it was read

  var LABELS = { sun: 'Sunny', moon: 'Clear', partly: 'Partly cloudy', cloud: 'Cloudy', rain: 'Rain', snow: 'Snow', storm: 'Thunderstorms' };
  var PRECIP = { snow: 'Snow', storm: 'Storms' };

  function num(v) { return typeof v === 'number' && isFinite(v); }
  function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }

  // The server's body → { configured: false } or { configured: true, reading, hourly, daily, updatedAt }
  // with Date objects. Throws on anything else.
  Weather.parse = function (body) {
    if (body && body.configured === false) return { configured: false };
    if (!body || body.configured !== true || !body.now || !num(body.now.temp) || !Array.isArray(body.hourly) || !Array.isArray(body.daily)) {
      throw new Error('Unexpected weather response');
    }
    var updatedAt = new Date(body.updatedAt);
    if (isNaN(updatedAt)) throw new Error('Unexpected weather response');
    return {
      configured: true,
      reading: { temp: body.now.temp, cond: body.now.cond },
      hourly: body.hourly.map(function (h) { return { at: new Date(h.at), temp: h.temp, cond: h.cond, pop: h.pop || 0 }; })
        .filter(function (h) { return !isNaN(h.at) && num(h.temp); })
        .sort(function (a, b) { return a.at - b.at; }),
      daily: body.daily.map(function (d) { return { at: new Date(d.at), hi: d.hi, lo: d.lo }; })
        .filter(function (d) { return !isNaN(d.at) && num(d.hi) && num(d.lo); }),
      updatedAt: updatedAt
    };
  };
  // Every load has a new updatedAt; only the weather itself counts as a change.
  Weather.changeKey = function (body) {
    return JSON.stringify(body && body.configured ? [body.now, body.hourly, body.daily] : body);
  };

  function hourLabel(d) { var h = d.getHours(); return (h % 12 || 12) + (h >= 12 ? 'p' : 'a'); }

  // What to show at `now` from parsed data: { temp, cond, label, hi, lo, summary, advice, hours }
  // (hours: `count` slots starting with "Now"), or null when the forecast doesn't cover this hour.
  Weather.at = function (data, now, count) {
    var A = root.Advice, list = data.hourly, i = -1;
    for (var k = 0; k < list.length; k++) if (list[k].at <= now && now - list[k].at < HOUR) i = k;
    if (i < 0) return null;
    var cur = list[i];
    var fresh = Math.abs(now - data.updatedAt) < Weather.READING_MAX;
    var temp = fresh ? data.reading.temp : cur.temp, cond = fresh ? data.reading.cond : cur.cond;

    // The rest of today, from the current hour.
    var today = [];
    for (k = i; k < list.length && sameDay(list[k].at, now); k++) today.push(list[k]);
    var wet = function (h) { return h.pop >= A.WET; };
    var wetNow = wet(cur), wetFrom = null, dryAt = null, wetHour = null;
    if (wetNow) {
      wetHour = cur;
      for (k = 1; k < today.length && wet(today[k]); k++);
      dryAt = k < today.length ? today[k].at : null;
    } else {
      for (k = 1; k < today.length; k++) if (wet(today[k])) { wetHour = today[k]; wetFrom = wetHour.at; break; }
    }

    var day = data.daily.filter(function (d) { return sameDay(d.at, now); })[0];
    var temps = today.map(function (h) { return h.temp; }).concat([temp]);
    var hi = day ? day.hi : Math.max.apply(null, temps), lo = day ? day.lo : Math.min.apply(null, temps);

    var wx = {
      now: now, temp: temp, cond: cond, hi: hi, lo: lo,
      wetNow: wetNow, wetFrom: wetFrom, dryAt: dryAt,
      precip: (wetHour && PRECIP[wetHour.cond]) || 'Rain'
    };
    var hours = [{ label: 'Now', temp: temp, cond: cond, wet: wetNow }];
    for (k = i + 1; k < list.length && hours.length < (count || 7); k++) {
      hours.push({ label: hourLabel(list[k].at), temp: list[k].temp, cond: list[k].cond, wet: wet(list[k]) });
    }
    return {
      temp: temp, cond: cond, label: LABELS[cond] || '', hi: hi, lo: lo,
      summary: A.pick(A.summaryRules, wx), advice: A.pick(A.adviceRules, wx), hours: hours
    };
  };
})(typeof window !== 'undefined' ? window : globalThis);
