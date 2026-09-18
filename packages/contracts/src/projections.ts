import { z } from 'zod';
import {
  AgentInstanceSchema,
  ApprovalSchema,
  ArtifactSchema,
  DependencySchema,
  RunSchema,
  TaskSchema,
  ValidationResultSchema,
} from './entities.js';
import { EventIdSchema, RunIdSchema } from './ids.js';

export const RunProjectionSchema = z.strictObject({
  runId: RunIdSchema,
  run: RunSchema,
  tasks: z.record(z.string(), TaskSchema),
  dependencies: z.record(z.string(), DependencySchema),
  agents: z.record(z.string(), AgentInstanceSchema),
  approvals: z.record(z.string(), ApprovalSchema),
  validations: z.record(z.string(), ValidationResultSchema),
  artifacts: z.record(z.string(), ArtifactSchema),
  runtimeConnection: z.enum(['connected', 'disconnected', 'reconciled']),
  recoverySummary: z.string().min(1).optional(),
  attentionRequired: z.boolean(),
  lastSequence: z.number().int().positive(),
  lastEventId: EventIdSchema,
  appliedEventIds: z.array(EventIdSchema),
});

export type RunProjection = z.infer<typeof RunProjectionSchema>;
