// GET /api/alerts: the NWS's weather alerts for the home (alerts.js, ADR 0007). Without
// settings.homeAssistant.alerts, http.js notSetUp answers.
import { apiCall, notAllowed, notSetUp, sendJson } from '../http.js';

export function alertsRoutes(alerts) {
  return {
    match: (pathname) => pathname === '/api/alerts' || pathname.startsWith('/api/alerts/'),
    async handle(req, res, pathname) {
      if (!alerts) return notSetUp(req, res, pathname, '/api/alerts', 'Weather alerts are not set up');
      if (pathname !== '/api/alerts') return sendJson(res, 404, { error: 'Not found' });
      if (req.method !== 'GET') return notAllowed(res);
      return apiCall(res, 'alerts', 200, () => alerts.load());
    },
  };
}
