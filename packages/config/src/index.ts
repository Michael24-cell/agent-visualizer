import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';

const EnvironmentSchema = z.object({
  HARNESS_DATA_DIR: z.string().min(1).optional(),
  HARNESS_PORT: z.coerce.number().int().min(1024).max(65_535).default(4317),
  HARNESS_SESSION_TOKEN: z.string().min(32).optional(),
  // '1' seeds the demo project on startup. Off by default.
  HARNESS_DEMO_PROJECT: z.enum(['0', '1']).default('0'),
  // Folders that projects may attach must live under this path (default: home).
  HARNESS_FOLDER_ROOT: z.string().min(1).optional(),
  // How long simulated replies take to arrive, so panes show work in progress.
  HARNESS_REPLY_DELAY_MS: z.coerce
    .number()
    .int()
    .min(0)
    .max(30_000)
    .default(900),
  XDG_DATA_HOME: z.string().min(1).optional(),
  LOCALAPPDATA: z.string().min(1).optional(),
});

export interface AppConfig {
  readonly host: '127.0.0.1';
  readonly port: number;
  readonly dataDirectory: string;
  readonly databasePath: string;
  readonly sessionToken: string;
  readonly allowedOrigins: readonly string[];
  readonly demoProject: boolean;
  readonly folderRoot?: string | undefined;
  readonly replyDelayMs?: number | undefined;
}

function defaultDataDirectory(
  environment: z.infer<typeof EnvironmentSchema>,
): string {
  if (process.platform === 'darwin') {
    return join(
      homedir(),
      'Library',
      'Application Support',
      'Visual Agent Harness',
    );
  }

  if (process.platform === 'win32') {
    return join(environment.LOCALAPPDATA ?? homedir(), 'Visual Agent Harness');
  }

  return join(
    environment.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'),
    'visual-agent-harness',
  );
}

export function loadAppConfig(
  source: NodeJS.ProcessEnv = process.env,
): AppConfig {
  const environment = EnvironmentSchema.parse(source);
  const dataDirectory =
    environment.HARNESS_DATA_DIR ?? defaultDataDirectory(environment);

  if (!isAbsolute(dataDirectory)) {
    throw new Error('HARNESS_DATA_DIR must be an absolute path.');
  }

  mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });

  return {
    host: '127.0.0.1',
    port: environment.HARNESS_PORT,
    dataDirectory,
    databasePath: join(dataDirectory, 'harness.db'),
    sessionToken:
      environment.HARNESS_SESSION_TOKEN ?? randomBytes(32).toString('hex'),
    allowedOrigins: [
      'http://127.0.0.1:5173',
      'http://localhost:5173',
      `http://127.0.0.1:${environment.HARNESS_PORT}`,
    ],
    demoProject: environment.HARNESS_DEMO_PROJECT === '1',
    ...(environment.HARNESS_FOLDER_ROOT
      ? { folderRoot: environment.HARNESS_FOLDER_ROOT }
      : {}),
    replyDelayMs: environment.HARNESS_REPLY_DELAY_MS,
  };
}
