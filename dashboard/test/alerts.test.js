import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../js/feed.js';
import '../js/alerts.js';

const { Alerts, Feed } = globalThis;
const MIN = 60000;
const at = (h, m, day) => new Date(2026, 9, day || 25, h, m);
const NOW = at(15, 40);

function raw(over) {
  return Object.assign({
    id: 'urn:a', references: [], event: 'Winter Storm Warning', severity: 'Severe', urgency: 'Expected',
    headline: 'Winter Storm Warning issued October 25', description: 'Heavy snow.', instruction: null,
    onset: at(14, 0).toISOString(), ends: at(18, 0).toISOString()
  }, over);
}
function alert(over) { return Alerts.parse({ configured: true, available: true, alerts: [raw(over)], fetched: NOW.toISOString(), stale: false }).alerts[0]; }

// ------------------------------------------------------------ parsing
test('parses the listing into Dates; not configured passes through; anything else throws', () => {
  assert.deepEqual(Alerts.parse({ configured: false }), { configured: false });
  const d = Alerts.parse({ configured: true, available: true, alerts: [raw()], fetched: NOW.toISOString(), stale: false });
  assert.equal(d.configured, true);
  assert.equal(d.available, true);
  assert.equal(d.stale, false);
  assert.ok(d.fetched instanceof Date);
  assert.ok(d.alerts[0].onset instanceof Date && d.alerts[0].ends instanceof Date);
  assert.equal(d.alerts[0].event, 'Winter Storm Warning');
  for (const b of [null, {}, { configured: true }, { configured: true, alerts: 'x' }]) {
    assert.throws(() => Alerts.parse(b), /Unexpected alerts response/);
  }
  // No end time is kept (null); an alert without an id or event is left out.
  const p = Alerts.parse({ configured: true, available: true, alerts: [raw({ ends: null }), raw({ id: '' }), raw({ event: 7 })], fetched: null });
  assert.equal(p.alerts.length, 1);
  assert.equal(p.alerts[0].ends, null);
  assert.equal(p.fetched, null);
});

// ------------------------------------------------------------ the rules
test('notable is Moderate or worse; urgent is Severe or worse and Immediate', () => {
  assert.deepEqual(['Minor', 'Unknown', 'Moderate', 'Severe', 'Extreme'].map((s) => Alerts.notable(alert({ severity: s }))), [false, false, true, true, true]);
  assert.equal(Alerts.urgent(alert({ severity: 'Severe', urgency: 'Immediate' }), false), true);
  assert.equal(Alerts.urgent(alert({ severity: 'Extreme', urgency: 'Immediate' }), false), true);
  assert.equal(Alerts.urgent(alert({ severity: 'Severe', urgency: 'Expected' }), false), false);
  assert.equal(Alerts.urgent(alert({ severity: 'Moderate', urgency: 'Immediate' }), false), false);
});

test('at night only an Extreme urgent alert is urgent', () => {
  assert.equal(Alerts.urgent(alert({ severity: 'Severe', urgency: 'Immediate' }), true), false);
  assert.equal(Alerts.urgent(alert({ severity: 'Extreme', urgency: 'Immediate' }), true), true);
  assert.equal(Alerts.urgent(alert({ severity: 'Extreme', urgency: 'Expected' }), true), false);
});

test('ranked by severity, then urgency; ended alerts drop out of active', () => {
  const list = [
    alert({ id: 'minor', severity: 'Minor', urgency: 'Immediate' }),
    alert({ id: 'sev-exp', severity: 'Severe', urgency: 'Expected' }),
    alert({ id: 'ext-fut', severity: 'Extreme', urgency: 'Future' }),
    alert({ id: 'sev-imm', severity: 'Severe', urgency: 'Immediate' }),
    alert({ id: 'gone', severity: 'Extreme', urgency: 'Immediate', ends: at(15, 39).toISOString() }),
    alert({ id: 'open', severity: 'Moderate', urgency: 'Immediate', ends: null })
  ];
  assert.deepEqual(Alerts.rank(list).map((a) => a.id), ['gone', 'ext-fut', 'sev-imm', 'sev-exp', 'open', 'minor']);
  assert.deepEqual(Alerts.active(list, NOW).map((a) => a.id), ['ext-fut', 'sev-imm', 'sev-exp', 'open', 'minor']);
});

