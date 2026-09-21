import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppConfig } from '@harness/config';
import type { LightMyRequestResponse } from 'fastify';
import {
  CommandResponseSchema,
  FolderListingSchema,
  ProjectResponseSchema,
} from '@harness/contracts';
import { createService } from './app.js';
import { FolderError, inspectFolder, listFolders } from './folders.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

// A fake home directory: two repos (one on a branch), a plain folder, a
// hidden folder, and a file.
function fakeHome(): string {
  const root = mkdtempSync(join(tmpdir(), 'visual-agent-folders-'));
  temporaryDirectories.push(root);
  mkdirSync(join(root, 'wevolv', '.git'), { recursive: true });
  writeFileSync(
    join(root, 'wevolv', '.git', 'HEAD'),
    'ref: refs/heads/feature/exports\n',
  );
  mkdirSync(join(root, 'day-01', '.git'), { recursive: true });
  writeFileSync(
    join(root, 'day-01', '.git', 'HEAD'),
    '3f2a9c1d4e5b6a7c8d9e0f1a2b3c4d5e6f7a8b9c\n',
  );
  mkdirSync(join(root, 'notes'));
  mkdirSync(join(root, '.hidden'));
  writeFileSync(join(root, 'README.md'), 'not a folder');
  return root;
}

