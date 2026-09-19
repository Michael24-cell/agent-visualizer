import type {
  DemoRunSnapshot,
  DomainEvent,
  RunProjection,
  TaskState,
  ValidationResult,
  WorkspaceFixture,
} from '@harness/contracts';

export type FixtureTaskKey = 'interface' | 'service';
export type AppSurface =
  'project' | 'context' | 'plan' | 'run' | 'atlas' | 'review' | 'history';

export type Capability = WorkspaceFixture['capabilities'][number];
export type CapabilityFilter = 'all' | 'agents' | 'skills';

export interface TaskViewModel {
  readonly key: FixtureTaskKey;
  readonly title: string;
  readonly category: 'interface' | 'orchestration' | 'verification' | 'neutral';
  readonly state: TaskState;
  readonly stateLabel: string;
  readonly statusSymbol: string;
  readonly purpose: string;
  readonly whySeparate: string;
  readonly deliverable: string;
  readonly acceptanceCriteria: readonly string[];
  readonly fileScopes: readonly string[];
  readonly skills: readonly string[];
  readonly dependsOn: readonly FixtureTaskKey[];
  readonly agentProfile: string;
  readonly agentState?: string;
  readonly currentActivity: string;
  readonly evidence: readonly string[];
}

export interface ReviewViewModel {
  readonly state:
    | 'prelaunch'
    | 'in_progress'
    | 'attention'
    | 'ready'
    | 'failed'
    | 'cancelled';
  readonly mark: string;
  readonly title: string;
  readonly description: string;
  readonly hasDiffArtifact: boolean;
  readonly warningTitle: string;
  readonly warningDescription: string;
  readonly warningState: 'none' | 'unresolved' | 'resolved';
}

export interface AttentionViewModel {
  readonly title: string;
  readonly detail: string;
  readonly taskKey?: FixtureTaskKey;
}

const stateLabels: Record<TaskState, string> = {
  proposed: 'Proposed',
  approved: 'Approved',
  waiting: 'Waiting',
  ready: 'Ready',
  preparing: 'Preparing',
  running: 'In progress',
  awaiting_input: 'Needs you',
  validating: 'Validating',
  repair_pending: 'Needs a fix',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Stopped',
};

const statusSymbols: Record<TaskState, string> = {
  proposed: '○',
  approved: '✓',
  waiting: '↳',
  ready: '◇',
  preparing: '…',
  running: '▶',
  awaiting_input: '!',
  validating: '◆',
  repair_pending: '↻',
  completed: '✓',
  failed: '×',
  cancelled: '—',
};

function activityFor(taskState: TaskState, key: FixtureTaskKey): string {
  const active: Record<TaskState, string> = {
    proposed: 'Ready for plan review.',
    approved: 'Approved in the pinned plan.',
    waiting: 'Waiting for the contract from the interface agent.',
    ready: 'Dependencies are satisfied.',
    preparing: 'Preparing the task context.',
    running:
      key === 'interface'
        ? 'Defining form states and the shared request contract.'
        : 'Implementing the authenticated service handoff.',
    awaiting_input: 'Waiting for your decision.',
    validating: 'Running checks.',
    repair_pending: 'A check failed; a fix is ready to apply.',
    completed: 'Done, with checks attached.',
    failed: 'Work stopped before acceptance criteria were met.',
    cancelled: 'Stopped by you.',
  };
  return active[taskState];
}

function latestTaskActivity(
  events: readonly DomainEvent[],
  taskId: string,
): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (
      event?.taskId === taskId &&
      (event.type === 'task.state_changed' ||
        event.type === 'agent.state_changed')
    ) {
      return event.payload.reason;
    }
  }
  return undefined;
}

function projectedTaskForFixture(
  projection: RunProjection,
  key: FixtureTaskKey,
) {
  return Object.values(projection.tasks).find((task) =>
    task.id.endsWith(`_${key}`),
  );
}

