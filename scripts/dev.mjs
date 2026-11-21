import { spawn } from 'node:child_process';

const procs = [
  spawn('npm', ['--prefix', 'server', 'run', 'dev'], { stdio: 'inherit', shell: true }),
  spawn('npm', ['--prefix', 'client', 'run', 'dev'], { stdio: 'inherit', shell: true }),
];

function shutdown() {
  for (const proc of procs) {
    if (!proc.killed) proc.kill('SIGTERM');
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
