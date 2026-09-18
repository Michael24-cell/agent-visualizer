import {
  AgentInstanceIdSchema,
  AgentInstanceSchema,
  ApprovalIdSchema,
  ApprovalSchema,
  ArtifactIdSchema,
  ArtifactSchema,
  CorrelationIdSchema,
  DomainEventSchema,
  EventIdSchema,
  PlanVersionIdSchema,
  NormalizedRuntimeEventSchema,
  RunIdSchema,
  RunSchema,
  RuntimeCapabilitiesSchema,
  RuntimeConfigurationResultSchema,
  TaskIdSchema,
  TaskSchema,
  ValidationIdSchema,
  ValidationResultSchema,
  type AgentInstanceState,
  type DomainEvent,
  type EventSource,
  type RunState,
  type RuntimeAdapter,
  type TaskState,
} from '@harness/contracts';
import type { DomainEventSink, RunProjection } from './projections.js';

export interface ExecuteRuntimeRunInput {
  readonly runId: ReturnType<typeof RunIdSchema.parse>;
  readonly planVersionId: ReturnType<typeof PlanVersionIdSchema.parse>;
  readonly taskId: ReturnType<typeof TaskIdSchema.parse>;
  readonly agentInstanceId: ReturnType<typeof AgentInstanceIdSchema.parse>;
  readonly goal: string;
  readonly taskTitle: string;
  readonly runtimeConfiguration: unknown;
}

function safeSuffix(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100);
}

