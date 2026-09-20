import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppConfig } from '@harness/config';
import { createService } from './app.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function testConfig(): AppConfig {
  const dataDirectory = mkdtempSync(join(tmpdir(), 'visual-agent-service-'));
  temporaryDirectories.push(dataDirectory);

  return {
    host: '127.0.0.1',
    port: 4317,
    dataDirectory,
    databasePath: join(dataDirectory, 'test.db'),
    sessionToken: 'a'.repeat(64),
    allowedOrigins: ['http://127.0.0.1:5173'],
    demoProject: false,
  };
}

describe('local service boundary', () => {
  it('requires the session token and rejects unknown browser origins', async () => {
    const config = testConfig();
    const service = createService(config);

    const missingToken = await service.inject({
      method: 'GET',
      url: '/api/health',
    });
    expect(missingToken.statusCode).toBe(401);

    const unknownOrigin = await service.inject({
      method: 'GET',
      url: '/api/health',
      headers: {
        origin: 'https://untrusted.example',
        'x-harness-session': config.sessionToken,
      },
    });
    expect(unknownOrigin.statusCode).toBe(403);

    const authorized = await service.inject({
      method: 'GET',
      url: '/api/foundation',
      headers: {
        origin: 'http://127.0.0.1:5173',
        'x-harness-session': config.sessionToken,
      },
    });
    expect(authorized.statusCode).toBe(200);
    expect(authorized.json()).toMatchObject({
      record: { id: 'increment-0' },
      migrationCount: 3,
    });

    await service.close();
  });

  it('executes and retrieves a persisted simulated run', async () => {
    const config = testConfig();
    const service = createService(config);
    const headers = {
      origin: 'http://127.0.0.1:5173',
      'x-harness-session': config.sessionToken,
    };

    const started = await service.inject({
      method: 'POST',
      url: '/api/simulated-runs',
      headers,
      payload: { scenario: 'disconnect-reconciliation' },
    });
    expect(started.statusCode).toBe(201);
    const projection = started.json<{
      runId: string;
      run: { state: string };
      runtimeConnection: string;
    }>();
    expect(projection).toMatchObject({
      run: { state: 'completed' },
      runtimeConnection: 'reconciled',
    });

    const retrieved = await service.inject({
      method: 'GET',
      url: `/api/runs/${projection.runId}`,
      headers,
    });
    expect(retrieved.statusCode).toBe(200);
    expect(retrieved.json()).toEqual(started.json());

    await service.close();
  });
});
