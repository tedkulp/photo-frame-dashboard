// Read-only calendars from secret ICS links (ADR 0005). Each feed is fetched (with a timeout),
// parsed with ical.js and kept about 10 minutes; while a feed fails, its last good copy is used
// (nothing before the first success) and the failure is logged. Events are expanded into the
// window asked for (RRULE, EXDATE, edited occurrences) and returned as Google-style items
// ({ id, iCalUID, summary, start: { date | dateTime }, end, location, description }) so calendar.js
// treats them like Google's. Times come from the file's own VTIMEZONE definitions; a TZID the file
// doesn't define (and floating times) are read in the frame's zone, with one warning per feed.
import ICAL from 'ical.js';

export const CACHE_MS = 10 * 60 * 1000;
export const TIMEOUT_MS = 10 * 1000;
export const RETRY_MS = 2 * 60 * 1000; // after a failed fetch, so a dead link doesn't slow every load
const MAX_STEPS = 100000; // occurrences walked per recurring event, so a runaway RRULE can't hang a load
const DAY_MS = 24 * 60 * 60 * 1000;

// ------------------------------------------------------------ wall clock in a time zone
const formats = new Map();
function wall(ms, zone) {
  let f = formats.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    formats.set(zone, f);
  }
  const p = {};
  for (const { type, value } of f.formatToParts(new Date(ms))) p[type] = +value;
  return p;
}

// Minutes east of UTC in `zone` at instant `ms`.
function offsetAt(ms, zone) {
  const p = wall(ms, zone);
  return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000) / 60000);
}

// The instant a wall-clock time in `zone` names (the earlier one in a DST overlap).
function fromWall(y, mo, d, h, mi, s, zone) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const first = guess - offsetAt(guess, zone) * 60000;
  return guess - offsetAt(first, zone) * 60000;
}

const pad = (n, w) => String(Math.abs(n)).padStart(w || 2, '0');

