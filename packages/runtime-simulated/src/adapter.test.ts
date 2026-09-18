import { describe, expect, it } from 'vitest';
import {
  AgentInstanceIdSchema,
  RunIdSchema,
  TaskIdSchema,
  type NormalizedRuntimeEvent,
} from '@harness/contracts';
import { SimulatedRuntimeAdapter } from './adapter.js';
import {
  SimulatedScenarioIdSchema,
  type SimulatedScenarioId,
} from './scenarios.js';

const runtimeInput = {
  runId: RunIdSchema.parse('run_conformance'),
  taskId: TaskIdSchema.parse('task_conformance'),
  agentInstanceId: AgentInstanceIdSchema.parse('agent_conformance'),
};

async function collect(
  adapter: SimulatedRuntimeAdapter,
  scenario: SimulatedScenarioId,
): Promise<NormalizedRuntimeEvent[]> {
  const events: NormalizedRuntimeEvent[] = [];
  for await (const event of adapter.startTask({
    ...runtimeInput,
    configuration: { scenario },
  })) {
    events.push(event);
  }
  return events;
}

describe('simulated runtime adapter conformance', () => {
  it('implements every capability it claims', async () => {
    const adapter = new SimulatedRuntimeAdapter();
    const capabilities = await adapter.getCapabilities();
    expect(capabilities).toMatchObject({
      interrupt: true,
      approvals: true,
      reconciliation: true,
      stableEventIds: true,
    });
    expect(adapter.interrupt).toBeTypeOf('function');
    expect(adapter.respondToApproval).toBeTypeOf('function');
    expect(adapter.reconcile).toBeTypeOf('function');
  });

  it.each(SimulatedScenarioIdSchema.options)(
    'emits deterministic, ordered, uniquely identified %s events',
    async (scenario) => {
      const adapter = new SimulatedRuntimeAdapter();
      const first = await collect(adapter, scenario);
      const second = await collect(adapter, scenario);
      expect(second).toEqual(first);
      expect(first.map((event) => event.ordinal)).toEqual(
        first.map((_, index) => index + 1),
      );
      expect(new Set(first.map((event) => event.id)).size).toBe(first.length);
      expect(JSON.stringify(first)).not.toMatch(/password|api[_-]?key|secret/i);
    },
  );

  it('emits one bounded terminal signal for every scenario', async () => {
    const adapter = new SimulatedRuntimeAdapter();
    for (const scenario of SimulatedScenarioIdSchema.options) {
      const events = await collect(adapter, scenario);
      const terminals = events.filter(
        (event) =>
          ['task.completed', 'task.failed', 'task.cancelled'].includes(
            event.type,
          ) ||
          (event.type === 'validation.finished' &&
            event.payload.status === 'failed'),
      );
      expect(terminals, scenario).toHaveLength(1);
    }
  });

  it('models cancellation and disconnect reconciliation explicitly', async () => {
    const adapter = new SimulatedRuntimeAdapter();
    const cancellation = await collect(adapter, 'cancellation');
    expect(cancellation.at(-1)?.type).toBe('task.cancelled');

    const recovery = await collect(adapter, 'disconnect-reconciliation');
    expect(recovery.map((event) => event.type)).toContain(
      'runtime.disconnected',
    );
    expect(recovery.map((event) => event.type)).toContain('runtime.reconciled');
  });
});
