// HTTP server: the built dashboard (dist), GET /api/calendar, POST /api/events,
// DELETE /api/events/:id, GET /api/weather, GET /api/radar (+ its images), /api/chores, /api/home,
// GET /api/photos (+ the photo images) and GET /api/version from one origin. LAN-only, no auth. This file only composes:
// config → clients and features (createFeatures) → their route modules (routes/*.js) → the shared
// handler (http.js).
import { createServer } from 'node:http';
import { createHandler } from './http.js';
import { createGoogle } from './google.js';
import { createCalendar, familyZoneLookup } from './calendar.js';
import { createFrameZone } from './framezone.js';
import { createHomeAssistant } from './homeassistant.js';
import { createWeather } from './weather.js';
import { createRadar } from './radar.js';
import { createHome } from './home.js';
import { createChores } from './chores.js';
import { createImmich } from './immich.js';
import { createPhotos } from './photos.js';
import { calendarRoutes } from './routes/calendar.js';
import { weatherRoutes } from './routes/weather.js';
import { radarRoutes } from './routes/radar.js';
import { choresRoutes } from './routes/chores.js';
import { homeRoutes } from './routes/home.js';
import { photosRoutes } from './routes/photos.js';

// Each feature from config, or null when it isn't set up (the calendar and chores always are).
function createFeatures({ config, store, tokenUrl, apiBase, now, homeRetryMs, icsTimeoutMs, radarBase, tileBase, log }) {
  const google = createGoogle({ serviceAccount: config.serviceAccount, tokenUrl, apiBase, now });
  const frameZone = createFrameZone({ timeZone: config.timeZone, lookup: familyZoneLookup({ settings: config.settings, google, now }), now, log });
  const calendar = createCalendar({ settings: config.settings, google, frameZone, now, icsTimeoutMs, log });
  const ha = config.homeAssistant;
  const haClient = ha ? createHomeAssistant(ha) : null;
  const weather = ha ? createWeather({ ha: haClient, entity: ha.weatherEntity, now }) : null;
  const radar = ha && ha.radar ? createRadar({ ha: haClient, zoom: ha.radar.zoom, dataDir: config.dataDir, now, log, apiBase: radarBase, tileBase }) : null;
  const home = ha ? createHome({ url: ha.url, token: ha.token, label: ha.label, rooms: ha.rooms, people: config.settings.people, retryMs: homeRetryMs, now, log }) : null;
  const im = config.immich;
  const photos = im ? createPhotos({ immich: createImmich(im), albumId: im.albumId, people: config.settings.people, now }) : null;
  const chores = createChores({ db: store.db, settings: config.settings, now, today: frameZone.today });
  return { calendar, weather, radar, chores, home, photos };
}

// config comes from loadConfig(), store from openStore() (required: chores live in it);
// tokenUrl/apiBase/now/homeRetryMs/icsTimeoutMs/radarBase/tileBase/log are overridable for tests.
export async function startServer({ config, store, distDir, tokenUrl, apiBase, now = Date.now, homeRetryMs, icsTimeoutMs, radarBase, tileBase, log = console }) {
  if (!store) throw new Error('startServer needs a store (openStore(dataDir)): chores live in it');
  const { calendar, weather, radar, chores, home, photos } = createFeatures({ config, store, tokenUrl, apiBase, now, homeRetryMs, icsTimeoutMs, radarBase, tileBase, log });
  const routes = [calendarRoutes(calendar), weatherRoutes(weather), radarRoutes(radar), choresRoutes(chores), homeRoutes(home), photosRoutes(photos)];
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
