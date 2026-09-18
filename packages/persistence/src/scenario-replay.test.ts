import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AgentInstanceIdSchema,
  DomainEventSchema,
  PlanVersionIdSchema,
  RunIdSchema,
  TaskIdSchema,
} from '@harness/contracts';
import { executeRuntimeRun } from '@harness/domain';
import {
  SimulatedRuntimeAdapter,
  SimulatedScenarioIdSchema,
  type SimulatedScenarioId,
} from '@harness/runtime-simulated';
import { SqliteEventStore, openHarnessDatabase } from './index.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function createDatabasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'visual-agent-events-'));
  temporaryDirectories.push(directory);
  return join(directory, 'test.db');
}

function idsFor(scenario: SimulatedScenarioId) {
  return {
    runId: RunIdSchema.parse(`run_${scenario}`),
    planVersionId: PlanVersionIdSchema.parse(`planv_${scenario}`),
    taskId: TaskIdSchema.parse(`task_${scenario}`),
    agentInstanceId: AgentInstanceIdSchema.parse(`agent_${scenario}`),
  };
}

describe('simulated scenario persistence', () => {
  it.each(SimulatedScenarioIdSchema.options)(
    'executes and persists the %s scenario',
    async (scenario) => {
      const connection = openHarnessDatabase(createDatabasePath());
      const store = new SqliteEventStore(connection.database);
      const ids = idsFor(scenario);

      const projection = await executeRuntimeRun(
        new SimulatedRuntimeAdapter(),
        store,
        {
          ...ids,
          goal: `Exercise ${scenario}.`,
          taskTitle: `Fixture: ${scenario}`,
          runtimeConfiguration: { scenario },
        },
      );

      const expectedState = {
        'successful-task': 'completed',
        'validation-failure': 'failed',
        'approval-request': 'completed',
        cancellation: 'cancelled',
        'disconnect-reconciliation': 'completed',
      }[scenario];
      expect(projection.run.state).toBe(expectedState);
      expect(projection.tasks[ids.taskId]?.state).toBe(expectedState);
      expect(projection.agents[ids.agentInstanceId]?.state).toBe(expectedState);

      if (scenario === 'approval-request') {
        expect(Object.values(projection.approvals)).toEqual([
          expect.objectContaining({ state: 'approved' }),
        ]);
      }
      if (scenario === 'validation-failure') {
        expect(projection.attentionRequired).toBe(true);
      }
      if (scenario === 'disconnect-reconciliation') {
        expect(projection.runtimeConnection).toBe('reconciled');
        expect(projection.recoverySummary).toContain('reconnected');
      }

      const terminalRunEvents = store
        .listEvents(ids.runId)
        .filter(
          (event) =>
            event.type === 'run.state_changed' &&
            ['completed', 'failed', 'cancelled'].includes(event.payload.to),
        );
      expect(terminalRunEvents).toHaveLength(1);
      const terminalTaskEvents = store
        .listEvents(ids.runId)
        .filter(
          (event) =>
            event.type === 'task.state_changed' &&
            ['completed', 'failed', 'cancelled'].includes(event.payload.to),
        );
      const terminalAgentEvents = store
        .listEvents(ids.runId)
        .filter(
          (event) =>
            event.type === 'agent.state_changed' &&
            ['completed', 'failed', 'cancelled'].includes(event.payload.to),
        );
      expect(terminalTaskEvents).toHaveLength(1);
      expect(terminalAgentEvents).toHaveLength(1);
      connection.close();
    },
  );

  it('reconstructs an identical projection after restart and repeated replay', async () => {
    const databasePath = createDatabasePath();
    const ids = idsFor('disconnect-reconciliation');
    const firstConnection = openHarnessDatabase(databasePath);
    const firstStore = new SqliteEventStore(firstConnection.database);
    const beforeRestart = await executeRuntimeRun(
      new SimulatedRuntimeAdapter(),
      firstStore,
      {
        ...ids,
        goal: 'Recover a disconnected runtime.',
        taskTitle: 'Disconnect recovery fixture',
        runtimeConfiguration: { scenario: 'disconnect-reconciliation' },
      },
    );

    const persistedEvents = firstStore.listEvents(ids.runId);
    const firstEvent = persistedEvents[0];
    if (!firstEvent) throw new Error('Expected a persisted event.');
    expect(firstStore.append(firstEvent)).toEqual(beforeRestart);
    const providerEvent = persistedEvents.find(
      (event) => event.providerMetadata !== undefined,
    );
    if (!providerEvent) throw new Error('Expected provider metadata.');
    expect(firstStore.append(providerEvent)).toEqual(beforeRestart);

    const eventCount = persistedEvents.length;
    expect(() =>
      firstConnection.database
        .prepare('UPDATE events SET source = ? WHERE id = ?')
        .run('system', firstEvent.id),
    ).toThrow(/append-only/);
    expect(() =>
      firstConnection.database
        .prepare('DELETE FROM events WHERE id = ?')
        .run(firstEvent.id),
    ).toThrow(/append-only/);
    const invalidTerminalEvent = DomainEventSchema.parse({
      id: 'event_transaction_invalid-terminal',
      type: 'run.state_changed',
      version: 1,
      sequence: beforeRestart.lastSequence + 1,
      occurredAt: '2026-01-01T00:01:00.000Z',
      recordedAt: '2026-01-01T00:01:00.000Z',
      runId: ids.runId,
      causationId: beforeRestart.lastEventId,
      source: 'orchestrator',
      payload: {
        from: 'completed',
        to: 'completed',
        reason: 'Duplicate terminal state.',
      },
    });
    expect(() => firstStore.append(invalidTerminalEvent)).toThrow();
    expect(firstStore.listEvents(ids.runId)).toHaveLength(eventCount);
    expect(firstStore.getProjection(ids.runId)).toEqual(beforeRestart);
    firstConnection.close();

    const secondConnection = openHarnessDatabase(databasePath);
    const secondStore = new SqliteEventStore(secondConnection.database);
    expect(secondStore.getProjection(ids.runId)).toEqual(beforeRestart);

    secondConnection.database
      .prepare('DELETE FROM run_projections WHERE run_id = ?')
      .run(ids.runId);
    const firstReplay = secondStore.rebuildProjection(ids.runId);
    const secondReplay = secondStore.rebuildProjection(ids.runId);
    expect(firstReplay).toEqual(beforeRestart);
    expect(secondReplay).toEqual(beforeRestart);
    secondConnection.close();
  });
});
