import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../js/calnav.js';

const CalNav = globalThis.CalNav;

// 2026-10-22 is a Thursday; the frame's clock reads mid-afternoon.
const now = new Date(2026, 9, 22, 15, 40);
const first = (y, m) => new Date(y, m, 1);
const same = (a, b) => assert.equal(a.getTime(), b.getTime());

test('leaving Month on the current month starts on today', () => {
  for (const to of ['day', '3day', 'week']) same(CalNav.modeDate('month', to, first(2026, 9), now), new Date(2026, 9, 22));
});

test('leaving Month on another month starts on its 1st', () => {
  for (const to of ['day', '3day', 'week']) same(CalNav.modeDate('month', to, first(2026, 11), now), first(2026, 11));
});

test('the same month in another year is not the current month', () => {
  same(CalNav.leaveMonth(first(2027, 9), now), first(2027, 9));
  same(CalNav.leaveMonth(first(2025, 9), now), first(2025, 9));
});

test('entering Month shows the date\'s month from its 1st', () => {
  for (const from of ['day', '3day', 'week']) same(CalNav.modeDate(from, 'month', new Date(2026, 11, 9), now), first(2026, 11));
});

test('switching between Today, 3 Day and Week keeps the date', () => {
  const d = new Date(2026, 10, 3);
  for (const from of ['day', '3day', 'week']) {
    for (const to of ['day', '3day', 'week']) same(CalNav.modeDate(from, to, d, now), d);
  }
});

test('re-choosing Month keeps the month shown', () => {
  same(CalNav.modeDate('month', 'month', first(2026, 11), now), first(2026, 11));
});

test('monthStart is midnight on the 1st, optionally n months on', () => {
  same(CalNav.monthStart(new Date(2026, 9, 22, 15, 40)), first(2026, 9));
  same(CalNav.monthStart(first(2026, 9)), first(2026, 9));
  same(CalNav.monthStart(new Date(2026, 11, 31), 1), first(2027, 0)); // into next year
  same(CalNav.monthStart(new Date(2026, 0, 31), -1), first(2025, 11)); // back a year
  same(CalNav.monthStart(new Date(2026, 0, 31), 1), first(2026, 1)); // no Jan 31 → Mar overflow
});

test('sameMonth needs the same month and year (Month\'s today state)', () => {
  assert.equal(CalNav.sameMonth(first(2026, 9), now), true);
  assert.equal(CalNav.sameMonth(first(2027, 9), now), false);
  assert.equal(CalNav.sameMonth(first(2025, 9), now), false);
  assert.equal(CalNav.sameMonth(first(2026, 10), now), false);
});

// ------------------------------------------------------------ Sun–Sat weeks (#30)
const day = (y, m, d) => new Date(y, m, d);

test('weekStart is the Sunday of the Sun–Sat week containing the date', () => {
  same(CalNav.weekStart(new Date(2026, 9, 22, 15, 40)), day(2026, 9, 18)); // Thursday, mid-afternoon
  same(CalNav.weekStart(day(2026, 9, 18)), day(2026, 9, 18)); // a Sunday is its own start
  same(CalNav.weekStart(new Date(2026, 9, 24, 23, 59)), day(2026, 9, 18)); // Saturday, late
});

test('weekStart crosses a month and a year boundary', () => {
  same(CalNav.weekStart(day(2026, 11, 1)), day(2026, 10, 29)); // Tue Dec 1 → Sun Nov 29
  same(CalNav.weekStart(day(2027, 0, 1)), day(2026, 11, 27)); // Fri Jan 1, 2027 → Sun Dec 27, 2026
});

test('weekStart holds across a DST change', () => {
  same(CalNav.weekStart(day(2026, 10, 7)), day(2026, 10, 1)); // US clocks fall back Sun Nov 1
  same(CalNav.weekStart(day(2026, 2, 14)), day(2026, 2, 8)); // and spring forward Sun Mar 8
});

test('Month\'s grid starts on the Sunday on or before the 1st', () => {
  same(CalNav.weekStart(first(2026, 9)), day(2026, 8, 27)); // October 2026 → Sun Sep 27
  same(CalNav.weekStart(first(2026, 10)), day(2026, 10, 1)); // November 2026 starts on a Sunday
});

test('the week kicker names this, next and last week, else the year', () => {
  assert.equal(CalNav.weekKicker(day(2026, 9, 18), now), 'This week');
  assert.equal(CalNav.weekKicker(day(2026, 9, 25), now), 'Next week');
  assert.equal(CalNav.weekKicker(day(2026, 10, 1), now), '2026');
  assert.equal(CalNav.weekKicker(day(2026, 9, 11), now), 'Last week');
  assert.equal(CalNav.weekKicker(day(2026, 9, 21), now), 'This week'); // any day in the week
  assert.equal(CalNav.weekKicker(day(2027, 9, 21), now), '2027');
});

test('leaving Month for Week lands in the week containing today, or the shown month\'s 1st', () => {
  same(CalNav.weekStart(CalNav.modeDate('month', 'week', first(2026, 9), now)), day(2026, 9, 18));
  same(CalNav.weekStart(CalNav.modeDate('month', 'week', first(2026, 11), now)), day(2026, 10, 29));
});
