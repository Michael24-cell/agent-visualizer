import type {
  AgentInstanceState,
  ApprovalState,
  RunState,
  TaskState,
  ValidationState,
} from '@harness/contracts';

export type TransitionEntity =
  'run' | 'task' | 'agent_instance' | 'approval' | 'validation';

export class TransitionError extends Error {
  readonly code: 'invalid_transition' | 'terminal_state';

  constructor(
    readonly entity: TransitionEntity,
    readonly from: string,
    readonly to: string,
    code: 'invalid_transition' | 'terminal_state',
  ) {
    super(`Cannot transition ${entity} from ${from} to ${to}: ${code}.`);
    this.name = 'TransitionError';
    this.code = code;
  }
}

const runTransitions: Record<RunState, readonly RunState[]> = {
  draft: ['planned', 'failed', 'cancelled'],
  planned: ['awaiting_approval', 'preparing', 'failed', 'cancelled'],
  awaiting_approval: ['preparing', 'failed', 'cancelled'],
  preparing: ['executing', 'paused', 'failed', 'cancelled'],
  executing: [
    'paused',
    'integrating',
    'verifying',
    'completed',
    'failed',
    'cancelled',
  ],
  paused: [
    'preparing',
    'executing',
    'integrating',
    'verifying',
    'failed',
    'cancelled',
  ],
  integrating: ['verifying', 'paused', 'failed', 'cancelled'],
  verifying: ['completed', 'paused', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
};

const taskTransitions: Record<TaskState, readonly TaskState[]> = {
  proposed: ['approved', 'cancelled'],
  approved: ['waiting', 'ready', 'cancelled'],
  waiting: ['ready', 'cancelled'],
  ready: ['preparing', 'running', 'cancelled'],
  preparing: ['running', 'awaiting_input', 'failed', 'cancelled'],
  running: ['awaiting_input', 'validating', 'failed', 'cancelled'],
  awaiting_input: ['running', 'ready', 'failed', 'cancelled'],
  validating: ['completed', 'repair_pending', 'failed', 'cancelled'],
  repair_pending: ['ready', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
};

const agentTransitions: Record<
  AgentInstanceState,
  readonly AgentInstanceState[]
> = {
  created: ['starting', 'cancelled'],
  starting: ['active', 'failed', 'cancelled', 'disconnected'],
  active: [
    'waiting_for_tool',
    'awaiting_approval',
    'awaiting_user',
    'interrupting',
    'completed',
    'failed',
    'cancelled',
    'disconnected',
  ],
  waiting_for_tool: [
    'active',
    'awaiting_approval',
    'failed',
    'cancelled',
    'disconnected',
  ],
  awaiting_approval: [
    'active',
    'interrupting',
    'failed',
    'cancelled',
    'disconnected',
  ],
  awaiting_user: [
    'active',
    'interrupting',
    'failed',
    'cancelled',
    'disconnected',
  ],
  interrupting: ['completed', 'failed', 'cancelled', 'disconnected'],
  disconnected: ['active', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
};

const approvalTransitions: Record<ApprovalState, readonly ApprovalState[]> = {
  requested: ['approved', 'denied', 'expired', 'cancelled'],
  approved: [],
  denied: [],
  expired: [],
  cancelled: [],
};

const validationTransitions: Record<
  ValidationState,
  readonly ValidationState[]
> = {
  running: ['passed', 'failed', 'cancelled'],
  passed: [],
  failed: [],
  cancelled: [],
};

function assertAllowed<TState extends string>(
  entity: TransitionEntity,
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

export function assertRunTransition(from: RunState, to: RunState): void {
  assertAllowed('run', from, to, runTransitions);
}

export function assertTaskTransition(from: TaskState, to: TaskState): void {
  assertAllowed('task', from, to, taskTransitions);
}

export function assertAgentTransition(
  from: AgentInstanceState,
  to: AgentInstanceState,
): void {
  assertAllowed('agent_instance', from, to, agentTransitions);
}

export function assertApprovalTransition(
  from: ApprovalState,
  to: ApprovalState,
): void {
  assertAllowed('approval', from, to, approvalTransitions);
}

export function assertValidationTransition(
  from: ValidationState,
  to: ValidationState,
): void {
  assertAllowed('validation', from, to, validationTransitions);
}
