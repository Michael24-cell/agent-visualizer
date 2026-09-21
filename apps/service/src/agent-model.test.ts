import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppConfig } from '@harness/config';
import {
  CommandResponseSchema,
  ProjectResponseSchema,
  type CommandResponse,
} from '@harness/contracts';
import { createService } from './app.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function testConfig(): AppConfig {
  const dataDirectory = mkdtempSync(join(tmpdir(), 'visual-agent-model-'));
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

describe('agent models', () => {
  it('defaults a new agent to sonnet, honours an explicit choice, and reports the runtime', async () => {
    const api = client(testConfig());
    const { project } = await api.command('/api/projects', {
      commandId: commandId(),
      name: 'Models',
    });
    const projectId = project.projection.projectId;
    expect(project.runtime).toEqual({ mode: 'simulated' });

    const first = await api.command(`/api/projects/${projectId}/agents`, {
      commandId: commandId(),
      expectedSequence: project.projection.lastSequence,
      name: 'Interface systems',
      category: 'interface',
    });
    const firstId = first.receipt.createdIds.agents![0]!;
    expect(first.project.projection.agents[firstId]!.model).toBe('sonnet');

    const second = await api.command(`/api/projects/${projectId}/agents`, {
      commandId: commandId(),
      expectedSequence: first.project.projection.lastSequence,
      name: 'Backend',
      category: 'orchestration',
      model: 'haiku',
    });
    const secondId = second.receipt.createdIds.agents![0]!;
    expect(second.project.projection.agents[secondId]!.model).toBe('haiku');
  });

  it('changes an agent model against the agent sequence and rejects no-ops', async () => {
    const api = client(testConfig());
    const { project } = await api.command('/api/projects', {
      commandId: commandId(),
      name: 'Models',
    });
    const projectId = project.projection.projectId;
    const created = await api.command(`/api/projects/${projectId}/agents`, {
      commandId: commandId(),
      expectedSequence: project.projection.lastSequence,
      name: 'Interface systems',
      category: 'interface',
    });
    const agentId = created.receipt.createdIds.agents![0]!;
    const agent = created.project.projection.agents[agentId]!;
    const url = `/api/projects/${projectId}/agents/${agentId}/model`;

    const changed = await api.command(url, {
      commandId: commandId(),
      expectedSequence: agent.lastSequence,
      model: 'opus',
    });
    const updated = changed.project.projection.agents[agentId]!;
    expect(updated.model).toBe('opus');
    expect(updated.lastSequence).toBeGreaterThan(agent.lastSequence);

    // Stale agent sequence.
    const stale = await api.post(url, {
      commandId: commandId(),
      expectedSequence: agent.lastSequence,
      model: 'haiku',
    });
    expect(stale.statusCode).toBe(409);

    // Same model again is rejected rather than recorded.
    const same = await api.post(url, {
      commandId: commandId(),
      expectedSequence: updated.lastSequence,
      model: 'opus',
    });
    expect(same.statusCode).toBeGreaterThanOrEqual(400);

    const read = ProjectResponseSchema.parse(
      (await api.get(`/api/projects/${projectId}`)).json(),
    );
    expect(read.projection.agents[agentId]!.model).toBe('opus');
  });

  it('gives plan agents a model from their tier', async () => {
    const api = client(testConfig());
    const { project } = await api.command('/api/projects', {
      commandId: commandId(),
      name: 'Models',
    });
    const projectId = project.projection.projectId;
    const coordinator = Object.values(project.projection.threads).find(
      (thread) => thread.kind === 'coordinator',
    )!;
    let response = await api.command(
      `/api/projects/${projectId}/threads/${coordinator.id}/messages`,
      {
        commandId: commandId(),
        expectedSequence: coordinator.lastSequence,
        body: 'Build a settings page with a preferences form and a service handoff.',
        intent: 'start_work',
      },
    );
    // Answer intake until a plan proposal appears, then approve it.
    for (let round = 0; round < 8; round += 1) {
      const proposal = Object.values(
        response.project.projection.proposals,
      ).find(
        (candidate) => candidate.kind === 'plan' && candidate.state === 'open',
      );
      if (proposal) {
        response = await api.command(
          `/api/projects/${projectId}/proposals/${proposal.id}`,
          {
            commandId: commandId(),
            expectedSequence: proposal.lastSequence,
            decision: 'approved',
          },
        );
        break;
      }
      const thread = response.project.projection.threads[coordinator.id]!;
      response = await api.command(
        `/api/projects/${projectId}/threads/${coordinator.id}/messages`,
        {
          commandId: commandId(),
          expectedSequence: thread.lastSequence,
          body: 'Yes, that is right.',
        },
      );
    }
    const agents = Object.values(response.project.projection.agents);
    expect(agents.length).toBeGreaterThan(0);
    for (const agent of agents) {
      expect(agent.model).toBe(
        agent.modelTier === 'deep'
          ? 'opus'
          : agent.modelTier === 'light'
            ? 'haiku'
            : 'sonnet',
      );
    }
    expect(agents.some((agent) => agent.model === 'opus')).toBe(true);
  });
});
