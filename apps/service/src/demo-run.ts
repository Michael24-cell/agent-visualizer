import {
  AgentInstanceIdSchema,
  AgentInstanceSchema,
  ApprovalIdSchema,
  ApprovalSchema,
  ArtifactIdSchema,
  ArtifactSchema,
  CorrelationIdSchema,
  DependencyIdSchema,
  DependencySchema,
  DomainEventSchema,
  EventIdSchema,
  PlanVersionIdSchema,
  ProjectIdSchema,
  RunIdSchema,
  RunSchema,
  TaskIdSchema,
  TaskSchema,
  ValidationIdSchema,
  ValidationResultSchema,
  WorkspaceFixtureSchema,
  type DemoRunSnapshot,
  type DomainEvent,
  type EventSource,
  type RunProjection,
  type WorkspaceFixture,
} from '@harness/contracts';
import { applyDomainEvent as reduceDomainEvent } from '@harness/domain';
import type { SqliteEventStore } from '@harness/persistence';

const PROJECT_ID = ProjectIdSchema.parse('project_harness-demo');
export const DEMO_PLAN_VERSION_ID = PlanVersionIdSchema.parse(
  'planv_harness-demo-v1',
);
const BASE_TIME = Date.parse('2026-02-10T09:00:00.000Z');

