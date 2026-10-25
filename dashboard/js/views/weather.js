// Weather page: now (with feels-like, humidity, wind, UV, sunrise and sunset), the next hours and
// the week, from App.weatherNow / App.weatherWeek, plus the radar when the home server has it
// (radar.js, ADR 0006). With the radar the details shrink to two lines, the radar fills the rest of
// the left column and the hours go under the week in 3-hour steps; without it the details are six
// tiles and the hours a full-width strip, one hour a column. Never scrolls on the frame; one scrolling column on a phone, where the hourly strip (one
// hour a column) scrolls sideways on its own. The radar listing is fetched only while the page is
// on screen. Weather alerts (weatheralerts.js) sit in a strip at the top while there are any.
(function () {
  'use strict';
  var V = {};
  var R = window.Radar;
  var HOUR_W = 64; // frame: one hourly column per this many px of the view's width, 12–24 of them
  var STEP = 3, STEPS = 7; // frame with the radar: 3-hour steps, as many as fill the 500 px week column
  var RADAR_KEY = 'homehq.radar'; // whether the server had a radar last time, so the layout doesn't jump
  var CREDIT = 'Radar: LibreWXR · NOAA · © OpenStreetMap contributors';

  function stored() { try { return window.localStorage.getItem(RADAR_KEY) === '1'; } catch (e) { return false; } }
  V.radar = stored(); // the page has a radar (the server's last answer)
  function stepped() { return V.radar && !App.isPhone(); } // the hours go 3 at a time under the week

  function hourCount() {
    if (App.isPhone()) return 24;
    if (stepped()) return STEP * STEPS;
    var cs = getComputedStyle(V.el);
    var inner = V.el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    return Math.max(12, Math.min(24, Math.floor(inner / HOUR_W)));
  }

  function uvWord(uv) {
    return uv < 3 ? 'Low' : uv < 6 ? 'Moderate' : uv < 8 ? 'High' : uv < 11 ? 'Very high' : 'Extreme';
  }
  function windText(speed, dir) { return speed == null ? '–' : speed + (dir ? ' ' + dir : ''); }

  function tile(icon, label, value, sub) {
    return '<div class="wx-tile card"><div class="label">' + App.icon(icon, 18) + label + '</div>' +
      '<b class="num">' + value + '</b><small>' + (sub || '') + '</small></div>';
  }
  // Sunrise / sunset are the next ones (sun.sun), so after sunset it's tomorrow's.
  function sunTile(icon, label, d) {
    if (!d) return tile(icon, label, '–');
    var when = App.sameDay(d, App.now()) ? '' : App.fmt.rel(d);
    return tile(icon, label, App.fmt.time(d, false) + '<span>' + App.fmt.ampm(d) + '</span>', when);
  }

  // Two lines of three: feels-like, humidity, wind; UV, sunrise, sunset. Missing values drop out.
  function sunText(d) { return d ? App.fmt.time(d, false) + ' ' + App.fmt.ampm(d) : null; }
  function details(w) {
    var items = [
      ['thermo', 'Feels', w.feels == null ? null : w.feels + '°'],
      ['drop', 'Humidity', w.humidity == null ? null : w.humidity + '%'],
      ['wind', 'Wind', w.wind == null ? null : w.wind + ' mph' + (w.dir ? ' ' + w.dir : '')],
      ['sun', 'UV', w.uv == null ? null : w.uv + ' ' + uvWord(w.uv).toLowerCase()],
      ['sunrise', 'Sunrise', sunText(w.sunrise)],
      ['sunset', 'Sunset', sunText(w.sunset)]
    ].filter(function (it) { return it[2] != null; });
    return '<div class="wx-details">' + items.map(function (it) {
      return '<span class="wx-det">' + App.icon(it[0], 20) + '<span>' + it[1] + '</span><b>' + it[2] + '</b></span>';
    }).join('') + '</div>';
  }

  function now(w, note) {
    var top = '<div class="wx-top">' +
      '<span class="wx-icon">' + App.icon(w.cond, 96) + '</span>' +
      '<span class="wx-temp num">' + w.temp + '°</span>' +
      '<span class="wx-meta"><b>' + w.label + '</b><span>H ' + w.hi + '°  L ' + w.lo + '°</span>' + (note ? '<small>' + note + '</small>' : '') + '</span>' +
      '</div>' +
      '<div class="wx-say"><b>' + w.summary + '.</b> ' + w.advice + '.</div>';
    if (V.radar) return top + details(w) + '<div class="wx-radar"></div>';
    return top +
      '<div class="wx-tiles">' +
      tile('thermo', 'Feels like', w.feels == null ? '–' : w.feels + '°') +
      tile('drop', 'Humidity', w.humidity == null ? '–' : w.humidity + '<span>%</span>') +
      tile('wind', 'Wind', w.wind == null ? '–' : w.wind + '<span>mph ' + w.dir + '</span>', w.gust != null ? 'Gusts ' + w.gust + ' mph' : '') +
      tile('sun', 'UV index', w.uv == null ? '–' : w.uv, w.uv == null ? '' : uvWord(w.uv)) +
      sunTile('sunrise', 'Sunrise', w.sunrise) +
      sunTile('sunset', 'Sunset', w.sunset) +
      '</div>';
  }

  function hours(w) {
    var list = stepped() ? window.Weather.steps(w.hours, STEP) : w.hours;
    return '<div class="label">' + (stepped() ? 'Next hours, 3 at a time' : 'Next hours') + '</div>' +
      '<div class="wx-strip" style="--hours:' + list.length + '">' + list.map(function (h) {
        return '<div class="wx-hr' + (h.wet ? ' is-wet' : '') + '"><span class="wx-hr-l">' + h.label + '</span>' +
          '<span class="wx-hr-i">' + App.icon(h.cond, 28) + '</span><b class="num">' + h.temp + '<i>°</i></b>' +
          '<span class="wx-hr-pop">' + (h.pop ? h.pop + '%' : '') + '</span>' +
          '<span class="wx-hr-wind">' + windText(h.wind, h.dir) + '</span></div>';
      }).join('') + '</div>';
  }

  function week(days) {
    if (!days.length) return '<div class="label">This week</div>';
    var min = Math.min.apply(null, days.map(function (d) { return d.lo; }));
    var max = Math.max.apply(null, days.map(function (d) { return d.hi; }));
    var span = Math.max(1, max - min);
    return '<div class="label">This week</div><div class="wx-days">' + days.map(function (d) {
      var width = Math.max(4, (d.hi - d.lo) / span * 100), left = Math.min((d.lo - min) / span * 100, 100 - width);
      return '<div class="wx-day' + (d.wet ? ' is-wet' : '') + '">' +
        '<b class="wx-day-n">' + (App.sameDay(d.at, App.now()) ? 'Today' : App.fmt.dayShort(d.at)) + '</b>' +
        '<span class="wx-day-i">' + App.icon(d.cond, 30) + '</span>' +
        '<span class="wx-day-pop">' + (d.pop ? d.pop + '%' : '') + '</span>' +
        '<span class="wx-day-lo num">' + d.lo + '°</span>' +
        '<span class="wx-bar"><i style="left:' + left.toFixed(1) + '%;width:' + width.toFixed(1) + '%"></i></span>' +
        '<span class="wx-day-hi num">' + d.hi + '°</span>' +
        '<span class="wx-day-wind">' + windText(d.wind, d.dir) + '</span>' +
        '</div>';
    }).join('') + '</div>';
  }

  // ------------------------------------------------------------ weather alerts (alerts.js)
  // A strip at the top, one row per active alert (every severity), worst first; a row opens the
  // alert's sheet. Hidden with no alerts and nothing to say about them.
  function alertStrip() {
    var list = App.alerts(), note = App.alertsNote(), now = App.now();
    return list.map(function (a) {
      return '<button class="wx-al is-sev-' + window.Alerts.severityRank(a) + '" data-alert="' + App.esc(a.id) + '">' +
        App.icon('alert', 24) + '<b>' + App.esc(a.event) + '</b>' +
        '<span>' + App.esc(window.Alerts.until(a, now)) + '</span>' + (a.fake ? '<small>Test</small>' : '') + '</button>';
    }).join('') + (note ? '<div class="wx-al-note">' + App.icon('alert', 20) + note + '</div>' : '');
  }
  // Repaints just the strip (on a new listing and every minute); the radar is refitted if the
  // strip's height changed.
  function paintAlerts() {
    var box = V.el && V.el.querySelector('.wx-alerts');
    if (!box) return;
    var html = alertStrip();
    if (html === V.alertsHtml) return;
    V.alertsHtml = html;
    box.innerHTML = html;
    fitRadar();
  }

  function paint() {
    var el = V.el, w = App.weatherNow(V.hours = hourCount()), note = App.weatherNote();
    V.alertsHtml = alertStrip();
    var strip = '<div class="wx-alerts">' + V.alertsHtml + '</div>';
    if (!w) {
      el.innerHTML = '<div class="wx-page">' + strip + '<div class="wx wx--none"><span class="wx-icon">' + App.icon('cloud', 96) + '</span><p class="wx-say">' + note + '</p></div></div>';
      return;
    }
    el.innerHTML = '<div class="wx-page">' + strip + '<div class="wx' + (V.radar ? ' wx--radar' : '') + '">' +
      '<section class="wx-now">' + now(w, note) + '</section>' +
      '<section class="wx-week">' + week(App.weatherWeek()) + '</section>' +
      '<section class="wx-hours">' + hours(w) + '</section>' +
      '</div></div>';
    // The radar's element is kept across repaints, so its images and loop carry on.
    var slot = el.querySelector('.wx-radar');
    if (slot) { slot.appendChild(radarEl()); fitRadar(); }
  }

  // ------------------------------------------------------------ radar
  // V.rd: the parsed listing (null until one arrives); V.live: the page is on screen, so the listing
  // is fetched every Radar.REFRESH and the frames loop.
  function radarEl() {
    if (!V.rdEl) {
      V.rdEl = document.createElement('div');
      V.rdEl.className = 'rd';
      V.rdEl.innerHTML = '<div class="rd-box"><div class="rd-win"><div class="rd-map"></div><div class="rd-frames"></div></div>' +
        '<i class="rd-home"></i><span class="rd-time"></span><span class="rd-note"></span></div>' +
        '<div class="rd-credit">' + CREDIT + '</div>';
    }
    return V.rdEl;
  }
  // The radar's square window, centred and scaled to cover its box.
  function fitRadar() {
    var box = V.rdEl && V.rdEl.querySelector('.rd-box'), r = V.rd;
    if (!box || !r || !box.clientWidth) return;
    var s = Math.max(box.clientWidth, box.clientHeight) / r.size;
    V.rdEl.querySelector('.rd-win').style.cssText = 'width:' + r.size + 'px;height:' + r.size + 'px;transform:translate(-50%,-50%) scale(' + s.toFixed(4) + ')';
  }
  function img(url, cls, left, top) {
    return '<img class="' + cls + '" src="' + url + '" alt=""' + (left == null ? '' : ' style="left:' + left + 'px;top:' + top + 'px"') + '>';
  }
  function noteRadar() {
    if (V.rdEl && V.rd) V.rdEl.querySelector('.rd-note').textContent = R.note(V.rd, App.now());
  }
  // Puts a new listing in: the map and the frames are rebuilt only when they changed.
  function renderRadar() {
    var r = V.rd, el = radarEl();
    var mapKey = r.map.map(function (t) { return t.url; }).join(), framesKey = r.frames.map(function (f) { return f.id; }).join();
    if (mapKey !== V.mapKey) {
      V.mapKey = mapKey;
      el.querySelector('.rd-map').innerHTML = r.map.map(function (t) { return img(t.url, 'rd-tile', t.left, t.top); }).join('');
    }
    if (framesKey !== V.framesKey) {
      V.framesKey = framesKey;
      el.querySelector('.rd-frames').innerHTML = r.frames.map(function (f) { return img(f.url, 'rd-frame'); }).join('');
      V.frame = R.first(r);
      clearTimeout(V.loop);
      V.loop = null;
    }
    fitRadar();
    noteRadar();
    if (V.live && !V.loop) loop();
  }
  function loop() {
    var r = V.rd, frames = V.rdEl.querySelectorAll('.rd-frame');
    if (!r.frames.length) { V.rdEl.querySelector('.rd-time').textContent = ''; V.loop = null; return; }
    for (var k = 0; k < frames.length; k++) frames[k].classList.toggle('is-on', k === V.frame);
    V.rdEl.querySelector('.rd-time').textContent = R.label(r, V.frame);
    V.loop = setTimeout(function () { V.frame = R.next(r, V.frame); loop(); }, R.delay(r, V.frame));
  }
  // The server says whether there is a radar; a change of answer changes the page's layout.
  function setRadar(on) {
    if (on === V.radar) return;
    V.radar = on;
    try { window.localStorage.setItem(RADAR_KEY, on ? '1' : '0'); } catch (e) {}
    if (V.el) paint();
  }
  function fetchRadar() {
    clearTimeout(V.fetch);
    V.fetch = setTimeout(fetchRadar, R.REFRESH); // set first, so a request that never answers can't stop the loop
    window.fetch('/api/radar', { cache: 'no-store' }).then(function (res) {
      if (res.status === 404) return { configured: false }; // a server from before the radar
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function (body) {
      var r = R.parse(body);
      if (!V.live) return;
      setRadar(r.configured);
      if (!r.configured) return;
      V.rd = r;
      renderRadar();
    }).catch(function (e) {
      console.error('[radar]', e);
      // Nothing to show yet: say so over the (empty) map.
      if (V.live && !V.rd && V.rdEl) V.rdEl.querySelector('.rd-note').textContent = 'Radar unavailable';
    });
  }
  function live(on) {
    if (V.live === on) return;
    V.live = on;
    clearTimeout(V.fetch);
    clearTimeout(V.loop);
    V.loop = null;
    if (!on) return;
    fetchRadar();
    if (V.rd) renderRadar();
  }

  App.register('weather', {
    show: function (el) {
      if (V.el !== el) {
        el.addEventListener('click', function (e) {
          var b = e.target.closest('[data-alert]');
          if (b) App.alertSheet(App.findAlert(b.getAttribute('data-alert')));
        });
      }
      V.el = el;
      paint();
      if (App.current === 'weather') live(true); // not when pre-built in the background
    },
    resume: function () { live(true); fitRadar(); },
    hide: function () { live(false); }
  });
  // Only day mode shows the page (ambient and night leave through Today anyway).
  App.on('mode', function (m) { if (App.current === 'weather') live(m === window.DisplayMode.MODES.DAY); });
  function repaint() { if (V.el && App.current === 'weather') paint(); else if (App.views.weather) App.views.weather._dirty = true; }
  // The hours move on the hour; a note (loading, missing, stale) is kept current every minute.
  App.on('minute', function (n) { if (n.getMinutes() === 0 || App.weatherNote()) repaint(); if (V.live) noteRadar(); });
  App.on('weatherstate', repaint);
  App.on('alerts', paintAlerts);
  App.on('minute', paintAlerts);
  // How many hours fit follows the stage's width.
  App.on('stage', function () { if (V.el && V.hours !== hourCount()) repaint(); if (V.live) fitRadar(); });
})();
