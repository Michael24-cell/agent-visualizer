import { z } from 'zod';
import { CapabilityCategorySchema } from './experience.js';
import { ProjectEventSchema } from './project-events.js';
import {
  BriefRequestIdSchema,
  CommandIdSchema,
  MethodIdSchema,
  ThreadIdSchema,
} from './project-ids.js';
import {
  ProjectProjectionSchema,
  ProjectSummarySchema,
} from './project-projection.js';
import {
  AgentModelSchema,
  BriefFieldIdSchema,
  MessageBodySchema,
  MessageSchema,
  MethodSectionIdSchema,
  PlanSectionIdSchema,
  ProjectSchema,
} from './project.js';

// Every mutating command carries a client-generated commandId (for
// idempotent retries) and the last sequence the client saw for the entity it
// targets. Which entity that is depends on the command; see each schema.
const CommandBaseShape = {
  commandId: CommandIdSchema,
  expectedSequence: z.number().int().positive(),
};

export const CreateProjectCommandSchema = z.strictObject({
  commandId: CommandIdSchema,
  name: z.string().trim().min(1).max(120),
  // Absolute folder path to attach at creation.
  repositoryPath: z.string().trim().min(1).optional(),
});

// Targets the project; expectedSequence is the project's lastSequence.
export const AttachRepositoryCommandSchema = z.strictObject({
  ...CommandBaseShape,
  path: z.string().trim().min(1),
});

// The service's own view of folders it may attach, for the folder picker.
export const FolderEntrySchema = z.strictObject({
  name: z.string().min(1),
  path: z.string().min(1),
  isRepository: z.boolean(),
});

export const FolderListingSchema = z.strictObject({
  path: z.string().min(1),
  parent: z.string().min(1).optional(),
  entries: z.array(FolderEntrySchema),
});

// Targets the project; expectedSequence is the project's lastSequence.
export const CreateAgentCommandSchema = z.strictObject({
  ...CommandBaseShape,
  name: z.string().trim().min(1).max(80),
  category: CapabilityCategorySchema,
  model: AgentModelSchema.optional(),
});

// Targets an agent; expectedSequence is that agent's lastSequence.
export const SetAgentModelCommandSchema = z.strictObject({
  ...CommandBaseShape,
  model: AgentModelSchema,
});

// Which runtime produces coordinator and agent replies. Runtime state,
// reported so the client can say so honestly.
export const RuntimeInfoSchema = z.strictObject({
  mode: z.enum(['simulated', 'live']),
  // Which live runtime: Claude via the Agent SDK, or any OpenAI-compatible
  // endpoint (Ollama locally, hosted APIs). Absent when simulated.
  provider: z.enum(['claude', 'openai']).optional(),
  // The model name for openai runtimes, where every agent shares one.
  model: z.string().min(1).optional(),
});

// Targets a thread; expectedSequence is that thread's lastSequence.
export const PostMessageCommandSchema = z.strictObject({
  ...CommandBaseShape,
  body: MessageBodySchema,
  intent: z.enum(['chat', 'start_work']).default('chat'),
});

// Targets an agent; expectedSequence is that agent's lastSequence.
export const AgentCommandSchema = z.strictObject(CommandBaseShape);

export const AskDecisionCommandSchema = z.strictObject({
  ...CommandBaseShape,
  decision: z.enum(['approved', 'denied']),
  note: z.string().trim().min(1).max(500).optional(),
  // With 'task', an approval trusts the rest of this task.
  trust: z.enum(['once', 'task']).default('once'),
});

// Targets a proposal; expectedSequence is that proposal's lastSequence.
export const ProposalDecisionCommandSchema = z.strictObject({
  ...CommandBaseShape,
  decision: z.enum(['approved', 'denied', 'dismissed']),
  note: z.string().trim().min(1).max(500).optional(),
});

// Targets the project's method; expectedSequence is method.lastSequence, or
// the project's lastSequence when no method is applied yet.
export const ApplyMethodCommandSchema = z.strictObject({
  ...CommandBaseShape,
  catalogId: MethodIdSchema,
  catalogVersion: z.string().min(1),
});

export const MethodOverrideCommandSchema = z.strictObject({
  ...CommandBaseShape,
  sectionId: MethodSectionIdSchema,
  value: z.array(z.string().trim().min(1)),
});

// Targets the plan document; expectedSequence is planDocument.lastSequence.
export const PlanSectionCommandSchema = z.strictObject({
  ...CommandBaseShape,
  sectionId: PlanSectionIdSchema,
  lines: z.array(z.string().trim().min(1).max(500)),
});

// Targets the brief; expectedSequence is brief.lastSequence.
export const BriefFieldCommandSchema = z.strictObject({
  ...CommandBaseShape,
  fieldId: BriefFieldIdSchema,
  action: z.enum(['confirm', 'correct', 'skip']),
  value: z.string().trim().min(1).max(2_000).optional(),
});

