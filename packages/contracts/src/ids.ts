import { z } from 'zod';

const suffix = '[A-Za-z0-9][A-Za-z0-9_-]{0,127}';

export const ProjectIdSchema = z
  .string()
  .regex(new RegExp(`^project_${suffix}$`))
  .brand<'ProjectId'>();
export const RunIdSchema = z
  .string()
  .regex(new RegExp(`^run_${suffix}$`))
  .brand<'RunId'>();
export const PlanVersionIdSchema = z
  .string()
  .regex(new RegExp(`^planv_${suffix}$`))
  .brand<'PlanVersionId'>();
export const TaskIdSchema = z
  .string()
  .regex(new RegExp(`^task_${suffix}$`))
  .brand<'TaskId'>();
export const DependencyIdSchema = z
  .string()
  .regex(new RegExp(`^dependency_${suffix}$`))
  .brand<'DependencyId'>();
export const AgentInstanceIdSchema = z
  .string()
  .regex(new RegExp(`^agent_${suffix}$`))
  .brand<'AgentInstanceId'>();
export const ApprovalIdSchema = z
  .string()
  .regex(new RegExp(`^approval_${suffix}$`))
  .brand<'ApprovalId'>();
export const ValidationIdSchema = z
  .string()
  .regex(new RegExp(`^validation_${suffix}$`))
  .brand<'ValidationId'>();
export const ArtifactIdSchema = z
  .string()
  .regex(new RegExp(`^artifact_${suffix}$`))
  .brand<'ArtifactId'>();
export const EventIdSchema = z
  .string()
  .regex(new RegExp(`^event_${suffix}$`))
  .brand<'EventId'>();
export const CorrelationIdSchema = z
  .string()
  .regex(new RegExp(`^correlation_${suffix}$`))
  .brand<'CorrelationId'>();

export type ProjectId = z.infer<typeof ProjectIdSchema>;
export type RunId = z.infer<typeof RunIdSchema>;
export type PlanVersionId = z.infer<typeof PlanVersionIdSchema>;
export type TaskId = z.infer<typeof TaskIdSchema>;
export type DependencyId = z.infer<typeof DependencyIdSchema>;
export type AgentInstanceId = z.infer<typeof AgentInstanceIdSchema>;
export type ApprovalId = z.infer<typeof ApprovalIdSchema>;
export type ValidationId = z.infer<typeof ValidationIdSchema>;
export type ArtifactId = z.infer<typeof ArtifactIdSchema>;
export type EventId = z.infer<typeof EventIdSchema>;
export type CorrelationId = z.infer<typeof CorrelationIdSchema>;