export function buildTaskViewModels(
  workspace: WorkspaceFixture,
  snapshot?: DemoRunSnapshot,
): TaskViewModel[] {
  return workspace.plan.tasks.map((fixtureTask) => {
    const task = snapshot
      ? projectedTaskForFixture(snapshot.projection, fixtureTask.key)
      : undefined;
    const state = task?.state ?? 'proposed';
    const agent = task?.activeAgentInstanceId
      ? snapshot?.projection.agents[task.activeAgentInstanceId]
      : undefined;
    const evidence = task
      ? [
          ...Object.values(snapshot?.projection.validations ?? {})
            .filter((validation) => validation.taskId === task.id)
            .map(
              (validation) =>
                `${validation.validatorType}: ${validation.status}${
                  validation.outputSummary
                    ? ` — ${validation.outputSummary}`
                    : ''
                }`,
            ),
          ...Object.values(snapshot?.projection.artifacts ?? {})
            .filter((artifact) => artifact.taskId === task.id)
            .map((artifact) => `${artifact.type}: ${artifact.digest}`),
        ]
      : [];
    return {
      key: fixtureTask.key,
      title: fixtureTask.title,
      category: fixtureTask.category,
      state,
      stateLabel: stateLabels[state],
      statusSymbol: statusSymbols[state],
      purpose: fixtureTask.purpose,
      whySeparate: fixtureTask.whySeparate,
      deliverable: fixtureTask.deliverable,
      acceptanceCriteria: fixtureTask.acceptanceCriteria,
      fileScopes: fixtureTask.fileScopes,
      skills: fixtureTask.skills,
      dependsOn: fixtureTask.dependsOn,
      agentProfile: fixtureTask.agentProfile,
      ...(agent ? { agentState: agent.state.replaceAll('_', ' ') } : {}),
      currentActivity:
        (task
          ? latestTaskActivity(snapshot?.events ?? [], task.id)
          : undefined) ?? activityFor(state, fixtureTask.key),
      evidence,
    };
  });
}

function latestValidationsByIdentity(
  validations: readonly ValidationResult[],
): Map<string, ValidationResult> {
  const latest = new Map<string, ValidationResult>();
  for (const validation of [...validations].sort((left, right) =>
    left.startedAt.localeCompare(right.startedAt),
  )) {
    latest.set(
      `${validation.taskId ?? 'run'}:${validation.validatorType}`,
      validation,
    );
  }
  return latest;
}

export function buildReviewViewModel(
  snapshot?: DemoRunSnapshot,
): ReviewViewModel {
  const validations = snapshot
    ? Object.values(snapshot.projection.validations)
    : [];
  const failedValidations = validations.filter(
    (validation) => validation.status === 'failed',
  );
  const latestValidations = latestValidationsByIdentity(validations);
  const unresolvedFailures = failedValidations.filter((validation) => {
    const latest = latestValidations.get(
      `${validation.taskId ?? 'run'}:${validation.validatorType}`,
    );
    return latest?.status !== 'passed';
  });
  const warningState: ReviewViewModel['warningState'] = failedValidations.length
    ? unresolvedFailures.length
      ? 'unresolved'
      : 'resolved'
    : 'none';
  const warningCount =
    warningState === 'unresolved'
      ? unresolvedFailures.length
      : failedValidations.length;
  const warningValidation =
    unresolvedFailures.at(-1) ?? failedValidations.at(-1);
  const warningTitle =
    warningState === 'none'
      ? 'No warnings'
      : `${warningCount} ${
          warningState === 'resolved' ? 'resolved' : 'unresolved'
        } warning${warningCount === 1 ? '' : 's'}`;
  const warningDescription =
    warningValidation?.outputSummary ??
    'A failed check stays here until a later check passes.';
  const shared = {
    hasDiffArtifact:
      snapshot !== undefined &&
      Object.values(snapshot.projection.artifacts).some(
        (artifact) => artifact.type === 'diff',
      ),
    warningTitle,
    warningDescription,
    warningState,
  } as const;

  if (!snapshot) {
    return {
      ...shared,
      state: 'prelaunch',
      mark: '○',
      title: 'Nothing to review yet',
      description: 'Start the plan to collect checks and outputs.',
    };
  }
  if (snapshot.phase === 'completed') {
    return {
      ...shared,
      state: 'ready',
      mark: '✓',
      title: 'Ready for human review',
      description:
        'Every task passed its latest checks. Earlier failures stay in history.',
    };
  }
  if (snapshot.phase === 'repair_required') {
    return {
      ...shared,
      state: 'attention',
      mark: '!',
      title: 'A fix is needed first',
      description: 'A check failed. Apply the fix, then review the new result.',
    };
  }
  if (snapshot.phase === 'failed') {
    return {
      ...shared,
      state: 'failed',
      mark: '×',
      title: 'Work failed',
      description:
        'A required action was denied or failed. Everything so far is kept for review.',
    };
  }
  if (snapshot.phase === 'cancelled') {
    return {
      ...shared,
      state: 'cancelled',
      mark: '—',
      title: 'Work stopped',
      description: 'Nothing more will start. What was done is kept.',
    };
  }
  return {
    ...shared,
    state: snapshot.projection.attentionRequired ? 'attention' : 'in_progress',
    mark: snapshot.projection.attentionRequired ? '!' : '…',
    title: snapshot.projection.attentionRequired ? 'Needs you' : 'In progress',
    description: snapshot.projection.attentionRequired
      ? 'Decide on the open request before work continues.'
      : 'Agents are working. Checks and outputs appear as they land.',
  };
}

