// Calendar feed: real people + events from the home server's GET /api/calendar.
// Refreshes every 5 minutes, retries failures with backoff (Wi-Fi comes up after the page at boot)
// and caches the last good response so an offline boot still shows the calendar. Also adds and
// deletes events through POST /api/events and DELETE /api/events/:id. The refresh loop is shared:
// the weather feed (weather.js) is the same loop with its own URL, cache, timings and parser.
(function (root) {
  'use strict';
  var Feed = root.Feed = {};
  var MIN = 60000;
  var REFRESH = 5 * MIN, STALE = 15 * MIN, RETRY_FIRST = 5000, RETRY_MAX = 5 * MIN, TIMEOUT = 30000;
  var CACHE_KEY = 'homehq.calendar';
  var UNREACHABLE = Feed.UNREACHABLE = 'Can’t reach the home server';
  var NO_ANSWER = 'No answer from the home server · check the calendar before trying again';

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
  // Optional, for feeds other than the calendar: cacheKey, refresh and stale (ms), parse(body) (throws
  // on a bad body) and changeKey(body) (a string that changes only when the data does).
  Feed.create = function (o) {
    var cacheKey = o.cacheKey || CACHE_KEY, refresh = o.refresh || REFRESH, staleMs = o.stale || STALE;
    var parse = o.parse || Feed.parse;
    var changeKey = o.changeKey || function (body) { return JSON.stringify([body.people, body.events]); };
    var lastOk = null, lastBody = null, failures = 0, timer = null, status = 'loading';
    var failed = false; // the last calendar fetch, or an add/delete, failed (no answer or a 5xx)
    var answered = false; // the last failed fetch got an HTTP error back: the server is up, something behind it isn't

    function read() {
      try { var c = JSON.parse(o.storage.getItem(cacheKey)); return c && c.body && c.at ? c : null; } catch (e) { return null; }
    }
    function write(body, at) {
      try { o.storage.setItem(cacheKey, JSON.stringify({ at: at, body: body })); } catch (e) {}
    }
    // Takes a good body fetched (or cached) at `at`; returns false, changing nothing, if it doesn't
    // parse. State is updated before onChange so views re-rendering from it see the new state.
    function apply(body, at) {
      // updatedAt changes on every server load; only the data counts as a change.
      var text, parsed = null;
      try { text = changeKey(body); } catch (e) { return false; }
      if (text !== lastBody) {
        try { parsed = parse(body); } catch (e) { return false; }
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
      failed = true;
      if (status !== 'ok') status = 'offline';
      schedule(Math.min(RETRY_FIRST * Math.pow(2, failures++), RETRY_MAX));
    }
    // A request that never settles (Wi-Fi dropped mid-request) would otherwise stop the loop for good.
    function withTimeout(p) {
      return new Promise(function (ok, no) {
        var t = o.setTimeout(function () { var e = new Error('Timed out'); e.timedOut = true; no(e); }, TIMEOUT);
        p.then(function (v) { o.clearTimeout(t); ok(v); }, function (e) { o.clearTimeout(t); no(e); });
      });
    }
    function load() {
      var p;
      try { p = Promise.resolve(o.fetch(o.url, { cache: 'no-store' })); } catch (e) { p = Promise.reject(e); }
      return withTimeout(p.then(function (res) {
        if (!res.ok) { var e = new Error('HTTP ' + res.status); e.answered = true; throw e; }
        return res.json();
      })).then(function (body) {
        if (!apply(body, o.now())) throw new Error('Unexpected response');
        write(body, lastOk);
        failures = 0;
        failed = false;
        answered = false;
        schedule(refresh);
      }).catch(function (e) { answered = !!(e && e.answered); fail(); }).then(function () { if (o.onState) o.onState(); });
    }

    // An add or delete. Resolves with the JSON body (null for 204); rejects with the server's error,
    // UNREACHABLE when the request failed outright, or NO_ANSWER when it timed out (the server may
    // still have done it). No answer or a 5xx counts as a failed fetch, so adding turns off and the
    // calendar is retried soon. On success the calendar is refreshed right away.
    function send(method, url, body) {
      function failNow(e) { fail(); if (o.onState) o.onState(); return e; }
      var init = { method: method, cache: 'no-store' }, p;
      if (body !== undefined) { init.headers = { 'content-type': 'application/json' }; init.body = JSON.stringify(body); }
      try { p = Promise.resolve(o.fetch(url, init)); } catch (e) { p = Promise.reject(e); }
      return withTimeout(p).then(function (res) {
        return (res.status === 204 ? Promise.resolve(null) : res.json()).catch(function () { return null; }).then(function (out) {
          var err = !res.ok && new Error((out && out.error) || 'HTTP ' + res.status);
          if (err) throw res.status >= 500 ? failNow(err) : err;
          schedule(0);
          return out;
        });
      }, function (e) {
        throw failNow(new Error(e && e.timedOut ? NO_ANSWER : UNREACHABLE));
      });
    }

    return {
      // { title, start, end, people, allDay? } with ISO strings → the created event, parsed.
      add: function (input) {
        return send('POST', '/api/events', input).then(function (raw) {
          var e = raw && toEvent(raw);
          if (!e || isNaN(e.start) || isNaN(e.end)) throw new Error('Unexpected response from the home server');
          return e;
        });
      },
      remove: function (id) {
        return send('DELETE', '/api/events/' + encodeURIComponent(id)).then(function () {});
      },
      start: function () {
        var c = read();
        if (c) apply(c.body, c.at);
        return load();
      },
      // status: 'loading' (nothing yet) | 'offline' (nothing yet, fetches failing) | 'ok' (have data).
      // age: whole minutes since the last successful fetch; stale once that reaches 15 (or o.stale).
      // failed: the last request did not work (cleared by the next good calendar fetch).
      // answered: the last failed fetch got an HTTP error, so the server is reachable.
      state: function () {
        var age = lastOk == null ? null : Math.floor((o.now() - lastOk) / MIN);
        return { status: status, age: age, stale: age != null && age * MIN >= staleMs, failed: failed, answered: answered };
      }
    };
  };
})(typeof window !== 'undefined' ? window : globalThis);