test('the summary is the worst of a list plus "+N"; nothing for an empty list', () => {
  assert.equal(Alerts.summary([]), null);
  const one = Alerts.summary([alert({ event: 'Flood Watch', severity: 'Moderate' })]);
  assert.deepEqual([one.alert.event, one.more, one.text], ['Flood Watch', 0, 'Flood Watch']);
  const three = Alerts.summary([alert({ id: 'a', event: 'Flood Watch', severity: 'Moderate' }), alert({ id: 'b', event: 'Tornado Warning', severity: 'Extreme' }), alert({ id: 'c', event: 'Wind Advisory', severity: 'Moderate' })]);
  assert.deepEqual([three.alert.event, three.more, three.text], ['Tornado Warning', 2, 'Tornado Warning +2']);
  // The notable summary (Today's chip, the ambient/night line) leaves out Minor alerts.
  const s = Alerts.notableSummary([alert({ id: 'm', severity: 'Minor', event: 'Frost Advisory' }), alert({ id: 'w', severity: 'Moderate', event: 'Winter Storm Watch' })], NOW);
  assert.equal(s.text, 'Winter Storm Watch');
  assert.equal(Alerts.notableSummary([alert({ severity: 'Minor' })], NOW), null);
  assert.equal(Alerts.moreText(1), '+1 more alert');
  assert.equal(Alerts.moreText(3), '+3 more alerts');
});

test('"until" says the end time, with the weekday when it is not today', () => {
  assert.equal(Alerts.until(alert({ ends: at(18, 0).toISOString() }), NOW), 'until 6:00 pm');
  assert.equal(Alerts.until(alert({ ends: at(9, 30, 27).toISOString() }), NOW), 'until Tue 9:30 am');
  assert.equal(Alerts.until(alert({ ends: null }), NOW), 'until further notice');
});

test('a description is unwrapped into paragraphs', () => {
  assert.deepEqual(Alerts.paragraphs('* WHAT...Heavy snow\nexpected.\n\n* WHERE...Here.\n'), ['* WHAT...Heavy snow expected.', '* WHERE...Here.']);
  assert.deepEqual(Alerts.paragraphs(''), []);
  assert.deepEqual(Alerts.paragraphs(null), []);
});

// ------------------------------------------------------------ staleness note
const ok = (age) => ({ status: 'ok', failed: false, stale: false, age: age || 0, answered: false });
test('the note: unavailable with no good copy ever, "Alerts from" once the server\'s copy is over 10 minutes old, else nothing', () => {
  const data = (fetched, available, stale) => Alerts.parse({ configured: true, available, alerts: [], fetched: fetched && fetched.toISOString(), stale: stale !== false });
  assert.equal(Alerts.note(ok(), data(null, false), NOW), 'Alerts unavailable');
  assert.equal(Alerts.note(ok(), data(new Date(NOW - 10 * MIN), true), NOW), '');
  assert.equal(Alerts.note(ok(), data(at(15, 29), true), NOW), 'Alerts from 3:29 pm');
  // The server's last try worked: its copy is current, whatever time it came with.
  assert.equal(Alerts.note(ok(), data(at(15, 0), true, false), NOW), '');
  assert.equal(Alerts.note(ok(), { configured: false }, NOW), '');
  assert.equal(Alerts.note(ok(), null, NOW), '');
});

