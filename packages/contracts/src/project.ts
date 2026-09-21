import { z } from 'zod';
import { CapabilityCategorySchema } from './experience.js';
import { ProjectIdSchema, TaskIdSchema } from './ids.js';
import {
  ActivityIdSchema,
  AgentIdSchema,
  AskIdSchema,
  BriefRequestIdSchema,
  CheckIdSchema,
  MessageIdSchema,
  MethodIdSchema,
  MethodSnapshotIdSchema,
  OutputIdSchema,
  PlanIdSchema,
  ProposalIdSchema,
  ThreadIdSchema,
} from './project-ids.js';

// A sequence number in the project's event stream. Entities record the
// sequence of the last event that touched them so commands can target one
// entity's sequence instead of the whole project's.
const SequenceSchema = z.number().int().positive();

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

export const ProjectOriginSchema = z.enum(['user', 'demo']);

// A folder on this machine the project's agents work in. Attached after
// the fact or at creation; absent for projects that are only a conversation.
export const RepositoryRefSchema = z.strictObject({
  path: z.string().min(1),
  name: z.string().min(1),
  branch: z.string().min(1).optional(),
  attachedAt: z.iso.datetime(),
});

// How much a project asks before agents act: every time, once per task
// (the first approval covers the rest), or only for shell commands.
export const TrustPolicySchema = z.enum(['ask', 'task', 'commands']);

export const TRUST_POLICIES: Readonly<
  Record<z.infer<typeof TrustPolicySchema>, { label: string; note: string }>
> = {
  ask: {
    label: 'Ask every time',
    note: 'Every command and file change waits for you.',
  },
  task: {
    label: 'Ask once per task',
    note: 'The first approval in a task covers the rest of it.',
  },
  commands: {
    label: 'Ask for commands only',
    note: 'File changes go ahead; shell commands still wait for you.',
  },
};

export const ProjectSchema = z.strictObject({
  id: ProjectIdSchema,
  name: z.string().min(1).max(120),
  origin: ProjectOriginSchema,
  createdAt: z.iso.datetime(),
  repository: RepositoryRefSchema.optional(),
  // Absent on projects recorded before the setting existed: 'ask'.
  trust: TrustPolicySchema.optional(),
});

// ---------------------------------------------------------------------------
// Brief
// ---------------------------------------------------------------------------

export const BriefFieldIdSchema = z.enum([
  'goal',
  'scope',
  'constraints',
  'doneMeans',
  'checks',
  'audience',
]);

export const BRIEF_REQUIRED_FIELDS: readonly z.infer<
  typeof BriefFieldIdSchema
>[] = ['goal', 'scope', 'doneMeans'];

export const BriefFieldStateSchema = z.enum([
  'missing',
  'inferred',
  'confirmed',
  'skipped',
  'corrected',
]);

export const BriefFieldSchema = z.strictObject({
  state: BriefFieldStateSchema,
  value: z.string().min(1).optional(),
  source: z.enum(['user', 'coordinator']).optional(),
  messageId: MessageIdSchema.optional(),
  updatedAtSequence: SequenceSchema.optional(),
});

export const BriefRequestCategorySchema = z.enum([
  'scope',
  'permission',
  'dependency',
  'other',
]);

export const BriefRequestSchema = z.strictObject({
  id: BriefRequestIdSchema,
  text: z.string().min(1),
  category: BriefRequestCategorySchema,
  proposalId: ProposalIdSchema,
  messageId: MessageIdSchema.optional(),
  recordedAtSequence: SequenceSchema,
});

export const BriefSchema = z.strictObject({
  version: z.number().int().nonnegative(),
  fields: z.record(BriefFieldIdSchema, BriefFieldSchema),
  requests: z.array(BriefRequestSchema),
  lastSequence: SequenceSchema,
});

// ---------------------------------------------------------------------------
// Method (optional, reusable)
// ---------------------------------------------------------------------------

export const ModelTierSchema = z.enum(['light', 'standard', 'deep']);

