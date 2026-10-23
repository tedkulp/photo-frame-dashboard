import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../js/displaymode.js';

const DisplayMode = globalThis.DisplayMode;
const MODES = ['day', 'ambient', 'night', 'nightdash'];

test('ambient becomes night when the clock crosses into night (22:00)', () => {
  assert.equal(DisplayMode.atBoundary('ambient', false, true), 'night');
});

test('night becomes ambient, not day, when the clock crosses out of night (06:00)', () => {
  assert.equal(DisplayMode.atBoundary('night', true, false), 'ambient');
});

test('day and nightdash are left alone at either boundary', () => {
  for (const m of ['day', 'nightdash']) {
    assert.equal(DisplayMode.atBoundary(m, false, true), m);
    assert.equal(DisplayMode.atBoundary(m, true, false), m);
  }
});

test('nothing changes without a crossing, so a mode picked with A/N holds', () => {
  for (const m of MODES) for (const night of [false, true]) assert.equal(DisplayMode.atBoundary(m, night, night), m);
});

test('a forced ambient at night stays ambient through 06:00', () => {
  assert.equal(DisplayMode.atBoundary('ambient', true, false), 'ambient');
});

test('a forced night in the day stays through 22:00 and becomes ambient at 06:00', () => {
  assert.equal(DisplayMode.atBoundary('night', false, true), 'night');
  assert.equal(DisplayMode.atBoundary('night', true, false), 'ambient');
});

test('the idle screen is night during night hours, else ambient', () => {
  assert.equal(DisplayMode.idle(true), 'night');
  assert.equal(DisplayMode.idle(false), 'ambient');
});
