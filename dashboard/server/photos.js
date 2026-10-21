// The dashboard's photos from one Immich album: each image asset becomes
// { id, o, date, place, from?, tag, fav } (see mapAsset). Videos are skipped. The listing is
// cached for a few minutes; the preview images are streamed through from Immich on request and
// only for assets in the current listing, so the API key never reaches the page and nothing is
// stored on disk.

export const CACHE_MS = 5 * 60 * 1000;

// EXIF orientations 5–8 turn the picture a quarter turn, so its width and height swap.
const QUARTER_TURN = new Set([5, 6, 7, 8]);

const DATE = /^(\d{4}-\d{2}-\d{2})/;
const text = (v) => (typeof v === 'string' ? v.trim() : '');
const size = (v) => (typeof v === 'number' && v > 0 ? v : 0);

// 'p' when the picture is taller than wide once EXIF orientation is applied, else 'l'. Immich's
// EXIF width/height are the stored pixels; the asset's own width/height (newer servers) are used
// as they are when EXIF has none.
export function orientation(asset) {
  const exif = asset.exifInfo || {};
  let w = size(exif.exifImageWidth), h = size(exif.exifImageHeight);
  if (w && h) {
    if (QUARTER_TURN.has(Number(exif.orientation))) [w, h] = [h, w];
  } else {
    w = size(asset.width);
    h = size(asset.height);
  }
  return h > w ? 'p' : 'l';
}

// The local date taken (YYYY-MM-DD): Immich's localDateTime is the camera's wall-clock time
// written as if it were UTC, so its date part is the date on the camera. Then EXIF, then the file.
function dateTaken(asset) {
  for (const v of [asset.localDateTime, asset.exifInfo && asset.exifInfo.dateTimeOriginal, asset.fileCreatedAt]) {
    const m = typeof v === 'string' && DATE.exec(v);
    if (m) return m[1];
  }
  return null;
}

// One asset → the dashboard's photo, or null for anything that isn't a dated image. `owners` maps
// an Immich user id to a person id.
export function mapAsset(asset, owners) {
  if (!asset || typeof asset.id !== 'string' || asset.type !== 'IMAGE' || asset.isTrashed) return null;
  const date = dateTaken(asset);
  if (!date) return null;
  const exif = asset.exifInfo || {};
  const photo = { id: asset.id, o: orientation(asset), date, place: text(exif.city) || text(exif.state) || text(exif.country), tag: date, fav: asset.isFavorite === true };
  const from = owners.get(asset.ownerId);
  if (from) photo.from = from;
  return photo;
}

// Immich user id → person id, through the users' emails: the album's users (owner first), any
// owner Immich included on an asset and `users` (Immich's user list, when it could be read),
// matched to people[].immich ignoring case.
export function ownerMap(album, assets, people, users) {
  const byEmail = new Map(people.filter((p) => p.immich).map((p) => [p.immich.toLowerCase(), p.id]));
  const out = new Map();
  const add = (user) => {
    const email = user && typeof user.email === 'string' && user.email.toLowerCase();
    if (email && byEmail.has(email) && typeof user.id === 'string') out.set(user.id, byEmail.get(email));
  };
  if (album && album.owner) add(album.owner); // Immich before 3.0
  for (const u of (album && album.albumUsers) || []) add(u && u.user);
  for (const a of assets) add(a && a.owner);
  for (const u of users || []) add(u);
  return out;
}

export function createPhotos({ immich, albumId, people, now = Date.now, cacheMs = CACHE_MS }) {
  let cached = null; // { at, photos, ids, updatedAt }
  let lastGood = null; // the last listing read, kept for the image allowlist while Immich fails
  let loading = null;

  async function fetchListing() {
    const [album, assets] = await Promise.all([immich.album(albumId), immich.assets(albumId)]);
    let owners = ownerMap(album, assets, people);
    // An uploader who isn't one of the album's users (an Immich admin adding to it, say) is looked up
    // in Immich's user list, if the key may read it; otherwise they get no credit.
    if (assets.some((a) => a && a.type === 'IMAGE' && !owners.has(a.ownerId)) && people.some((p) => p.immich)) {
      const users = await immich.users().catch(() => null);
      if (Array.isArray(users)) owners = ownerMap(album, assets, people, users);
    }
    const photos = assets.map((a) => mapAsset(a, owners)).filter(Boolean);
    const t = now();
    return { at: t, photos, ids: new Set(photos.map((p) => p.id)), updatedAt: new Date(t).toISOString() };
  }

  // The album listing, from the cache while it is fresh. One fetch at a time; a failure is not
  // cached, so the next request tries Immich again.
  function listing() {
    if (cached && now() - cached.at < cacheMs) return Promise.resolve(cached);
    if (!loading) {
      loading = fetchListing().then((l) => { cached = lastGood = l; return l; }).finally(() => { loading = null; });
    }
    return loading;
  }

  async function load() {
    const l = await listing();
    return { configured: true, photos: l.photos, updatedAt: l.updatedAt };
  }

  // The preview image of an asset in the album as a fetch Response, or null for any other id. While
  // the listing can't be read, the last one read decides, so the frame's photos keep loading if only
  // the album search is failing.
  async function image(id) {
    const l = await listing().catch((e) => { if (lastGood) return lastGood; throw e; });
    return l.ids.has(id) ? immich.preview(id) : null;
  }

  return { load, image };
}
