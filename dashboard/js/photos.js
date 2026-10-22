// Photos from the home server's GET /api/photos (one Immich album), the image URL for a photo
// (the server's proxy for album photos, a placeholder service for the mock ones) and the caption
// lines, which leave out what a photo doesn't have (no place, no uploader). The refresh loop is
// Feed.create's. Also loads in Node for dashboard/test/photos.test.js.
(function (root) {
  'use strict';
  var Photos = root.Photos = {};
  var MIN = 60000;
  Photos.REFRESH = 5 * MIN; // the server caches the album listing for as long
  Photos.STALE = 60 * MIN;

  // How long each slideshow shows a photo, in milliseconds. Change a number here and rebuild;
  // no view keeps its own.
  Photos.INTERVAL = {
    ambient: 60 * 1000, // ambient mode (the idle photo frame)
    today: 60 * 1000,   // Today's photo card
    photos: 30 * 1000   // the Photos page
  };

  var DATE = /^\d{4}-\d{2}-\d{2}$/;
  function str(v) { return typeof v === 'string' ? v : ''; }

  // The server's body → { configured: false } or { configured: true, photos: [{ id, o, date, place,
  // from?, tag, fav }] }. Throws on anything else; drops photos without an id or a date.
  Photos.parse = function (body) {
    if (body && body.configured === false) return { configured: false };
    if (!body || body.configured !== true || !Array.isArray(body.photos)) throw new Error('Unexpected photos response');
    return {
      configured: true,
      photos: body.photos.filter(function (p) {
        return p && typeof p.id === 'string' && p.id && DATE.test(p.date);
      }).map(function (p) {
        var out = { id: p.id, o: p.o === 'p' ? 'p' : 'l', date: p.date, place: str(p.place), tag: str(p.tag) || p.date, fav: p.fav === true };
        if (typeof p.from === 'string' && p.from) out.from = p.from;
        return out;
      })
    };
  };
  // Every load has a new updatedAt; only the album itself counts as a change.
  Photos.changeKey = function (body) {
    return JSON.stringify([body.configured, body.photos]);
  };

  // A photo's image URL. Album photos come through the server at the one preview size Immich makes;
  // mock ones from `mock(seed, w, h)` at w×h.
  Photos.src = function (p, w, h, mock) {
    return p.id ? '/api/photos/' + encodeURIComponent(p.id) + '.jpg' : mock(p.seed, w, h);
  };

  // Joins the parts that have text with `sep`: a missing place or name leaves no stray separator.
  function join(parts, sep) { return parts.filter(function (s) { return !!s; }).join(sep); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // Caption HTML from App.photoMeta's { onThisDay, kicker, place, from (a person or null), monthYear }:
  // the slideshow's kicker line, the polaroid's line and the Today tile's caption.
  Photos.kickerLine = function (m) {
    return join([m.onThisDay ? '<b>On this day</b>' : '', m.kicker, esc(m.place || ''), m.from ? 'From ' + esc(m.from.name) : ''], ' · ');
  };
  Photos.polaroidLine = function (m) {
    return join([esc(m.place || ''), m.monthYear], ', ');
  };
  Photos.tileCaption = function (m) {
    return '<b>' + join([m.onThisDay ? 'On this day' : '', m.kicker], ' · ') + '</b>' + (m.place ? '<span>' + esc(m.place) + '</span>' : '');
  };
})(typeof window !== 'undefined' ? window : globalThis);
