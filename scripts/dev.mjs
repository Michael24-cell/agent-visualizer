import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';

const sessionToken = randomBytes(32).toString('hex');
const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const child = spawn(
  npmExecutable,
  [
    'exec',
    '--',
    'concurrently',
    '--kill-others-on-fail',
    '--names',
    'service,client',
    '--prefix-colors',
    'green,blue',
    'npm run dev -w @harness/service',
    'npm run dev -w @harness/client',
  ],
  {
    env: { ...process.env, HARNESS_SESSION_TOKEN: sessionToken },
    stdio: 'inherit',
  },
);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => child.kill(signal));
}

child.once('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exitCode = code ?? 1;
  }
});
