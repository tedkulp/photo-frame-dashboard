// The stage's logical size for a window. Height is always 800; width follows the window's aspect
// ratio (1280 at 16:10, 1422 at 16:9) so a landscape screen fills edge to edge, never narrower
// than 1280 (narrow and portrait windows letterbox as before) and never wider than MAX_WIDTH.
// The stage is then scaled uniformly by `scale` and placed at (x, y) in window pixels.
// Also loads in Node for dashboard/test/stage.test.js.
(function (root) {
  'use strict';

  var Stage = root.Stage = {};
  Stage.HEIGHT = 800;
  Stage.MIN_WIDTH = 1280;
  Stage.MAX_WIDTH = 1600; // 2:1; wider windows get bars rather than ever-wider rows

  Stage.fit = function (winW, winH) {
    if (!(winW > 0) || !(winH > 0)) return { width: Stage.MIN_WIDTH, height: Stage.HEIGHT, scale: 1, x: 0, y: 0 };
    // Rounded down so the scaled stage never runs past the window edge.
    var width = Math.floor(Stage.HEIGHT * winW / winH);
    width = Math.max(Stage.MIN_WIDTH, Math.min(Stage.MAX_WIDTH, width));
    var scale = Math.min(winW / width, winH / Stage.HEIGHT);
    return {
      width: width, height: Stage.HEIGHT, scale: scale,
      x: (winW - width * scale) / 2, y: (winH - Stage.HEIGHT * scale) / 2
    };
  };

  // Window coordinates → stage coordinates, from the stage's on-screen rect and logical width.
  Stage.toStage = function (rect, width, clientX, clientY) {
    var k = rect.width / width;
    return { x: (clientX - rect.left) / k, y: (clientY - rect.top) / k };
  };
})(typeof window !== 'undefined' ? window : globalThis);
