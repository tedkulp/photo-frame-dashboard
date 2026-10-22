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
