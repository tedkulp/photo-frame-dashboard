// The stage's layout and logical size for a window.
// Frame layout: height is always 800; width follows the window's aspect ratio (1280 at 16:10,
// 1422 at 16:9) so a landscape screen fills edge to edge, never narrower than 1280 (portrait
// tablets and square windows letterbox) and never wider than MAX_WIDTH. The stage is then scaled
// uniformly by `scale` and placed at (x, y) in window pixels.
// Phone layout: a portrait window narrower than PHONE_MAX_WIDTH lays out at native CSS pixels,
// the window's own size, unscaled; CSS keys off data-layout="phone" on the stage.
// Also loads in Node for dashboard/test/stage.test.js.
(function (root) {
  'use strict';

  var Stage = root.Stage = {};
  Stage.HEIGHT = 800;
  Stage.MIN_WIDTH = 1280;
  Stage.MAX_WIDTH = 1600; // 2:1; wider windows get bars rather than ever-wider rows
  Stage.PHONE_MAX_WIDTH = 700;

  // 'phone' for a portrait window narrower than PHONE_MAX_WIDTH, else 'frame'.
  Stage.layout = function (winW, winH) {
    return winW > 0 && winH > winW && winW < Stage.PHONE_MAX_WIDTH ? 'phone' : 'frame';
  };

  // prev: the last fit, if any. A phone stays a phone while only its height changes, so the
  // on-screen keyboard (which can leave it wider than tall) doesn't flip it to the frame stage.
  Stage.fit = function (winW, winH, prev) {
    var keep = prev && prev.layout === 'phone' && prev.width === winW && winH > 0;
    if (keep || Stage.layout(winW, winH) === 'phone') return { layout: 'phone', width: winW, height: winH, scale: 1, x: 0, y: 0 };
    if (!(winW > 0) || !(winH > 0)) return { layout: 'frame', width: Stage.MIN_WIDTH, height: Stage.HEIGHT, scale: 1, x: 0, y: 0 };
    // Rounded down so the scaled stage never runs past the window edge.
    var width = Math.floor(Stage.HEIGHT * winW / winH);
    width = Math.max(Stage.MIN_WIDTH, Math.min(Stage.MAX_WIDTH, width));
    var scale = Math.min(winW / width, winH / Stage.HEIGHT);
    return {
      layout: 'frame', width: width, height: Stage.HEIGHT, scale: scale,
      x: (winW - width * scale) / 2, y: (winH - Stage.HEIGHT * scale) / 2
    };
  };

  // Window coordinates → stage coordinates, from the stage's on-screen rect and logical width.
  Stage.toStage = function (rect, width, clientX, clientY) {
    var k = rect.width / width;
    return { x: (clientX - rect.left) / k, y: (clientY - rect.top) / k };
  };
})(typeof window !== 'undefined' ? window : globalThis);