function fixtureKeyForTask(
  workspace: WorkspaceFixture,
  projection: RunProjection,
  taskId: string | undefined,
): FixtureTaskKey | undefined {
  if (!taskId) return undefined;
  const task = projection.tasks[taskId];
  return workspace.plan.tasks.find((candidate) =>
    task?.id.endsWith(`_${candidate.key}`),
  )?.key;
}

export function buildAttentionViewModel(
  workspace: WorkspaceFixture,
  snapshot?: DemoRunSnapshot,
): AttentionViewModel | undefined {
  if (!snapshot?.projection.attentionRequired || isTerminalRun(snapshot))
    return undefined;
  const approval = Object.values(snapshot.projection.approvals).find(
    (candidate) => candidate.state === 'requested',
  );
  if (approval) {
    const taskKey = fixtureKeyForTask(
      workspace,
      snapshot.projection,
      approval.taskId,
    );
    return {
      title: `Needs you: ${approval.requestedAction}`,
      detail: approval.reason,
      ...(taskKey ? { taskKey } : {}),
    };
  }
  const repairTask = Object.values(snapshot.projection.tasks).find(
    (task) => task.state === 'repair_pending',
  );
  const failedValidation = Object.values(snapshot.projection.validations)
    .filter(
      (validation) =>
        validation.taskId === repairTask?.id && validation.status === 'failed',
    )
    .at(-1);
  if (repairTask) {
    const taskKey = fixtureKeyForTask(
      workspace,
      snapshot.projection,
      repairTask.id,
    );
    return {
      title: `Needs a fix: ${repairTask.title}`,
      detail:
        failedValidation?.outputSummary ??
        'A check failed and needs a fix before work continues.',
      ...(taskKey ? { taskKey } : {}),
    };
  }
  return {
    title: 'Needs you',
    detail: 'Review the current work before continuing.',
  };
}

export function isTerminalRun(snapshot?: DemoRunSnapshot): boolean {
  return Boolean(
    snapshot && ['completed', 'failed', 'cancelled'].includes(snapshot.phase),
  );
}

export function defaultSurfaceFor(snapshot?: DemoRunSnapshot): AppSurface {
  if (!snapshot) return 'project';
  return isTerminalRun(snapshot) ? 'review' : 'run';
}

export function filterCapabilities(
  capabilities: readonly Capability[],
  filter: CapabilityFilter,
  state: Capability['availability'] | 'all',
): Capability[] {
  return capabilities.filter((capability) => {
    const matchesKind =
      filter === 'all' ||
      (filter === 'agents' && capability.kind === 'agent') ||
      (filter === 'skills' && capability.kind === 'skill');
    return (
      matchesKind && (state === 'all' || capability.availability === state)
    );
  });
}

function workStateLabel(state: string): string {
  const labels: Record<string, string> = {
    executing: 'in progress',
    verifying: 'checking',
    completed: 'done',
    failed: 'failed',
    cancelled: 'stopped',
    paused: 'paused',
  };
  return labels[state] ?? state.replaceAll('_', ' ');
}

export function describeEvent(
  event: DomainEvent,
  projection?: RunProjection,
): string {
  switch (event.type) {
    case 'run.created':
      return 'Started plan v1.';
    case 'task.created':
      return `Added “${event.payload.task.title}” to the run.`;
    case 'dependency.created':
      return 'The service task waits for the interface contract.';
    case 'dependency.state_changed':
      return 'Contract ready — the backend agent can start.';
    case 'agent.instance_created':
      return 'Agent assigned.';
    case 'run.state_changed':
      return `Work ${workStateLabel(event.payload.to)} — ${event.payload.reason}`;
    case 'task.state_changed':
      return `${stateLabels[event.payload.to]} — ${event.payload.reason}`;
    case 'agent.state_changed':
      return `Agent ${event.payload.to.replaceAll('_', ' ')} — ${event.payload.reason}`;
    case 'approval.requested':
      return `Asked: ${event.payload.approval.requestedAction}.`;
    case 'approval.decided':
      return `You ${event.payload.to === 'approved' ? 'approved' : event.payload.to === 'denied' ? 'denied' : 'stopped'} the request.`;
    case 'validation.started':
      return `Running check: ${event.payload.validation.validatorType}.`;
    case 'validation.completed':
      return `${
        projection?.validations[event.payload.validationId]?.validatorType ??
        'Check'
      } ${event.payload.to === 'passed' ? 'passed' : 'failed'} — ${event.payload.outputSummary}`;
    case 'artifact.produced':
      return `Produced the ${event.payload.artifact.type}.`;
    case 'runtime.disconnected':
      return `Runtime disconnected: ${event.payload.reason}`;
    case 'runtime.reconciled':
      return `Runtime reconciled: ${event.payload.reason}`;
  }
}
