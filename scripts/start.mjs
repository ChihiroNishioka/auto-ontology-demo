import { spawnSync, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = (cmd, args) => spawnSync(cmd, args, { cwd: root, stdio: 'inherit' });
if (!process.argv.includes('--no-build')) {
  const r = run('npx', ['vite', 'build', '--logLevel', 'warn']);
  if (r.status !== 0) process.exit(r.status ?? 1);
}
const child = spawn('npx', ['tsx', 'server/index.ts'], { cwd: root, stdio: 'inherit' });
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => child.kill(s));
child.on('exit', (c) => process.exit(c ?? 0));
