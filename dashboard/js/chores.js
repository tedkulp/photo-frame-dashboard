// Chores from the home server's GET /api/chores, and which of them to show today. The refresh loop
// is Feed.create's (30 s, so a tick on one frame shows on another within half a minute); ticking
// goes through the same feed's send(). Also loads in Node for dashboard/test/chores.test.js.
(function (root) {
  'use strict';
  var Chores = root.Chores = {};
  var MIN = 60000;
  Chores.REFRESH = 30000;
  Chores.STALE = 2 * MIN; // no good fetch for this long: treat the server as unreachable

  var MARKS = { hit: 'hit', miss: 'miss' };

  function isDays(d) {
    return Array.isArray(d) && d.length > 0 && d.every(function (n) { return n === (n | 0) && n >= 0 && n <= 6; });
  }
  function isChore(c) {
    return !!c && (typeof c.id === 'number' || typeof c.id === 'string') && typeof c.title === 'string' && typeof c.emoji === 'string' &&
      typeof c.owner === 'string' && typeof c.routine === 'string' && isDays(c.days);
  }

  // The server's { date, chores, done, week, updatedAt } → { date, weekday, chores, done: { id: true },
  // week: { personId: [Mon..Sun 'hit' | 'miss' | null] } }, ids as strings (the server's are
  // numbers; views compare them with data-* attributes). Throws on anything else; drops malformed
  // chores and week rows. The weekday is the server's (its time zone), not the frame's clock.
  Chores.parse = function (body) {
    var m = body && typeof body.date === 'string' && /^(\d{4})-(\d{2})-(\d{2})$/.exec(body.date);
    if (!m || !Array.isArray(body.chores) || !Array.isArray(body.done) || !body.week || typeof body.week !== 'object' || Array.isArray(body.week)) {
      throw new Error('Unexpected chores response');
    }
    var done = {}, week = {};
    body.done.forEach(function (id) { done[id] = true; });
    Object.keys(body.week).forEach(function (pid) {
      var row = body.week[pid];
      if (Array.isArray(row) && row.length === 7) week[pid] = row.map(function (v) { return MARKS[v] || null; });
    });
    return {
      date: body.date,
      weekday: new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay(),
      chores: body.chores.filter(isChore).map(function (c) {
        return { id: String(c.id), title: c.title, emoji: c.emoji, owner: c.owner, routine: c.routine, days: c.days.slice() };
      }),
      done: done,
      week: week
    };
  };
  // Every load has a new updatedAt; only the chores themselves count as a change.
  Chores.changeKey = function (body) {
    return JSON.stringify([body.date, body.chores, body.done, body.week]);
  };

  // Chores scheduled today (the server's weekday) in one routine, each with `done`. `pending`
  // ({ id: done }) are ticks/unticks sent but not settled yet; they show over the server's state.
  Chores.today = function (data, routineId, pending) {
    if (!data) return [];
    pending = pending || {};
    return data.chores.filter(function (c) {
      return c.routine === routineId && c.days.indexOf(data.weekday) > -1;
    }).map(function (c) {
      return { id: c.id, title: c.title, emoji: c.emoji, owner: c.owner, routine: c.routine, done: pending.hasOwnProperty(c.id) ? pending[c.id] : !!data.done[c.id] };
    });
  };

  // A person's "This week" grid: { today: Mon-first index of the server's date, days: Mon..Sun
  // 'hit' | 'miss' | 'future' } (the server's null, i.e. nothing scheduled or not yet, is 'future'),
  // or null when the person isn't in the week.
  Chores.week = function (data, personId) {
    var row = data && data.week.hasOwnProperty(personId) ? data.week[personId] : null;
    if (!row) return null;
    return { today: (data.weekday + 6) % 7, days: row.map(function (v) { return v || 'future'; }) };
  };
})(typeof window !== 'undefined' ? window : globalThis);
