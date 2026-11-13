import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppConfig } from '@harness/config';
import { createService } from './app.js';
import { cookieValue, readClientFile } from './static-client.js';

const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0))
    rmSync(folder, { recursive: true, force: true });
});

function temp(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix));
  folders.push(path);
  return path;
}

function client(): string {
  const directory = temp('harness-client-');
  mkdirSync(join(directory, 'assets'));
  writeFileSync(join(directory, 'index.html'), '<!doctype html><p>app</p>');
  writeFileSync(join(directory, 'assets', 'app.js'), 'console.log(1)');
  return directory;
}

const TOKEN = 'a'.repeat(64);

function config(clientDirectory?: string): AppConfig {
  const dataDirectory = temp('harness-data-');
  return {
    host: '127.0.0.1',
    port: 4317,
    dataDirectory,
    databasePath: join(dataDirectory, 'test.db'),
    sessionToken: TOKEN,
    allowedOrigins: ['http://127.0.0.1:4317'],
    allowedHosts: ['127.0.0.1:4317', 'localhost:4317'],
    demoProject: false,
    runtime: { kind: 'simulated' },
    claudeKeyPresent: false,
    local: {
      baseUrl: 'http://127.0.0.1:11434/v1',
      model: 'm',
      tools: 'basic',
    },
    ...(clientDirectory ? { clientDirectory } : {}),
  };
}

const HOST = { host: '127.0.0.1:4317' };

describe('readClientFile', () => {
  it('serves files, falls back to the page, and never leaves the folder', () => {
    const directory = client();
    writeFileSync(join(directory, '..', 'secret.txt'), 'no');
    expect(readClientFile(directory, '/assets/app.js')).toMatchObject({
      type: 'text/javascript; charset=utf-8',
      isPage: false,
    });
    // A screen's address, not a file: the page.
    expect(readClientFile(directory, '/project/abc')?.isPage).toBe(true);
    // A missing asset is missing, not the page pretending to be a script.
    expect(readClientFile(directory, '/assets/gone.js')).toBeUndefined();
    for (const escape of ['/../secret.txt', '/%2e%2e/secret.txt']) {
      const file = readClientFile(directory, escape);
      expect(file?.body.toString() ?? '').not.toBe('no');
    }
  });

  it('reads one cookie out of a header', () => {
    expect(
      cookieValue('a=1; harness_session=xyz; b=2', 'harness_session'),
    ).toBe('xyz');
    expect(cookieValue(undefined, 'harness_session')).toBeUndefined();
  });
});

describe('the served app', () => {
  it('hands the page a session cookie that the API then accepts', async () => {
    const service = createService(config(client()));
    const page = await service.inject({
      method: 'GET',
      url: '/',
      headers: HOST,
    });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('app');
    const cookie = String(page.headers['set-cookie']);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(page.headers['cache-control']).toBe('no-store');

    const asset = await service.inject({
      method: 'GET',
      url: '/assets/app.js',
      headers: HOST,
    });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers['set-cookie']).toBeUndefined();

    const withCookie = await service.inject({
      method: 'GET',
      url: '/api/projects',
      headers: { ...HOST, cookie: cookie.split(';')[0]! },
    });
    expect(withCookie.statusCode).toBe(200);
    await service.close();
  });

  it('still refuses the API without a session, a wrong one, or a foreign host', async () => {
    const service = createService(config(client()));
    const none = await service.inject({
      method: 'GET',
      url: '/api/projects',
      headers: HOST,
    });
    expect(none.statusCode).toBe(401);
    const wrong = await service.inject({
      method: 'GET',
      url: '/api/projects',
      headers: { ...HOST, cookie: `harness_session=${'b'.repeat(64)}` },
    });
    expect(wrong.statusCode).toBe(401);
    // DNS rebinding: the right address under someone else's name.
    const rebound = await service.inject({
      method: 'GET',
      url: '/',
      headers: { host: 'evil.example:4317' },
    });
    expect(rebound.statusCode).toBe(403);
    expect(rebound.headers['set-cookie']).toBeUndefined();
    // Writes are never served without a session, whatever the path.
    const post = await service.inject({
      method: 'POST',
      url: '/anything',
      headers: HOST,
    });
    expect(post.statusCode).toBe(401);
    await service.close();
  });

  it('is API-only when no client is attached', async () => {
    const service = createService(config());
    const page = await service.inject({
      method: 'GET',
      url: '/',
      headers: HOST,
    });
    expect(page.statusCode).toBe(401);
    await service.close();
  });
});
