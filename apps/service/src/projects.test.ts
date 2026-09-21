import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@harness/config';
import type { LightMyRequestResponse } from 'fastify';
import {
  CommandResponseSchema,
  MessagesPageSchema,
  ProjectIdSchema,
  ProjectResponseSchema,
  type CommandResponse,
  type MessagesPage,
} from '@harness/contracts';
import { replayProjectEvents } from '@harness/domain';
import { SqliteProjectStore, openHarnessDatabase } from '@harness/persistence';
import { createService } from './app.js';
import { ProjectCommandError, ProjectService } from './projects.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function testConfig(demoProject = false): AppConfig {
  const dataDirectory = mkdtempSync(join(tmpdir(), 'visual-agent-projects-'));
  temporaryDirectories.push(dataDirectory);
  return {
    host: '127.0.0.1',
    port: 4317,
    dataDirectory,
    databasePath: join(dataDirectory, 'test.db'),
    sessionToken: 'a'.repeat(64),
    allowedOrigins: ['http://127.0.0.1:5173'],
    demoProject,
    runtime: { kind: 'simulated' },
    claudeKeyPresent: false,
    local: {
      baseUrl: 'http://127.0.0.1:11434/v1',
      model: 'qwen2.5-coder:7b',
      tools: 'basic',
    },
  };
}

let counter = 0;
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
  return {
    service,
    async get(url: string): Promise<LightMyRequestResponse> {
      return service.inject({ method: 'GET', url, headers });
    },
    async post(url: string, payload: object): Promise<LightMyRequestResponse> {
      return service.inject({ method: 'POST', url, headers, payload });
    },
    async command(url: string, payload: object): Promise<CommandResponse> {
      const response: LightMyRequestResponse = await service.inject({
        method: 'POST',
        url,
        headers,
        payload,
      });
      if (response.statusCode >= 300) {
        throw new Error(`${response.statusCode} ${response.body}`);
      }
      return CommandResponseSchema.parse(response.json());
    },
  };
}

async function createProject(api: ReturnType<typeof client>, name = 'Demo') {
  const id = commandId();
  const created = await api.command('/api/projects', { commandId: id, name });
  return {
    created,
    commandId: id,
    projectId: created.project.projection.projectId,
  };
}

async function createAgent(
  api: ReturnType<typeof client>,
  projectId: string,
  name = 'Interface systems',
) {
  const project = await api.get(`/api/projects/${projectId}`);
  const expectedSequence = project.json().projection.lastSequence as number;
  const response = await api.command(`/api/projects/${projectId}/agents`, {
    commandId: commandId(),
    expectedSequence,
    name,
    category: 'interface',
  });
  return response.receipt.createdIds.agents![0]!;
}

function agentThread(response: CommandResponse, agentId: string) {
  return response.project.projection.agents[agentId]!;
}

describe('projects and the coordinator thread', () => {
  it('creates a project with an open coordinator thread and a first message, atomically and idempotently', async () => {
    const api = client(testConfig());
    const { created, commandId: id, projectId } = await createProject(api);
    expect(created.receipt).toMatchObject({
      firstSequence: 1,
      lastSequence: 3,
      replayed: false,
    });
    const threads = Object.values(created.project.projection.threads);
    expect(threads).toHaveLength(1);
    expect(threads[0]).toMatchObject({ kind: 'coordinator', messageCount: 1 });
    expect(created.project.summary.status).toBe('intake');
    expect(created.project.brief.markdown).toContain('# Demo');

    const list = await api.get('/api/projects');
    expect(list.json().projects).toHaveLength(1);
    expect(list.json().projects[0].project.origin).toBe('user');

    const retry = await api.post('/api/projects', { commandId: id, name: 'X' });
    expect(retry.statusCode).toBe(200);
    expect(retry.json().receipt).toMatchObject({
      commandId: id,
      firstSequence: 1,
      lastSequence: 3,
      replayed: true,
    });
    expect((await api.get('/api/projects')).json().projects).toHaveLength(1);
    expect(projectId).toBe(`project_${id}`);
    await api.service.close();
  });

  it('answers in the coordinator thread without creating work', async () => {
    const api = client(testConfig());
    const { created, projectId } = await createProject(api);
    const coordinator = Object.values(created.project.projection.threads)[0]!;
    const response = await api.command(
      `/api/projects/${projectId}/threads/coordinator/messages`,
      {
        commandId: commandId(),
        expectedSequence: coordinator.lastSequence,
        body: 'Build a preferences form.',
      },
    );
    expect(Object.keys(response.project.projection.tasks)).toEqual([]);
    const page = MessagesPageSchema.parse(
      (
        await api.get(`/api/projects/${projectId}/threads/coordinator/messages`)
      ).json(),
    );
    expect(page.messages.map((m) => m.author.role)).toEqual([
      'coordinator',
      'user',
      'coordinator',
    ]);
    expect(page.messages[2]?.author.adapter).toMatchObject({
      id: 'simulated-conversation',
      mode: 'simulated',
    });
    await api.service.close();
  });
});

