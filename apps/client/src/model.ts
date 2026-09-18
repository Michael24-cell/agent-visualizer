import type {
  DemoRunSnapshot,
  DomainEvent,
  TaskState,
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
      currentActivity: activityFor(state, fixtureTask.key),
      evidence,
    };
  });
}

export function describeEvent(event: DomainEvent): string {
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
        event.payload.validationId
          .replace(/^validation_/, '')
          .split('_')
          .at(-1) ?? 'Validation'
      } ${event.payload.to}: ${event.payload.outputSummary}`;
    case 'artifact.produced':
      return `Produced a validated ${event.payload.artifact.type} artifact.`;
    case 'runtime.disconnected':
      return `Runtime disconnected: ${event.payload.reason}`;
    case 'runtime.reconciled':
      return `Runtime reconciled: ${event.payload.reason}`;
  }
}
