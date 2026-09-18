import type {
  DemoRunSnapshot,
  DomainEvent,
  RunProjection,
  TaskState,
  ValidationResult,
  WorkspaceFixture,
} from '@harness/contracts';

export type FixtureTaskKey = 'interface' | 'service';

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
  waiting: 'Waiting on dependency',
  ready: 'Ready',
  preparing: 'Preparing',
  running: 'In progress',
  awaiting_input: 'Needs approval',
  validating: 'Validating',
  repair_pending: 'Repair required',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
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
    waiting: 'Waiting for the validated contract handoff.',
    ready: 'Dependencies are satisfied.',
    preparing: 'Preparing the task context.',
    running:
      key === 'interface'
        ? 'Defining form states and the shared request contract.'
        : 'Implementing the authenticated service handoff.',
    awaiting_input: 'Waiting for a bounded capability decision.',
    validating: 'Running blocking evidence checks.',
    repair_pending: 'Focus behavior failed; a bounded repair is ready.',
    completed: 'Deliverable and validation evidence are attached.',
    failed: 'Work stopped before acceptance criteria were met.',
    cancelled: 'The task was cancelled by the user.',
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

export function buildTaskViewModels(
  workspace: WorkspaceFixture,
  snapshot?: DemoRunSnapshot,
): TaskViewModel[] {
  return workspace.plan.tasks.map((fixtureTask) => {
    const task = snapshot
      ? Object.values(snapshot.projection.tasks).find(
          (candidate) => candidate.title === fixtureTask.title,
        )
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
      ? 'No validation warnings recorded'
      : `${warningCount} ${
          warningState === 'resolved' ? 'resolved' : 'unresolved'
        } validation warning${warningCount === 1 ? '' : 's'}`;
  const warningDescription =
    warningValidation?.outputSummary ??
    'A validation warning will remain visible here until a later passing result supersedes it.';
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
      title: 'Review begins after launch',
      description:
        'Launch the approved plan to collect validation, artifact, and diff evidence.',
    };
  }
  if (snapshot.phase === 'completed') {
    return {
      ...shared,
      state: 'ready',
      mark: '✓',
      title: 'Ready for human review',
      description:
        'Both task contracts passed their latest blocking validations. Earlier failures remain visible in history.',
    };
  }
  if (snapshot.phase === 'repair_required') {
    return {
      ...shared,
      state: 'attention',
      mark: '!',
      title: 'Repair required before review',
      description:
        'A blocking validation is still unresolved. Apply the bounded repair, then review the new evidence.',
    };
  }
  if (snapshot.phase === 'failed') {
    return {
      ...shared,
      state: 'failed',
      mark: '×',
      title: 'Run failed and remains blocked',
      description:
        'A required action was denied or failed. Preserved events and evidence remain available for review.',
    };
  }
  if (snapshot.phase === 'cancelled') {
    return {
      ...shared,
      state: 'cancelled',
      mark: '—',
      title: 'Run cancelled with work preserved',
      description:
        'No further work will start. Existing events, artifacts, and validation evidence remain inspectable.',
    };
  }
  return {
    ...shared,
    state: snapshot.projection.attentionRequired ? 'attention' : 'in_progress',
    mark: snapshot.projection.attentionRequired ? '!' : '…',
    title: snapshot.projection.attentionRequired
      ? 'Run needs a decision'
      : 'Run is in progress',
    description: snapshot.projection.attentionRequired
      ? 'Resolve the highlighted approval or task repair before the run can continue.'
      : 'The deterministic run is collecting task, validation, and artifact evidence.',
  };
}

function fixtureKeyForTask(
  workspace: WorkspaceFixture,
  projection: RunProjection,
  taskId: string | undefined,
): FixtureTaskKey | undefined {
  if (!taskId) return undefined;
  const task = projection.tasks[taskId];
  return workspace.plan.tasks.find(
    (candidate) => candidate.title === task?.title,
  )?.key;
}

export function buildAttentionViewModel(
  workspace: WorkspaceFixture,
  snapshot?: DemoRunSnapshot,
): AttentionViewModel | undefined {
  if (!snapshot?.projection.attentionRequired) return undefined;
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
      title: `Approval needed: ${approval.requestedAction}`,
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
      title: `Repair needed: ${repairTask.title}`,
      detail:
        failedValidation?.outputSummary ??
        'A blocking validation must be repaired before the run can continue.',
      ...(taskKey ? { taskKey } : {}),
    };
  }
  return {
    title: 'Run needs attention',
    detail: 'Review the current run evidence before continuing.',
  };
}

export function isTerminalRun(snapshot?: DemoRunSnapshot): boolean {
  return Boolean(
    snapshot && ['completed', 'failed', 'cancelled'].includes(snapshot.phase),
  );
}

export function describeEvent(
  event: DomainEvent,
  projection?: RunProjection,
): string {
  switch (event.type) {
    case 'run.created':
      return 'Created the run from approved plan v1.';
    case 'task.created':
      return `Added “${event.payload.task.title}” to the run.`;
    case 'dependency.created':
      return 'Declared the contract handoff dependency.';
    case 'dependency.state_changed':
      return 'Released the service task with validated contract evidence.';
    case 'agent.instance_created':
      return 'Prepared a task-specific simulated agent.';
    case 'run.state_changed':
      return `Run ${event.payload.to.replaceAll('_', ' ')} — ${event.payload.reason}`;
    case 'task.state_changed':
      return `Task ${event.payload.to.replaceAll('_', ' ')} — ${event.payload.reason}`;
    case 'agent.state_changed':
      return `Agent ${event.payload.to.replaceAll('_', ' ')} — ${event.payload.reason}`;
    case 'approval.requested':
      return `Approval requested: ${event.payload.approval.requestedAction}.`;
    case 'approval.decided':
      return `Approval ${event.payload.to}.`;
    case 'validation.started':
      return `Started ${event.payload.validation.validatorType}.`;
    case 'validation.completed':
      return `${
        projection?.validations[event.payload.validationId]?.validatorType ??
        'Validation'
      } ${event.payload.to}: ${event.payload.outputSummary}`;
    case 'artifact.produced':
      return `Produced a validated ${event.payload.artifact.type} artifact.`;
    case 'runtime.disconnected':
      return `Runtime disconnected: ${event.payload.reason}`;
    case 'runtime.reconciled':
      return `Runtime reconciled: ${event.payload.reason}`;
  }
}
