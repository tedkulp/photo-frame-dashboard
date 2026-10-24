// Ambient (idle photo frame) and Night (dim red clock) overlays.
(function () {
  'use strict';
  var D = window.DATA, $ = App.$;
  var amb = { show: null }, shiftTimer = null, MODES = window.DisplayMode.MODES;

  function ambientInfo() {
    var n = App.now(), w = App.weatherNow(), next = App.nextEvent();
    return '<div class="amb-clock"><div class="amb-time num">' + App.fmt.time(n, false) + '</div>' +
      '<div class="amb-date">' + App.fmt.day(n) + ', ' + App.fmt.month(n) + ' ' + n.getDate() + '</div></div>' +
      '<div class="amb-right">' +
      (w ? '<div class="amb-wx">' + App.icon(w.cond, 44) + '<span class="num">' + w.temp + '°</span><small>' + w.summary + '</small></div>' : '') +
      (next ? '<div class="amb-next" style="' + App.pstyle(App.evColor(next)) + '"><i></i>' + App.esc(next.title) + ' · ' + App.fmt.time(next.start) + '</div>' : '') +
      '<div class="amb-who">' + D.people.map(function (p) { return App.avatar(p, 34, '', { presence: true }); }).join('') + '</div>' +
      '</div>';
  }
  function nightInfo() {
    var n = App.now(), tomorrow = App.addDays(n, n.getHours() < 6 ? 0 : 1);
    var first = window.CalEvents.assigned(App.timedOn(tomorrow))[0], w = App.weatherNow();
    return '<div class="nt-time num">' + App.fmt.time(n, false) + '</div>' +
      '<div class="nt-line">' + (w ? App.icon(w.cond, 26) + ' ' + w.temp + '° · ' : '') + (!App.hasCalendar() ? App.feedNote() : first ? 'First up ' + App.fmt.rel(first.start).toLowerCase() + ': <b>' + App.esc(first.title) + '</b> ' + App.fmt.time(first.start) + ' · ' + App.esc(App.person(first.people[0]).name) : 'Nothing early tomorrow') + '</div>' +
      nightLock();
  }
  function nightLock() {
    var line = window.House.nightLock(App.home(), App.homeNote());
    if (!line) return '';
    return '<div class="nt-lock' + (line.warn ? ' is-warn' : '') + '">' +
      App.icon(line.warn ? 'unlock' : 'lock', 20) + ' ' + App.esc(line.text) + '</div>';
  }

  function paint() {
    if (App.mode === MODES.AMBIENT) $('#ambient .amb-info').innerHTML = ambientInfo();
    if (App.mode === MODES.NIGHT) $('#night .nt-inner').innerHTML = nightInfo();
  }

  // Nudge static content a few px every minute so nothing sits still for hours (image retention)
  function pixelShift() {
    var x = Math.round(Math.random() * 8 - 4), y = Math.round(Math.random() * 8 - 4);
    App.$$('.amb-info, .nt-inner').forEach(function (el) { el.style.transform = 'translate(' + x + 'px,' + y + 'px)'; });
  }

  App.on('ready', function () {
    $('#ambient').innerHTML = '<div class="amb-stage"></div><div class="amb-scrim"></div><div class="amb-info"></div>';
    $('#night').innerHTML = '<div class="nt-inner"></div>';
    amb.show = new App.Slideshow($('#ambient .amb-stage'), { layout: 'cover', captions: false, interval: window.Photos.INTERVAL.ambient });
    $('#ambient').addEventListener('click', function () { App.modeInput({ type: 'tapAmbient' }); });
    $('#night').addEventListener('click', function () { App.modeInput({ type: 'tapNight' }); });
  });

  App.on('mode', function (m) {
    clearInterval(shiftTimer);
    if (m === MODES.AMBIENT) { amb.show.start(); paint(); shiftTimer = setInterval(pixelShift, 60000); }
    else amb.show.stop();
    if (m === MODES.NIGHT) { paint(); shiftTimer = setInterval(pixelShift, 60000); }
  });
  App.on('minute', paint);
  App.on('home', function () { if (App.mode === MODES.NIGHT) paint(); });
})();
