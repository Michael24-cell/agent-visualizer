import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppConfig } from '@harness/config';
import { ProjectListResponseSchema } from '@harness/contracts';
import { createService } from './app.js';

// The setup panel: read the runtime, switch it live, and save it for the
// next start without touching other lines of .env.local.

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function config(envFile?: string): AppConfig {
  const dataDirectory = mkdtempSync(join(tmpdir(), 'visual-agent-runtime-'));
  temporaryDirectories.push(dataDirectory);
  return {
    host: '127.0.0.1',
    port: 4317,
    dataDirectory,
    databasePath: join(dataDirectory, 'test.db'),
    sessionToken: 'a'.repeat(64),
    allowedOrigins: ['http://127.0.0.1:5173'],
    demoProject: false,
    runtime: { kind: 'simulated' },
    claudeKeyPresent: false,
    local: {
      baseUrl: 'http://127.0.0.1:11434/v1',
      model: 'qwen2.5-coder:7b',
      tools: 'basic',
    },
    envFile,
  };
}

describe('runtime settings', () => {
  it('reports the runtime, switches it live, and persists to .env.local', async () => {
    const root = mkdtempSync(join(tmpdir(), 'visual-agent-env-'));
    temporaryDirectories.push(root);
    const envFile = join(root, '.env.local');
    writeFileSync(envFile, '# keep me\nHARNESS_RUNTIME=simulated\nOTHER=1\n');
    const service = createService(config(envFile));
    const headers = {
      origin: 'http://127.0.0.1:5173',
      'x-harness-session': 'a'.repeat(64),
    };

    const before = (
      await service.inject({ method: 'GET', url: '/api/runtime', headers })
    ).json();
    expect(before).toMatchObject({
      kind: 'simulated',
      model: 'qwen2.5-coder:7b',
      keyPresent: false,
      claudeKeyPresent: false,
      envFile,
    });

    const switched = await service.inject({
      method: 'POST',
      url: '/api/runtime',
      headers,
      payload: {
        kind: 'openai',
        baseUrl: 'https://api.groq.com/openai/v1',
        model: 'openai/gpt-oss-120b',
        tools: 'full',
        apiKey: 'gsk_test',
      },
    });
    expect(switched.statusCode).toBe(200);
    expect(switched.json()).toMatchObject({
      kind: 'openai',
      model: 'openai/gpt-oss-120b',
      keyPresent: true,
    });
    expect(JSON.stringify(switched.json())).not.toContain('gsk_test');

    // The project list reports the live runtime at once.
    const list = ProjectListResponseSchema.parse(
      (
        await service.inject({ method: 'GET', url: '/api/projects', headers })
      ).json(),
    );
    expect(list.runtime).toEqual({
      mode: 'live',
      provider: 'openai',
      model: 'openai/gpt-oss-120b',
    });

    // Saved for next start; unrelated lines untouched.
    const saved = readFileSync(envFile, 'utf8');
    expect(saved).toContain('# keep me\n');
    expect(saved).toContain('OTHER=1\n');
    expect(saved).toContain('HARNESS_RUNTIME=local\n');
    expect(saved).toContain('HARNESS_LOCAL_MODEL=openai/gpt-oss-120b\n');
    expect(saved).toContain('HARNESS_LOCAL_API_KEY=gsk_test\n');
    expect(saved.match(/HARNESS_RUNTIME=/g)).toHaveLength(1);

    // An empty key keeps the current one; Claude needs its env key.
    const kept = await service.inject({
      method: 'POST',
      url: '/api/runtime',
      headers,
      payload: { kind: 'openai', apiKey: '' },
    });
    expect(kept.json()).toMatchObject({ keyPresent: true });
    const claude = await service.inject({
      method: 'POST',
      url: '/api/runtime',
      headers,
      payload: { kind: 'claude' },
    });
    expect(claude.statusCode).toBe(409);

    const back = await service.inject({
      method: 'POST',
      url: '/api/runtime',
      headers,
      payload: { kind: 'simulated' },
    });
    expect(back.json()).toMatchObject({ kind: 'simulated' });
    expect(readFileSync(envFile, 'utf8')).toContain(
      'HARNESS_RUNTIME=simulated\n',
    );
    await service.close();
  });
});
