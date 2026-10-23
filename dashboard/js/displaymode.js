// The display-mode rules (day / ambient / night / nightdash), kept pure: app.js owns the clock,
// the idle counter and App.setMode, and asks these which mode comes next. Night hours themselves
// are App.isNight(); these only take its value. Also loads in Node for
// dashboard/test/displaymode.test.js.
(function (root) {
  'use strict';
  var DisplayMode = root.DisplayMode = {};

  // The idle screen for the hour: night during night hours, else ambient. Where the frame goes
  // when it leaves day (idle tick, rail-clock tap) and where nightdash falls back to after 20 s,
  // so a nightdash left past 06:00 lands on ambient.
  DisplayMode.idle = function (night) { return night ? 'night' : 'ambient'; };

  // The mode after App.isNight() went from `wasNight` to `night` while `mode` was showing.
  // Only a crossing changes anything, so a mode picked with A/N holds until the next boundary:
  // ambient → night at 22:00, night → ambient at 06:00. Day and nightdash are left alone (idle
  // decides when day leaves; nightdash falls back through DisplayMode.idle).
  DisplayMode.atBoundary = function (mode, wasNight, night) {
    if (wasNight === night) return mode;
    if (mode === 'ambient' || mode === 'night') return DisplayMode.idle(night);
    return mode;
  };
})(typeof window !== 'undefined' ? window : globalThis);
