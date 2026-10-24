import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../js/calevents.js';

const CalEvents = globalThis.CalEvents;

const PEOPLE = [
  { id: 'alex', name: 'Alex', color: '#2D5BFF' },
  { id: 'sam', name: 'Sam', color: '#E4007C' },
];
const FAMILY = { id: 'family', name: 'Family', color: '#111111' };

// 2026-10-21 is a Wednesday. All-day events run local midnight to midnight, end exclusive.
const day = (d, h) => new Date(2026, 9, d, h || 0);
const holiday = { id: 'h', title: 'Halloween', allDay: true, start: day(21), end: day(22), people: [] };
const swim = { id: 's', title: 'Swim', allDay: true, start: day(21), end: day(22), people: ['alex'] };
const dinner = { id: 'd', title: 'Dinner', start: day(21, 18), end: day(21, 20), people: ['alex', 'sam'] };
const parade = { id: 'p', title: 'Parade', start: day(21, 9), end: day(21, 10), people: [] };
const EVENTS = [holiday, swim, dinner, parade];

test('an event with no people is in the all-day strip', () => {
  assert.deepEqual(CalEvents.allDayOn(EVENTS, day(21, 15)).map((e) => e.id), ['h', 's']);
  assert.deepEqual(CalEvents.allDayOn(EVENTS, day(22)).map((e) => e.id), []);
});

test('a per-person filter leaves out events with no people', () => {
  assert.deepEqual(CalEvents.allDayOn(EVENTS, day(21), 'alex').map((e) => e.id), ['s']);
  assert.deepEqual(CalEvents.allDayOn(EVENTS, day(21), 'sam').map((e) => e.id), []);
  assert.deepEqual(CalEvents.timedOn(EVENTS, day(21), 'sam').map((e) => e.id), ['d']);
  assert.deepEqual(CalEvents.timedOn(EVENTS, day(21)).map((e) => e.id), ['p', 'd']);
});

test('the colour of an event with no people is the neutral one, not a person’s or Family’s', () => {
  assert.equal(CalEvents.color(holiday, PEOPLE, FAMILY), CalEvents.NONE);
  assert.equal(CalEvents.color(swim, PEOPLE, FAMILY), PEOPLE[0]);
  assert.equal(CalEvents.color(dinner, PEOPLE, FAMILY), FAMILY);
  assert.equal(CalEvents.color({ people: ['gone'] }, PEOPLE, FAMILY), FAMILY);
  assert.match(CalEvents.NONE.color, /^var\(--none\)$/);
});

test('an event with no people is not a family event, even with one person', () => {
  assert.equal(CalEvents.isFamily(holiday, PEOPLE), false);
  assert.equal(CalEvents.isFamily(holiday, PEOPLE.slice(0, 1)), false);
  assert.equal(CalEvents.isFamily(dinner, PEOPLE), true);
});

test('"First up" and "Next up" skip events with no people', () => {
  assert.equal(CalEvents.noOne(parade), true);
  assert.equal(CalEvents.noOne(dinner), false);
  assert.deepEqual(CalEvents.someones([parade, dinner]).map((e) => e.id), ['d']);
  assert.deepEqual(CalEvents.someones([parade]), []);
});

// ------------------------------------------------------------ the day grid's maths
const t = (id, h1, h2, more) => Object.assign({ id, title: id, start: day(21, h1), end: day(21, h2), people: ['alex'] }, more);
const ids = (out) => out.map((it) => (it.more ? '+' + it.more.map((e) => e.id).join(',') : it.e.id + '@' + it.col + '/' + it.cols));

test('two overlapping events share the width, one column each', () => {
  assert.deepEqual(ids(CalEvents.layout([t('a', 9, 11), t('b', 10, 12)])), ['a@0/2', 'b@1/2']);
});

test('a third overlapping event goes to the "+N more" overflow with the others past the first column', () => {
  const out = CalEvents.layout([t('a', 9, 12), t('b', 10, 11), t('c', 10, 13)]);
  assert.deepEqual(ids(out), ['a@0/2', '+b,c']);
  const more = out[1];
  assert.equal(more.col, 1);
  assert.equal(more.cols, 2);
  assert.equal(+more.start, +day(21, 10));
  assert.equal(+more.end, +day(21, 13));
});

test('events that don’t overlap are each back in one full-width column', () => {
  assert.deepEqual(ids(CalEvents.layout([t('a', 9, 10), t('b', 10, 11), t('c', 12, 13)])), ['a@0/1', 'b@0/1', 'c@0/1']);
  // After an overlapping pair, a later event starts a new cluster.
  assert.deepEqual(ids(CalEvents.layout([t('a', 9, 11), t('b', 10, 12), t('c', 12, 13)])), ['a@0/2', 'b@1/2', 'c@0/1']);
});

test('a timed event is clamped to the day’s visible hours (6 AM to 11 PM)', () => {
  assert.equal(CalEvents.START, 6);
  assert.equal(CalEvents.END, 23);
  const inside = CalEvents.clamp(t('a', 9, 10), day(21, 15));
  assert.deepEqual([+inside.start, +inside.end], [+day(21, 9), +day(21, 10)]);
  // Started yesterday evening, ends tomorrow morning: today's 6 AM to 11 PM.
  const long = { id: 'l', start: day(20, 20), end: day(22, 8), people: ['alex'] };
  const c = CalEvents.clamp(long, day(21, 12));
  assert.deepEqual([+c.start, +c.end], [+day(21, 6), +day(21, 23)]);
  // Before 6 AM on the day, or past 11 PM.
  const early = CalEvents.clamp(t('e', 4, 7), day(21));
  assert.deepEqual([+early.start, +early.end], [+day(21, 6), +day(21, 7)]);
  const late = CalEvents.clamp({ id: 'n', start: day(21, 22), end: day(22, 1), people: [] }, day(21));
  assert.deepEqual([+late.start, +late.end], [+day(21, 22), +day(21, 23)]);
});

