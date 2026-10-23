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

// ------------------------------------------------------------ the state machine: next(state, input)
// A fake frame with a fake clock (an hour it sets by hand, one tick per second): holds the module's
// state, feeds it inputs and applies what the app would (effects first, then the mode).
const { DAY, AMBIENT, NIGHT, NIGHTDASH } = DisplayMode.MODES;
const IDLE = DisplayMode.IDLE;

function frame(opts) {
  opts = opts || {};
  const f = {
    state: DisplayMode.initial(!!opts.phone),
    hour: opts.hour == null ? 14 : opts.hour,
    page: opts.page || 'calendar',
    sheet: !!opts.sheet,
    log: [],
    send(input) {
      const out = DisplayMode.next(f.state, input);
      f.state = out.state;
      for (const e of out.effects) {
        f.log.push(e);
        if (e === DisplayMode.CLOSE_SHEET) f.sheet = false;
        if (e === DisplayMode.TODAY) f.page = 'home';
      }
      if (out.mode) f.log.push('mode:' + out.mode);
      return out;
    },
    tick(n) { for (let i = 0; i < (n || 1); i++) f.send({ type: 'tick', hour: f.hour, today: f.page === 'home' }); },
    get mode() { return f.state.mode; }
  };
  return f;
}

test('night hours are 22:00 to 06:00', () => {
  assert.deepEqual([0, 5, 6, 12, 21, 22, 23].map(DisplayMode.isNight), [true, true, false, false, false, true, true]);
});

test('idle in day: back to Today at 120 s, ambient at 300 s in the daytime', () => {
  const f = frame({ hour: 14, sheet: true });
  f.tick(IDLE.home - 1);
  assert.equal(f.page, 'calendar');
  f.tick();
  assert.equal(f.page, 'home');
  assert.equal(f.sheet, false);
  assert.equal(f.mode, DAY);
  f.tick(IDLE.ambient - IDLE.home - 1);
  assert.equal(f.mode, DAY);
  f.tick();
  assert.equal(f.mode, AMBIENT);
});

test('idle in day at night hours lands on night at 300 s', () => {
  const f = frame({ hour: 23 });
  f.tick(IDLE.ambient);
  assert.equal(f.mode, NIGHT);
  assert.equal(f.page, 'home');
});

test('already on Today at 120 s: the sheet stays open until the idle screen', () => {
  const f = frame({ page: 'home', sheet: true });
  f.tick(IDLE.home);
  assert.equal(f.sheet, true);
  f.tick(IDLE.ambient - IDLE.home);
  assert.equal(f.sheet, false);
  assert.equal(f.mode, AMBIENT);
});

test('user input resets the idle counter', () => {
  const f = frame();
  f.tick(IDLE.ambient - 10);
  f.send({ type: 'input' });
  f.tick(IDLE.ambient - 1);
  assert.equal(f.mode, DAY);
  f.tick();
  assert.equal(f.mode, AMBIENT);
});

test('nightdash falls back to night after 20 s idle', () => {
  const f = frame({ hour: 23 });
  f.tick(IDLE.ambient);
  f.send({ type: 'tapNight' });
  assert.equal(f.mode, NIGHTDASH);
  f.tick(IDLE.nightdash - 1);
  assert.equal(f.mode, NIGHTDASH);
  f.tick();
  assert.equal(f.mode, NIGHT);
});

test('tap on ambient: day and Today', () => {
  const f = frame();
  f.tick(IDLE.ambient);
  assert.equal(f.mode, AMBIENT);
  f.page = 'weather';
  f.send({ type: 'tapAmbient' });
  assert.equal(f.mode, DAY);
  assert.equal(f.page, 'home');
});

test('tap on night: nightdash', () => {
  const f = frame({ hour: 2 });
  f.tick(IDLE.ambient);
  assert.equal(f.mode, NIGHT);
  f.send({ type: 'tapNight' });
  assert.equal(f.mode, NIGHTDASH);
});