export const workspaceFixture: WorkspaceFixture = WorkspaceFixtureSchema.parse({
  project: {
    id: PROJECT_ID,
    name: 'Account preferences loop',
    repository: 'local/agent-visualizer',
    branch: 'main',
    summary:
      'A focused fixture for shipping an accessible preferences form through an authenticated service boundary.',
    stack: ['React 19', 'TypeScript', 'Fastify', 'SQLite', 'Vitest'],
    instructionFindings: [
      {
        title: 'Local-only service boundary',
        detail:
          'Loopback binding, origin checks, and session authentication are mandatory.',
        status: 'active',
      },
      {
        title: 'Event-derived execution state',
        detail: 'Visible run status must come from persisted domain events.',
        status: 'active',
      },
      {
        title: 'One agent unless separation earns its cost',
        detail:
          'Sequential task instances are preferred over speculative parallelism.',
        status: 'advisory',
      },
    ],
    validationCapabilities: [
      'Contract conformance',
      'Responsive interaction review',
      'Keyboard and reduced-motion checks',
    ],
  },
  context: {
    methodology: {
      name: 'Evidence-led delivery',
      version: '1.2.0',
      provenance: 'Project fixture · pinned to plan v1',
      summary:
        'Establish the service contract first, keep execution state authoritative, and close work only with visible evidence.',
    },
    rules: [
      {
        id: 'rule-authority',
        name: 'Projection is authoritative',
        description: 'React may select and filter state, but cannot invent it.',
        provenance: 'MVP product invariant',
        category: 'neutral',
        enforcement: 'schema',
      },
      {
        id: 'rule-security',
        name: 'Preserve the local boundary',
        description: 'All commands retain session and origin validation.',
        provenance: 'Repository configuration',
        category: 'orchestration',
        enforcement: 'permission',
      },
    ],
    skills: [
      {
        id: 'skill-interface',
        name: 'Accessible interface craft',
        description: 'Keyboard, responsive, and reduced-motion implementation.',
        provenance: 'Selected for task 1',
        category: 'interface',
        enforcement: 'prompt',
      },
      {
        id: 'skill-contract',
        name: 'Service contract discipline',
        description: 'Runtime validation and authenticated command boundaries.',
        provenance: 'Selected for task 2',
        category: 'orchestration',
        enforcement: 'schema',
      },
    ],
    validators: [
      {
        id: 'validator-contract',
        name: 'contract-check',
        description: 'Confirms the shared request and response surface.',
        provenance: 'Vitest fixture',
        category: 'verification',
        enforcement: 'test',
      },
      {
        id: 'validator-experience',
        name: 'experience-check',
        description: 'Checks interaction evidence after the handoff.',
        provenance: 'Deterministic browser fixture',
        category: 'verification',
        enforcement: 'test',
      },
    ],
  },
  plan: {
    id: DEMO_PLAN_VERSION_ID,
    narrative:
      'Define the visible preferences contract, then carry it through the authenticated service and verification boundary.',
    agentCountRationale:
      'Two sequential agent instances make the contract handoff inspectable. They do not run in parallel, so ownership stays unambiguous.',
    risks: [
      'The interface and service can drift at the request boundary.',
      'A repair can appear complete without replacing failed evidence.',
      'Reloaded UI can accidentally infer stale execution state.',
    ],
    validationSummary:
      'Each task has one named blocking validator; the repaired attempt supersedes its failed evidence.',
    tasks: [
      {
        key: 'interface',
        title: 'Define the preferences experience',
        category: 'interface',
        purpose:
          'Specify the form states, accessible behavior, and shared request contract.',
        whySeparate:
          'The interaction contract must be reviewable before service implementation consumes it.',
        deliverable: 'A validated interface contract and interaction report.',
        acceptanceCriteria: [
          'Keyboard flow remains complete at mobile and desktop widths.',
          'The request shape is explicit and runtime validated.',
        ],
        fileScopes: ['apps/client/src/**', 'packages/contracts/src/**'],
        skills: ['Accessible interface craft', 'Contract-first UI'],
        dependsOn: [],
        agentProfile: 'Interface systems',
      },
      {
        key: 'service',
        title: 'Implement and verify the service handoff',
        category: 'orchestration',
        purpose:
          'Consume the approved contract through the authenticated local service.',
        whySeparate:
          'Service permissions and validation evidence need an independent boundary.',
        deliverable:
          'An authenticated endpoint, passing evidence, and diff summary.',
        acceptanceCriteria: [
          'Origin and session protections remain active.',
          'A failed check is repaired and replaced by passing evidence.',
        ],
        fileScopes: ['apps/service/src/**', 'packages/persistence/src/**'],
        skills: ['Service contract discipline', 'SQLite event replay'],
        dependsOn: ['interface'],
        agentProfile: 'Backend orchestration',
      },
    ],
  },
  capabilities: [
    {
      id: 'agent-interface-systems',
      name: 'Interface systems',
      kind: 'agent',
      category: 'interface',
      availability: 'active',
      description: 'Owns the visible contract and accessible interaction.',
      source: 'Project fixture',
      trust: 'Repository approved',
      runtime: 'Simulated adapter',
      relatedTo: ['skill-accessible-interface', 'skill-contract-first-ui'],
    },
    {
      id: 'agent-backend-orchestration',
      name: 'Backend orchestration',
      kind: 'agent',
      category: 'orchestration',
      availability: 'active',
      description: 'Owns the authenticated handoff and durable events.',
      source: 'Project fixture',
      trust: 'Repository approved',
      runtime: 'Simulated adapter',
      relatedTo: ['skill-service-contract', 'skill-event-replay'],
    },
    {
      id: 'agent-verification-review',
      name: 'Verification review',
      kind: 'agent',
      category: 'verification',
      availability: 'recommended',
      description: 'Interprets validation evidence and repair outcomes.',
      source: 'Project fixture',
      trust: 'Repository approved',
      runtime: 'Simulated adapter',
      relatedTo: ['skill-accessibility-review'],
    },
    {
      id: 'system-repository-assessment',
      name: 'Repository assessment',
      kind: 'system',
      category: 'neutral',
      availability: 'dormant',
      description: 'Reserved for real repository intake in Increment 3.',
      source: 'Product roadmap',
      trust: 'Not connected',
      runtime: 'Unavailable in this increment',
      relatedTo: [],
    },
    {
      id: 'skill-accessible-interface',
      name: 'Accessible interface craft',
      kind: 'skill',
      category: 'interface',
      availability: 'active',
      description: 'Keyboard, responsive, and reduced-motion implementation.',
      source: 'Pinned context fixture',
      trust: 'Project fixture',
      runtime: 'Adapter-neutral prompt guidance',
      relatedTo: ['agent-interface-systems', 'skill-accessibility-review'],
    },
    {
      id: 'skill-contract-first-ui',
      name: 'Contract-first UI',
      kind: 'skill',
      category: 'interface',
      availability: 'active',
      description: 'Defines a reviewable request boundary before consumption.',
      source: 'Pinned plan fixture',
      trust: 'Project fixture',
      runtime: 'Adapter-neutral prompt guidance',
      relatedTo: ['agent-interface-systems', 'skill-service-contract'],
    },
    {
      id: 'skill-service-contract',
      name: 'Service contract discipline',
      kind: 'skill',
      category: 'orchestration',
      availability: 'active',
      description: 'Keeps commands authenticated and runtime validated.',
      source: 'Pinned context fixture',
      trust: 'Project fixture',
      runtime: 'Schema enforced',
      relatedTo: ['agent-backend-orchestration', 'skill-contract-first-ui'],
    },
    {
      id: 'skill-event-replay',
      name: 'SQLite event replay',
      kind: 'skill',
      category: 'orchestration',
      availability: 'dormant',
      description: 'Reconstructs run state from the append-only local ledger.',
      source: 'Pinned plan fixture',
      trust: 'Project fixture',
      runtime: 'Deterministic local service',
      relatedTo: ['agent-backend-orchestration'],
    },
    {
      id: 'skill-accessibility-review',
      name: 'Accessibility review',
      kind: 'skill',
      category: 'verification',
      availability: 'recommended',
      description: 'Checks keyboard flow, focus, contrast, and reduced motion.',
      source: 'Curated fixture catalog',
      trust: 'Recommended · not active',
      runtime: 'Compatible with simulated adapter',
      relatedTo: ['agent-verification-review', 'skill-accessible-interface'],
    },
    {
      id: 'system-live-provider',
      name: 'Live coding runtime',
      kind: 'system',
      category: 'neutral',
      availability: 'unavailable',
      description: 'A provider adapter is intentionally not connected yet.',
      source: 'Increment 6 boundary',
      trust: 'Unavailable',
      runtime: 'No live provider selected',
      relatedTo: [],
    },
  ],
});

