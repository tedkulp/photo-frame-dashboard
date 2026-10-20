// Home / Today: the glanceable overview. Never scrolls.
(function () {
  'use strict';
  var D = window.DATA, V = {};

  function clock() {
    var n = App.now();
    return '<div class="h-time num">' + App.fmt.time(n, false) + '<span class="h-ampm">' + App.fmt.ampm(n) + '</span></div>' +
      '<div class="h-date"><b>' + App.fmt.day(n) + '</b> ' + App.fmt.month(n) + ' ' + n.getDate() + '</div>';
  }

  function weather() {
    var w = App.weatherNow(), note = App.weatherNote();
    if (!w) return '<div class="h-wx-top"><span class="h-wx-icon h-wx-none">' + App.icon('cloud', 60) + '</span><span class="h-wx-say">' + note + '</span></div>';
    var hours = w.hours;
    var tmin = Math.min.apply(null, hours.map(function (h) { return h.temp; }));
    var tmax = Math.max.apply(null, hours.map(function (h) { return h.temp; }));
    return '<div class="h-wx-top">' +
      '<span class="h-wx-icon">' + App.icon(w.cond, 60) + '</span>' +
      '<span class="h-wx-temp num">' + w.temp + '°</span>' +
      '<span class="h-wx-meta"><b>' + w.label + '</b><span>H ' + w.hi + '°  L ' + w.lo + '°</span>' + (note ? '<small>' + note + '</small>' : '') + '</span>' +
      '</div>' +
      '<div class="h-wx-say"><b>' + w.summary + '.</b> ' + w.advice + '.</div>' +
      '<div class="h-wx-hours">' + hours.map(function (h) {
        var lift = tmax === tmin ? 0 : Math.round((h.temp - tmin) / (tmax - tmin) * 8);
        return '<div class="h-hr' + (h.wet ? ' is-wet' : '') + '"><span class="h-hr-l">' + h.label + '</span>' +
          '<span class="h-hr-i" style="transform:translateY(' + -lift + 'px)">' + App.icon(h.cond, 22) + '</span><b>' + h.temp + '°</b></div>';
      }).join('') + '</div>';
  }

  // The family, and a note while the calendar is missing or stale. No presence: there's no real source.
  function people() {
    var size = D.people.length > 4 ? 26 : 36;
    return D.people.map(function (p) {
      return '<div class="h-who" style="' + App.pstyle(p) + '">' + App.avatar(p, size) + '<b>' + App.esc(p.name) + '</b></div>';
    }).join('') + '<small class="h-feed feed-note">' + App.feedNote() + '</small>';
  }

  function hero() {
    var e = App.nextEvent(), now = App.now();
    if (!App.hasCalendar()) {
      return '<div class="h-hero h-hero--empty" data-go="calendar">' +
        '<div class="label label--light">Calendar</div>' +
        '<div class="h-hero-title serif feed-note">' + App.feedNote() + '</div></div>';
    }
    if (!e) {
      var tomorrow = App.timedOn(App.addDays(now, 1))[0];
      return '<div class="h-hero h-hero--empty" data-go="calendar">' +
        '<div class="label label--light">Rest of today</div>' +
        '<div class="h-hero-title serif">Nothing else scheduled.<br><i>Enjoy the quiet.</i></div>' +
        (tomorrow ? '<div class="h-hero-meta">Tomorrow starts with <b>' + App.esc(tomorrow.title) + '</b> at ' + App.fmt.time(tomorrow.start) + '</div>' : '') +
        '</div>';
    }
    var p = App.evColor(e);
    var mins = (e.start - now) / 60000;
    var leave = (App.leaveBy(e) - now) / 60000;
    var who = e.people.map(function (id) { return App.esc(App.person(id).name); });
    var whoText = App.isFamily(e) ? 'Everyone' : who.join(' + ');
    var big = mins < 100
      ? '<div class="h-hero-count num">' + Math.round(mins) + '<small>min</small></div>'
      : '<div class="h-hero-count num">' + App.fmt.time(e.start, false) + '<small>' + App.fmt.ampm(e.start) + '</small></div>';
    var leavePill = '';
    if (e.travel) {
      leavePill = leave <= 0
        ? '<span class="pill pill--alert"><i class="pulse"></i>Leave now</span>'
        : '<span class="pill' + (leave <= 15 ? ' pill--soon' : '') + '">' + App.icon('car', 20) + 'Leave in ' + App.fmt.mins(leave) + '</span>';
    }
    return '<button class="h-hero" style="' + App.pstyle(p) + '" data-ev="' + e.id + '">' +
      '<div class="h-hero-main">' +
      '  <div class="label label--on">Next up · ' + App.esc(whoText) + '</div>' +
      '  <div class="h-hero-title serif">' + App.esc(e.title) + '</div>' +
      '  <div class="h-hero-meta">' + App.fmt.range(e.start, e.end) + (e.loc ? ' · ' + App.esc(e.loc) : '') + '</div>' +
      '  <div class="h-hero-foot">' + (e.people.length > 1 ? App.dots(e.people, 22) : '') + leavePill + '</div>' +
      '</div>' + big + '</button>';
  }

  function lanes() {
    var now = App.now();
    return D.people.map(function (p) {
      var list = App.timedOn(now, p.id).filter(function (e) { return e.end > now; });
      var shown = list.slice(0, 3), more = list.length - shown.length;
      return '<div class="h-lane" style="' + App.pstyle(p) + '">' +
        '<div class="h-lane-head">' + App.avatar(p, 30) + '<b>' + App.esc(p.name) + '</b></div>' +
        (list.length ? shown.map(function (e) {
          var cur = e.start <= now;
          return '<button class="h-ev' + (cur ? ' is-now' : '') + '" data-ev="' + e.id + '">' +
            '<span class="h-ev-t">' + (cur ? 'Now' : App.fmt.time(e.start, false)) + '</span>' +
            '<span class="h-ev-n">' + App.esc(e.title) + '</span></button>';
        }).join('') : '<div class="h-free serif"><i>Free</i> the rest of the day</div>') +
        (more > 0 ? '<button class="h-more" data-go="calendar">+' + more + ' more</button>' : '') +
        '</div>';
    }).join('');
  }

  function ring(done, total, size) {
    var r = size / 2 - 5, c = 2 * Math.PI * r, f = total ? done / total : 0;
    return '<svg class="ring" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' +
      '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" class="ring-bg"/>' +
      '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" class="ring-fg" stroke-dasharray="' + (c * f) + ' ' + c + '" transform="rotate(-90 ' + size / 2 + ' ' + size / 2 + ')"/></svg>';
  }
  App.ring = ring;

  function chores() {
    var r = App.currentRoutine(), today = App.choresToday(r.id), note = App.choresNote();
    var who = App.choreOwners();
    if (!D.chores) return '<div class="label">Chores · ' + r.name + '</div><div class="h-chores-note">' + note + '</div>';
    if (!today.length) {
      var none = D.chores.chores.length ? 'Nothing this ' + r.name.toLowerCase() : 'No chores yet';
      return '<div class="label">Chores · ' + r.name + '</div><div class="h-chores-empty"><b class="serif"><i>' + none + '</i></b>' +
        '<small class="h-chores-note">' + (note || (D.chores.chores.length ? 'Tap to see all chores' : 'Tap to add some')) + '</small></div>';
    }
    return '<div class="label">Chores · ' + r.name + '</div><div class="h-rings">' + who.map(function (id) {
      var list = today.filter(function (c) { return c.owner === id; });
      if (!list.length) return '';
      var done = list.filter(function (c) { return c.done; }).length;
      var p = App.person(id);
      return '<div class="h-ring' + (done === list.length ? ' is-done' : '') + '" style="' + App.pstyle(p) + '">' + ring(done, list.length, 64) +
        '<b class="num">' + (done === list.length ? '✓' : done + '/' + list.length) + '</b><span>' + App.esc(App.choreOwnerName(id)) + '</span></div>';
    }).join('') + '</div>' + (note ? '<small class="h-chores-note">' + note + '</small>' : '');
  }

  function shopping() {
    var open = D.groceries.filter(function (g) { return !g.done; });
    var recent = open.slice(-3).reverse();
    return '<div class="label">Shopping</div>' +
      '<div class="h-stat"><span class="num">' + open.length + '</span><small>items to get</small></div>' +
      '<ul class="h-recent">' + recent.map(function (g) {
        return '<li><i></i>' + App.esc(g.name) + '</li>';
      }).join('') + '</ul>';
  }

  function status() {
    var lights = D.devices.filter(function (d) { return d.type === 'light' && d.on; }).length;
    var unlocked = D.devices.filter(function (d) { return d.type === 'lock' && !d.locked; });
    var garage = D.devices.filter(function (d) { return d.type === 'garage'; })[0];
    var secure = !unlocked.length && garage.state === 'closed';
    var secText = secure ? 'All locked' : (garage.state !== 'closed' ? 'Garage open' : unlocked[0].name + ' unlocked');
    return '<div class="label">Home</div>' +
      '<div class="h-st-row">' + App.icon('bulb', 24) + '<b class="num">' + lights + '</b><span>lights on</span></div>' +
      '<div class="h-st-row' + (secure ? '' : ' is-warn') + '">' + App.icon(secure ? 'lock' : 'unlock', 24) + '<span>' + secText + '</span></div>' +
      '<div class="h-st-row">' + App.icon('thermo', 24) + '<b class="num">' + D.climate.current + '°</b><span>inside</span></div>';
  }

  function paint() {
    var el = V.el;
    el.querySelector('.h-clock').innerHTML = clock();
    el.querySelector('.h-weather').innerHTML = weather();
    el.querySelector('.h-presence').innerHTML = people();
    el.querySelector('.h-hero-slot').innerHTML = hero();
    el.querySelector('.h-lanes').style.gridTemplateColumns = App.cols(D.people.length);
    el.querySelector('.h-lanes').innerHTML = lanes();
    el.querySelector('.h-chores').innerHTML = chores();
    el.querySelector('.h-shop').innerHTML = shopping();
    el.querySelector('.h-status').innerHTML = status();
  }

  function photoCaption(s) {
    var m = App.photoMeta(s.photos[0]);
    V.el.querySelector('.h-photo-cap').innerHTML = '<b>' + (m.onThisDay ? 'On this day · ' : '') + m.kicker + '</b><span>' + App.esc(m.place) + '</span>';
  }

  App.register('home', {
    show: function (el) {
      V.el = el;
      if (!el.firstChild) {
        el.innerHTML = '<div class="home">' +
          '<div class="h-clock" data-go="calendar"></div>' +
          '<div class="h-weather"></div>' +
          '<div class="h-presence"></div>' +
          '<div class="h-main"><div class="h-hero-slot"></div><div class="h-lanes" ></div></div>' +
          '<div class="h-side">' +
          '  <button class="h-photo" data-go="photos"><div class="h-photo-stage"></div><div class="h-photo-cap"></div></button>' +
          '  <button class="h-chores card" data-go="tasks"></button>' +
          '  <div class="h-duo"><button class="h-shop card" data-go="shopping"></button><button class="h-status card" data-go="control"></button></div>' +
          '</div></div>';
        el.addEventListener('click', function (e) {
          var ev = e.target.closest('[data-ev]');
          if (ev) { App.eventSheet(App.findEvent(ev.dataset.ev)); return; }
          var g = e.target.closest('[data-go]');
          if (g) App.go(g.dataset.go);
        });
        V.slides = new App.Slideshow(el.querySelector('.h-photo-stage'), { layout: 'cover', captions: false, interval: 12000, onChange: photoCaption });
      }
      paint();
      V.slides.start();
    },
    resume: function () { V.slides.start(); },
    hide: function () { if (V.slides) V.slides.stop(); }
  });
  // Every minute: just the clock and next-up countdown (cheap, even while hidden). Weather on the
  // hour, or every minute while it has a note (loading, missing, stale).
  function paintWeather() { if (V.el && V.el.firstChild) V.el.querySelector('.h-weather').innerHTML = weather(); }
  App.on('minute', function (n) {
    if (!V.el || !V.el.firstChild) return;
    V.el.querySelector('.h-clock').innerHTML = clock();
    V.el.querySelector('.h-hero-slot').innerHTML = hero();
    if (n.getMinutes() === 0 || App.weatherNote()) paintWeather();
    if (n.getMinutes() === 0) V.el.querySelector('.h-lanes').innerHTML = lanes();
  });
  App.on('weatherstate', paintWeather);
  App.on('choresstate', function () { if (V.el && V.el.firstChild) V.el.querySelector('.h-chores').innerHTML = chores(); });
  App.on('data', function () { if (App.current === 'home') paint(); });
})();
