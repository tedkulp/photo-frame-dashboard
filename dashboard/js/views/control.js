// Home controls: the real house from Home Assistant (GET /api/home, see house.js): summary,
// scenes, rooms of tiles, climate, cameras, media. Taps go through App.homeAct (optimistic, with a
// pending mark until a poll confirms them).
(function () {
  'use strict';
  var H = window.House;
  // html/heads/tiles: what each part, room header and tile was last painted with, so a poll only
  // repaints what changed (a full paint rebuilds ~270 nodes, ~350 ms on the wall tablet).
  var V = { el: null, sheetBox: null, html: {}, heads: {}, tiles: {}, roomsKey: null, drag: null, camTimer: null, camAt: 0, mediaId: null, live: false };
  var MODES = { heat: 'Heat', cool: 'Cool', heat_cool: 'Auto', off: 'Off' };
  var ACTIONS = { heating: 'Heating', cooling: 'Cooling', drying: 'Drying', fan: 'Fan', idle: 'Idle', off: 'Off' };
  var esc = App.esc;

  function data() { var h = App.home(); return h && h.configured ? h : null; }
  function tiles(h) {
    var out = [];
    if (h) h.rooms.forEach(function (r) { out.push.apply(out, r.tiles); });
    return out;
  }
  function findTile(id) { return tiles(data()).filter(function (t) { return t.id === id; })[0] || null; }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // ------------------------------------------------------------ tiles
  function tile(t) {
    var cls = 'tile tile--' + t.kind, style = '', icon, state, num = false;
    if (t.kind === 'light') {
      icon = 'bulb';
      if (t.on) cls += ' is-on';
      if (t.dimmable) style = ' style="--lvl:' + (t.on ? (t.level || 100) : 0) + '%"';
      num = t.on && t.dimmable && t.level != null;
      state = num ? t.level + '%' : t.on ? 'On' : 'Off';
    } else if (t.kind === 'lock') {
      icon = t.locked ? 'lock' : 'unlock';
      if (!t.locked && t.available) cls += ' is-warn';
      state = t.state === 'locked' ? 'Locked<small>Tap to unlock</small>'
        : t.state === 'unlocked' ? 'Unlocked<small>Tap to lock</small>'
        : esc(cap(t.state)) + (/ing$/.test(t.state) ? '…' : '');
    } else {
      icon = t.kind === 'fan' ? 'fan' : 'bolt';
      if (t.on) cls += ' is-on';
      state = t.on ? 'On' : 'Off';
    }
    if (!t.available) { cls += ' is-offline'; state = 'Offline'; num = false; }
    return '<div class="' + cls + '" data-dev="' + esc(t.id) + '"' + style + '>' +
      (style ? '<span class="tile-fill"></span>' : '') + (t.pending ? '<i class="pend"></i>' : '') +
      '<span class="tile-icon">' + App.icon(icon, 28) + '</span>' +
      '<span class="tile-name">' + esc(t.name) + '</span>' +
      '<span class="tile-state' + (num ? ' num' : '') + '">' + state + '</span></div>';
  }

  function tap(t) {
    if (!t || !t.available) return;
    if (t.kind === 'lock') App.homeAct(t, t.locked ? 'unlock' : 'lock');
    else App.homeAct(t, t.on ? 'off' : 'on');
  }

  // Dimmable lights: tap toggles, horizontal drag sets the level (the whole tile is the slider).
  function sliderTile(el) {
    var id = el.dataset.dev, sx = null, start, dragging, w, lvl;
    el.addEventListener('pointerdown', function (e) {
      var t = findTile(id);
      if (!t || !t.available) return;
      sx = e.clientX; dragging = false; w = el.getBoundingClientRect().width;
      start = t.on ? (t.level || 100) : 0;
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
    });
    el.addEventListener('pointermove', function (e) {
      if (sx == null) return;
      var dx = e.clientX - sx;
      if (!dragging && Math.abs(dx) > 10) { dragging = true; V.drag = id; el.classList.add('is-drag'); }
      if (!dragging) return;
      lvl = Math.max(0, Math.min(100, Math.round(start + dx / w * 100)));
      el.style.setProperty('--lvl', lvl + '%');
      el.classList.toggle('is-on', lvl > 0);
      var s = el.querySelector('.tile-state');
      s.textContent = lvl ? lvl + '%' : 'Off';
      s.classList.toggle('num', lvl > 0);
    });
    el.addEventListener('pointerup', function () {
      if (sx == null) return;
      sx = null; V.drag = null;
      var t = findTile(id);
      if (dragging && t) App.homeAct(t, lvl ? 'level' : 'off', lvl || undefined);
      else if (!dragging) tap(t);
      paintTile(id, true); // the result (or, if refused, how it was before the drag)
    });
    el.addEventListener('pointercancel', function () { sx = null; V.drag = null; paintTile(id, true); });
  }

  function bindTiles(root) { App.$$('[data-dev]', root).forEach(bindTile); }
  function bindTile(el) {
    var t = findTile(el.dataset.dev);
    if (t && t.kind === 'light' && t.dimmable) sliderTile(el);
    else el.addEventListener('click', function () { tap(findTile(el.dataset.dev)); });
  }

  // Repaints one tile (in the rooms and an open sheet) if it looks different, or always with force.
  // Never under a finger that is dragging it.
  function paintTile(id, force) {
    var t = findTile(id);
    if (!t || V.drag === id) return;
    var html = tile(t);
    if (!force && V.tiles[id] === html) return;
    V.tiles[id] = html;
    [V.el && V.el.querySelector('.hc-rooms'), V.sheetBox].forEach(function (root) {
      var old = root && root.querySelector('[data-dev="' + id + '"]');
      if (!old) return;
      var tmp = document.createElement('div');
      tmp.innerHTML = html;
      var nt = tmp.firstChild;
      old.parentNode.replaceChild(nt, old);
      bindTile(nt);
    });
  }

  // ------------------------------------------------------------ rooms
  function roomHead(r) {
    var on = r.tiles.filter(function (t) { return t.kind === 'light' && t.on; }).length;
    var offable = r.tiles.some(function (t) { return t.available && t.on && /^(light|switch|fan)$/.test(t.kind); });
    return '<span class="label">' + (on ? on + ' on' : 'Lights off') + '</span>' +
      '<button class="room-off' + (offable ? '' : ' is-off') + '" data-room-off>All off</button>';
  }
  function rooms(h) {
    return h.rooms.map(function (r, i) {
      V.heads[i] = roomHead(r);
      return '<section class="room" data-room="' + i + '"><div class="room-h"><h3 class="serif">' + esc(r.name) + '</h3><span class="room-meta">' + V.heads[i] + '</span></div>' +
        '<div class="tiles">' + r.tiles.map(function (t) { V.tiles[t.id] = tile(t); return V.tiles[t.id]; }).join('') + '</div></section>';
    }).join('');
  }
  function paintRooms(h) {
    var box = V.el.querySelector('.hc-rooms');
    var key = h ? JSON.stringify(h.rooms.map(function (r) { return [r.name, r.tiles.map(function (t) { return t.id; })]; })) : '';
    if (key !== V.roomsKey) {
      V.roomsKey = key;
      V.heads = {};
      V.tiles = {};
      var st = box.scrollTop;
      box.innerHTML = !h ? '' : h.rooms.length ? rooms(h)
        : '<div class="hc-empty serif"><i>Nothing on the frame yet</i><small>Add the <b>frame</b> label to lights, locks and the thermostat in Home Assistant</small></div>';
      box.scrollTop = st;
      bindTiles(box);
      return;
    }
    if (!h) return;
    h.rooms.forEach(function (r, i) {
      var head = roomHead(r);
      if (V.heads[i] !== head) { V.heads[i] = head; box.querySelector('[data-room="' + i + '"] .room-meta').innerHTML = head; }
    });
    tiles(h).forEach(function (t) { paintTile(t.id); });
  }

  // ------------------------------------------------------------ summary + scenes
  function sum(key, cls, label, big, small) {
    return '<button class="sum' + cls + '" data-sum="' + key + '"><span class="label">' + label + '</span><b class="num">' + big + '</b><small>' + small + '</small></button>';
  }
  function climateLine(c) {
    if (!c.available) return 'Offline';
    if (c.mode === 'off') return 'System off';
    var to = c.mode === 'heat_cool' ? (c.low != null && c.high != null ? c.low + '–' + c.high + '°' : '') : (c.target != null ? c.target + '°' : '');
    return (ACTIONS[c.action] || MODES[c.mode] || 'Holding') + (to ? ' · ' + to : '');
  }
  function summary(h) {
    if (!h) return '';
    var s = H.stats(h), c = h.climate, m = H.nowPlaying(h.media, V.mediaId);
    var locks = s.locks === 1 ? 'Lock' : 'Locks';
    return sum('lights', s.lightsOn ? ' sum--warm' : '', 'Lights', s.lightsOn, s.lightsOn ? 'on in ' + s.lightRooms + (s.lightRooms === 1 ? ' room' : ' rooms') : 'All off') +
      (!s.locks ? sum('locks', '', 'Locks', '—', 'None on the frame')
        : s.unlocked.length ? sum('locks', ' sum--warn', locks, 'Unlocked', esc(s.unlocked[0]) + ' unlocked' + (s.unlocked.length > 1 ? ' +' + (s.unlocked.length - 1) : ''))
        : sum('locks', '', locks, 'Locked', s.locks === 1 ? 'All locked' : 'All ' + s.locks + ' locked')) +
      sum('climate', '', 'Climate', c && c.current != null ? c.current + '°' : '—', c ? climateLine(c) : 'No thermostat') +
      sum('media', '', 'Media', m ? (m.state === 'playing' ? 'Playing' : 'Paused') : '—', m ? esc(m.name) : 'Nothing playing');
  }

  function scenes(h) {
    if (!h) return '';
    if (!h.scenes.length) return '<div class="scenes-empty">No scenes yet · tag one in Home Assistant</div>';
    return h.scenes.map(function (s) {
      return '<button class="scene" data-scene="' + esc(s.id) + '">' + App.icon(H.sceneIcon(s.icon), 26) + '<span>' + esc(s.name) + '</span></button>';
    }).join('');
  }

  // ------------------------------------------------------------ climate
  function setpoint(field, value, label, size) {
    return '<div class="th-main th-main--' + size + '"><button class="th-btn" data-temp="' + field + '" data-step="-1" aria-label="Cooler">' + App.icon('minus', 36) + '</button>' +
      '<div class="th-set"><span class="num">' + (value == null ? '—' : value + '°') + '</span><small>' + label + '</small></div>' +
      '<button class="th-btn" data-temp="' + field + '" data-step="1" aria-label="Warmer">' + App.icon('plus', 36) + '</button></div>';
  }
  function climate(h) {
    var c = h && h.climate;
    if (!c) return '<div class="label label--light">Climate</div><div class="th-none">' + (h ? 'No thermostat on the frame' : '') + '</div>';
    var head = '<div class="label label--light">Climate · ' + esc(c.name) + (c.pending ? ' <i class="pend pend--light"></i>' : '') + '</div>';
    if (!c.available) return head + '<div class="th-none">Offline</div>';
    var main = c.mode === 'heat_cool' ? '<div class="th-range">' + setpoint('low', c.low, 'Heat to', 'small') + setpoint('high', c.high, 'Cool to', 'small') + '</div>'
      : c.mode === 'off' ? '<div class="th-main"><div class="th-set"><span class="num">Off</span><small>Pick a mode to start</small></div></div>'
      : setpoint('target', c.target, 'Set to', 'big');
    var verb = c.mode === 'off' ? 'Off' : ACTIONS[c.action] || 'Holding';
    return head + main +
      '<div class="th-now"><span><b class="num">' + (c.current == null ? '—' : c.current + '°') + '</b> inside</span><span class="th-verb th-verb--' + verb.toLowerCase() + '">' + verb + '</span>' +
      (c.humidity != null ? '<span><b class="num">' + c.humidity + '%</b> humidity</span>' : '<span></span>') + '</div>' +
      '<div class="seg seg--dark">' + c.modes.map(function (m) {
        return '<button class="' + (c.mode === m ? 'is-on' : '') + '" data-tmode="' + m + '">' + MODES[m] + '</button>';
      }).join('') + '</div>';
  }
  // −/+ shows at once; the change is sent after a second without another tap.
  function nudge(field, step) {
    var h = data(), c = h && h.climate;
    if (!c || !c.available) return;
    if (field === 'target') {
      var v = (c.target != null ? c.target : c.current) + step;
      if (!isNaN(v)) App.homeAct(c, 'target', v, { key: c.id + ':target', delay: 1000 });
      return;
    }
    if (c.low == null || c.high == null) return;
    var r = { low: c.low, high: c.high };
    r[field] += step;
    if (r.low < r.high) App.homeAct(c, 'range', r, { key: c.id + ':range', delay: 1000 });
  }

  // ------------------------------------------------------------ cameras
  function camUrl(c) { return '/api/home/cameras/' + encodeURIComponent(c.id) + '.jpg?t=' + V.camAt; }
  function camAge() { return Math.max(0, Math.round((Date.now() - V.camAt) / 1000)) + 's ago'; }
  function cams(h) {
    var list = h ? h.cameras.slice(0, 2) : [];
    if (!list.length) return '';
    return '<div class="label">Cameras · snapshots every 20s</div><div class="cams">' + list.map(function (c) {
      if (!c.available) return '<div class="cam is-off"><span class="cam-name">' + esc(c.name) + '</span><span class="cam-age">Offline</span></div>';
      return '<button class="cam" data-cam="' + esc(c.id) + '"><img src="' + camUrl(c) + '" alt=""><span class="cam-name">' + esc(c.name) + '</span><span class="cam-age">' + camAge() + '</span></button>';
    }).join('') + '</div>';
  }
  // The structure only (which cameras, available or not): new snapshots swap the img src instead.
  function camsKey(h) { return h ? JSON.stringify(h.cameras.slice(0, 2)) : ''; }
  function refreshCams() {
    V.camAt = Date.now();
    var h = data();
    App.$$('[data-cam]', V.el).forEach(function (b) {
      var c = h && h.cameras.filter(function (x) { return x.id === b.dataset.cam; })[0];
      if (c) b.querySelector('img').src = camUrl(c);
    });
    paintAges();
  }
  function paintAges() { App.$$('.cam-age', V.el).forEach(function (a) { if (a.textContent !== 'Offline') a.textContent = camAge(); }); }

  App.cameraSheet = function (c) {
    App.sheet('<div class="cam-big"><img src="' + camUrl(c) + '" alt=""><div class="cam-big-bar"><span class="tk-live"><i></i>' + esc(c.name) + '</span><span class="label label--light">Snapshot · ' + camAge() + '</span></div></div>', { cls: 'sheet--cam' });
  };

  // ------------------------------------------------------------ media
  function media(h) {
    var m = h && H.nowPlaying(h.media, V.mediaId);
    V.mediaId = m ? m.id : null;
    if (!m) return '<div class="np-none">' + App.icon('music', 26) + '<span>' + (h ? 'Nothing playing' : '') + '</span></div>';
    var art = m.hasArt ? '<img src="/api/home/media/' + encodeURIComponent(m.id) + '/art?v=' + encodeURIComponent(m.title || '') + '" alt="" onerror="this.remove()">' : '';
    return '<span class="np-art">' + App.icon('music', 34) + art + '</span>' +
      '<div class="np-text"><span class="label">' + esc(m.name) + '</span><b>' + esc(m.title || 'Playing') + '</b><span>' + esc(m.artist || '') + '</span></div>' +
      '<button class="np-btn" data-play aria-label="Play/Pause">' + App.icon(m.state === 'playing' ? 'pause' : 'play', 30) + '</button>';
  }

  // ------------------------------------------------------------ painting
  // Sets a part's HTML only when it (or its key) changed since the last paint.
  function setPart(sel, html, key) {
    key = key === undefined ? html : key;
    if (V.html[sel] === key) return false;
    V.html[sel] = key;
    V.el.querySelector(sel).innerHTML = html;
    return true;
  }
  function update() {
    if (!V.el) return;
    var h = data(), note = App.homeNote();
    V.el.querySelector('.hc').classList.toggle('is-stale', !!note);
    setPart('.hc-note', note ? App.icon('bolt', 22) + '<span>' + note + '</span>' : '');
    setPart('.hc-sum', summary(h));
    setPart('.hc-scenes', scenes(h));
    paintRooms(h);
    setPart('.hc-climate', climate(h));
    setPart('.hc-cams', cams(h), camsKey(h));
    setPart('.hc-media', media(h));
    V.el.querySelector('.hc-media').classList.toggle('is-none', !V.mediaId);
  }
  App.on('home', update);
  App.on('homestate', update);
  App.on('minute', update); // the note's "updated N min ago"

  // ------------------------------------------------------------ sheets
  function listSheet(kind) {
    var h = data();
    if (!h) return;
    var list = tiles(h).filter(function (t) { return t.kind === (kind === 'lights' ? 'light' : 'lock'); });
    if (kind === 'lights') list.sort(function (a, b) { return b.on - a.on; });
    var unlocked = list.filter(function (t) { return t.kind === 'lock' && t.available && !t.locked; });
    App.sheet('<div class="sheet-pad"><div class="label">' + (kind === 'lights' ? 'Every light on the frame' : 'Doors') + '</div>' +
      '<h2 class="serif sheet-h">' + (kind === 'lights' ? 'Lights' : 'Locks') + '</h2>' +
      '<div class="tiles tiles--sheet">' + list.map(tile).join('') + '</div>' +
      (kind === 'locks' && unlocked.length ? '<div class="sheet-actions"><button class="btn btn--solid" data-lockall>Lock all doors</button></div>' : '') + '</div>', {
      cls: 'sheet--wide',
      onClose: function () { V.sheetBox = null; },
      onMount: function (s, close) {
        V.sheetBox = s.querySelector('.tiles--sheet');
        bindTiles(V.sheetBox);
        var lk = s.querySelector('[data-lockall]');
        if (lk) lk.onclick = function () {
          close();
          unlocked.forEach(function (t) { App.homeAct(t, 'lock'); });
        };
      }
    });
  }

  function onClick(e) {
    var t, h = data();
    if ((t = e.target.closest('[data-scene]'))) {
      var s = h && h.scenes.filter(function (x) { return x.id === t.dataset.scene; })[0];
      var p = s && App.homeAct(s, 'run');
      if (p) p.then(function (ok) { if (ok) App.toast('<b>' + esc(s.name) + '</b> started', { icon: H.sceneIcon(s.icon) }); });
      return;
    }
    if ((t = e.target.closest('[data-room-off]'))) {
      var room = h && h.rooms[+t.closest('[data-room]').dataset.room];
      if (room && !t.classList.contains('is-off')) App.homeRoomOff(room);
      return;
    }
    if ((t = e.target.closest('[data-sum]'))) {
      var k = t.dataset.sum;
      if (k === 'lights' || k === 'locks') return listSheet(k);
      var target = V.el.querySelector(k === 'climate' ? '.hc-climate' : '.hc-media');
      target.classList.add('is-pulse'); setTimeout(function () { target.classList.remove('is-pulse'); }, 900);
      return;
    }
    if ((t = e.target.closest('[data-temp]'))) return nudge(t.dataset.temp, +t.dataset.step);
    if ((t = e.target.closest('[data-tmode]'))) {
      if (h && h.climate && h.climate.available) App.homeAct(h.climate, 'mode', t.dataset.tmode, { key: h.climate.id + ':mode' });
      return;
    }
    if ((t = e.target.closest('[data-cam]'))) {
      var cam = h && h.cameras.filter(function (c) { return c.id === t.dataset.cam; })[0];
      if (cam) App.cameraSheet(cam);
      return;
    }
    if (e.target.closest('[data-play]')) {
      var m = h && h.media.filter(function (x) { return x.id === V.mediaId; })[0];
      if (m) App.homeAct(m, m.state === 'playing' ? 'pause' : 'play');
    }
  }

  // ------------------------------------------------------------ visible: fast polls + snapshots
  function live(on) {
    if (V.live === on) return;
    V.live = on;
    clearInterval(V.camTimer);
    App.homeFeed.setRefresh(on ? H.REFRESH_OPEN : H.REFRESH_IDLE, on);
    if (!on) return;
    refreshCams();
    V.camTimer = setInterval(refreshCams, H.CAMERA_MS);
  }
  App.on('second', function () { if (V.el && App.current === 'control') paintAges(); });

  App.register('control', {
    show: function (el) {
      if (!V.el) {
        V.el = el;
        el.innerHTML = '<div class="hc">' +
          '<div class="hc-left"><div class="hc-note"></div><div class="hc-sum"></div><div class="hc-scenes"></div><div class="hc-rooms"></div></div>' +
          '<div class="hc-right"><div class="hc-climate"></div><div class="hc-cams"></div><div class="hc-media card"></div></div>' +
          '</div>';
        el.addEventListener('click', onClick);
      }
      update();
      if (App.current === 'control') live(true); // not when pre-built in the background
    },
    resume: function () { update(); live(true); },
    hide: function () { live(false); }
  });
})();
