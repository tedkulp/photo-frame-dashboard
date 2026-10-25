// Tasks / chores: one lane per person + "Anyone", with all of today's chores. Chores come from
// the home server (App.choresToday); a tap ticks or unticks at once and is saved there.
// Edit mode (App.editMode, the reusable pattern in app.js) shows every chore with its days; a
// tap opens the edit sheet instead of ticking, and each lane ends with "+ Add".
(function () {
  'use strict';
  var D = window.DATA;
  var V = { el: null, note: null };
  var ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

  function listFor(who, today) {
    return today.filter(function (c) { return c.owner === who; })
      .sort(function (a, b) { return a.done - b.done; });
  }

  function row(c) {
    return '<button class="ch' + (c.done ? ' is-done' : '') + '" data-ch="' + App.esc(c.id) + '">' +
      '<span class="ch-emoji">' + App.esc(c.emoji) + '<span class="ch-check"><svg viewBox="0 0 24 24" width="30" height="30"><path d="M5 12.5l4.5 4.5L19 7"/></svg></span></span>' +
      '<span class="ch-text"><b>' + App.esc(c.title) + '</b></span>' +
      '</button>';
  }
  // Edit mode: data-edit-ch, not data-ch, so a tap can never tick.
  function editRow(c) {
    return '<button class="ch ch--edit" data-edit-ch="' + App.esc(c.id) + '">' +
      '<span class="ch-emoji">' + App.esc(c.emoji) + '</span>' +
      '<span class="ch-text"><b>' + App.esc(c.title) + '</b><span class="ch-days">' + window.Chores.daysLabel(c.days) + '</span></span>' +
      App.icon('pencil', 20, 'ch-pen') + '</button>';
  }

  function weekGrid(id) {
    var w = App.choresWeek(id);
    if (!w) return '';
    return '<div class="ch-week"><div class="label">This week</div><div class="ch-week-row">' + w.days.map(function (mark, i) {
      var d = window.Chores.DAY_LETTERS[(i + 1) % 7]; // Mon-first
      return '<span class="is-' + mark + (i === w.today ? ' is-today' : '') + '"><i></i>' + d + '</span>';
    }).join('') + '</div></div>';
  }

  function laneHead(who, sub, ring) {
    var p = App.person(who);
    return '<header class="ch-head">' + App.avatar(p, 42) +
      '<div><b>' + App.esc(App.choreOwnerName(who)) + '</b><span class="ch-sub">' + sub + '</span></div>' + ring + '</header>';
  }

  function lane(who, today) {
    var list = listFor(who, today);
    var done = list.filter(function (c) { return c.done; }).length;
    var all = list.length && done === list.length;
    return '<section class="ch-lane' + (all ? ' is-complete' : '') + '" data-lane="' + App.esc(who) + '" style="' + App.pstyle(who) + '">' +
      laneHead(who, who === window.Chores.ANYONE ? 'Up for grabs' : (list.length ? done + ' of ' + list.length : 'Nothing'),
        '<div class="ch-ring">' + App.ring(done, list.length || 1, 46) + '<span class="num">' + (all ? '✓' : list.length ? done + '/' + list.length : '–') + '</span></div>') +
      '<div class="ch-list">' + (list.length ? list.map(row).join('') : '<div class="ch-none serif"><i>Nothing today</i></div>') +
      (all ? '<div class="ch-alldone serif">All done<i>!</i></div>' : '') + '</div>' +
      weekGrid(who) +
      '</section>';
  }

  function editLane(who) {
    var list = window.Chores.all(D.chores).filter(function (c) { return c.owner === who; });
    return '<section class="ch-lane is-editing" data-lane="' + App.esc(who) + '" style="' + App.pstyle(who) + '">' +
      laneHead(who, list.length === 1 ? '1 chore' : list.length + ' chores', '') +
      '<div class="ch-list">' + list.map(editRow).join('') + edit.addRow('data-edit-add="' + App.esc(who) + '"') + '</div>' +
      '</section>';
  }

  function render() {
    var note = App.choresNote();
    var today = App.choresToday();
    var done = today.filter(function (c) { return c.done; }).length;
    var lanes = App.choreOwners();
    V.note = note;
    V.el.innerHTML = '<div class="tasks' + (App.tickBlocked() ? ' is-blocked' : '') + (edit.on ? ' is-editing' : '') + '">' +
      '<header class="t-head">' +
      '<div class="t-title"><div class="label">' + (edit.on ? 'Editing · tap a chore to change it' : 'Chores') + '</div><h1 class="serif">Today</h1>' +
      (note ? '<div class="t-note">' + note + '</div>' : '') + '</div>' +
      (edit.on ? '' : '<div class="t-progress"><span class="num">' + done + '<small>/' + today.length + '</small></span><div class="t-bar"><i style="width:' + (today.length ? done / today.length * 100 : 0) + '%"></i></div><span class="label">done</span></div>') +
      (D.chores ? edit.button(App.tickBlocked()) : '') +
      '</header>' +
      (D.chores ? '<div class="ch-lanes" style="grid-template-columns:' + App.cols(lanes.length) + '">' + lanes.map(function (w) { return edit.on ? editLane(w) : lane(w, today); }).join('') + '</div>'
        : '<div class="t-empty serif"><i>' + note + '</i></div>') +
      '</div>';
  }
  var edit = App.editMode('tasks', function () { if (V.el) render(); });

  function find(id) { return App.choresToday().filter(function (c) { return c.id === id; })[0]; }

  function failed(c, e) {
    App.toast('Couldn’t save <b>' + App.esc(c.title) + '</b> · ' + App.esc(e.message), { tone: 'error', icon: 'tasks' });
  }
  function untick(c) { App.tickChore(c.id, false).catch(function (e) { failed(c, e); }); }

  // Optimistic: the tick and its "done" toast (with Undo) show at once; if the save then fails,
  // the done toast goes and only the error is left.
  function tick(c) {
    var shown = null;
    App.tickChore(c.id, true).catch(function (e) {
      if (shown) shown.dismiss();
      failed(c, e);
    });
    var all = App.choresToday();
    var undo = function () { untick(c); };
    shown = all.length && all.every(function (x) { return x.done; })
      ? App.toast('<b>All done today!</b> Everyone crushed it.', { icon: 'check', ms: 5000, undo: undo })
      : App.toast('<b>' + App.esc(c.title) + '</b> done', { icon: 'check', undo: undo });
  }

  // ------------------------------------------------------------ edit sheet
  // A chore's fields on top of App.editSheet: title, emoji grid + type-your-own, owner, days. `c`
  // is the chore being edited, or for a new one { owner } from the lane.
  function choreSheet(c) {
    var isNew = !c.id;
    var st = { owner: c.owner, days: c.days ? c.days.slice() : ALL_DAYS.slice() };
    var owners = App.choreOwners();
    App.editSheet({
      label: isNew ? 'New chore' : 'Edit chore',
      body:
        '<input class="big-input serif" placeholder="What needs doing?" maxlength="60" data-f="title" value="' + App.esc(c.title || '') + '">' +
        '<div class="label">Emoji <input class="emoji-input" maxlength="16" data-f="emoji" aria-label="Type an emoji" value="' + App.esc(c.emoji || '✅') + '"></div>' +
        '<div class="emoji-grid">' + window.Chores.EMOJI.map(function (e) { return '<button class="emoji-btn" data-emoji="' + e + '">' + e + '</button>'; }).join('') + '</div>' +
        '<div class="label">Who</div><div class="add-who">' + owners.map(function (id) {
          return '<button class="who-btn' + (st.owner === id ? ' is-on' : '') + '" data-owner="' + App.esc(id) + '" style="' + App.pstyle(id) + '">' + App.avatar(id, 44) + '<span>' + App.esc(App.choreOwnerName(id)) + '</span></button>';
        }).join('') + '</div>' +
        '<div class="add-row"><div><div class="label">Days</div><div class="chips">' + window.Chores.DAY_LETTERS.map(function (d, i) {
          return '<button class="chip day-btn" data-day="' + i + '" aria-label="' + window.Chores.DAY_NAMES[i] + '">' + d + '</button>';
        }).join('') + '<button class="chip" data-everyday>Every day</button></div></div></div>',
      onMount: function (s) {
        var emoji = s.querySelector('[data-f=emoji]');
        function paint() {
          App.$$('[data-emoji]', s).forEach(function (b) { b.classList.toggle('is-on', b.dataset.emoji === emoji.value.trim()); });
          App.$$('[data-day]', s).forEach(function (b) { b.classList.toggle('is-on', st.days.indexOf(+b.dataset.day) > -1); });
          s.querySelector('[data-everyday]').classList.toggle('is-on', st.days.length === 7);
        }
        paint();
        emoji.addEventListener('input', paint);
        s.addEventListener('click', function (ev) {
          var t = ev.target.closest('button');
          if (!t) return;
          if (t.dataset.emoji) emoji.value = t.dataset.emoji;
          if (t.dataset.owner != null) {
            st.owner = t.dataset.owner;
            App.$$('[data-owner]', s).forEach(function (b) { b.classList.toggle('is-on', b === t); });
          }
          if (t.dataset.day != null) {
            var d = +t.dataset.day, i = st.days.indexOf(d);
            if (i > -1) st.days.splice(i, 1); else st.days.push(d);
          }
          if (t.hasAttribute('data-everyday')) st.days = ALL_DAYS.slice();
          paint();
        });
      },
      read: function (s) {
        return window.Chores.toInput({ title: s.querySelector('[data-f=title]').value, emoji: s.querySelector('[data-f=emoji]').value, owner: st.owner, days: st.days });
      },
      save: function (input) {
        return App.saveChore(c.id, input).then(function (saved) {
          App.toast((isNew ? 'Added ' : 'Saved ') + '<b>' + App.esc(saved.title) + '</b>', { icon: 'tasks' });
        });
      },
      remove: isNew ? null : function () {
        return App.deleteChore(c.id).then(function () {
          App.toast('Deleted <b>' + App.esc(c.title) + '</b>', { icon: 'tasks' });
        });
      },
      name: function () { return c.title; },
      blocked: App.tickBlocked
    });
  }

  function onClick(e) {
    var t, why = App.tickBlocked();
    if (edit.click(e, why)) return;
    if (edit.on) {
      var id = (t = e.target.closest('[data-edit-ch]')) && t.dataset.editCh;
      var owner = (t = e.target.closest('[data-edit-add]')) && t.dataset.editAdd;
      if (!id && !owner) return;
      if (why) return App.toast(why, { tone: 'error', icon: 'tasks' });
      if (owner) return choreSheet({ owner: owner });
      var c = window.Chores.all(D.chores).filter(function (x) { return x.id === id; })[0];
      if (c) choreSheet(c);
      return;
    }
    if ((t = e.target.closest('[data-ch]'))) {
      var ch = find(t.dataset.ch);
      if (!ch) return;
      if (why) return App.toast(why, { tone: 'error', icon: 'tasks' });
      if (ch.done) untick(ch);
      else tick(ch);
    }
  }

  var view = {
    show: function (el) {
      if (!V.el) { V.el = el; el.addEventListener('click', onClick); }
      render();
    }
  };
  App.register('tasks', view);
  // Going offline or coming back changes whether ticking works: re-render (or rebuild on the next
  // visit) when the note changes.
  App.on('choresstate', function () {
    if (!V.el || App.choresNote() === V.note) return;
    if (App.current === 'tasks') render();
    else view._dirty = true;
  });
})();
