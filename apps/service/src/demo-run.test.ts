import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DemoRunSnapshotSchema,
  LaunchDemoRunResponseSchema,
  WorkspaceResponseSchema,
} from '@harness/contracts';
import type { AppConfig } from '@harness/config';
import { createService } from './app.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function fixtureConfig(): AppConfig {
  const dataDirectory = mkdtempSync(join(tmpdir(), 'visual-demo-run-'));
  temporaryDirectories.push(dataDirectory);
  return {
    host: '127.0.0.1',
    port: 4317,
    dataDirectory,
    databasePath: join(dataDirectory, 'test.db'),
    sessionToken: 'b'.repeat(64),
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

function authorizedHeaders(config: AppConfig) {
  return {
    origin: 'http://127.0.0.1:5173',
    'x-harness-session': config.sessionToken,
  };
}

describe('complete simulated product loop', () => {
  it('advances through handoff, approval, failed validation, repair, and completion', async () => {
    const config = fixtureConfig();
    const service = createService(config);
    const headers = authorizedHeaders(config);

    const workspaceResponse = await service.inject({
      method: 'GET',
      url: '/api/workspace',
      headers,
    });
    const workspace = WorkspaceResponseSchema.parse(workspaceResponse.json());
    expect(workspace.activeRun).toBeUndefined();
    expect(workspace.workspace.plan.tasks).toHaveLength(2);
    expect(workspace.workspace.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'agent-interface-systems',
          kind: 'agent',
          availability: 'active',
        }),
        expect.objectContaining({
          id: 'agent-verification-review',
          kind: 'agent',
          availability: 'recommended',
        }),
        expect.objectContaining({
          id: 'system-repository-assessment',
          availability: 'dormant',
        }),
        expect.objectContaining({
          id: 'system-live-provider',
          availability: 'unavailable',
        }),
      ]),
    );

    const launchResponse = await service.inject({
      method: 'POST',
      url: '/api/demo-runs',
      headers,
      payload: { planVersionId: workspace.workspace.plan.id },
    });
    expect(launchResponse.statusCode).toBe(202);
    const { runId } = LaunchDemoRunResponseSchema.parse(launchResponse.json());

    const readSnapshot = async () => {
      const response = await service.inject({
        method: 'GET',
        url: `/api/demo-runs/${runId}`,
        headers,
      });
      expect(response.statusCode).toBe(200);
      return DemoRunSnapshotSchema.parse(response.json());
    };
    const advance = async (expectedSequence: number) => {
      const response = await service.inject({
        method: 'POST',
        url: `/api/demo-runs/${runId}/advance`,
        headers,
        payload: { expectedSequence },
      });
      expect(response.statusCode).toBe(200);
      return DemoRunSnapshotSchema.parse(response.json());
    };

    let snapshot = await readSnapshot();
    expect(snapshot.phase).toBe('interface_active');
    const firstCursor = snapshot.projection.lastSequence;

    const initialStream = await service.inject({
      method: 'GET',
      url: `/api/runs/${runId}/events?after=0`,
      headers,
    });
    expect(initialStream.statusCode).toBe(200);
    expect(initialStream.headers['content-type']).toContain(
      'text/event-stream',
    );
    expect(initialStream.body).toContain('event: domain-event');

    snapshot = await advance(snapshot.projection.lastSequence);
    expect(snapshot.phase).toBe('handoff_ready');
    expect(Object.values(snapshot.projection.dependencies)).toEqual([
      expect.objectContaining({ state: 'satisfied' }),
    ]);

    snapshot = await advance(snapshot.projection.lastSequence);
    expect(snapshot.phase).toBe('approval_required');
    const approval = Object.values(snapshot.projection.approvals)[0];
    if (!approval) throw new Error('Expected a pending approval.');

    const staleAdvance = await service.inject({
      method: 'POST',
      url: `/api/demo-runs/${runId}/advance`,
      headers,
      payload: { expectedSequence: firstCursor },
    });
    expect(staleAdvance.statusCode).toBe(409);

    const approvalResponse = await service.inject({
      method: 'POST',
      url: `/api/demo-runs/${runId}/approvals/${approval.id}`,
      headers,
      payload: {
        expectedSequence: snapshot.projection.lastSequence,
        decision: 'approved',
      },
    });
    snapshot = DemoRunSnapshotSchema.parse(approvalResponse.json());
    expect(snapshot.phase).toBe('approval_granted');

    snapshot = await advance(snapshot.projection.lastSequence);
    expect(snapshot.phase).toBe('repair_required');
    expect(snapshot.projection.attentionRequired).toBe(true);
    expect(Object.values(snapshot.projection.validations)).toEqual([
      expect.objectContaining({ status: 'passed' }),
      expect.objectContaining({ status: 'failed' }),
    ]);

    snapshot = await advance(snapshot.projection.lastSequence);
    expect(snapshot.phase).toBe('completed');
    expect(snapshot.projection.run.state).toBe('completed');
    expect(snapshot.projection.attentionRequired).toBe(false);
    expect(Object.values(snapshot.projection.tasks)).toEqual([
      expect.objectContaining({ state: 'completed' }),
      expect.objectContaining({ state: 'completed' }),
    ]);
    expect(Object.values(snapshot.projection.validations)).toEqual([
      expect.objectContaining({ status: 'passed' }),
      expect.objectContaining({ status: 'failed' }),
      expect.objectContaining({ status: 'passed' }),
    ]);

    const reconnect = await service.inject({
      method: 'GET',
      url: `/api/runs/${runId}/events?after=${snapshot.projection.lastSequence}`,
      headers,
    });
    expect(reconnect.body).not.toContain('event: domain-event');
    expect(reconnect.body).toContain(
      `"cursor":${snapshot.projection.lastSequence}`,
    );

    const completedProjection = snapshot.projection;
    await service.close();

    const restartedService = createService(config);
    const recoveredResponse = await restartedService.inject({
      method: 'GET',
      url: '/api/workspace',
      headers,
    });
    const recovered = WorkspaceResponseSchema.parse(recoveredResponse.json());
    expect(recovered.activeRun?.projection).toEqual(completedProjection);
    await restartedService.close();
  });

  it('keeps the newest repeated run selected after projection rebuild and restart', async () => {
    const config = fixtureConfig();
    const headers = authorizedHeaders(config);
    const service = createService(config);

    const launch = async () => {
      const response = await service.inject({
        method: 'POST',
        url: '/api/demo-runs',
        headers,
        payload: { planVersionId: 'planv_harness-demo-v1' },
      });
      expect(response.statusCode).toBe(202);
      return LaunchDemoRunResponseSchema.parse(response.json()).runId;
    };

    const firstRunId = await launch();
    const firstSnapshotResponse = await service.inject({
      method: 'GET',
      url: `/api/demo-runs/${firstRunId}`,
      headers,
    });
    const firstSnapshot = DemoRunSnapshotSchema.parse(
      firstSnapshotResponse.json(),
    );
    const cancelResponse = await service.inject({
      method: 'POST',
      url: `/api/demo-runs/${firstRunId}/cancel`,
      headers,
      payload: { expectedSequence: firstSnapshot.projection.lastSequence },
    });
    expect(cancelResponse.statusCode).toBe(200);
    expect(DemoRunSnapshotSchema.parse(cancelResponse.json()).phase).toBe(
      'cancelled',
    );

    const newestRunId = await launch();
    const currentResponse = await service.inject({
      method: 'GET',
      url: '/api/workspace',
      headers,
    });
    expect(
      WorkspaceResponseSchema.parse(currentResponse.json()).activeRun
        ?.projection.runId,
    ).toBe(newestRunId);
    await service.close();

    const restartedService = createService(config);
    const recoveredResponse = await restartedService.inject({
      method: 'GET',
      url: '/api/workspace',
      headers,
    });
    const recovered = WorkspaceResponseSchema.parse(recoveredResponse.json());
    expect(recovered.activeRun?.projection.runId).toBe(newestRunId);
    expect(recovered.activeRun?.phase).toBe('interface_active');
    await restartedService.close();
  });
});
