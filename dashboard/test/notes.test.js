// The feed-health notes across modules: every "offline" note says the home server is unreachable
// in the one wording, Feed.UNREACHABLE + ' · retrying'.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../js/feed.js';
import '../js/advice.js';
import '../js/weather.js';
import '../js/chores.js';
import '../js/house.js';
import '../js/alerts.js';

const { Feed, Weather, Chores, House, Alerts } = globalThis;

test('every offline note (calendar, weather, chores, House, alerts) has the one unreachable line', () => {
  const offline = { status: 'offline', failed: true, stale: false, age: 3, answered: false };
  const line = Feed.UNREACHABLE + ' · retrying';
  const notes = {
    calendar: Feed.calendarNote(offline, null, Date.now()),
    weather: Weather.note(offline, null, new Date()),
    chores: Chores.note(offline, null, Date.now()),
    house: House.note(offline, null, Date.now()),
    alerts: Alerts.note(offline, null, new Date()),
  };
  for (const [name, note] of Object.entries(notes)) assert.ok(note.includes(line), name + ': ' + note);
});
