// Builds the dashboard's { people, events, updatedAt } from the configured calendars: Google ones
// ({ calendarId, person }) and read-only ones from ICS links ({ ics, url, person }, see ics.js and
// ADR 0005). Family-calendar events belong to everyone; per-person calendars to that person. The
// same event (iCalUID + start) seen in several calendars is returned once with the people combined.
// Each event says whether it can be deleted: only through a Google copy, so an event that is only
// on read-only calendars can't. Holiday calendars ({ person: "none" }, Google or ICS) give only
// their all-day events, to no one (people: []) and not deletable; merged with a copy on someone's
// calendar, the event is that copy's. create/remove write single events: to that person's own
// Google calendar when exactly one person with one is picked, otherwise to the Family calendar.
import { isReadOnly, isHoliday } from './config.js';
import { createIcsFeeds } from './ics.js';
import { HttpError } from './errors.js';

const DAY_MS = 24 * 60 * 60 * 1000;
export const DAYS_BACK = 7;
export const DAYS_AHEAD = 42;
export const TITLE_MAX = 200;

// Opaque to the dashboard; the server maps it back to the calendar and Google event id. A read-only
// event's id names its feed instead: ['ics', name, occurrence key].
export function encodeEventId(calendarId, eventId) {
  return Buffer.from(JSON.stringify([calendarId, eventId])).toString('base64url');
}

export function encodeReadOnlyId(name, key) {
  return Buffer.from(JSON.stringify(['ics', name, key])).toString('base64url');
}

// → { calendarId, eventId } (Google), { ics, eventId } (read-only), or null.
export function decodeEventId(id) {
  try {
    const v = JSON.parse(Buffer.from(String(id), 'base64url').toString());
    if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && typeof v[1] === 'string') return { calendarId: v[0], eventId: v[1] };
    if (Array.isArray(v) && v.length === 3 && v[0] === 'ics' && typeof v[1] === 'string' && typeof v[2] === 'string') return { ics: v[1], eventId: v[2] };
  } catch {}
  return null;
}

// All-day events keep their plain dates; timed events compare by instant so the same event
// written with different offsets still matches.
function startKey(start) {
  return start.date ? start.date : String(Date.parse(start.dateTime));
}

// Every calendar is fetched in one time zone, so sort by wall-clock time: an all-day event starts
// at local midnight, a timed one at the local time written before its offset.
function sortKey(e) {
  return Date.parse((e.allDay ? e.start + 'T00:00:00' : e.start.slice(0, 19)) + 'Z');
}

// The entities a description is likely to hold, plus numeric ones; an unknown name or out-of-range
// code point stays as written.
const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—', hellip: '…',
};

function decodeEntity(match, name) {
  if (name[0] !== '#') return ENTITIES[name.toLowerCase()] || match;
  const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
}

// An event's description → plain text for the event sheet. Google descriptions are HTML (<br>,
// <p>, lists, links, entities): line breaks and block ends become new lines, list items bullets,
// other tags are dropped (link text kept). ICS ones are plain text and keep their line breaks.
// Only things that look like tags (<name>, <name attrs>) are dropped, so "3 < 4", <https://…>
// and <bob@example.com> survive; entities are decoded in one pass after that, so "&lt;b&gt;"
// stays the literal text "<b>".
export function plainNotes(description) {
  return String(description || '')
    .replace(/\r\n?/g, '\n')
    .replace(/<(style|script)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<br\s*\/?>|<\/(p|div|li)\s*>/gi, '\n')
    .replace(/([^\n])<(p|div|ul|ol)\b[^>]*>/gi, '$1\n')
    .replace(/<li\b[^>]*>/gi, '• ')
    .replace(/<\/?[a-z][a-z0-9]*(\s[^>]*)?\/?>|<!--[\s\S]*?-->/gi, '')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, decodeEntity)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const calKey = (cal) => (isReadOnly(cal) ? 'ics:' + cal.ics : cal.calendarId);

// A timed item from local midnight to a later local midnight (how Outlook → Google conversion
// writes all-day events) → its start and end dates, end exclusive; anything else → null. Every
// calendar is fetched in the frame's zone, so the wall-clock time is the one written before the
// offset, whatever the offset (a span across a DST change still starts and ends at 00:00).
const MIDNIGHT = /^(\d{4}-\d{2}-\d{2})T00:00(:00(\.0+)?)?(Z|[+-]\d{2}:\d{2})$/;