export class DemoCommandError extends Error {
  constructor(
    readonly code: 'not_found' | 'stale' | 'invalid_command',
    message: string,
  ) {
    super(message);
    this.name = 'DemoCommandError';
  }
}

function safe(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100);
}

class EventBatch {
  private projection: RunProjection | undefined;
  private readonly pending: DomainEvent[] = [];

  constructor(
    private readonly store: SqliteEventStore,
    private readonly runId: ReturnType<typeof RunIdSchema.parse>,
    current?: RunProjection,
  ) {
    this.projection = current;
  }

  emit(
    type: DomainEvent['type'],
    payload: unknown,
    options: {
      taskId?: ReturnType<typeof TaskIdSchema.parse>;
      agentInstanceId?: ReturnType<typeof AgentInstanceIdSchema.parse>;
      source?: EventSource;
    } = {},
  ): RunProjection {
    const sequence = (this.projection?.lastSequence ?? 0) + 1;
    const occurredAt = new Date(BASE_TIME + sequence * 1_000).toISOString();
    const event = DomainEventSchema.parse({
      id: EventIdSchema.parse(
        `event_${safe(this.runId)}_demo_${String(sequence).padStart(3, '0')}`,
      ),
      type,
      version: 1,
      sequence,
      occurredAt,
      recordedAt: occurredAt,
      projectId: PROJECT_ID,
      runId: this.runId,
      ...(options.taskId ? { taskId: options.taskId } : {}),
      ...(options.agentInstanceId
        ? { agentInstanceId: options.agentInstanceId }
        : {}),
      correlationId: CorrelationIdSchema.parse(
        `correlation_${safe(this.runId)}`,
      ),
      ...(this.projection ? { causationId: this.projection.lastEventId } : {}),
      source: options.source ?? 'orchestrator',
      payload,
    });
    this.projection = reduceDomainEvent(this.projection, event);
    this.pending.push(event);
    return this.projection;
  }

  changeTask(
    taskId: ReturnType<typeof TaskIdSchema.parse>,
    to: string,
    reason: string,
  ) {
    const task = this.requireProjection().tasks[taskId];
    if (!task) throw new Error(`Task ${taskId} is missing.`);
    this.emit(
      'task.state_changed',
      { from: task.state, to, reason },
      { taskId },
    );
  }

  changeAgent(
    agentInstanceId: ReturnType<typeof AgentInstanceIdSchema.parse>,
    taskId: ReturnType<typeof TaskIdSchema.parse>,
    to: string,
    reason: string,
  ) {
    const agent = this.requireProjection().agents[agentInstanceId];
    if (!agent) throw new Error(`Agent ${agentInstanceId} is missing.`);
    this.emit(
      'agent.state_changed',
      { from: agent.state, to, reason },
      { taskId, agentInstanceId },
    );
  }

