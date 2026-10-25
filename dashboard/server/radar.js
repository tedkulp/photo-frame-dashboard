// The Weather page's radar (ADR 0006): LibreWXR's rain radar around Home Assistant's zone.home on an
// OpenStreetMap background, cached here and served only to the household. Nothing is fetched until
// the frame asks: the frame list at most once per FRAMES_MS, each past frame once (they never
// change), the nowcast frames again whenever the frame list does, and the map tiles once ever, into
// the data dir. The routes take only ids from the listing, never a URL, coordinates or zoom.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const FRAMES_MS = 10 * 60 * 1000;
const PAST_MS = 60 * 60 * 1000; // the last hour of past frames (~6)
const NOWCAST_MAX = 5;
const TIMEOUT_MS = 15 * 1000;
// One radar image: SIZE px square, centred on the home. Colour scheme 10 (Viper HD), smoothing on,
// the snow palette on.
export const SIZE = 512;
const COLOR = 10;
const OPTIONS = '1_1';
const TILE = 256;
// LibreWXR draws an image at zoom z on a world 512·2^z px across (measured: moving the centre by
// 128 px of a 256·2^z world moves the picture 256 px), which is OSM's 256 px tiles one zoom deeper.
const MAP_ZOOM_OFFSET = 1;
// OSM's tile policy asks for a User-Agent that names the app.
export const USER_AGENT = 'photo-frame-dashboard home server (+https://github.com/wesbos/photo-frame-dashboard)';

const isNum = (v) => typeof v === 'number' && isFinite(v);

// Web Mercator: a point's pixel in the world at zoom z, which is 256·2^z px square.
export function project(lat, lon, z) {
  const world = TILE * Math.pow(2, z);
  const s = Math.sin(lat * Math.PI / 180);
  return { x: (lon + 180) / 360 * world, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * world };
}

// The OSM tiles covering the size×size window centred on lat/lon at zoom z (the radar image's window
// at LibreWXR zoom z - MAP_ZOOM_OFFSET), each { id, z, x, y, left, top } with its offset in the
// window (whole px). x wraps round the date line; rows above or below the world are left out.
export function mapTiles(lat, lon, z, size = SIZE) {
  const n = Math.pow(2, z), p = project(lat, lon, z);
  const left = Math.round(p.x - size / 2), top = Math.round(p.y - size / 2);
  const out = [];
  for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + size - 1) / TILE); ty++) {
    if (ty < 0 || ty >= n) continue;
    for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + size - 1) / TILE); tx++) {
      const x = ((tx % n) + n) % n;
      out.push({ id: z + '-' + x + '-' + ty, z, x, y: ty, left: tx * TILE - left, top: ty * TILE - top });
    }
  }
  return out;
}

