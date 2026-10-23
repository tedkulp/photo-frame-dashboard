// Alerts (takeovers, banners) + the keyboard shortcuts.
(function () {
  'use strict';
  var $ = App.$;

  function img(seed, w, h) { return 'https://picsum.photos/seed/' + seed + '/' + w + '/' + h; }
  App.img = img;

  // ------------------------------------------------------------ full-screen takeovers
  // For real alerts (e.g. a Home Assistant doorbell): App.takeover(html, cls) fills #takeover with
  // the caller's HTML (cls adds a class for its own styles), closes any sheet, switches to day mode
  // and returns the element so the caller can wire its buttons; idle pauses while it's open.
  // App.closeTakeover() closes it. Shared button styles: .tk-actions, .tk-btn (--solid, .is-on);
  // App.hold(el, ms, { done, cancel }) makes a hold-to-confirm button (.is-holding while held).
  function takeover(html, cls) {
    var el = $('#takeover');
    el.className = 'takeover ' + (cls || '');
    el.innerHTML = html;
    el.classList.add('is-open');
    App.modeInput({ type: 'takeoverOpen' }); // closes the sheet, day mode, idle paused
    return el;
  }
  function closeTakeover() {
    var el = $('#takeover');
    el.classList.remove('is-open');
    el.innerHTML = '';
    App.modeInput({ type: 'takeoverClose' }); // idle starts again from 0
  }
  App.takeover = takeover;
  App.closeTakeover = closeTakeover;

  // ------------------------------------------------------------ banners (amber, actionable)
  // App.banner({ tone: 'amber'|'ink', icon, title, sub, action, onAction, dismiss, ms }) shows one
  // at the top; ms dismisses it on its own. Returns a function that removes it.
  App.banner = function (opts) {
    var box = $('#banners');
    var b = document.createElement('div');
    b.className = 'banner banner--' + (opts.tone || 'amber');
    b.innerHTML = App.icon(opts.icon || 'bell', 30) + '<div class="banner-text"><b>' + opts.title + '</b><span>' + (opts.sub || '') + '</span></div>' +
      (opts.action ? '<button class="banner-btn banner-btn--solid" data-act>' + opts.action + '</button>' : '') +
      '<button class="banner-btn" data-x>' + (opts.dismiss || 'Dismiss') + '</button>';
    box.appendChild(b);
    b.classList.add('is-in');
    function kill() { b.remove(); }
    b.querySelector('[data-x]').onclick = kill;
    if (opts.action) b.querySelector('[data-act]').onclick = function () { kill(); opts.onAction(); };
    if (opts.ms) setTimeout(kill, opts.ms);
    return kill;
  };

  App.on('ready', function () {
    document.addEventListener('keydown', function (e) {
      if (e.target.tagName === 'INPUT') return;
      var k = e.key.toLowerCase();
      // A and N do what the idle switch does (close the sheet, Today, then ambient or night) and
      // hold until the next 22:00/06:00; nothing over a takeover or on a phone
      if (k === 'a') App.modeInput({ type: 'key', mode: window.DisplayMode.MODES.AMBIENT });
      if (k === 'n') App.modeInput({ type: 'key', mode: window.DisplayMode.MODES.NIGHT });
      if (k === 'escape') App.closeSheet();
      // 1–9 follow the rail's tabs in order, so a hidden tab drops out
      var tab = App.$$('.rail-item')[+k - 1];
      if (k >= '1' && k <= '9' && tab) App.go(tab.dataset.go);
    });
  });
})();
