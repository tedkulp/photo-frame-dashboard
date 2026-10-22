// plainNotes: an event's description (Google's HTML, or an ICS file's plain text) → the plain
// text the event sheet shows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plainNotes } from '../calendar.js';

test('a Google-style HTML description becomes plain text with line breaks and bullets', () => {
  const html = 'Bring <b>cake</b> &amp; candles<br>Gate code&nbsp;1234<p>Parking:</p>' +
    '<ul><li>Lot A</li><li>Street, see <a href="https://example.com/map">the map</a></li></ul>';
  assert.equal(plainNotes(html), 'Bring cake & candles\nGate code 1234\nParking:\n• Lot A\n• Street, see the map');
});

test('entities are decoded once, after tags are dropped', () => {
  assert.equal(plainNotes('&lt;b&gt;not bold&lt;/b&gt; &quot;q&quot; &#39;s&#39; &#8211; &#x2014; &amp;amp;'),
    '<b>not bold</b> "q" \'s\' – — &amp;');
});

test('a plain multi-line description is unchanged', () => {
  const text = 'Line one\nLine two\n\nAfter a blank line, 3 < 4';
  assert.equal(plainNotes(text), text);
});

test('CRLF line breaks become LF', () => {
  assert.equal(plainNotes('a\r\nb'), 'a\nb');
});

test('runs of three or more line breaks collapse to two, and the result is trimmed', () => {
  assert.equal(plainNotes('<p>a</p><br><br><br><p>b</p>\n'), 'a\n\nb');
});

test('a description that is only tags and whitespace gives no notes', () => {
  assert.equal(plainNotes('<p><br></p>&nbsp; <div></div>'), '');
  assert.equal(plainNotes(''), '');
  assert.equal(plainNotes(undefined), '');
});