test('the note follows the feed: nothing while loading, unreachable while never answered, the frame\'s own copy\'s age', () => {
  const fresh = Alerts.parse({ configured: true, available: true, alerts: [], fetched: NOW.toISOString(), stale: false });
  assert.equal(Alerts.note({ status: 'loading' }, null, NOW), '');
  const offline = { status: 'offline', failed: true, stale: false, age: null, answered: false };
  assert.equal(Alerts.note(offline, null, NOW), Feed.UNREACHABLE + ' · retrying');
  assert.equal(Alerts.note(Object.assign({}, offline, { answered: true }), null, NOW), 'Alerts unavailable · retrying');
  // The frame hasn't heard from the server for 11 minutes (status stays ok on the cached copy).
  assert.equal(Alerts.note(ok(10), fresh, new Date(NOW.getTime() + 10 * MIN)), '');
  assert.equal(Alerts.note(Object.assign(ok(11), { stale: true, failed: true }), fresh, new Date(NOW.getTime() + 11 * MIN)), 'Alerts from 3:40 pm');
  // Both old: the older one.
  const old = Alerts.parse({ configured: true, available: true, alerts: [], fetched: at(15, 0).toISOString(), stale: true });
  assert.equal(Alerts.note(ok(20), old, NOW), 'Alerts from 3:00 pm');
});

test('changeKey: only the alerts and what the note needs; a fresh copy\'s read time is no change', () => {
  const body = (fetched, stale, alerts) => ({ configured: true, available: true, alerts: alerts || [raw()], fetched, age: 0, stale });
  assert.equal(Alerts.changeKey(body('2026-10-25T19:40:00Z', false)), Alerts.changeKey(Object.assign(body('2026-10-25T19:41:00Z', false), { age: 3 })));
  assert.notEqual(Alerts.changeKey(body('2026-10-25T19:40:00Z', false)), Alerts.changeKey(body('2026-10-25T19:40:00Z', false, [])));
  assert.notEqual(Alerts.changeKey(body('2026-10-25T19:40:00Z', false)), Alerts.changeKey(body('2026-10-25T19:40:00Z', true)));
  // Stale: the copy's time is what the note says, so it counts.
  assert.notEqual(Alerts.changeKey(body('2026-10-25T19:40:00Z', true)), Alerts.changeKey(body('2026-10-25T19:30:00Z', true)));
  assert.notEqual(Alerts.changeKey({ configured: false }), Alerts.changeKey(body(null, false)));
});

// ------------------------------------------------------------ dismissal and supersede
test('a dismissed alert stays dismissed, and so does an update to it unless its severity rose', () => {
  const a = alert({ id: 'A', severity: 'Severe', urgency: 'Immediate' });
  let d = Alerts.dismiss({}, [a], NOW.getTime());
  assert.equal(Alerts.isDismissed(a, d), true);
  assert.equal(Alerts.isDismissed(alert({ id: 'B', severity: 'Severe' }), d), false, 'unrelated');
  assert.equal(Alerts.isDismissed(alert({ id: 'B', references: ['A'], severity: 'Severe' }), d), true, 'same severity');
  assert.equal(Alerts.isDismissed(alert({ id: 'B', references: ['A'], severity: 'Moderate' }), d), true, 'lower');
  assert.equal(Alerts.isDismissed(alert({ id: 'B', references: ['A'], severity: 'Extreme' }), d), false, 'rose');
});

test('inherit carries a dismissal down a chain of updates', () => {
  const d0 = Alerts.dismiss({}, [alert({ id: 'A', severity: 'Severe' })], NOW.getTime());
  const b = alert({ id: 'B', references: ['A'], severity: 'Severe' });
  const d1 = Alerts.inherit(d0, [b], NOW.getTime());
  assert.notEqual(d1, d0);
  assert.ok(d1.B);
  const c = alert({ id: 'C', references: ['B'], severity: 'Severe' });
  assert.equal(Alerts.isDismissed(c, d1), true);
  // Nothing new to carry: the same object back (so the frame need not save).
  assert.equal(Alerts.inherit(d1, [b], NOW.getTime()), d1);
  // A fall keeps the bar it was dismissed at: rising back to it later stays dismissed.
  const low = Alerts.inherit(d1, [alert({ id: 'L', references: ['B'], severity: 'Moderate' })], NOW.getTime());
  assert.equal(low.L.sev, 3);
  assert.equal(Alerts.isDismissed(alert({ id: 'M', references: ['L'], severity: 'Severe' }), low), true);
  // A rise is not inherited.
  assert.equal(Alerts.inherit(d1, [alert({ id: 'D', references: ['B'], severity: 'Extreme' })], NOW.getTime()), d1);
});

