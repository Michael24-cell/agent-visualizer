import { z } from 'zod';

export const SimulatedScenarioIdSchema = z.enum([
  'successful-task',
  'validation-failure',
  'approval-request',
  'cancellation',
  'disconnect-reconciliation',
]);

export type SimulatedScenarioId = z.infer<typeof SimulatedScenarioIdSchema>;

export const SimulatedRuntimeConfigurationSchema = z.strictObject({
  scenario: SimulatedScenarioIdSchema,
});

export type SimulatedRuntimeConfiguration = z.infer<
  typeof SimulatedRuntimeConfigurationSchema
>;

export interface SimulatedEventTemplate {
  readonly type:
    | 'task.started'
    | 'artifact.produced'
    | 'approval.requested'
    | 'approval.decided'
    | 'validation.started'
    | 'validation.finished'
    | 'task.completed'
    | 'task.failed'
    | 'task.cancelled'
    | 'runtime.disconnected'
    | 'runtime.reconciled';
  readonly payload: Record<string, unknown>;
}

export const simulatedScenarios: Record<
  SimulatedScenarioId,
  readonly SimulatedEventTemplate[]
> = {
  'successful-task': [
    {
      type: 'task.started',
      payload: { activity: 'Implementing the fixture task.' },
    },
    {
      type: 'artifact.produced',
      payload: {
        artifactType: 'report',
        digest: 'sha256:fixture-success',
        location: 'memory://fixture/success-report',
      },
    },
    {
      type: 'validation.started',
      payload: {
        validatorType: 'simulated-check',
        command: 'fixture:verify',
        blocksCompletion: true,
      },
    },
    {
      type: 'validation.finished',
      payload: {
        status: 'passed',
        outputSummary: 'The deterministic check passed.',
        exitCode: 0,
      },
    },
    {
      type: 'task.completed',
      payload: { summary: 'The fixture task completed with evidence.' },
    },
  ],
  'validation-failure': [
    {
      type: 'task.started',
      payload: { activity: 'Implementing the failing fixture task.' },
    },
    {
      type: 'validation.started',
      payload: {
        validatorType: 'simulated-check',
        command: 'fixture:verify',
        blocksCompletion: true,
      },
    },
    {
      type: 'validation.finished',
      payload: {
        status: 'failed',
        outputSummary: 'The deterministic check found a fixture failure.',
        exitCode: 1,
      },
    },
  ],
  'approval-request': [
    {
      type: 'task.started',
      payload: { activity: 'Preparing an approval-gated fixture action.' },
    },
    {
      type: 'approval.requested',
      payload: {
        requestedAction: 'Use the fixture write capability',
        reason: 'The scenario exercises an explicit permission gate.',
        scope: 'fixture://approved-output',
        consequences: 'One simulated artifact may be created.',
      },
    },
    {
      type: 'approval.decided',
      payload: {
        decision: 'approved',
        note: 'Approved by the deterministic scenario.',
      },
    },
    {
      type: 'validation.started',
      payload: {
        validatorType: 'simulated-check',
        blocksCompletion: true,
      },
    },
    {
      type: 'validation.finished',
      payload: {
        status: 'passed',
        outputSummary: 'Approval-gated work passed validation.',
        exitCode: 0,
      },
    },
    {
      type: 'task.completed',
      payload: { summary: 'Approval-gated fixture work completed.' },
    },
  ],
  cancellation: [
    {
      type: 'task.started',
      payload: { activity: 'Starting cancellable fixture work.' },
    },
    {
      type: 'task.cancelled',
      payload: { reason: 'Cancelled by the deterministic scenario.' },
    },
  ],
  'disconnect-reconciliation': [
    {
      type: 'task.started',
      payload: { activity: 'Starting reconnectable fixture work.' },
    },
    {
      type: 'runtime.disconnected',
      payload: { reason: 'The simulated runtime connection was interrupted.' },
    },
    {
      type: 'runtime.reconciled',
      payload: {
        outcome: 'reconnected',
        reason: 'The simulated runtime session was found and reconnected.',
      },
    },
    {
      type: 'validation.started',
      payload: {
        validatorType: 'simulated-check',
        blocksCompletion: true,
      },
    },
    {
      type: 'validation.finished',
      payload: {
        status: 'passed',
        outputSummary: 'Recovered work passed validation.',
        exitCode: 0,
      },
    },
    {
      type: 'task.completed',
      payload: { summary: 'Recovered fixture work completed.' },
    },
  ],
};
