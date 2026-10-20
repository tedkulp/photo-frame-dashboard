import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../js/chores.js';

const Chores = globalThis.Chores;

// 2026-10-21 is a Wednesday.
const body = (over) => Object.assign({
  date: '2026-10-21',
  chores: [
    { id: 1, title: 'Garbage to curb', emoji: '🗑️', owner: 'any', routine: 'evening', days: [0, 3] },
    { id: 2, title: 'Make bed', emoji: '🛏️', owner: 'maya', routine: 'morning', days: [0, 1, 2, 3, 4, 5, 6] },
    { id: 3, title: 'Piano', emoji: '🎹', owner: 'otto', routine: 'evening', days: [1, 4] },
  ],
  done: [2], // the server's ids are numbers
  week: { maya: ['hit', 'miss', 'hit', null, null, null, null] },
  updatedAt: '2026-10-21T12:00:00.000Z',
}, over);

// ------------------------------------------------------------ parse
test('parses the server body: weekday from the server date, ids as strings, done as a set', () => {
  const d = Chores.parse(body());
  assert.equal(d.date, '2026-10-21');
  assert.equal(d.weekday, 3);
  assert.equal(d.chores.length, 3);
  assert.deepEqual(d.chores[0], { id: '1', title: 'Garbage to curb', emoji: '🗑️', owner: 'any', routine: 'evening', days: [0, 3] });
  assert.deepEqual(d.done, { 2: true });
  assert.deepEqual(d.week, { maya: ['hit', 'miss', 'hit', null, null, null, null] });
});

test('rejects a body that is not a chores response', () => {
  assert.throws(() => Chores.parse(null));
  assert.throws(() => Chores.parse(body({ date: 'Wednesday' })));
  assert.throws(() => Chores.parse(body({ chores: 'x' })));
  assert.throws(() => Chores.parse(body({ done: null })));
  assert.throws(() => Chores.parse(body({ week: [] })));
});

test('drops malformed chores and week rows instead of failing the whole response', () => {
  const d = Chores.parse(body({
    chores: [{ id: 9, title: 'No days', emoji: 'x', owner: 'any', routine: 'morning' }, body().chores[1]],
    week: { maya: ['hit'], otto: ['hit', 'miss', 'nope', null, null, null, null] },
  }));
  assert.deepEqual(d.chores.map((c) => c.id), ['2']);
  assert.deepEqual(d.week, { otto: ['hit', 'miss', null, null, null, null, null] });
});

test('changeKey ignores updatedAt but sees a tick', () => {
  const a = Chores.changeKey(body());
  assert.equal(Chores.changeKey(body({ updatedAt: '2026-10-21T12:00:30.000Z' })), a);
  assert.notEqual(Chores.changeKey(body({ done: [] })), a);
});

// ------------------------------------------------------------ today's selection
const sunWed = (date) => Chores.parse(body({ date, done: [] }));

test('a Sun+Wed chore shows only on Sundays and Wednesdays', () => {
  const days = ['2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24'];
  const shown = days.filter((d) => Chores.today(sunWed(d), 'evening').some((c) => c.id === '1'));
  assert.deepEqual(shown, ['2026-10-18', '2026-10-21']);
});

test('today lists the shown routine only, with done from the server', () => {
  const d = Chores.parse(body());
  assert.deepEqual(Chores.today(d, 'morning').map((c) => [c.id, c.done]), [['2', true]]);
  assert.deepEqual(Chores.today(d, 'evening').map((c) => [c.id, c.done]), [['1', false]]);
});

test('a pending tick or untick shows over the server state until it settles', () => {
  const d = Chores.parse(body());
  assert.equal(Chores.today(d, 'evening', { 1: true })[0].done, true);
  assert.equal(Chores.today(d, 'morning', { 2: false })[0].done, false);
});

test('nothing to show without data', () => {
  assert.deepEqual(Chores.today(null, 'morning'), []);
});

// ------------------------------------------------------------ this week
test('week grid: hit, miss and null map to hit, miss and future; today is the server weekday', () => {
  const d = Chores.parse(body());
  assert.deepEqual(Chores.week(d, 'maya'), {
    today: 2, // Wednesday, Mon-first
    days: ['hit', 'miss', 'hit', 'future', 'future', 'future', 'future'],
  });
  assert.equal(Chores.week(Chores.parse(body({ date: '2026-10-25' })), 'maya').today, 6); // Sunday
});

test('no week grid for someone not in the week, or without data', () => {
  assert.equal(Chores.week(Chores.parse(body()), 'otto'), null);
  assert.equal(Chores.week(null, 'maya'), null);
});
