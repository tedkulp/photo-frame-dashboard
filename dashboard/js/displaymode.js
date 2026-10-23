// The display modes (day / ambient / night / nightdash) and the idle counter, in one place.
// DisplayMode.next(state, input) decides every mode transition; app.js holds the state, feeds it
// inputs and applies the answer (effects first, then the mode: data-mode on the stage, App.mode,
// the 'mode' event). No DOM and no clock of its own: the hour comes in with the input. Also loads
// in Node for dashboard/test/displaymode.test.js.
(function (root) {
  'use strict';
  var DisplayMode = root.DisplayMode = {};

  // The mode names, also the stage's data-mode values the CSS selects on. Nightdash is the dimmed
  // dashboard shown after tapping Night; it falls back to the idle screen after 20 s.
  var DAY = 'day', AMBIENT = 'ambient', NIGHT = 'night', NIGHTDASH = 'nightdash';
  DisplayMode.MODES = { DAY: DAY, AMBIENT: AMBIENT, NIGHT: NIGHT, NIGHTDASH: NIGHTDASH };

  // Idle seconds: back to Today, the idle screen, and nightdash's fallback. App.idle is this object.
  DisplayMode.IDLE = { home: 120, ambient: 300, nightdash: 20 };

  // Effects the app runs, in order, before applying the mode.
  DisplayMode.CLOSE_SHEET = 'closeSheet';
  DisplayMode.TODAY = 'today';

  // Night hours: 22:00 to 06:00.
  DisplayMode.isNight = function (hour) { return hour >= 22 || hour < 6; };

  // The idle screen for the hour: night during night hours, else ambient. Where the frame goes
  // when it leaves day (idle tick, rail-clock tap) and where nightdash falls back to after 20 s,
  // so a nightdash left past 06:00 lands on ambient.
  DisplayMode.idle = function (night) { return night ? NIGHT : AMBIENT; };

  // The mode after the night flag went from `wasNight` to `night` while `mode` was showing.
  // Only a crossing changes anything, so a mode picked with A/N holds until the next boundary:
  // ambient → night at 22:00, night → ambient at 06:00. Day and nightdash are left alone (idle
  // decides when day leaves; nightdash falls back through DisplayMode.idle).
  DisplayMode.atBoundary = function (mode, wasNight, night) {
    if (wasNight === night) return mode;
    if (mode === AMBIENT || mode === NIGHT) return DisplayMode.idle(night);
    return mode;
  };

  // The starting state: day, idle 0, the hour not yet seen (the first tick is no crossing).
  DisplayMode.initial = function (phone) {
    return { mode: DAY, idle: 0, night: null, phone: !!phone, takeover: false };
  };

  function copy(s) {
    return { mode: s.mode, idle: s.idle, night: s.night, phone: s.phone, takeover: s.takeover };
  }

  // next(state, input) -> { state, mode, effects }. `mode` is set only when the mode changes (a
  // change also starts idle from 0); `effects` lists CLOSE_SHEET / TODAY for the app to run first.
  // Inputs ({ type, ... }):
  //   tick { hour, today }   once a second: the 22:00/06:00 swap, then the idle counter (today:
  //                          Today is showing, so 120 s leaves an open sheet alone)
  //   clock { hour }         rail-clock tap: from day, straight to the idle screen
  //   key { mode }           A (ambient) or N (night): like the idle switch, to that mode
  //   tapAmbient, tapNight   taps on the overlays: ambient → day + Today, night → nightdash
  //   takeoverOpen           forces day, closes the sheet; idle stops counting while it's open
  //   takeoverClose          idle starts again from 0
  //   layout { phone }       the layout flipped; a phone is always day and never counts idle
  //   input                  the user touched the screen: idle starts again from 0
  //   set { mode }           App.setMode from other code; only the phone rule applies
  DisplayMode.next = function (state, input) {
    var s = copy(state), effects = [], mode = s.mode, night;
    function to(m) { if (m !== DAY && s.phone) return; mode = m; }
    function goIdle(m) { effects.push(DisplayMode.CLOSE_SHEET, DisplayMode.TODAY); to(m); }
    // The idle switch and the A/N keys: day only (keys from any frame mode), never on a phone or
    // over a takeover.
    var free = !s.phone && !s.takeover;

    switch (input.type) {
      case 'tick':
        night = DisplayMode.isNight(input.hour);
        if (s.night !== null) mode = DisplayMode.atBoundary(s.mode, s.night, night);
        s.night = night;
        if (mode !== s.mode || !free) break;
        s.idle++;
        if (s.mode === NIGHTDASH && s.idle >= DisplayMode.IDLE.nightdash) to(DisplayMode.idle(night));
        else if (s.mode === DAY) {
          if (s.idle >= DisplayMode.IDLE.ambient) goIdle(DisplayMode.idle(night));
          else if (s.idle === DisplayMode.IDLE.home && !input.today) effects.push(DisplayMode.CLOSE_SHEET, DisplayMode.TODAY);
        }
        break;
      case 'clock':
        if (free && s.mode === DAY) goIdle(DisplayMode.idle(DisplayMode.isNight(input.hour)));
        break;
      case 'key':
        if (free && (input.mode === AMBIENT || input.mode === NIGHT)) goIdle(input.mode);
        break;
      case 'tapAmbient':
        if (s.mode === AMBIENT) { effects.push(DisplayMode.TODAY); to(DAY); }
        break;
      case 'tapNight':
        if (s.mode === NIGHT) to(NIGHTDASH);
        break;
      case 'takeoverOpen':
        s.takeover = true;
        s.idle = 0;
        effects.push(DisplayMode.CLOSE_SHEET);
        to(DAY);
        break;
      case 'takeoverClose':
        s.takeover = false;
        s.idle = 0;
        break;
      case 'layout':
        s.phone = !!input.phone;
        if (s.phone) { s.idle = 0; to(DAY); }
        break;
      case 'input':
        s.idle = 0;
        break;
      case 'set':
        to(input.mode);
        break;
    }

    if (mode === s.mode) return { state: s, mode: undefined, effects: effects };
    s.mode = mode;
    s.idle = 0;
    return { state: s, mode: mode, effects: effects };
  };
})(typeof window !== 'undefined' ? window : globalThis);