test('a tap on an overlay that is not showing does nothing', () => {
  const f = frame();
  assert.equal(f.send({ type: 'tapAmbient' }).mode, undefined);
  assert.equal(f.send({ type: 'tapNight' }).mode, undefined);
  assert.equal(f.mode, DAY);
});

test('rail-clock tap from day: closes the sheet, Today, then the idle screen for the hour', () => {
  const f = frame({ hour: 14, sheet: true });
  f.send({ type: 'clock', hour: 14 });
  assert.deepEqual(f.log, [DisplayMode.CLOSE_SHEET, DisplayMode.TODAY, 'mode:' + AMBIENT]);
  const g = frame({ hour: 22 });
  g.send({ type: 'clock', hour: 22 });
  assert.equal(g.mode, NIGHT);
});

test('rail-clock tap outside day does nothing', () => {
  const f = frame({ hour: 2 });
  f.tick(IDLE.ambient);
  f.send({ type: 'tapNight' });
  const out = f.send({ type: 'clock', hour: 2 });
  assert.equal(out.mode, undefined);
  assert.deepEqual(out.effects, []);
});

test('a mode change starts idle from 0', () => {
  const f = frame({ hour: 23 });
  f.tick(IDLE.ambient);
  assert.equal(f.mode, NIGHT);
  assert.equal(f.state.idle, 0);
});

test('phone layout stays day for every input and never counts idle', () => {
  const f = frame({ phone: true, sheet: true });
  const inputs = [
    { type: 'tick', hour: 14, today: false }, { type: 'tick', hour: 23, today: false },
    { type: 'clock', hour: 23 }, { type: 'key', mode: AMBIENT }, { type: 'key', mode: NIGHT },
    { type: 'tapAmbient' }, { type: 'tapNight' }, { type: 'set', mode: NIGHT }, { type: 'set', mode: NIGHTDASH },
    { type: 'takeoverOpen' }, { type: 'takeoverClose' }, { type: 'input' }, { type: 'layout', phone: true }
  ];
  for (const input of inputs) {
    f.send(input);
    assert.equal(f.mode, DAY, input.type);
  }
  f.sheet = true;
  f.tick(IDLE.ambient * 2);
  assert.equal(f.mode, DAY);
  assert.equal(f.state.idle, 0);
  assert.equal(f.page, 'calendar');
  assert.equal(f.sheet, true);
});

test('layout flip to phone from ambient: day', () => {
  const f = frame();
  f.tick(IDLE.ambient);
  assert.equal(f.mode, AMBIENT);
  assert.equal(f.send({ type: 'layout', phone: true }).mode, DAY);
  assert.equal(f.send({ type: 'layout', phone: false }).mode, undefined);
  assert.equal(f.mode, DAY);
});

test('set (App.setMode) applies the phone rule', () => {
  const f = frame();
  assert.equal(f.send({ type: 'set', mode: NIGHT }).mode, NIGHT);
  assert.equal(f.send({ type: 'set', mode: NIGHT }).mode, undefined); // no change, nothing to apply
  const p = frame({ phone: true });
  assert.equal(p.send({ type: 'set', mode: AMBIENT }).mode, undefined);
});

// #31's boundary cases, through the state machine
test('boundary: ambient → night at 22:00, night → ambient at 06:00', () => {
  const f = frame({ hour: 21 });
  f.tick(IDLE.ambient);
  assert.equal(f.mode, AMBIENT);
  f.hour = 22; f.tick();
  assert.equal(f.mode, NIGHT);
  f.hour = 6; f.tick();
  assert.equal(f.mode, AMBIENT);
});

test('boundary: day is unchanged', () => {
  const f = frame({ hour: 21 });
  f.tick();
  f.hour = 22; f.tick();
  assert.equal(f.mode, DAY);
  f.hour = 6; f.tick();
  assert.equal(f.mode, DAY);
});

