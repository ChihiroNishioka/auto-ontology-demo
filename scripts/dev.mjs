import { spawn } from 'node:child_process';

const procs = [
  spawn('npx', ['tsx', 'watch', 'server/index.ts'], { stdio: 'inherit' }),
  spawn('npx', ['vite', '--host', '127.0.0.1'], { stdio: 'inherit' }),
];
const stop = () => procs.forEach((p) => p.kill());
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, stop);
procs.forEach((p) => p.on('exit', stop));
