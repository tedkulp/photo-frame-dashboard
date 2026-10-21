// Core shell: router, demo clock, idle/ambient, toasts, sheets, helpers.
(function () {
  'use strict';
  var D = window.DATA;
  var App = window.App = { state: D, views: {}, current: null, mode: 'day' };
  var $ = App.$ = function (s, r) { return (r || document).querySelector(s); };
  App.$$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  // ------------------------------------------------------------ events
  var handlers = {};
  App.on = function (e, fn) { (handlers[e] = handlers[e] || []).push(fn); };
  App.emit = function (e, a) { (handlers[e] || []).forEach(function (fn) { fn(a); }); };

  // ------------------------------------------------------------ time (demo clock)
  var offset = 0;
  App.now = function () { return new Date(Date.now() + offset); };
  App.setTime = function (h, m) {
    if (h == null) offset = 0;
    else { var d = new Date(); d.setHours(h, m, 0, 0); offset = d - Date.now(); }
    lastMin = -1;
    App.emit('time');
    App.rerender();
  };
  App.dayStart = function (d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  App.addDays = function (d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; };
  App.sameDay = function (a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); };
  App.isNight = function () { var h = App.now().getHours(); return h >= 22 || h < 6; };

  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var MON_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'June', 'July', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
  App.fmt = {
    time: function (d, ampm) {
      var h = d.getHours(), m = d.getMinutes();
      var s = (h % 12 || 12) + ':' + (m < 10 ? '0' : '') + m;
      return ampm === false ? s : s + ' ' + (h >= 12 ? 'PM' : 'AM');
    },
    // "4 PM", "3:45 PM"
    hour: function (d) {
      var h = d.getHours(), m = d.getMinutes();
      return (h % 12 || 12) + (m ? ':' + (m < 10 ? '0' : '') + m : '') + ' ' + (h >= 12 ? 'PM' : 'AM');
    },
    ampm: function (d) { return d.getHours() >= 12 ? 'PM' : 'AM'; },
    range: function (a, b) {
      var same = App.fmt.ampm(a) === App.fmt.ampm(b);
      return (same ? App.fmt.time(a, false) : App.fmt.time(a)) + ' – ' + App.fmt.time(b);
    },
    day: function (d) { return DAYS[d.getDay()]; },
    dayShort: function (d) { return DAYS[d.getDay()].slice(0, 3); },
    month: function (d) { return MONTHS[d.getMonth()]; },
    monthShort: function (d) { return MON_SHORT[d.getMonth()]; },
    mins: function (m) {
      m = Math.max(0, Math.round(m));
      if (m < 60) return m + ' min';
      var h = Math.floor(m / 60), r = m % 60;
      return h + ' hr' + (r ? ' ' + r + ' min' : '');
    },
    rel: function (d) {
      var t = App.dayStart(App.now()), x = App.dayStart(d), diff = Math.round((x - t) / 864e5);
      if (diff === 0) return 'Today';
      if (diff === 1) return 'Tomorrow';
      if (diff === -1) return 'Yesterday';
      return DAYS[d.getDay()];
    }
  };
  App.esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };

  // ------------------------------------------------------------ icons + people
  App.icon = function (name, size, cls) {
    size = size || 24;
    return '<svg class="i ' + (cls || '') + '" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (window.ICONS[name] || '') + '</svg>';
  };
  App.person = function (id) {
    if (id === 'family' || id === window.Chores.ANYONE) return D.family;
    for (var i = 0; i < D.people.length; i++) if (D.people[i].id === id) return D.people[i];
    return D.family;
  };
  App.peopleIds = function () { return D.people.map(function (p) { return p.id; }); };
  // Equal grid columns, one per lane, however many people there are.
  App.cols = function (n) { return 'repeat(' + Math.max(1, n) + ', minmax(0, 1fr))'; };
  App.pstyle = function (p) {
    if (typeof p === 'string') p = App.person(p);
    return '--c:' + p.color + ';--c-rgb:' + p.rgb + ';--c-ink:' + p.ink;
  };
  // opts.presence: draw the person Home (solid) or Away (hollow ring) from Home Assistant, and keep
  // it current in place (paintPresence). Only the Today and ambient "who" places pass it.
  App.avatar = function (p, size, cls, opts) {
    if (typeof p === 'string') p = App.person(p);
    size = size || 48;
    var live = !!(opts && opts.presence) && p.id !== 'family';
    if (live && App.presence(p.id) === 'away') cls = (cls || '') + ' is-away';
    return '<span class="avatar ' + (cls || '') + '"' + (live ? ' data-presence="' + App.esc(p.id) + '"' : '') + ' style="' + App.pstyle(p) + ';width:' + size + 'px;height:' + size + 'px;font-size:' + Math.round(size * 0.46) + 'px">' + (p.id === 'family' ? '★' : App.esc(p.name.charAt(0))) + '</span>';
  };
  App.dots = function (ids, size) {
    return '<span class="dots">' + ids.map(function (id) { return '<i style="' + App.pstyle(id) + (size ? ';width:' + size + 'px;height:' + size + 'px' : '') + '"></i>'; }).join('') + '</span>';
  };

  // ------------------------------------------------------------ calendar helpers
  App.events = function () { return D.events; };
  // Everyone in the family is on it (with one person, nothing is a family event).
  App.isFamily = function (e) {
    return D.people.length > 1 && D.people.every(function (p) { return e.people.indexOf(p.id) > -1; });
  };
  App.evColor = function (e) { return App.isFamily(e) ? D.family : App.person(e.people[0]); };
  App.timedOn = function (day, pid) {
    var s = App.dayStart(day), e = App.addDays(s, 1);
    return App.events().filter(function (ev) {
      return !ev.allDay && ev.start < e && ev.end > s && (!pid || ev.people.indexOf(pid) > -1);
    }).sort(function (a, b) { return a.start - b.start || b.end - a.end; });
  };
  App.allDayOn = function (day, pid) {
    var s = App.dayStart(day), e = App.addDays(s, 1);
    return App.events().filter(function (ev) {
      return ev.allDay && ev.start < e && ev.end > s && (!pid || ev.people.indexOf(pid) > -1);
    });
  };
  App.leaveBy = function (e) { return e.travel ? new Date(+e.start - e.travel * 60000) : e.start; };
  // The next thing someone needs to act on: earliest upcoming "leave by" today.
  App.nextEvent = function () {
    var now = App.now();
    var list = App.timedOn(now).filter(function (e) { return e.start > now; });
    list.sort(function (a, b) { return App.leaveBy(a) - App.leaveBy(b); });
    return list[0] || null;
  };
  App.findEvent = function (id) {
    return App.events().filter(function (e) { return e.id === id; })[0];
  };

  // ------------------------------------------------------------ calendar feed (home server)
  // People + events from GET /api/calendar (feed.js). The first real people list also hands the
  // still-mock photos to them by position.
  var owners = D.mockIds;
  function onFeed(d) {
    var ids = d.people.map(function (p) { return p.id; }); // D.people is still the old list here
    if (ids.join() !== owners.join()) { window.Feed.remap(D, owners, ids); owners = ids; }
    D.people = d.people;
    D.events = d.events;
    App.emit('feed');
  }
  App.hasCalendar = function () { return !!App.feed && App.feed.state().status === 'ok'; };
  // Why adding an event is off right now ('' when it is on): no data yet, the last request failed,
  // or no fetch has worked for 15 minutes. The server would most likely fail the write too.
  function feedState() { return App.feed ? App.feed.state() : { status: 'loading' }; }
  App.addBlocked = function () {
    var s = feedState();
    if (s.status === 'loading') return 'Loading the calendar…';
    if (s.status === 'offline') return window.Feed.UNREACHABLE;
    if (s.failed) return 'The last calendar request failed · retrying';
    return s.stale ? 'Calendar not updated for ' + App.fmt.mins(s.age) : '';
  };
  // What to say about the calendar data: why there is none yet, or how old it is once stale.
  App.feedNote = function () {
    var s = feedState();
    if (s.status === 'loading') return 'Loading the calendar…';
    if (s.status === 'offline') return 'Can’t reach the home server · retrying';
    return s.stale ? 'Updated ' + App.fmt.mins(s.age) + ' ago' : '';
  };
  function paintFeedNotes() {
    var t = App.feedNote();
    App.$$('.feed-note').forEach(function (el) { el.innerHTML = t; });
  }
  App.on('minute', paintFeedNotes);
  function onFeedState() { paintFeedNotes(); App.emit('feedstate'); }

  // ------------------------------------------------------------ weather feed (home server)
  // Home Assistant's weather from GET /api/weather (weather.js), on the calendar feed's loop.
  function onWeather(d) { D.weather = d; App.emit('weather'); }
  // What the views show now (see Weather.at), or null when there's nothing to show; then
  // App.weatherNote() says why.
  App.weatherNow = function () {
    return D.weather && D.weather.configured ? window.Weather.at(D.weather, App.now(), 7) : null;
  };
  // Why there is no weather, or how old it is once stale ('' when it's fresh).
  App.weatherNote = function () {
    var s = App.weatherFeed ? App.weatherFeed.state() : { status: 'loading' };
    if (s.status === 'loading') return 'Loading the weather…';
    if (s.status === 'offline') return s.answered ? 'Home Assistant isn’t answering · retrying' : 'Can’t reach the home server';
    if (!D.weather.configured) return 'Weather not set up';
    if (!App.weatherNow()) return 'Weather unavailable';
    return s.stale ? 'Weather from ' + App.fmt.mins(Math.floor(s.age / 60) * 60) + ' ago' : '';
  };

  // ------------------------------------------------------------ chores feed (home server)
  // Chores from GET /api/chores (chores.js), on the calendar feed's loop every 30 s.
  App.currentRoutine = function () {
    var h = App.now().getHours();
    for (var i = 0; i < D.routines.length; i++) if (h >= D.routines[i].from && h < D.routines[i].to) return D.routines[i];
    return D.routines[D.routines.length - 1];
  };
  var pendingTicks = {}; // { choreId: done } sent but not answered yet
  function onChores(d) { D.chores = d; App.emit('chores'); }
  // Today's chores (the server's weekday) in a routine, with done; the one selection the Chores
  // view and the home screen's rings both use.
  App.choresToday = function (routineId) { return window.Chores.today(D.chores, routineId, pendingTicks); };
  App.choresWeek = function (personId) { return window.Chores.week(D.chores, personId); };
  // Who a chore can belong to, in lane order: each person, then Anyone.
  App.choreOwners = function () { return App.peopleIds().concat([window.Chores.ANYONE]); };
  App.choreOwnerName = function (id) { return id === window.Chores.ANYONE ? 'Anyone' : App.person(id).name; };
  function choresState() { return App.choresFeed ? App.choresFeed.state() : { status: 'loading' }; }
  // Why ticking is off right now ('' when it is on): nothing loaded yet, or the server isn't
  // reachable (the last request failed, or no fetch has worked for a couple of minutes).
  var LOADING_CHORES = 'Loading chores…';
  App.tickBlocked = function () {
    var s = choresState();
    if (s.status === 'loading') return LOADING_CHORES;
    return s.status === 'offline' || s.failed || s.stale ? window.Feed.UNREACHABLE : '';
  };
  // What to say about the chores data: why there is none yet, or that it may be out of date.
  App.choresNote = function () {
    var s = choresState();
    if (s.status === 'loading') return LOADING_CHORES;
    if (s.status === 'offline') return window.Feed.UNREACHABLE + ' · retrying';
    if (s.failed || s.stale) return window.Feed.UNREACHABLE + ' · ' + (s.age ? 'chores from ' + App.fmt.mins(s.age) + ' ago' : 'retrying');
    return '';
  };
  // Tick (done = true) or untick a chore. Shows at once; resolves when the server has it, or
  // rejects with the reason after putting it back. The feed refetches after every write.
  App.tickChore = function (id, done) {
    pendingTicks[id] = done;
    App.emit('chores');
    function settle(ok) {
      if (pendingTicks[id] !== done) return; // a later tap on the same chore owns it now
      delete pendingTicks[id];
      if (ok && D.chores) { if (done) D.chores.done[id] = true; else delete D.chores.done[id]; }
      App.emit('chores');
    }
    return App.choresFeed.send(done ? 'PUT' : 'DELETE', '/api/chores/' + encodeURIComponent(id) + '/done')
      .then(function () { settle(true); }, function (e) { settle(false); throw e; });
  };
  // Add (no id) or change a chore: input is Chores.toInput's body. Resolves with the saved chore
  // once the server has it (shown straight away, before the refetch); rejects with the reason.
  App.saveChore = function (id, input) {
    var req = id ? App.choresFeed.send('PATCH', '/api/chores/' + encodeURIComponent(id), input) : App.choresFeed.send('POST', '/api/chores', input);
    return req.then(function (c) {
      if (D.chores) { D.chores = window.Chores.applySaved(D.chores, c); App.emit('chores'); }
      return c;
    });
  };
  // Delete a chore from today on (earlier days keep it).
  App.deleteChore = function (id) {
    return App.choresFeed.send('DELETE', '/api/chores/' + encodeURIComponent(id)).then(function () {
      if (D.chores) { D.chores = window.Chores.applyRemoved(D.chores, id); App.emit('chores'); }
    });
  };

  // ------------------------------------------------------------ home feed (home server)
  // Home Assistant's labelled entities from GET /api/home (house.js), on the calendar feed's loop:
  // every 3 s while Home controls is open (views/control.js sets it), 60 s otherwise. Taps are
  // optimistic: shown at once with a pending mark, confirmed by a later poll or put back after 5 s.
  var pendingHome = {}; // { key: { id, name, show, match, at } }, see House.view / House.settle
  var homeTimers = {};  // debounced changes not sent yet, by key
  function onHome(d) { D.home = d; settleHome(); App.emit('home'); }
  function homeState() { return App.homeFeed ? App.homeFeed.state() : { status: 'loading' }; }
  function settleHome() {
    var r = window.House.settle(D.home, pendingHome, Date.now());
    r.expired.forEach(function (p) { App.toast('Couldn’t reach <b>' + App.esc(p.name) + '</b>', { tone: 'error', icon: 'bolt' }); });
    return r.confirmed.length + r.expired.length > 0;
  }
  App.on('second', function () { if (settleHome()) App.emit('home'); });
  // What Home controls and the Today card show: the data with pending taps over it (null before
  // anything has loaded; { configured: false } without Home Assistant).
  App.home = function () { return window.House.view(D.home, pendingHome); };
  // Why the house can't be shown or changed right now ('' when it can). While set, taps toast it
  // (App.homeBlocked: toasts it and says true).
  App.homeNote = function () { return window.House.note(homeState(), D.home, Date.now()); };
  // A person's presence for their avatar: 'home', 'away' or 'unknown', which is all it is while the
  // house can't be trusted (loading, offline, stale or HA down), so old data never says away.
  App.presence = function (id) { return App.homeNote() ? 'unknown' : window.House.presence(D.home, id); };
  // Flips just the presence avatars whose state changed, wherever they are on screen.
  function paintPresence() {
    App.$$('.avatar[data-presence]').forEach(function (el) {
      var away = App.presence(el.getAttribute('data-presence')) === 'away';
      if (el.classList.contains('is-away') !== away) el.classList.toggle('is-away', away);
    });
  }
  App.on('home', paintPresence);
  App.on('homestate', paintPresence);
  App.on('minute', paintPresence);
  var homeBlocked = App.homeBlocked = function () {
    var why = App.homeNote();
    if (why) App.toast(why, { tone: 'error', icon: 'bolt' });
    return !!why;
  };
  function homeFailed(key, entry) {
    return function (e) {
      if (pendingHome[key] === entry) delete pendingHome[key]; // else a later tap owns it now
      App.toast('<b>' + App.esc(entry.name) + '</b> · ' + App.esc(e.message), { tone: 'error', icon: 'bolt' });
      App.emit('home');
      return false;
    };
  }
  // POST /api/home/:id { action, value }. `target` is the tile, climate or player ({ id, name }).
  // opts.key: what a later change replaces (default the entity; climate uses one per action) and
  // opts.delay: send only after this many ms without another change to the same key (−/+ taps).
  // Without a delay, returns a Promise of true once the server took it (false after a failure,
  // which has been toasted and put back); undefined when refused (blocked, or debouncing).
  App.homeAct = function (target, action, value, opts) {
    opts = opts || {};
    if (homeBlocked()) return;
    var key = opts.key || target.id, ex = window.House.expect(action, value);
    var entry = ex && { id: target.id, name: target.name, show: ex.show, match: ex.match, at: null };
    function send() {
      delete homeTimers[key];
      if (entry) entry.at = Date.now();
      var body = value === undefined ? { action: action } : { action: action, value: value };
      return App.homeFeed.send('POST', '/api/home/' + encodeURIComponent(target.id), body)
        .then(function () { return true; }, homeFailed(key, entry || { name: target.name }));
    }
    if (entry) { pendingHome[key] = entry; App.emit('home'); }
    clearTimeout(homeTimers[key]);
    if (opts.delay) homeTimers[key] = setTimeout(send, opts.delay);
    else return send();
  };
  // A room's "All off": its lights, switches and fans that are on go off at once.
  App.homeRoomOff = function (room) {
    if (homeBlocked()) return;
    var off = window.House.expect('off'), entries = [];
    room.tiles.forEach(function (t) {
      if (!window.House.turnsOff(t)) return;
      var entry = { id: t.id, name: t.name, show: off.show, match: off.match, at: Date.now() };
      pendingHome[t.id] = entry;
      entries.push(entry);
    });
    App.emit('home');
    App.homeFeed.send('POST', '/api/home/rooms/' + encodeURIComponent(room.name) + '/off').then(null, function (e) {
      entries.forEach(function (entry) { if (pendingHome[entry.id] === entry) delete pendingHome[entry.id]; });
      App.toast('<b>' + App.esc(room.name) + '</b> · ' + App.esc(e.message), { tone: 'error', icon: 'bolt' });
      App.emit('home');
    });
  };

  // ------------------------------------------------------------ edit mode (reusable)
  // How a screen gets an Edit mode (Chores does this in views/tasks.js; shopping can follow):
  //   var edit = App.editMode('tasks', render);   // one per view; render runs when it turns on/off
  //   header:  edit.button(why)                   // Edit / Done; dimmed while `why` (e.g. offline)
  //   lists:   edit.on ? rows that open the sheet : normal rows   (give edit-mode rows their own
  //            data-* attribute so normal taps, like ticking, can't fire in edit mode)
  //            edit.addRow('data-x="…"')          // "+ Add" row ending a list
  //   clicks:  if (edit.click(e, why)) return;    // handles the Edit / Done button
  //   sheet:   App.editSheet({ label, body, read, save, remove, name, blocked, onMount })
  // Edit mode ends by itself when the screen is left (App.go).
  var editors = [];
  App.editMode = function (viewName, onChange) {
    var ed = { on: false, view: viewName };
    ed.set = function (on) { if (ed.on !== on) { ed.on = on; onChange(); } };
    ed.button = function (why) {
      return '<button class="btn edit-btn' + (ed.on ? ' btn--solid' : '') + (why && !ed.on ? ' is-off' : '') + '" data-edit-toggle>' +
        (ed.on ? App.icon('check', 22) + 'Done' : App.icon('pencil', 22) + 'Edit') + '</button>';
    };
    ed.addRow = function (attrs, label) {
      return '<button class="edit-add" ' + attrs + '>' + App.icon('plus', 24) + '<span>' + (label || 'Add') + '</span></button>';
    };
    ed.click = function (e, why) {
      if (!e.target.closest('[data-edit-toggle]')) return false;
      if (!ed.on && why) App.toast(why, { tone: 'error', icon: 'pencil' });
      else ed.set(!ed.on);
      return true;
    };
    editors.push(ed);
    return ed;
  };
  function endEditModes(current) {
    editors.forEach(function (ed) {
      if (ed.on && ed.view !== current) { ed.on = false; App.views[ed.view]._dirty = true; }
    });
  }

  // The add / edit sheet scaffolding (styled like the calendar's add sheet): a label, the screen's
  // own fields (`body`), and Delete / Cancel / Save. opts:
  //   label        'New chore' / 'Edit chore'
  //   body         the fields' HTML; onMount(sheetEl) wires them up
  //   read(el)     → the request body, or throws an Error whose message is shown (nothing is sent)
  //   save(input)  → Promise; resolved closes the sheet, rejected keeps it open with what was typed
  //                  and shows the error's message
  //   remove()     → Promise (edit only): Delete asks once "Delete <name()>?" in the sheet first
  //   blocked()    → '' or why saving is off right now (re-checked when a feed's state changes)
  var editBox = null;
  App.editSheet = function (opts) {
    var busy = false;
    App.sheet(
      '<div class="sheet-pad add edit-sheet">' +
      '<div class="label">' + opts.label + '</div>' + opts.body +
      '<div class="sheet-actions edit-actions">' +
      (opts.remove ? '<button class="btn btn--ghost edit-del" data-del>' + App.icon('trash', 22) + 'Delete</button>' : '') +
      '<span class="add-why"></span><button class="btn btn--ghost" data-close>Cancel</button><button class="btn btn--solid" data-save>Save</button></div>' +
      '<div class="sheet-actions edit-confirm is-hidden"><span class="edit-q"></span>' +
      '<button class="btn btn--ghost" data-keep>Keep</button><button class="btn btn--alert" data-del-yes>Delete</button></div>' +
      '</div>', {
        cls: 'sheet--wide',
        onClose: function () { editBox = null; },
        onMount: function (s, close) {
          editBox = { el: s, opts: opts, busy: function () { return busy; } };
          if (opts.onMount) opts.onMount(s);
          // Enter on the frame's on-screen keyboard just puts it away.
          App.$$('input', s).forEach(function (i) {
            i.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); i.blur(); } });
          });
          paintEdit();
          s.addEventListener('click', function (ev) {
            var t = ev.target.closest('button');
            if (!t || busy) return;
            if (t.hasAttribute('data-save')) {
              var input;
              try { input = opts.read(s); } catch (err) { return say(err.message); }
              run(t, 'Saving…', function () { return opts.save(input); });
            }
            if (t.hasAttribute('data-del')) {
              s.querySelector('.edit-q').textContent = 'Delete ' + opts.name() + '?';
              confirming(true);
            }
            if (t.hasAttribute('data-keep')) confirming(false);
            if (t.hasAttribute('data-del-yes')) run(t, 'Deleting…', opts.remove);
          });
          function confirming(on) {
            s.querySelector('.edit-actions').classList.toggle('is-hidden', on);
            s.querySelector('.edit-confirm').classList.toggle('is-hidden', !on);
          }
          function say(msg) { s.querySelector('.add-why').textContent = msg; }
          function run(btn, doing, fn) {
            if (opts.blocked && opts.blocked()) return;
            var text = btn.innerHTML;
            busy = true;
            btn.disabled = true;
            btn.textContent = doing;
            fn().then(function () {
              busy = false;
              close();
            }, function (err) {
              busy = false;
              btn.innerHTML = text;
              confirming(false);
              paintEdit();
              say(err.message);
            });
          }
        }
      });
  };
  // An open edit sheet's Save / Delete follow its blocked().
  function paintEdit() {
    if (!editBox || editBox.busy()) return;
    var why = editBox.opts.blocked ? editBox.opts.blocked() : '';
    App.$$('[data-save], [data-del], [data-del-yes]', editBox.el).forEach(function (b) { b.disabled = !!why; });
    var line = editBox.el.querySelector('.add-why');
    if (why) line.textContent = why;
    else if (editBox.why) line.textContent = '';
    editBox.why = why;
  }
  App.on('choresstate', paintEdit);
  App.on('feedstate', paintEdit);
  // ------------------------------------------------------------ router
  App.register = function (name, view) { App.views[name] = view; };
  // Views are built once and kept laid out (hidden with content-visibility), so switching tabs
  // only has to paint. A view is rebuilt when its data changed ('data'/'time' events) or, for
  // time-sensitive views (minutely: true), when the minute has rolled over since it was built.
  function minuteKey() { return Math.floor(App.now().getTime() / 60000); }
  function build(name, opts) {
    var view = App.views[name];
    view.show($('#view-' + name), opts || {});
    view._built = true; view._dirty = false; view._min = minuteKey();
  }
  App.go = function (name, opts) {
    opts = opts || {};
    if (!App.views[name]) name = 'home';
    if (App.current && App.current !== name && App.views[App.current].hide) App.views[App.current].hide();
    App.$$('.view').forEach(function (v) { v.classList.toggle('is-active', v.dataset.view === name); });
    App.$$('.rail-item').forEach(function (b) { b.classList.toggle('is-active', b.dataset.go === name); });
    App.current = name;
    endEditModes(name);
    var view = App.views[name];
    if (!view._built || view._dirty || opts.rerender || (view.minutely && view._min !== minuteKey())) build(name, opts);
    else if (view.resume) view.resume($('#view-' + name));
    if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
  };
  // Build a hidden view and lay it out now (cached by content-visibility; no paint happens).
  function prebuild(name) {
    var el = $('#view-' + name), view = App.views[name];
    build(name);
    if (view.hide) view.hide();
    el.classList.add('is-warming');
    el.offsetHeight;
    el.classList.remove('is-warming');
  }
  // Pre-build (startup) and re-build (after data changes) hidden views in the background, one per
  // slot, so navigating to them never pays the rebuild cost.
  var refreshTimer = null;
  function refreshStale(delay) {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(function next() {
      var name = Object.keys(App.views).filter(function (k) {
        var v = App.views[k];
        return k !== App.current && (!v._built || v._dirty);
      })[0];
      if (!name) return;
      prebuild(name);
      refreshTimer = setTimeout(next, 400);
    }, delay);
  }
  function markStale() {
    Object.keys(App.views).forEach(function (k) { if (k !== App.current) App.views[k]._dirty = true; });
    refreshStale(1500);
  }
  App.on('data', markStale);
  App.on('feed', function () { markStale(); App.rerender(); });
  App.on('weather', function () { markStale(); App.rerender(); });
  App.on('chores', function () { markStale(); App.rerender(); });
  App.on('time', markStale);
  App.rerender = function () {
    if (App.current) App.views[App.current].show($('#view-' + App.current), { rerender: true });
  };

  // ------------------------------------------------------------ toasts (single, with undo)
  // A new toast replaces the one showing. Returns { dismiss }.
  var toastTimer;
  App.toast = function (html, opts) {
    opts = opts || {};
    var box = $('#toasts');
    box.innerHTML = '';
    clearTimeout(toastTimer);
    var ms = opts.ms || 5000;
    var t = document.createElement('div');
    t.className = 'toast' + (opts.tone ? ' toast--' + opts.tone : '');
    t.style.setProperty('--ms', ms + 'ms');
    t.innerHTML = (opts.icon ? App.icon(opts.icon, 26) : '') + '<span class="toast-msg">' + html + '</span>' +
      (opts.undo ? '<button class="toast-undo">' + App.icon('undo', 22) + 'Undo</button>' : '');
    box.appendChild(t);
    t.classList.add('is-in');
    function kill() { t.remove(); }
    toastTimer = setTimeout(kill, ms);
    if (opts.undo) t.querySelector('.toast-undo').addEventListener('click', function () { clearTimeout(toastTimer); opts.undo(); kill(); });
    // dismiss() takes this toast away if it is still showing (a later toast already replaced it).
    return { dismiss: function () { if (t.parentNode) { clearTimeout(toastTimer); kill(); } } };
  };

  // ------------------------------------------------------------ sheets (modal cards)
  App.sheet = function (html, opts) {
    opts = opts || {};
    var layer = $('#sheetLayer');
    layer.innerHTML = '<div class="sheet-scrim"></div><div class="sheet ' + (opts.cls || '') + '">' +
      '<button class="sheet-x" data-close aria-label="Close">' + App.icon('x', 28) + '</button>' + html + '</div>';
    layer.classList.add('is-open');
    function close() {
      if (!layer.classList.contains('is-open')) return;
      layer.classList.remove('is-open');
      if (opts.onClose) opts.onClose();
      layer.innerHTML = '';
    }
    App.closeSheet = close;
    layer.querySelector('.sheet-scrim').addEventListener('click', close);
    App.$$('[data-close]', layer).forEach(function (b) { b.addEventListener('click', close); });
    if (opts.onMount) opts.onMount(layer.querySelector('.sheet'), close);
    return close;
  };
  App.closeSheet = function () {};

  // Stage-local coordinates for an element's center (the stage is scaled to fit the window)
  App.centerOf = function (el) {
    var r = el.getBoundingClientRect();
    return window.Stage.toStage($('#stage').getBoundingClientRect(), App.stage.width, r.left + r.width / 2, r.top + r.height / 2);
  };

  // ------------------------------------------------------------ press-and-hold
  App.hold = function (el, ms, cb) {
    var t = null;
    el.style.setProperty('--hold', ms + 'ms');
    el.addEventListener('pointerdown', function () {
      if (cb.enabled && !cb.enabled()) return;
      el.classList.add('is-holding');
      t = setTimeout(function () { t = null; el.classList.remove('is-holding'); cb.done(); }, ms);
    });
    function cancel(e) {
      if (!t) return;
      clearTimeout(t); t = null;
      el.classList.remove('is-holding');
      if (cb.cancel && e.type === 'pointerup') cb.cancel();
    }
    el.addEventListener('pointerup', cancel);
    el.addEventListener('pointerleave', cancel);
    el.addEventListener('pointercancel', cancel);
  };

  // ------------------------------------------------------------ modes: day / ambient / night
  App.setMode = function (m) {
    var stage = $('#stage');
    App.mode = m;
    stage.dataset.mode = m;
    App.emit('mode', m);
  };

  // ------------------------------------------------------------ idle
  App.idle = { home: 60, ambient: 120 };
  var idleSec = 0;
  function onIdleTick() {
    idleSec++;
    var blocked = $('#takeover').classList.contains('is-open');
    if (App.mode === 'nightdash' && idleSec >= 20) { App.setMode('night'); return; }
    if (App.mode !== 'day' || blocked) return;
    if (idleSec === App.idle.home && App.current !== 'home') { App.closeSheet(); App.go('home'); }
    if (idleSec >= App.idle.ambient) {
      App.closeSheet();
      App.go('home');
      App.setMode(App.isNight() ? 'night' : 'ambient');
    }
  }
  App.resetIdle = function () { idleSec = 0; };

  // ------------------------------------------------------------ stage size + scaling
  // Height is always 800 logical px; width follows the window's aspect (1280 at 16:10, 1422 at
  // 16:9, see stage.js), then the stage is scaled uniformly to fill the window. Views lay out
  // fluidly in whatever width they get. App.stage is the current { width, height, scale, x, y }.
  App.stage = window.Stage.fit(0, 0);
  function fit() {
    var f = window.Stage.fit(window.innerWidth, window.innerHeight), el = $('#stage');
    App.stage = f;
    el.style.width = f.width + 'px';
    el.style.height = f.height + 'px';
    el.style.transform = (f.x || f.y ? 'translate(' + f.x + 'px,' + f.y + 'px) ' : '') +
      (Math.abs(f.scale - 1) < 0.001 ? '' : 'scale(' + f.scale + ')');
  }

  // ------------------------------------------------------------ clock tick
  var lastMin = -1;
  function tick() {
    var n = App.now();
    App.emit('second', n);
    if (n.getMinutes() !== lastMin) {
      lastMin = n.getMinutes();
      $('#railClock').innerHTML = '<b>' + App.fmt.time(n, false) + '</b><span>' + App.fmt.ampm(n) + '</span>';
      App.emit('minute', n);
    }
    onIdleTick();
  }

  // ------------------------------------------------------------ boot
  App.start = function () {
    fit(); // size the stage before any view is built
    // Real time by default; ?demo pins a busy weekday afternoon.
    if (/[?&]demo(=|&|$)/.test(location.search)) App.setTime(15, 18);
    var storage = null;
    try { storage = window.localStorage; } catch (e) {}
    App.feed = window.Feed.create({
      url: '/api/calendar', fetch: window.fetch.bind(window), storage: storage,
      now: Date.now, setTimeout: window.setTimeout.bind(window), clearTimeout: window.clearTimeout.bind(window),
      onChange: onFeed, onState: onFeedState, onError: function (e) { console.error('[feed]', e); }
    });
    App.feed.start(); // a cached response is applied right here, before the first view is built
    App.weatherFeed = window.Feed.create({
      url: '/api/weather', cacheKey: 'homehq.weather', refresh: window.Weather.REFRESH, stale: window.Weather.STALE,
      parse: window.Weather.parse, changeKey: window.Weather.changeKey,
      fetch: window.fetch.bind(window), storage: storage,
      now: Date.now, setTimeout: window.setTimeout.bind(window), clearTimeout: window.clearTimeout.bind(window),
      onChange: onWeather, onState: function () { App.emit('weatherstate'); }, onError: function (e) { console.error('[weather]', e); }
    });
    App.weatherFeed.start();
    App.choresFeed = window.Feed.create({
      url: '/api/chores', cacheKey: 'homehq.chores', refresh: window.Chores.REFRESH, stale: window.Chores.STALE,
      parse: window.Chores.parse, changeKey: window.Chores.changeKey,
      noAnswer: 'No answer from the home server · check the chores before trying again',
      fetch: window.fetch.bind(window), storage: storage,
      now: Date.now, setTimeout: window.setTimeout.bind(window), clearTimeout: window.clearTimeout.bind(window),
      onChange: onChores, onState: function () { App.emit('choresstate'); }, onError: function (e) { console.error('[chores]', e); }
    });
    App.choresFeed.start();
    App.homeFeed = window.Feed.create({
      url: '/api/home', cacheKey: 'homehq.home', refresh: window.House.REFRESH_IDLE, stale: window.House.STALE,
      parse: window.House.parse, changeKey: window.House.changeKey,
      noAnswer: 'No answer from the home server · check it before trying again',
      fetch: window.fetch.bind(window), storage: storage,
      now: Date.now, setTimeout: window.setTimeout.bind(window), clearTimeout: window.clearTimeout.bind(window),
      onChange: onHome, onState: function () { App.emit('homestate'); }, onError: function (e) { console.error('[home]', e); }
    });
    App.homeFeed.start();
    window.addEventListener('resize', fit);
    // Switch tabs the instant a finger lands (pointerdown), not on release. Keyboard "clicks"
    // (detail === 0) still work.
    $('#rail').addEventListener('pointerdown', function (e) {
      var b = e.target.closest('[data-go]');
      if (b && e.button === 0) App.go(b.dataset.go);
    });
    $('#rail').addEventListener('click', function (e) {
      var b = e.target.closest('[data-go]');
      if (b && e.detail === 0) App.go(b.dataset.go);
    });
    document.addEventListener('pointerdown', App.resetIdle, true);
    window.addEventListener('hashchange', function () { App.go(location.hash.slice(1)); });
    App.go(location.hash.slice(1) || 'home');
    tick();
    setInterval(tick, 1000);
    App.emit('ready');
    refreshStale(1500);
    setTimeout(function () { App.toast('Tip: press and hold the <b>clock</b> in the sidebar for demo controls', { ms: 6000, icon: 'bolt' }); }, 1200);
  };
  document.addEventListener('DOMContentLoaded', function () { App.start(); });
})();
