import { z } from 'zod';
import { AgentInstanceIdSchema, RunIdSchema, TaskIdSchema } from './ids.js';

export const RuntimeCapabilitiesSchema = z.strictObject({
  interrupt: z.boolean(),
  approvals: z.boolean(),
  reconciliation: z.boolean(),
  steering: z.boolean(),
  usageReporting: z.boolean(),
  fileChangeEvents: z.boolean(),
  stableEventIds: z.boolean(),
});

export type RuntimeCapabilities = z.infer<typeof RuntimeCapabilitiesSchema>;

export const RuntimeAdapterDescriptorSchema = z.strictObject({
  adapterId: z.string().min(1),
  adapterVersion: z.string().min(1),
  protocolVersion: z.number().int().positive(),
});

export type RuntimeAdapterDescriptor = z.infer<
  typeof RuntimeAdapterDescriptorSchema
>;

const RuntimeEventBaseShape = {
  id: z.string().min(1),
  ordinal: z.number().int().positive(),
  occurredAt: z.iso.datetime(),
  runId: RunIdSchema,
  taskId: TaskIdSchema,
  agentInstanceId: AgentInstanceIdSchema,
  providerMetadata: z.record(z.string(), z.unknown()).optional(),
};

function runtimeEvent<const TType extends string, TPayload extends z.ZodType>(
  type: TType,
  payload: TPayload,
) {
  return z.strictObject({
    ...RuntimeEventBaseShape,
    type: z.literal(type),
    payload,
  });
}

export const NormalizedRuntimeEventSchema = z.discriminatedUnion('type', [
  runtimeEvent('task.started', z.strictObject({ activity: z.string().min(1) })),
  runtimeEvent(
    'artifact.produced',
    z.strictObject({
      artifactType: z.enum(['contract', 'report', 'patch', 'diff', 'other']),
      digest: z.string().min(1),
      location: z.string().min(1).optional(),
    }),
  ),
  runtimeEvent(
    'approval.requested',
    z.strictObject({
      requestedAction: z.string().min(1),
      reason: z.string().min(1),
      scope: z.string().min(1),
      consequences: z.string().min(1),
    }),
  ),
  runtimeEvent(
    'approval.decided',
    z.strictObject({
      decision: z.enum(['approved', 'denied']),
      note: z.string().min(1).optional(),
    }),
  ),
  runtimeEvent(
    'validation.started',
    z.strictObject({
      validatorType: z.string().min(1),
      command: z.string().min(1).optional(),
      blocksCompletion: z.boolean(),
    }),
  ),
  runtimeEvent(
    'validation.finished',
    z.strictObject({
      status: z.enum(['passed', 'failed', 'cancelled']),
      outputSummary: z.string().min(1),
      exitCode: z.number().int().optional(),
    }),
  ),
  runtimeEvent(
    'task.completed',
    z.strictObject({ summary: z.string().min(1) }),
  ),
  runtimeEvent('task.failed', z.strictObject({ reason: z.string().min(1) })),
  runtimeEvent('task.cancelled', z.strictObject({ reason: z.string().min(1) })),
  runtimeEvent(
    'runtime.disconnected',
    z.strictObject({ reason: z.string().min(1) }),
  ),
  runtimeEvent(
    'runtime.reconciled',
    z.strictObject({
      outcome: z.enum(['reconnected', 'terminal', 'unknown']),
      reason: z.string().min(1),
    }),
  ),
]);

export type NormalizedRuntimeEvent = z.infer<
  typeof NormalizedRuntimeEventSchema
>;

export interface RuntimeTaskInput {
  readonly runId: z.infer<typeof RunIdSchema>;
  readonly taskId: z.infer<typeof TaskIdSchema>;
  readonly agentInstanceId: z.infer<typeof AgentInstanceIdSchema>;
  readonly configuration: unknown;
}

export const RuntimeConfigurationResultSchema = z.strictObject({
  valid: z.boolean(),
  errors: z.array(z.string().min(1)),
});

export type RuntimeConfigurationResult = z.infer<
  typeof RuntimeConfigurationResultSchema
>;

export interface RuntimeAdapter {
  readonly id: string;
  readonly version: string;
  readonly protocolVersion: number;
  getCapabilities(): Promise<RuntimeCapabilities>;
  validateConfiguration(input: unknown): Promise<RuntimeConfigurationResult>;
  startTask(input: RuntimeTaskInput): AsyncIterable<NormalizedRuntimeEvent>;
  interrupt?(
    input: RuntimeTaskInput & { readonly reason: string },
  ): Promise<NormalizedRuntimeEvent>;
  respondToApproval?(
    input: RuntimeTaskInput & { readonly decision: 'approved' | 'denied' },
  ): Promise<NormalizedRuntimeEvent>;
  reconcile?(input: RuntimeTaskInput): Promise<NormalizedRuntimeEvent>;
}