// The model an agent runs on. Tiers are what plans and Methods ask for;
// the model is what the user picks, defaulting from the tier.
export const AgentModelSchema = z.enum(['opus', 'sonnet', 'haiku']);

export const AGENT_MODELS: Readonly<
  Record<
    z.infer<typeof AgentModelSchema>,
    { readonly label: string; readonly modelId: string; readonly note: string }
  >
> = {
  opus: {
    label: 'Opus',
    modelId: 'claude-opus-5',
    note: 'Deepest reasoning, highest cost',
  },
  sonnet: {
    label: 'Sonnet',
    modelId: 'claude-sonnet-5',
    note: 'Balanced; the default',
  },
  haiku: {
    label: 'Haiku',
    modelId: 'claude-haiku-4-5-20251001',
    note: 'Fastest and cheapest',
  },
};

export const DEFAULT_AGENT_MODEL: z.infer<typeof AgentModelSchema> = 'sonnet';

export function modelForTier(
  tier: z.infer<typeof ModelTierSchema> | undefined,
): z.infer<typeof AgentModelSchema> {
  switch (tier) {
    case 'light':
      return 'haiku';
    case 'deep':
      return 'opus';
    default:
      return DEFAULT_AGENT_MODEL;
  }
}

export const MethodSectionIdSchema = z.enum([
  'hardRules',
  'preferences',
  'promptGuidance',
  'skills',
  'outputExpectations',
  'checks',
  'scopeRestrictions',
]);

export const METHOD_SECTION_TITLES: Readonly<
  Record<z.infer<typeof MethodSectionIdSchema>, string>
> = {
  hardRules: 'Hard rules',
  preferences: 'Preferences',
  promptGuidance: 'Guidance',
  skills: 'Skills',
  outputExpectations: 'Output expectations',
  checks: 'Checks',
  scopeRestrictions: 'Scope restrictions',
};

export const MethodDefinitionSchema = z.strictObject({
  id: MethodIdSchema,
  version: z.string().min(1),
  title: z.string().min(1),
  purpose: z.string().min(1),
  whenToUse: z.string().min(1),
  hardRules: z.array(z.string().min(1)),
  preferences: z.array(z.string().min(1)),
  promptGuidance: z.array(z.string().min(1)),
  skills: z.array(z.string().min(1)),
  outputExpectations: z.array(z.string().min(1)),
  checks: z.array(z.string().min(1)),
  scopeRestrictions: z.array(z.string().min(1)),
  agentDefaults: z
    .strictObject({ modelTier: ModelTierSchema.optional() })
    .optional(),
});

export const MethodOverrideSchema = z.strictObject({
  sectionId: MethodSectionIdSchema,
  value: z.array(z.string().min(1)),
  // Absent on overrides recorded before edits carried a source.
  source: z.enum(['user', 'coordinator', 'agent']).optional(),
  recordedAtSequence: SequenceSchema,
});

// The project's current method: the immutable catalog definition plus an
// append-only list of project-local overrides. `null` means default behavior.
export const ProjectMethodSchema = z.strictObject({
  definition: MethodDefinitionSchema,
  overrides: z.array(MethodOverrideSchema),
  version: z.number().int().positive(),
  lastSequence: SequenceSchema,
});

// The exact method in force when a task was assigned. Never changes.
export const MethodSnapshotSchema = z.strictObject({
  id: MethodSnapshotIdSchema,
  taskId: TaskIdSchema,
  resolved: MethodDefinitionSchema,
  methodVersion: z.number().int().positive(),
  pinnedAtSequence: SequenceSchema,
});

// ---------------------------------------------------------------------------
// Threads and messages
// ---------------------------------------------------------------------------

export const ThreadKindSchema = z.enum(['coordinator', 'agent']);
export const ThreadStateSchema = z.enum(['open', 'closed']);

export const ThreadSchema = z.strictObject({
  id: ThreadIdSchema,
  projectId: ProjectIdSchema,
  kind: ThreadKindSchema,
  agentId: AgentIdSchema.optional(),
  state: ThreadStateSchema,
  messageCount: z.number().int().nonnegative(),
  lastSequence: SequenceSchema,
});

