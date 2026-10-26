// Swipe left/right to step a day (App.swipe in app.js; the Calendar and Chores pages): whether a
// finished one-finger gesture counts, and which way. Also loads in Node for dashboard/test/swipe.test.js.
(function (root) {
  'use strict';
  var Swipe = root.Swipe = {};

  // More than MIN_X px across, under MAX_Y px up or down, within MAX_MS ms.
  Swipe.MIN_X = 90;
  Swipe.MAX_Y = 60;
  Swipe.MAX_MS = 700;

  // The step for a gesture that moved dx, dy (px, end minus start) in ms: 1 (left, next), -1
  // (right, previous) or 0 (not a swipe: a tap, a scroll or a slow drag).
  Swipe.dir = function (g) {
    if (Math.abs(g.dx) <= Swipe.MIN_X || Math.abs(g.dy) >= Swipe.MAX_Y || g.ms >= Swipe.MAX_MS) return 0;
    return g.dx < 0 ? 1 : -1;
  };
})(typeof window !== 'undefined' ? window : globalThis);
