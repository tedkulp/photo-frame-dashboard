import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../js/stage.js';

const Stage = globalThis.Stage;

test('a 16:10 window keeps the 1280×800 stage at scale 1', () => {
  assert.deepEqual(Stage.fit(1280, 800), { width: 1280, height: 800, scale: 1, x: 0, y: 0 });
});

test('a 1920×1080 window gets a wider stage that fills it exactly', () => {
  const s = Stage.fit(1920, 1080);
  assert.equal(s.height, 800);
  assert.equal(s.width, 1422); // 800 × 16/9, rounded down so it never overflows
  assert.equal(s.scale, 1.35);
  assert.equal(s.y, 0);
  assert.ok(s.x >= 0 && s.x < 1, 'no side bars: at most a sub-pixel gap');
  assert.ok(s.width * s.scale <= 1920 && s.width * s.scale > 1919);
});

test('a 16:10 window larger than the frame scales the 1280 stage up', () => {
  const s = Stage.fit(1920, 1200);
  assert.deepEqual(s, { width: 1280, height: 800, scale: 1.5, x: 0, y: 0 });
});

test('narrow and portrait windows keep a 1280 minimum width and letterbox', () => {
  const s = Stage.fit(800, 1280);
  assert.equal(s.width, 1280);
  assert.equal(s.scale, 800 / 1280);
  assert.equal(s.x, 0);
  assert.equal(s.y, (1280 - 800 * s.scale) / 2);
  const sq = Stage.fit(1000, 1000);
  assert.equal(sq.width, 1280);
});

test('a very wide window is capped so views are not stretched past what they lay out for', () => {
  const s = Stage.fit(3440, 1000);
  assert.equal(s.width, Stage.MAX_WIDTH);
  assert.equal(s.scale, 1000 / 800);
  assert.equal(s.x, (3440 - Stage.MAX_WIDTH * s.scale) / 2);
});

test('a zero-size window (hidden, not laid out yet) falls back to the 1280×800 stage', () => {
  assert.deepEqual(Stage.fit(0, 0), { width: 1280, height: 800, scale: 1, x: 0, y: 0 });
});

test('toStage turns screen coordinates into stage coordinates at any fit', () => {
  // 1422 wide at 1.35: the stage's on-screen rect is 1919.7 wide
  const rect = { left: 0, top: 0, width: 1422 * 1.35, height: 1080 };
  const p = Stage.toStage(rect, 1422, 1422 * 1.35 / 2, 540);
  assert.equal(Math.round(p.x), 711);
  assert.equal(Math.round(p.y), 400);
  // letterboxed portrait: offset by the bar, scaled down
  const s = Stage.fit(800, 1280);
  const lb = { left: 0, top: s.y, width: 800, height: 500 };
  assert.deepEqual(Stage.toStage(lb, 1280, 400, s.y + 250), { x: 640, y: 400 });
});