export const MessageAuthorRoleSchema = z.enum([
  'user',
  'coordinator',
  'agent',
  'system',
]);

export const AdapterProvenanceSchema = z.strictObject({
  id: z.string().min(1),
  version: z.string().min(1),
  mode: z.enum(['simulated', 'live']),
});

export const MessageAuthorSchema = z.strictObject({
  role: MessageAuthorRoleSchema,
  source: z.enum(['client', 'simulated_adapter', 'live_adapter', 'service']),
  agentId: AgentIdSchema.optional(),
  adapter: AdapterProvenanceSchema.optional(),
});

// What the sender meant. `chat` never creates or changes work; `start_work`
// is the only message intent that may create a task on an agent.
export const MessageIntentSchema = z.enum([
  'chat',
  'start_work',
  'intake_answer',
  'request_work',
]);

export const MESSAGE_BODY_MAX_LENGTH = 4_000;

export const MessageBodySchema = z
  .string()
  .trim()
  .min(1)
  .max(MESSAGE_BODY_MAX_LENGTH);

export const MessageSchema = z.strictObject({
  id: MessageIdSchema,
  projectId: ProjectIdSchema,
  threadId: ThreadIdSchema,
  author: MessageAuthorSchema,
  intent: MessageIntentSchema,
  body: MessageBodySchema,
  refs: z
    .strictObject({
      taskId: TaskIdSchema.optional(),
      proposalId: ProposalIdSchema.optional(),
      askId: AskIdSchema.optional(),
      checkId: CheckIdSchema.optional(),
      outputId: OutputIdSchema.optional(),
      fromThreadId: ThreadIdSchema.optional(),
    })
    .optional(),
  postedAt: z.iso.datetime(),
  sequence: SequenceSchema,
});

// ---------------------------------------------------------------------------
// Agents, tasks, and current work
// ---------------------------------------------------------------------------

// The state of one task. An agent's work state mirrors its current task.
export const AgentTaskStateSchema = z.enum([
  'waiting',
  'working',
  'needs_you',
  'done',
  'stopped',
  'failed',
]);

export const AgentWorkStateSchema = z.enum([
  'idle',
  ...AgentTaskStateSchema.options,
]);

export const AgentSchema = z.strictObject({
  id: AgentIdSchema,
  projectId: ProjectIdSchema,
  threadId: ThreadIdSchema,
  name: z.string().min(1).max(80),
  category: CapabilityCategorySchema,
  profileId: z.string().min(1).optional(),
  modelTier: ModelTierSchema.optional(),
  // Optional so agents recorded before models were chosen still replay;
  // read it through agentModel().
  model: AgentModelSchema.optional(),
  work: AgentWorkStateSchema,
  currentTaskId: TaskIdSchema.optional(),
  taskIds: z.array(TaskIdSchema),
  createdAtSequence: SequenceSchema,
  lastSequence: SequenceSchema,
});