  changeRun(to: string, reason: string) {
    const projection = this.requireProjection();
    this.emit('run.state_changed', {
      from: projection.run.state,
      to,
      reason,
    });
  }

  requireProjection(): RunProjection {
    if (!this.projection)
      throw new Error('Run projection has not been created.');
    return this.projection;
  }

  commit(): RunProjection {
    if (this.pending.length === 0) return this.requireProjection();
    return this.store.appendMany(this.pending);
  }
}

function idsFor(runId: ReturnType<typeof RunIdSchema.parse>) {
  const suffix = safe(runId.replace(/^run_/, ''));
  return {
    interfaceTaskId: TaskIdSchema.parse(`task_${suffix}_interface`),
    serviceTaskId: TaskIdSchema.parse(`task_${suffix}_service`),
    interfaceAgentId: AgentInstanceIdSchema.parse(`agent_${suffix}_interface`),
    serviceAgentId: AgentInstanceIdSchema.parse(`agent_${suffix}_service`),
    dependencyId: DependencyIdSchema.parse(`dependency_${suffix}_handoff`),
  };
}

function demoProjection(
  store: SqliteEventStore,
  runId: ReturnType<typeof RunIdSchema.parse>,
) {
  const projection = store.getProjection(runId);
  if (!projection || projection.run.projectId !== PROJECT_ID) {
    throw new DemoCommandError('not_found', 'The simulated run was not found.');
  }
  return projection;
}

function assertSequence(projection: RunProjection, expectedSequence: number) {
  if (projection.lastSequence !== expectedSequence) {
    throw new DemoCommandError(
      'stale',
      `The run advanced to sequence ${projection.lastSequence}; refresh before retrying.`,
    );
  }
}

export function phaseFor(projection: RunProjection): DemoRunSnapshot['phase'] {
  if (projection.run.state === 'completed') return 'completed';
  if (projection.run.state === 'failed') return 'failed';
  if (projection.run.state === 'cancelled') return 'cancelled';
  if (
    Object.values(projection.approvals).some(
      (approval) => approval.state === 'requested',
    )
  ) {
    return 'approval_required';
  }
  const { interfaceTaskId, serviceTaskId } = idsFor(projection.runId);
  const interfaceTask = projection.tasks[interfaceTaskId];
  const serviceTask = projection.tasks[serviceTaskId];
  if (serviceTask?.state === 'repair_pending') return 'repair_required';
  if (serviceTask?.state === 'running') {
    const approval = Object.values(projection.approvals)[0];
    return approval?.state === 'approved'
      ? 'approval_granted'
      : 'handoff_ready';
  }
  if (interfaceTask?.state === 'running') return 'interface_active';
  throw new DemoCommandError(
    'invalid_command',
    'The simulated run is in an unsupported fixture state.',
  );
}

export function snapshotFor(
  store: SqliteEventStore,
  runIdInput: ReturnType<typeof RunIdSchema.parse>,
): DemoRunSnapshot {
  const projection = demoProjection(store, runIdInput);
  const phase = phaseFor(projection);
  const controls: Record<
    DemoRunSnapshot['phase'],
    DemoRunSnapshot['availableCommands']
  > = {
    interface_active: ['advance', 'cancel'],
    handoff_ready: ['advance', 'cancel'],
    approval_required: ['approve', 'deny', 'cancel'],
    approval_granted: ['advance', 'cancel'],
    repair_required: ['advance', 'cancel'],
    completed: [],
    failed: [],
    cancelled: [],
  };
  const labels: Record<DemoRunSnapshot['phase'], string> = {
    interface_active: 'Complete interface contract',
    handoff_ready: 'Continue to approval gate',
    approval_required: 'Review the requested capability',
    approval_granted: 'Run service validation',
    repair_required: 'Apply bounded repair',
    completed: 'Review completion evidence',
    failed: 'Review the denied run',
    cancelled: 'Run cancelled',
  };
  return {
    projection,
    events: store.listEvents(projection.runId),
    phase,
    availableCommands: controls[phase],
    nextStepLabel: labels[phase],
  };
}

export function latestDemoSnapshot(
  store: SqliteEventStore,
): DemoRunSnapshot | undefined {
  const projection = store
    .listProjections()
    .find((candidate) => candidate.run.projectId === PROJECT_ID);
  return projection ? snapshotFor(store, projection.runId) : undefined;
}

