// The frame's side of weather alerts (the rules are alerts.js; the feed is app.js's alertsFeed, every
// minute): what the views ask (App.alerts, App.notableAlert, App.alertsNote), an alert's sheet
// (App.alertSheet), the takeover for urgent alerts and Test controls' fake alerts. The Weather
// page's strip, Today's chip and the ambient/night line repaint on the 'alerts' event.
//
// The takeover (App.takeover) shows the worst urgent alert not dismissed, plus "+N more alerts";
// Dismiss dismisses every alert it shows, Details does too and opens the worst one's sheet on the
// Weather page. It is checked every second, so it closes by itself when its alerts end or leave the
// feed, follows the night rule (App.isNight, Pretend night included) and never opens on a phone.
// Real dismissals are kept per frame in localStorage; fake alerts and their dismissals only in memory.
(function () {
  'use strict';
  var A = window.Alerts, D = window.DATA, $ = App.$;
  var KEY = 'homehq.alertsDismissed';
  var dismissed = read(); // real alerts: { id: { sev, at } }
  var fakes = [], fakeDismissed = {}, seq = 1; // Test controls' alerts: this screen only, in memory
  var shownKey = null; // the ids the takeover shows, while it's ours and open

  function read() {
    try {
      var d = JSON.parse(window.localStorage.getItem(KEY));
      return d && typeof d === 'object' && !Array.isArray(d) ? A.prune(d, Date.now()) : {};
    } catch (e) { return {}; }
  }
  function save() {
    dismissed = A.prune(dismissed, Date.now());
    try { window.localStorage.setItem(KEY, JSON.stringify(dismissed)); } catch (e) {}
  }

  function real() { return D.alerts && D.alerts.configured ? D.alerts.alerts : []; }
  // Every alert running now, real and fake, worst first.
  App.alerts = function () { return A.active(real().concat(fakes), App.now()); };
  // Today's chip and the ambient/night line: { alert, more, text } for the notable alerts, or null.
  App.notableAlert = function () { return A.notableSummary(App.alerts(), App.now()); };
  // The Weather page's note ('' for none): Alerts.note with the live feed.
  function alertsState() { return App.alertsFeed ? App.alertsFeed.state() : { status: 'loading' }; }
  App.alertsNote = function () { return A.note(alertsState(), D.alerts, App.now()); };
  App.findAlert = function (id) { return App.alerts().filter(function (a) { return a.id === id; })[0] || null; };

  function dismissAll(list) {
    var t = Date.now();
    var r = list.filter(function (a) { return !a.fake; }), f = list.filter(function (a) { return a.fake; });
    if (r.length) { dismissed = A.dismiss(dismissed, r, t); save(); }
    if (f.length) fakeDismissed = A.dismiss(fakeDismissed, f, t);
  }

  // ------------------------------------------------------------ an alert's sheet
  function paras(s, cls) {
    return A.paragraphs(s).map(function (p) { return '<p' + (cls ? ' class="' + cls + '"' : '') + '>' + App.esc(p) + '</p>'; }).join('');
  }
  App.alertSheet = function (a) {
    if (!a) return;
    var now = App.now();
    var times = [a.onset ? 'From <b>' + A.when(a.onset, now) + '</b>' : '', 'Until <b>' + (a.ends ? A.when(a.ends, now) : 'further notice') + '</b>']
      .filter(Boolean).join(' · ');
    App.sheet('<div class="sheet-pad al-sheet">' +
      '<div class="label">' + App.esc(a.severity + ' · ' + a.urgency) + (a.fake ? ' · Test' : '') + '</div>' +
      '<h2 class="sheet-h serif">' + App.esc(a.event) + '</h2>' +
      (a.headline ? '<p class="al-head">' + App.esc(a.headline) + '</p>' : '') +
      (times ? '<p class="al-times">' + times + '</p>' : '') +
      '<div class="al-text">' + paras(a.description) + paras(a.instruction, 'al-do') + '</div>' +
      '</div>', { cls: 'sheet--wide' });
  };

  // ------------------------------------------------------------ the takeover
  function ours() { var el = $('#takeover'); return el.classList.contains('is-open') && el.classList.contains('tk-alert'); }
  function takeoverHtml(list) {
    var a = list[0], now = App.now(), more = list.length - 1;
    var desc = A.paragraphs(a.description).join(' ');
    return '<div class="tk-al">' +
      '<div class="tk-al-kicker">' + App.icon('alert', 30) + 'Weather alert' + (a.fake ? ' · Test' : '') + '</div>' +
      '<h1 class="tk-al-event serif">' + App.esc(a.event) + '</h1>' +
      (a.headline ? '<p class="tk-al-head">' + App.esc(a.headline) + '</p>' : '') +
      '<p class="tk-al-until">' + App.esc(A.until(a, now)) + '</p>' +
      (desc ? '<p class="tk-al-desc">' + App.esc(desc) + '</p>' : '') +
      (more ? '<p class="tk-al-more">' + A.moreText(more) + '</p>' : '') +
      '<div class="tk-actions"><button class="tk-btn" data-al-dismiss><span>Dismiss</span></button>' +
      '<button class="tk-btn tk-btn--solid" data-al-details><span>Details</span></button></div>' +
      '</div>';
  }
  function sync() {
    var list = A.takeover(App.alerts(), { night: App.isNight(), phone: App.isPhone(), dismissed: Object.assign({}, dismissed, fakeDismissed) });
    var key = list.map(function (a) { return a.id; }).join(' ');
    if (shownKey !== null && !ours()) shownKey = null; // someone else's takeover replaced it
    if (!list.length) {
      if (shownKey !== null) { shownKey = null; App.closeTakeover(); }
      return;
    }
    if (key === shownKey) return;
    var el = $('#takeover');
    if (shownKey === null && el.classList.contains('is-open')) return; // another takeover is showing
    var cls = 'tk-alert' + (list[0].severity === 'Extreme' ? ' tk-alert--extreme' : '');
    if (shownKey === null) el = App.takeover(takeoverHtml(list), cls);
    else { el.className = 'takeover is-open ' + cls; el.innerHTML = takeoverHtml(list); }
    shownKey = key;
    el.querySelector('[data-al-dismiss]').onclick = function () { dismissAll(list); sync(); };
    el.querySelector('[data-al-details]').onclick = function () {
      dismissAll(list);
      sync();
      App.go('weather');
      App.alertSheet(App.findAlert(list[0].id) || list[0]);
    };
  }

  // A new listing: updates of dismissed alerts are dismissed by their own ids too, so a chain of
  // updates stays dismissed after the first one leaves the feed.
  App.on('alerts', function () {
    var next = A.inherit(dismissed, real(), Date.now());
    if (next !== dismissed) { dismissed = next; save(); }
    sync();
  });
  App.on('second', sync);
  App.on('stage', sync);

  // ------------------------------------------------------------ Test controls: fake alerts
  function fakesChanged() { App.emit('alerts'); App.test.changed(); }
  App.test.section({
    id: 'alerts', title: 'Weather alerts · on top of the real ones',
    html: function () {
      return A.PRESETS.map(function (p) { return '<button data-al-preset="' + p.id + '">' + p.label + '</button>'; }).join('') +
        '<button data-al-clear' + (fakes.length ? ' class="is-on" aria-pressed="true"' : '') + '>Clear' + (fakes.length ? ' · ' + fakes.length + ' fake' : '') + '</button>';
    },
    click: function (b) {
      if (b.hasAttribute('data-al-clear')) { fakes = []; fakeDismissed = {}; }
      else {
        var made = A.fake(b.getAttribute('data-al-preset'), App.now(), seq);
        seq += made.length;
        fakes = fakes.concat(made);
      }
      fakesChanged();
      return true;
    },
    active: function () { return fakes.length > 0; }
  });
})();
