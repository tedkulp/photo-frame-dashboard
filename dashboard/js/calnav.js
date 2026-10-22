// The Calendar view's date rules for its mode buttons (views/calendar.js): which date a mode
// starts on when you switch to it. Also loads in Node for dashboard/test/calnav.test.js.
(function (root) {
  'use strict';
  var CalNav = root.CalNav = {};

  // App.dayStart's twin: this loads before app.js, and in Node.
  function dayStart(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; }

  // The date Today, 3 Day or Week starts on when you leave Month showing `shown` (the 1st of the
  // month on screen): today when that's the current month (same month and year as `now`), else
  // the 1st of the shown month.
  CalNav.leaveMonth = function (shown, now) {
    var current = shown.getFullYear() === now.getFullYear() && shown.getMonth() === now.getMonth();
    return current ? dayStart(now) : new Date(shown.getFullYear(), shown.getMonth(), 1);
  };

  // The date mode `to` shows after its button is tapped in mode `from` on `date`. Month shows the
  // date's month from its 1st; leaving Month follows leaveMonth; otherwise the date is kept.
  CalNav.modeDate = function (from, to, date, now) {
    if (to === 'month') return new Date(date.getFullYear(), date.getMonth(), 1);
    if (from === 'month') return CalNav.leaveMonth(date, now);
    return date;
  };
})(typeof window !== 'undefined' ? window : globalThis);