export function createDemoRun(
  store: SqliteEventStore,
  runId: ReturnType<typeof RunIdSchema.parse>,
): DemoRunSnapshot {
  const ids = idsFor(runId);
  const [interfacePlanTask, servicePlanTask] = workspaceFixture.plan.tasks;
  if (!interfacePlanTask || !servicePlanTask) {
    throw new Error('The demo plan requires exactly two tasks.');
  }
  const batch = new EventBatch(store, runId);
  const createdAt = new Date(BASE_TIME).toISOString();
  const capabilities = {
    interrupt: true,
    approvals: true,
    reconciliation: true,
    steering: false,
    usageReporting: false,
    fileChangeEvents: false,
    stableEventIds: true,
  };
  batch.emit('run.created', {
    run: RunSchema.parse({
      id: runId,
      projectId: PROJECT_ID,
      planVersionId: DEMO_PLAN_VERSION_ID,
      goal: 'Ship the authenticated account preferences loop.',
      state: 'draft',
      createdAt,
    }),
  });

  const interfaceTask = TaskSchema.parse({
    id: ids.interfaceTaskId,
    runId,
    planVersionId: DEMO_PLAN_VERSION_ID,
    title: interfacePlanTask.title,
    purpose: interfacePlanTask.purpose,
    whySeparate: interfacePlanTask.whySeparate,
    deliverable: interfacePlanTask.deliverable,
    acceptanceCriteria: interfacePlanTask.acceptanceCriteria,
    dependsOn: [],
    allowedFileScopes: interfacePlanTask.fileScopes,
    skillVersionIds: ['skill_accessible-interface_v1'],
    validationRequirements: ['contract-check'],
    state: 'proposed',
  });
  const serviceTask = TaskSchema.parse({
    id: ids.serviceTaskId,
    runId,
    planVersionId: DEMO_PLAN_VERSION_ID,
    title: servicePlanTask.title,
    purpose: servicePlanTask.purpose,
    whySeparate: servicePlanTask.whySeparate,
    deliverable: servicePlanTask.deliverable,
    acceptanceCriteria: servicePlanTask.acceptanceCriteria,
    dependsOn: [ids.interfaceTaskId],
    allowedFileScopes: servicePlanTask.fileScopes,
    skillVersionIds: ['skill_service-contract_v1'],
    validationRequirements: ['experience-check'],
    state: 'proposed',
  });
  batch.emit(
    'task.created',
    { task: interfaceTask },
    { taskId: interfaceTask.id },
  );
  batch.emit('task.created', { task: serviceTask }, { taskId: serviceTask.id });
  batch.emit('dependency.created', {
    dependency: DependencySchema.parse({
      id: ids.dependencyId,
      runId,
      upstreamTaskId: ids.interfaceTaskId,
      downstreamTaskId: ids.serviceTaskId,
      type: 'artifact',
      reason: 'The service consumes the approved preferences contract.',
      requiredCondition: 'The interface contract passes contract-check.',
      state: 'unsatisfied',
    }),
  });
  for (const [agentId, taskId] of [
    [ids.interfaceAgentId, ids.interfaceTaskId],
    [ids.serviceAgentId, ids.serviceTaskId],
  ] as const) {
    batch.emit(
      'agent.instance_created',
      {
        agentInstance: AgentInstanceSchema.parse({
          id: agentId,
          runId,
          taskId,
          attempt: 1,
          runtime: {
            adapterId: 'simulated',
            adapterVersion: '2.0.0',
            protocolVersion: 1,
          },
          capabilitySnapshot: capabilities,
          state: 'created',
          createdAt,
        }),
      },
      { taskId, agentInstanceId: agentId },
    );
  }
  batch.changeTask(ids.interfaceTaskId, 'approved', 'Plan version approved.');
  batch.changeTask(ids.serviceTaskId, 'approved', 'Plan version approved.');
  batch.changeTask(
    ids.serviceTaskId,
    'waiting',
    'Waiting for the interface contract.',
  );
  batch.changeRun('planned', 'The two-task plan was approved.');
  batch.changeRun('preparing', 'Preparing the simulated runtime.');
  batch.changeTask(
    ids.interfaceTaskId,
    'ready',
    'No dependencies block interface work.',
  );
  batch.changeAgent(
    ids.interfaceAgentId,
    ids.interfaceTaskId,
    'starting',
    'Starting interface agent.',
  );
  batch.changeRun('executing', 'The first task is active.');
  batch.changeAgent(
    ids.interfaceAgentId,
    ids.interfaceTaskId,
    'active',
    'Defining form states and contract.',
  );
  batch.changeTask(
    ids.interfaceTaskId,
    'running',
    'Defining form states and contract.',
  );
  batch.commit();
  return snapshotFor(store, runId);
}

