// GET /api/weather. Without Home Assistant, http.js notSetUp answers.
import { apiCall, notAllowed, notSetUp } from '../http.js';

export function weatherRoutes(weather) {
  return {
    match: (pathname) => pathname === '/api/weather',
    async handle(req, res, pathname) {
      if (!weather) return notSetUp(req, res, pathname, '/api/weather', 'Weather is not set up');
      if (req.method !== 'GET') return notAllowed(res);
      return apiCall(res, 'weather', 200, () => weather.load());
    },
  };
}
