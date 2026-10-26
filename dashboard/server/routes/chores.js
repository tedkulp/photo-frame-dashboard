// /api/chores, /api/chores/:id and /api/chores/:id/done. Always set up (the server needs a store).
// GET /api/chores and the done routes take an optional ?date=YYYY-MM-DD (today without one).
import { apiCall, readJson, sendJson, notAllowed } from '../http.js';

export function choresRoutes(chores) {
  return {
    match: (pathname) => pathname === '/api/chores' || pathname.startsWith('/api/chores/'),
    async handle(req, res, pathname) {
      const m = pathname.match(/^\/api\/chores(?:\/([^/]+)(\/done)?)?$/);
      if (!m) return sendJson(res, 404, { error: 'Not found' });
      const [, id, done] = m;
      const allow = (...methods) => methods.includes(req.method);
      const query = new URL(req.url, 'http://localhost').searchParams;
      const date = query.has('date') ? query.get('date') : undefined;
      if (!id) {
        if (allow('GET')) return apiCall(res, 'chores', 200, () => chores.load(date));
        if (allow('POST')) return apiCall(res, 'add chore', 201, async () => chores.create(await readJson(req)));
      } else if (!done) {
        if (allow('PATCH')) return apiCall(res, 'edit chore', 200, async () => chores.update(id, await readJson(req)));
        if (allow('DELETE')) return apiCall(res, 'delete chore', 204, () => chores.remove(id));
      } else {
        if (allow('PUT')) return apiCall(res, 'tick chore', 204, () => chores.setDone(id, true, date));
        if (allow('DELETE')) return apiCall(res, 'untick chore', 204, () => chores.setDone(id, false, date));
      }
      return notAllowed(res);
    },
  };
}
