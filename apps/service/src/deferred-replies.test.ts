import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppConfig } from '@harness/config';
import type { LightMyRequestResponse } from 'fastify';
import {
  CommandResponseSchema,
  MessagesPageSchema,
  ProjectResponseSchema,
} from '@harness/contracts';
import { createService } from './app.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

let counter = 1500;
function commandId(): string {
  counter += 1;
  return `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
}

function config(): AppConfig {
  const dataDirectory = mkdtempSync(join(tmpdir(), 'visual-agent-deferred-'));
  temporaryDirectories.push(dataDirectory);
  return {
    host: '127.0.0.1',
    port: 4317,
    dataDirectory,
    databasePath: join(dataDirectory, 'test.db'),
    sessionToken: 'a'.repeat(64),
    allowedOrigins: ['http://127.0.0.1:5173'],
    demoProject: true,
    runtime: { kind: 'simulated' },
    replyDelayMs: 30,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('deferred replies', () => {
  it('returns the user message at once, marks the thread busy, then lands the reply and the task', async () => {
    const service = createService(config());
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
    const projectId = 'project_harness-demo';
    const before = ProjectResponseSchema.parse(
      (await get(`/api/projects/${projectId}`)).json(),
    );
    const agent = Object.values(before.projection.agents)[0]!;
    const thread = before.projection.threads[agent.threadId]!;
    const url = `/api/projects/${projectId}/threads/${agent.id}/messages`;

    const sent = CommandResponseSchema.parse(
      (
        await post(url, {
          commandId: commandId(),
          expectedSequence: thread.lastSequence,
          body: 'Build the export job',
          intent: 'start_work',
        })
      ).json(),
    );
    // Only the user's message is in: no reply, no task, thread busy.
    expect(sent.receipt.createdIds.messages).toHaveLength(1);
    expect(sent.receipt.createdIds.tasks).toBeUndefined();
    expect(sent.project.busyThreadIds).toEqual([thread.id]);
    expect(sent.project.projection.agents[agent.id]?.work).toBe('idle');
    let page = MessagesPageSchema.parse((await get(url)).json());
    expect(page.messages.map((m) => m.author.role)).toEqual(['user']);

    // A second message while the reply is pending is refused as stale
    // only if the thread moved; it did not, so it queues behind.
    const again = await post(url, {
      commandId: commandId(),
      expectedSequence:
        sent.project.projection.threads[thread.id]!.lastSequence,
      body: 'What changed?',
    });
    expect(again.statusCode).toBe(201);

    // Wait for both replies.
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const current = ProjectResponseSchema.parse(
        (await get(`/api/projects/${projectId}`)).json(),
      );
      if (current.busyThreadIds.length === 0) break;
      await sleep(25);
    }
    const after = ProjectResponseSchema.parse(
      (await get(`/api/projects/${projectId}`)).json(),
    );
    expect(after.busyThreadIds).toEqual([]);
    expect(after.projection.agents[agent.id]?.work).toBe('working');
    expect(Object.values(after.projection.tasks)).toHaveLength(1);
    page = MessagesPageSchema.parse((await get(url)).json());
    expect(page.messages.map((m) => m.author.role)).toEqual([
      'user',
      'user',
      'agent',
      'agent',
    ]);
    expect(page.messages[2]?.body).toContain('Starting: Build the export job');
    expect(page.messages[3]?.body).toContain('is in progress');
    // Replay of the original command still returns only its own range.
    const replay = CommandResponseSchema.parse(
      (
        await post(url, {
          commandId: sent.receipt.commandId,
          expectedSequence: thread.lastSequence,
          body: 'Build the export job',
          intent: 'start_work',
        })
      ).json(),
    );
    expect(replay.receipt).toMatchObject({
      replayed: true,
      firstSequence: sent.receipt.firstSequence,
    });
    await service.close();
  });

  it('records a failed reply as a system message instead of losing it', async () => {
    const service = createService(config());
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
    const projectId = 'project_harness-demo';
    const project = ProjectResponseSchema.parse(
      (await get(`/api/projects/${projectId}`)).json(),
    );
    const agent = Object.values(project.projection.agents)[0]!;
    const thread = project.projection.threads[agent.threadId]!;
    const url = `/api/projects/${projectId}/threads/${agent.id}/messages`;
    // Two start_work commands queued: the second finds the agent busy when
    // its turn comes, and the simulator declines politely (no crash, no lost message).
    await post(url, {
      commandId: commandId(),
      expectedSequence: thread.lastSequence,
      body: 'One',
      intent: 'start_work',
    });
    const current = ProjectResponseSchema.parse(
      (await get(`/api/projects/${projectId}`)).json(),
    );
    await post(url, {
      commandId: commandId(),
      expectedSequence: current.projection.threads[thread.id]!.lastSequence,
      body: 'Two',
      intent: 'start_work',
    });
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const now = ProjectResponseSchema.parse(
        (await get(`/api/projects/${projectId}`)).json(),
      );
      if (now.busyThreadIds.length === 0) break;
      await sleep(25);
    }
    const page = MessagesPageSchema.parse((await get(url)).json());
    expect(page.messages.map((m) => m.author.role)).toEqual([
      'user',
      'user',
      'agent',
      'agent',
    ]);
    expect(page.messages[3]?.body).toContain("I'm still on");
    const after = ProjectResponseSchema.parse(
      (await get(`/api/projects/${projectId}`)).json(),
    );
    expect(Object.values(after.projection.tasks)).toHaveLength(1);
    await service.close();
  });
});