let counter = 1300;
function commandId(): string {
  counter += 1;
  return `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
}

describe('folders', () => {
  it('lists repositories first, skips hidden folders and files, and stays inside the root', () => {
    const root = fakeHome();
    const listing = listFolders(undefined, { root });
    expect(listing.path).toBe(root);
    expect(listing.parent).toBeUndefined();
    expect(listing.entries.map((e) => [e.name, e.isRepository])).toEqual([
      ['day-01', true],
      ['wevolv', true],
      ['notes', false],
    ]);
    const nested = listFolders(join(root, 'wevolv'), { root });
    expect(nested.parent).toBe(root);
    expect(() => listFolders(join(root, '..'), { root })).toThrowError(
      FolderError,
    );
    expect(() => listFolders('/', { root })).toThrowError(
      expect.objectContaining({ code: 'folder_not_allowed' }),
    );
    expect(() => listFolders(join(root, 'nope'), { root })).toThrowError(
      expect.objectContaining({ code: 'folder_not_found' }),
    );
  });

  it('inspects a folder: name, branch from .git/HEAD, detached heads, and rejections', () => {
    const root = fakeHome();
    expect(
      inspectFolder(join(root, 'wevolv'), { root }, '2026-03-01T00:00:00.000Z'),
    ).toEqual({
      path: join(root, 'wevolv'),
      name: 'wevolv',
      branch: 'feature/exports',
      attachedAt: '2026-03-01T00:00:00.000Z',
    });
    expect(inspectFolder(join(root, 'day-01'), { root }).branch).toBe(
      '3f2a9c1d4e5b',
    );
    expect(inspectFolder(join(root, 'notes'), { root }).branch).toBeUndefined();
    expect(() => inspectFolder('relative/path', { root })).toThrowError(
      expect.objectContaining({ code: 'folder_not_found' }),
    );
    expect(() => inspectFolder(join(root, 'README.md'), { root })).toThrowError(
      expect.objectContaining({ code: 'folder_not_found' }),
    );
    expect(() => inspectFolder('/tmp', { root })).toThrowError(
      expect.objectContaining({ code: 'folder_not_allowed' }),
    );
  });
});

describe('attaching a repository to a project', () => {
  function config(root: string): AppConfig {
    const dataDirectory = mkdtempSync(join(tmpdir(), 'visual-agent-attach-'));
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
      folderRoot: root,
    };
  }

  it('attaches at creation or later, records the event, and refuses bad folders', async () => {
    const root = fakeHome();
    const service = createService(config(root));
    const headers = {
      origin: 'http://127.0.0.1:5173',
      'x-harness-session': 'a'.repeat(64),
    };
    const post = (
      url: string,
      payload: object,
    ): Promise<LightMyRequestResponse> =>
      service.inject({ method: 'POST', url, headers, payload });
    const get = (url: string): Promise<LightMyRequestResponse> =>
      service.inject({ method: 'GET', url, headers });

    // Picker listing through the API.
    const listing = FolderListingSchema.parse(
      (await get('/api/folders')).json(),
    );
    expect(listing.entries.map((e) => e.name)).toEqual([
      'day-01',
      'wevolv',
      'notes',
    ]);
    expect((await get('/api/folders?path=/etc')).statusCode).toBe(403);

    // At creation.
    const created = CommandResponseSchema.parse(
      (
        await post('/api/projects', {
          commandId: commandId(),
          name: 'Exports',
          repositoryPath: join(root, 'wevolv'),
        })
      ).json(),
    );
    expect(created.project.projection.project.repository).toMatchObject({
      name: 'wevolv',
      branch: 'feature/exports',
    });

    // A bad folder at creation writes nothing.
    const bad = await post('/api/projects', {
      commandId: commandId(),
      name: 'Nope',
      repositoryPath: join(root, 'missing'),
    });
    expect(bad.statusCode).toBe(404);
    expect(bad.json().code).toBe('folder_not_found');
    expect((await get('/api/projects')).json().projects).toHaveLength(1);

    // Later, on a project without one.
    const plain = CommandResponseSchema.parse(
      (
        await post('/api/projects', { commandId: commandId(), name: 'Plain' })
      ).json(),
    );
    const projectId = plain.project.projection.projectId;
    expect(plain.project.projection.project.repository).toBeUndefined();
    const outside = await post(`/api/projects/${projectId}/repository`, {
      commandId: commandId(),
      expectedSequence: plain.project.projection.lastSequence,
      path: '/tmp',
    });
    expect(outside.statusCode).toBe(403);
    const attached = CommandResponseSchema.parse(
      (
        await post(`/api/projects/${projectId}/repository`, {
          commandId: commandId(),
          expectedSequence: plain.project.projection.lastSequence,
          path: join(root, 'day-01'),
        })
      ).json(),
    );
    expect(attached.project.projection.project.repository).toMatchObject({
      name: 'day-01',
      branch: '3f2a9c1d4e5b',
    });
    // The coordinator says so, and the event is on the stream.
    const events = (await get(`/api/projects/${projectId}/events`)).json();
    expect(events.events.map((e: { type: string }) => e.type)).toContain(
      'project.repository_attached',
    );
    const after = ProjectResponseSchema.parse(
      (await get(`/api/projects/${projectId}`)).json(),
    );
    expect(after.projection.project.repository?.name).toBe('day-01');
    await service.close();
  });

  it('reads files from the attached folder and nothing outside it', async () => {
    const root = fakeHome();
    writeFileSync(join(root, 'wevolv', 'README.md'), '# Wevolv\n');
    mkdirSync(join(root, 'wevolv', 'src'));
    writeFileSync(join(root, 'wevolv', 'src', 'a.ts'), 'export const a = 1;\n');
    writeFileSync(join(root, 'wevolv', 'blob.bin'), Buffer.from([0, 1, 2, 3]));
    const service = createService(config(root));
    const headers = {
      origin: 'http://127.0.0.1:5173',
      'x-harness-session': 'a'.repeat(64),
    };
    const get = (url: string): Promise<LightMyRequestResponse> =>
      service.inject({ method: 'GET', url, headers });
    const created = CommandResponseSchema.parse(
      (
        await service.inject({
          method: 'POST',
          url: '/api/projects',
          headers,
          payload: {
            commandId: commandId(),
            name: 'Files',
            repositoryPath: join(root, 'wevolv'),
          },
        })
      ).json(),
    );
    const projectId = created.project.projection.projectId;
    const readme = (
      await get(`/api/projects/${projectId}/files?path=README.md`)
    ).json();
    expect(readme).toMatchObject({
      path: 'README.md',
      kind: 'markdown',
      content: '# Wevolv\n',
      size: 9,
      truncated: false,
    });
    expect(
      (await get(`/api/projects/${projectId}/files?path=src/a.ts`)).json(),
    ).toMatchObject({
      kind: 'code',
    });
    expect(
      (await get(`/api/projects/${projectId}/files?path=blob.bin`)).json(),
    ).toMatchObject({
      kind: 'binary',
      content: '',
    });
    expect(
      (await get(`/api/projects/${projectId}/files?path=missing.md`))
        .statusCode,
    ).toBe(404);
    expect(
      (await get(`/api/projects/${projectId}/files?path=../day-01/README.md`))
        .statusCode,
    ).toBe(403);
    expect(
      (await get(`/api/projects/${projectId}/files?path=/etc/passwd`))
        .statusCode,
    ).toBe(403);

    // No folder attached: told plainly.
    const plain = CommandResponseSchema.parse(
      (
        await service.inject({
          method: 'POST',
          url: '/api/projects',
          headers,
          payload: { commandId: commandId(), name: 'Plain' },
        })
      ).json(),
    );
    expect(
      (
        await get(
          `/api/projects/${plain.project.projection.projectId}/files?path=README.md`,
        )
      ).statusCode,
    ).toBe(409);
  });
});
