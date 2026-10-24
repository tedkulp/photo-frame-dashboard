// Which events a day, a person and a colour get, and the calendar's event maths: the day grid's
// overlap layout and visible hours, "Day N of M", leave-by and the next event to act on. An event
// with no people (people: [], from a holiday calendar, settings.calendars[].person "none") belongs
// to no one: a neutral grey chip, left out of a person's lanes and filters, never "Next up" or
// "First up". Pure: the events and dates come in as arguments. App.timedOn / allDayOn / isFamily /
// evColor / leaveBy / nextEvent / findEvent / dayStart are this module with the live data. Also
// loads in Node for dashboard/test/calevents.test.js.
(function (root) {
  'use strict';
  var CalEvents = root.CalEvents = {};

  // The colour of an event that belongs to no one, from css/tokens.css (--none*). Its all-day
  // chips aren't lifted toward white (--allday-lift): the grey would wash out.
  CalEvents.NONE = { color: 'var(--none)', rgb: 'var(--none-rgb)', ink: 'var(--none-ink)', lift: 'transparent' };

  // The event belongs to no one (a holiday calendar's).
  CalEvents.noOne = function (e) { return !e.people.length; };
  // Only the events that belong to someone (or everyone).
  CalEvents.someones = function (list) { return list.filter(function (e) { return !CalEvents.noOne(e); }); };

  // Everyone in the family is on it (with one person, nothing is a family event).
  CalEvents.isFamily = function (e, people) {
    return people.length > 1 && people.every(function (p) { return e.people.indexOf(p.id) > -1; });
  };

  // The colour (a person-shaped { color, rgb, ink }) an event is drawn in: NONE for no one, family
  // for everyone, else its first person's (family if they are gone).
  CalEvents.color = function (e, people, family) {
    if (CalEvents.noOne(e)) return CalEvents.NONE;
    if (CalEvents.isFamily(e, people)) return family;
    for (var i = 0; i < people.length; i++) if (people[i].id === e.people[0]) return people[i];
    return family;
  };

  // Local midnight on `d`'s date, as a new Date.
  var dayStart = CalEvents.dayStart = function (d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  function on(list, day, pid, allDay) {
    var s = dayStart(day), e = new Date(s);
    e.setDate(e.getDate() + 1);
    return list.filter(function (ev) {
      return !ev.allDay === !allDay && ev.start < e && ev.end > s && (!pid || ev.people.indexOf(pid) > -1);
    });
  }
  // Timed events on `day` (only person `pid`'s when given), by start, longer first.
  CalEvents.timedOn = function (list, day, pid) {
    return on(list, day, pid, false).sort(function (a, b) { return a.start - b.start || b.end - a.end; });
  };
  // All-day events on `day` (only person `pid`'s when given), in feed order.
  CalEvents.allDayOn = function (list, day, pid) { return on(list, day, pid, true); };
  // All-day events overlapping [from, to) (3 Day's strip), in feed order.
  CalEvents.allDayIn = function (list, from, to) {
    return list.filter(function (e) { return e.allDay && e.start < to && e.end > from; });
  };

  // Where `day` falls in an all-day event: { n, of } for "Day n of of" (of is 1 for a one-day event).
  CalEvents.spanDay = function (e, day) {
    return { n: Math.round((dayStart(day) - e.start) / 864e5) + 1, of: Math.round((e.end - e.start) / 864e5) };
  };

  // The event with id `id`, or undefined.
  CalEvents.find = function (list, id) {
    return list.filter(function (e) { return e.id === id; })[0];
  };

  // When to leave for an event: its start less its travel minutes, if any.
  CalEvents.leaveBy = function (e) { return e.travel ? new Date(+e.start - e.travel * 60000) : e.start; };

  // The next thing someone needs to act on at `now`: of someone's timed events today that haven't
  // started, the earliest leave-by (never an event that belongs to no one). null when there's none.
  CalEvents.next = function (list, now) {
    var up = CalEvents.someones(CalEvents.timedOn(list, now)).filter(function (e) { return e.start > now; });
    up.sort(function (a, b) { return CalEvents.leaveBy(a) - CalEvents.leaveBy(b); });
    return up[0] || null;
  };

  // ------------------------------------------------------------ the day grid (Today and 3 Day)
  // The hours the grid shows: 6 AM to 11 PM.
  CalEvents.START = 6;
  CalEvents.END = 23;

  // A timed event's { start, end } on `day`'s grid: no earlier than START, no later than END.
  CalEvents.clamp = function (e, day) {
    var s = dayStart(day), from = new Date(+s + CalEvents.START * 36e5), to = new Date(+s + CalEvents.END * 36e5);
    return { start: e.start < from ? from : e.start, end: e.end > to ? to : e.end };
  };

  // A day's timed events (sorted as timedOn sorts them) laid out side by side where they overlap:
  // [{ e, col, cols }]. Overlapping events form a cluster; a cluster of up to two columns keeps
  // them, a wider one keeps column 0 and puts the rest in one overflow item
  // { more: [events], col: 1, cols: 2, start, end } ("+N more", spanning their times).
  CalEvents.layout = function (evs) {
    var out = [], clusters = [], cur = null, curEnd = 0;
    evs.forEach(function (e) {
      if (!cur || +e.start >= curEnd) { cur = []; clusters.push(cur); curEnd = 0; }
      cur.push(e); curEnd = Math.max(curEnd, +e.end);
    });
    clusters.forEach(function (c) {
      var cols = [], placed = [];
      c.forEach(function (e) {
        var i = cols.findIndex(function (end) { return end <= +e.start; });
        if (i < 0) { i = cols.length; cols.push(0); }
        cols[i] = +e.end;
        placed.push({ e: e, col: i });
      });
      var n = cols.length;
      if (n <= 2) placed.forEach(function (p) { out.push({ e: p.e, col: p.col, cols: n }); });
      else {
        var extra = placed.filter(function (p) { return p.col > 0; }).map(function (p) { return p.e; });
        placed.filter(function (p) { return p.col === 0; }).forEach(function (p) { out.push({ e: p.e, col: 0, cols: 2 }); });
        out.push({ more: extra, col: 1, cols: 2, start: new Date(Math.min.apply(null, extra.map(function (e) { return +e.start; }))), end: new Date(Math.max.apply(null, extra.map(function (e) { return +e.end; }))) });
      }
    });
    return out;
  };
})(typeof window !== 'undefined' ? window : globalThis);
