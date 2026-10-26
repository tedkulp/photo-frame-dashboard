import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../js/swipe.js';

const Swipe = globalThis.Swipe;

test('dir: a left swipe is next, a right swipe is previous', () => {
  assert.equal(Swipe.dir({ dx: -120, dy: 10, ms: 300 }), 1);
  assert.equal(Swipe.dir({ dx: 120, dy: -10, ms: 300 }), -1);
});

test('dir: must travel more than MIN_X across', () => {
  assert.equal(Swipe.dir({ dx: -Swipe.MIN_X, dy: 0, ms: 200 }), 0);
  assert.equal(Swipe.dir({ dx: Swipe.MIN_X + 1, dy: 0, ms: 200 }), -1);
  assert.equal(Swipe.dir({ dx: 0, dy: 0, ms: 50 }), 0); // a tap
});

test('dir: too vertical is not a swipe (that is a scroll)', () => {
  assert.equal(Swipe.dir({ dx: -200, dy: Swipe.MAX_Y, ms: 300 }), 0);
  assert.equal(Swipe.dir({ dx: -200, dy: -Swipe.MAX_Y, ms: 300 }), 0);
  assert.equal(Swipe.dir({ dx: -200, dy: Swipe.MAX_Y - 1, ms: 300 }), 1);
});

test('dir: too slow is not a swipe (a drag)', () => {
  assert.equal(Swipe.dir({ dx: -200, dy: 0, ms: Swipe.MAX_MS }), 0);
  assert.equal(Swipe.dir({ dx: -200, dy: 0, ms: Swipe.MAX_MS - 1 }), 1);
});

test('dir: the thresholds stay as the Calendar had them', () => {
  assert.deepEqual([Swipe.MIN_X, Swipe.MAX_Y, Swipe.MAX_MS], [90, 60, 700]);
});
