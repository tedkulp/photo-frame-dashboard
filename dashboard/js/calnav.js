// The Calendar view's date rules (views/calendar.js): which date a mode starts on when you switch
// to it, and its Sun–Sat weeks (Week shows the week containing the date; Month's grid starts on a
// Sunday). Also loads in Node for dashboard/test/calnav.test.js.
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

  // Midnight on the Sunday of the Sun–Sat week containing `d`. Built from the calendar date, not
  // by subtracting milliseconds, so a DST change inside the week doesn't shift it off midnight.
  CalNav.weekStart = function (d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay());
  };

  // Week's header kicker for the week containing `d`: "This week", "Next week" or "Last week"
  // relative to `now`'s week, else the year the week starts in.
  CalNav.weekKicker = function (d, now) {
    var s = CalNav.weekStart(d);
    var n = Math.round((s - CalNav.weekStart(now)) / (7 * 864e5)); // round: DST weeks are ±1 h
    return n === 0 ? 'This week' : n === 1 ? 'Next week' : n === -1 ? 'Last week' : String(s.getFullYear());
  };

  // The date mode `to` shows after its button is tapped in mode `from` on `date`. Month shows the
  // date's month from its 1st; leaving Month follows leaveMonth; otherwise the date is kept. Week
  // then shows the Sun–Sat week containing the date it gets (weekStart), so from Month that's the
  // week containing today on the current month, else the week containing the shown month's 1st.
  CalNav.modeDate = function (from, to, date, now) {
    if (to === 'month') return new Date(date.getFullYear(), date.getMonth(), 1);
    if (from === 'month') return CalNav.leaveMonth(date, now);
    return date;
  };
})(typeof window !== 'undefined' ? window : globalThis);
