// Today's all-day strip (views/home.js): how long an event runs on, and how many chips fit on the
// frame's one line. Also loads in Node for dashboard/test/allday.test.js.
(function (root) {
  'use strict';
  var AllDay = root.AllDay = {};

  // App.dayStart's twin: this loads before app.js, and in Node.
  function dayStart(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; }

  // The event's last day when it runs on past `day` (the chip reads "until <that weekday>"), else
  // null. All-day events end at local midnight, exclusive: a Friday-only event ends Saturday 00:00.
  AllDay.until = function (e, day) {
    var last = new Date(e.end);
    last.setDate(last.getDate() - 1);
    last = dayStart(last);
    return last > dayStart(day) ? last : null;
  };

  // How many chips (widths, in order) to show whole on one line `avail` wide with `gap` between
  // items: all of them when they fit, else as many as fit beside a "+N more" chip `moreW` wide.
  // null when nothing was measured (the view is hidden).
  AllDay.fit = function (widths, avail, gap, moreW) {
    if (!avail) return null;
    var used = 0, i;
    for (i = 0; i < widths.length; i++) used += (i ? gap : 0) + widths[i];
    if (used <= avail) return widths.length;
    used = moreW;
    for (i = 0; i < widths.length; i++) {
      used += gap + widths[i];
      if (used > avail) return i;
    }
    return widths.length;
  };
})(typeof window !== 'undefined' ? window : globalThis);
