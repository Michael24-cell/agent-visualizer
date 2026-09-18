import { describe, expect, it } from 'vitest';
import {
  AgentInstanceIdSchema,
  NormalizedRuntimeEventSchema,
  PlanVersionIdSchema,
  RunIdSchema,
  TaskIdSchema,
  type DomainEvent,
  type RuntimeAdapter,
} from '@harness/contracts';
import {
  applyDomainEvent,
  type DomainEventSink,
  type RunProjection,
} from './projections.js';
import { executeRuntimeRun } from './runtime-executor.js';

class MemorySink implements DomainEventSink {
  projection: RunProjection | undefined;

  append(event: DomainEvent): RunProjection {
    this.projection = applyDomainEvent(this.projection, event);
    return this.projection;
  }

  getProjection(): RunProjection | undefined {
    return this.projection;
  }
}

describe('runtime executor boundary', () => {
  it('rejects a normalized event for a different run before persisting it', async () => {
    const runId = RunIdSchema.parse('run_runtime-boundary');
    const taskId = TaskIdSchema.parse('task_runtime-boundary');
    const agentInstanceId = AgentInstanceIdSchema.parse(
      'agent_runtime-boundary',
    );
    const adapter: RuntimeAdapter = {
      id: 'boundary-fixture',
      version: '1.0.0',
      protocolVersion: 1,
      async getCapabilities() {
        return {
          interrupt: false,
          approvals: false,
          reconciliation: false,
          steering: false,
          usageReporting: false,
          fileChangeEvents: false,
          stableEventIds: true,
        };
      },
      async validateConfiguration() {
        return { valid: true, errors: [] };
      },
      async *startTask() {
        yield NormalizedRuntimeEventSchema.parse({
          id: 'boundary.event.1',
          ordinal: 1,
          occurredAt: '2026-01-01T00:00:01.000Z',
          runId: RunIdSchema.parse('run_wrong'),
          taskId,
          agentInstanceId,
          type: 'task.started',
          payload: { activity: 'This event belongs to another run.' },
        });
      },
    };
    const sink = new MemorySink();

    await expect(
      executeRuntimeRun(adapter, sink, {
        runId,
        planVersionId: PlanVersionIdSchema.parse('planv_runtime-boundary'),
        taskId,
        agentInstanceId,
        goal: 'Validate the runtime boundary.',
        taskTitle: 'Runtime boundary fixture',
        runtimeConfiguration: {},
      }),
    ).rejects.toThrow(/does not belong to the active task/);
    expect(sink.projection).toMatchObject({
      run: { state: 'executing' },
      lastSequence: 9,
    });
  });
});
