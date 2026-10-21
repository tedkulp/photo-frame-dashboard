// Weather page: now (with feels-like, humidity, wind, UV, sunrise and sunset), the next hours and
// the week, from App.weatherNow / App.weatherWeek. Never scrolls on the frame; one scrolling column
// on a phone, where the hourly strip scrolls sideways on its own.
(function () {
  'use strict';
  var V = {};
  var HOUR_W = 64; // frame: one hourly column per this many px of the view's width, 12–24 of them

  function hourCount() {
    if (App.isPhone()) return 24;
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

  function now(w, note) {
    return '<div class="wx-top">' +
      '<span class="wx-icon">' + App.icon(w.cond, 96) + '</span>' +
      '<span class="wx-temp num">' + w.temp + '°</span>' +
      '<span class="wx-meta"><b>' + w.label + '</b><span>H ' + w.hi + '°  L ' + w.lo + '°</span>' + (note ? '<small>' + note + '</small>' : '') + '</span>' +
      '</div>' +
      '<div class="wx-say"><b>' + w.summary + '.</b> ' + w.advice + '.</div>' +
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
    var list = w.hours;
    return '<div class="label">Next hours</div>' +
      '<div class="wx-strip" style="--hours:' + list.length + '">' + list.map(function (h) {
        return '<div class="wx-hr' + (h.wet ? ' is-wet' : '') + '"><span class="wx-hr-l">' + h.label + '</span>' +
          '<span class="wx-hr-i">' + App.icon(h.cond, 28) + '</span><b class="num">' + h.temp + '°</b>' +
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

  function paint() {
    var el = V.el, w = App.weatherNow(V.hours = hourCount()), note = App.weatherNote();
    if (!w) {
      el.innerHTML = '<div class="wx wx--none"><span class="wx-icon">' + App.icon('cloud', 96) + '</span><p class="wx-say">' + note + '</p></div>';
      return;
    }
    el.innerHTML = '<div class="wx">' +
      '<section class="wx-now">' + now(w, note) + '</section>' +
      '<section class="wx-week">' + week(App.weatherWeek()) + '</section>' +
      '<section class="wx-hours">' + hours(w) + '</section>' +
      '</div>';
  }

  App.register('weather', {
    show: function (el) { V.el = el; paint(); }
  });
  function repaint() { if (V.el && App.current === 'weather') paint(); else if (App.views.weather) App.views.weather._dirty = true; }
  // The hours move on the hour; a note (loading, missing, stale) is kept current every minute.
  App.on('minute', function (n) { if (n.getMinutes() === 0 || App.weatherNote()) repaint(); });
  App.on('weatherstate', repaint);
  // How many hours fit follows the stage's width.
  App.on('stage', function () { if (V.el && V.hours !== hourCount()) repaint(); });
})();