test('boundary: nightdash is unchanged, and after 06:00 lands on ambient', () => {
  const f = frame({ hour: 5 });
  f.tick(IDLE.ambient);
  f.send({ type: 'tapNight' });
  f.tick(5);
  f.hour = 6; f.tick();
  assert.equal(f.mode, NIGHTDASH);
  f.tick(IDLE.nightdash);
  assert.equal(f.mode, AMBIENT);
});

test('the first tick only learns the hour; it is no crossing', () => {
  const f = frame({ hour: 23 });
  f.send({ type: 'set', mode: AMBIENT });
  f.tick();
  assert.equal(f.mode, AMBIENT);
});

test('A/N hold until the next boundary', () => {
  const f = frame({ hour: 23 });
  f.tick();
  f.send({ type: 'key', mode: AMBIENT });
  f.tick(3);
  assert.equal(f.mode, AMBIENT);
  f.hour = 6; f.tick();
  assert.equal(f.mode, AMBIENT); // crossing out of night: ambient stays ambient
  f.send({ type: 'key', mode: NIGHT });
  f.hour = 12; f.tick();
  assert.equal(f.mode, NIGHT);
  f.hour = 22; f.tick();
  assert.equal(f.mode, NIGHT);
  f.hour = 6; f.tick();
  assert.equal(f.mode, AMBIENT);
});

// Takeovers
test('a takeover forces day and closes the sheet', () => {
  const f = frame({ hour: 2 });
  f.tick(IDLE.ambient);
  f.sheet = true;
  f.send({ type: 'takeoverOpen' });
  assert.equal(f.mode, DAY);
  assert.equal(f.sheet, false);
});

test('idle does not count under a takeover; closing it by code starts idle from 0', () => {
  const f = frame({ hour: 14 });
  f.tick(50);
  f.send({ type: 'takeoverOpen' });
  f.tick(600); // 10 minutes
  assert.equal(f.mode, DAY);
  assert.equal(f.page, 'calendar');
  assert.equal(f.state.idle, 0);
  f.send({ type: 'takeoverClose' });
  f.tick(IDLE.ambient - 1);
  assert.equal(f.mode, DAY);
  f.tick();
  assert.equal(f.mode, AMBIENT);
});

test('rail-clock tap under a takeover does nothing', () => {
  const f = frame();
  f.send({ type: 'takeoverOpen' });
  assert.equal(f.send({ type: 'clock', hour: 14 }).mode, undefined);
});

// A and N keys
test('A with a sheet open on another page: closes the sheet, Today, then ambient', () => {
  const f = frame({ hour: 14, sheet: true, page: 'tasks' });
  f.send({ type: 'key', mode: AMBIENT });
  assert.deepEqual(f.log, [DisplayMode.CLOSE_SHEET, DisplayMode.TODAY, 'mode:' + AMBIENT]);
  assert.equal(f.sheet, false);
  assert.equal(f.page, 'home');
});

test('N with a sheet open on another page: closes the sheet, Today, then night', () => {
  const f = frame({ hour: 14, sheet: true, page: 'tasks' });
  f.send({ type: 'key', mode: NIGHT });
  assert.deepEqual(f.log, [DisplayMode.CLOSE_SHEET, DisplayMode.TODAY, 'mode:' + NIGHT]);
});

test('A and N do nothing under a takeover', () => {
  const f = frame({ sheet: true, page: 'tasks' });
  f.send({ type: 'takeoverOpen' });
  f.log = []; f.sheet = true;
  for (const m of [AMBIENT, NIGHT]) {
    const out = f.send({ type: 'key', mode: m });
    assert.equal(out.mode, undefined);
    assert.deepEqual(out.effects, []);
  }
  assert.equal(f.sheet, true);
  assert.equal(f.page, 'tasks');
});

test('next never changes the state it is given', () => {
  const s = DisplayMode.initial(false);
  const copy = JSON.stringify(s);
  DisplayMode.next(s, { type: 'tick', hour: 23, today: false });
  DisplayMode.next(s, { type: 'key', mode: NIGHT });
  DisplayMode.next(s, { type: 'takeoverOpen' });
  assert.equal(JSON.stringify(s), copy);
});
