import { randomBytes } from 'node:crypto';
import { defineConfig } from 'vite';

// Every build gets its own id: the page carries it as __BUILD_ID__ and dist/version.json holds it
// for the home server's GET /api/version, so an open dashboard can tell a newer build is being
// served (js/version.js). The dev server has none, so it never reloads itself.
function buildId() {
  const id = Date.now().toString(36) + '-' + randomBytes(4).toString('hex');
  return {
    name: 'build-id',
    apply: 'build',
    config: () => ({ define: { __BUILD_ID__: JSON.stringify(id) } }),
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: id }) + '\n' });
    },
  };
}

// The wall tablet runs Android WebView 106 — keep JS output within Chromium 106.
// CSS targets chrome61 on purpose: the tablet's WebView rejects 4/8-digit hex colours (#0000,
// #ffffffbf) even though Chrome 106 should support them, and a newer target lets the minifier
// rewrite transparent/rgba() into that form. Verified on-device with CSS.supports().
export default defineConfig({
  plugins: [buildId()],
  build: {
    target: 'chrome106',
    cssTarget: 'chrome61',
  },
  // /api goes to the home server (`npm run server`, port 8080 unless PORT says otherwise).
  server: { host: true, proxy: { '/api': 'http://localhost:' + (process.env.PORT || 8080) } },
});
