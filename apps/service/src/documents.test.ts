import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppConfig } from '@harness/config';
import {
  CommandResponseSchema,
  type CommandResponse,
} from '@harness/contracts';
import { createService } from './app.js';

// Plan and Method are documents: edited directly through their commands or
// by telling the coordinator, and both paths record the same events.

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function testConfig(): AppConfig {
  const dataDirectory = mkdtempSync(join(tmpdir(), 'visual-agent-docs-'));
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
  };
}

let counter = 5000;
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
    async get(url: string) {
      return service.inject({ method: 'GET', url, headers });
    },
    async post(url: string, payload: object) {
      return service.inject({ method: 'POST', url, headers, payload });
    },
    async command(url: string, payload: object): Promise<CommandResponse> {
      const response = await service.inject({
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

async function lastReply(
  api: ReturnType<typeof client>,
  projectId: string,
  threadId: string,
) {
  const page = (
    await api.get(`/api/projects/${projectId}/threads/${threadId}/messages`)
  ).json() as { messages: { author: { role: string }; body: string }[] };
  return page.messages.at(-1)!;
}

describe('plan document', () => {
  it('is edited directly against its own sequence', async () => {
    const api = client(testConfig());
    const { project } = await api.command('/api/projects', {
      commandId: commandId(),
      name: 'Docs',
    });
    const projectId = project.projection.projectId;
    expect(project.projection.planDocument.sections).toEqual({});

    const edited = await api.command(
      `/api/projects/${projectId}/plan/sections`,
      {
        commandId: commandId(),
        expectedSequence: project.projection.planDocument.lastSequence,
        sectionId: 'features',
        lines: ['Offline sync', 'Shared lists'],
      },
    );
    const doc = edited.project.projection.planDocument;
    expect(doc.sections.features).toMatchObject({
      lines: ['Offline sync', 'Shared lists'],
      source: 'user',
    });
    expect(doc.lastSequence).toBeGreaterThan(
      project.projection.planDocument.lastSequence,
    );

    // Stale plan sequence is refused; the brief and threads are untouched.
    const stale = await api.post(`/api/projects/${projectId}/plan/sections`, {
      commandId: commandId(),
      expectedSequence: project.projection.planDocument.lastSequence,
      sectionId: 'ui',
      lines: ['One composer'],
    });
    expect(stale.statusCode).toBe(409);
    expect(edited.project.projection.brief.lastSequence).toBe(
      project.projection.brief.lastSequence,
    );
  });

  it('is edited by telling the coordinator, with the coordinator as source', async () => {
    const api = client(testConfig());
    const { project } = await api.command('/api/projects', {
      commandId: commandId(),
      name: 'Docs',
    });
    const projectId = project.projection.projectId;
    const coordinator = Object.values(project.projection.threads).find(
      (thread) => thread.kind === 'coordinator',
    )!;
    const url = `/api/projects/${projectId}/threads/${coordinator.id}/messages`;

    let response = await api.command(url, {
      commandId: commandId(),
      expectedSequence: coordinator.lastSequence,
      body: 'features: offline sync; shared lists',
    });
    expect(
      response.project.projection.planDocument.sections.features,
    ).toMatchObject({
      lines: ['offline sync', 'shared lists'],
      source: 'coordinator',
    });
    expect((await lastReply(api, projectId, coordinator.id)).body).toBe(
      'Added to Plan · Features: offline sync; shared lists.',
    );
    // No brief intake happened for that message.
    expect(response.project.projection.brief.fields.goal.state).toBe('missing');

    let thread = response.project.projection.threads[coordinator.id]!;
    response = await api.command(url, {
      commandId: commandId(),
      expectedSequence: thread.lastSequence,
      body: 'remove shared lists from features',
    });
    expect(
      response.project.projection.planDocument.sections.features?.lines,
    ).toEqual(['offline sync']);

    thread = response.project.projection.threads[coordinator.id]!;
    const before = response.project.projection.planDocument.lastSequence;
    response = await api.command(url, {
      commandId: commandId(),
      expectedSequence: thread.lastSequence,
      body: 'add offline sync to features',
    });
    expect(response.project.projection.planDocument.lastSequence).toBe(before);
    expect((await lastReply(api, projectId, coordinator.id)).body).toBe(
      'Plan · Features already has that.',
    );
  });
});

describe('method document', () => {
  it('needs a Method first, then takes conversational overrides', async () => {
    const api = client(testConfig());
    const { project } = await api.command('/api/projects', {
      commandId: commandId(),
      name: 'Docs',
    });
    const projectId = project.projection.projectId;
    const coordinator = Object.values(project.projection.threads).find(
      (thread) => thread.kind === 'coordinator',
    )!;
    const url = `/api/projects/${projectId}/threads/${coordinator.id}/messages`;

    let response = await api.command(url, {
      commandId: commandId(),
      expectedSequence: coordinator.lastSequence,
      body: 'hard rules: never push to main',
    });
    expect(response.project.projection.method).toBeNull();
    expect((await lastReply(api, projectId, coordinator.id)).body).toMatch(
      /No Method is applied yet/,
    );

    response = await api.command(`/api/projects/${projectId}/method`, {
      commandId: commandId(),
      expectedSequence: response.project.projection.lastSequence,
      catalogId: 'method_careful',
      catalogVersion: '1.0.0',
    });
    const thread = response.project.projection.threads[coordinator.id]!;
    response = await api.command(url, {
      commandId: commandId(),
      expectedSequence: thread.lastSequence,
      body: 'hard rules: never push to main',
    });
    const method = response.project.projection.method!;
    const override = method.overrides.at(-1)!;
    expect(override).toMatchObject({
      sectionId: 'hardRules',
      source: 'coordinator',
    });
    expect(override.value.at(-1)).toBe('never push to main');
    expect(override.value.length).toBeGreaterThan(1);
    expect((await lastReply(api, projectId, coordinator.id)).body).toBe(
      'Added to Method · Hard rules: never push to main.',
    );

    // A direct override records the user as its source.
    const direct = await api.command(
      `/api/projects/${projectId}/method/overrides`,
      {
        commandId: commandId(),
        expectedSequence: method.lastSequence,
        sectionId: 'checks',
        value: ['vitest'],
      },
    );
    expect(direct.project.projection.method!.overrides.at(-1)).toMatchObject({
      sectionId: 'checks',
      value: ['vitest'],
      source: 'user',
    });
  });

  it('a work request fills Overview and Features before the tasks are proposed', async () => {
    const api = client(testConfig());
    const { project } = await api.command('/api/projects', {
      commandId: commandId(),
      name: 'Docs',
    });
    const projectId = project.projection.projectId;
    const coordinator = Object.values(project.projection.threads).find(
      (thread) => thread.kind === 'coordinator',
    )!;
    const response = await api.command(
      `/api/projects/${projectId}/threads/${coordinator.id}/messages`,
      {
        commandId: commandId(),
        expectedSequence: coordinator.lastSequence,
        body: 'Build a settings page with a preferences form and offline sync',
        intent: 'start_work',
      },
    );
    const doc = response.project.projection.planDocument;
    expect(doc.sections.overview).toMatchObject({
      lines: ['Build a settings page with a preferences form and offline sync'],
      source: 'coordinator',
    });
    expect(doc.sections.features?.lines).toEqual([
      'Settings page',
      'Preferences form',
      'Offline sync',
    ]);
    const plan = Object.values(response.project.projection.plans)[0]!;
    expect(plan.tasks.map((row) => row.sections)).toEqual([
      ['features', 'ui'],
      ['features', 'data'],
    ]);
  });
});