// Pins down today's behaviour for events the grid can't show (not a spec of what it should do):
// clamp moves only the edge outside the hours, so the result ends before it starts (the view then
// draws its minimum-height block at the top or bottom edge), and layout works on the real times.
test('an event wholly before 6 AM or wholly after 11 PM: clamp gives an inverted span, layout ignores the hours', () => {
  const early = t('e', 4, 5);
  const ce = CalEvents.clamp(early, day(21));
  assert.deepEqual([+ce.start, +ce.end], [+day(21, 6), +day(21, 5)]);
  const late = { id: 'n', title: 'n', start: new Date(2026, 9, 21, 23, 15), end: new Date(2026, 9, 21, 23, 45), people: ['alex'] };
  const cl = CalEvents.clamp(late, day(21));
  assert.deepEqual([+cl.start, +cl.end], [+late.start, +day(21, 23)]);
  // Drawn on top of a 6–7 AM event and a 10–11 PM one, but they don't overlap, so one column each.
  assert.deepEqual(ids(CalEvents.layout([early, t('a', 6, 7), t('b', 22, 23), late])), ['e@0/1', 'a@0/1', 'b@0/1', 'n@0/1']);
});

test('"Day N of M" across a multi-day all-day event', () => {
  const trip = { id: 'trip', allDay: true, start: day(21), end: day(24), people: ['alex'] };
  assert.deepEqual(CalEvents.spanDay(trip, day(21, 15)), { n: 1, of: 3 });
  assert.deepEqual(CalEvents.spanDay(trip, day(22)), { n: 2, of: 3 });
  assert.deepEqual(CalEvents.spanDay(trip, day(23, 9)), { n: 3, of: 3 });
  assert.deepEqual(CalEvents.spanDay(swim, day(21)), { n: 1, of: 1 });
});

test('all-day events overlapping a date range, end exclusive, timed events left out', () => {
  const trip = { id: 'trip', allDay: true, start: day(19), end: day(22), people: ['alex'] };
  const later = { id: 'later', allDay: true, start: day(24), end: day(25), people: ['sam'] };
  const list = [trip, holiday, dinner, later];
  assert.deepEqual(CalEvents.allDayIn(list, day(21), day(24)).map((e) => e.id), ['trip', 'h']);
  assert.deepEqual(CalEvents.allDayIn(list, day(22), day(25)).map((e) => e.id), ['later']);
  assert.deepEqual(CalEvents.allDayIn(list, day(15), day(19)).map((e) => e.id), []);
});

test('whole days between local midnights, a DST day counting as one', () => {
  assert.equal(CalEvents.days(day(21), day(24)), 3);
  assert.equal(CalEvents.days(day(24), day(21)), -3);
  assert.equal(CalEvents.days(new Date(2026, 10, 1), new Date(2026, 10, 2)), 1);
});

test('the columns an all-day event covers in a 3-day strip, cut to the strip', () => {
  const s0 = day(21);
  const cols = (start, end) => CalEvents.columns({ allDay: true, start, end }, s0, 3);
  assert.deepEqual(cols(day(21), day(22)), { a: 0, b: 1 });
  assert.deepEqual(cols(day(22), day(24)), { a: 1, b: 3 });
  assert.deepEqual(cols(day(19), day(23)), { a: 0, b: 2 }, 'started before the strip');
  assert.deepEqual(cols(day(23), day(27)), { a: 2, b: 3 }, 'runs past the strip');
  assert.deepEqual(cols(day(18), day(30)), { a: 0, b: 3 });
});

test('leave-by is the start less the travel time, or the start without any', () => {
  assert.equal(+CalEvents.leaveBy(t('a', 9, 10, { travel: 20 })), +new Date(2026, 9, 21, 8, 40));
  assert.equal(+CalEvents.leaveBy(t('a', 9, 10)), +day(21, 9));
});

test('the next event skips started ones, ranks by leave-by and skips events with no people', () => {
  const now = day(21, 12);
  const started = t('started', 11, 13);
  const soon = t('soon', 15, 16); // leave at 15:00
  const drive = t('drive', 16, 17, { travel: 90 }); // starts later, but leave at 14:30
  const noOne = { id: 'parade2', start: day(21, 13), end: day(21, 14), people: [] };
  const tomorrow = { id: 'tmrw', start: day(22, 9), end: day(22, 10), people: ['sam'] };
  assert.equal(CalEvents.next([started, soon, drive, noOne, tomorrow, holiday], now).id, 'drive');
  assert.equal(CalEvents.next([started, soon, noOne], now).id, 'soon');
  assert.equal(CalEvents.next([started, noOne, tomorrow], now), null);
});

test('find looks an event up by id', () => {
  assert.equal(CalEvents.find(EVENTS, 'd'), dinner);
  assert.equal(CalEvents.find(EVENTS, 'nope'), undefined);
});

test('dayStart is local midnight of the date, leaving the date alone', () => {
  const d = day(21, 15);
  assert.equal(+CalEvents.dayStart(d), +day(21));
  assert.equal(+d, +day(21, 15));
});
