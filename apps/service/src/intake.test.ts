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
  type CommandResponse,
  type ProjectResponse,
} from '@harness/contracts';
import { resolveMethod } from '@harness/domain';
import { createService } from './app.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function testConfig(): AppConfig {
  const dataDirectory = mkdtempSync(join(tmpdir(), 'visual-agent-intake-'));
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

let counter = 500;
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
      const response = await this.post(url, payload);
      if (response.statusCode >= 300) {
        throw new Error(`${response.statusCode} ${response.body}`);
      }
      return CommandResponseSchema.parse(response.json());
    },
    async project(projectId: string): Promise<ProjectResponse> {
      return ProjectResponseSchema.parse(
        (await this.get(`/api/projects/${projectId}`)).json(),
      );
    },
  };
}

type Api = ReturnType<typeof client>;

async function say(api: Api, projectId: string, body: string) {
  const project = await api.project(projectId);
  const thread = Object.values(project.projection.threads).find(
    (t) => t.kind === 'coordinator',
  )!;
  const response = await api.command(
    `/api/projects/${projectId}/threads/coordinator/messages`,
    { commandId: commandId(), expectedSequence: thread.lastSequence, body },
  );
  const page = MessagesPageSchema.parse(
    (
      await api.get(`/api/projects/${projectId}/threads/coordinator/messages`)
    ).json(),
  );
  return { response, reply: page.messages.at(-1)!.body };
}

describe('intake builds the Brief', () => {
  it('asks one field at a time, infers prefixed answers, confirms, corrects, skips, and offers a Method once', async () => {
    const api = client(testConfig());
    const created = await api.command('/api/projects', {
      commandId: commandId(),
      name: 'Preferences',
    });
    const projectId = created.project.projection.projectId;
    expect(created.project.summary).toMatchObject({
      status: 'intake',
      briefReady: false,
    });

    let turn = await say(
      api,
      projectId,
      'An accessible account preferences form.',
    );
    expect(turn.response.project.projection.brief.fields.goal).toMatchObject({
      state: 'confirmed',
      value: 'An accessible account preferences form.',
      source: 'user',
    });
    expect(turn.reply).toContain('Where should this work live');

    // Two fields in one message: the asked one is confirmed, the other inferred.
    turn = await say(
      api,
      projectId,
      'scope: apps/client and packages/contracts\ndone: the form saves and reloads',
    );
    const fields = turn.response.project.projection.brief.fields;
    expect(fields.scope).toMatchObject({ state: 'confirmed' });
    expect(fields.doneMeans).toMatchObject({
      state: 'inferred',
      source: 'coordinator',
    });
    expect(turn.reply).toContain(
      'I have done means as "the form saves and reloads". Is that right?',
    );
    expect(turn.response.project.brief.markdown).toContain(
      '_(inferred, unconfirmed)_',
    );

    // Correct the inferred value, then it is asked no more.
    turn = await say(
      api,
      projectId,
      'the form saves, reloads, and passes contract-check',
    );
    expect(
      turn.response.project.projection.brief.fields.doneMeans,
    ).toMatchObject({
      state: 'corrected',
      value: 'the form saves, reloads, and passes contract-check',
    });
    expect(turn.response.project.summary.briefReady).toBe(true);
    // Required fields are settled: the Method offer appears exactly once.
    const offers = Object.values(
      turn.response.project.projection.proposals,
    ).filter((p) => p.kind === 'set_method');
    expect(offers).toHaveLength(1);
    expect(turn.reply).toContain('constraints');

    turn = await say(api, projectId, 'skip');
    expect(
      turn.response.project.projection.brief.fields.constraints.state,
    ).toBe('skipped');
    await say(api, projectId, 'skip');
    turn = await say(api, projectId, 'Solo developers.');
    expect(turn.reply).toContain('The Overview is ready');
    expect(
      Object.values(turn.response.project.projection.proposals).filter(
        (p) => p.kind === 'set_method',
      ),
    ).toHaveLength(1);

    // Deterministic rendering and a field edit outside chat.
    const first = await api.project(projectId);
    const second = await api.project(projectId);
    expect(first.brief).toEqual(second.brief);
    expect(first.brief.markdown).toContain('## Done means');
    expect(first.brief.markdown).toContain('_Skipped._');
    const edited = await api.command(
      `/api/projects/${projectId}/brief/fields/goal`,
      {
        commandId: commandId(),
        expectedSequence: first.projection.brief.lastSequence,
        action: 'correct',
        value: 'An accessible, keyboard-first account preferences form.',
      },
    );
    expect(edited.project.projection.brief.fields.goal).toMatchObject({
      state: 'corrected',
      source: 'user',
    });
    expect(edited.project.brief.digest).not.toBe(first.brief.digest);
    const stale = await api.post(
      `/api/projects/${projectId}/brief/fields/goal`,
      {
        commandId: commandId(),
        expectedSequence: first.projection.brief.lastSequence,
        action: 'skip',
      },
    );
    expect(stale.statusCode).toBe(409);

    // After intake, a note is a note again.
    turn = await say(api, projectId, 'Thanks!');
    expect(turn.reply).toContain("I don't plan or disperse work yet");
    await api.service.close();
  });

  it('infers the goal from a work request when intake was skipped', async () => {
    const api = client(testConfig());
    const created = await api.command('/api/projects', {
      commandId: commandId(),
      name: 'Quick',
    });
    const projectId = created.project.projection.projectId;
    const turn = await say(api, projectId, 'Build a login page.');
    expect(turn.response.project.projection.brief.fields.goal).toMatchObject({
      state: 'inferred',
      value: 'login page',
      source: 'coordinator',
    });
    expect(
      Object.values(turn.response.project.projection.proposals).map(
        (p) => p.kind,
      ),
    ).toEqual(['plan']);
    await api.service.close();
  });
});

