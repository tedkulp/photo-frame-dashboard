// Builds the dashboard's { people, events, updatedAt } from the configured Google calendars.
// Family-calendar events belong to everyone; per-person calendars to that person. The same event
// (iCalUID + start) seen in several calendars is returned once with the people combined.

const DAY_MS = 24 * 60 * 60 * 1000;
export const DAYS_BACK = 7;
export const DAYS_AHEAD = 42;

// Opaque to the dashboard; the server maps it back to the calendar and Google event id.
export function encodeEventId(calendarId, eventId) {
  return Buffer.from(JSON.stringify([calendarId, eventId])).toString('base64url');
}

export function decodeEventId(id) {
  try {
    const [calendarId, eventId] = JSON.parse(Buffer.from(String(id), 'base64url').toString());
    if (typeof calendarId === 'string' && typeof eventId === 'string') return { calendarId, eventId };
  } catch {}
  return null;
}

// All-day events keep their plain dates; timed events compare by instant so the same event
// written with different offsets still matches.
function startKey(start) {
  return start.date ? start.date : String(Date.parse(start.dateTime));
}

function sortKey(e) {
  return e.allDay ? Date.parse(e.start + 'T00:00:00Z') : Date.parse(e.start);
}

function toEvent(item, calendarId) {
  const allDay = Boolean(item.start.date);
  const e = {
    id: encodeEventId(calendarId, item.id),
    title: item.summary || '(No title)',
    start: allDay ? item.start.date : item.start.dateTime,
    end: allDay ? item.end.date : item.end.dateTime,
    people: [],
  };
  if (allDay) e.allDay = true;
  if (item.location) e.loc = item.location;
  if (item.description) e.notes = item.description;
  return e;
}

export function createCalendar({ settings, google, timeZone = null, now = Date.now }) {
  const allIds = settings.people.map((p) => p.id);
  const family = settings.calendars.find((c) => c.person === 'family');
  const others = settings.calendars.filter((c) => c !== family);

  async function load() {
    const t = now();
    const range = {
      timeMin: new Date(t - DAYS_BACK * DAY_MS).toISOString(),
      timeMax: new Date(t + DAYS_AHEAD * DAY_MS).toISOString(),
    };
    // Without TZ, the family calendar's own time zone (returned with its events) is used for the rest.
    const familyResult = await google.listEvents(family.calendarId, Object.assign({ timeZone }, range));
    const zone = timeZone || familyResult.timeZone;
    const otherResults = await Promise.all(others.map((c) => google.listEvents(c.calendarId, Object.assign({ timeZone: zone }, range))));

    const byKey = new Map();
    const add = (cal, items) => {
      const people = cal.person === 'family' ? allIds : [cal.person];
      for (const item of items) {
        if (item.status === 'cancelled' || !item.start || !item.end) continue;
        const key = item.iCalUID ? item.iCalUID + '|' + startKey(item.start) : cal.calendarId + '|' + item.id;
        let e = byKey.get(key);
        if (!e) byKey.set(key, (e = toEvent(item, cal.calendarId)));
        for (const p of people) if (!e.people.includes(p)) e.people.push(p);
      }
    };
    add(family, familyResult.items);
    others.forEach((c, i) => add(c, otherResults[i].items));

    const events = [...byKey.values()];
    for (const e of events) e.people.sort((a, b) => allIds.indexOf(a) - allIds.indexOf(b));
    events.sort((a, b) => sortKey(a) - sortKey(b) || (b.allDay ? 1 : 0) - (a.allDay ? 1 : 0));

    return { people: settings.people, events, updatedAt: new Date(t).toISOString() };
  }

  return { load };
}
