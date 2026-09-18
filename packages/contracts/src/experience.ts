import { z } from 'zod';
import { DomainEventSchema } from './events.js';
import { PlanVersionIdSchema, RunIdSchema } from './ids.js';
import { RunProjectionSchema } from './projections.js';

export const CapabilityCategorySchema = z.enum([
  'interface',
  'orchestration',
  'verification',
  'neutral',
]);

export const EnforcementStrengthSchema = z.enum([
  'prompt',
  'schema',
  'permission',
  'test',
]);

const ContextItemSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  provenance: z.string().min(1),
  category: CapabilityCategorySchema,
  enforcement: EnforcementStrengthSchema,
});

const PlanTaskFixtureSchema = z.strictObject({
  key: z.enum(['interface', 'service']),
  title: z.string().min(1),
  category: CapabilityCategorySchema,
  purpose: z.string().min(1),
  whySeparate: z.string().min(1),
  deliverable: z.string().min(1),
  acceptanceCriteria: z.array(z.string().min(1)).min(1),
  fileScopes: z.array(z.string().min(1)).min(1),
  skills: z.array(z.string().min(1)).min(1),
  dependsOn: z.array(z.enum(['interface', 'service'])),
  agentProfile: z.string().min(1),
});

export const WorkspaceFixtureSchema = z.strictObject({
  project: z.strictObject({
    id: z.string().min(1),
    name: z.string().min(1),
    repository: z.string().min(1),
    branch: z.string().min(1),
    summary: z.string().min(1),
    stack: z.array(z.string().min(1)).min(1),
    instructionFindings: z.array(
      z.strictObject({
        title: z.string().min(1),
        detail: z.string().min(1),
        status: z.enum(['active', 'advisory']),
      }),
    ),
    validationCapabilities: z.array(z.string().min(1)).min(1),
  }),
  context: z.strictObject({
    methodology: z.strictObject({
      name: z.string().min(1),
      version: z.string().min(1),
      provenance: z.string().min(1),
      summary: z.string().min(1),
    }),
    rules: z.array(ContextItemSchema),
    skills: z.array(ContextItemSchema),
    validators: z.array(ContextItemSchema),
  }),
  plan: z.strictObject({
    id: PlanVersionIdSchema,
    narrative: z.string().min(1),
    agentCountRationale: z.string().min(1),
    risks: z.array(z.string().min(1)).min(1),
    validationSummary: z.string().min(1),
    tasks: z.array(PlanTaskFixtureSchema).length(2),
  }),
  capabilities: z.array(
    z.strictObject({
      name: z.string().min(1),
      category: CapabilityCategorySchema,
      availability: z.enum(['active', 'recommended', 'dormant']),
      description: z.string().min(1),
    }),
  ),
});

export const DemoPhaseSchema = z.enum([
  'interface_active',
  'handoff_ready',
  'approval_required',
  'approval_granted',
  'repair_required',
  'completed',
  'failed',
  'cancelled',
]);

export const DemoRunSnapshotSchema = z.strictObject({
  projection: RunProjectionSchema,
  events: z.array(DomainEventSchema),
  phase: DemoPhaseSchema,
  availableCommands: z.array(z.enum(['advance', 'approve', 'deny', 'cancel'])),
  nextStepLabel: z.string().min(1),
});

export const WorkspaceResponseSchema = z.strictObject({
  workspace: WorkspaceFixtureSchema,
  activeRun: DemoRunSnapshotSchema.optional(),
});

export const LaunchDemoRunCommandSchema = z.strictObject({
  planVersionId: PlanVersionIdSchema,
});

export const LaunchDemoRunResponseSchema = z.strictObject({
  runId: RunIdSchema,
});

export const AdvanceDemoRunCommandSchema = z.strictObject({
  expectedSequence: z.number().int().positive(),
});

export const ApprovalDecisionCommandSchema = z.strictObject({
  expectedSequence: z.number().int().positive(),
  decision: z.enum(['approved', 'denied']),
});

export const CancelDemoRunCommandSchema = z.strictObject({
  expectedSequence: z.number().int().positive(),
});

export type WorkspaceFixture = z.infer<typeof WorkspaceFixtureSchema>;
export type DemoRunSnapshot = z.infer<typeof DemoRunSnapshotSchema>;
export type WorkspaceResponse = z.infer<typeof WorkspaceResponseSchema>;
