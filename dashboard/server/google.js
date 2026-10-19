// Minimal Google Calendar client using a service account and only Node built-ins: node:crypto
// signs the OAuth JWT, global fetch does the HTTP. The token is cached until shortly before it
// expires. Base URLs are options so tests can point at a local fake.
import { createSign } from 'node:crypto';

export const SCOPE = 'https://www.googleapis.com/auth/calendar.events';
export const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const API_BASE = 'https://www.googleapis.com/calendar/v3';

const REFRESH_MARGIN_MS = 60 * 1000;
const TIMEOUT_MS = 15 * 1000;

export class GoogleError extends Error {}

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

async function readError(res) {
  const text = await res.text().catch(() => '');
  try {
    const j = JSON.parse(text);
    if (j.error && typeof j.error === 'object') return j.error.message || j.error.status || text;
    return j.error_description || j.error || text;
  } catch {
    return text.slice(0, 200);
  }
}

export function createGoogle({ serviceAccount, tokenUrl = TOKEN_URL, apiBase = API_BASE, now = Date.now }) {
  let cached = null; // { token, expiresAt }
  let pending = null;

  async function requestToken() {
    const iat = Math.floor(now() / 1000);
    const unsigned = b64url({ alg: 'RS256', typ: 'JWT' }) + '.' +
      b64url({ iss: serviceAccount.client_email, scope: SCOPE, aud: tokenUrl, iat, exp: iat + 3600 });
    const signature = createSign('RSA-SHA256').update(unsigned).sign(serviceAccount.private_key, 'base64url');
    let res;
    try {
      res = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: unsigned + '.' + signature }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      throw new GoogleError(`Google token request failed: ${e.message}`);
    }
    if (!res.ok) throw new GoogleError(`Google token request failed: ${res.status} ${await readError(res)}`);
    const body = await res.json();
    return { token: body.access_token, expiresAt: iat * 1000 + (body.expires_in || 3600) * 1000 };
  }

  async function accessToken() {
    if (cached && now() < cached.expiresAt - REFRESH_MARGIN_MS) return cached.token;
    if (!pending) {
      pending = requestToken().then(
        (t) => { cached = t; pending = null; return t; },
        (e) => { pending = null; throw e; },
      );
    }
    return (await pending).token;
  }

  // Every event (recurring ones expanded into instances) between timeMin and timeMax, following
  // pagination. Returns the calendar's own time zone along with the items.
  async function listEvents(calendarId, { timeMin, timeMax, timeZone }) {
    const items = [];
    let pageToken, calendarTimeZone;
    do {
      const q = new URLSearchParams({ singleEvents: 'true', orderBy: 'startTime', maxResults: '2500', timeMin, timeMax });
      if (timeZone) q.set('timeZone', timeZone);
      if (pageToken) q.set('pageToken', pageToken);
      const url = `${apiBase}/calendars/${encodeURIComponent(calendarId)}/events?${q}`;
      const token = await accessToken();
      let res;
      try {
        res = await fetch(url, { headers: { authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      } catch (e) {
        throw new GoogleError(`Google Calendar ${calendarId}: ${e.message}`);
      }
      if (!res.ok) throw new GoogleError(`Google Calendar ${calendarId}: ${res.status} ${await readError(res)}`);
      const body = await res.json();
      calendarTimeZone = calendarTimeZone || body.timeZone;
      items.push(...(body.items || []));
      pageToken = body.nextPageToken;
    } while (pageToken);
    return { timeZone: calendarTimeZone, items };
  }

  return { listEvents };
}
