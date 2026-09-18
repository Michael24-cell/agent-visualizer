import { z } from 'zod';
import {
  AgentInstanceIdSchema,
  ApprovalIdSchema,
  ArtifactIdSchema,
  DependencyIdSchema,
  PlanVersionIdSchema,
  ProjectIdSchema,
  RunIdSchema,
  TaskIdSchema,
  ValidationIdSchema,
} from './ids.js';
import {
  RuntimeAdapterDescriptorSchema,
  RuntimeCapabilitiesSchema,
} from './runtime.js';

export const RunStateSchema = z.enum([
  'draft',
  'planned',
  'awaiting_approval',
  'preparing',
  'executing',
  'paused',
  'integrating',
  'verifying',
  'completed',
  'failed',
  'cancelled',
]);

export const TaskStateSchema = z.enum([
  'proposed',
  'approved',
  'waiting',
  'ready',
  'preparing',
  'running',
  'awaiting_input',
  'validating',
  'repair_pending',
  'completed',
  'failed',
  'cancelled',
]);

export const AgentInstanceStateSchema = z.enum([
  'created',
  'starting',
  'active',
  'waiting_for_tool',
  'awaiting_approval',
  'awaiting_user',
  'interrupting',
  'completed',
  'failed',
  'cancelled',
  'disconnected',
]);

export const ApprovalStateSchema = z.enum([
  'requested',
  'approved',
  'denied',
  'expired',
  'cancelled',
]);

export const ValidationStateSchema = z.enum([
  'running',
  'passed',
  'failed',
  'cancelled',
]);

export const RunSchema = z.strictObject({
  id: RunIdSchema,
  projectId: ProjectIdSchema.optional(),
  planVersionId: PlanVersionIdSchema,
  goal: z.string().min(1),
  state: RunStateSchema,
  createdAt: z.iso.datetime(),
});

export const TaskSchema = z.strictObject({
  id: TaskIdSchema,
  runId: RunIdSchema,
  planVersionId: PlanVersionIdSchema,
  title: z.string().min(1),
  purpose: z.string().min(1),
  whySeparate: z.string().min(1),
  deliverable: z.string().min(1),
  acceptanceCriteria: z.array(z.string().min(1)).min(1),
  dependsOn: z.array(TaskIdSchema),
  allowedFileScopes: z.array(z.string().min(1)),
  skillVersionIds: z.array(z.string().min(1)),
  validationRequirements: z.array(z.string().min(1)),
  state: TaskStateSchema,
  activeAgentInstanceId: AgentInstanceIdSchema.optional(),
});

export const DependencySchema = z
  .strictObject({
    id: DependencyIdSchema,
    runId: RunIdSchema,
    upstreamTaskId: TaskIdSchema,
    downstreamTaskId: TaskIdSchema,
    type: z.enum([
      'hard',
      'data',
      'artifact',
      'approval',
      'integration',
      'soft',
    ]),
    reason: z.string().min(1),
    requiredCondition: z.string().min(1),
    state: z.enum(['unsatisfied', 'satisfied', 'waived']),
  })
  .refine((value) => value.upstreamTaskId !== value.downstreamTaskId, {
    message: 'A dependency cannot point to the same task.',
  });

export const AgentInstanceSchema = z.strictObject({
  id: AgentInstanceIdSchema,
  runId: RunIdSchema,
  taskId: TaskIdSchema,
  attempt: z.number().int().positive(),
  runtime: RuntimeAdapterDescriptorSchema,
  capabilitySnapshot: RuntimeCapabilitiesSchema,
  state: AgentInstanceStateSchema,
  createdAt: z.iso.datetime(),
  startedAt: z.iso.datetime().optional(),
  heartbeatAt: z.iso.datetime().optional(),
  endedAt: z.iso.datetime().optional(),
  terminalReason: z.string().min(1).optional(),
});

export const ApprovalSchema = z.strictObject({
  id: ApprovalIdSchema,
  runId: RunIdSchema,
  taskId: TaskIdSchema.optional(),
  agentInstanceId: AgentInstanceIdSchema.optional(),
  requestedAction: z.string().min(1),
  reason: z.string().min(1),
  scope: z.string().min(1),
  consequences: z.string().min(1),
  state: ApprovalStateSchema,
  requestedAt: z.iso.datetime(),
  decidedAt: z.iso.datetime().optional(),
  decisionNote: z.string().min(1).optional(),
});

export const ValidationResultSchema = z.strictObject({
  id: ValidationIdSchema,
  runId: RunIdSchema,
  taskId: TaskIdSchema.optional(),
  validatorType: z.string().min(1),
  command: z.string().min(1).optional(),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().optional(),
  status: ValidationStateSchema,
  exitCode: z.number().int().optional(),
  outputSummary: z.string().min(1).optional(),
  blocksCompletion: z.boolean(),
  retryOf: ValidationIdSchema.optional(),
});

export const ArtifactSchema = z.strictObject({
  id: ArtifactIdSchema,
  runId: RunIdSchema,
  taskId: TaskIdSchema,
  agentInstanceId: AgentInstanceIdSchema,
  type: z.enum(['contract', 'report', 'patch', 'diff', 'other']),
  digest: z.string().min(1),
  location: z.string().min(1).optional(),
  createdAt: z.iso.datetime(),
  validationStatus: z.enum(['unvalidated', 'valid', 'invalid']),
});

export type RunState = z.infer<typeof RunStateSchema>;
export type TaskState = z.infer<typeof TaskStateSchema>;
export type AgentInstanceState = z.infer<typeof AgentInstanceStateSchema>;
export type ApprovalState = z.infer<typeof ApprovalStateSchema>;
export type ValidationState = z.infer<typeof ValidationStateSchema>;
export type Run = z.infer<typeof RunSchema>;
export type Task = z.infer<typeof TaskSchema>;
export type Dependency = z.infer<typeof DependencySchema>;
export type AgentInstance = z.infer<typeof AgentInstanceSchema>;
export type Approval = z.infer<typeof ApprovalSchema>;
export type ValidationResult = z.infer<typeof ValidationResultSchema>;
export type Artifact = z.infer<typeof ArtifactSchema>;