export const CommandErrorCodeSchema = z.enum([
  'invalid_command',
  'not_found',
  'stale_sequence',
  'already_decided',
  'thread_closed',
  'message_empty',
  'message_too_long',
  'author_not_allowed',
  'project_mismatch',
  'agent_busy',
  'agent_not_open',
  'ask_not_open',
  'plan_superseded',
  'invalid_transition',
  'folder_not_found',
  'folder_not_allowed',
  'folder_required',
]);

export const CommandErrorSchema = z.strictObject({
  error: z.string().min(1),
  code: CommandErrorCodeSchema,
});

// What a mutating command returns. `committed` is the stable range this
// commandId produced; on an idempotent retry it is the original range while
// `projection` and `summary` are current.
export const CommandReceiptSchema = z.strictObject({
  commandId: CommandIdSchema,
  firstSequence: z.number().int().positive(),
  lastSequence: z.number().int().positive(),
  createdIds: z.record(z.string(), z.array(z.string().min(1))),
  replayed: z.boolean(),
});

export const ProjectResponseSchema = z.strictObject({
  projection: ProjectProjectionSchema,
  summary: ProjectSummarySchema,
  brief: z.strictObject({
    markdown: z.string(),
    digest: z.string().min(1),
  }),
  // Threads whose reply is still being produced. Runtime state, not part
  // of the event stream: it is empty again after a restart.
  busyThreadIds: z.array(ThreadIdSchema).default([]),
  runtime: RuntimeInfoSchema.default({ mode: 'simulated' }),
});

export const CommandResponseSchema = z.strictObject({
  receipt: CommandReceiptSchema,
  project: ProjectResponseSchema,
});

export const ProjectListItemSchema = z.strictObject({
  project: ProjectSchema,
  summary: ProjectSummarySchema,
});

export const ProjectListResponseSchema = z.strictObject({
  projects: z.array(ProjectListItemSchema),
  runtime: RuntimeInfoSchema.default({ mode: 'simulated' }),
});

// Cursor pagination over a thread. Cursors are the sequence number of the
// message's `message.posted` event, which is unique and monotonic within a
// project. Without `before` or `after`, the latest page is returned.
export const MessagesQuerySchema = z
  .strictObject({
    before: z.coerce.number().int().positive().optional(),
    after: z.coerce.number().int().nonnegative().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .refine(
    (query) => !(query.before !== undefined && query.after !== undefined),
    {
      message: 'Use before or after, not both.',
    },
  );

export const MessagesPageSchema = z.strictObject({
  messages: z.array(MessageSchema),
  // Cursor to fetch older messages, or undefined when none remain.
  olderCursor: z.number().int().positive().optional(),
  // Cursor to fetch newer messages; always present so clients can poll.
  newerCursor: z.number().int().nonnegative(),
});

export const ProjectEventsPageSchema = z.strictObject({
  events: z.array(ProjectEventSchema),
  cursor: z.number().int().nonnegative(),
});

export const BriefRequestRefSchema = z.strictObject({
  requestId: BriefRequestIdSchema,
});

export type CreateProjectCommand = z.infer<typeof CreateProjectCommandSchema>;
export type CreateAgentCommand = z.infer<typeof CreateAgentCommandSchema>;
export type SetAgentModelCommand = z.infer<typeof SetAgentModelCommandSchema>;
export type PlanSectionCommand = z.infer<typeof PlanSectionCommandSchema>;
export type RuntimeInfo = z.infer<typeof RuntimeInfoSchema>;
export type AttachRepositoryCommand = z.infer<
  typeof AttachRepositoryCommandSchema
>;
export type FolderListing = z.infer<typeof FolderListingSchema>;
export type PostMessageCommand = z.infer<typeof PostMessageCommandSchema>;
export type AgentCommand = z.infer<typeof AgentCommandSchema>;
export type AskDecisionCommand = z.infer<typeof AskDecisionCommandSchema>;
export type ProposalDecisionCommand = z.infer<
  typeof ProposalDecisionCommandSchema
>;
export type ApplyMethodCommand = z.infer<typeof ApplyMethodCommandSchema>;
export type MethodOverrideCommand = z.infer<typeof MethodOverrideCommandSchema>;
export type BriefFieldCommand = z.infer<typeof BriefFieldCommandSchema>;
export type CommandErrorCode = z.infer<typeof CommandErrorCodeSchema>;
export type CommandReceipt = z.infer<typeof CommandReceiptSchema>;
export type CommandResponse = z.infer<typeof CommandResponseSchema>;
export type ProjectResponse = z.infer<typeof ProjectResponseSchema>;
export type ProjectListResponse = z.infer<typeof ProjectListResponseSchema>;
export type MessagesQuery = z.infer<typeof MessagesQuerySchema>;
export type MessagesPage = z.infer<typeof MessagesPageSchema>;
export type ProjectEventsPage = z.infer<typeof ProjectEventsPageSchema>;
