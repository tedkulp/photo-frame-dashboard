// Minimal Immich REST client: an API key (x-api-key) and global fetch. The base URL is the
// configured one, so tests can point it at a local fake. Uses the album and metadata-search
// endpoints that Immich 1.x–3.x all answer (albumIds/page were deprecated in 3.2, not removed).

const TIMEOUT_MS = 15 * 1000;
const PAGE_SIZE = 1000; // Immich's maximum
const PAGES_MAX = 50;   // 50 000 assets: well past any album meant for a frame

export class ImmichError extends Error {}

async function readError(res) {
  const text = await res.text().catch(() => '');
  let msg = text;
  try {
    const j = JSON.parse(text);
    msg = j.message || j.error || text;
  } catch {}
  return String(Array.isArray(msg) ? msg.join(', ') : msg || res.statusText).slice(0, 200);
}

export function createImmich({ url, apiKey, pageSize = PAGE_SIZE }) {
  // The timeout covers reading the whole JSON answer, but only the headers of a stream, so a large
  // image arriving slowly isn't cut off (the server stops reading it if the frame goes away).
  async function request(path, init, stream) {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url + '/api' + path, Object.assign({}, init, {
        headers: Object.assign({ 'x-api-key': apiKey, accept: 'application/json' }, init && init.headers),
        signal: abort.signal,
      }));
      if (!res.ok) throw new ImmichError(`Immich ${path.split('?')[0]}: ${res.status} ${await readError(res)}`);
      return stream ? res : await res.json();
    } catch (e) {
      if (e instanceof ImmichError) throw e;
      throw new ImmichError(`Immich: ${abort.signal.aborted ? 'timed out' : e.message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  // The album (name, albumUsers with each user's id and email), without its asset list.
  function album(id) {
    return request('/albums/' + encodeURIComponent(id) + '?withoutAssets=true');
  }

  // Every asset in the album, with EXIF, one search page at a time.
  async function assets(albumId) {
    const out = [];
    let page = 1;
    for (let n = 0; n < PAGES_MAX && page; n++) {
      const body = await request('/search/metadata', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ albumIds: [albumId], withExif: true, size: pageSize, page }),
      });
      const a = body && body.assets;
      if (!a || !Array.isArray(a.items)) throw new ImmichError('Immich returned no assets for the album search');
      out.push(...a.items);
      page = a.nextPage ? Number(a.nextPage) : null;
    }
    return out;
  }

  // Every user's { id, email, name }: needs the key's user.read permission.
  function users() {
    return request('/users');
  }

  // The asset's preview-size image as a fetch Response (body not read yet, for streaming).
  function preview(id) {
    return request('/assets/' + encodeURIComponent(id) + '/thumbnail?size=preview', { headers: { accept: 'image/*' } }, true);
  }

  return { album, assets, users, preview };
}
