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
  type ProjectResponse,
} from '@harness/contracts';
import { replayProjectEvents } from '@harness/domain';
import { SqliteProjectStore, openHarnessDatabase } from '@harness/persistence';
import { createService } from './app.js';
import { ProjectService } from './projects.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function testConfig(demoProject = true): AppConfig {
  const dataDirectory = mkdtempSync(join(tmpdir(), 'visual-agent-planning-'));
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

let counter = 100;
function commandId(): string {
  counter += 1;
  return `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
}

const DEMO = 'project_harness-demo';

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
    async project(projectId = DEMO): Promise<ProjectResponse> {
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

async function tellCoordinator(api: Api, body: string, projectId = DEMO) {
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
  proposalId: string,
  decision: 'approved' | 'denied' | 'dismissed',
  projectId = DEMO,
) {
  const project = await api.project(projectId);
  const proposal = project.projection.proposals[proposalId]!;
  return api.post(`/api/projects/${projectId}/proposals/${proposalId}`, {
    commandId: commandId(),
    expectedSequence: proposal.lastSequence,
    decision,
  });
}

async function advance(api: Api, name: string, projectId = DEMO) {
  const project = await api.project(projectId);
  const agent = agentNamed(project, name);
  return api.post(`/api/projects/${projectId}/agents/${agent.id}/advance`, {
    commandId: commandId(),
    expectedSequence: agent.lastSequence,
  });
}

function openPlanProposal(project: ProjectResponse) {
  return Object.values(project.projection.proposals).find(
    (p) => p.kind === 'plan' && p.state === 'open',
  );
}

describe('dispersal through the coordinator', () => {
  it('proposes a plan with rationale, revises it on request, and assigns only the current version', async () => {
    const api = client(testConfig());
    const first = await tellCoordinator(
      api,
      'Build a preferences form with keyboard support.',
    );
    const v1 = openPlanProposal(first.project)!;
    expect(first.project.summary).toMatchObject({
      status: 'planning',
      attention: { kind: 'proposal', proposalId: v1.id },
    });
    const plan1 =
      first.project.projection.plans[
        (v1 as { payload: { planId: string } }).payload.planId
      ]!;
    expect(plan1.version).toBe(1);
    expect(plan1.tasks).toHaveLength(2);
    expect(plan1.tasks[0]).toMatchObject({
      title: 'Define the preferences form with keyboard support experience',
      agentName: 'Interface systems',
      category: 'interface',
      whySeparate: expect.any(String),
      whyThisAgent: expect.any(String),
      skills: expect.arrayContaining(['Accessible interface craft']),
      requiredChecks: ['contract-check'],
      modelTier: 'standard',
    });
    expect(plan1.tasks[1]).toMatchObject({ dependsOn: [0], modelTier: 'deep' });
    expect(Object.keys(first.project.projection.tasks)).toEqual([]);

    // Reassigning one row to the owner of another would violate the
    // one-active-task-per-agent invariant, so it is rejected as no change.
    const duplicateOwner = await tellCoordinator(
      api,
      'Assign service handoff to Interface systems.',
    );
    expect(openPlanProposal(duplicateOwner.project)?.id).toBe(v1.id);
    expect(Object.keys(duplicateOwner.project.projection.plans)).toEqual([
      plan1.id,
    ]);

    // Edit: combine into one agent → v2 supersedes v1.
    const second = await tellCoordinator(api, 'Combine into one agent.');
    const v2 = openPlanProposal(second.project)!;
    expect(v2.id).not.toBe(v1.id);
    expect(second.project.projection.proposals[v1.id]?.state).toBe(
      'superseded',
    );
    expect(
      second.project.projection.plans[plan1.id]?.supersededByPlanId,
    ).toBeDefined();
    const plan2 =
      second.project.projection.plans[
        (v2 as { payload: { planId: string } }).payload.planId
      ]!;
    expect(plan2).toMatchObject({ version: 2, request: plan1.request });
    expect(plan2.tasks).toHaveLength(1);
    expect(plan2.tasks[0]?.requiredChecks).toEqual([
      'contract-check',
      'experience-check',
    ]);

    // The superseded proposal cannot be decided.
    expect((await decide(api, v1.id, 'approved')).statusCode).toBe(409);

    // An edit nobody understands leaves the plan alone and says so.
    const third = await tellCoordinator(api, 'Reorder them backwards please.');
    expect(openPlanProposal(third.project)?.id).toBe(v2.id);
    const page = MessagesPageSchema.parse(
      (
        await api.get(`/api/projects/${DEMO}/threads/coordinator/messages`)
      ).json(),
    );
    expect(page.messages.at(-1)?.body).toContain(
      'could not turn that into a plan change',
    );

    // Approve v2 → one task on the existing Interface agent, in one command.
    const approved = await decide(api, v2.id, 'approved');
    expect(approved.statusCode).toBe(200);
    const response = CommandResponseSchema.parse(approved.json());
    const tasks = Object.values(response.project.projection.tasks);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      planId: plan2.id,
      planTaskIndex: 0,
      state: 'working',
      agentId: agentNamed(response.project, 'Interface systems').id,
    });
    expect(
      response.project.projection.plans[plan2.id]?.assignedAtSequence,
    ).toBeDefined();
    expect(response.receipt.createdIds.agents).toBeUndefined();
    expect(response.project.summary.status).toBe('working');
    expect((await decide(api, v2.id, 'approved')).json().code).toBe(
      'already_decided',
    );
    await api.service.close();
  });

  it('assigns directly on "just do it", creating agents that do not exist yet', async () => {
    const api = client(testConfig(false));
    const created = await api.command('/api/projects', {
      commandId: commandId(),
      name: 'Fresh',
    });
    const projectId = created.project.projection.projectId;
    const response = await tellCoordinator(
      api,
      'Just do it: build a login page.',
      projectId,
    );
    expect(openPlanProposal(response.project)).toBeUndefined();
    const plans = Object.values(response.project.projection.plans);
    expect(plans).toHaveLength(1);
    expect(plans[0]?.assignedAtSequence).toBeDefined();
    expect(plans[0]?.proposalId).toBeUndefined();
    expect(response.receipt.createdIds.agents).toHaveLength(2);
    expect(
      Object.values(response.project.projection.tasks).map((t) => t.state),
    ).toEqual(['working', 'waiting']);
    expect(response.project.summary.agentCounts).toMatchObject({
      working: 1,
      waiting: 1,
    });
    await api.service.close();
  });

  it('records a scope request in the Brief only when approved, and dismissal is honest', async () => {
    const api = client(testConfig());
    const response = await tellCoordinator(
      api,
      'Only touch apps/client for this one.',
    );
    const proposal = Object.values(response.project.projection.proposals)[0]!;
    expect(proposal).toMatchObject({
      kind: 'record_request',
      payload: { category: 'scope' },
    });
    expect((await decide(api, proposal.id, 'dismissed')).statusCode).toBe(200);
    let project = await api.project();
    expect(project.projection.proposals[proposal.id]?.state).toBe('dismissed');
    expect(project.projection.brief.requests).toEqual([]);

    const again = await tellCoordinator(
      api,
      "Don't touch the service package.",
    );
    const second = Object.values(again.project.projection.proposals).find(
      (p) => p.state === 'open',
    )!;
    await decide(api, second.id, 'approved');
    project = await api.project();
    expect(project.projection.brief.requests).toHaveLength(1);
    expect(project.brief.markdown).toContain(
      "Don't touch the service package.",
    );
    await api.service.close();
  });

  it('leaves no partial state when dispersal fails mid-way', async () => {
    const config = testConfig(false);
    const api = client(config);
    const created = await api.command('/api/projects', {
      commandId: commandId(),
      name: 'Atomic',
    });
    const projectId = created.project.projection.projectId;
    // Make "Backend orchestration" exist and busy so row 1 of the plan is refused.
    const agent = await api.command(`/api/projects/${projectId}/agents`, {
      commandId: commandId(),
      expectedSequence: created.project.projection.lastSequence,
      name: 'Backend orchestration',
      category: 'orchestration',
    });
    const backend = agentNamed(agent.project, 'Backend orchestration');
    await api.command(
      `/api/projects/${projectId}/threads/${backend.id}/messages`,
      {
        commandId: commandId(),
        expectedSequence:
          agent.project.projection.threads[backend.threadId]!.lastSequence,
        body: 'Warm up the cache',
        intent: 'start_work',
      },
    );
    const proposed = await tellCoordinator(
      api,
      'Build the settings page.',
      projectId,
    );
    const proposal = openPlanProposal(proposed.project)!;
    const before = await api.project(projectId);
    const refused = await decide(api, proposal.id, 'approved', projectId);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().code).toBe('agent_busy');
    const after = await api.project(projectId);
    expect(after.projection.lastSequence).toBe(before.projection.lastSequence);
    expect(Object.values(after.projection.agents).map((a) => a.name)).toEqual([
      'Backend orchestration',
    ]);
    expect(Object.values(after.projection.tasks)).toHaveLength(1);
    expect(after.projection.proposals[proposal.id]?.state).toBe('open');
    await api.service.close();

    // Injected storage failure during dispersal: same guarantee, then a clean retry.
    const database = openHarnessDatabase(config.databasePath);
    const store = new SqliteProjectStore(database.database);
    const service = new ProjectService(store, {
      now: () => '2026-03-01T00:00:00.000Z',
    });
    const pid = ProjectIdSchema.parse(projectId);
    const stopped = service.stopAgent(pid, backend.id, {
      commandId: commandId(),
      expectedSequence: after.projection.agents[backend.id]!.lastSequence,
    });
    const openProposal = stopped.project.projection.proposals[proposal.id]!;
    const id = commandId();
    const spy = vi.spyOn(store, 'saveReceipt').mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    expect(() =>
      service.decideProposal(pid, proposal.id, {
        commandId: id as never,
        expectedSequence: openProposal.lastSequence,
        decision: 'approved',
      }),
    ).toThrowError('disk full');
    expect(store.getProjection(pid)?.lastSequence).toBe(
      stopped.project.projection.lastSequence,
    );
    expect(Object.keys(store.getProjection(pid)!.agents)).toHaveLength(1);
    const retried = service.decideProposal(pid, proposal.id, {
      commandId: id as never,
      expectedSequence: openProposal.lastSequence,
      decision: 'approved',
    });
    expect(retried.receipt.createdIds.agents).toHaveLength(1);
    expect(Object.values(retried.project.projection.tasks)).toHaveLength(3);
    spy.mockRestore();
    database.close();
  });
});

describe('independent advancement, asks, checks, and handoffs', () => {
  it('repairs the baseline failed check before direct orchestration work can finish', async () => {
    const api = client(testConfig());
    let project = await api.project();
    const backend = agentNamed(project, 'Backend orchestration');
    const started = await api.command(
      `/api/projects/${DEMO}/threads/${backend.id}/messages`,
      {
        commandId: commandId(),
        expectedSequence:
          project.projection.threads[backend.threadId]!.lastSequence,
        body: 'Implement a direct service task',
        intent: 'start_work',
      },
    );
    const task =
      started.project.projection.tasks[
        agentNamed(started.project, 'Backend orchestration').currentTaskId!
      ]!;
    expect(task.requiredChecks).toEqual(['experience-check']);

    const asked = CommandResponseSchema.parse(
      (await advance(api, 'Backend orchestration')).json(),
    );
    const askId = asked.project.summary.openAskIds[0]!;
    const current = agentNamed(asked.project, 'Backend orchestration');
    await api.command(
      `/api/projects/${DEMO}/agents/${current.id}/asks/${askId}`,
      {
        commandId: commandId(),
        expectedSequence: current.lastSequence,
        decision: 'approved',
      },
    );

    const failed = CommandResponseSchema.parse(
      (await advance(api, 'Backend orchestration')).json(),
    );
    expect(failed.project.summary.status).toBe('reviewing');
    const repaired = CommandResponseSchema.parse(
      (await advance(api, 'Backend orchestration')).json(),
    );
    expect(
      Object.values(repaired.project.projection.checks).map(
        (check) => check.state,
      ),
    ).toEqual(['failed', 'passed']);
    expect(Object.values(repaired.project.projection.outputs)).toHaveLength(1);

    project = CommandResponseSchema.parse(
      (await advance(api, 'Backend orchestration')).json(),
    ).project;
    expect(agentNamed(project, 'Backend orchestration').work).toBe('done');
    await api.service.close();
  });

  it('walks two agents through their scripts with a real handoff and replays identically', async () => {
    const config = testConfig();
    const api = client(config);
    const proposed = await tellCoordinator(
      api,
      'Build the account preferences loop.',
    );
    await decide(api, openPlanProposal(proposed.project)!.id, 'approved');
    let project = await api.project();
    const iface = agentNamed(project, 'Interface systems');
    const backend = agentNamed(project, 'Backend orchestration');
    expect(iface.work).toBe('working');
    expect(backend.work).toBe('waiting');

    // Backend cannot move while waiting; Interface can.
    expect((await advance(api, 'Backend orchestration')).statusCode).toBe(409);
    expect((await advance(api, 'Interface systems')).statusCode).toBe(200); // contract
    expect((await advance(api, 'Interface systems')).statusCode).toBe(200); // check
    const done = CommandResponseSchema.parse(
      (await advance(api, 'Interface systems')).json(),
    );
    project = done.project;
    expect(agentNamed(project, 'Interface systems').work).toBe('done');
    // Handoff: backend received the contract and started, in the same command.
    const backendTask =
      project.projection.tasks[
        agentNamed(project, 'Backend orchestration').currentTaskId!
      ]!;
    expect(backendTask).toMatchObject({
      state: 'working',
      inputsSatisfied: [iface.currentTaskId],
    });
    const backendPage = MessagesPageSchema.parse(
      (
        await api.get(`/api/projects/${DEMO}/threads/${backend.id}/messages`)
      ).json(),
    );
    expect(backendPage.messages.at(-1)?.body).toContain(
      'Received Interface contract from Interface systems',
    );
    expect((await advance(api, 'Interface systems')).statusCode).toBe(409);

    // Backend asks before writing.
    const asked = CommandResponseSchema.parse(
      (await advance(api, 'Backend orchestration')).json(),
    );
    expect(agentNamed(asked.project, 'Backend orchestration').work).toBe(
      'needs_you',
    );
    expect(asked.project.summary).toMatchObject({
      status: 'needs_you',
      attention: { kind: 'ask', agentId: backend.id },
    });
    const askId = asked.project.summary.openAskIds[0]!;
    expect((await advance(api, 'Backend orchestration')).json().code).toBe(
      'invalid_transition',
    );
    const approved = await api.command(
      `/api/projects/${DEMO}/agents/${backend.id}/asks/${askId}`,
      {
        commandId: commandId(),
        expectedSequence: agentNamed(asked.project, 'Backend orchestration')
          .lastSequence,
        decision: 'approved',
      },
    );
    expect(agentNamed(approved.project, 'Backend orchestration').work).toBe(
      'working',
    );
    expect(approved.project.projection.asks[askId]?.state).toBe('approved');
    const twice = await api.post(
      `/api/projects/${DEMO}/agents/${backend.id}/asks/${askId}`,
      {
        commandId: commandId(),
        expectedSequence: agentNamed(approved.project, 'Backend orchestration')
          .lastSequence,
        decision: 'approved',
      },
    );
    expect(twice.json().code).toBe('ask_not_open');

    // Failed check → reviewing; repaired check → working; finish → complete.
    const failed = CommandResponseSchema.parse(
      (await advance(api, 'Backend orchestration')).json(),
    );
    expect(failed.project.summary).toMatchObject({
      status: 'reviewing',
      attention: { kind: 'check_failed', agentId: backend.id },
    });
    const repaired = CommandResponseSchema.parse(
      (await advance(api, 'Backend orchestration')).json(),
    );
    expect(repaired.project.summary.status).toBe('working');
    const checks = Object.values(repaired.project.projection.checks).filter(
      (c) => c.name === 'experience-check',
    );
    expect(checks.map((c) => c.state)).toEqual(['failed', 'passed']);
    expect(checks[1]?.retryOf).toBe(checks[0]?.id);
    const finished = CommandResponseSchema.parse(
      (await advance(api, 'Backend orchestration')).json(),
    );
    expect(finished.project.summary.status).toBe('complete');
    expect(
      Object.values(finished.project.projection.outputs)
        .map((o) => o.kind)
        .sort(),
    ).toEqual(['contract', 'diff']);

    // Restart: identical.
    const before = await api.project();
    await api.service.close();
    const again = client(config);
    const after = await again.project();
    expect(after).toEqual(before);
    const events = (await again.get(`/api/projects/${DEMO}/events`)).json();
    expect(replayProjectEvents(events.events)).toEqual(after.projection);
    await again.service.close();
  });

  it('denying an ask fails only that task; stopping with an open ask closes it', async () => {
    const api = client(testConfig());
    const proposed = await tellCoordinator(api, 'Build the export flow.');
    await decide(api, openPlanProposal(proposed.project)!.id, 'approved');
    await advance(api, 'Interface systems');
    await advance(api, 'Interface systems');
    await advance(api, 'Interface systems');
    const asked = CommandResponseSchema.parse(
      (await advance(api, 'Backend orchestration')).json(),
    );
    const backend = agentNamed(asked.project, 'Backend orchestration');
    const askId = asked.project.summary.openAskIds[0]!;
    const denied = await api.command(
      `/api/projects/${DEMO}/agents/${backend.id}/asks/${askId}`,
      {
        commandId: commandId(),
        expectedSequence: backend.lastSequence,
        decision: 'denied',
        note: 'Not in this repo.',
      },
    );
    expect(agentNamed(denied.project, 'Backend orchestration').work).toBe(
      'failed',
    );
    expect(agentNamed(denied.project, 'Interface systems').work).toBe('done');
    expect(denied.project.projection.asks[askId]).toMatchObject({
      state: 'denied',
      note: 'Not in this repo.',
    });
    expect(denied.project.summary.status).toBe('idle');

    // New work on the failed agent via its own thread, then an ask, then stop.
    const failedAgent = agentNamed(denied.project, 'Backend orchestration');
    const started = await api.command(
      `/api/projects/${DEMO}/threads/${failedAgent.id}/messages`,
      {
        commandId: commandId(),
        expectedSequence:
          denied.project.projection.threads[failedAgent.threadId]!.lastSequence,
        body: 'Try the export again with a stub',
        intent: 'start_work',
      },
    );
    expect(agentNamed(started.project, 'Backend orchestration').work).toBe(
      'working',
    );
    const askedAgain = CommandResponseSchema.parse(
      (await advance(api, 'Backend orchestration')).json(),
    );
    const secondAsk = askedAgain.project.summary.openAskIds[0]!;
    const stopped = await api.command(
      `/api/projects/${DEMO}/agents/${failedAgent.id}/stop`,
      {
        commandId: commandId(),
        expectedSequence: agentNamed(
          askedAgain.project,
          'Backend orchestration',
        ).lastSequence,
      },
    );
    expect(stopped.project.projection.asks[secondAsk]?.state).toBe('closed');
    expect(agentNamed(stopped.project, 'Backend orchestration').work).toBe(
      'stopped',
    );
    expect(stopped.project.summary.openAskIds).toEqual([]);
    await api.service.close();
  });
});