function completeInterfaceTask(
  batch: EventBatch,
  runId: ReturnType<typeof RunIdSchema.parse>,
) {
  const ids = idsFor(runId);
  batch.changeTask(
    ids.interfaceTaskId,
    'validating',
    'Checking the interface contract.',
  );
  const validationId = ValidationIdSchema.parse(
    `validation_${safe(runId)}_contract`,
  );
  batch.emit(
    'validation.started',
    {
      validation: ValidationResultSchema.parse({
        id: validationId,
        runId,
        taskId: ids.interfaceTaskId,
        validatorType: 'contract-check',
        command: 'npm test -- contract',
        startedAt: new Date(BASE_TIME + 20_000).toISOString(),
        status: 'running',
        blocksCompletion: true,
      }),
    },
    { taskId: ids.interfaceTaskId, source: 'validator' },
  );
  batch.emit(
    'validation.completed',
    {
      validationId,
      from: 'running',
      to: 'passed',
      finishedAt: new Date(BASE_TIME + 21_000).toISOString(),
      exitCode: 0,
      outputSummary: 'Shared request contract and keyboard states agree.',
    },
    { taskId: ids.interfaceTaskId, source: 'validator' },
  );
  batch.emit(
    'artifact.produced',
    {
      artifact: ArtifactSchema.parse({
        id: ArtifactIdSchema.parse(`artifact_${safe(runId)}_contract`),
        runId,
        taskId: ids.interfaceTaskId,
        agentInstanceId: ids.interfaceAgentId,
        type: 'contract',
        digest: 'sha256:preferences-contract-v1',
        location: 'fixture://contracts/preferences-request',
        createdAt: new Date(BASE_TIME + 22_000).toISOString(),
        validationStatus: 'valid',
      }),
    },
    { taskId: ids.interfaceTaskId, agentInstanceId: ids.interfaceAgentId },
  );
  batch.changeTask(
    ids.interfaceTaskId,
    'completed',
    'Interface contract passed validation.',
  );
  batch.changeAgent(
    ids.interfaceAgentId,
    ids.interfaceTaskId,
    'completed',
    'Interface contract handed off.',
  );
  batch.emit('dependency.state_changed', {
    dependencyId: ids.dependencyId,
    from: 'unsatisfied',
    to: 'satisfied',
    reason: 'Validated contract artifact is available.',
  });
  batch.changeTask(
    ids.serviceTaskId,
    'ready',
    'Validated interface contract received.',
  );
  batch.changeAgent(
    ids.serviceAgentId,
    ids.serviceTaskId,
    'starting',
    'Starting service agent.',
  );
  batch.changeAgent(
    ids.serviceAgentId,
    ids.serviceTaskId,
    'active',
    'Implementing the authenticated handoff.',
  );
  batch.changeTask(
    ids.serviceTaskId,
    'running',
    'Implementing the authenticated handoff.',
  );
}

function requestFixtureApproval(
  batch: EventBatch,
  runId: ReturnType<typeof RunIdSchema.parse>,
) {
  const ids = idsFor(runId);
  const approval = ApprovalSchema.parse({
    id: ApprovalIdSchema.parse(`approval_${safe(runId)}_fixture-write`),
    runId,
    taskId: ids.serviceTaskId,
    agentInstanceId: ids.serviceAgentId,
    requestedAction: 'Write the simulated service fixture',
    reason:
      'The service task needs one bounded write to its declared fixture scope.',
    scope: 'apps/service/src/fixtures/**',
    consequences:
      'Creates one simulated endpoint fixture; no real files change.',
    state: 'requested',
    requestedAt: new Date(BASE_TIME + 30_000).toISOString(),
  });
  batch.emit(
    'approval.requested',
    { approval },
    {
      taskId: ids.serviceTaskId,
      agentInstanceId: ids.serviceAgentId,
      source: 'runtime',
    },
  );
  batch.changeAgent(
    ids.serviceAgentId,
    ids.serviceTaskId,
    'awaiting_approval',
    approval.reason,
  );
  batch.changeTask(ids.serviceTaskId, 'awaiting_input', approval.reason);
}

