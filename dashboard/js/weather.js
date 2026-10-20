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
  // Anything else (an older cache, a new server condition) shows as cloud.
  function cond(c) { return LABELS.hasOwnProperty(c) ? c : 'cloud'; }

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
      reading: { temp: body.now.temp, cond: cond(body.now.cond) },
      hourly: body.hourly.map(function (h) { return { at: new Date(h.at), temp: h.temp, cond: cond(h.cond), pop: h.pop || 0 }; })
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
  // (hours: `count` slots starting with "Now"), or null when there's neither a fresh reading nor a
  // forecast for this hour. A forecast may start at the next hour; then the fresh reading is "now".
  Weather.at = function (data, now, count) {
    var A = root.Advice, list = data.hourly, i = -1, k;
    for (k = 0; k < list.length; k++) if (list[k].at <= now && now - list[k].at < HOUR) i = k;
    var cur = i < 0 ? null : list[i];
    var fresh = Math.abs(now - data.updatedAt) < Weather.READING_MAX;
    if (!cur && !(fresh && list.length && list[0].at > now && list[0].at - now < HOUR)) return null;
    var temp = fresh ? data.reading.temp : cur.temp, c = fresh ? data.reading.cond : cur.cond;
    var next = cur ? i + 1 : 0; // first forecast hour after this one

    // The rest of today: the current hour (if forecast), then the hours after it.
    var wet = function (h) { return h.pop >= A.WET; };
    var later = [];
    for (k = next; k < list.length && sameDay(list[k].at, now); k++) later.push(list[k]);
    var today = cur ? [cur].concat(later) : later;
    var wetNow = !!cur && wet(cur), wetFrom = null, dryAt = null, wetHour = null;
    if (wetNow) {
      wetHour = cur;
      for (k = 0; k < later.length && wet(later[k]); k++);
      dryAt = k < later.length ? later[k].at : null;
    } else {
      for (k = 0; k < later.length; k++) if (wet(later[k])) { wetHour = later[k]; wetFrom = wetHour.at; break; }
    }

    var day = data.daily.filter(function (d) { return sameDay(d.at, now); })[0];
    var temps = today.map(function (h) { return h.temp; }).concat([temp]);
    var hi = day ? day.hi : Math.max.apply(null, temps), lo = day ? day.lo : Math.min.apply(null, temps);

    var wx = {
      now: now, temp: temp, cond: c, hi: hi, lo: lo,
      wetNow: wetNow, wetFrom: wetFrom, dryAt: dryAt,
      precip: (wetHour && PRECIP[wetHour.cond]) || 'Rain'
    };
    var hours = [{ label: 'Now', temp: temp, cond: c, wet: wetNow }];
    for (k = next; k < list.length && hours.length < (count || 7); k++) {
      hours.push({ label: hourLabel(list[k].at), temp: list[k].temp, cond: list[k].cond, wet: wet(list[k]) });
    }
    return {
      temp: temp, cond: c, label: LABELS[c], hi: hi, lo: lo,
      summary: A.pick(A.summaryRules, wx), advice: A.pick(A.adviceRules, wx), hours: hours
    };
  };
})(typeof window !== 'undefined' ? window : globalThis);