describe('one independent agent thread', () => {
  it('chats without creating a task, starts work explicitly, keeps the thread after stop, and starts again', async () => {
    const api = client(testConfig());
    const { projectId } = await createProject(api);
    const agentId = await createAgent(api, projectId);
    const url = `/api/projects/${projectId}/threads/${agentId}/messages`;
    const project = (await api.get(`/api/projects/${projectId}`)).json();
    let thread =
      project.projection.threads[project.projection.agents[agentId].threadId];

    // 1. An ordinary question does not create a task.
    let response = await api.command(url, {
      commandId: commandId(),
      expectedSequence: thread.lastSequence,
      body: 'What changed?',
    });
    expect(Object.keys(response.project.projection.tasks)).toEqual([]);
    expect(agentThread(response, agentId).work).toBe('idle');

    // 2. Explicit work creates exactly one task and starts it.
    thread = response.project.projection.threads[thread.id]!;
    response = await api.command(url, {
      commandId: commandId(),
      expectedSequence: thread.lastSequence,
      body: 'Build the preferences form with keyboard support.',
      intent: 'start_work',
    });
    const tasks = Object.values(response.project.projection.tasks);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      title: 'Build the preferences form with keyboard support.',
      state: 'working',
      agentId,
    });
    expect(agentThread(response, agentId).work).toBe('working');
    expect(response.project.summary.status).toBe('working');
    expect(response.receipt.createdIds.tasks).toHaveLength(1);

    // A message during work is steering, not a duplicate task.
    thread = response.project.projection.threads[thread.id]!;
    response = await api.command(url, {
      commandId: commandId(),
      expectedSequence: thread.lastSequence,
      body: 'Use the existing form styles.',
    });
    expect(Object.values(response.project.projection.tasks)).toHaveLength(1);
    // And so is a second start_work while busy.
    thread = response.project.projection.threads[thread.id]!;
    response = await api.command(url, {
      commandId: commandId(),
      expectedSequence: thread.lastSequence,
      body: 'Also add dark mode.',
      intent: 'start_work',
    });
    expect(Object.values(response.project.projection.tasks)).toHaveLength(1);

    // 3. Stop keeps messages and the thread; the agent shows stopped.
    const agent = agentThread(response, agentId);
    response = await api.command(
      `/api/projects/${projectId}/agents/${agentId}/stop`,
      { commandId: commandId(), expectedSequence: agent.lastSequence },
    );
    expect(agentThread(response, agentId).work).toBe('stopped');
    expect(response.project.projection.threads[thread.id]?.state).toBe('open');
    expect(response.project.summary.status).toBe('partially_stopped');
    const page = MessagesPageSchema.parse((await api.get(url)).json());
    expect(page.messages.length).toBe(9);
    expect(page.messages.at(-1)?.body).toContain('Stopped');

    // 4. Later explicit work creates a new task on the same conversation.
    thread = response.project.projection.threads[thread.id]!;
    response = await api.command(url, {
      commandId: commandId(),
      expectedSequence: thread.lastSequence,
      body: 'Add dark mode.',
      intent: 'start_work',
    });
    expect(Object.values(response.project.projection.tasks)).toHaveLength(2);
    expect(agentThread(response, agentId)).toMatchObject({
      work: 'working',
      taskIds: expect.arrayContaining([expect.any(String)]),
    });
    // Stopping an agent with nothing in progress is refused.
    await api.command(`/api/projects/${projectId}/agents/${agentId}/stop`, {
      commandId: commandId(),
      expectedSequence: agentThread(response, agentId).lastSequence,
    });
    const refreshed = (await api.get(`/api/projects/${projectId}`)).json();
    const refused = await api.post(
      `/api/projects/${projectId}/agents/${agentId}/stop`,
      {
        commandId: commandId(),
        expectedSequence: refreshed.projection.agents[agentId].lastSequence,
      },
    );
    expect(refused.statusCode).toBe(409);
    expect(refused.json().code).toBe('invalid_transition');
    await api.service.close();
  });

  it('checks the sequence of the thread it targets, and receipts win over staleness', async () => {
    const api = client(testConfig());
    const { projectId } = await createProject(api);
    const a = await createAgent(api, projectId, 'Interface');
    const b = await createAgent(api, projectId, 'Backend');
    const project = (await api.get(`/api/projects/${projectId}`)).json();
    const threadA =
      project.projection.threads[project.projection.agents[a].threadId];
    const threadB =
      project.projection.threads[project.projection.agents[b].threadId];

    // Talking to A does not stale B.
    await api.command(`/api/projects/${projectId}/threads/${a}/messages`, {
      commandId: commandId(),
      expectedSequence: threadA.lastSequence,
      body: 'Hello A',
    });
    const okB = await api.post(
      `/api/projects/${projectId}/threads/${b}/messages`,
      {
        commandId: commandId(),
        expectedSequence: threadB.lastSequence,
        body: 'Hello B',
      },
    );
    expect(okB.statusCode).toBe(201);

    // Stale on the same thread is refused...
    const stale = await api.post(
      `/api/projects/${projectId}/threads/${a}/messages`,
      {
        commandId: commandId(),
        expectedSequence: threadA.lastSequence,
        body: 'Again',
      },
    );
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe('stale_sequence');

    // ...unless it is a retry of a command that already committed.
    const id = commandId();
    const current = (await api.get(`/api/projects/${projectId}`)).json();
    const first = await api.post(
      `/api/projects/${projectId}/threads/${a}/messages`,
      {
        commandId: id,
        expectedSequence: current.projection.threads[threadA.id].lastSequence,
        body: 'Once',
      },
    );
    expect(first.statusCode).toBe(201);
    const retry = await api.post(
      `/api/projects/${projectId}/threads/${a}/messages`,
      {
        commandId: id,
        expectedSequence: threadA.lastSequence,
        body: 'Once',
      },
    );
    expect(retry.statusCode).toBe(200);
    expect(retry.json().receipt).toMatchObject({
      ...first.json().receipt,
      replayed: true,
    });
    const page = MessagesPageSchema.parse(
      (
        await api.get(`/api/projects/${projectId}/threads/${a}/messages`)
      ).json(),
    );
    expect(page.messages.filter((m) => m.body === 'Once')).toHaveLength(1);
    await api.service.close();
  });

  it('rejects replaying a command receipt through another project', async () => {
    const api = client(testConfig(false));
    const first = await createProject(api, 'First');
    const second = await createProject(api, 'Second');
    const firstProject = await api.get(`/api/projects/${first.projectId}`);
    const id = commandId();
    const createdAgent = await api.post(
      `/api/projects/${first.projectId}/agents`,
      {
        commandId: id,
        expectedSequence: firstProject.json().projection.lastSequence,
        name: 'First agent',
        category: 'interface',
      },
    );
    expect(createdAgent.statusCode).toBe(201);

    const wrongProject = await api.post(
      `/api/projects/${second.projectId}/agents`,
      {
        commandId: id,
        expectedSequence: second.created.project.projection.lastSequence,
        name: 'Second agent',
        category: 'interface',
      },
    );
    expect(wrongProject.statusCode).toBe(400);
    expect(wrongProject.json().code).toBe('project_mismatch');
    expect(
      Object.values(
        (await api.get(`/api/projects/${second.projectId}`)).json().projection
          .agents,
      ),
    ).toEqual([]);
    await api.service.close();
  });

  it('rejects empty, oversized, author-supplied, and misrouted messages', async () => {
    const api = client(testConfig());
    const { projectId } = await createProject(api);
    const agentId = await createAgent(api, projectId);
    const url = `/api/projects/${projectId}/threads/${agentId}/messages`;
    const base = { commandId: commandId(), expectedSequence: 1 };
    expect((await api.post(url, { ...base, body: '   ' })).json().code).toBe(
      'message_empty',
    );
    expect(
      (await api.post(url, { ...base, body: 'x'.repeat(4_001) })).json().code,
    ).toBe('message_too_long');
    expect(
      (
        await api.post(url, {
          ...base,
          body: 'hi',
          author: { role: 'agent' },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await api.post(
          `/api/projects/${projectId}/threads/thread_nope/messages`,
          {
            ...base,
            body: 'hi',
          },
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await api.post(
          `/api/projects/project_nope/threads/coordinator/messages`,
          {
            ...base,
            body: 'hi',
          },
        )
      ).statusCode,
    ).toBe(404);
    await api.service.close();
  });

  it('pages messages both ways without gaps or duplicates', async () => {
    const api = client(testConfig());
    const { projectId } = await createProject(api);
    const agentId = await createAgent(api, projectId);
    const url = `/api/projects/${projectId}/threads/${agentId}/messages`;
    let project = (await api.get(`/api/projects/${projectId}`)).json();
    const threadId = project.projection.agents[agentId].threadId as string;
    for (let index = 0; index < 60; index += 1) {
      const thread = project.projection.threads[threadId];
      const response = await api.command(url, {
        commandId: commandId(),
        expectedSequence: thread.lastSequence,
        body: `note ${index}`,
      });
      project = response.project;
    }
    // 60 user + 60 replies = 120 messages.
    const latest = MessagesPageSchema.parse(
      (await api.get(`${url}?limit=50`)).json(),
    );
    expect(latest.messages).toHaveLength(50);
    expect(latest.olderCursor).toBeDefined();
    const seen: number[] = [...latest.messages.map((m) => m.sequence)];
    let cursor = latest.olderCursor;
    while (cursor !== undefined) {
      const page: MessagesPage = MessagesPageSchema.parse(
        (await api.get(`${url}?limit=50&before=${cursor}`)).json(),
      );
      seen.unshift(...page.messages.map((m) => m.sequence));
      cursor = page.olderCursor;
    }
    expect(seen).toHaveLength(120);
    expect(new Set(seen).size).toBe(120);
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);

    // Forward from a midpoint, in pages of 100 max.
    const mid = seen[59]!;
    const forward = MessagesPageSchema.parse(
      (await api.get(`${url}?after=${mid}&limit=100`)).json(),
    );
    expect(forward.messages.map((m) => m.sequence)).toEqual(seen.slice(60));
    expect(forward.newerCursor).toBe(seen.at(-1));
    const nothingNew = MessagesPageSchema.parse(
      (await api.get(`${url}?after=${forward.newerCursor}`)).json(),
    );
    expect(nothingNew.messages).toEqual([]);
    expect(nothingNew.newerCursor).toBe(forward.newerCursor);
    expect((await api.get(`${url}?limit=0`)).statusCode).toBe(400);
    expect((await api.get(`${url}?limit=101`)).statusCode).toBe(400);
    expect((await api.get(`${url}?before=5&after=1`)).statusCode).toBe(400);
    // No message bodies in the projection.
    expect(JSON.stringify(project.projection)).not.toContain('note 3');
    await api.service.close();
  });

  it('replays to the identical projection after a restart', async () => {
    const config = testConfig();
    const api = client(config);
    const { projectId } = await createProject(api);
    const agentId = await createAgent(api, projectId);
    const url = `/api/projects/${projectId}/threads/${agentId}/messages`;
    let project = (await api.get(`/api/projects/${projectId}`)).json();
    const threadId = project.projection.agents[agentId].threadId as string;
    project = (
      await api.command(url, {
        commandId: commandId(),
        expectedSequence: project.projection.threads[threadId].lastSequence,
        body: 'Ship it',
        intent: 'start_work',
      })
    ).project;
    await api.command(`/api/projects/${projectId}/agents/${agentId}/stop`, {
      commandId: commandId(),
      expectedSequence: project.projection.agents[agentId].lastSequence,
    });
    const before = (await api.get(`/api/projects/${projectId}`)).json();
    const beforeMessages = (await api.get(url)).json();
    await api.service.close();

    const again = client(config);
    const after = (await again.get(`/api/projects/${projectId}`)).json();
    expect(after).toEqual(before);
    expect((await again.get(url)).json()).toEqual(beforeMessages);
    const events = (
      await again.get(`/api/projects/${projectId}/events`)
    ).json();
    expect(replayProjectEvents(events.events)).toEqual(after.projection);
    await again.service.close();
  });

  it('seeds the demo project only behind the flag', async () => {
    const off = client(testConfig(false));
    expect((await off.get('/api/projects')).json().projects).toEqual([]);
    await off.service.close();

    const config = testConfig(true);
    const on = client(config);
    const projects = (await on.get('/api/projects')).json().projects;
    expect(projects).toHaveLength(1);
    expect(projects[0].project).toMatchObject({
      id: 'project_harness-demo',
      origin: 'demo',
    });
    const demo = ProjectResponseSchema.parse(
      (await on.get('/api/projects/project_harness-demo')).json(),
    );
    expect(
      Object.values(demo.projection.agents).map((agent) => agent.name),
    ).toEqual(['Interface systems', 'Backend orchestration']);
    await on.service.close();
    const restarted = client(config);
    expect((await restarted.get('/api/projects')).json().projects).toHaveLength(
      1,
    );
    await restarted.service.close();
  });
});

