import type {
  AgentTaskState,
  AskState,
  BriefFieldState,
  CheckState,
  ProposalState,
  ThreadState,
} from '@harness/contracts';
import { TransitionError } from './transitions.js';

export type ProjectTransitionEntity =
  'agent_task' | 'ask' | 'check' | 'proposal' | 'thread' | 'brief_field';

const agentTaskTransitions: Record<AgentTaskState, readonly AgentTaskState[]> =
  {
    waiting: ['working', 'stopped'],
    working: ['needs_you', 'done', 'failed', 'stopped'],
    needs_you: ['working', 'failed', 'stopped'],
    done: [],
    stopped: [],
    failed: [],
  };

const askTransitions: Record<AskState, readonly AskState[]> = {
  open: ['approved', 'denied', 'closed'],
  approved: [],
  denied: [],
  closed: [],
};

const checkTransitions: Record<CheckState, readonly CheckState[]> = {
  running: ['passed', 'failed', 'stopped'],
  passed: [],
  failed: [],
  stopped: [],
};

const proposalTransitions: Record<ProposalState, readonly ProposalState[]> = {
  open: ['approved', 'denied', 'dismissed', 'superseded'],
  approved: [],
  denied: [],
  dismissed: [],
  superseded: [],
};

const threadTransitions: Record<ThreadState, readonly ThreadState[]> = {
  open: ['closed'],
  closed: [],
};

// Brief fields are never terminal: a confirmed value can still be corrected.
const briefFieldTransitions: Record<
  BriefFieldState,
  readonly BriefFieldState[]
> = {
  missing: ['inferred', 'confirmed', 'skipped'],
  inferred: ['confirmed', 'corrected', 'skipped'],
  confirmed: ['corrected'],
  skipped: ['inferred', 'confirmed', 'corrected'],
  corrected: ['confirmed', 'corrected'],
};

export const TERMINAL_TASK_STATES: readonly AgentTaskState[] = [
  'done',
  'stopped',
  'failed',
];

export function isTerminalTaskState(state: AgentTaskState): boolean {
  return TERMINAL_TASK_STATES.includes(state);
}

function assertAllowed<TState extends string>(
  entity: ProjectTransitionEntity,
  from: TState,
  to: TState,
  transitions: Record<TState, readonly TState[]>,
): void {
  const allowed = transitions[from];
  if (allowed.length === 0) {
    throw new TransitionError(entity, from, to, 'terminal_state');
  }
  if (!allowed.includes(to)) {
    throw new TransitionError(entity, from, to, 'invalid_transition');
  }
}

export function assertAgentTaskTransition(
  from: AgentTaskState,
  to: AgentTaskState,
): void {
  assertAllowed('agent_task', from, to, agentTaskTransitions);
}

export function assertAskTransition(from: AskState, to: AskState): void {
  assertAllowed('ask', from, to, askTransitions);
}

export function assertCheckTransition(from: CheckState, to: CheckState): void {
  assertAllowed('check', from, to, checkTransitions);
}

export function assertProposalTransition(
  from: ProposalState,
  to: ProposalState,
): void {
  assertAllowed('proposal', from, to, proposalTransitions);
}

export function assertThreadTransition(
  from: ThreadState,
  to: ThreadState,
): void {
  assertAllowed('thread', from, to, threadTransitions);
}

export function assertBriefFieldTransition(
  from: BriefFieldState,
  to: BriefFieldState,
): void {
  assertAllowed('brief_field', from, to, briefFieldTransitions);
}
