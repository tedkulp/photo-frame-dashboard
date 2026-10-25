import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../js/radar.js';

const { Radar } = globalThis;
const MIN = 60000;

// Frames every 10 minutes from 2:50 pm to 3:40 pm local, then nowcast to 4:30 pm.
const at = (h, m) => new Date(2026, 9, 25, h, m);
function body(over) {
  const frames = [];
  for (let i = 0; i < 11; i++) {
    const d = new Date(at(14, 50).getTime() + i * 10 * MIN);
    frames.push({ id: (i < 6 ? 'p' : 'n') + i, at: d.toISOString(), nowcast: i >= 6, url: '/api/radar/frames/' + i + '.png' });
  }
  return Object.assign({ configured: true, available: true, frames, latest: 5, stale: false, age: 0, map: [{ url: '/api/radar/map/8-1-2.png', left: -40, top: -12 }], size: 512, tile: 256 }, over);
}

test('parses the listing into Dates; not configured passes through; anything else throws', () => {
  assert.deepEqual(Radar.parse({ configured: false }), { configured: false });
  const r = Radar.parse(body());
  assert.equal(r.frames.length, 11);
  assert.ok(r.frames[0].at instanceof Date);
  assert.deepEqual([r.latest, r.size, r.tile, r.stale], [5, 512, 256, false]);
  assert.deepEqual(r.map, [{ url: '/api/radar/map/8-1-2.png', left: -40, top: -12 }]);
  for (const b of [null, {}, { configured: true }, body({ frames: 'x' }), body({ map: null })]) {
    assert.throws(() => Radar.parse(b), /Unexpected radar response/);
  }
  // A frame without a usable time is left out.
  assert.equal(Radar.parse(body({ frames: [{ id: 'p1', at: 'nope', nowcast: false, url: '/x.png' }], latest: 0 })).frames.length, 0);
});

test('every frame, past or nowcast, is labelled with its time', () => {
  const r = Radar.parse(body());
  assert.equal(Radar.label(r, 0), '2:50 pm');
  assert.equal(Radar.label(r, 5), '3:40 pm');
  assert.equal(Radar.label(r, 6), '3:50 pm');
  assert.equal(Radar.label(r, 8), '4:10 pm');
  const morning = Radar.parse(body({ frames: [{ id: 'p0', at: at(0, 5).toISOString(), nowcast: false, url: '/a.png' }], latest: 0 }));
  assert.equal(Radar.label(morning, 0), '12:05 am');
});

test('the note: nothing while the newest past frame is recent, its time once over 20 minutes old, unavailable without frames', () => {
  const r = Radar.parse(body());
  assert.equal(Radar.note(r, at(15, 45)), '');
  assert.equal(Radar.note(r, at(16, 0)), '');
  assert.equal(Radar.note(r, at(16, 1)), 'Radar from 3:40 pm');
  assert.equal(Radar.note(Radar.parse(body({ frames: [], latest: -1, available: false })), at(15, 45)), 'Radar unavailable');
  // Only nowcast frames: no past frame to go by.
  const nowcast = Radar.parse(body({ frames: body().frames.slice(6), latest: -1 }));
  assert.equal(Radar.note(nowcast, at(15, 45)), '');
});

test('the loop runs oldest to newest and pauses on the latest past frame and the last frame', () => {
  const r = Radar.parse(body());
  assert.equal(Radar.next(r, 0), 1);
  assert.equal(Radar.next(r, 10), 0);
  assert.equal(Radar.delay(r, 0), Radar.STEP);
  assert.equal(Radar.delay(r, 5), Radar.PAUSE);
  assert.equal(Radar.delay(r, 10), Radar.PAUSE);
  assert.ok(Radar.PAUSE > Radar.STEP);
  // The loop starts on the latest past frame (what's raining now).
  assert.equal(Radar.first(r), 5);
  assert.equal(Radar.first(Radar.parse(body({ frames: body().frames.slice(6), latest: -1 }))), 0);
});
