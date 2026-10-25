// The Weather page's radar from the home server's GET /api/radar (LibreWXR frames on an OSM map,
// ADR 0006): parsing the listing, each frame's label, the note over the map and the loop's timing.
// The view fetches the listing only while the Weather page is on screen. Also loads in Node for
// dashboard/test/radar.test.js.
(function (root) {
  'use strict';
  var Radar = root.Radar = {};
  var MIN = 60000;
  Radar.REFRESH = 10 * MIN;  // the listing, while the Weather page is on screen
  Radar.OLD = 20 * MIN;      // say how old the radar is once its newest past frame is older than this
  Radar.STEP = 500;          // ms per frame in the loop
  Radar.PAUSE = 2000;        // ms on the latest past frame (now) and on the last frame

  function num(v) { return typeof v === 'number' && isFinite(v); }
  function text(v) { return typeof v === 'string' && v !== ''; }

  // The server's body → { configured: false } or { configured: true, frames: [{ id, at, nowcast,
  // url }] oldest first, latest (index of the newest past frame, -1 without one), stale, age,
  // map: [{ url, left, top }], size, tile }. Throws on anything else.
  Radar.parse = function (body) {
    if (body && body.configured === false) return { configured: false };
    if (!body || body.configured !== true || !Array.isArray(body.frames) || !Array.isArray(body.map) || !num(body.size) || !num(body.tile)) {
      throw new Error('Unexpected radar response');
    }
    var frames = body.frames.map(function (f) {
      return { id: f.id, at: new Date(f.at), nowcast: f.nowcast === true, url: f.url };
    }).filter(function (f) { return !isNaN(f.at) && text(f.id) && text(f.url); });
    var latest = -1;
    frames.forEach(function (f, i) { if (!f.nowcast) latest = i; });
    return {
      configured: true, frames: frames, latest: latest, stale: body.stale === true, age: num(body.age) ? body.age : null,
      map: body.map.filter(function (t) { return t && text(t.url) && num(t.left) && num(t.top); })
        .map(function (t) { return { url: t.url, left: t.left, top: t.top }; }),
      size: body.size, tile: body.tile
    };
  };

  function clock(d) {
    var h = d.getHours(), m = d.getMinutes();
    return (h % 12 || 12) + ':' + (m < 10 ? '0' : '') + m + ' ' + (h >= 12 ? 'pm' : 'am');
  }

  // "3:40 pm" for a past frame, "+20 min" for a nowcast one (after the latest past frame).
  Radar.label = function (r, i) {
    var f = r.frames[i];
    if (!f.nowcast || r.latest < 0) return clock(f.at);
    return '+' + Math.round((f.at - r.frames[r.latest].at) / MIN) + ' min';
  };

  // What to say over the map at `now`: 'Radar unavailable' without frames, 'Radar from 3:10 pm' once
  // the newest past frame is over Radar.OLD old, else ''.
  Radar.note = function (r, now) {
    if (!r.frames.length) return 'Radar unavailable';
    var f = r.latest < 0 ? null : r.frames[r.latest];
    return f && now - f.at > Radar.OLD ? 'Radar from ' + clock(f.at) : '';
  };

  // The loop: oldest → newest and round again, starting on (and pausing on) the latest past frame.
  Radar.first = function (r) { return r.latest < 0 ? 0 : r.latest; };
  Radar.next = function (r, i) { return (i + 1) % r.frames.length; };
  Radar.delay = function (r, i) { return i === r.latest || i === r.frames.length - 1 ? Radar.PAUSE : Radar.STEP; };
})(typeof window !== 'undefined' ? window : globalThis);
