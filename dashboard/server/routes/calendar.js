// GET /api/calendar, POST /api/events and DELETE /api/events/:id. The calendar is always set up
// (config refuses to start without one).
import { apiCall, readJson, sendJson, notAllowed } from '../http.js';

export function calendarRoutes(calendar) {
  return {
    match: (pathname) => pathname === '/api/calendar' || pathname === '/api/events' || pathname.startsWith('/api/events/'),
    async handle(req, res, pathname) {
      if (pathname === '/api/calendar') {
        if (req.method !== 'GET') return notAllowed(res);
        return apiCall(res, 'calendar', 200, () => calendar.load());
      }
      if (pathname === '/api/events') {
        if (req.method !== 'POST') return notAllowed(res);
        return apiCall(res, 'add event', 201, async () => calendar.create(await readJson(req)));
      }
      if (req.method !== 'DELETE') return notAllowed(res);
      let id;
      try {
        id = decodeURIComponent(pathname.slice('/api/events/'.length));
      } catch {
        return sendJson(res, 404, { error: 'No such event' });
      }
      return apiCall(res, 'delete event', 204, () => calendar.remove(id));
    },
  };
}