async function get(url, what) {
  let res;
  try {
    res = await fetch(url, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    throw new Error(`${what}: ${e.message}`);
  }
  if (!res.ok) throw new Error(`${what}: ${res.status} ${res.statusText}`);
  return res;
}

const frameList = (list) => (Array.isArray(list) ? list.filter((f) => f && isNum(f.time) && typeof f.path === 'string' && /^\/[\w/.-]*$/.test(f.path)) : []);

// ha: the Home Assistant REST client (its home() gives zone.home's { lat, lon } or null).
export function createRadar({ ha, zoom, dataDir, now = Date.now, log = console, apiBase = 'https://api.librewxr.net', tileBase = 'https://tile.openstreetmap.org', framesMs = FRAMES_MS }) {
  const tileDir = join(dataDir, 'radar-map');
  let place = null; // { lat, lon } to 5 decimals, the one the frames and tiles are for
  let warned = false; // the no-coordinates warning is logged once
  let frames = []; // the current frames, oldest first: { id, time, nowcast, image }
  let goodAt = null; // when the frame list was last read
  let failed = false; // the last try at LibreWXR failed
  let triedAt = null;
  let loading = null;
  const tileLoads = new Map();

  // zone.home's coordinates, or null when Home Assistant has none (warned once). While Home
  // Assistant can't be read, the last place known stands.
  async function locate() {
    let loc;
    try {
      loc = await ha.home();
    } catch (e) {
      if (!place) log.error('[radar]', e.message);
      return place;
    }
    if (!loc) {
      if (!warned) log.warn('[radar] zone.home has no latitude/longitude in Home Assistant, so there is no radar');
      warned = true;
      return null;
    }
    warned = false;
    return { lat: Number(loc.lat.toFixed(5)), lon: Number(loc.lon.toFixed(5)) };
  }

  function frameUrl(path) {
    return `${apiBase}${path}/${SIZE}/${zoom}/${place.lat.toFixed(5)}/${place.lon.toFixed(5)}/${COLOR}/${OPTIONS}.png`;
  }

  async function refresh() {
    triedAt = now();
    const loc = await locate();
    if (!loc || !place || loc.lat !== place.lat || loc.lon !== place.lon) {
      frames = []; // a new place (or none): nothing cached is of it
      goodAt = null;
    }
    place = loc;
    if (!place) return;
    let maps;
    try {
      maps = await (await get(apiBase + '/public/weather-maps.json', 'LibreWXR frame list')).json();
      if (!maps || !maps.radar || !Array.isArray(maps.radar.past)) throw new Error('LibreWXR frame list has no radar.past');
    } catch (e) {
      log.error('[radar]', e.message);
      failed = true;
      return;
    }
    const past = frameList(maps.radar.past).sort((a, b) => a.time - b.time);
    const newest = past.length ? past[past.length - 1].time : 0;
    // Nowcast images are redrawn with each frame list, so their ids carry its generation.
    const gen = isNum(maps.generated) ? maps.generated : Math.floor(now() / 1000);
    const wanted = past.filter((f) => f.time > newest - PAST_MS / 1000).map((f) => ({ id: 'p' + f.time, time: f.time, nowcast: false, path: f.path }))
      .concat(frameList(maps.radar.nowcast).sort((a, b) => a.time - b.time).slice(0, NOWCAST_MAX)
        .map((f) => ({ id: 'n' + f.time + '-' + gen, time: f.time, nowcast: true, path: f.path })));
    const have = new Map(frames.map((f) => [f.id, f]));
    let missed = false;
    const next = await Promise.all(wanted.map(async (f) => {
      if (have.has(f.id)) return have.get(f.id);
      try {
        const image = Buffer.from(await (await get(frameUrl(f.path), 'LibreWXR frame')).arrayBuffer());
        return { id: f.id, time: f.time, nowcast: f.nowcast, image };
      } catch (e) {
        log.error('[radar]', e.message);
        missed = true;
        return null;
      }
    }));
    const got = next.filter(Boolean);
    if (!got.length && frames.length) { failed = true; return; } // keep the last good frames
    frames = got; // frames that fell out of the window go here
    goodAt = now();
    failed = missed;
  }

  // Asks LibreWXR again once FRAMES_MS has passed since the last try; one try at a time.
  function update() {
    if (!loading && (triedAt == null || now() - triedAt >= framesMs)) loading = refresh().finally(() => { loading = null; });
    return loading || Promise.resolve();
  }

  // The listing: { configured, available, frames: [{ id, at, nowcast, url }] oldest first, latest
  // (the index of the newest past frame, -1 without one), stale (the last try failed), age (whole
  // minutes since the frame list was read, null if never), map: [{ url, left, top }] (TILE px tiles
  // in the SIZE px window), size, tile }.
  async function load() {
    await update();
    let latest = -1;
    frames.forEach((f, i) => { if (!f.nowcast) latest = i; });
    return {
      configured: true,
      available: frames.length > 0,
      frames: frames.map((f) => ({ id: f.id, at: new Date(f.time * 1000).toISOString(), nowcast: f.nowcast, url: '/api/radar/frames/' + f.id + '.png' })),
      latest,
      stale: failed,
      age: goodAt == null ? null : Math.floor((now() - goodAt) / 60000),
      map: place ? mapTiles(place.lat, place.lon, zoom + MAP_ZOOM_OFFSET).map((t) => ({ url: '/api/radar/map/' + t.id + '.png', left: t.left, top: t.top })) : [],
      size: SIZE,
      tile: TILE,
    };
  }

  // A current frame's PNG, or null for any other id.
  function frame(id) {
    const f = frames.find((x) => x.id === id);
    return f ? f.image : null;
  }

  // A map tile of the current place's window as a PNG, from the data dir, else fetched from OSM once
  // and kept there; null for any other id.
  function tile(id) {
    const t = place && mapTiles(place.lat, place.lon, zoom + MAP_ZOOM_OFFSET).find((x) => x.id === id);
    if (!t) return Promise.resolve(null);
    if (!tileLoads.has(id)) {
      const file = join(tileDir, id + '.png');
      const p = readFile(file).catch(async () => {
        const body = Buffer.from(await (await get(`${tileBase}/${t.z}/${t.x}/${t.y}.png`, 'OpenStreetMap tile')).arrayBuffer());
        await mkdir(tileDir, { recursive: true });
        await writeFile(file + '.part', body);
        await rename(file + '.part', file);
        return body;
      });
      // Kept only while it's loading; afterwards it's read from the file.
      tileLoads.set(id, p.finally(() => tileLoads.delete(id)));
    }
    return tileLoads.get(id);
  }

  return { load, frame, tile };
}
