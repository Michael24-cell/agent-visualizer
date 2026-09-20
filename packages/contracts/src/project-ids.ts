import { z } from 'zod';

const suffix = '[A-Za-z0-9][A-Za-z0-9_-]{0,127}';

function prefixed<TBrand extends string>(prefix: string) {
  return z
    .string()
    .regex(new RegExp(`^${prefix}_${suffix}$`))
    .brand<TBrand>();
}

export const AgentIdSchema = prefixed<'AgentId'>('agent');
export const ThreadIdSchema = prefixed<'ThreadId'>('thread');
export const MessageIdSchema = prefixed<'MessageId'>('message');
export const ProposalIdSchema = prefixed<'ProposalId'>('proposal');
export const PlanIdSchema = prefixed<'PlanId'>('plan');
export const AskIdSchema = prefixed<'AskId'>('ask');
export const CheckIdSchema = prefixed<'CheckId'>('check');
export const OutputIdSchema = prefixed<'OutputId'>('output');
export const MethodIdSchema = prefixed<'MethodId'>('method');
export const MethodSnapshotIdSchema =
  prefixed<'MethodSnapshotId'>('methodsnap');
export const BriefRequestIdSchema = prefixed<'BriefRequestId'>('request');
export const CommandIdSchema = z.uuid().brand<'CommandId'>();

export type AgentId = z.infer<typeof AgentIdSchema>;
export type ThreadId = z.infer<typeof ThreadIdSchema>;
export type MessageId = z.infer<typeof MessageIdSchema>;
export type ProposalId = z.infer<typeof ProposalIdSchema>;
export type PlanId = z.infer<typeof PlanIdSchema>;
export type AskId = z.infer<typeof AskIdSchema>;
export type CheckId = z.infer<typeof CheckIdSchema>;
export type OutputId = z.infer<typeof OutputIdSchema>;
export type MethodId = z.infer<typeof MethodIdSchema>;
export type MethodSnapshotId = z.infer<typeof MethodSnapshotIdSchema>;
export type BriefRequestId = z.infer<typeof BriefRequestIdSchema>;
export type CommandId = z.infer<typeof CommandIdSchema>;
