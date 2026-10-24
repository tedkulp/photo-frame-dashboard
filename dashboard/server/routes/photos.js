// GET /api/photos and GET /api/photos/:id.jpg (an album photo's preview, streamed from Immich as it
// arrives). Without Immich, http.js notSetUp answers.
import { apiCall, sendImage, sendJson, notAllowed, notSetUp, HttpError } from '../http.js';

export function photosRoutes(photos) {
  return {
    match: (pathname) => pathname === '/api/photos' || pathname.startsWith('/api/photos/'),
    async handle(req, res, pathname) {
      if (!photos) return notSetUp(req, res, pathname, '/api/photos', 'Photos are not set up');
      if (req.method !== 'GET') return notAllowed(res);
      if (pathname === '/api/photos') return apiCall(res, 'photos', 200, () => photos.load());
      const m = pathname.match(/^\/api\/photos\/([0-9A-Za-z-]+)\.jpg$/);
      if (!m) return sendJson(res, 404, { error: 'No such photo' });
      // Only the content type and length are passed on. The browser may keep it for an hour (the
      // frame shows the same photos again and again); the server keeps nothing.
      return sendImage(res, 'photo', async () => {
        const upstream = await photos.image(m[1]);
        if (!upstream) throw new HttpError(404, 'No such photo');
        // fetch has already undone any content-encoding, so Immich's length only holds without one.
        const length = upstream.headers.get('content-encoding') ? null : upstream.headers.get('content-length');
        return { type: upstream.headers.get('content-type') || 'image/jpeg', length, body: upstream.body };
      }, 'private, max-age=3600');
    },
  };
}
