import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { envLocalPath, loadEnvLocal } from './env-local.mjs';

const loaded = loadEnvLocal();
process.env.HARNESS_ENV_FILE ??= envLocalPath();
if (loaded.length) console.log(`.env.local: ${loaded.join(', ')}`);

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
    // The demo project is opt-in for the service; dev turns it on so the
    // shell has a persisted project to open.
    env: {
      HARNESS_DEMO_PROJECT: '1',
      ...process.env,
      HARNESS_SESSION_TOKEN: sessionToken,
    },
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