function failServiceValidation(
  batch: EventBatch,
  runId: ReturnType<typeof RunIdSchema.parse>,
) {
  const ids = idsFor(runId);
  batch.changeTask(
    ids.serviceTaskId,
    'validating',
    'Checking responsive service behavior.',
  );
  const validationId = ValidationIdSchema.parse(
    `validation_${safe(runId)}_experience_1`,
  );
  batch.emit(
    'validation.started',
    {
      validation: ValidationResultSchema.parse({
        id: validationId,
        runId,
        taskId: ids.serviceTaskId,
        validatorType: 'experience-check',
        command: 'npm test -- experience',
        startedAt: new Date(BASE_TIME + 40_000).toISOString(),
        status: 'running',
        blocksCompletion: true,
      }),
    },
    { taskId: ids.serviceTaskId, source: 'validator' },
  );
  batch.emit(
    'validation.completed',
    {
      validationId,
      from: 'running',
      to: 'failed',
      finishedAt: new Date(BASE_TIME + 41_000).toISOString(),
      exitCode: 1,
      outputSummary:
        'Mobile error summary did not receive focus after submission.',
    },
    { taskId: ids.serviceTaskId, source: 'validator' },
  );
  batch.changeTask(
    ids.serviceTaskId,
    'repair_pending',
    'A bounded accessibility repair is required.',
  );
}

function repairAndComplete(
  batch: EventBatch,
  runId: ReturnType<typeof RunIdSchema.parse>,
) {
  const ids = idsFor(runId);
  const firstValidationId = ValidationIdSchema.parse(
    `validation_${safe(runId)}_experience_1`,
  );
  const retryId = ValidationIdSchema.parse(
    `validation_${safe(runId)}_experience_2`,
  );
  batch.changeTask(ids.serviceTaskId, 'ready', 'Repair scope accepted.');
  batch.changeTask(
    ids.serviceTaskId,
    'running',
    'Moving focus to the mobile error summary.',
  );
  batch.changeTask(
    ids.serviceTaskId,
    'validating',
    'Re-running responsive interaction evidence.',
  );
  batch.emit(
    'validation.started',
    {
      validation: ValidationResultSchema.parse({
        id: retryId,
        runId,
        taskId: ids.serviceTaskId,
        validatorType: 'experience-check',
        command: 'npm test -- experience',
        startedAt: new Date(BASE_TIME + 50_000).toISOString(),
        status: 'running',
        blocksCompletion: true,
        retryOf: firstValidationId,
      }),
    },
    { taskId: ids.serviceTaskId, source: 'validator' },
  );
  batch.emit(
    'validation.completed',
    {
      validationId: retryId,
      from: 'running',
      to: 'passed',
      finishedAt: new Date(BASE_TIME + 51_000).toISOString(),
      exitCode: 0,
      outputSummary:
        'Keyboard, mobile focus, and authenticated request checks passed.',
    },
    { taskId: ids.serviceTaskId, source: 'validator' },
  );
  batch.emit(
    'artifact.produced',
    {
      artifact: ArtifactSchema.parse({
        id: ArtifactIdSchema.parse(`artifact_${safe(runId)}_diff`),
        runId,
        taskId: ids.serviceTaskId,
        agentInstanceId: ids.serviceAgentId,
        type: 'diff',
        digest: 'sha256:preferences-loop-final',
        location: 'fixture://diff/account-preferences',
        createdAt: new Date(BASE_TIME + 52_000).toISOString(),
        validationStatus: 'valid',
      }),
    },
    { taskId: ids.serviceTaskId, agentInstanceId: ids.serviceAgentId },
  );
  batch.changeTask(
    ids.serviceTaskId,
    'completed',
    'The repaired service handoff passed validation.',
  );
  batch.changeAgent(
    ids.serviceAgentId,
    ids.serviceTaskId,
    'completed',
    'Service work completed with evidence.',
  );
  batch.changeRun('verifying', 'All task evidence is ready for review.');
  batch.changeRun('completed', 'The simulated preferences loop completed.');
}

