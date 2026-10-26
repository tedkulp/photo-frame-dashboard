// Tasks / chores: one lane per person + "Anyone", with all of one day's chores. Chores come from
// the home server (App.choresDay); a tap ticks or unticks at once and is saved there. ‹ › step a
// day, Today comes back, and a tap on a week-grid day jumps to it; today and the 7 days before it
// can be ticked, other days are view-only. Leaving the page or going idle goes back to today.
// Edit mode (App.editMode, the reusable pattern in app.js) shows every chore with its days; a
// tap opens the edit sheet instead of ticking, and each lane ends with "+ Add". It always edits
// from today.
(function () {
  'use strict';
  var D = window.DATA;
  // date: the day shown, or null for today (which follows the server's date at midnight).
  var V = { el: null, note: null, date: null };
  var ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

  function listFor(who, today) {
    return today.filter(function (c) { return c.owner === who; })
      .sort(function (a, b) { return a.done - b.done; });
  }

  // A day too old or still to come is view-only: no data-ch, so a tap can't tick.
  function row(c, tickable) {
    var tag = tickable ? 'button' : 'div';
    return '<' + tag + ' class="ch' + (c.done ? ' is-done' : '') + (tickable ? '" data-ch="' + App.esc(c.id) : ' is-view') + '">' +
      '<span class="ch-emoji">' + App.esc(c.emoji) + '<span class="ch-check"><svg viewBox="0 0 24 24" width="30" height="30"><path d="M5 12.5l4.5 4.5L19 7"/></svg></span></span>' +
      '<span class="ch-text"><b>' + App.esc(c.title) + '</b></span>' +
      '</' + tag + '>';
  }
  // Edit mode: data-edit-ch, not data-ch, so a tap can never tick.
  function editRow(c) {
    return '<button class="ch ch--edit" data-edit-ch="' + App.esc(c.id) + '">' +
      '<span class="ch-emoji">' + App.esc(c.emoji) + '</span>' +
      '<span class="ch-text"><b>' + App.esc(c.title) + '</b><span class="ch-days">' + window.Chores.daysLabel(c.days) + '</span></span>' +
      App.icon('pencil', 20, 'ch-pen') + '</button>';
  }

  // Sunday to Saturday of the shown day's week; a tap on a day shows it.
  function weekGrid(id, date) {
    var w = App.choresWeek(id, date);
    if (!w) return '';
    return '<div class="ch-week"><div class="label">' + App.choresWeekLabel(date) + '</div><div class="ch-week-row">' + w.days.map(function (mark, i) {
      return '<button class="is-' + mark + (i === w.today ? ' is-today' : '') + (i === w.shown ? ' is-shown' : '') + '" data-goto="' + w.dates[i] + '">' +
        '<i></i>' + window.Chores.DAY_LETTERS[i] + '</button>';
    }).join('') + '</div></div>';
  }

  function laneHead(who, sub, ring) {
    var p = App.person(who);
    return '<header class="ch-head">' + App.avatar(p, 42) +
      '<div><b>' + App.esc(App.choreOwnerName(who)) + '</b><span class="ch-sub">' + sub + '</span></div>' + ring + '</header>';
  }

  function lane(who, chores, date, tickable) {
    var list = listFor(who, chores);
    var done = list.filter(function (c) { return c.done; }).length;
    var all = list.length && done === list.length;
    return '<section class="ch-lane' + (all ? ' is-complete' : '') + '" data-lane="' + App.esc(who) + '" style="' + App.pstyle(who) + '">' +
      laneHead(who, who === window.Chores.ANYONE ? 'Up for grabs' : (list.length ? done + ' of ' + list.length : 'Nothing'),
        '<div class="ch-ring">' + App.ring(done, list.length || 1, 46) + '<span class="num">' + (all ? '✓' : list.length ? done + '/' + list.length : '–') + '</span></div>') +
      '<div class="ch-list">' + (list.length ? list.map(function (c) { return row(c, tickable); }).join('') : '<div class="ch-none serif"><i>Nothing ' + (date === App.choresDate() ? 'today' : 'that day') + '</i></div>') +
      (all ? '<div class="ch-alldone serif">All done<i>!</i></div>' : '') + '</div>' +
      weekGrid(who, date) +
      '</section>';
  }

  function editLane(who) {
    var list = window.Chores.all(D.chores).filter(function (c) { return c.owner === who; });
    return '<section class="ch-lane is-editing" data-lane="' + App.esc(who) + '" style="' + App.pstyle(who) + '">' +
      laneHead(who, list.length === 1 ? '1 chore' : list.length + ' chores', '') +
      '<div class="ch-list">' + list.map(editRow).join('') + edit.addRow('data-edit-add="' + App.esc(who) + '"') + '</div>' +
      '</section>';
  }

  // The day shown: V.date, or today. A V.date that has become today (midnight) is today again.
  function shownDate() {
    if (V.date && V.date === App.choresDate()) show(null);
    return V.date || App.choresDate();
  }
  function show(date) {
    V.date = date === App.choresDate() ? null : date;
    App.choresShow(V.date);
  }
  function localDate(date) { return new Date(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)); }

  // "Today" on today; another day as the Calendar's Day heading does: "Monday 27", with the month,
  // and Yesterday or Tomorrow (by the server's date, like the rest of the page), over it.
  function title(date, isToday, tickable) {
    if (edit.on) return { kicker: 'Editing · tap a chore to change it', text: 'Today' };
    if (isToday) return { kicker: 'Chores', text: 'Today' };
    var d = localDate(date), today = App.choresDate();
    var rel = date === window.Chores.addDays(today, -1) ? ' · Yesterday' : date === window.Chores.addDays(today, 1) ? ' · Tomorrow' : '';
    return {
      kicker: 'Chores · ' + App.fmt.month(d) + ' ' + d.getFullYear() + rel + (tickable ? '' : ' · View only'),
      text: App.fmt.day(d) + ' <i>' + d.getDate() + '</i>'
    };
  }

  function render() {
    var date = D.chores ? shownDate() : null, isToday = date === App.choresDate();
    var note = App.choresDayNote(date);
    var chores = App.choresDay(date);
    var tickable = !!date && App.choreTickable(date);
    var done = chores.filter(function (c) { return c.done; }).length;
    var lanes = App.choreOwners();
    var head = title(date, isToday, tickable);
    var nav = D.chores && !edit.on;
    V.note = note;
    V.el.innerHTML = '<div class="tasks' + (App.tickBlocked() ? ' is-blocked' : '') + (edit.on ? ' is-editing' : '') + '">' +
      '<header class="t-head">' +
      (nav ? '<button class="icon-btn" data-nav="-1" aria-label="Previous day">' + App.icon('left', 24) + '</button>' : '') +
      '<div class="t-title"><div class="label">' + head.kicker + '</div><h1 class="serif">' + head.text + '</h1>' +
      (note ? '<div class="t-note">' + note + '</div>' : '') + '</div>' +
      (nav ? '<button class="icon-btn" data-nav="1" aria-label="Next day">' + App.icon('right', 24) + '</button>' +
        '<button class="btn btn--ghost' + (isToday ? ' is-hidden' : '') + '" data-today>Today</button>' : '') +
      (edit.on ? '' : '<div class="t-progress"><span class="num">' + done + '<small>/' + chores.length + '</small></span><div class="t-bar"><i style="width:' + (chores.length ? done / chores.length * 100 : 0) + '%"></i></div><span class="label">done</span></div>') +
      (D.chores ? edit.button(App.tickBlocked()) : '') +
      '</header>' +
      (D.chores && (edit.on || App.choresLoaded(date)) ? '<div class="ch-lanes" style="grid-template-columns:' + App.cols(lanes.length) + '">' + lanes.map(function (w) { return edit.on ? editLane(w) : lane(w, chores, date, tickable); }).join('') + '</div>'
        : '<div class="t-empty serif"><i>' + note + '</i></div>') +
      '</div>';
  }
  var edit = App.editMode('tasks', function () { if (V.el) render(); });

  function find(id) { return App.choresDay(shownDate()).filter(function (c) { return c.id === id; })[0]; }

  function failed(c, e) {
    App.toast('Couldn’t save <b>' + App.esc(c.title) + '</b> · ' + App.esc(e.message), { tone: 'error', icon: 'tasks' });
  }
  function untick(c, date) { App.tickChore(c.id, false, date).catch(function (e) { failed(c, e); }); }

  // Optimistic: the tick and its "done" toast (with Undo) show at once; if the save then fails,
  // the done toast goes and only the error is left. "All done today!" is for today only.
  function tick(c, date) {
    var shown = null;
    App.tickChore(c.id, true, date).catch(function (e) {
      if (shown) shown.dismiss();
      failed(c, e);
    });
    var all = App.choresDay(date);
    var undo = function () { untick(c, date); };
    shown = date === App.choresDate() && all.length && all.every(function (x) { return x.done; })
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
    // Edit mode always edits from today: from another day, go back to today first.
    if (!edit.on && V.date && !why && e.target.closest('[data-edit-toggle]')) show(null);
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
    if ((t = e.target.closest('[data-nav]'))) { show(window.Chores.addDays(shownDate(), +t.dataset.nav)); return render(); }
    if (e.target.closest('[data-today]')) { show(null); return render(); }
    if ((t = e.target.closest('[data-goto]'))) { show(t.dataset.goto); return render(); }
    if ((t = e.target.closest('[data-ch]'))) {
      var date = shownDate(), ch = find(t.dataset.ch);
      if (!ch || !App.choreTickable(date)) return;
      if (why) return App.toast(why, { tone: 'error', icon: 'tasks' });
      if (ch.done) untick(ch, date);
      else tick(ch, date);
    }
  }

  // Back to today (leaving the page, going idle): repainted now if it's still the page on screen,
  // else rebuilt on the next visit.
  function reset() {
    if (!V.date) return;
    show(null);
    if (App.current === 'tasks' && V.el) render();
    else view._dirty = true;
  }
  var view = {
    show: function (el) {
      if (!V.el) { V.el = el; el.addEventListener('click', onClick); }
      render();
    },
    hide: reset
  };
  App.register('tasks', view);
  App.on('mode', function (m) { if (m !== 'day') reset(); });
  // Going offline or coming back changes whether ticking works: re-render (or rebuild on the next
  // visit) when the note changes.
  App.on('choresstate', function () {
    if (!V.el || App.choresDayNote(V.date || App.choresDate()) === V.note) return;
    if (App.current === 'tasks') render();
    else view._dirty = true;
  });
})();