export const AgentTaskSchema = z
  .strictObject({
    id: TaskIdSchema,
    projectId: ProjectIdSchema,
    agentId: AgentIdSchema,
    // When the task came from a plan, which row of that plan it is. Rows are
    // immutable, so (planId, planTaskIndex) is the stable link.
    planId: PlanIdSchema.optional(),
    planTaskIndex: z.number().int().nonnegative().optional(),
    title: z.string().min(1).max(200),
    objective: z.string().min(1),
    category: CapabilityCategorySchema,
    whySeparate: z.string().min(1).optional(),
    whyThisAgent: z.string().min(1).optional(),
    skills: z.array(z.string().min(1)),
    scope: z.array(z.string().min(1)),
    // Every approved scope proposal applied to this task, in order. A proposal
    // id appears here at most once.
    scopeHistory: z.array(
      z.strictObject({
        proposalId: ProposalIdSchema,
        scope: z.array(z.string().min(1)).min(1),
        appliedAtSequence: SequenceSchema,
      }),
    ),
    dependsOn: z.array(TaskIdSchema),
    inputsSatisfied: z.array(TaskIdSchema),
    expectedOutputs: z.array(z.string().min(1)),
    requiredChecks: z.array(z.string().min(1)),
    modelTier: ModelTierSchema.optional(),
    state: AgentTaskStateSchema,
    // When work on it began (first move to working), for elapsed time.
    startedAt: z.iso.datetime().optional(),
    // Set when an approval was given for the rest of the task: later
    // permission requests run without asking and are logged as activity.
    trusted: z.boolean().optional(),
    methodSnapshotId: MethodSnapshotIdSchema.optional(),
    originMessageId: MessageIdSchema.optional(),
    createdAtSequence: SequenceSchema,
    endedAtSequence: SequenceSchema.optional(),
    endReason: z.string().min(1).optional(),
  })
  .refine(
    (task) =>
      (task.planId === undefined) === (task.planTaskIndex === undefined),
    { message: 'planId and planTaskIndex go together.' },
  );

export const AskStateSchema = z.enum(['open', 'approved', 'denied', 'closed']);

export const AskSchema = z.strictObject({
  id: AskIdSchema,
  projectId: ProjectIdSchema,
  agentId: AgentIdSchema,
  taskId: TaskIdSchema,
  action: z.string().min(1),
  reason: z.string().min(1),
  scope: z.string().min(1),
  consequences: z.string().min(1),
  state: AskStateSchema,
  openedAtSequence: SequenceSchema,
  decidedAtSequence: SequenceSchema.optional(),
  note: z.string().min(1).optional(),
});

export const CheckStateSchema = z.enum([
  'running',
  'passed',
  'failed',
  'stopped',
]);

export const CheckSchema = z.strictObject({
  id: CheckIdSchema,
  projectId: ProjectIdSchema,
  agentId: AgentIdSchema,
  taskId: TaskIdSchema,
  name: z.string().min(1),
  command: z.string().min(1).optional(),
  state: CheckStateSchema,
  summary: z.string().min(1).optional(),
  retryOf: CheckIdSchema.optional(),
  startedAtSequence: SequenceSchema,
  finishedAtSequence: SequenceSchema.optional(),
});

// One tool use worth showing in the conversation but not worth an
// entity of its own: reads, searches, listings. Commands become checks
// and file changes become outputs.
export const ActivityToolSchema = z.enum([
  'Read',
  'Grep',
  'Glob',
  'Plan',
  'Method',
  'Other',
]);

export const ActivitySchema = z.strictObject({
  id: ActivityIdSchema,
  projectId: ProjectIdSchema,
  agentId: AgentIdSchema,
  taskId: TaskIdSchema,
  tool: ActivityToolSchema,
  target: z.string().min(1).max(300),
  summary: z.string().min(1).max(300).optional(),
  atSequence: SequenceSchema,
});

export const OutputKindSchema = z.enum([
  'contract',
  'report',
  'patch',
  'diff',
  'note',
  'other',
]);

export const OutputSchema = z.strictObject({
  id: OutputIdSchema,
  projectId: ProjectIdSchema,
  agentId: AgentIdSchema,
  taskId: TaskIdSchema,
  kind: OutputKindSchema,
  title: z.string().min(1),
  digest: z.string().min(1),
  location: z.string().min(1).optional(),
  // What changed, as a small line diff, when the runtime can tell.
  diff: z.string().min(1).max(20_000).optional(),
  producedAtSequence: SequenceSchema,
});

// ---------------------------------------------------------------------------
// The plan document: what the project should become, in sections. Written
// by you directly or through the coordinator; the task plan below is the
// work derived from it.
// ---------------------------------------------------------------------------

export const PlanSectionIdSchema = z.enum([
  'overview',
  'features',
  'ui',
  'visual',
  'data',
  'risks',
]);

