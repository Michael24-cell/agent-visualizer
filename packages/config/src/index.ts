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
  // Agents run on Claude when a key is present. Only its presence is read;
  // the SDK subprocess inherits the variable itself. 'simulated' forces
  // the simulator even with a key set.
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  // 'auto' runs on Claude when a key is present, otherwise the simulator.
  // 'local' runs on an OpenAI-compatible endpoint such as Ollama.
  HARNESS_RUNTIME: z
    .enum(['auto', 'simulated', 'claude', 'live', 'local'])
    .default('auto'),
  HARNESS_LOCAL_BASE_URL: z.string().url().default('http://127.0.0.1:11434/v1'),
  HARNESS_LOCAL_API_KEY: z.string().min(1).optional(),
  HARNESS_LOCAL_MODEL: z.string().min(1).default('qwen2.5-coder:7b'),
  // 'full' adds edit_file (search/replace) for models that can use it.
  HARNESS_LOCAL_TOOLS: z.enum(['basic', 'full']).default('basic'),
  // Set by scripts/dev.mjs and scripts/start.mjs to the .env.local path so
  // the setup panel can save settings for next start.
  HARNESS_ENV_FILE: z.string().min(1).optional(),
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
  readonly runtime: RuntimeConfig;
  // Whether ANTHROPIC_API_KEY is set (the value is never copied here).
  readonly claudeKeyPresent: boolean;
  // Defaults for the OpenAI-compatible runtime even when not selected.
  readonly local: {
    readonly baseUrl: string;
    readonly apiKey?: string | undefined;
    readonly model: string;
    readonly tools: 'basic' | 'full';
  };
  // The file the setup panel writes for next start, when known.
  readonly envFile?: string | undefined;
}

export type RuntimeConfig =
  | { readonly kind: 'simulated' }
  | { readonly kind: 'claude' }
  | {
      readonly kind: 'openai';
      readonly baseUrl: string;
      readonly apiKey?: string | undefined;
      readonly model: string;
      readonly tools: 'basic' | 'full';
    };

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
    runtime: runtimeFrom(environment),
    claudeKeyPresent: Boolean(environment.ANTHROPIC_API_KEY),
    local: {
      baseUrl: environment.HARNESS_LOCAL_BASE_URL,
      apiKey: environment.HARNESS_LOCAL_API_KEY,
      model: environment.HARNESS_LOCAL_MODEL,
      tools: environment.HARNESS_LOCAL_TOOLS,
    },
    envFile: environment.HARNESS_ENV_FILE,
  };
}

function runtimeFrom(
  environment: z.infer<typeof EnvironmentSchema>,
): RuntimeConfig {
  switch (environment.HARNESS_RUNTIME) {
    case 'simulated':
      return { kind: 'simulated' };
    case 'claude':
    case 'live':
      return { kind: 'claude' };
    case 'local':
      return {
        kind: 'openai',
        baseUrl: environment.HARNESS_LOCAL_BASE_URL,
        apiKey: environment.HARNESS_LOCAL_API_KEY,
        model: environment.HARNESS_LOCAL_MODEL,
        tools: environment.HARNESS_LOCAL_TOOLS,
      };
    default:
      return environment.ANTHROPIC_API_KEY
        ? { kind: 'claude' }
        : { kind: 'simulated' };
  }
}