function midnightDates(item) {
  const s = MIDNIGHT.exec(item.start.dateTime || '');
  const e = MIDNIGHT.exec(item.end.dateTime || '');
  return s && e && s[1] < e[1] ? { start: s[1], end: e[1] } : null;
}

function toEvent(item, cal) {
  const dates = item.start.date ? { start: item.start.date, end: item.end.date } : midnightDates(item);
  const allDay = Boolean(dates);
  const e = {
    id: isReadOnly(cal) ? encodeReadOnlyId(cal.ics, item.id) : encodeEventId(cal.calendarId, item.id),
    title: item.summary || '(No title)',
    start: allDay ? dates.start : item.start.dateTime,
    end: allDay ? dates.end : item.end.dateTime,
    people: [],
  };
  if (allDay) e.allDay = true;
  if (item.location) e.loc = item.location;
  const notes = plainNotes(item.description);
  if (notes) e.notes = notes;
  e.deletable = !isReadOnly(cal) && !isHoliday(cal);
  return e;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

function isDate(s) {
  const m = typeof s === 'string' && DATE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}
const isDateTime = (s) => typeof s === 'string' && DATE_TIME.test(s) && !isNaN(Date.parse(s));

// { title, start, end, people, allDay? } → the checked fields, or an HttpError.
function checkInput(input, allIds) {
  const bad = (msg) => new HttpError(400, msg);
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw bad('Expected a JSON object');
  if (typeof input.title !== 'string' || !input.title.trim()) throw bad('title is missing');
  const title = input.title.trim();
  if (title.length > TITLE_MAX) throw bad(`title is longer than ${TITLE_MAX} characters`);
  const allDay = input.allDay === true;
  const { start, end } = input;
  if (allDay) {
    if (!isDate(start) || !isDate(end)) throw bad('An all-day event needs start and end dates like 2026-10-19');
    if (start >= end) throw bad('start must be before end');
  } else {
    if (!isDateTime(start) || !isDateTime(end)) throw bad('start and end must be times with an offset, like 2026-10-19T15:30:00-04:00');
    if (Date.parse(start) >= Date.parse(end)) throw bad('start must be before end');
  }
  if (!Array.isArray(input.people)) throw bad('people must be a list of person ids');
  for (const id of input.people) {
    if (!allIds.includes(id)) throw bad(`Unknown person id ${JSON.stringify(id)}`);
  }
  return { title, start, end, allDay, people: [...new Set(input.people)] };
}

// Read-only calendars are fetched through createIcsFeeds() (icsTimeoutMs/log passed on).
export function createCalendar({ settings, google, timeZone = null, now = Date.now, icsTimeoutMs, log = console }) {
  const allIds = settings.people.map((p) => p.id);
  const family = settings.calendars.find((c) => c.person === 'family');
  const assigned = settings.calendars.filter((c) => !isHoliday(c));
  const others = assigned.filter((c) => c !== family && !isReadOnly(c)); // per-person Google calendars
  const readOnly = assigned.filter(isReadOnly);
  const holidays = settings.calendars.filter(isHoliday);
  const allIcs = settings.calendars.filter(isReadOnly); // readOnly plus the holiday ICS links
  const icsFeeds = allIcs.length ? createIcsFeeds({ feeds: allIcs, now, timeoutMs: icsTimeoutMs, log }) : null;
  const peopleOf = (cal) => (cal.person === 'family' ? allIds : isHoliday(cal) ? [] : [cal.person]);
  const listCal = (cal, opts) => (isReadOnly(cal) ? icsFeeds.items(cal.ics, opts) : google.listEvents(cal.calendarId, opts).then((r) => r.items));
  let familyZone = null;

  async function load() {
    const t = now();
    const range = {
      timeMin: new Date(t - DAYS_BACK * DAY_MS).toISOString(),
      timeMax: new Date(t + DAYS_AHEAD * DAY_MS).toISOString(),
    };
    // Without TZ, the family calendar's own time zone (returned with its events) is used for the rest.
    const familyResult = await google.listEvents(family.calendarId, Object.assign({ timeZone }, range));
    if (familyResult.timeZone) familyZone = familyResult.timeZone;
    const zone = timeZone || familyResult.timeZone;
    // A read-only feed never fails the load: ics.js serves its last good copy, or nothing.
    const [otherResults, readOnlyItems, holidayItems] = await Promise.all([
      Promise.all(others.map((c) => google.listEvents(c.calendarId, Object.assign({ timeZone: zone }, range)))),
      Promise.all(readOnly.map((c) => icsFeeds.items(c.ics, Object.assign({ zone }, range)))),
      Promise.all(holidays.map((c) => listCal(c, Object.assign({ timeZone: zone, zone }, range)))),
    ]);

    const byKey = new Map();
    const add = (cal, items) => {
      const people = peopleOf(cal);
      for (const item of items) {
        if (item.status === 'cancelled' || !item.start || !item.end) continue;
        const key = item.iCalUID ? item.iCalUID + '|' + startKey(item.start) : calKey(cal) + '|' + item.id;
        let e = byKey.get(key);
        if (!e) byKey.set(key, (e = toEvent(item, cal)));
        for (const p of people) if (!e.people.includes(p)) e.people.push(p);
      }
    };
    add(family, familyResult.items);
    others.forEach((c, i) => add(c, otherResults[i].items));
    // After every Google calendar, so a merged event keeps its Google copy's id and can be deleted.
    readOnly.forEach((c, i) => add(c, readOnlyItems[i]));
    // Last, so a holiday also on someone's calendar is theirs (id, people, deletable). Timed ones are dropped.
    holidays.forEach((c, i) => add(c, holidayItems[i].filter((item) => item.start && item.end && (item.start.date || midnightDates(item)))));

    const events = [...byKey.values()];
    for (const e of events) e.people.sort((a, b) => allIds.indexOf(a) - allIds.indexOf(b));
    events.sort((a, b) => sortKey(a) - sortKey(b) || (b.allDay ? 1 : 0) - (a.allDay ? 1 : 0));

    return { people: settings.people.map(({ id, name, colour }) => ({ id, name, colour })), events, updatedAt: new Date(t).toISOString() };
  }

  // Writes one event and returns it as load() would show it.
  async function create(input) {
    const e = checkInput(input, allIds);
    const own = e.people.length === 1 && others.find((c) => c.person === e.people[0]);
    const cal = own || family;
    const when = (v) => (e.allDay ? { date: v } : { dateTime: v });
    const item = await google.insertEvent(cal.calendarId, { summary: e.title, start: when(e.start), end: when(e.end) });
    return Object.assign(toEvent(item, cal), { people: peopleOf(cal).slice() });
  }

  // Deletes an event by the id load()/create() gave it. Only configured Google calendars are
  // touched; an event only on read-only calendars is refused.
  async function remove(id) {
    const ref = decodeEventId(id);
    if (ref && ref.ics !== undefined && allIcs.some((c) => c.ics === ref.ics)) {
      throw new HttpError(403, 'This event is on a read-only calendar and can’t be deleted here');
    }
    if (ref && ref.calendarId !== undefined && !assigned.some((c) => c.calendarId === ref.calendarId) && holidays.some((c) => c.calendarId === ref.calendarId)) {
      throw new HttpError(403, 'This event is on a holiday calendar and can’t be deleted here');
    }
    if (!ref || ref.calendarId === undefined || !assigned.some((c) => c.calendarId === ref.calendarId)) throw new HttpError(404, 'No such event');
    await google.deleteEvent(ref.calendarId, ref.eventId);
  }

  // The time zone the dashboard lives in: TZ, else the Family calendar's own (asked once).
  async function zone() {
    if (timeZone) return timeZone;
    if (!familyZone) {
      const t = now();
      const r = await google.listEvents(family.calendarId, { timeMin: new Date(t).toISOString(), timeMax: new Date(t + 60000).toISOString() });
      if (!r.timeZone) throw new Error('Google did not say which time zone the Family calendar is in; set TZ');
      familyZone = r.timeZone;
    }
    return familyZone;
  }

  return { load, create, remove, zone };
}