export async function executeRuntimeRun(
  adapter: RuntimeAdapter,
  sink: DomainEventSink,
  input: ExecuteRuntimeRunInput,
): Promise<RunProjection> {
  const configuration = RuntimeConfigurationResultSchema.parse(
    await adapter.validateConfiguration(input.runtimeConfiguration),
  );
  if (!configuration.valid) {
    throw new Error(
      `Invalid runtime configuration: ${configuration.errors.join('; ')}`,
    );
  }

  const capabilities = RuntimeCapabilitiesSchema.parse(
    await adapter.getCapabilities(),
  );
  const correlationId = CorrelationIdSchema.parse(
    `correlation_${safeSuffix(input.runId)}`,
  );
  let sequence = 0;
  let previousEventId: ReturnType<typeof EventIdSchema.parse> | undefined;

  const emit = (
    type: DomainEvent['type'],
    payload: unknown,
    occurredAt: string,
    options: {
      readonly source?: EventSource;
      readonly taskId?: ReturnType<typeof TaskIdSchema.parse>;
      readonly agentInstanceId?: ReturnType<typeof AgentInstanceIdSchema.parse>;
      readonly providerMetadata?: Record<string, unknown>;
    } = {},
  ): RunProjection => {
    sequence += 1;
    const id = EventIdSchema.parse(
      `event_${safeSuffix(input.runId)}_${String(sequence).padStart(4, '0')}`,
    );
    const event = DomainEventSchema.parse({
      id,
      type,
      version: 1,
      sequence,
      occurredAt,
      recordedAt: occurredAt,
      runId: input.runId,
      correlationId,
      ...(previousEventId ? { causationId: previousEventId } : {}),
      source: options.source ?? 'orchestrator',
      ...(options.taskId ? { taskId: options.taskId } : {}),
      ...(options.agentInstanceId
        ? { agentInstanceId: options.agentInstanceId }
        : {}),
      ...(options.providerMetadata
        ? { providerMetadata: options.providerMetadata }
        : {}),
      payload,
    });
    previousEventId = id;
    return sink.append(event);
  };

  const initialTime = new Date('2026-01-01T00:00:00.000Z').toISOString();
  const run = RunSchema.parse({
    id: input.runId,
    planVersionId: input.planVersionId,
    goal: input.goal,
    state: 'draft',
    createdAt: initialTime,
  });
  const task = TaskSchema.parse({
    id: input.taskId,
    runId: input.runId,
    planVersionId: input.planVersionId,
    title: input.taskTitle,
    purpose: 'Execute the deterministic runtime scenario.',
    whySeparate: 'The fixture isolates one durable unit of simulated work.',
    deliverable: 'A replayable terminal run projection.',
    acceptanceCriteria: ['The scenario reaches its expected terminal state.'],
    dependsOn: [],
    allowedFileScopes: [],
    skillVersionIds: [],
    validationRequirements: ['simulated-check'],
    state: 'proposed',
  });
  const agent = AgentInstanceSchema.parse({
    id: input.agentInstanceId,
    runId: input.runId,
    taskId: input.taskId,
    attempt: 1,
    runtime: {
      adapterId: adapter.id,
      adapterVersion: adapter.version,
      protocolVersion: adapter.protocolVersion,
    },
    capabilitySnapshot: capabilities,
    state: 'created',
    createdAt: initialTime,
  });

  let projection = emit('run.created', { run }, initialTime);
  projection = emit('task.created', { task }, initialTime, {
    taskId: input.taskId,
  });
  projection = emit(
    'agent.instance_created',
    { agentInstance: agent },
    initialTime,
    { taskId: input.taskId, agentInstanceId: input.agentInstanceId },
  );

  const changeRun = (to: RunState, reason: string, at: string) => {
    projection = emit(
      'run.state_changed',
      { from: projection.run.state, to, reason },
      at,
    );
  };
  const changeTask = (to: TaskState, reason: string, at: string) => {
    const currentTask = projection.tasks[input.taskId];
    if (!currentTask) throw new Error('Task projection is missing.');
    projection = emit(
      'task.state_changed',
      { from: currentTask.state, to, reason },
      at,
      { taskId: input.taskId },
    );
  };
  const changeAgent = (to: AgentInstanceState, reason: string, at: string) => {
    const currentAgent = projection.agents[input.agentInstanceId];
    if (!currentAgent) throw new Error('Agent projection is missing.');
    projection = emit(
      'agent.state_changed',
      { from: currentAgent.state, to, reason },
      at,
      { taskId: input.taskId, agentInstanceId: input.agentInstanceId },
    );
  };

  changeTask('approved', 'Fixture task approved.', initialTime);
  changeRun('planned', 'Fixture plan established.', initialTime);
  changeRun('preparing', 'Preparing simulated execution.', initialTime);
  changeTask('ready', 'No dependencies block the fixture.', initialTime);
  changeAgent('starting', 'Starting simulated adapter.', initialTime);
  changeRun('executing', 'Simulated runtime launched.', initialTime);

  const runtimeInput = {
    runId: input.runId,
    taskId: input.taskId,
    agentInstanceId: input.agentInstanceId,
    configuration: input.runtimeConfiguration,
  };

  let previousRuntimeOrdinal = 0;
  const runtimeEventIds = new Set<string>();
  for await (const runtimeInputEvent of adapter.startTask(runtimeInput)) {
    const runtimeEvent = NormalizedRuntimeEventSchema.parse(runtimeInputEvent);
    if (
      runtimeEvent.runId !== input.runId ||
      runtimeEvent.taskId !== input.taskId ||
      runtimeEvent.agentInstanceId !== input.agentInstanceId
    ) {
      throw new Error(
        `Runtime event ${runtimeEvent.id} does not belong to the active task.`,
      );
    }
    if (runtimeEvent.ordinal !== previousRuntimeOrdinal + 1) {
      throw new Error(
        `Runtime event ${runtimeEvent.id} has ordinal ${runtimeEvent.ordinal}; expected ${previousRuntimeOrdinal + 1}.`,
      );
    }
    if (runtimeEventIds.has(runtimeEvent.id)) {
      throw new Error(`Runtime event ID ${runtimeEvent.id} was emitted twice.`);
    }
    previousRuntimeOrdinal = runtimeEvent.ordinal;
    runtimeEventIds.add(runtimeEvent.id);
    const metadata = {
      adapterId: adapter.id,
      runtimeEventId: runtimeEvent.id,
      ...(runtimeEvent.providerMetadata ?? {}),
    };
    const eventOptions = {
      source: 'runtime' as const,
      taskId: input.taskId,
      agentInstanceId: input.agentInstanceId,
      providerMetadata: metadata,
    };

    switch (runtimeEvent.type) {
      case 'task.started':
        changeAgent(
          'active',
          runtimeEvent.payload.activity,
          runtimeEvent.occurredAt,
        );
        changeTask(
          'running',
          runtimeEvent.payload.activity,
          runtimeEvent.occurredAt,
        );
        break;
      case 'artifact.produced': {
        const artifact = ArtifactSchema.parse({
          id: ArtifactIdSchema.parse(`artifact_${safeSuffix(runtimeEvent.id)}`),
          runId: input.runId,
          taskId: input.taskId,
          agentInstanceId: input.agentInstanceId,
          type: runtimeEvent.payload.artifactType,
          digest: runtimeEvent.payload.digest,
          ...(runtimeEvent.payload.location
            ? { location: runtimeEvent.payload.location }
            : {}),
          createdAt: runtimeEvent.occurredAt,
          validationStatus: 'unvalidated',
        });
        projection = emit(
          'artifact.produced',
          { artifact },
          runtimeEvent.occurredAt,
          eventOptions,
        );
        break;
      }
      case 'approval.requested': {
        const approval = ApprovalSchema.parse({
          id: ApprovalIdSchema.parse(`approval_${safeSuffix(runtimeEvent.id)}`),
          runId: input.runId,
          taskId: input.taskId,
          agentInstanceId: input.agentInstanceId,
          ...runtimeEvent.payload,
          state: 'requested',
          requestedAt: runtimeEvent.occurredAt,
        });
        projection = emit(
          'approval.requested',
          { approval },
          runtimeEvent.occurredAt,
          eventOptions,
        );
        changeAgent(
          'awaiting_approval',
          runtimeEvent.payload.reason,
          runtimeEvent.occurredAt,
        );
        changeTask(
          'awaiting_input',
          runtimeEvent.payload.reason,
          runtimeEvent.occurredAt,
        );
        break;
      }
      case 'approval.decided': {
        const pendingApproval = Object.values(projection.approvals).find(
          (approval) => approval.state === 'requested',
        );
        if (!pendingApproval) throw new Error('No pending approval exists.');
        projection = emit(
          'approval.decided',
          {
            approvalId: pendingApproval.id,
            from: 'requested',
            to: runtimeEvent.payload.decision,
            decidedAt: runtimeEvent.occurredAt,
            ...(runtimeEvent.payload.note
              ? { note: runtimeEvent.payload.note }
              : {}),
          },
          runtimeEvent.occurredAt,
          eventOptions,
        );
        if (runtimeEvent.payload.decision === 'approved') {
          changeAgent('active', 'Approval granted.', runtimeEvent.occurredAt);
          changeTask('running', 'Approval granted.', runtimeEvent.occurredAt);
        } else {
          changeAgent('failed', 'Approval denied.', runtimeEvent.occurredAt);
          changeTask('failed', 'Approval denied.', runtimeEvent.occurredAt);
          changeRun('failed', 'Approval denied.', runtimeEvent.occurredAt);
        }
        break;
      }
      case 'validation.started': {
        changeTask(
          'validating',
          `Running ${runtimeEvent.payload.validatorType}.`,
          runtimeEvent.occurredAt,
        );
        const validation = ValidationResultSchema.parse({
          id: ValidationIdSchema.parse(
            `validation_${safeSuffix(runtimeEvent.id)}`,
          ),
          runId: input.runId,
          taskId: input.taskId,
          validatorType: runtimeEvent.payload.validatorType,
          ...(runtimeEvent.payload.command
            ? { command: runtimeEvent.payload.command }
            : {}),
          startedAt: runtimeEvent.occurredAt,
          status: 'running',
          blocksCompletion: runtimeEvent.payload.blocksCompletion,
        });
        projection = emit(
          'validation.started',
          { validation },
          runtimeEvent.occurredAt,
          eventOptions,
        );
        break;
      }
      case 'validation.finished': {
        const runningValidation = Object.values(projection.validations).find(
          (validation) => validation.status === 'running',
        );
        if (!runningValidation)
          throw new Error('No running validation exists.');
        projection = emit(
          'validation.completed',
          {
            validationId: runningValidation.id,
            from: 'running',
            to: runtimeEvent.payload.status,
            finishedAt: runtimeEvent.occurredAt,
            outputSummary: runtimeEvent.payload.outputSummary,
            ...(runtimeEvent.payload.exitCode === undefined
              ? {}
              : { exitCode: runtimeEvent.payload.exitCode }),
          },
          runtimeEvent.occurredAt,
          { ...eventOptions, source: 'validator' },
        );
        if (runtimeEvent.payload.status === 'passed') {
          changeRun(
            'verifying',
            'Validation evidence received.',
            runtimeEvent.occurredAt,
          );
        } else {
          changeTask(
            'failed',
            'Blocking validation failed.',
            runtimeEvent.occurredAt,
          );
          changeAgent(
            'failed',
            'Blocking validation failed.',
            runtimeEvent.occurredAt,
          );
          changeRun(
            'failed',
            'Blocking validation failed.',
            runtimeEvent.occurredAt,
          );
        }
        break;
      }
      case 'task.completed':
        changeAgent(
          'completed',
          runtimeEvent.payload.summary,
          runtimeEvent.occurredAt,
        );
        changeTask(
          'completed',
          runtimeEvent.payload.summary,
          runtimeEvent.occurredAt,
        );
        changeRun(
          'completed',
          runtimeEvent.payload.summary,
          runtimeEvent.occurredAt,
        );
        break;
      case 'task.failed':
        changeAgent(
          'failed',
          runtimeEvent.payload.reason,
          runtimeEvent.occurredAt,
        );
        changeTask(
          'failed',
          runtimeEvent.payload.reason,
          runtimeEvent.occurredAt,
        );
        changeRun(
          'failed',
          runtimeEvent.payload.reason,
          runtimeEvent.occurredAt,
        );
        break;
      case 'task.cancelled':
        changeAgent(
          'cancelled',
          runtimeEvent.payload.reason,
          runtimeEvent.occurredAt,
        );
        changeTask(
          'cancelled',
          runtimeEvent.payload.reason,
          runtimeEvent.occurredAt,
        );
        changeRun(
          'cancelled',
          runtimeEvent.payload.reason,
          runtimeEvent.occurredAt,
        );
        break;
      case 'runtime.disconnected':
        projection = emit(
          'runtime.disconnected',
          {
            runtimeEventId: runtimeEvent.id,
            reason: runtimeEvent.payload.reason,
          },
          runtimeEvent.occurredAt,
          eventOptions,
        );
        changeAgent(
          'disconnected',
          runtimeEvent.payload.reason,
          runtimeEvent.occurredAt,
        );
        changeTask(
          'awaiting_input',
          runtimeEvent.payload.reason,
          runtimeEvent.occurredAt,
        );
        changeRun(
          'paused',
          runtimeEvent.payload.reason,
          runtimeEvent.occurredAt,
        );
        break;
      case 'runtime.reconciled':
        projection = emit(
          'runtime.reconciled',
          {
            runtimeEventId: runtimeEvent.id,
            outcome: runtimeEvent.payload.outcome,
            reason: runtimeEvent.payload.reason,
          },
          runtimeEvent.occurredAt,
          eventOptions,
        );
        if (runtimeEvent.payload.outcome === 'reconnected') {
          changeAgent(
            'active',
            runtimeEvent.payload.reason,
            runtimeEvent.occurredAt,
          );
          changeTask(
            'running',
            runtimeEvent.payload.reason,
            runtimeEvent.occurredAt,
          );
          changeRun(
            'executing',
            runtimeEvent.payload.reason,
            runtimeEvent.occurredAt,
          );
        }
        break;
    }
  }

  return projection;
}
