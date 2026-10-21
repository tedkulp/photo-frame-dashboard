import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../js/allday.js';

const AllDay = globalThis.AllDay;

// Local midnights, as the feed gives all-day events (end exclusive). 2026-10-21 is a Wednesday.
const day = (d) => new Date(2026, 9, d);
const ev = (from, to) => ({ allDay: true, start: day(from), end: day(to) });

test('until: the last day while the event runs past today', () => {
  const wedToFri = ev(21, 24); // Wed, Thu, Fri (ends Sat 00:00)
  assert.equal(AllDay.until(wedToFri, day(21)).getDay(), 5);
  assert.equal(AllDay.until(wedToFri, new Date(2026, 9, 22, 18, 30)).getDay(), 5); // any time of day
  assert.equal(AllDay.until(wedToFri, day(23)), null); // Friday, its last day
});

test('until: nothing for a one-day event', () => {
  assert.equal(AllDay.until(ev(21, 22), day(21)), null);
  assert.equal(AllDay.until(ev(21, 22), new Date(2026, 9, 21, 23, 59)), null);
});

test('until: across a month end and a DST change', () => {
  const e = ev(30, 35); // Oct 30 – Nov 3 (US DST ends Nov 1)
  const last = AllDay.until(e, day(31));
  assert.deepEqual([last.getMonth(), last.getDate()], [10, 3]);
  assert.equal(AllDay.until(e, new Date(2026, 10, 3)), null);
});

test('fit: everything when it all fits, no "+N more"', () => {
  assert.equal(AllDay.fit([100, 100, 100], 320, 10, 80), 3); // 100+10+100+10+100 = 320
  assert.equal(AllDay.fit([], 320, 10, 80), 0);
});

test('fit: only whole chips, leaving room for "+N more"', () => {
  // 3 chips need 320 > 300; with the more chip: 100+10+100+10+80 = 300 fits two.
  assert.equal(AllDay.fit([100, 100, 100], 300, 10, 80), 2);
  assert.equal(AllDay.fit([100, 100, 100], 299, 10, 80), 1);
  assert.equal(AllDay.fit([100, 200, 50], 280, 10, 80), 1); // stops at the first that doesn't fit
});

test('fit: none when not even one chip fits beside "+N more"', () => {
  assert.equal(AllDay.fit([300, 100], 200, 10, 80), 0);
});

test('fit: no width (a hidden view) means nothing was measured', () => {
  assert.equal(AllDay.fit([0, 0], 0, 10, 0), null);
});
