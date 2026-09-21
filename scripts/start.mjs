import { spawn } from 'node:child_process';
import { envLocalPath, loadEnvLocal } from './env-local.mjs';

// `npm start` with .env.local applied, same as `npm run dev`.
loadEnvLocal();
process.env.HARNESS_ENV_FILE ??= envLocalPath();
const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const child = spawn(npmExecutable, ['run', 'start', '-w', '@harness/service'], {
  env: process.env,
  stdio: 'inherit',
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => child.kill(signal));
}
child.once('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