export const PLAN_SECTIONS: Readonly<
  Record<
    z.infer<typeof PlanSectionIdSchema>,
    { readonly title: string; readonly hint: string }
  >
> = {
  overview: { title: 'Overview', hint: 'What this is and who it is for.' },
  features: { title: 'Features', hint: 'What it must do, one line each.' },
  ui: { title: 'UI', hint: 'Screens, flows, and interactions.' },
  visual: { title: 'Visual', hint: 'Look, tone, typography, colour.' },
  data: { title: 'Data', hint: 'What is stored, where, and how it moves.' },
  risks: { title: 'Risks', hint: 'What could go wrong or is undecided.' },
};

export const DocumentEditSourceSchema = z.enum([
  'user',
  'coordinator',
  'agent',
]);

export const PlanSectionSchema = z.strictObject({
  lines: z.array(z.string().min(1).max(500)),
  source: DocumentEditSourceSchema,
  updatedAtSequence: SequenceSchema,
});

export const PlanDocumentSchema = z.strictObject({
  sections: z.partialRecord(PlanSectionIdSchema, PlanSectionSchema),
  lastSequence: SequenceSchema,
});

// ---------------------------------------------------------------------------
// Plans and proposals
// ---------------------------------------------------------------------------

// One proposed task. Carries everything the plan view needs to explain the
// recommendation; `dependsOn` indexes into the same plan's task list.
export const PlanTaskSchema = z.strictObject({
  title: z.string().min(1).max(200),
  objective: z.string().min(1),
  agentName: z.string().min(1).max(80),
  category: CapabilityCategorySchema,
  whySeparate: z.string().min(1),
  whyThisAgent: z.string().min(1),
  skills: z.array(z.string().min(1)),
  scope: z.array(z.string().min(1)),
  dependsOn: z.array(z.number().int().nonnegative()),
  expectedOutputs: z.array(z.string().min(1)),
  requiredChecks: z.array(z.string().min(1)),
  modelTier: ModelTierSchema.optional(),
});

export const PlanSchema = z
  .strictObject({
    id: PlanIdSchema,
    projectId: ProjectIdSchema,
    version: z.number().int().positive(),
    // The request this plan answers, kept so a revision can re-derive it.
    request: z.string().min(1),
    tasks: z.array(PlanTaskSchema).min(1),
    whyThisMany: z.string().min(1),
    proposalId: ProposalIdSchema.optional(),
    supersedesPlanId: PlanIdSchema.optional(),
    supersededByPlanId: PlanIdSchema.optional(),
    recordedAtSequence: SequenceSchema,
    assignedAtSequence: SequenceSchema.optional(),
  })
  .refine(
    (plan) =>
      plan.tasks.every((task, index) =>
        task.dependsOn.every(
          (dependency) => dependency < index && dependency !== index,
        ),
      ),
    { message: 'Plan tasks may only depend on earlier tasks in the plan.' },
  );

export const ProposalStateSchema = z.enum([
  'open',
  'approved',
  'denied',
  'dismissed',
  'superseded',
]);

export const ProposalEffectKindSchema = z.enum([
  'create_agents',
  'assign_tasks',
  'pin_method',
  'append_brief_request',
  'change_task_scope',
]);

const ProposalBaseShape = {
  id: ProposalIdSchema,
  projectId: ProjectIdSchema,
  threadId: ThreadIdSchema,
  title: z.string().min(1),
  summary: z.string().min(1),
  state: ProposalStateSchema,
  consequences: z.strictObject({
    effects: z.array(
      z.strictObject({
        kind: ProposalEffectKindSchema,
        description: z.string().min(1),
      }),
    ),
    reversible: z.boolean(),
    touchesRepository: z.literal(false),
  }),
  messageId: MessageIdSchema.optional(),
  openedAtSequence: SequenceSchema,
  decidedAtSequence: SequenceSchema.optional(),
  lastSequence: SequenceSchema,
};

