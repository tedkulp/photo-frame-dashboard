// GET /api/weather. Without Home Assistant: 200 { configured: false }.
import { apiCall, sendJson, notAllowed } from '../http.js';

export function weatherRoutes(weather) {
  return {
    match: (pathname) => pathname === '/api/weather',
    async handle(req, res) {
      if (req.method !== 'GET') return notAllowed(res);
      if (!weather) return sendJson(res, 200, { configured: false });
      return apiCall(res, 'weather', 200, () => weather.load());
    },
  };
}
