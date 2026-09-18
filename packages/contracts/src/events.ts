import { z } from 'zod';
import {
  AgentInstanceSchema,
  AgentInstanceStateSchema,
  ApprovalSchema,
  ApprovalStateSchema,
  ArtifactSchema,
  DependencySchema,
  RunSchema,
  RunStateSchema,
  TaskSchema,
  TaskStateSchema,
  ValidationResultSchema,
  ValidationStateSchema,
} from './entities.js';
import {
  AgentInstanceIdSchema,
  CorrelationIdSchema,
  EventIdSchema,
  ProjectIdSchema,
  RunIdSchema,
  TaskIdSchema,
} from './ids.js';

export const EventSourceSchema = z.enum([
  'user',
  'orchestrator',
  'runtime',
  'repository',
  'validator',
  'system',
]);

const DomainEventBaseShape = {
  id: EventIdSchema,
  version: z.literal(1),
  sequence: z.number().int().positive(),
  occurredAt: z.iso.datetime(),
  recordedAt: z.iso.datetime(),
  projectId: ProjectIdSchema.optional(),
  runId: RunIdSchema,
  taskId: TaskIdSchema.optional(),
  agentInstanceId: AgentInstanceIdSchema.optional(),
  correlationId: CorrelationIdSchema.optional(),
  causationId: EventIdSchema.optional(),
  source: EventSourceSchema,
  providerMetadata: z.record(z.string(), z.unknown()).optional(),
};

function domainEvent<const TType extends string, TPayload extends z.ZodType>(
  type: TType,
  payload: TPayload,
) {
  return z.strictObject({
    ...DomainEventBaseShape,
    type: z.literal(type),
    payload,
  });
}

export const DomainEventSchema = z.discriminatedUnion('type', [
  domainEvent('run.created', z.strictObject({ run: RunSchema })),
  domainEvent(
    'run.state_changed',
    z.strictObject({
      from: RunStateSchema,
      to: RunStateSchema,
      reason: z.string().min(1),
    }),
  ),
  domainEvent('task.created', z.strictObject({ task: TaskSchema })),
  domainEvent(
    'task.state_changed',
    z.strictObject({
      from: TaskStateSchema,
      to: TaskStateSchema,
      reason: z.string().min(1),
    }),
  ),
  domainEvent(
    'dependency.created',
    z.strictObject({ dependency: DependencySchema }),
  ),
  domainEvent(
    'dependency.state_changed',
    z.strictObject({
      dependencyId: DependencySchema.shape.id,
      from: z.literal('unsatisfied'),
      to: z.enum(['satisfied', 'waived']),
      reason: z.string().min(1),
    }),
  ),
  domainEvent(
    'agent.instance_created',
    z.strictObject({ agentInstance: AgentInstanceSchema }),
  ),
  domainEvent(
    'agent.state_changed',
    z.strictObject({
      from: AgentInstanceStateSchema,
      to: AgentInstanceStateSchema,
      reason: z.string().min(1),
    }),
  ),
  domainEvent(
    'approval.requested',
    z.strictObject({ approval: ApprovalSchema }),
  ),
  domainEvent(
    'approval.decided',
    z.strictObject({
      approvalId: ApprovalSchema.shape.id,
      from: z.literal('requested'),
      to: ApprovalStateSchema.exclude(['requested']),
      decidedAt: z.iso.datetime(),
      note: z.string().min(1).optional(),
    }),
  ),
  domainEvent(
    'validation.started',
    z.strictObject({ validation: ValidationResultSchema }),
  ),
  domainEvent(
    'validation.completed',
    z.strictObject({
      validationId: ValidationResultSchema.shape.id,
      from: z.literal('running'),
      to: ValidationStateSchema.exclude(['running']),
      finishedAt: z.iso.datetime(),
      exitCode: z.number().int().optional(),
      outputSummary: z.string().min(1),
    }),
  ),
  domainEvent(
    'artifact.produced',
    z.strictObject({ artifact: ArtifactSchema }),
  ),
  domainEvent(
    'runtime.disconnected',
    z.strictObject({
      runtimeEventId: z.string().min(1),
      reason: z.string().min(1),
    }),
  ),
  domainEvent(
    'runtime.reconciled',
    z.strictObject({
      runtimeEventId: z.string().min(1),
      outcome: z.enum(['reconnected', 'terminal', 'unknown']),
      reason: z.string().min(1),
    }),
  ),
]);

export type DomainEvent = z.infer<typeof DomainEventSchema>;
export type DomainEventType = DomainEvent['type'];
export type EventSource = z.infer<typeof EventSourceSchema>;

export class UnsupportedEventVersionError extends Error {
  constructor(readonly version: number) {
    super(`Domain event schema version ${version} is not supported.`);
    this.name = 'UnsupportedEventVersionError';
  }
}

const EventVersionHeaderSchema = z.object({
  version: z.number().int().positive(),
});

export function parseDomainEvent(input: unknown): DomainEvent {
  const { version } = EventVersionHeaderSchema.parse(input);
  switch (version) {
    case 1:
      return DomainEventSchema.parse(input);
    default:
      throw new UnsupportedEventVersionError(version);
  }
}
