// Home controls from the home server's GET /api/home (Home Assistant entities with the `frame`
// label, see docs/adr/0003), and the optimistic side of tapping them: a tap shows at once with a
// pending mark, a later poll that shows the new state confirms it, and one that hasn't within 5 s
// puts it back. The refresh loop is Feed.create's (3 s while Home controls is open, 60 s otherwise).
// Also loads in Node for dashboard/test/house.test.js.
(function (root) {
  'use strict';
  var House = root.House = {};
  var MIN = 60000;
  House.REFRESH_OPEN = 3000;  // while Home controls is the current view
  House.REFRESH_IDLE = MIN;   // otherwise (the Today card)
  House.STALE = 2 * MIN;      // no good fetch for this long: treat Home Assistant as unreachable
  House.CONFIRM_MS = 5000;    // a tap not seen in the data by then is put back
  House.CAMERA_MS = 20000;    // camera snapshots, only while Home controls is visible
  House.CAMERAS_MAX = 4;      // cameras Home controls shows (a 2×2 grid), first in the server's order

  var KINDS = { light: true, switch: true, fan: true, lock: true, toggle: true };

  function num(v) { return typeof v === 'number' && isFinite(v); }
  function str(v) { return typeof v === 'string'; }
  function isTile(t) { return !!t && str(t.id) && str(t.name) && KINDS[t.kind] === true; }
  function named(x) { return !!x && str(x.id) && str(x.name); }
  function copy(o) { var out = {}; Object.keys(o).forEach(function (k) { out[k] = o[k]; }); return out; }

  // The server's body → { configured: false } or { configured: true, connected, updated (Date or
  // null), rooms, climate, scenes, cameras, media, presence } in the server's order. Throws on
  // anything else; drops malformed tiles (and rooms left empty), scenes, cameras, players and
  // presence entries (a missing or malformed presence is {}: nobody's known).
  House.parse = function (body) {
    if (body && body.configured === false) return { configured: false };
    if (!body || body.configured !== true || !Array.isArray(body.rooms) || !Array.isArray(body.scenes) ||
        !Array.isArray(body.cameras) || !Array.isArray(body.media)) {
      throw new Error('Unexpected home response');
    }
    var updated = str(body.updated) ? new Date(body.updated) : null;
    return {
      configured: true,
      connected: body.connected === true,
      updated: updated && !isNaN(updated) ? updated : null,
      rooms: body.rooms.filter(function (r) { return r && str(r.name) && Array.isArray(r.tiles); })
        .map(function (r) { return { name: r.name, tiles: r.tiles.filter(isTile).map(copy) }; })
        .filter(function (r) { return r.tiles.length; }),
      climate: named(body.climate) && Array.isArray(body.climate.modes) ? copy(body.climate) : null,
      scenes: body.scenes.filter(named).map(function (s) { return { id: s.id, name: s.name, icon: str(s.icon) ? s.icon : null }; }),
      cameras: body.cameras.filter(named).map(copy),
      media: body.media.filter(named).map(copy),
      presence: presence(body.presence)
    };
  };
  function presence(p) {
    var out = {};
    if (!p || typeof p !== 'object' || Array.isArray(p)) return out;
    Object.keys(p).forEach(function (id) { if (p[id] === 'home' || p[id] === 'away') out[id] = p[id]; });
    return out;
  }

  // A person's presence in the data: 'home', 'away', or 'unknown' (unlinked, HA doesn't know, HA
  // not set up or not connected, or nothing loaded yet). Unknown is shown like home, so missing
  // data never says away.
  House.presence = function (data, id) {
    var p = data && data.configured && data.connected && data.presence;
    return p && Object.prototype.hasOwnProperty.call(p, id) ? p[id] : 'unknown';
  };
  // The cameras Home controls shows: the first CAMERAS_MAX in the server's order (by name).
  House.cameras = function (data) {
    return data && data.configured ? data.cameras.slice(0, House.CAMERAS_MAX) : [];
  };

  House.changeKey = function (body) { return JSON.stringify(body); };

  // ------------------------------------------------------------ optimistic changes
  // An action (POST /api/home/:id { action, value }) → { show, match }: what the entity looks like
  // straight away, and the fields a poll must show to confirm it. null for actions with no state
  // to show (running a scene).
  House.expect = function (action, value) {
    var both = function (o) { return { show: o, match: copy(o) }; };
    switch (action) {
      case 'on': return both({ on: true });
      case 'off': return { show: { on: false, level: null }, match: { on: false } };
      case 'level': return both({ on: true, level: value });
      // By HA's state, so a lock still `unlocking` (or jammed) isn't taken as done.
      case 'lock': return { show: { locked: true, state: 'locked' }, match: { state: 'locked' } };
      case 'unlock': return { show: { locked: false, state: 'unlocked' }, match: { state: 'unlocked' } };
      case 'mode': return both({ mode: value });
      case 'target': return both({ target: value });
      case 'range': return both({ low: value.low, high: value.high });
      case 'play': return both({ state: 'playing' });
      case 'pause': return both({ state: 'paused' });
    }
    return null;
  };

  // Every entity in the data that can have a pending change: tiles, the climate, the players.
  function entities(data) {
    var out = [];
    data.rooms.forEach(function (r) { out.push.apply(out, r.tiles); });
    if (data.climate) out.push(data.climate);
    out.push.apply(out, data.media);
    return out;
  }
  function find(data, id) {
    if (!data || !data.configured) return null;
    return entities(data).filter(function (e) { return e.id === id; })[0] || null;
  }
  // Brightness goes through HA's 0–255, so a level 1% off still counts.
  function matches(e, match) {
    return Object.keys(match).every(function (k) {
      return k === 'level' && num(e[k]) && num(match[k]) ? Math.abs(e[k] - match[k]) <= 1 : e[k] === match[k];
    });
  }

  // The data with pending changes ({ key: { id, name, show, match, at } }) shown over it, each
  // changed entity marked `pending: true`. Copies what it changes; the data is left alone.
  House.view = function (data, pending) {
    if (!data || !data.configured) return data;
    var keys = Object.keys(pending || {});
    if (!keys.length) return data;
    function over(e) {
      var mine = keys.filter(function (k) { return pending[k].id === e.id; });
      if (!mine.length) return e;
      var out = copy(e);
      mine.forEach(function (k) { Object.keys(pending[k].show).forEach(function (f) { out[f] = pending[k].show[f]; }); });
      out.pending = true;
      return out;
    }
    var v = copy(data);
    v.rooms = data.rooms.map(function (r) { return { name: r.name, tiles: r.tiles.map(over) }; });
    v.climate = data.climate && over(data.climate);
    v.media = data.media.map(over);
    return v;
  };

  // Takes out of `pending` the changes the data now shows (confirmed: their keys) and the ones
  // sent CONFIRM_MS or more ago that it still doesn't (expired: the entries, for the toast).
  // Entries with `at: null` are not sent yet (debouncing) and are left alone.
  House.settle = function (data, pending, now) {
    var out = { confirmed: [], expired: [] };
    Object.keys(pending).forEach(function (k) {
      var p = pending[k];
      if (p.at == null) return;
      var e = find(data, p.id);
      if (e && matches(e, p.match)) { out.confirmed.push(k); delete pending[k]; }
      else if (now - p.at >= House.CONFIRM_MS) { out.expired.push(p); delete pending[k]; }
    });
    return out;
  };

  // ------------------------------------------------------------ what the views show
  // Whether a room's "All off" turns this tile off (the server's: available lights, switches and
  // fans; only the ones on are shown going off).
  House.turnsOff = function (t) { return !!(t.available && t.on) && /^(light|switch|fan)$/.test(t.kind); };

  // Summary numbers for Home controls and the Today card.
  House.stats = function (data) {
    var lights = [], locks = [], rooms = 0;
    data.rooms.forEach(function (r) {
      var on = r.tiles.filter(function (t) { return t.kind === 'light' && t.on; });
      if (on.length) rooms++;
      lights.push.apply(lights, on);
      locks.push.apply(locks, r.tiles.filter(function (t) { return t.kind === 'lock'; }));
    });
    return {
      lightsOn: lights.length,
      lightRooms: rooms,
      locks: locks.length,
      unlocked: locks.filter(function (t) { return t.available && !t.locked; }).map(function (t) { return t.name; }),
      locksOffline: locks.filter(function (t) { return !t.available; }).length,
      inside: data.climate && num(data.climate.current) ? data.climate.current : null
    };
  };

  // The night screen's lock line from the home data (App.home()) and its note (App.homeNote()):
  // null (hide it: nothing true to say), { warn: false, text: 'House locked' } or
  // { warn: true, text: '<first> unlocked[ +N]' }. A known-unlocked lock wins over an offline one;
  // an offline lock alone means the house can't be vouched for.
  House.nightLock = function (data, note) {
    if (note || !data || !data.configured) return null;
    var s = House.stats(data);
    if (s.unlocked.length) {
      return { warn: true, text: s.unlocked[0] + ' unlocked' + (s.unlocked.length > 1 ? ' +' + (s.unlocked.length - 1) : '') };
    }
    if (!s.locks || s.locksOffline) return null;
    return { warn: false, text: 'House locked' };
  };

  // The player for the media card: the first one playing, else the one shown last (lastId) while
  // it is only paused, so pausing from the frame doesn't take away the play button. null: nothing.
  House.nowPlaying = function (media, lastId) {
    var playing = media.filter(function (m) { return m.available && m.state === 'playing'; })[0];
    if (playing) return playing;
    return media.filter(function (m) { return m.id === lastId && m.available && m.state === 'paused'; })[0] || null;
  };

  // HA's mdi:… icon → the nearest App.icon, by the first rule whose pattern matches.
  var SCENE_ICONS = [
    [/night|sleep|bed|moon/, 'moon'],
    [/sunrise|sunset|coffee|alarm/, 'sunrise'],
    [/sunny|sun/, 'sun'],
    [/movie|film|television|theater|tv|popcorn/, 'film'],
    [/silverware|food|utensils|pot|chef|glass/, 'utensils'],
    [/exit|run|walk|logout|export|airplane|car/, 'away'],
    [/lightbulb|lamp|ceiling-light|floor-lamp/, 'bulb'],
    [/lock|shield/, 'lock'],
    [/music|speaker|spotify/, 'music'],
    [/power|flash|lightning/, 'bolt'],
    [/home|house/, 'home'],
    [/heart/, 'heart']
  ];
  House.sceneIcon = function (mdi) {
    var name = str(mdi) ? mdi.replace(/^mdi:/, '') : '';
    for (var i = 0; i < SCENE_ICONS.length; i++) if (SCENE_ICONS[i][0].test(name)) return SCENE_ICONS[i][1];
    return 'star';
  };

  function ago(mins) {
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + ' min ago';
    return Math.floor(mins / 60) + ' hr ago';
  }
  // Why Home controls can't be trusted right now ('' when it can): nothing loaded yet, no home
  // server, Home Assistant not set up, or Home Assistant (or the server) unreachable, with how old
  // the last state is. `state` is the feed's state(). While there's a note, taps are refused.
  House.note = function (state, data, now) {
    if (state.status === 'loading') return 'Loading Home Assistant…';
    if (state.status === 'offline' || !data) return 'Can’t reach the home server · retrying';
    if (!data.configured) return 'Home Assistant isn’t set up';
    var down = 'Home Assistant unreachable';
    if (!data.connected) return data.updated ? down + ' · updated ' + ago(Math.floor((now - data.updated) / MIN)) : down;
    if (state.failed || state.stale) return down + ' · updated ' + ago(state.age || 0);
    return '';
  };
})(typeof window !== 'undefined' ? window : globalThis);