describe('atomicity', () => {
  it('leaves nothing behind when the receipt write fails, and the retry creates no duplicates', () => {
    const config = testConfig();
    const database = openHarnessDatabase(config.databasePath);
    const store = new SqliteProjectStore(database.database);
    const service = new ProjectService(store, {
      now: () => '2026-03-01T00:00:00.000Z',
    });
    const created = service.createProject({
      commandId: commandId() as never,
      name: 'Atomic',
    });
    const projectId = ProjectIdSchema.parse(
      created.project.projection.projectId,
    );
    const thread = Object.values(created.project.projection.threads)[0]!;
    const id = commandId();
    const spy = vi.spyOn(store, 'saveReceipt').mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    expect(() =>
      service.postMessage(projectId, 'coordinator', {
        commandId: id as never,
        expectedSequence: thread.lastSequence,
        body: 'Hello',
        intent: 'chat',
      }),
    ).toThrowError('disk full');
    expect(store.getProjection(projectId)?.lastSequence).toBe(
      created.project.projection.lastSequence,
    );
    expect(store.listMessages(thread.id, { limit: 10 }).messages).toHaveLength(
      1,
    );
    expect(store.getReceipt(id)).toBeUndefined();

    const retried = service.postMessage(projectId, 'coordinator', {
      commandId: id as never,
      expectedSequence: thread.lastSequence,
      body: 'Hello',
      intent: 'chat',
    });
    expect(retried.receipt.replayed).toBe(false);
    expect(store.listMessages(thread.id, { limit: 10 }).messages).toHaveLength(
      3,
    );
    expect(() =>
      service.postMessage(projectId, 'coordinator', {
        commandId: commandId() as never,
        expectedSequence: thread.lastSequence,
        body: 'Stale',
        intent: 'chat',
      }),
    ).toThrowError(ProjectCommandError);
    spy.mockRestore();
    database.close();
  });
});
