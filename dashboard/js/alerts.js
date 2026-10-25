// Weather alerts from the home server's GET /api/alerts (the NWS's alerts for the home, ADR 0007):
// parsing the listing and the pure rules the frame shows them by. A notable alert is Moderate or
// worse (Today's chip, the ambient/night line); an urgent alert is Severe or worse and Immediate
// (the takeover; at night only an Extreme one). Alerts rank by severity, then urgency. Dismissals
// are { id: { sev, at } }: an update (a new id whose references include a dismissed id) stays
// dismissed unless its severity rose. Plus Test controls' fake alerts (PRESETS, fake). The frame's
// side (feed, takeover, sheet) is weatheralerts.js. Also loads in Node for dashboard/test/alerts.test.js.
(function (root) {
  'use strict';
  var Alerts = root.Alerts = {};
  var MIN = 60000, DAY = 24 * 60 * MIN;
  Alerts.REFRESH = MIN;      // the frame asks the home server every minute
  Alerts.STALE = 10 * MIN;
  Alerts.OLD = 10 * MIN;     // say how old the alerts are once the server's copy is older than this
  Alerts.KEEP = 7 * DAY;     // dismissals are forgotten after this

  var SEVERITY = { Unknown: 0, Minor: 1, Moderate: 2, Severe: 3, Extreme: 4 };
  var URGENCY = { Unknown: 0, Past: 1, Future: 2, Expected: 3, Immediate: 4 };
  function sev(a) { return SEVERITY[a.severity] || 0; }
  function urg(a) { return URGENCY[a.urgency] || 0; }
  Alerts.severityRank = sev;

  function text(v) { return typeof v === 'string' && v !== ''; }
  function date(v) { var d = v ? new Date(v) : null; return d && !isNaN(d) ? d : null; }

  function toAlert(r) {
    return {
      id: r.id, references: Array.isArray(r.references) ? r.references.filter(text) : [],
      event: r.event, severity: text(r.severity) ? r.severity : 'Unknown', urgency: text(r.urgency) ? r.urgency : 'Unknown',
      headline: text(r.headline) ? r.headline : '', description: text(r.description) ? r.description : '',
      instruction: text(r.instruction) ? r.instruction : '',
      onset: date(r.onset), ends: date(r.ends)
    };
  }

  // The server's body → { configured: false } or { configured: true, available (the server has had
  // a good copy), alerts: [{ id, references, event, severity, urgency, headline, description,
  // instruction, onset, ends }], fetched (when the server's copy was read, a Date or null), stale }.
  // Throws on anything else.
  Alerts.parse = function (body) {
    if (body && body.configured === false) return { configured: false };
    if (!body || body.configured !== true || !Array.isArray(body.alerts)) throw new Error('Unexpected alerts response');
    return {
      configured: true, available: body.available !== false, stale: body.stale === true, fetched: date(body.fetched),
      alerts: body.alerts.filter(function (r) { return r && text(r.id) && text(r.event); }).map(toAlert)
    };
  };
  // Only the alerts and what the note says count as a change, not the copy's age: when the server's
  // copy is fresh (not stale) its read time moves every minute and the note ignores it.
  Alerts.changeKey = function (body) {
    return JSON.stringify(body && body.configured === true
      ? [body.available, body.stale === true, body.stale === true ? body.fetched : null, body.alerts] : body);
  };

  // ------------------------------------------------------------ the rules
  Alerts.notable = function (a) { return sev(a) >= SEVERITY.Moderate; };
  Alerts.urgent = function (a, night) {
    return urg(a) === URGENCY.Immediate && sev(a) >= (night ? SEVERITY.Extreme : SEVERITY.Severe);
  };
  // Worst first: severity, then urgency (stable otherwise).
  Alerts.rank = function (list) {
    return list.map(function (a, i) { return [a, i]; }).sort(function (x, y) {
      return sev(y[0]) - sev(x[0]) || urg(y[0]) - urg(x[0]) || x[1] - y[1];
    }).map(function (p) { return p[0]; });
  };
  // The alerts still running at `now`, ranked. One with no end time runs until it leaves the feed.
  Alerts.active = function (list, now) {
    return Alerts.rank(list.filter(function (a) { return !a.ends || a.ends > now; }));
  };
  // A list's worst alert plus how many more: { alert, more, text: "Tornado Warning +2" }, or null.
  Alerts.summary = function (list) {
    if (!list.length) return null;
    var worst = Alerts.rank(list)[0], more = list.length - 1;
    return { alert: worst, more: more, text: worst.event + (more ? ' +' + more : '') };
  };
  // The summary of the notable alerts active at `now`: Today's chip and the ambient/night line.
  Alerts.notableSummary = function (list, now) {
    return Alerts.summary(Alerts.active(list, now).filter(Alerts.notable));
  };
  Alerts.moreText = function (n) { return '+' + n + ' more alert' + (n === 1 ? '' : 's'); };

  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function clock(d) {
    var h = d.getHours(), m = d.getMinutes();
    return (h % 12 || 12) + ':' + (m < 10 ? '0' : '') + m + ' ' + (h >= 12 ? 'pm' : 'am');
  }
  function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
  // "3:40 pm" today, else "Tue 3:40 pm".
  Alerts.when = function (d, now) { return (sameDay(d, now) ? '' : DAYS[d.getDay()] + ' ') + clock(d); };
  // "until 6:00 pm", "until Tue 9:30 am", or "until further notice" without an end time (the NWS
  // gives none while it's in force with no end in sight).
  Alerts.until = function (a, now) { return 'until ' + (a.ends ? Alerts.when(a.ends, now) : 'further notice'); };
  // NWS text is hard-wrapped, paragraphs split by a blank line: the paragraphs, each on one line.
  Alerts.paragraphs = function (s) {
    if (!text(s)) return [];
    return s.split(/\n\s*\n/).map(function (p) { return p.replace(/\s*\n\s*/g, ' ').trim(); }).filter(Boolean);
  };

  // What to say on the Weather page, like Weather.note from the feed's state(), the parsed data and
  // now (a Date); '' for nothing. Loading says nothing (the strip stays hidden until there's an
  // answer). The unreachable line while the frame has never had an answer; 'Alerts unavailable' when
  // the server has never had a good copy; 'Alerts from 3:10 pm' once the alerts shown are over
  // Alerts.OLD old: the server's copy when its last try failed, else the copy the frame last got.
  Alerts.note = function (s, data, now) {
    if (s.status === 'loading') return '';
    if (s.status === 'offline') return s.answered ? 'Alerts unavailable · retrying' : root.Feed.UNREACHABLE + ' · retrying';
    if (!data || !data.configured) return '';
    if (!data.available || !data.fetched) return 'Alerts unavailable';
    var from = data.stale ? data.fetched : null;
    if (s.age != null) {
      var got = new Date(now - s.age * MIN);
      if (!from || got < from) from = got;
    }
    return from && now - from > Alerts.OLD ? 'Alerts from ' + Alerts.when(from, now) : '';
  };

  // ------------------------------------------------------------ dismissals
  function copy(d) { var out = {}; for (var k in d) if (d.hasOwnProperty(k)) out[k] = d[k]; return out; }
  // Dismissed itself, or an update to a dismissed alert whose severity didn't rise.
  Alerts.isDismissed = function (a, d) {
    if (d.hasOwnProperty(a.id)) return true;
    return a.references.some(function (r) { return d.hasOwnProperty(r) && sev(a) <= d[r].sev; });
  };
  // d with `list` dismissed at `at` (ms).
  Alerts.dismiss = function (d, list, at) {
    var out = copy(d);
    list.forEach(function (a) { out[a.id] = { sev: sev(a), at: at }; });
    return out;
  };
  // d with every alert in `list` that is dismissed through its references dismissed by its own id
  // too, so a chain of updates stays dismissed. The same object when there is nothing to add.
  Alerts.inherit = function (d, list, at) {
    var out = d;
    list.forEach(function (a) {
      if (d.hasOwnProperty(a.id) || !Alerts.isDismissed(a, d)) return;
      if (out === d) out = copy(d);
      // The bar it was dismissed at carries over, so falling and rising back doesn't take over again.
      var bar = a.references.reduce(function (m, r) { return d.hasOwnProperty(r) ? Math.max(m, d[r].sev) : m; }, sev(a));
      out[a.id] = { sev: bar, at: at };
    });
    return out;
  };
  // d without dismissals older than Alerts.KEEP (on load and on every save).
  Alerts.prune = function (d, now) {
    var out = {};
    for (var k in d) if (d.hasOwnProperty(k) && d[k] && now - d[k].at < Alerts.KEEP) out[k] = d[k];
    return out;
  };

  // ------------------------------------------------------------ the takeover
  // What the takeover shows: the urgent (for the hour), undismissed alerts in `list`, worst first;
  // [] on a phone. o: { night, phone, dismissed }.
  Alerts.takeover = function (list, o) {
    if (o.phone) return [];
    return Alerts.rank(list.filter(function (a) { return Alerts.urgent(a, o.night) && !Alerts.isDismissed(a, o.dismissed); }));
  };

  // ------------------------------------------------------------ Test controls' fake alerts
  var HEAD = 'Test alert: not from the National Weather Service';
  var DESC = 'This is a fake alert from Test controls on this screen only.\n\nIt never reaches the home server and a reload removes it. Clear in Test controls removes every fake alert.';
  function preset(event, severity, urgency) { return { event: event, severity: severity, urgency: urgency }; }
  Alerts.PRESETS = [
    { id: 'minor', label: 'Minor advisory', alerts: [preset('Frost Advisory', 'Minor', 'Expected')] },
    { id: 'moderate', label: 'Moderate watch', alerts: [preset('Winter Storm Watch', 'Moderate', 'Expected')] },
    { id: 'severe', label: 'Severe/Immediate warning', alerts: [preset('Severe Thunderstorm Warning', 'Severe', 'Immediate')] },
    { id: 'extreme', label: 'Extreme/Immediate warning', alerts: [preset('Tornado Warning', 'Extreme', 'Immediate')] },
    { id: 'two', label: 'Two urgent at once', alerts: [preset('Flash Flood Warning', 'Severe', 'Immediate'), preset('Severe Thunderstorm Warning', 'Severe', 'Immediate')] }
  ];
  // The fake alerts of preset `id` at `now` (a Date), numbered from `seq` so ids never repeat:
  // started now, ending in 2 hours, marked fake.
  Alerts.fake = function (id, now, seq) {
    var p = Alerts.PRESETS.filter(function (x) { return x.id === id; })[0];
    if (!p) return [];
    return p.alerts.map(function (x, i) {
      return {
        id: 'test-' + (seq + i), references: [], event: x.event, severity: x.severity, urgency: x.urgency,
        headline: x.event + ' · ' + HEAD, description: DESC, instruction: '',
        onset: new Date(now.getTime()), ends: new Date(now.getTime() + 2 * 60 * MIN), fake: true
      };
    });
  };
})(typeof window !== 'undefined' ? window : globalThis);
