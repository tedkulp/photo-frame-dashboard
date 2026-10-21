// Weather from the home server's GET /api/weather (Home Assistant, already in °F), and what the
// views show for a given moment: current temperature and condition, today's high and low, the
// summary and advice lines (advice.js), the hourly strip, the Weather page's details (feels-like,
// humidity, wind, UV, sunrise and sunset) and its week. The refresh loop is Feed.create's.
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
  function orNull(v) { return num(v) ? v : null; }
  function date(v) { var d = v ? new Date(v) : null; return d && !isNaN(d) ? d : null; }

  // 225 → 'SW'. '' when there is no bearing.
  var POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  Weather.compass = function (deg) {
    return num(deg) ? POINTS[Math.round(((deg % 360) + 360) % 360 / 45) % 8] : '';
  };
  function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }

  // The server's body → { configured: false } or { configured: true, reading, hourly, daily, updatedAt }
  // with Date objects. Throws on anything else. Fields an older server or the entity leaves out
  // (feels-like, humidity, wind, UV, sun) are null.
  Weather.parse = function (body) {
    if (body && body.configured === false) return { configured: false };
    if (!body || body.configured !== true || !body.now || !num(body.now.temp) || !Array.isArray(body.hourly) || !Array.isArray(body.daily)) {
      throw new Error('Unexpected weather response');
    }
    var updatedAt = new Date(body.updatedAt), n = body.now;
    if (isNaN(updatedAt)) throw new Error('Unexpected weather response');
    return {
      configured: true,
      reading: {
        temp: n.temp, cond: cond(n.cond), feels: orNull(n.feels), humidity: orNull(n.humidity),
        wind: orNull(n.wind), gust: orNull(n.gust), bearing: orNull(n.bearing), uv: orNull(n.uv),
        sunrise: date(n.sunrise), sunset: date(n.sunset)
      },
      hourly: body.hourly.map(function (h) {
        return { at: new Date(h.at), temp: h.temp, cond: cond(h.cond), pop: h.pop || 0, wind: orNull(h.wind), bearing: orNull(h.bearing), humidity: orNull(h.humidity) };
      })
        .filter(function (h) { return !isNaN(h.at) && num(h.temp); })
        .sort(function (a, b) { return a.at - b.at; }),
      daily: body.daily.map(function (d) {
        return { at: new Date(d.at), hi: d.hi, lo: d.lo, cond: cond(d.cond), pop: d.pop || 0, wind: orNull(d.wind), gust: orNull(d.gust), bearing: orNull(d.bearing) };
      })
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
  // (hours: `count` slots starting with "Now", each { label, temp, cond, wet, pop, wind, dir }), or
  // null when there's neither a fresh reading nor a forecast for this hour. A forecast may start at
  // the next hour; then the fresh reading is "now". The Weather page's details come along: feels,
  // humidity, wind, gust, dir (compass point), uv, sunrise, sunset; from the fresh reading, else
  // humidity and wind from this hour's forecast and the rest null.
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
    var r = data.reading, src = fresh ? r : cur;
    var wind = src.wind, bearing = src.bearing;
    var hours = [{ label: 'Now', temp: temp, cond: c, wet: wetNow, pop: cur ? cur.pop : 0, wind: wind, dir: Weather.compass(bearing) }];
    for (k = next; k < list.length && hours.length < (count || 7); k++) {
      var h = list[k];
      hours.push({ label: hourLabel(h.at), temp: h.temp, cond: h.cond, wet: wet(h), pop: h.pop, wind: h.wind, dir: Weather.compass(h.bearing) });
    }
    return {
      temp: temp, cond: c, label: LABELS[c], hi: hi, lo: lo,
      summary: A.pick(A.summaryRules, wx), advice: A.pick(A.adviceRules, wx), hours: hours,
      feels: fresh ? r.feels : null, humidity: src.humidity, wind: wind, gust: fresh ? r.gust : null,
      dir: Weather.compass(bearing), uv: fresh ? r.uv : null, sunrise: r.sunrise, sunset: r.sunset
    };
  };

  // The Weather page's week: up to seven days from today, each { at, hi, lo, cond, pop, wind, dir, wet }
  // (wet: the day's chance of precipitation reaches the wet-hour threshold).
  Weather.week = function (data, now) {
    var start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return data.daily.filter(function (d) { return d.at >= start; }).slice(0, 7).map(function (d) {
      return { at: d.at, hi: d.hi, lo: d.lo, cond: d.cond, pop: d.pop, wind: d.wind, dir: Weather.compass(d.bearing), wet: d.pop >= root.Advice.WET };
    });
  };
})(typeof window !== 'undefined' ? window : globalThis);