export const ProposalSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    ...ProposalBaseShape,
    kind: z.literal('plan'),
    payload: z.strictObject({ planId: PlanIdSchema }),
  }),
  z.strictObject({
    ...ProposalBaseShape,
    kind: z.literal('set_method'),
    payload: z.strictObject({
      catalogId: MethodIdSchema,
      catalogVersion: z.string().min(1),
    }),
  }),
  z.strictObject({
    ...ProposalBaseShape,
    kind: z.literal('record_request'),
    payload: z.strictObject({
      text: z.string().min(1),
      category: BriefRequestCategorySchema,
      keywordsMatched: z.array(z.string().min(1)),
    }),
  }),
  z.strictObject({
    ...ProposalBaseShape,
    kind: z.literal('change_task_scope'),
    payload: z.strictObject({
      taskId: TaskIdSchema,
      scope: z.array(z.string().min(1)).min(1),
    }),
  }),
]);

export type Project = z.infer<typeof ProjectSchema>;
export type RepositoryRef = z.infer<typeof RepositoryRefSchema>;
export type ProjectOrigin = z.infer<typeof ProjectOriginSchema>;
export type Brief = z.infer<typeof BriefSchema>;
export type BriefField = z.infer<typeof BriefFieldSchema>;
export type BriefFieldId = z.infer<typeof BriefFieldIdSchema>;
export type BriefFieldState = z.infer<typeof BriefFieldStateSchema>;
export type BriefRequest = z.infer<typeof BriefRequestSchema>;
export type ModelTier = z.infer<typeof ModelTierSchema>;
export type Activity = z.infer<typeof ActivitySchema>;
export type TrustPolicy = z.infer<typeof TrustPolicySchema>;

export function projectTrust(project: {
  trust?: TrustPolicy | undefined;
}): TrustPolicy {
  return project.trust ?? 'ask';
}
export type ActivityTool = z.infer<typeof ActivityToolSchema>;
export type PlanSectionId = z.infer<typeof PlanSectionIdSchema>;
export type PlanSection = z.infer<typeof PlanSectionSchema>;
export type PlanDocument = z.infer<typeof PlanDocumentSchema>;
export type DocumentEditSource = z.infer<typeof DocumentEditSourceSchema>;
export type AgentModel = z.infer<typeof AgentModelSchema>;

export function agentModel(agent: {
  model?: AgentModel | undefined;
}): AgentModel {
  return agent.model ?? DEFAULT_AGENT_MODEL;
}
export type MethodDefinition = z.infer<typeof MethodDefinitionSchema>;
export type MethodSectionId = z.infer<typeof MethodSectionIdSchema>;
export type ProjectMethod = z.infer<typeof ProjectMethodSchema>;
export type MethodSnapshot = z.infer<typeof MethodSnapshotSchema>;
export type Thread = z.infer<typeof ThreadSchema>;
export type ThreadKind = z.infer<typeof ThreadKindSchema>;
export type ThreadState = z.infer<typeof ThreadStateSchema>;
export type Message = z.infer<typeof MessageSchema>;
export type MessageAuthor = z.infer<typeof MessageAuthorSchema>;
export type MessageIntent = z.infer<typeof MessageIntentSchema>;
export type Agent = z.infer<typeof AgentSchema>;
export type AgentWorkState = z.infer<typeof AgentWorkStateSchema>;
export type AgentTask = z.infer<typeof AgentTaskSchema>;
export type AgentTaskState = z.infer<typeof AgentTaskStateSchema>;
export type Ask = z.infer<typeof AskSchema>;
export type AskState = z.infer<typeof AskStateSchema>;
export type Check = z.infer<typeof CheckSchema>;
export type CheckState = z.infer<typeof CheckStateSchema>;
export type Output = z.infer<typeof OutputSchema>;
export type Plan = z.infer<typeof PlanSchema>;
export type PlanTask = z.infer<typeof PlanTaskSchema>;
export type Proposal = z.infer<typeof ProposalSchema>;
export type ProposalKind = Proposal['kind'];
export type ProposalState = z.infer<typeof ProposalStateSchema>;
