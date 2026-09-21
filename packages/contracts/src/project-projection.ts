import { z } from 'zod';
import { EventIdSchema, ProjectIdSchema, TaskIdSchema } from './ids.js';
import {
  AgentIdSchema,
  AskIdSchema,
  CheckIdSchema,
  ProposalIdSchema,
} from './project-ids.js';
import {
  ActivitySchema,
  AgentSchema,
  AgentTaskSchema,
  AgentWorkStateSchema,
  AskSchema,
  BriefSchema,
  CheckSchema,
  MethodSnapshotSchema,
  OutputSchema,
  PlanDocumentSchema,
  PlanSchema,
  ProjectMethodSchema,
  ProjectSchema,
  ProposalSchema,
  ThreadSchema,
} from './project.js';

// Everything the service knows about a project, rebuilt from its event
// stream. Message bodies are deliberately absent: threads only count them.
export const ProjectProjectionSchema = z.strictObject({
  projectId: ProjectIdSchema,
  project: ProjectSchema,
  brief: BriefSchema,
  method: ProjectMethodSchema.nullable(),
  methodSnapshots: z.record(z.string(), MethodSnapshotSchema),
  threads: z.record(z.string(), ThreadSchema),
  agents: z.record(z.string(), AgentSchema),
  tasks: z.record(z.string(), AgentTaskSchema),
  planDocument: PlanDocumentSchema,
  plans: z.record(z.string(), PlanSchema),
  proposals: z.record(z.string(), ProposalSchema),
  asks: z.record(z.string(), AskSchema),
  checks: z.record(z.string(), CheckSchema),
  outputs: z.record(z.string(), OutputSchema),
  activities: z.record(z.string(), ActivitySchema),
  lastSequence: z.number().int().positive(),
  lastEventId: EventIdSchema,
  appliedEventIds: z.array(EventIdSchema),
});

export type ProjectProjection = z.infer<typeof ProjectProjectionSchema>;

// The service-authoritative "right now" view. Derived, never stored.
export const ProjectStatusSchema = z.enum([
  'intake',
  'planning',
  'idle',
  'working',
  'needs_you',
  'reviewing',
  'complete',
  'partially_stopped',
]);

export const AttentionItemSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('ask'),
    label: z.string().min(1),
    askId: AskIdSchema,
    agentId: AgentIdSchema,
    taskId: TaskIdSchema,
  }),
  z.strictObject({
    kind: z.literal('proposal'),
    label: z.string().min(1),
    proposalId: ProposalIdSchema,
  }),
  z.strictObject({
    kind: z.literal('check_failed'),
    label: z.string().min(1),
    checkId: CheckIdSchema,
    agentId: AgentIdSchema,
    taskId: TaskIdSchema,
  }),
  z.strictObject({
    kind: z.literal('intake'),
    label: z.string().min(1),
  }),
]);

export const ProjectSummarySchema = z.strictObject({
  status: ProjectStatusSchema,
  briefReady: z.boolean(),
  agentCounts: z.record(AgentWorkStateSchema, z.number().int().nonnegative()),
  openAskIds: z.array(AskIdSchema),
  openProposalIds: z.array(ProposalIdSchema),
  attention: AttentionItemSchema.optional(),
  lastSequence: z.number().int().positive(),
});

export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;
export type AttentionItem = z.infer<typeof AttentionItemSchema>;
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;