// "2026-10-20T15:30:00-04:00", as Google writes times when asked for a time zone.
function isoIn(ms, zone) {
  const p = wall(ms, zone), off = offsetAt(ms, zone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}` +
    (off < 0 ? '-' : '+') + pad(Math.floor(Math.abs(off) / 60)) + ':' + pad(Math.abs(off) % 60);
}

const dateOf = (t) => `${pad(t.year, 4)}-${pad(t.month)}-${pad(t.day)}`;

// An ical.js time as an instant. Floating times, and times whose TZID the file doesn't define
// (ical.js leaves both in its "local" zone), are wall-clock times in the frame's zone.
function instant(t, zone) {
  if (t.zone === ICAL.Timezone.localTimezone || !t.zone) return fromWall(t.year, t.month, t.day, t.hour, t.minute, t.second, zone);
  return t.toUnixTime() * 1000;
}

// ------------------------------------------------------------ parsing and expansion
// .ics text → the VCALENDAR component; throws on anything that isn't one.
export function parseIcs(text) {
  const comp = new ICAL.Component(ICAL.parse(String(text)));
  if (comp.name !== 'vcalendar') throw new Error('not an iCalendar file');
  return comp;
}

const TIME_PROPS = ['dtstart', 'dtend', 'exdate', 'rdate', 'recurrence-id'];

// TZIDs the events use that the file doesn't define.
export function unknownZones(vcal) {
  const out = new Set();
  for (const ev of vcal.getAllSubcomponents('vevent')) {
    for (const name of TIME_PROPS) {
      for (const prop of ev.getAllProperties(name)) {
        const tzid = prop.getParameter('tzid');
        if (tzid && !vcal.getTimeZoneByID(tzid) && !ICAL.TimezoneService.has(tzid)) out.add(tzid);
      }
    }
  }
  return [...out];
}

// One occurrence → a Google-style item, or null if it is outside [minMs, maxMs) or cancelled.
function toItem(ev, start, end, key, zone, minMs, maxMs) {
  if (String(ev.component.getFirstPropertyValue('status') || '').toUpperCase() === 'CANCELLED') return null;
  let item;
  if (start.isDate) {
    // All-day: plain dates, the end exclusive (at least the next day), compared at local midnight.
    const startDate = dateOf(start);
    let endDate = end && end.isDate ? dateOf(end) : '';
    if (endDate <= startDate) endDate = new Date(Date.UTC(start.year, start.month - 1, start.day) + DAY_MS).toISOString().slice(0, 10);
    const midnight = (date) => { const [y, m, d] = date.split('-').map(Number); return fromWall(y, m, d, 0, 0, 0, zone); };
    if (midnight(endDate) <= minMs || midnight(startDate) >= maxMs) return null;
    item = { start: { date: startDate }, end: { date: endDate } };
  } else {
    const s = instant(start, zone);
    const e = Math.max(s, end && !end.isDate ? instant(end, zone) : s);
    if (Math.max(e, s + 1) <= minMs || s >= maxMs) return null;
    item = { start: { dateTime: isoIn(s, zone) }, end: { dateTime: isoIn(e, zone) } };
  }
  const uid = ev.uid || '';
  return Object.assign({ id: (uid || 'no-uid') + '|' + key, status: 'confirmed', summary: ev.summary || '' }, uid ? { iCalUID: uid } : {}, item,
    ev.location ? { location: ev.location } : {}, ev.description ? { description: ev.description } : {});
}

// Every occurrence of the calendar's events that overlaps [timeMin, timeMax) (ISO strings), as
// Google-style items with times in `zone`.
export function expandIcs(vcal, { timeMin, timeMax, zone }) {
  const minMs = Date.parse(timeMin), maxMs = Date.parse(timeMax);
  const masters = new Map(), exceptions = [];
  for (const comp of vcal.getAllSubcomponents('vevent')) {
    if (!comp.getFirstPropertyValue('dtstart')) continue;
    if (comp.hasProperty('recurrence-id')) exceptions.push(comp);
    else {
      // A second series with the same UID (invalid, but seen) still shows, without the edits.
      const uid = comp.getFirstPropertyValue('uid');
      masters.set(uid && !masters.has(uid) ? uid : Symbol(uid || 'no-uid'), comp);
    }
  }
  const byUid = new Map();
  for (const comp of exceptions) {
    const uid = comp.getFirstPropertyValue('uid');
    if (!masters.has(uid)) continue;
    if (!byUid.has(uid)) byUid.set(uid, []);
    byUid.get(uid).push(comp);
  }

  const items = [];
  const push = (item) => { if (item) items.push(item); };
  for (const [uid, comp] of masters) {
    const own = byUid.get(uid) || [];
    const ev = new ICAL.Event(comp, { exceptions: own, strictExceptions: true });
    if (!ev.isRecurring()) {
      push(toItem(ev, ev.startDate, ev.endDate, ev.startDate.toString(), zone, minMs, maxMs));
      continue;
    }
    // Edited occurrences are placed by their own times wherever they moved; the walk below
    // skips their original slots.
    const edited = new Set();
    for (const ex of Object.values(ev.exceptions)) {
      edited.add(ex.recurrenceId.toString());
      edited.add(ex.recurrenceId.convertToZone(ICAL.Timezone.utcTimezone).toString());
      push(toItem(ex, ex.startDate, ex.endDate, ex.recurrenceId.toString(), zone, minMs, maxMs));
    }
    const it = ev.iterator();
    for (let next, steps = 0; (next = it.next()) && steps < MAX_STEPS; steps++) {
      if (instant(next, zone) >= maxMs) break;
      if (edited.has(next.toString()) || edited.has(next.convertToZone(ICAL.Timezone.utcTimezone).toString())) continue;
      const d = ev.getOccurrenceDetails(next);
      push(toItem(d.item, d.startDate, d.endDate, next.toString(), zone, minMs, maxMs));
    }
  }
  // An edited occurrence whose series isn't in the file stands on its own.
  for (const comp of exceptions) {
    if (masters.has(comp.getFirstPropertyValue('uid'))) continue;
    const ev = new ICAL.Event(comp);
    push(toItem(ev, ev.startDate, ev.endDate, ev.recurrenceId.toString(), zone, minMs, maxMs));
  }
  return items;
}

// ------------------------------------------------------------ fetching and caching
// feeds: [{ ics: name, url }]. items(name, { timeMin, timeMax, zone }) → Google-style items.
export function createIcsFeeds({ feeds, now = Date.now, timeoutMs = TIMEOUT_MS, cacheMs = CACHE_MS, retryMs = RETRY_MS, log = console }) {
  const urls = new Map(feeds.map((f) => [f.ics, f.url]));
  const cache = new Map(); // name → { vcal (last good, or null), at (when fetched), failedAt? }
  const pending = new Map(); // name → Promise
  const warned = new Set();

  async function fetchFeed(name) {
    let res;
    try {
      res = await fetch(urls.get(name), { headers: { accept: 'text/calendar' }, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      throw new Error(e.name === 'TimeoutError' ? `no answer in ${Math.round(timeoutMs / 1000)} s` : e.message);
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new Error(`HTTP ${res.status}`);
    }
    const vcal = parseIcs(await res.text());
    const unknown = unknownZones(vcal);
    if (unknown.length && !warned.has(name)) {
      warned.add(name);
      log.warn(`Read-only calendar "${name}" uses time zones it doesn't define (${unknown.join(', ')}); reading those times in the frame's time zone`);
    }
    return vcal;
  }

  // The feed's calendar: the cached copy while it is fresh, else a new fetch, else the last good
  // copy (null before the first success). A failed fetch is retried after retryMs, not on every load.
  async function calendarOf(name) {
    const c = cache.get(name);
    if (c && (now() - c.at < cacheMs || now() - c.failedAt < retryMs)) return c.vcal;
    if (!pending.has(name)) {
      pending.set(name, fetchFeed(name).then(
        (vcal) => { cache.set(name, { vcal, at: now() }); return vcal; },
        (e) => {
          const last = c ? c.vcal : null;
          log.error(`Read-only calendar "${name}" could not be read (${e.message}); ${last ? 'showing its last good copy' : 'it shows no events until it can be'}`);
          cache.set(name, { vcal: last, at: c ? c.at : -Infinity, failedAt: now() });
          return last;
        },
      ).finally(() => pending.delete(name)));
    }
    return pending.get(name);
  }

  async function items(name, range) {
    const vcal = await calendarOf(name);
    return vcal ? expandIcs(vcal, range) : [];
  }

  return { items };
}
