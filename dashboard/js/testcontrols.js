// Test controls (GLOSSARY.md): a hidden drawer on the frame for trying things out by hand. A 2 s
// hold on the rail clock or the T key opens it (a short clock tap still goes to the idle screen);
// Esc, its x or a tap outside closes it. None on a phone. Everything it changes lives in memory
// (DisplayMode's state, or a section's own variables): no localStorage, no server, so a reload
// undoes it all. While any section is active the rail shows a "Test" pill (data-test on the stage).
//
// The drawer is a list of sections. Each is { id, title, html(), click(button), active() }: html
// gives the section's buttons, click handles a tap on one of them (true closes the drawer) and
// active says whether it has something switched on (for the pill). App.test.section(sec) adds one
// (weather alerts add an Alerts section this way); App.test.changed() repaints after a section's
// state changed from outside the drawer.
(function () {
  'use strict';
  var $ = App.$, M = window.DisplayMode.MODES;
  var HOLD_MS = 2000;
  var sections = [];
  var openNow = false;
  var swallowClick = false; // the click that ends the clock hold must not also go to the idle screen

  function el() { return $('#testControls'); }
  function active() { return sections.some(function (s) { return !!(s.active && s.active()); }); }

  function button(attrs, label, on) {
    return '<button ' + attrs + (on ? ' class="is-on" aria-pressed="true"' : '') + '>' + label + '</button>';
  }
  function render() {
    el().innerHTML = '<div class="tc-panel" role="dialog" aria-label="Test controls">' +
      '<div class="tc-head"><div><div class="label label--light">This screen only · a reload undoes it</div>' +
      '<h2 class="serif">Test controls</h2></div>' +
      '<button class="tc-x" data-tc-close aria-label="Close">' + App.icon('x', 28) + '</button></div>' +
      sections.map(function (s) {
        return '<div class="tc-sec" data-tc-sec="' + s.id + '"><div class="label label--light">' + s.title + '</div>' +
          '<div class="tc-grid">' + s.html() + '</div></div>';
      }).join('') +
      '<p class="tc-note">Keys: <b>T</b> test controls · <b>A</b> ambient · <b>N</b> night · <b>Esc</b> close</p>' +
      '</div>';
  }
  function changed() {
    var stage = $('#stage');
    if (stage) { if (active()) stage.setAttribute('data-test', ''); else stage.removeAttribute('data-test'); }
    if (openNow) render();
  }

  function open() {
    if (App.isPhone()) return;
    openNow = true;
    render();
    el().classList.add('is-open');
  }
  function close() {
    if (!openNow) return;
    openNow = false;
    el().classList.remove('is-open');
    el().innerHTML = '';
  }

  App.test = {
    active: active,
    isOpen: function () { return openNow; },
    open: open,
    close: close,
    toggle: function () { if (openNow) close(); else open(); },
    section: function (sec) { sections.push(sec); changed(); },
    changed: changed
  };

  // ------------------------------------------------------------ Modes: through DisplayMode only
  // Ambient and Night go the way the A/N keys do (close the sheet, Today, then that mode); Day and
  // Nightdash are App.setMode's input. A takeover keeps day, as for the keys.
  var MODE_BUTTONS = [[M.DAY, 'Day'], [M.AMBIENT, 'Ambient'], [M.NIGHT, 'Night'], [M.NIGHTDASH, 'Nightdash']];
  App.test.section({
    id: 'modes', title: 'Modes',
    html: function () {
      return MODE_BUTTONS.map(function (m) { return button('data-mode="' + m[0] + '"', m[1], App.mode === m[0]); }).join('');
    },
    click: function (b) {
      var m = b.getAttribute('data-mode');
      if (m === M.AMBIENT || m === M.NIGHT) App.modeInput({ type: 'key', mode: m });
      else App.modeInput({ type: 'set', mode: m });
      return true;
    }
  });

  // ------------------------------------------------------------ Idle and night: DisplayMode's test flags
  App.test.section({
    id: 'time', title: 'Idle and night',
    html: function () {
      var t = App.modeTest();
      return button('data-fastidle', 'Fast idle · 8 s / 15 s', t.fastIdle) +
        button('data-pretendnight', 'Pretend night', t.pretendNight);
    },
    click: function (b) {
      var t = App.modeTest();
      if (b.hasAttribute('data-fastidle')) App.modeInput({ type: 'fastIdle', on: !t.fastIdle });
      if (b.hasAttribute('data-pretendnight')) App.modeInput({ type: 'pretendNight', on: !t.pretendNight, hour: App.now().getHours() });
      changed();
      return false;
    },
    active: function () { var t = App.modeTest(); return t.fastIdle || t.pretendNight; }
  });

  function onClick(e) {
    var b = e.target.closest('button'), sec, i;
    if (!b) { if (e.target === el()) close(); return; } // the backdrop: a tap outside the panel
    if (b.hasAttribute('data-tc-close')) { close(); return; }
    sec = b.closest('[data-tc-sec]');
    for (i = 0; sec && i < sections.length; i++) {
      if (sections[i].id !== sec.getAttribute('data-tc-sec')) continue;
      if (sections[i].click(b)) close();
      return;
    }
  }

  // On window, capturing: ahead of app.js's clock-click listener on document.
  window.addEventListener('pointerdown', function () { swallowClick = false; }, true);
  window.addEventListener('click', function (e) {
    if (!swallowClick) return;
    swallowClick = false;
    e.stopImmediatePropagation();
    e.preventDefault();
  }, true);

  App.on('ready', function () {
    App.hold($('#railClock'), HOLD_MS, {
      enabled: function () { return !App.isPhone(); },
      done: function () { swallowClick = true; open(); }
    });
    el().addEventListener('click', onClick);
    document.addEventListener('keydown', function (e) {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
      var k = e.key.toLowerCase();
      if (k === 't') App.test.toggle();
      if (k === 'escape') close();
    });
    changed();
  });
  App.on('mode', function () { if (openNow) render(); });
  App.on('stage', function () { if (App.isPhone()) close(); });
})();
