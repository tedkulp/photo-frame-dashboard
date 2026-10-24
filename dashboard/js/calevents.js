// Which events a day, a person and a colour get. An event with no people (people: [], from a
// holiday calendar, settings.calendars[].person "none") belongs to no one: a neutral grey chip, left
// out of a person's lanes and filters, never "Next up" or "First up". App.timedOn / allDayOn /
// isFamily / evColor are this module with the live data. Also loads in Node for
// dashboard/test/calevents.test.js.
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

  function dayStart(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
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
})(typeof window !== 'undefined' ? window : globalThis);
