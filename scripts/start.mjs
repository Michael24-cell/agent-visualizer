import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { envLocalPath, loadEnvLocal } from './env-local.mjs';

// `npm start`: the whole app from one command. Builds once if needed,
// starts the service with the built client attached, and opens it.
loadEnvLocal();
process.env.HARNESS_ENV_FILE ??= envLocalPath();

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const clientDirectory = join(root, 'apps', 'client', 'dist');
const serviceEntry = join(root, 'apps', 'service', 'dist', 'index.js');
const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm';

if (
  !existsSync(join(clientDirectory, 'index.html')) ||
  !existsSync(serviceEntry)
) {
  console.log('First run: building the app (about a minute)…');
  const built = spawnSync(npmExecutable, ['run', 'build'], {
    cwd: root,
    stdio: 'inherit',
  });
  if (built.status !== 0) process.exit(built.status ?? 1);
}

const port = process.env.HARNESS_PORT ?? '4317';
const url = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, [serviceEntry], {
  cwd: root,
  env: { ...process.env, HARNESS_CLIENT_DIR: clientDirectory },
  stdio: 'inherit',
});

// Open the browser once the service answers; HARNESS_NO_OPEN=1 skips it.
async function openWhenReady() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) {
        console.log(`\nHarness is running at ${url}  (Ctrl+C to stop)\n`);
        if (process.env.HARNESS_NO_OPEN !== '1') {
          const opener =
            process.platform === 'darwin'
              ? ['open', [url]]
              : process.platform === 'win32'
                ? ['cmd', ['/c', 'start', '', url]]
                : ['xdg-open', [url]];
          spawn(opener[0], opener[1], { stdio: 'ignore', detached: true })
            .on('error', () => {})
            .unref();
        }
        return;
      }
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
void openWhenReady();

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => child.kill(signal));
}
child.once('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
