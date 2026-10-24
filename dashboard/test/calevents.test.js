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
