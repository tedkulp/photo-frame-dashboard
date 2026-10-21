// Entry point: `npm run server` locally, or the Docker image's command.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, ConfigError } from './config.js';
import { startServer } from './app.js';
import { openStore, DataDirError } from './store.js';

const distDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');

let config, store;
try {
  config = loadConfig();
  store = openStore(config.dataDir);
} catch (e) {
  if (!(e instanceof ConfigError) && !(e instanceof DataDirError)) throw e;
  console.error('Cannot start: ' + e.message);
  process.exit(1);
}

if (!existsSync(join(distDir, 'index.html'))) {
  console.warn(`No built dashboard at ${distDir}; run \`npm run build\`. Serving the API only.`);
}

const { server } = await startServer({
  config,
  store,
  distDir,
  // Only for testing against a fake Google.
  tokenUrl: process.env.GOOGLE_TOKEN_URL || undefined,
  apiBase: process.env.GOOGLE_CALENDAR_API_URL || undefined,
});
console.log(`Dashboard on http://0.0.0.0:${server.address().port}/ (data: ${config.dataDir}; calendar time zone: ${config.timeZone || 'from the Family calendar'}; weather: ${config.homeAssistant ? config.homeAssistant.weatherEntity : 'not configured'}; home controls: ${config.homeAssistant ? 'label "' + config.homeAssistant.label + '"' : 'not configured'}; photos: ${config.immich ? 'Immich album ' + config.immich.albumId : 'not configured'})`);

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => { store.close(); process.exit(0); }));
