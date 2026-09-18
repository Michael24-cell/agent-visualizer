import {
  NormalizedRuntimeEventSchema,
  RuntimeCapabilitiesSchema,
  type NormalizedRuntimeEvent,
  type RuntimeAdapter,
  type RuntimeTaskInput,
} from '@harness/contracts';
import {
  SimulatedRuntimeConfigurationSchema,
  simulatedScenarios,
} from './scenarios.js';

const BASE_TIME = Date.parse('2026-01-01T00:00:00.000Z');

function timeFor(ordinal: number): string {
  return new Date(BASE_TIME + ordinal * 1_000).toISOString();
}

export class SimulatedRuntimeAdapter implements RuntimeAdapter {
  readonly id = 'simulated';
  readonly version = '1.0.0';
  readonly protocolVersion = 1;

  async getCapabilities() {
    return RuntimeCapabilitiesSchema.parse({
      interrupt: true,
      approvals: true,
      reconciliation: true,
      steering: false,
      usageReporting: false,
      fileChangeEvents: false,
      stableEventIds: true,
    });
  }

  async validateConfiguration(input: unknown) {
    const result = SimulatedRuntimeConfigurationSchema.safeParse(input);
    return {
      valid: result.success,
      errors: result.success
        ? []
        : result.error.issues.map((issue) => issue.message),
    };
  }

  async *startTask(
    input: RuntimeTaskInput,
  ): AsyncIterable<NormalizedRuntimeEvent> {
    const configuration = SimulatedRuntimeConfigurationSchema.parse(
      input.configuration,
    );
    const templates = simulatedScenarios[configuration.scenario];

    for (const [index, template] of templates.entries()) {
      const ordinal = index + 1;
      yield NormalizedRuntimeEventSchema.parse({
        id: `sim.${configuration.scenario}.${ordinal}`,
        ordinal,
        occurredAt: timeFor(ordinal),
        runId: input.runId,
        taskId: input.taskId,
        agentInstanceId: input.agentInstanceId,
        type: template.type,
        payload: template.payload,
        providerMetadata: { scenario: configuration.scenario },
      });
    }
  }

  async interrupt(
    input: RuntimeTaskInput & { readonly reason: string },
  ): Promise<NormalizedRuntimeEvent> {
    return NormalizedRuntimeEventSchema.parse({
      id: 'sim.interrupt.1',
      ordinal: 1,
      occurredAt: timeFor(1),
      runId: input.runId,
      taskId: input.taskId,
      agentInstanceId: input.agentInstanceId,
      type: 'task.cancelled',
      payload: { reason: input.reason },
      providerMetadata: { control: 'interrupt' },
    });
  }

  async respondToApproval(
    input: RuntimeTaskInput & { readonly decision: 'approved' | 'denied' },
  ): Promise<NormalizedRuntimeEvent> {
    return NormalizedRuntimeEventSchema.parse({
      id: 'sim.approval-response.1',
      ordinal: 1,
      occurredAt: timeFor(1),
      runId: input.runId,
      taskId: input.taskId,
      agentInstanceId: input.agentInstanceId,
      type: 'approval.decided',
      payload: { decision: input.decision },
      providerMetadata: { control: 'approval-response' },
    });
  }

  async reconcile(input: RuntimeTaskInput): Promise<NormalizedRuntimeEvent> {
    return NormalizedRuntimeEventSchema.parse({
      id: 'sim.reconcile.1',
      ordinal: 1,
      occurredAt: timeFor(1),
      runId: input.runId,
      taskId: input.taskId,
      agentInstanceId: input.agentInstanceId,
      type: 'runtime.reconciled',
      payload: {
        outcome: 'reconnected',
        reason: 'The deterministic adapter reconciled the session.',
      },
      providerMetadata: { control: 'reconcile' },
    });
  }
}
