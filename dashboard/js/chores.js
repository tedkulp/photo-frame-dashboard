// Chores from the home server's GET /api/chores, and which of them to show today. The refresh loop
// is Feed.create's (30 s, so a tick on one frame shows on another within half a minute); ticking
// goes through the same feed's send(). Also loads in Node for dashboard/test/chores.test.js.
(function (root) {
  'use strict';
  var Chores = root.Chores = {};
  var MIN = 60000;
  Chores.REFRESH = 30000;
  Chores.STALE = 2 * MIN; // no good fetch for this long: treat the server as unreachable
  Chores.ANYONE = 'any'; // the owner of a chore anyone can do (the server's word for it too)

  var MARKS = { hit: 'hit', miss: 'miss', due: 'due' };

  function isDays(d) {
    return Array.isArray(d) && d.length > 0 && d.every(function (n) { return n === (n | 0) && n >= 0 && n <= 6; });
  }
  function isChore(c) {
    return !!c && (typeof c.id === 'number' || typeof c.id === 'string') && typeof c.title === 'string' && typeof c.emoji === 'string' &&
      typeof c.owner === 'string' && typeof c.routine === 'string' && isDays(c.days);
  }
  function toChore(c) {
    return { id: String(c.id), title: c.title, emoji: c.emoji, owner: c.owner, routine: c.routine, days: c.days.slice() };
  }

  // The server's { date, chores, done, week, updatedAt } → { date, weekday, chores, done: { id: true },
  // week: { personId: [Mon..Sun 'hit' | 'miss' | 'due' | null] } }, ids as strings (the server's are
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

  // Ticks and unticks sent but not answered yet: the `pending` Chores.today takes. o: { send(method,
  // path) → Promise } (the chores feed's). tick(id, done) shows at once and resolves once the server
  // has it: true while it's still the chore's latest tick (the caller applies it to the data),
  // false when a later tick owns the chore now, whether this one was taken or failed (the later
  // one's answer is what counts). A failed send of the latest tick is put back and rejects with
  // the reason. Each tick owns the chore by its own token, not by its done value, so
  // tick/untick/tick can't mistake the first answer for the third tap's.
  Chores.ticks = function (o) {
    var pending = {}; // { choreId: done }
    var owner = {};   // { choreId: the latest tick's token }
    return {
      tick: function (id, done) {
        var token = {};
        pending[id] = done;
        owner[id] = token;
        function settle() {
          if (owner[id] !== token) return false; // a later tap on the same chore owns it now
          delete pending[id];
          delete owner[id];
          return true;
        }
        return new Promise(function (ok) { ok(o.send(done ? 'PUT' : 'DELETE', '/api/chores/' + encodeURIComponent(id) + '/done')); })
          .then(settle, function (e) { if (!settle()) return false; throw e; });
      },
      pending: function () { return pending; },
      busy: function () { return Object.keys(pending).length > 0; }
    };
  };

  // A person's "This week" grid: { today: Mon-first index of the server's date, days: Mon..Sun
  // 'hit' | 'miss' | 'due' (still to come, with a chore) | 'none' (nothing scheduled, the server's null) },
  // or null when the person isn't in the week.
  Chores.week = function (data, personId) {
    var row = data && data.week.hasOwnProperty(personId) ? data.week[personId] : null;
    if (!row) return null;
    return { today: (data.weekday + 6) % 7, days: row.map(function (v) { return v || 'none'; }) };
  };

  // ------------------------------------------------------------ editing
  // Every chore in a routine, whatever its days (edit mode shows them all).
  Chores.inRoutine = function (data, routineId) {
    if (!data) return [];
    return data.chores.filter(function (c) { return c.routine === routineId; });
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

  // The edit sheet's { title, emoji, owner, routine, days } → the body for POST / PATCH
  // /api/chores. Throws with a message for the sheet when something is missing; the server checks
  // the rest (lengths, owner) and its message is shown the same way.
  Chores.toInput = function (f) {
    var title = String(f.title || '').trim(), emoji = String(f.emoji || '').trim();
    if (!title) throw new Error('Give the chore a name');
    if (!emoji) throw new Error('Pick an emoji');
    if (!f.days || !f.days.length) throw new Error('Pick at least one day');
    return { title: title, emoji: emoji, owner: f.owner, routine: f.routine, days: f.days.slice().sort() };
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
