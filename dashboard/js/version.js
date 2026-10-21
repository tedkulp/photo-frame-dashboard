// Reload after a home server update: `npm run build` stamps a build id into the page
// (__BUILD_ID__, see vite.config.js) and into dist/version.json, which the home server reports at
// GET /api/version. App polls that on the calendar feed's loop and asks Version.check once a
// second; a different id reloads the page when nothing is open or pending. No id on either side
// (Vite dev server, Cloudflare, the kiosk's bundled site) or no answer: nothing happens.
(function (root) {
  'use strict';
  var Version = root.Version = {};
  Version.REFRESH = 60000;
  // sessionStorage: the server build last reloaded for, so a reload that didn't take never repeats.
  Version.KEY = 'homehq.reloadTried';
  // This page's build id ('' outside `npm run build`).
  Version.page = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : '';

  // GET /api/version's { build } → the id; throws when there isn't one (no stamped build).
  Version.parse = function (body) {
    if (!body || typeof body.build !== 'string' || !body.build) throw new Error('No build id');
    return body.build;
  };
  Version.changeKey = function (body) { return body.build; };

  // A reload is due: both ids known, different, and not already reloaded for this server build.
  Version.due = function (page, server, tried) {
    return !!page && !!server && server !== page && server !== tried;
  };

  // o: { page, server, storage, busy(), reload() }. Reloads (returning true) when due and not busy.
  // The id is written to storage, and read back, before reloading: storage that doesn't work could
  // never stop a loop, so then it never reloads.
  Version.check = function (o) {
    if (!o.page || !o.server || o.server === o.page) return false;
    var tried;
    try { tried = o.storage.getItem(Version.KEY); } catch (e) { return false; }
    if (!Version.due(o.page, o.server, tried) || o.busy()) return false;
    try {
      o.storage.setItem(Version.KEY, o.server);
      if (o.storage.getItem(Version.KEY) !== o.server) return false;
    } catch (e) { return false; }
    o.reload();
    return true;
  };
})(typeof window !== 'undefined' ? window : globalThis);
