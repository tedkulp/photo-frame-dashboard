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

  // Idle seconds: back to Today, the idle screen, and nightdash's fallback. FAST_IDLE is Test
  // controls' fast idle; DisplayMode.idle(state) says which one a state counts against.
  DisplayMode.IDLE = { home: 120, ambient: 300, nightdash: 20 };
  DisplayMode.FAST_IDLE = { home: 8, ambient: 15, nightdash: 20 };
  DisplayMode.idle = function (state) { return state.fastIdle ? DisplayMode.FAST_IDLE : DisplayMode.IDLE; };

  // Effects the app runs, in order, before applying the mode.
  DisplayMode.CLOSE_SHEET = 'closeSheet';
  DisplayMode.TODAY = 'today';

  // Night hours: 22:00 to 06:00.
  DisplayMode.isNight = function (hour) { return hour >= 22 || hour < 6; };
  // Night for a state at the real hour: Pretend night (a test control) makes every hour count as
  // night hours. Every decision on the hour goes through this; the clock itself stays real.
  DisplayMode.night = function (state, hour) { return !!state.pretendNight || DisplayMode.isNight(hour); };

  // The idle screen for the hour: night during night hours, else ambient. Where the frame goes
  // when it leaves day (idle tick, rail-clock tap) and where nightdash falls back to after 20 s,
  // so a nightdash left past 06:00 lands on ambient.
  DisplayMode.idleScreen = function (night) { return night ? NIGHT : AMBIENT; };

  // The mode after the night flag went from `wasNight` to `night` while `mode` was showing.
  // Only a crossing changes anything, so a mode picked with A/N holds until the next boundary:
  // ambient → night at 22:00, night → ambient at 06:00. Day and nightdash are left alone (idle
  // decides when day leaves; nightdash falls back through DisplayMode.idleScreen).
  DisplayMode.atBoundary = function (mode, wasNight, night) {
    if (wasNight === night) return mode;
    if (mode === AMBIENT || mode === NIGHT) return DisplayMode.idleScreen(night);
    return mode;
  };

  // The starting state: day, idleSec 0, the hour not yet seen (the first tick is no crossing),
  // Test controls' fast idle and Pretend night off.
  DisplayMode.initial = function (phone) {
    return { mode: DAY, idleSec: 0, night: null, phone: !!phone, takeover: false, fastIdle: false, pretendNight: false };
  };

  function copy(s) {
    return {
      mode: s.mode, idleSec: s.idleSec, night: s.night, phone: s.phone, takeover: s.takeover,
      fastIdle: !!s.fastIdle, pretendNight: !!s.pretendNight
    };
  }

  // next(state, input) -> { state, mode, effects }. `mode` is set only when the mode changes (a
  // change also starts idleSec from 0); `effects` lists CLOSE_SHEET / TODAY for the app to run first.
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
  //   set { mode }           App.setMode from other code: a phone stays in day, a takeover too
  //   fastIdle { on }        Test controls: count idle against FAST_IDLE (8 s / 15 s) or IDLE
  //   pretendNight { on, hour }  Test controls: treat every hour as night hours; switching it is a
  //                          crossing like 22:00 (on) or 06:00 (off) at once, if the real hour isn't
  //                          already on that side
  DisplayMode.next = function (state, input) {
    var s = copy(state), effects = [], mode = s.mode, night, idle = DisplayMode.idle(s);
    function to(m) { if (m !== DAY && s.phone) return; mode = m; }
    function closeToToday() { effects.push(DisplayMode.CLOSE_SHEET, DisplayMode.TODAY); }
    function goIdle(m) { closeToToday(); to(m); }
    // The idle switch and the A/N keys: day only (keys from any frame mode), never on a phone or
    // over a takeover.
    var free = !s.phone && !s.takeover;

    switch (input.type) {
      case 'tick':
        night = DisplayMode.night(s, input.hour);
        if (s.night !== null) mode = DisplayMode.atBoundary(s.mode, s.night, night);
        s.night = night;
        if (mode !== s.mode || !free) break;
        s.idleSec++;
        if (s.mode === NIGHTDASH && s.idleSec >= idle.nightdash) to(DisplayMode.idleScreen(night));
        else if (s.mode === DAY) {
          if (s.idleSec >= idle.ambient) goIdle(DisplayMode.idleScreen(night));
          else if (s.idleSec === idle.home && !input.today) closeToToday();
        }
        break;
      case 'clock':
        if (free && s.mode === DAY) goIdle(DisplayMode.idleScreen(DisplayMode.night(s, input.hour)));
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
        s.idleSec = 0;
        effects.push(DisplayMode.CLOSE_SHEET);
        to(DAY);
        break;
      case 'takeoverClose':
        s.takeover = false;
        s.idleSec = 0;
        break;
      case 'layout':
        s.phone = !!input.phone;
        if (s.phone) { s.idleSec = 0; to(DAY); }
        break;
      case 'input':
        s.idleSec = 0;
        break;
      case 'set':
        if (input.mode === DAY || !s.takeover) to(input.mode);
        break;
      case 'fastIdle':
        s.fastIdle = !!input.on;
        break;
      case 'pretendNight':
        s.pretendNight = !!input.on;
        night = DisplayMode.night(s, input.hour);
        if (s.night !== null) mode = DisplayMode.atBoundary(s.mode, s.night, night);
        s.night = night;
        break;
    }

    if (mode === s.mode) return { state: s, mode: undefined, effects: effects };
    s.mode = mode;
    s.idleSec = 0;
    return { state: s, mode: mode, effects: effects };
  };
})(typeof window !== 'undefined' ? window : globalThis);