test('prune drops dismissals older than a week', () => {
  const d = { old: { sev: 3, at: NOW.getTime() - 8 * 24 * 60 * MIN }, recent: { sev: 3, at: NOW.getTime() - MIN } };
  assert.deepEqual(Object.keys(Alerts.prune(d, NOW.getTime())), ['recent']);
});

// ------------------------------------------------------------ the takeover
test('the takeover: urgent, undismissed alerts ranked; Severe not at night; never on a phone', () => {
  const sev = alert({ id: 'S', event: 'Severe Thunderstorm Warning', severity: 'Severe', urgency: 'Immediate' });
  const ext = alert({ id: 'E', event: 'Tornado Warning', severity: 'Extreme', urgency: 'Immediate' });
  const watch = alert({ id: 'W', severity: 'Moderate', urgency: 'Immediate' });
  const ids = (list) => list.map((a) => a.id);
  assert.deepEqual(ids(Alerts.takeover([sev, watch, ext], { night: false, phone: false, dismissed: {} })), ['E', 'S']);
  assert.deepEqual(ids(Alerts.takeover([sev, watch, ext], { night: true, phone: false, dismissed: {} })), ['E']);
  assert.deepEqual(ids(Alerts.takeover([sev], { night: true, phone: false, dismissed: {} })), []);
  assert.deepEqual(ids(Alerts.takeover([sev, ext], { night: false, phone: true, dismissed: {} })), []);
  const d = Alerts.dismiss({}, [sev, ext], NOW.getTime());
  assert.deepEqual(ids(Alerts.takeover([sev, ext], { night: false, phone: false, dismissed: d })), []);
  // An update referencing a dismissed alert at the same severity stays away; a rise comes back.
  assert.deepEqual(ids(Alerts.takeover([alert({ id: 'S2', references: ['S'], severity: 'Severe', urgency: 'Immediate' })], { night: false, phone: false, dismissed: d })), []);
  assert.deepEqual(ids(Alerts.takeover([alert({ id: 'S3', references: ['S'], severity: 'Extreme', urgency: 'Immediate' })], { night: false, phone: false, dismissed: d })), ['S3']);
});

// ------------------------------------------------------------ Test controls presets
test('each preset makes alerts with the severity and urgency its name says', () => {
  const by = {};
  let seq = 1;
  Alerts.PRESETS.forEach((p) => { by[p.id] = Alerts.fake(p.id, NOW, seq); seq += by[p.id].length; });
  assert.deepEqual(Alerts.PRESETS.map((p) => p.id), ['minor', 'moderate', 'severe', 'extreme', 'two']);
  const kinds = (list) => list.map((a) => a.severity + '/' + a.urgency);
  assert.deepEqual(kinds(by.minor), ['Minor/Expected']);
  assert.deepEqual(kinds(by.moderate), ['Moderate/Expected']);
  assert.deepEqual(kinds(by.severe), ['Severe/Immediate']);
  assert.deepEqual(kinds(by.extreme), ['Extreme/Immediate']);
  assert.deepEqual(kinds(by.two), ['Severe/Immediate', 'Severe/Immediate']);
  const all = [].concat(by.minor, by.moderate, by.severe, by.extreme, by.two);
  assert.ok(all.every((a) => a.fake === true && /^test-/.test(a.id) && a.ends > NOW && a.onset <= NOW));
  assert.equal(new Set(all.map((a) => a.id)).size, all.length, 'numbered from seq');
  // Where each shows: minor only on the Weather page; moderate is notable; severe urgent by day only.
  assert.equal(Alerts.notable(by.minor[0]), false);
  assert.equal(Alerts.notable(by.moderate[0]) && !Alerts.urgent(by.moderate[0], false), true);
  assert.deepEqual([Alerts.urgent(by.severe[0], false), Alerts.urgent(by.severe[0], true)], [true, false]);
  assert.deepEqual([Alerts.urgent(by.extreme[0], false), Alerts.urgent(by.extreme[0], true)], [true, true]);
  assert.equal(Alerts.takeover(by.two, { night: false, phone: false, dismissed: {} }).length, 2);
});