describe('Method is optional and pinned per task', () => {
  it('applies from the catalog, pins a snapshot at task start, and later overrides never change it', async () => {
    const api = client(testConfig());
    const catalog = (await api.get('/api/methods')).json();
    expect(catalog.methods.map((m: { title: string }) => m.title)).toEqual([
      'Careful',
      'Fast prototype',
      'Docs only',
    ]);
    const created = await api.command('/api/projects', {
      commandId: commandId(),
      name: 'Method',
    });
    const projectId = created.project.projection.projectId;
    expect(
      (
        await api.post(`/api/projects/${projectId}/method/overrides`, {
          commandId: commandId(),
          expectedSequence: created.project.projection.lastSequence,
          sectionId: 'hardRules',
          value: ['x'],
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await api.post(`/api/projects/${projectId}/method`, {
          commandId: commandId(),
          expectedSequence: created.project.projection.lastSequence,
          catalogId: 'method_nope',
          catalogVersion: '1.0.0',
        })
      ).statusCode,
    ).toBe(404);

    // An agent with a task started BEFORE the method: no snapshot.
    const agent = await api.command(`/api/projects/${projectId}/agents`, {
      commandId: commandId(),
      expectedSequence: created.project.projection.lastSequence,
      name: 'Interface systems',
      category: 'interface',
    });
    const agentId = agent.receipt.createdIds.agents![0]!;
    const threadId = agent.project.projection.agents[agentId]!.threadId;
    const early = await api.command(
      `/api/projects/${projectId}/threads/${agentId}/messages`,
      {
        commandId: commandId(),
        expectedSequence:
          agent.project.projection.threads[threadId]!.lastSequence,
        body: 'Sketch the layout',
        intent: 'start_work',
      },
    );
    const earlyTask = Object.values(early.project.projection.tasks)[0]!;
    expect(earlyTask.methodSnapshotId).toBeUndefined();

    const applied = await api.command(`/api/projects/${projectId}/method`, {
      commandId: commandId(),
      expectedSequence: early.project.projection.lastSequence,
      catalogId: 'method_fast-prototype',
      catalogVersion: '1.0.0',
    });
    expect(applied.project.projection.method).toMatchObject({
      version: 1,
      overrides: [],
    });
    expect(
      applied.project.projection.tasks[earlyTask.id]?.methodSnapshotId,
    ).toBeUndefined();

    // Stop, start again: the new task pins the method as it stands.
    const stopped = await api.command(
      `/api/projects/${projectId}/agents/${agentId}/stop`,
      {
        commandId: commandId(),
        expectedSequence:
          applied.project.projection.agents[agentId]!.lastSequence,
      },
    );
    const started = await api.command(
      `/api/projects/${projectId}/threads/${agentId}/messages`,
      {
        commandId: commandId(),
        expectedSequence:
          stopped.project.projection.threads[threadId]!.lastSequence,
        body: 'Build the layout for real',
        intent: 'start_work',
      },
    );
    const task = Object.values(started.project.projection.tasks).find(
      (t) => t.state === 'working',
    )!;
    expect(task.methodSnapshotId).toBeDefined();
    const snapshot =
      started.project.projection.methodSnapshots[task.methodSnapshotId!]!;
    expect(snapshot).toMatchObject({ taskId: task.id, methodVersion: 1 });
    expect(snapshot.resolved.hardRules).toEqual([
      'Write whole files; do not spend turns on precise edits.',
      'Never touch persistence, auth, or deployment code.',
      'Note every shortcut you take in the summary.',
    ]);

    // Override after the task started: method v2, snapshot untouched.
    const overridden = await api.command(
      `/api/projects/${projectId}/method/overrides`,
      {
        commandId: commandId(),
        expectedSequence: started.project.projection.method!.lastSequence,
        sectionId: 'hardRules',
        value: ['Mark every shortcut in a TODO.'],
      },
    );
    expect(overridden.project.projection.method).toMatchObject({ version: 2 });
    expect(
      resolveMethod(overridden.project.projection.method!).hardRules,
    ).toEqual(['Mark every shortcut in a TODO.']);
    expect(
      overridden.project.projection.methodSnapshots[task.methodSnapshotId!]
        ?.resolved.hardRules,
    ).toEqual([
      'Write whole files; do not spend turns on precise edits.',
      'Never touch persistence, auth, or deployment code.',
      'Note every shortcut you take in the summary.',
    ]);

    // A plan assigned now pins v2 on both tasks.
    const proposed = await say(
      api,
      projectId,
      'Build the export flow and store the archive.',
    );
    const proposal = Object.values(
      proposed.response.project.projection.proposals,
    ).find((p) => p.kind === 'plan' && p.state === 'open')!;
    expect(proposal.consequences.effects.map((e) => e.kind)).toContain(
      'pin_method',
    );
    const stoppedAgain = await api.command(
      `/api/projects/${projectId}/agents/${agentId}/stop`,
      {
        commandId: commandId(),
        expectedSequence:
          proposed.response.project.projection.agents[agentId]!.lastSequence,
      },
    );
    const assigned = await api.command(
      `/api/projects/${projectId}/proposals/${proposal.id}`,
      {
        commandId: commandId(),
        expectedSequence:
          stoppedAgain.project.projection.proposals[proposal.id]!.lastSequence,
        decision: 'approved',
      },
    );
    const planned = Object.values(assigned.project.projection.tasks).filter(
      (t) => t.planId,
    );
    expect(planned).toHaveLength(2);
    for (const item of planned) {
      expect(
        assigned.project.projection.methodSnapshots[item.methodSnapshotId!],
      ).toMatchObject({
        methodVersion: 2,
      });
    }
    expect(assigned.receipt.createdIds.methodSnapshots).toHaveLength(2);
    await api.service.close();
  });

  it('is offered by the coordinator and applied through the proposal', async () => {
    const api = client(testConfig());
    const created = await api.command('/api/projects', {
      commandId: commandId(),
      name: 'Offer',
    });
    const projectId = created.project.projection.projectId;
    await say(api, projectId, 'goal: a thing\nscope: here\ndone: works');
    const turn = await say(api, projectId, 'yes');
    let project = turn.response.project;
    let offer = Object.values(project.projection.proposals).find(
      (p) => p.kind === 'set_method',
    );
    if (!offer) {
      // Two inferred fields still need confirming.
      project = (await say(api, projectId, 'yes')).response.project;
      offer = Object.values(project.projection.proposals).find(
        (p) => p.kind === 'set_method',
      );
    }
    expect(offer).toBeDefined();
    const approved = await api.command(
      `/api/projects/${projectId}/proposals/${offer!.id}`,
      {
        commandId: commandId(),
        expectedSequence: offer!.lastSequence,
        decision: 'approved',
      },
    );
    expect(approved.project.projection.method?.definition.title).toBe(
      'Careful',
    );
    await api.service.close();
  });

  it('dismisses an open Method offer when a Method is applied directly', async () => {
    const api = client(testConfig());
    const created = await api.command('/api/projects', {
      commandId: commandId(),
      name: 'Direct Method',
    });
    const projectId = created.project.projection.projectId;
    await say(api, projectId, 'goal: a thing\nscope: here\ndone: works');
    let project = (await say(api, projectId, 'yes')).response.project;
    let offer = Object.values(project.projection.proposals).find(
      (proposal) => proposal.kind === 'set_method',
    );
    if (!offer) {
      project = (await say(api, projectId, 'yes')).response.project;
      offer = Object.values(project.projection.proposals).find(
        (proposal) => proposal.kind === 'set_method',
      );
    }
    expect(offer?.state).toBe('open');

    const applied = await api.command(`/api/projects/${projectId}/method`, {
      commandId: commandId(),
      expectedSequence: project.projection.lastSequence,
      catalogId: 'method_fast-prototype',
      catalogVersion: '1.0.0',
    });
    expect(applied.project.projection.proposals[offer!.id]?.state).toBe(
      'dismissed',
    );
    expect(applied.project.summary.openProposalIds).toEqual([]);
    expect(applied.project.projection.method?.definition.id).toBe(
      'method_fast-prototype',
    );

    const staleApproval = await api.post(
      `/api/projects/${projectId}/proposals/${offer!.id}`,
      {
        commandId: commandId(),
        expectedSequence: offer!.lastSequence,
        decision: 'approved',
      },
    );
    expect(staleApproval.statusCode).toBe(409);
    expect(staleApproval.json().code).toBe('already_decided');
    await api.service.close();
  });
});
