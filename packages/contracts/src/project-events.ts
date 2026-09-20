import { z } from 'zod';
import {
  CorrelationIdSchema,
  EventIdSchema,
  ProjectIdSchema,
  TaskIdSchema,
} from './ids.js';
import {
  AgentIdSchema,
  AskIdSchema,
  CheckIdSchema,
  MessageIdSchema,
  OutputIdSchema,
  PlanIdSchema,
  ProposalIdSchema,
  ThreadIdSchema,
} from './project-ids.js';
import {
  AdapterProvenanceSchema,
  AgentSchema,
  AgentTaskSchema,
  AgentTaskStateSchema,
  AskSchema,
  AskStateSchema,
  BriefFieldIdSchema,
  BriefFieldStateSchema,
  BriefRequestSchema,
  CheckSchema,
  CheckStateSchema,
  MessageSchema,
  MethodDefinitionSchema,
  MethodSectionIdSchema,
  MethodSnapshotSchema,
  OutputSchema,
  PlanSchema,
  ProjectSchema,
  ProposalSchema,
  ProposalStateSchema,
  RepositoryRefSchema,
  ThreadSchema,
} from './project.js';

// Who caused the event. Matches the product vocabulary rather than the
// run-stream sources so messages and events read the same way.
export const ProjectEventSourceSchema = z.enum([
  'user',
  'coordinator',
  'agent',
  'system',
]);

const ProjectEventBaseShape = {
  id: EventIdSchema,
  version: z.literal(1),
  sequence: z.number().int().positive(),
  occurredAt: z.iso.datetime(),
  recordedAt: z.iso.datetime(),
  projectId: ProjectIdSchema,
  threadId: ThreadIdSchema.optional(),
  agentId: AgentIdSchema.optional(),
  taskId: TaskIdSchema.optional(),
  correlationId: CorrelationIdSchema.optional(),
  causationId: EventIdSchema.optional(),
  source: ProjectEventSourceSchema,
  adapter: AdapterProvenanceSchema.optional(),
  providerMetadata: z.record(z.string(), z.unknown()).optional(),
};

function projectEvent<const TType extends string, TPayload extends z.ZodType>(
  type: TType,
  payload: TPayload,
) {
  return z.strictObject({
    ...ProjectEventBaseShape,
    type: z.literal(type),
    payload,
  });
}

const reason = z.string().min(1);

export const ProjectEventSchema = z.discriminatedUnion('type', [
  projectEvent('project.created', z.strictObject({ project: ProjectSchema })),
  projectEvent(
    'project.repository_attached',
    z.strictObject({ repository: RepositoryRefSchema }),
  ),

  projectEvent('thread.opened', z.strictObject({ thread: ThreadSchema })),
  projectEvent(
    'thread.closed',
    z.strictObject({ threadId: ThreadIdSchema, reason }),
  ),
  projectEvent('message.posted', z.strictObject({ message: MessageSchema })),

  projectEvent(
    'brief.field_updated',
    z.strictObject({
      fieldId: BriefFieldIdSchema,
      to: BriefFieldStateSchema.exclude(['missing']),
      value: z.string().min(1).optional(),
      source: z.enum(['user', 'coordinator']),
      messageId: MessageIdSchema.optional(),
    }),
  ),
  projectEvent(
    'brief.request_recorded',
    z.strictObject({ request: BriefRequestSchema }),
  ),

  projectEvent(
    'method.applied',
    z.strictObject({
      definition: MethodDefinitionSchema,
      proposalId: ProposalIdSchema.optional(),
    }),
  ),
  projectEvent(
    'method.override_recorded',
    z.strictObject({
      sectionId: MethodSectionIdSchema,
      value: z.array(z.string().min(1)),
    }),
  ),
  projectEvent(
    'method.snapshot_pinned',
    z.strictObject({ snapshot: MethodSnapshotSchema }),
  ),

  projectEvent('agent.created', z.strictObject({ agent: AgentSchema })),

  projectEvent('plan.recorded', z.strictObject({ plan: PlanSchema })),
  projectEvent(
    'plan.assigned',
    z.strictObject({
      planId: PlanIdSchema,
      proposalId: ProposalIdSchema.optional(),
    }),
  ),

  projectEvent('task.assigned', z.strictObject({ task: AgentTaskSchema })),
  projectEvent(
    'task.state_changed',
    z.strictObject({
      taskId: TaskIdSchema,
      from: AgentTaskStateSchema,
      to: AgentTaskStateSchema,
      reason,
    }),
  ),
  projectEvent(
    'task.input_satisfied',
    z.strictObject({
      taskId: TaskIdSchema,
      upstreamTaskId: TaskIdSchema,
      outputId: OutputIdSchema,
    }),
  ),
  projectEvent(
    'task.scope_changed',
    z.strictObject({
      taskId: TaskIdSchema,
      proposalId: ProposalIdSchema,
      scope: z.array(z.string().min(1)).min(1),
    }),
  ),

  projectEvent('ask.opened', z.strictObject({ ask: AskSchema })),
  projectEvent(
    'ask.decided',
    z.strictObject({
      askId: AskIdSchema,
      from: z.literal('open'),
      to: AskStateSchema.exclude(['open']),
      note: z.string().min(1).optional(),
    }),
  ),

  projectEvent('check.started', z.strictObject({ check: CheckSchema })),
  projectEvent(
    'check.finished',
    z.strictObject({
      checkId: CheckIdSchema,
      from: z.literal('running'),
      to: CheckStateSchema.exclude(['running']),
      summary: z.string().min(1),
    }),
  ),
  projectEvent('output.produced', z.strictObject({ output: OutputSchema })),

  projectEvent('proposal.opened', z.strictObject({ proposal: ProposalSchema })),
  projectEvent(
    'proposal.decided',
    z.strictObject({
      proposalId: ProposalIdSchema,
      from: z.literal('open'),
      to: ProposalStateSchema.exclude(['open', 'superseded']),
      note: z.string().min(1).optional(),
    }),
  ),
]);

export type ProjectEvent = z.infer<typeof ProjectEventSchema>;
export type ProjectEventType = ProjectEvent['type'];
export type ProjectEventSource = z.infer<typeof ProjectEventSourceSchema>;

const ProjectEventVersionHeaderSchema = z.object({
  version: z.number().int().positive(),
});

export class UnsupportedProjectEventVersionError extends Error {
  constructor(readonly version: number) {
    super(`Project event schema version ${version} is not supported.`);
    this.name = 'UnsupportedProjectEventVersionError';
  }
}

export function parseProjectEvent(input: unknown): ProjectEvent {
  const { version } = ProjectEventVersionHeaderSchema.parse(input);
  switch (version) {
    case 1:
      return ProjectEventSchema.parse(input);
    default:
      throw new UnsupportedProjectEventVersionError(version);
  }
}
