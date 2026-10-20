// `npm run dev:all`: the home server (restarted when server/ changes) and Vite together, with
// prefixed output. Ctrl+C stops both; if either exits, the other is stopped too.
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const procs = [
  ['server', ['--watch-path=server', 'server/main.js'], '\x1b[35m'],
  ['vite', [join(here, 'node_modules/vite/bin/vite.js')], '\x1b[36m'],
].map(([name, args, colour]) => {
  const child = spawn(process.execPath, args, { cwd: here, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  const tag = colour + name.padEnd(6) + '\x1b[0m | ';
  for (const stream of [child.stdout, child.stderr]) {
    let rest = '';
    stream.on('data', (d) => {
      const lines = (rest + d).split('\n');
      rest = lines.pop();
      for (const l of lines) process.stdout.write(tag + l + '\n');
    });
  }
  child.on('exit', (code, sig) => {
    process.stdout.write(tag + `exited (${sig || code})\n`);
    stop(code || 0);
  });
  return child;
});

let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const p of procs) if (p.exitCode === null) p.kill('SIGTERM');
  process.exitCode = code;
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => stop(0));
