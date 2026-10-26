// Chores from the home server's GET /api/chores (today, or ?date= another day), and which of them
// to show on that day. The refresh loop is Feed.create's (30 s, so a tick on one frame shows on
// another within half a minute); ticking goes through the same feed's send(). Dates are the
// server's local days, YYYY-MM-DD. Also loads in Node for dashboard/test/chores.test.js.
(function (root) {
  'use strict';
  var Chores = root.Chores = {};
  var MIN = 60000;
  Chores.REFRESH = 30000;
  Chores.STALE = 2 * MIN; // no good fetch for this long: treat the server as unreachable
  Chores.ANYONE = 'any'; // the owner of a chore anyone can do (the server's word for it too)
  Chores.LATE_DAYS = 7; // a chore can be ticked up to this many days late (the server's LATE_DAYS)

  var MARKS = { hit: 'hit', miss: 'miss', due: 'due' };

  // The chores feed's health, from its state(), the data and now (both unused; the same arguments as
  // House.note). '' means fine.
  var LOADING = 'Loading chores…';
  // Why ticking is off right now: nothing loaded yet, or the server isn't reachable (the last
  // request failed, or no fetch has worked for a couple of minutes).
  Chores.blocked = function (s) {
    if (s.status === 'loading') return LOADING;
    return s.status === 'offline' || s.failed || s.stale ? root.Feed.UNREACHABLE : '';
  };
  // What to say about the chores data: why there is none yet, or that it may be out of date.
  Chores.note = function (s) {
    var down = root.Feed.UNREACHABLE + ' · ';
    if (s.status === 'loading') return LOADING;
    if (s.status === 'offline') return down + 'retrying';
    if (s.failed || s.stale) return down + (s.age ? 'chores from ' + root.Feed.mins(s.age) + ' ago' : 'retrying');
    return '';
  };

  function isDays(d) {
    return Array.isArray(d) && d.length > 0 && d.every(function (n) { return n === (n | 0) && n >= 0 && n <= 6; });
  }
  function isChore(c) {
    return !!c && (typeof c.id === 'number' || typeof c.id === 'string') && typeof c.title === 'string' && typeof c.emoji === 'string' &&
      typeof c.owner === 'string' && isDays(c.days);
  }
  function toChore(c) {
    return { id: String(c.id), title: c.title, emoji: c.emoji, owner: c.owner, days: c.days.slice() };
  }

  // ------------------------------------------------------------ dates
  // Whole days added to a YYYY-MM-DD date (UTC arithmetic, so no DST hour).
  function utc(date) { return Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)); }
  Chores.addDays = function (date, n) {
    return new Date(utc(date) + n * 864e5).toISOString().slice(0, 10);
  };
  // Whether a chore on `date` can be ticked or unticked: from the server's `today` back LATE_DAYS
  // days. Later days and older ones are view-only.
  Chores.tickable = function (date, today) {
    return !!today && date <= today && date >= Chores.addDays(today, -Chores.LATE_DAYS);
  };
  // A pending tick's key: the chore on one day, so the same chore on two days never collides.
  Chores.key = function (id, date) { return id + '@' + date; };

  // The server's { date, chores, done, week, updatedAt } → { date, weekday, chores, done: { id: true },
  // week: { personId: [Sun..Sat 'hit' | 'miss' | 'due' | null] } }, ids as strings (the server's are
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
      chores: body.chores.filter(isChore).map(toChore),
      done: done,
      week: week
    };
  };
  // Every load has a new updatedAt; only the chores themselves count as a change.
  Chores.changeKey = function (body) {
    return JSON.stringify([body.date, body.chores, body.done, body.week]);
  };

  // Chores scheduled on the data's day (its weekday), in the server's order, each with `done`.
  // `pending` ({ Chores.key(id, date): done }) are ticks/unticks sent but not settled yet; they
  // show over the server's state on their own day only.
  Chores.day = function (data, pending) {
    if (!data) return [];
    pending = pending || {};
    return data.chores.filter(function (c) {
      return c.days.indexOf(data.weekday) > -1;
    }).map(function (c) {
      var k = Chores.key(c.id, data.date);
      return { id: c.id, title: c.title, emoji: c.emoji, owner: c.owner, done: pending.hasOwnProperty(k) ? pending[k] : !!data.done[c.id] };
    });
  };

  // Ticks and unticks sent but not answered yet: the `pending` Chores.day takes. o: { send(method,
  // path) → Promise } (the chores feed's). tick(id, done, date) shows at once and resolves once the
  // server has it: true while it's still the latest tick of that chore on that day (the caller
  // applies it to the data), false when a later tick owns it now, whether this one was taken or
  // failed (the later one's answer is what counts). A failed send of the latest tick is put back
  // and rejects with the reason. Each tick owns its chore and day by its own token, not by its done
  // value, so tick/untick/tick can't mistake the first answer for the third tap's.
  Chores.ticks = function (o) {
    var pending = {}; // { Chores.key(id, date): done }
    var owner = {};   // { Chores.key(id, date): the latest tick's token }
    return {
      tick: function (id, done, date) {
        var token = {}, k = Chores.key(id, date);
        pending[k] = done;
        owner[k] = token;
        function settle() {
          if (owner[k] !== token) return false; // a later tap on the same chore and day owns it now
          delete pending[k];
          delete owner[k];
          return true;
        }
        var path = '/api/chores/' + encodeURIComponent(id) + '/done?date=' + encodeURIComponent(date);
        return new Promise(function (ok) { ok(o.send(done ? 'PUT' : 'DELETE', path)); })
          .then(settle, function (e) { if (!settle()) return false; throw e; });
      },
      pending: function () { return pending; },
      busy: function () { return Object.keys(pending).length > 0; }
    };
  };

  // A person's week grid for the data's Sunday-to-Saturday week: { shown: the data's day's index,
  // today: the server's `today`'s index or -1 when it's another week, days: Sun..Sat 'hit' | 'miss' |
  // 'due' (still to come, with a chore) | 'none' (nothing scheduled, the server's null), dates:
  // Sun..Sat YYYY-MM-DD }, or null when the person isn't in the week.
  Chores.week = function (data, personId, today) {
    var row = data && data.week.hasOwnProperty(personId) ? data.week[personId] : null;
    if (!row) return null;
    var dates = weekDates(data);
    return { shown: data.weekday, today: dates.indexOf(today), days: row.map(function (v) { return v || 'none'; }), dates: dates };
  };
  function weekDates(data) {
    var sunday = Chores.addDays(data.date, -data.weekday);
    return [0, 1, 2, 3, 4, 5, 6].map(function (i) { return Chores.addDays(sunday, i); });
  }
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // The week grid's label: "This week" when the data's week holds `today`, else "Week of Oct 18".
  Chores.weekLabel = function (data, today) {
    var dates = weekDates(data), sun = dates[0];
    return dates.indexOf(today) > -1 ? 'This week' : 'Week of ' + MONTHS[+sun.slice(5, 7) - 1] + ' ' + +sun.slice(8, 10);
  };

  // ------------------------------------------------------------ editing
  // Every chore, whatever its days (edit mode shows them all).
  Chores.all = function (data) {
    return data ? data.chores : [];
  };

  // The edit sheet's emoji grid (any other can be typed in).
  Chores.EMOJI = ['🛏️', '🪥', '🚿', '👕', '🧦', '🧺', '🎒', '📚', '✏️', '🎹',
    '🍽️', '🥣', '🧽', '🧼', '🧹', '🗑️', '♻️', '🚮', '🪣', '🧻',
    '🐕', '🐈', '🐟', '🐾', '🌱', '🪴', '💧', '🍎', '🥪', '🥛',
    '🧸', '🧩', '🚲', '🚗', '📬', '🛒', '💊', '🧴', '💤', '✅'];
  // Weekdays in JS numbering, 0 = Sunday.
  Chores.DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  Chores.DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  // A chore's weekday badge: "Sun Wed", or "Every day".
  Chores.daysLabel = function (days) {
    if (days.length === 7) return 'Every day';
    return days.slice().sort().map(function (d) { return Chores.DAY_NAMES[d]; }).join(' ');
  };

  // The edit sheet's { title, emoji, owner, days } → the body for POST / PATCH
  // /api/chores. Throws with a message for the sheet when something is missing; the server checks
  // the rest (lengths, owner) and its message is shown the same way.
  Chores.toInput = function (f) {
    var title = String(f.title || '').trim(), emoji = String(f.emoji || '').trim();
    if (!title) throw new Error('Give the chore a name');
    if (!emoji) throw new Error('Pick an emoji');
    if (!f.days || !f.days.length) throw new Error('Pick at least one day');
    return { title: title, emoji: emoji, owner: f.owner, days: f.days.slice().sort() };
  };

  // Copies of the data with a save or a delete already applied, so the change shows before the
  // refetch that follows every write. `chore` is the server's answer to POST / PATCH.
  function withChores(data, chores) {
    var out = {};
    Object.keys(data).forEach(function (k) { out[k] = data[k]; });
    out.chores = chores;
    return out;
  }
  Chores.applySaved = function (data, chore) {
    if (!isChore(chore)) throw new Error('Unexpected chore in the answer');
    var c = toChore(chore), found = false;
    var list = data.chores.map(function (x) { if (x.id !== c.id) return x; found = true; return c; });
    if (!found) list.push(c);
    return withChores(data, list);
  };
  Chores.applyRemoved = function (data, id) {
    return withChores(data, data.chores.filter(function (x) { return x.id !== String(id); }));
  };
})(typeof window !== 'undefined' ? window : globalThis);
