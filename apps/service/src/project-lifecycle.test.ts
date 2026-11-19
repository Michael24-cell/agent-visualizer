import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppConfig } from '@harness/config';
import {
  CommandResponseSchema,
  FolderListingSchema,
  ProjectListResponseSchema,
} from '@harness/contracts';
import { createService } from './app.js';
import { createFolder } from './folders.js';

// Rename, archive and delete a project; make a new folder to start in.

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function temporary(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function testConfig(folderRoot: string): AppConfig {
  const dataDirectory = temporary('visual-agent-lifecycle-');
  return {
    host: '127.0.0.1',
    port: 4317,
    dataDirectory,
    databasePath: join(dataDirectory, 'test.db'),
    sessionToken: 'b'.repeat(64),
    allowedOrigins: ['http://127.0.0.1:5173'],
    demoProject: false,
    folderRoot,
    runtime: { kind: 'simulated' },
    claudeKeyPresent: false,
    local: {
      baseUrl: 'http://127.0.0.1:11434/v1',
      model: 'qwen2.5-coder:7b',
      tools: 'basic',
    },
  };
}

let counter = 4100;
function commandId(): string {
  counter += 1;
  return `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
}

function client(config: AppConfig) {
  const service = createService(config);
  const headers = {
    origin: 'http://127.0.0.1:5173',
    'x-harness-session': config.sessionToken,
  };
  const send = (
    method: 'GET' | 'POST' | 'DELETE',
    url: string,
    payload?: object,
  ) =>
    service.inject({ method, url, headers, ...(payload ? { payload } : {}) });
  return {
    send,
    async list() {
      return ProjectListResponseSchema.parse(
        (await send('GET', '/api/projects')).json(),
      );
    },
    async command(url: string, payload: object) {
      const response = await send('POST', url, payload);
      if (response.statusCode >= 300) {
        throw new Error(`${response.statusCode} ${response.body}`);
      }
      return CommandResponseSchema.parse(response.json());
    },
  };
}

async function newProject(api: ReturnType<typeof client>, name: string) {
  const created = await api.command('/api/projects', {
    commandId: commandId(),
    name,
  });
  return created.project.projection;
}

describe('project lifecycle', () => {
  it('renames a project, and refuses a stale or unchanged rename', async () => {
    const api = client(testConfig(temporary('visual-agent-root-')));
    const project = await newProject(api, 'hi');
    const renamed = await api.command(
      `/api/projects/${project.projectId}/name`,
      {
        commandId: commandId(),
        expectedSequence: project.lastSequence,
        name: '  Invoice exporter ',
      },
    );
    expect(renamed.project.projection.project.name).toBe('Invoice exporter');
    const stale = await api.send(
      'POST',
      `/api/projects/${project.projectId}/name`,
      {
        commandId: commandId(),
        expectedSequence: project.lastSequence,
        name: 'Other',
      },
    );
    expect(stale.statusCode).toBe(409);
    const same = await api.send(
      'POST',
      `/api/projects/${project.projectId}/name`,
      {
        commandId: commandId(),
        expectedSequence: renamed.project.projection.lastSequence,
        name: 'Invoice exporter',
      },
    );
    expect(same.statusCode).toBe(400);
  });

  it('archives and restores, keeping the project in the list with a date', async () => {
    const api = client(testConfig(temporary('visual-agent-root-')));
    const project = await newProject(api, 'Archive me');
    const archived = await api.command(
      `/api/projects/${project.projectId}/archive`,
      {
        commandId: commandId(),
        expectedSequence: project.lastSequence,
        archived: true,
      },
    );
    const listed = (await api.list()).projects.find(
      (entry) => entry.project.id === project.projectId,
    );
    expect(listed?.project.archivedAt).toEqual(expect.any(String));
    const restored = await api.command(
      `/api/projects/${project.projectId}/archive`,
      {
        commandId: commandId(),
        expectedSequence: archived.project.projection.lastSequence,
        archived: false,
      },
    );
    expect(restored.project.projection.project.archivedAt).toBeUndefined();
  });

  it('deletes a project and its history, leaving the others alone', async () => {
    const api = client(testConfig(temporary('visual-agent-root-')));
    const keep = await newProject(api, 'Keep');
    const gone = await newProject(api, 'Gone');
    const deleted = await api.send('DELETE', `/api/projects/${gone.projectId}`);
    expect(deleted.statusCode).toBe(204);
    expect(
      (await api.list()).projects.map((entry) => entry.project.name),
    ).toEqual(['Keep']);
    expect(
      (await api.send('GET', `/api/projects/${gone.projectId}`)).statusCode,
    ).toBe(404);
    expect(
      (await api.send('GET', `/api/projects/${gone.projectId}/events`))
        .statusCode,
    ).toBe(404);
    expect(
      (await api.send('DELETE', `/api/projects/${gone.projectId}`)).statusCode,
    ).toBe(404);
    // The survivor still reads and still takes commands.
    const renamed = await api.command(`/api/projects/${keep.projectId}/name`, {
      commandId: commandId(),
      expectedSequence: keep.lastSequence,
      name: 'Kept',
    });
    expect(renamed.project.projection.project.name).toBe('Kept');
  });
});

describe('new folders', () => {
  it('makes one empty folder under the root and returns its listing', async () => {
    const root = temporary('visual-agent-root-');
    const api = client(testConfig(root));
    const response = await api.send('POST', '/api/folders', {
      parent: root,
      name: 'invoice-exporter',
    });
    expect(response.statusCode).toBe(201);
    const listing = FolderListingSchema.parse(response.json());
    expect(listing.path).toBe(join(root, 'invoice-exporter'));
    expect(listing.entries).toEqual([]);
    const again = await api.send('POST', '/api/folders', {
      parent: root,
      name: 'invoice-exporter',
    });
    expect(again.statusCode).toBe(409);
  });

  it('refuses names that escape, and parents outside the root', () => {
    const root = temporary('visual-agent-root-');
    mkdirSync(join(root, 'inside'));
    for (const name of ['../out', 'a/b', '..', '.', '']) {
      expect(() => createFolder(root, name, { root })).toThrowError(
        expect.objectContaining({ code: 'folder_not_allowed' }),
      );
    }
    expect(() => createFolder(tmpdir(), 'x', { root })).toThrowError(
      expect.objectContaining({ code: 'folder_not_allowed' }),
    );
    expect(() =>
      createFolder(join(root, 'missing'), 'x', { root }),
    ).toThrowError(expect.objectContaining({ code: 'folder_not_found' }));
    expect(createFolder(join(root, 'inside'), 'new one', { root })).toBe(
      join(root, 'inside', 'new one'),
    );
    expect(existsSync(join(root, '..', 'out'))).toBe(false);
  });
});
