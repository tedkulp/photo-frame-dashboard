// HTTP server: the built dashboard (dist), GET /api/calendar, POST /api/events,
// DELETE /api/events/:id, GET /api/weather, /api/chores, /api/home, GET /api/photos (+ the photo
// images) and GET /api/version from one origin. LAN-only, no auth. This file only composes:
// config → clients and features (createFeatures) → their route modules (routes/*.js) → the shared
// handler (http.js).
import { createServer } from 'node:http';
import { createHandler } from './http.js';
import { createGoogle } from './google.js';
import { createCalendar } from './calendar.js';
import { createHomeAssistant } from './homeassistant.js';
import { createWeather } from './weather.js';
import { createHome } from './home.js';
import { createChores, localDate } from './chores.js';
import { createImmich } from './immich.js';
import { createPhotos } from './photos.js';
import { calendarRoutes } from './routes/calendar.js';
import { weatherRoutes } from './routes/weather.js';
import { choresRoutes } from './routes/chores.js';
import { homeRoutes } from './routes/home.js';
import { photosRoutes } from './routes/photos.js';

// Each feature from config, or null when it isn't set up (the calendar and chores always are).
function createFeatures({ config, store, tokenUrl, apiBase, now, homeRetryMs, icsTimeoutMs, log }) {
  const google = createGoogle({ serviceAccount: config.serviceAccount, tokenUrl, apiBase, now });
  const calendar = createCalendar({ settings: config.settings, google, timeZone: config.timeZone, now, icsTimeoutMs, log });
  const ha = config.homeAssistant;
  const weather = ha ? createWeather({ ha: createHomeAssistant(ha), entity: ha.weatherEntity, now }) : null;
  const home = ha ? createHome({ url: ha.url, token: ha.token, label: ha.label, rooms: ha.rooms, people: config.settings.people, retryMs: homeRetryMs, now, log }) : null;
  // Chores must not depend on Google being up: until the Family zone has been read once, a failed
  // lookup falls back to this process's own zone for that request (not cached, so it retries).
  const choreZone = () => calendar.zone().catch((e) => {
    console.error(`chores: using the server's local time zone, could not read the Family calendar's: ${e.message}`);
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  });
  const im = config.immich;
  const photos = im ? createPhotos({ immich: createImmich(im), albumId: im.albumId, people: config.settings.people, now }) : null;
  const chores = createChores({ db: store.db, settings: config.settings, now, today: async () => localDate(now(), await choreZone()) });
  return { calendar, weather, chores, home, photos };
}

// config comes from loadConfig(), store from openStore() (required: chores live in it);
// tokenUrl/apiBase/now/homeRetryMs/icsTimeoutMs/log are overridable for tests.
export async function startServer({ config, store, distDir, tokenUrl, apiBase, now = Date.now, homeRetryMs, icsTimeoutMs, log = console }) {
  if (!store) throw new Error('startServer needs a store (openStore(dataDir)): chores live in it');
  const { calendar, weather, chores, home, photos } = createFeatures({ config, store, tokenUrl, apiBase, now, homeRetryMs, icsTimeoutMs, log });
  const routes = [calendarRoutes(calendar), weatherRoutes(weather), choresRoutes(chores), homeRoutes(home), photosRoutes(photos)];
  const server = createServer(createHandler({ routes, distDir }));
  await new Promise((ok, fail) => {
    server.once('error', (e) => { if (home) home.close(); fail(e); });
    server.listen(config.port, () => { server.off('error', fail); ok(); });
  });
  return {
    server,
    url: 'http://127.0.0.1:' + server.address().port,
    close: () => new Promise((ok) => { if (home) home.close(); server.closeAllConnections(); server.close(ok); }),
  };
}
