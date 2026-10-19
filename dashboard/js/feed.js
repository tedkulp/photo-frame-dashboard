// Calendar feed: real people + events from the home server's GET /api/calendar.
// Refreshes every 5 minutes, retries failures with backoff (Wi-Fi comes up after the page at boot)
// and caches the last good response so an offline boot still shows the calendar.
(function (root) {
  'use strict';
  var Feed = root.Feed = {};
  var MIN = 60000;
  var REFRESH = 5 * MIN, STALE = 15 * MIN, RETRY_FIRST = 5000, RETRY_MAX = 5 * MIN, TIMEOUT = 30000;
  var CACHE_KEY = 'homehq.calendar';

  // ------------------------------------------------------------ people
  function channel(v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
  // { id, name, colour: '#RRGGBB' } → the shape views use: color, "r g b" triplet, readable ink.
  Feed.person = function (p) {
    var hex = p.colour.slice(1);
    var rgb = [0, 2, 4].map(function (i) { return parseInt(hex.slice(i, i + 2), 16); });
    var lum = 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
    // Whichever ink contrasts more: white (L=1) or the near-black #111111 (L≈0.0056).
    var dark = (lum + 0.05) / 0.0556 > 1.05 / (lum + 0.05);
    return { id: p.id, name: p.name, color: p.colour, rgb: rgb.join(' '), ink: dark ? '#111111' : '#FFFFFF' };
  };

  // ------------------------------------------------------------ events
  // All-day events carry plain dates ("2026-10-19"), which Date would read as UTC midnight;
  // build local midnight instead so they land on that date in the frame's time zone.
  function toDate(s, allDay) {
    var m = allDay && /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(s);
  }
  function toEvent(raw) {
    var e = { id: raw.id, title: raw.title, start: toDate(raw.start, raw.allDay), end: toDate(raw.end, raw.allDay), people: raw.people || [] };
    if (raw.allDay) e.allDay = true;
    if (raw.loc) e.loc = raw.loc;
    if (raw.notes) e.notes = raw.notes;
    return e;
  }
  // The server's { people, events, updatedAt } → { people, events } with Date objects.
  Feed.parse = function (body) {
    if (!body || !Array.isArray(body.people) || !body.people.length || !Array.isArray(body.events)) throw new Error('Unexpected calendar response');
    return {
      people: body.people.map(Feed.person),
      events: body.events.map(toEvent).filter(function (e) { return !isNaN(e.start) && !isNaN(e.end); })
    };
  };

  // ------------------------------------------------------------ still-mock data
  // Chores, stars and photos are still mock; hand them to real people by position (mock person 1
  // → real person 1). Entries for positions beyond the real list are dropped.
  Feed.remap = function (D, from, to) {
    var map = {};
    from.forEach(function (id, i) { if (i < to.length) map[id] = to[i]; });
    function keep(id) { return id === 'any' || id in map; }
    function move(id) { return id === 'any' ? id : map[id]; }
    D.chores = D.chores.filter(function (c) { return keep(c.who); });
    D.chores.forEach(function (c) {
      c.who = move(c.who);
      if (c.doneBy) { if (c.doneBy in map) c.doneBy = map[c.doneBy]; else delete c.doneBy; }
    });
    ['stars', 'week'].forEach(function (k) {
      var out = {};
      Object.keys(D[k]).forEach(function (id) { if (id in map) out[map[id]] = D[k][id]; });
      D[k] = out;
    });
    D.photos = D.photos.filter(function (p) { return p.from in map; });
    D.photos.forEach(function (p) { p.from = map[p.from]; });
  };

  // ------------------------------------------------------------ refresh loop
  // deps: url, fetch, storage, now, setTimeout, clearTimeout, onChange(parsed) when the data changes,
  // onState() after every fetch attempt, onError(e) if onChange throws. Injected for tests.
  Feed.create = function (o) {
    var lastOk = null, lastBody = null, failures = 0, timer = null, status = 'loading';

    function read() {
      try { var c = JSON.parse(o.storage.getItem(CACHE_KEY)); return c && c.body && c.at ? c : null; } catch (e) { return null; }
    }
    function write(body, at) {
      try { o.storage.setItem(CACHE_KEY, JSON.stringify({ at: at, body: body })); } catch (e) {}
    }
    // Takes a good body fetched (or cached) at `at`; returns false, changing nothing, if it doesn't
    // parse. State is updated before onChange so views re-rendering from it see the new state.
    function apply(body, at) {
      // updatedAt changes on every server load; only people + events count as a change.
      var text = JSON.stringify([body.people, body.events]), parsed = null;
      if (text !== lastBody) {
        try { parsed = Feed.parse(body); } catch (e) { return false; }
        lastBody = text;
      }
      lastOk = at;
      status = 'ok';
      // A view failing to render the data is not a fetch failure: keep the data, cache and schedule.
      if (parsed) try { o.onChange(parsed); } catch (e) { if (o.onError) o.onError(e); }
      return true;
    }
    function schedule(ms) { o.clearTimeout(timer); timer = o.setTimeout(load, ms); }
    function fail() {
      if (status !== 'ok') status = 'offline';
      schedule(Math.min(RETRY_FIRST * Math.pow(2, failures++), RETRY_MAX));
    }
    // A request that never settles (Wi-Fi dropped mid-request) would otherwise stop the loop for good.
    function withTimeout(p) {
      return new Promise(function (ok, no) {
        var t = o.setTimeout(function () { no(new Error('Timed out')); }, TIMEOUT);
        p.then(function (v) { o.clearTimeout(t); ok(v); }, function (e) { o.clearTimeout(t); no(e); });
      });
    }
    function load() {
      var p;
      try { p = Promise.resolve(o.fetch(o.url, { cache: 'no-store' })); } catch (e) { p = Promise.reject(e); }
      return withTimeout(p.then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })).then(function (body) {
        if (!apply(body, o.now())) throw new Error('Unexpected calendar response');
        write(body, lastOk);
        failures = 0;
        schedule(REFRESH);
      }).catch(fail).then(function () { if (o.onState) o.onState(); });
    }

    return {
      start: function () {
        var c = read();
        if (c) apply(c.body, c.at);
        return load();
      },
      // status: 'loading' (nothing yet) | 'offline' (nothing yet, fetches failing) | 'ok' (have data).
      // age: whole minutes since the last successful fetch; stale once that reaches 15.
      state: function () {
        var age = lastOk == null ? null : Math.floor((o.now() - lastOk) / MIN);
        return { status: status, age: age, stale: age != null && age * MIN >= STALE };
      }
    };
  };
})(typeof window !== 'undefined' ? window : globalThis);
