// Chores and what was done each day, kept in the store (see GLOSSARY.md → Chores, ADR 0002).
// Title, emoji and routine are overwritten in place. Owner, days and deletion are versions with
// an effective date: a version applies from its date until the next one, a change made today
// replaces any other change made today, and nothing is ever removed. "Today" is a local date
// (YYYY-MM-DD) from `today()`; weekdays are JS numbering, 0 = Sunday.
import { HttpError } from './errors.js';

export const TITLE_MAX = 60;
export const EMOJI_MAX = 16;
const ROUTINES = ['morning', 'evening'];
const ANYONE = 'any';

const weekday = (date) => new Date(date + 'T00:00:00Z').getUTCDay();
const addDays = (date, n) => new Date(Date.parse(date + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

// The local date at instant `t` in `timeZone`.
export function localDate(t, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(t));
  const get = (type) => parts.find((p) => p.type === type).value;
  return get('year') + '-' + get('month') + '-' + get('day');
}

export function createChores({ db, settings, today, now = Date.now }) {
  const people = settings.people.map((p) => p.id);
  const known = (owner) => owner === ANYONE || people.includes(owner);

  const q = {
    insertChore: db.prepare('INSERT INTO chores (title, emoji, routine) VALUES (?, ?, ?)'),
    updateChore: db.prepare('UPDATE chores SET title = ?, emoji = ?, routine = ? WHERE id = ?'),
    putVersion: db.prepare('INSERT OR REPLACE INTO chore_versions (chore_id, date, owner, days, deleted) VALUES (?, ?, ?, ?, ?)'),
    chores: db.prepare('SELECT id, title, emoji, routine FROM chores ORDER BY id'),
    versions: db.prepare('SELECT chore_id, date, owner, days, deleted FROM chore_versions ORDER BY chore_id, date'),
    doneOn: db.prepare('SELECT chore_id FROM chore_done WHERE date = ?'),
    doneBetween: db.prepare('SELECT chore_id, date FROM chore_done WHERE date >= ? AND date <= ?'),
    setDone: db.prepare('INSERT OR IGNORE INTO chore_done (chore_id, date) VALUES (?, ?)'),
    clearDone: db.prepare('DELETE FROM chore_done WHERE chore_id = ? AND date = ?'),
  };

  // Every chore with its versions, oldest first.
  function readAll() {
    const byId = new Map();
    for (const c of q.chores.all()) byId.set(c.id, { id: c.id, title: c.title, emoji: c.emoji, routine: c.routine, versions: [] });
    for (const v of q.versions.all()) {
      byId.get(v.chore_id).versions.push({ date: v.date, owner: v.owner, days: v.days ? v.days.split(',').map(Number) : [], deleted: Boolean(v.deleted) });
    }
    return [...byId.values()];
  }

  // The version in effect on `date`, or null before the chore existed.
  function versionAt(chore, date) {
    let found = null;
    for (const v of chore.versions) if (v.date <= date) found = v;
    return found;
  }

  function scheduledOn(chore, date) {
    const v = versionAt(chore, date);
    return Boolean(v && !v.deleted && v.days.includes(weekday(date)));
  }

  // The chore as the API shows it on `date`, or null if it is deleted, not yet created, or its
  // owner is no longer in settings.
  function shown(chore, date) {
    const v = versionAt(chore, date);
    if (!v || v.deleted || !known(v.owner)) return null;
    return { id: chore.id, title: chore.title, emoji: chore.emoji, owner: v.owner, routine: chore.routine, days: v.days.slice() };
  }

  function find(id, date) {
    const n = /^[1-9]\d*$/.test(String(id)) ? Number(id) : NaN;
    const chore = readAll().find((c) => c.id === n);
    if (!chore || !shown(chore, date)) throw new HttpError(404, 'No such chore');
    return chore;
  }

  // Checks the fields present in `input`; with `all`, every field is required.
  function check(input, all) {
    const bad = (msg) => new HttpError(400, msg);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw bad('Expected a JSON object');
    const out = {};
    const has = (k) => all || input[k] !== undefined;
    if (has('title')) {
      if (typeof input.title !== 'string' || !input.title.trim()) throw bad('title is missing');
      out.title = input.title.trim();
      if (out.title.length > TITLE_MAX) throw bad(`title is longer than ${TITLE_MAX} characters`);
    }
    if (has('emoji')) {
      if (typeof input.emoji !== 'string' || !input.emoji.trim()) throw bad('emoji is missing');
      out.emoji = input.emoji.trim();
      if (out.emoji.length > EMOJI_MAX) throw bad(`emoji is longer than ${EMOJI_MAX} characters`);
    }
    if (has('owner')) {
      if (typeof input.owner !== 'string' || !known(input.owner)) throw bad(`owner must be a person id or "${ANYONE}", not ${JSON.stringify(input.owner)}`);
      out.owner = input.owner;
    }
    if (has('routine')) {
      if (!ROUTINES.includes(input.routine)) throw bad('routine must be "morning" or "evening"');
      out.routine = input.routine;
    }
    if (has('days')) {
      const d = input.days;
      if (!Array.isArray(d) || d.length === 0 || !d.every((n) => Number.isInteger(n) && n >= 0 && n <= 6) || new Set(d).size !== d.length) {
        throw bad('days must be a non-empty list of different weekdays 0 (Sunday) to 6 (Saturday)');
      }
      out.days = d.slice().sort((a, b) => a - b);
    }
    return out;
  }

  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      db.exec('COMMIT');
      return out;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }

  // { date, chores, done, week, updatedAt } as of today.
  async function load() {
    const date = await today();
    const all = readAll();
    const chores = all.map((c) => shown(c, date)).filter(Boolean);
    const scheduledToday = new Set(all.filter((c) => shown(c, date) && scheduledOn(c, date)).map((c) => c.id));
    const done = q.doneOn.all(date).map((r) => r.chore_id).filter((id) => scheduledToday.has(id));

    // This Monday to Sunday, for every person (not Anyone): a hit day needs every chore the person
    // owned and had scheduled that day done; a day still to come with a chore is due; a day with
    // nothing scheduled is null.
    const monday = addDays(date, -((weekday(date) + 6) % 7));
    const days = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(monday, i));
    const doneSet = new Set(q.doneBetween.all(monday, days[6]).map((r) => r.chore_id + '|' + r.date));
    const week = {};
    for (const person of people) {
      week[person] = days.map((d) => {
        const mine = all.filter((c) => scheduledOn(c, d) && versionAt(c, d).owner === person);
        if (!mine.length) return null;
        if (d > date) return 'due';
        return mine.every((c) => doneSet.has(c.id + '|' + d)) ? 'hit' : 'miss';
      });
    }
    return { date, chores, done, week, updatedAt: new Date(now()).toISOString() };
  }

  async function create(input) {
    const c = check(input, true);
    const date = await today();
    const id = transaction(() => {
      const { lastInsertRowid } = q.insertChore.run(c.title, c.emoji, c.routine);
      q.putVersion.run(lastInsertRowid, date, c.owner, c.days.join(','), 0);
      return Number(lastInsertRowid);
    });
    return shown(find(id, date), date);
  }

  // Writes today's version (replacing any other change made today).
  function putToday(chore, date, change) {
    const v = Object.assign({}, versionAt(chore, date), change);
    q.putVersion.run(chore.id, date, v.owner, v.days.join(','), v.deleted ? 1 : 0);
  }

  async function update(id, input) {
    const date = await today();
    const chore = find(id, date);
    const c = check(input, false);
    transaction(() => {
      if (c.title !== undefined || c.emoji !== undefined || c.routine !== undefined) {
        q.updateChore.run(c.title ?? chore.title, c.emoji ?? chore.emoji, c.routine ?? chore.routine, chore.id);
      }
      const v = versionAt(chore, date);
      const owner = c.owner ?? v.owner;
      const days = c.days ?? v.days;
      if (owner !== v.owner || days.join(',') !== v.days.join(',')) putToday(chore, date, { owner, days });
    });
    return shown(find(chore.id, date), date);
  }

  async function remove(id) {
    const date = await today();
    transaction(() => putToday(find(id, date), date, { deleted: true }));
  }

  // Ticks (or unticks) a chore for today. Only a chore scheduled today can be ticked.
  async function setDone(id, done) {
    const date = await today();
    const chore = find(id, date);
    if (!done) return void q.clearDone.run(chore.id, date);
    if (!scheduledOn(chore, date)) throw new HttpError(409, 'That chore is not scheduled today');
    q.setDone.run(chore.id, date);
  }

  return { load, create, update, remove, setDone };
}