export function advanceDemoRun(
  store: SqliteEventStore,
  runId: ReturnType<typeof RunIdSchema.parse>,
  expectedSequence: number,
): DemoRunSnapshot {
  const projection = demoProjection(store, runId);
  assertSequence(projection, expectedSequence);
  const phase = phaseFor(projection);
  const batch = new EventBatch(store, runId, projection);
  if (phase === 'interface_active') completeInterfaceTask(batch, runId);
  else if (phase === 'handoff_ready') requestFixtureApproval(batch, runId);
  else if (phase === 'approval_granted') failServiceValidation(batch, runId);
  else if (phase === 'repair_required') repairAndComplete(batch, runId);
  else {
    throw new DemoCommandError(
      'invalid_command',
      'The run cannot advance until its current decision is resolved.',
    );
  }
  batch.commit();
  return snapshotFor(store, runId);
}

export function decideDemoApproval(
  store: SqliteEventStore,
  runId: ReturnType<typeof RunIdSchema.parse>,
  approvalIdInput: ReturnType<typeof ApprovalIdSchema.parse>,
  decision: 'approved' | 'denied',
  expectedSequence: number,
): DemoRunSnapshot {
  const projection = demoProjection(store, runId);
  assertSequence(projection, expectedSequence);
  const approval = projection.approvals[approvalIdInput];
  if (!approval || approval.state !== 'requested') {
    throw new DemoCommandError(
      'invalid_command',
      'The approval is no longer pending.',
    );
  }
  const ids = idsFor(runId);
  const batch = new EventBatch(store, runId, projection);
  batch.emit(
    'approval.decided',
    {
      approvalId: approval.id,
      from: 'requested',
      to: decision,
      decidedAt: new Date(BASE_TIME + 35_000).toISOString(),
      note:
        decision === 'approved'
          ? 'Approved in the run inspector.'
          : 'Denied in the run inspector.',
    },
    {
      taskId: ids.serviceTaskId,
      agentInstanceId: ids.serviceAgentId,
      source: 'user',
    },
  );
  if (decision === 'approved') {
    batch.changeAgent(
      ids.serviceAgentId,
      ids.serviceTaskId,
      'active',
      'Bounded fixture write approved.',
    );
    batch.changeTask(
      ids.serviceTaskId,
      'running',
      'Bounded fixture write approved.',
    );
  } else {
    batch.changeAgent(
      ids.serviceAgentId,
      ids.serviceTaskId,
      'failed',
      'Fixture write denied.',
    );
    batch.changeTask(ids.serviceTaskId, 'failed', 'Fixture write denied.');
    batch.changeRun('failed', 'The required fixture permission was denied.');
  }
  batch.commit();
  return snapshotFor(store, runId);
}

export function cancelDemoRun(
  store: SqliteEventStore,
  runId: ReturnType<typeof RunIdSchema.parse>,
  expectedSequence: number,
): DemoRunSnapshot {
  const projection = demoProjection(store, runId);
  assertSequence(projection, expectedSequence);
  if (['completed', 'failed', 'cancelled'].includes(projection.run.state)) {
    throw new DemoCommandError(
      'invalid_command',
      'The run is already terminal.',
    );
  }
  const batch = new EventBatch(store, runId, projection);
  for (const approval of Object.values(projection.approvals)) {
    if (approval.state === 'requested') {
      batch.emit(
        'approval.decided',
        {
          approvalId: approval.id,
          from: 'requested',
          to: 'cancelled',
          decidedAt: new Date(BASE_TIME + 60_000).toISOString(),
          note: 'Cancelled with the run.',
        },
        {
          ...(approval.taskId ? { taskId: approval.taskId } : {}),
          ...(approval.agentInstanceId
            ? { agentInstanceId: approval.agentInstanceId }
            : {}),
          source: 'user',
        },
      );
    }
  }
  for (const task of Object.values(batch.requireProjection().tasks)) {
    if (!['completed', 'failed', 'cancelled'].includes(task.state)) {
      batch.changeTask(
        task.id,
        'cancelled',
        'The user cancelled the simulated run.',
      );
    }
  }
  for (const agent of Object.values(batch.requireProjection().agents)) {
    if (!['completed', 'failed', 'cancelled'].includes(agent.state)) {
      batch.changeAgent(
        agent.id,
        agent.taskId,
        'cancelled',
        'The user cancelled the simulated run.',
      );
    }
  }
  batch.changeRun('cancelled', 'The user cancelled the simulated run.');
  batch.commit();
  return snapshotFor(store, runId);
}
