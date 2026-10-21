import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../js/photos.js';

const { Photos } = globalThis;

const body = (photos) => ({ configured: true, photos, updatedAt: '2026-10-21T12:00:00.000Z' });
const photo = (over) => Object.assign({ id: 'a1', o: 'p', date: '2024-05-19', place: 'Toronto', tag: '2024-05-19', fav: true, from: 'alex' }, over);

// ------------------------------------------------------------ parse
test('parses the album; not-configured passes through', () => {
  assert.deepEqual(Photos.parse({ configured: false }), { configured: false });
  const d = Photos.parse(body([photo(), photo({ id: 'a2', o: 'l', place: '', fav: false, from: undefined })]));
  assert.deepEqual(d, {
    configured: true,
    photos: [
      { id: 'a1', o: 'p', date: '2024-05-19', place: 'Toronto', tag: '2024-05-19', fav: true, from: 'alex' },
      { id: 'a2', o: 'l', date: '2024-05-19', place: '', tag: '2024-05-19', fav: false },
    ],
  });
});

test('drops photos without an id or date, and rejects a body that is not photos', () => {
  const d = Photos.parse(body([photo({ id: '' }), photo({ date: 'May 19' }), null, photo({ id: 'ok', place: null, tag: null })]));
  assert.deepEqual(d.photos.map((p) => [p.id, p.place, p.tag]), [['ok', '', '2024-05-19']]);
  for (const b of [null, {}, { configured: true }, { configured: true, photos: 'x' }]) {
    assert.throws(() => Photos.parse(b), /Unexpected photos response/);
  }
});

test('only the album counts as a change, not updatedAt', () => {
  const b = body([photo()]);
  assert.equal(Photos.changeKey(b), Photos.changeKey(Object.assign({}, b, { updatedAt: 'later' })));
  assert.notEqual(Photos.changeKey(b), Photos.changeKey(body([photo({ fav: false })])));
});

// ------------------------------------------------------------ images
test('album photos load through the server; mock ones from the placeholder service', () => {
  const mock = (seed, w, h) => `mock/${seed}/${w}/${h}`;
  assert.equal(Photos.src({ id: 'a 1' }, 800, 1200, mock), '/api/photos/a%201.jpg');
  assert.equal(Photos.src({ seed: 'tofino' }, 800, 1200, mock), 'mock/tofino/800/1200');
});

// ------------------------------------------------------------ captions
const meta = (over) => Object.assign({ onThisDay: false, kicker: '2 years ago', place: 'Tofino, BC', from: { name: 'Alex' }, monthYear: 'May 2024' }, over);

test('captions list what the photo has', () => {
  assert.equal(Photos.kickerLine(meta()), '2 years ago · Tofino, BC · From Alex');
  assert.equal(Photos.kickerLine(meta({ onThisDay: true })), '<b>On this day</b> · 2 years ago · Tofino, BC · From Alex');
  assert.equal(Photos.polaroidLine(meta()), 'Tofino, BC, May 2024');
  assert.equal(Photos.tileCaption(meta({ onThisDay: true })), '<b>On this day · 2 years ago</b><span>Tofino, BC</span>');
});

test('no place or no uploader leaves no empty separator or name', () => {
  const m = meta({ place: '', from: null });
  assert.equal(Photos.kickerLine(m), '2 years ago');
  assert.equal(Photos.kickerLine(meta({ place: '' })), '2 years ago · From Alex');
  assert.equal(Photos.kickerLine(meta({ from: null })), '2 years ago · Tofino, BC');
  assert.equal(Photos.polaroidLine(m), 'May 2024');
  assert.equal(Photos.tileCaption(m), '<b>2 years ago</b>');
  assert.equal(Photos.kickerLine(meta({ place: undefined, from: null })), '2 years ago');
});

test('captions escape the place and name', () => {
  assert.equal(Photos.kickerLine(meta({ place: '<i>', from: { name: 'A&B' } })), '2 years ago · &lt;i&gt; · From A&amp;B');
  assert.equal(Photos.polaroidLine(meta({ place: '"x"' })), '&quot;x&quot;, May 2024');
});
