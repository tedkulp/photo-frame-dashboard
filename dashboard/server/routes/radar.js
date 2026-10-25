// GET /api/radar (the listing), GET /api/radar/frames/:id.png and GET /api/radar/map/:id.png, ids
// only from the listing (radar.js). Without settings.homeAssistant.radar, http.js notSetUp answers.
import { apiCall, sendImage, sendJson, notAllowed, notSetUp, HttpError } from '../http.js';

export function radarRoutes(radar) {
  return {
    match: (pathname) => pathname === '/api/radar' || pathname.startsWith('/api/radar/'),
    async handle(req, res, pathname) {
      if (!radar) return notSetUp(req, res, pathname, '/api/radar', 'Radar is not set up');
      if (req.method !== 'GET') return notAllowed(res);
      if (pathname === '/api/radar') return apiCall(res, 'radar', 200, () => radar.load());
      const m = pathname.match(/^\/api\/radar\/(frames|map)\/([0-9a-z-]+)\.png$/);
      if (!m) return sendJson(res, 404, { error: 'No such radar image' });
      // A frame id names one image for good (a nowcast id carries its frame list's generation) and a
      // map tile never changes, so the browser may keep both.
      return sendImage(res, 'radar', async () => {
        const body = m[1] === 'frames' ? radar.frame(m[2]) : await radar.tile(m[2]);
        if (!body) throw new HttpError(404, 'No such radar image');
        return { type: 'image/png', body };
      }, m[1] === 'frames' ? 'private, max-age=3600' : 'private, max-age=86400');
    },
  };
}
