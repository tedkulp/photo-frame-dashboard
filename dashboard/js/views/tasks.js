// Tasks / chores: one lane per person + "Anyone", scoped to a routine (Morning or Evening). Chores
// come from the home server (App.choresToday); a tap ticks or unticks at once and is saved there.
(function () {
  'use strict';
  var D = window.DATA;
  var V = { el: null, routine: null, note: null };

  function routine() { return V.routine ? D.routines.filter(function (r) { return r.id === V.routine; })[0] : App.currentRoutine(); }
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

  function weekGrid(id) {
    var w = App.choresWeek(id);
    if (!w) return '';
    return '<div class="ch-week"><div class="label">This week</div><div class="ch-week-row">' + ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(function (d, i) {
      return '<span class="is-' + w.days[i] + (i === w.today ? ' is-today' : '') + '"><i></i>' + d + '</span>';
    }).join('') + '</div></div>';
  }

  function lane(who, r, today) {
    var p = App.person(who), list = listFor(who, today);
    var done = list.filter(function (c) { return c.done; }).length;
    var all = list.length && done === list.length;
    return '<section class="ch-lane' + (all ? ' is-complete' : '') + '" data-lane="' + App.esc(who) + '" style="' + App.pstyle(p) + '">' +
      '<header class="ch-head">' + App.avatar(p, 42) +
      '<div><b>' + (who === 'any' ? 'Anyone' : App.esc(p.name)) + '</b>' +
      '<span class="ch-sub">' + (who === 'any' ? 'Up for grabs' : (list.length ? done + ' of ' + list.length : 'Nothing')) + '</span></div>' +
      '<div class="ch-ring">' + App.ring(done, list.length || 1, 46) + '<span class="num">' + (all ? '✓' : list.length ? done + '/' + list.length : '–') + '</span></div>' +
      '</header>' +
      '<div class="ch-list">' + (list.length ? list.map(row).join('') : '<div class="ch-none serif"><i>Nothing this ' + r.name.toLowerCase() + '</i></div>') +
      (all ? '<div class="ch-alldone serif">All done<i>!</i></div>' : '') + '</div>' +
      weekGrid(who) +
      '</section>';
  }

  function render() {
    var r = routine(), auto = App.currentRoutine(), note = App.choresNote();
    var today = App.choresToday(r.id);
    var done = today.filter(function (c) { return c.done; }).length;
    var lanes = App.peopleIds().concat(['any']);
    V.note = note;
    V.el.innerHTML = '<div class="tasks' + (App.tickBlocked() ? ' is-blocked' : '') + '">' +
      '<header class="t-head">' +
      '<div class="t-title"><div class="label">' + (r.id === auto.id ? 'Right now · ' : '') + r.range + '</div><h1 class="serif">' + r.name + '</h1>' +
      (note ? '<div class="t-note">' + note + '</div>' : '') + '</div>' +
      '<div class="seg">' + D.routines.map(function (x) { return '<button class="' + (x.id === r.id ? 'is-on' : '') + '" data-r="' + x.id + '">' + x.name + '</button>'; }).join('') + '</div>' +
      '<div class="t-progress"><span class="num">' + done + '<small>/' + today.length + '</small></span><div class="t-bar"><i style="width:' + (today.length ? done / today.length * 100 : 0) + '%"></i></div><span class="label">done</span></div>' +
      '</header>' +
      (D.chores ? '<div class="ch-lanes" style="grid-template-columns:' + App.cols(lanes.length) + '">' + lanes.map(function (w) { return lane(w, r, today); }).join('') + '</div>'
        : '<div class="t-empty serif"><i>' + note + '</i></div>') +
      '</div>';
  }

  function find(id) { return App.choresToday(routine().id).filter(function (c) { return c.id === id; })[0]; }

  function failed(c, e) {
    App.toast('Couldn’t save <b>' + App.esc(c.title) + '</b> · ' + App.esc(e.message), { tone: 'error', icon: 'tasks' });
  }
  function untick(c) { App.tickChore(c.id, false).catch(function (e) { failed(c, e); }); }

  function tick(c) {
    var r = routine();
    App.tickChore(c.id, true).catch(function (e) { failed(c, e); });
    var all = App.choresToday(r.id);
    if (all.length && all.every(function (x) { return x.done; })) {
      App.toast('<b>' + r.name + ' routine complete!</b> Everyone crushed it.', { icon: 'check', ms: 5000, undo: function () { untick(c); } });
      return;
    }
    App.toast('<b>' + App.esc(c.title) + '</b> done', { icon: 'check', undo: function () { untick(c); } });
  }

  function onClick(e) {
    var t;
    if ((t = e.target.closest('[data-r]'))) { V.routine = t.dataset.r === App.currentRoutine().id ? null : t.dataset.r; return render(); }
    if ((t = e.target.closest('[data-ch]'))) {
      var c = find(t.dataset.ch);
      if (!c) return;
      var why = App.tickBlocked();
      if (why) return App.toast(why, { tone: 'error', icon: 'tasks' });
      if (c.done) untick(c);
      else tick(c);
    }
  }

  var view = {
    show: function (el) {
      if (!V.el) { V.el = el; el.addEventListener('click', onClick); }
      render();
    }
  };
  App.register('tasks', view);
  App.on('time', function () { V.routine = null; });
  // Going offline or coming back changes whether ticking works: re-render (or rebuild on the next
  // visit) when the note changes.
  App.on('choresstate', function () {
    if (!V.el || App.choresNote() === V.note) return;
    if (App.current === 'tasks') render();
    else view._dirty = true;
  });
})();
