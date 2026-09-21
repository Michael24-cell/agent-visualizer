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
import { replayProjectEvents, summarizeProject } from '@harness/domain';
import { SqliteProjectStore, openHarnessDatabase } from '@harness/persistence';
import { createService } from './app.js';

// Slice 5: everything Slices 1–4 built, recovered at once. One project
// exercises brief, method + override + snapshots, plans (superseded and
// assigned), proposals of every kind, asks, checks, outputs, handoffs, and
// a stopped agent; then the service restarts, projections are wiped and
// rebuilt, and every mutating command is retried with a stale sequence.

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function testConfig(): AppConfig {
  const dataDirectory = mkdtempSync(join(tmpdir(), 'visual-agent-recovery-'));
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

let counter = 900;
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

function coordinator(project: ProjectResponse) {
  return Object.values(project.projection.threads).find(
    (thread) => thread.kind === 'coordinator',
  )!;
}

function agentNamed(project: ProjectResponse, name: string) {
  return Object.values(project.projection.agents).find((a) => a.name === name)!;
}

async function say(api: Api, projectId: string, body: string) {
  const project = await api.project(projectId);
  return api.command(
    `/api/projects/${projectId}/threads/coordinator/messages`,
    {
      commandId: commandId(),
      expectedSequence: coordinator(project).lastSequence,
      body,
    },
  );
}

async function decide(
  api: Api,
  projectId: string,
  proposalId: string,
  decision: 'approved' | 'dismissed',
) {
  const project = await api.project(projectId);
  return api.command(`/api/projects/${projectId}/proposals/${proposalId}`, {
    commandId: commandId(),
    expectedSequence: project.projection.proposals[proposalId]!.lastSequence,
    decision,
  });
}

async function advance(api: Api, projectId: string, name: string) {
  const project = await api.project(projectId);
  const agent = agentNamed(project, name);
  return api.command(`/api/projects/${projectId}/agents/${agent.id}/advance`, {
    commandId: commandId(),
    expectedSequence: agent.lastSequence,
  });
}

// Builds the "everything" project and returns its id.
async function buildEverything(api: Api): Promise<string> {
  const created = await api.command('/api/projects', {
    commandId: commandId(),
    name: 'Everything',
  });
  const projectId = created.project.projection.projectId;
  await say(
    api,
    projectId,
    'goal: a billing export\nscope: apps/service\ndone: exports match the ledger',
  );
  await say(api, projectId, 'yes');
  let project = await api.project(projectId);
  if (project.projection.brief.fields.doneMeans.state === 'inferred') {
    await say(api, projectId, 'yes');
  }
  await say(api, projectId, 'skip');
  await say(api, projectId, 'checks: contract-check');
  await say(api, projectId, 'Finance team.');
  project = await api.project(projectId);
  const offer = Object.values(project.projection.proposals).find(
    (p) => p.kind === 'set_method',
  )!;
  await decide(api, projectId, offer.id, 'approved');
  project = await api.project(projectId);
  await api.command(`/api/projects/${projectId}/method/overrides`, {
    commandId: commandId(),
    expectedSequence: project.projection.method!.lastSequence,
    sectionId: 'preferences',
    value: ['One reviewer per handoff.'],
  });
  await say(api, projectId, "Don't touch the auth package.");
  project = await api.project(projectId);
  const request = Object.values(project.projection.proposals).find(
    (p) => p.kind === 'record_request' && p.state === 'open',
  )!;
  await decide(api, projectId, request.id, 'approved');
  await say(api, projectId, 'Build the billing export.');
  await say(api, projectId, 'Combine into one agent.');
  await say(api, projectId, 'Split into two agents.');
  project = await api.project(projectId);
  const plan = Object.values(project.projection.proposals).find(
    (p) => p.kind === 'plan' && p.state === 'open',
  )!;
  await decide(api, projectId, plan.id, 'approved');
  await advance(api, projectId, 'Interface systems');
  await advance(api, projectId, 'Interface systems');
  await advance(api, projectId, 'Interface systems');
  await advance(api, projectId, 'Backend orchestration'); // ask
  project = await api.project(projectId);
  const backend = agentNamed(project, 'Backend orchestration');
  await api.command(
    `/api/projects/${projectId}/agents/${backend.id}/asks/${project.summary.openAskIds[0]}`,
    {
      commandId: commandId(),
      expectedSequence: backend.lastSequence,
      decision: 'approved',
    },
  );
  await advance(api, projectId, 'Backend orchestration'); // failed check
  project = await api.project(projectId);
  await api.command(`/api/projects/${projectId}/agents/${backend.id}/stop`, {
    commandId: commandId(),
    expectedSequence: agentNamed(project, 'Backend orchestration').lastSequence,
  });
  project = await api.project(projectId);
  await api.command(`/api/projects/${projectId}/brief/fields/audience`, {
    commandId: commandId(),
    expectedSequence: project.projection.brief.lastSequence,
    action: 'correct',
    value: 'Finance and support teams.',
  });
  return projectId;
}

describe('recovery', () => {
  it('restarts, rebuilds from events alone, and keeps every entity identical', async () => {
    const config = testConfig();
    const api = client(config);
    const projectId = await buildEverything(api);
    const before = await api.project(projectId);
    const { projection } = before;
    // The project really has all of it.
    expect(projection.method?.version).toBe(2);
    expect(Object.keys(projection.methodSnapshots)).toHaveLength(2);
    expect(
      Object.values(projection.plans)
        .map((p) => p.version)
        .sort(),
    ).toEqual([1, 2, 3]);
    expect(
      Object.values(projection.proposals)
        .map((p) => p.kind)
        .sort(),
    ).toEqual(['plan', 'plan', 'plan', 'record_request', 'set_method']);
    expect(projection.brief.requests).toHaveLength(1);
    expect(Object.keys(projection.asks)).toHaveLength(1);
    expect(
      Object.values(projection.checks)
        .map((c) => c.state)
        .sort(),
    ).toEqual(['failed', 'passed']);
    expect(Object.keys(projection.outputs)).toHaveLength(1);
    expect(agentNamed(before, 'Interface systems').work).toBe('done');
    expect(agentNamed(before, 'Backend orchestration').work).toBe('stopped');
    expect(before.summary.status).toBe('partially_stopped');
    const threads = Object.values(projection.threads);
    const pagesBefore = await Promise.all(
      threads.map(async (thread) =>
        MessagesPageSchema.parse(
          (
            await api.get(
              `/api/projects/${projectId}/threads/${thread.id}/messages?limit=100`,
            )
          ).json(),
        ),
      ),
    );
    await api.service.close();

    // Restart: same everything, including the summary and the Brief bytes.
    const restarted = client(config);
    const after = await restarted.project(projectId);
    expect(after).toEqual(before);
    const pagesAfter = await Promise.all(
      threads.map(async (thread) =>
        MessagesPageSchema.parse(
          (
            await restarted.get(
              `/api/projects/${projectId}/threads/${thread.id}/messages?limit=100`,
            )
          ).json(),
        ),
      ),
    );
    expect(pagesAfter).toEqual(pagesBefore);
    await restarted.service.close();

    // Wipe the materialized projection; the events alone must rebuild it.
    const database = openHarnessDatabase(config.databasePath);
    database.database.prepare('DELETE FROM project_projections').run();
    const store = new SqliteProjectStore(database.database);
    expect(store.getProjection(projection.projectId)).toBeUndefined();
    const rebuilt = store.rebuildAllProjections();
    expect(rebuilt).toHaveLength(1);
    expect(rebuilt[0]).toEqual(projection);
    expect(replayProjectEvents(store.listEvents(projection.projectId))).toEqual(
      projection,
    );
    expect(summarizeProject(rebuilt[0]!)).toEqual(before.summary);
    database.close();

    // And the service boots on that too.
    const again = client(config);
    expect(await again.project(projectId)).toEqual(before);
    await again.service.close();
  });

  it('retries every mutating command idempotently even when its sequence is stale', async () => {
    const api = client(testConfig());
    const created = await api.command('/api/projects', {
      commandId: commandId(),
      name: 'Retry',
    });
    const projectId = created.project.projection.projectId;
    let project = await api.project(projectId);

    // Each entry: a command whose commandId we will replay later after the
    // project has moved on, plus a way to "move on".
    const attempts: Array<{ url: string; payload: object; status: number }> =
      [];
    const record = async (url: string, payload: object) => {
      const response = await api.post(url, payload);
      expect(response.statusCode).toBeLessThan(300);
      attempts.push({ url, payload, status: response.statusCode });
      project = await api.project(projectId);
      return CommandResponseSchema.parse(response.json());
    };

    await record(`/api/projects/${projectId}/agents`, {
      commandId: commandId(),
      expectedSequence: project.projection.lastSequence,
      name: 'Interface systems',
      category: 'interface',
    });
    const agent = agentNamed(project, 'Interface systems');
    await record(`/api/projects/${projectId}/threads/${agent.id}/messages`, {
      commandId: commandId(),
      expectedSequence:
        project.projection.threads[agent.threadId]!.lastSequence,
      body: 'Build the widget',
      intent: 'start_work',
    });
    await record(`/api/projects/${projectId}/agents/${agent.id}/advance`, {
      commandId: commandId(),
      expectedSequence: agentNamed(project, 'Interface systems').lastSequence,
    });
    await record(`/api/projects/${projectId}/brief/fields/goal`, {
      commandId: commandId(),
      expectedSequence: project.projection.brief.lastSequence,
      action: 'confirm',
      value: 'A widget',
    });
    await record(`/api/projects/${projectId}/method`, {
      commandId: commandId(),
      expectedSequence: project.projection.lastSequence,
      catalogId: 'method_fast-prototype',
      catalogVersion: '1.0.0',
    });
    await record(`/api/projects/${projectId}/method/overrides`, {
      commandId: commandId(),
      expectedSequence: project.projection.method!.lastSequence,
      sectionId: 'checks',
      value: ['contract-check'],
    });
    await record(`/api/projects/${projectId}/threads/coordinator/messages`, {
      commandId: commandId(),
      expectedSequence: coordinator(project).lastSequence,
      body: 'Only touch apps/client.',
    });
    const request = Object.values(project.projection.proposals).find(
      (p) => p.state === 'open',
    )!;
    await record(`/api/projects/${projectId}/proposals/${request.id}`, {
      commandId: commandId(),
      expectedSequence: request.lastSequence,
      decision: 'dismissed',
    });
    await record(`/api/projects/${projectId}/agents/${agent.id}/stop`, {
      commandId: commandId(),
      expectedSequence: agentNamed(project, 'Interface systems').lastSequence,
    });

    const settled = await api.project(projectId);
    const firstReplies: CommandResponse[] = [];
    for (const attempt of attempts) {
      const replay = await api.post(attempt.url, attempt.payload);
      expect(replay.statusCode).toBe(200);
      const body = CommandResponseSchema.parse(replay.json());
      expect(body.receipt.replayed).toBe(true);
      expect(body.receipt.commandId).toBe(
        (attempt.payload as { commandId: string }).commandId,
      );
      // The receipt is the original range; the project is the current one.
      expect(body.receipt.lastSequence).toBeLessThanOrEqual(
        settled.projection.lastSequence,
      );
      expect(body.project).toEqual(settled);
      firstReplies.push(body);
    }
    // Nothing was appended by the replays.
    expect((await api.project(projectId)).projection.lastSequence).toBe(
      settled.projection.lastSequence,
    );
    // Ranges are contiguous and ordered as the commands ran.
    const ranges = firstReplies.map((r) => ({
      first: r.receipt.firstSequence,
      last: r.receipt.lastSequence,
    }));
    for (let index = 1; index < ranges.length; index += 1) {
      const current = ranges[index]!;
      const previous = ranges[index - 1]!;
      expect(current.first).toBeGreaterThan(previous.last);
    }
    await api.service.close();
  });
});
