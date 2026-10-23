// /api/home, /api/home/:entityId, /api/home/rooms/:name/off, /api/home/cameras/:entityId.jpg and
// /api/home/media/:entityId/art. Without Home Assistant: GET /api/home is 200 { configured: false },
// anything else 404. HA's images are never cached.
import { apiCall, readJson, sendImage, sendJson, notAllowed } from '../http.js';

const ENTITY = /^[a-z_]+\.[a-z0-9_]+$/;

export function homeRoutes(home) {
  return {
    match: (pathname) => pathname === '/api/home' || pathname.startsWith('/api/home/'),
    async handle(req, res, pathname) {
      if (!home) {
        if (pathname === '/api/home' && req.method === 'GET') return sendJson(res, 200, { configured: false });
        return sendJson(res, 404, { error: 'Home Assistant is not set up' });
      }
      const parts = pathname.split('/').slice(3);
      let seg;
      try {
        seg = parts.map(decodeURIComponent);
      } catch {
        return sendJson(res, 404, { error: 'Not found' });
      }
      const method = (m) => req.method === m;
      if (seg.length === 0) return method('GET') ? sendJson(res, 200, home.load()) : notAllowed(res);
      if (seg.length === 1 && ENTITY.test(seg[0])) {
        if (!method('POST')) return notAllowed(res);
        return apiCall(res, 'home action', 204, async () => home.act(seg[0], await readJson(req)));
      }
      if (seg.length === 3 && seg[0] === 'rooms' && seg[2] === 'off') {
        if (!method('POST')) return notAllowed(res);
        return apiCall(res, 'room off', 204, () => home.roomOff(seg[1]));
      }
      if (seg.length === 2 && seg[0] === 'cameras' && /\.jpg$/.test(seg[1]) && ENTITY.test(seg[1].slice(0, -4))) {
        if (!method('GET')) return notAllowed(res);
        return sendImage(res, 'camera', () => home.camera(seg[1].slice(0, -4)), 'no-store');
      }
      if (seg.length === 3 && seg[0] === 'media' && ENTITY.test(seg[1]) && seg[2] === 'art') {
        if (!method('GET')) return notAllowed(res);
        return sendImage(res, 'media art', () => home.mediaArt(seg[1]), 'no-store');
      }
      return sendJson(res, 404, { error: 'Not found' });
    },
  };
}
