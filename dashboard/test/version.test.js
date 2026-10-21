import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../js/version.js';

const Version = globalThis.Version;

// A sessionStorage stand-in; `broken` makes every call throw like a locked-down WebView.
function storage(init, broken) {
  const m = Object.assign({}, init);
  return {
    m,
    getItem(k) { if (broken) throw new Error('denied'); return k in m ? m[k] : null; },
    setItem(k, v) { if (broken) throw new Error('denied'); m[k] = String(v); },
  };
}
function check(over) {
  const o = Object.assign({ page: 'a', server: 'b', storage: storage(), busy: () => false, reloads: 0 }, over);
  o.reload = () => { o.reloads++; };
  const did = Version.check(o);
  return { did, reloads: o.reloads, storage: o.storage };
}

test('parse takes the build id; anything else is not an answer', () => {
  assert.equal(Version.parse({ build: 'b1' }), 'b1');
  for (const bad of [null, {}, { build: null }, { build: '' }, { build: 3 }]) assert.throws(() => Version.parse(bad));
});

test('due: only a different, known server build not already tried', () => {
  assert.equal(Version.due('a', 'b', null), true);
  assert.equal(Version.due('a', 'a', null), false); // same build (a container restart)
  assert.equal(Version.due('a', '', null), false); // server has no id
  assert.equal(Version.due('a', null, null), false); // unreachable / 404: nothing heard
  assert.equal(Version.due('', 'b', null), false); // dev server: the page has no id
  assert.equal(Version.due('a', 'b', 'b'), false); // already reloaded for b once
  assert.equal(Version.due('a', 'c', 'b'), true); // a newer build after that
});

test('a mismatch reloads once idle and remembers the id first', () => {
  const r = check();
  assert.deepEqual([r.did, r.reloads], [true, 1]);
  assert.equal(r.storage.m[Version.KEY], 'b');
});

test('busy waits; the reload happens once it is not', () => {
  const s = storage();
  assert.equal(check({ storage: s, busy: () => true }).reloads, 0);
  assert.equal(s.m[Version.KEY], undefined);
  assert.equal(check({ storage: s }).reloads, 1);
});

test('no reload on a match, without a server id or for an id already tried', () => {
  assert.equal(check({ server: 'a' }).reloads, 0);
  assert.equal(check({ server: null }).reloads, 0);
  assert.equal(check({ storage: storage({ [Version.KEY]: 'b' }) }).reloads, 0);
  assert.equal(check({ storage: storage({ [Version.KEY]: 'b' }), server: 'c' }).reloads, 1);
});

test('without working storage it never reloads (it could not stop a loop)', () => {
  assert.equal(check({ storage: storage({}, true) }).reloads, 0);
  assert.equal(check({ storage: null }).reloads, 0);
});
