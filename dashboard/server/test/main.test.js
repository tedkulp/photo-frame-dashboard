// Runs the real entry point as a child process.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { fakeGoogle, serviceAccount, settings, tempDir } from './helpers.js';

const MAIN = fileURLToPath(new URL('../main.js', import.meta.url));

async function freePort() {
  const s = createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}

function run(cwd, env) {
  const child = spawn(process.execPath, [MAIN], { cwd, env: Object.assign({ PATH: process.env.PATH }, env) });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const exited = new Promise((r) => child.on('exit', (code) => r(code)));
  return { child, exited, output: () => out };
}

test('exits at startup with a message naming what is missing', async () => {
  const t = tempDir({ 'config/settings.json': settings() });
  try {
    const p = run(t.dir, {});
    assert.equal(await p.exited, 1);
    assert.match(p.output(), /Cannot start: No service-account key found/);
  } finally { t.cleanup(); }
});

test('serves the API on PORT with config from env', async () => {
  const google = await fakeGoogle({
    'family@group.calendar.google.com': { pages: [[{ id: 'a', iCalUID: 'a@google.com', summary: 'A', start: { date: '2026-10-20' }, end: { date: '2026-10-21' } }]] },
    'alex@example.com': { pages: [[]] },
    'sam@example.com': { pages: [[]] },
  });
  const t = tempDir();
  const port = await freePort();
  const p = run(t.dir, {
    PORT: String(port),
    DASHBOARD_SETTINGS_JSON: JSON.stringify(settings()),
    GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify(serviceAccount()),
    GOOGLE_TOKEN_URL: google.tokenUrl,
    GOOGLE_CALENDAR_API_URL: google.apiBase,
  });
  try {
    await new Promise((ok, fail) => {
      p.child.stdout.on('data', () => { if (p.output().includes(':' + port + '/')) ok(); });
      p.exited.then(() => fail(new Error('exited: ' + p.output())));
    });
    const body = await (await fetch(`http://127.0.0.1:${port}/api/calendar`)).json();
    assert.deepEqual(body.events.map((e) => e.title), ['A']);
  } finally {
    p.child.kill('SIGTERM');
    await p.exited;
    await google.close();
    t.cleanup();
  }
});
