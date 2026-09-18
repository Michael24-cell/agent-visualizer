import { z } from 'zod';
import {
  AgentInstanceSchema,
  ApprovalSchema,
  ArtifactSchema,
  DependencySchema,
  EventIdSchema,
  RunIdSchema,
  RunSchema,
  TaskSchema,
  ValidationResultSchema,
  parseDomainEvent,
  type DomainEvent,
} from '@harness/contracts';
import {
  assertAgentTransition,
  assertApprovalTransition,
  assertRunTransition,
  assertTaskTransition,
  assertValidationTransition,
} from './transitions.js';

export class ProjectionError extends Error {
  constructor(
    readonly code:
      | 'missing_run'
      | 'run_mismatch'
      | 'sequence_gap'
      | 'sequence_collision'
      | 'missing_entity'
      | 'duplicate_entity'
      | 'state_mismatch'
      | 'completion_blocked',
    message: string,
  ) {
    super(message);
    this.name = 'ProjectionError';
  }
}

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

export interface DomainEventSink {
  append(event: DomainEvent): RunProjection;
  getProjection(runId: z.infer<typeof RunIdSchema>): RunProjection | undefined;
}

function requireTask(projection: RunProjection, taskId: string) {
  const task = projection.tasks[taskId];
  if (!task) {
    throw new ProjectionError(
      'missing_entity',
      `Task ${taskId} does not exist.`,
    );
  }
  return task;
}

function requireAgent(projection: RunProjection, agentId: string) {
  const agent = projection.agents[agentId];
  if (!agent) {
    throw new ProjectionError(
      'missing_entity',
      `Agent instance ${agentId} does not exist.`,
    );
  }
  return agent;
}

function assertCompletionEvidence(
  projection: RunProjection,
  taskId: string,
): void {
  const task = requireTask(projection, taskId);
  const taskValidations = Object.values(projection.validations).filter(
    (validation) =>
      validation.taskId === task.id && validation.blocksCompletion,
  );
  if (
    taskValidations.length < task.validationRequirements.length ||
    taskValidations.some((validation) => validation.status !== 'passed')
  ) {
    throw new ProjectionError(
      'completion_blocked',
      `Task ${taskId} does not have passing completion evidence.`,
    );
  }
}

function deriveAttention(projection: RunProjection): boolean {
  return (
    projection.runtimeConnection === 'disconnected' ||
    Object.values(projection.approvals).some(
      (approval) => approval.state === 'requested',
    ) ||
    Object.values(projection.validations).some(
      (validation) =>
        validation.blocksCompletion && validation.status === 'failed',
    )
  );
}

export function applyDomainEvent(
  current: RunProjection | undefined,
  input: DomainEvent,
): RunProjection {
  const event = parseDomainEvent(input);

  if (!current) {
    if (event.type !== 'run.created' || event.sequence !== 1) {
      throw new ProjectionError(
        'missing_run',
        'The first event for a run must be run.created at sequence 1.',
      );
    }
    if (event.payload.run.id !== event.runId) {
      throw new ProjectionError(
        'run_mismatch',
        'Created run does not match the event run ID.',
      );
    }
    return RunProjectionSchema.parse({
      runId: event.runId,
      run: event.payload.run,
      tasks: {},
      dependencies: {},
      agents: {},
      approvals: {},
      validations: {},
      artifacts: {},
      runtimeConnection: 'connected',
      attentionRequired: false,
      lastSequence: event.sequence,
      lastEventId: event.id,
      appliedEventIds: [event.id],
    });
  }

  if (current.runId !== event.runId) {
    throw new ProjectionError(
      'run_mismatch',
      `Event ${event.id} belongs to another run.`,
    );
  }

  if (event.sequence <= current.lastSequence) {
    if (current.appliedEventIds.includes(event.id)) {
      return current;
    }
    throw new ProjectionError(
      'sequence_collision',
      `Sequence ${event.sequence} is already occupied by another event.`,
    );
  }

  if (event.sequence !== current.lastSequence + 1) {
    throw new ProjectionError(
      'sequence_gap',
      `Expected sequence ${current.lastSequence + 1}, received ${event.sequence}.`,
    );
  }

  let next: RunProjection = structuredClone(current);

  switch (event.type) {
    case 'run.created':
      throw new ProjectionError('duplicate_entity', 'Run already exists.');
    case 'run.state_changed': {
      if (next.run.state !== event.payload.from) {
        throw new ProjectionError(
          'state_mismatch',
          `Run is ${next.run.state}, not ${event.payload.from}.`,
        );
      }
      if (event.payload.to === 'completed') {
        const tasks = Object.values(next.tasks);
        if (
          tasks.length === 0 ||
          tasks.some((task) => task.state !== 'completed') ||
          Object.values(next.approvals).some(
            (approval) => approval.state === 'requested',
          )
        ) {
          throw new ProjectionError(
            'completion_blocked',
            'Run cannot complete while tasks or approvals remain unresolved.',
          );
        }
      }
      assertRunTransition(event.payload.from, event.payload.to);
      next.run = { ...next.run, state: event.payload.to };
      break;
    }
    case 'task.created': {
      const task = event.payload.task;
      if (task.runId !== next.runId) {
        throw new ProjectionError(
          'run_mismatch',
          'Task belongs to another run.',
        );
      }
      if (next.tasks[task.id]) {
        throw new ProjectionError(
          'duplicate_entity',
          `Task ${task.id} exists.`,
        );
      }
      next.tasks[task.id] = task;
      break;
    }
    case 'task.state_changed': {
      if (!event.taskId) {
        throw new ProjectionError(
          'missing_entity',
          'Task event has no task ID.',
        );
      }
      const task = requireTask(next, event.taskId);
      if (task.state !== event.payload.from) {
        throw new ProjectionError(
          'state_mismatch',
          `Task is ${task.state}, not ${event.payload.from}.`,
        );
      }
      if (event.payload.to === 'completed') {
        assertCompletionEvidence(next, event.taskId);
      }
      assertTaskTransition(event.payload.from, event.payload.to);
      next.tasks[event.taskId] = { ...task, state: event.payload.to };
      break;
    }
    case 'dependency.created': {
      const dependency = event.payload.dependency;
      if (dependency.runId !== next.runId) {
        throw new ProjectionError(
          'run_mismatch',
          'Dependency belongs to another run.',
        );
      }
      requireTask(next, dependency.upstreamTaskId);
      requireTask(next, dependency.downstreamTaskId);
      if (next.dependencies[dependency.id]) {
        throw new ProjectionError(
          'duplicate_entity',
          `Dependency ${dependency.id} exists.`,
        );
      }
      next.dependencies[dependency.id] = dependency;
      break;
    }
    case 'agent.instance_created': {
      const agent = event.payload.agentInstance;
      if (agent.runId !== next.runId) {
        throw new ProjectionError(
          'run_mismatch',
          'Agent instance belongs to another run.',
        );
      }
      const task = requireTask(next, agent.taskId);
      if (next.agents[agent.id]) {
        throw new ProjectionError(
          'duplicate_entity',
          `Agent instance ${agent.id} exists.`,
        );
      }
      next.agents[agent.id] = agent;
      next.tasks[task.id] = { ...task, activeAgentInstanceId: agent.id };
      break;
    }
    case 'agent.state_changed': {
      if (!event.agentInstanceId) {
        throw new ProjectionError(
          'missing_entity',
          'Agent event has no agent ID.',
        );
      }
      const agent = requireAgent(next, event.agentInstanceId);
      if (agent.state !== event.payload.from) {
        throw new ProjectionError(
          'state_mismatch',
          `Agent is ${agent.state}, not ${event.payload.from}.`,
        );
      }
      assertAgentTransition(event.payload.from, event.payload.to);
      const terminal = ['completed', 'failed', 'cancelled'].includes(
        event.payload.to,
      );
      next.agents[agent.id] = {
        ...agent,
        state: event.payload.to,
        ...(event.payload.to === 'active' && !agent.startedAt
          ? { startedAt: event.occurredAt }
          : {}),
        ...(terminal
          ? {
              endedAt: event.occurredAt,
              terminalReason: event.payload.reason,
            }
          : {}),
      };
      break;
    }
    case 'approval.requested': {
      const approval = event.payload.approval;
      if (approval.runId !== next.runId) {
        throw new ProjectionError(
          'run_mismatch',
          'Approval belongs to another run.',
        );
      }
      if (approval.taskId) requireTask(next, approval.taskId);
      if (approval.agentInstanceId)
        requireAgent(next, approval.agentInstanceId);
      if (next.approvals[approval.id]) {
        throw new ProjectionError(
          'duplicate_entity',
          `Approval ${approval.id} exists.`,
        );
      }
      next.approvals[approval.id] = approval;
      break;
    }
    case 'approval.decided': {
      const approval = next.approvals[event.payload.approvalId];
      if (!approval) {
        throw new ProjectionError('missing_entity', 'Approval does not exist.');
      }
      if (approval.state !== event.payload.from) {
        throw new ProjectionError(
          'state_mismatch',
          `Approval is ${approval.state}, not requested.`,
        );
      }
      assertApprovalTransition(event.payload.from, event.payload.to);
      next.approvals[approval.id] = {
        ...approval,
        state: event.payload.to,
        decidedAt: event.payload.decidedAt,
        ...(event.payload.note ? { decisionNote: event.payload.note } : {}),
      };
      break;
    }
    case 'validation.started': {
      const validation = event.payload.validation;
      if (validation.runId !== next.runId) {
        throw new ProjectionError(
          'run_mismatch',
          'Validation belongs to another run.',
        );
      }
      if (validation.taskId) requireTask(next, validation.taskId);
      if (next.validations[validation.id]) {
        throw new ProjectionError(
          'duplicate_entity',
          `Validation ${validation.id} exists.`,
        );
      }
      next.validations[validation.id] = validation;
      break;
    }
    case 'validation.completed': {
      const validation = next.validations[event.payload.validationId];
      if (!validation) {
        throw new ProjectionError(
          'missing_entity',
          'Validation does not exist.',
        );
      }
      if (validation.status !== event.payload.from) {
        throw new ProjectionError(
          'state_mismatch',
          `Validation is ${validation.status}, not running.`,
        );
      }
      assertValidationTransition(event.payload.from, event.payload.to);
      next.validations[validation.id] = {
        ...validation,
        status: event.payload.to,
        finishedAt: event.payload.finishedAt,
        outputSummary: event.payload.outputSummary,
        ...(event.payload.exitCode === undefined
          ? {}
          : { exitCode: event.payload.exitCode }),
      };
      break;
    }
    case 'artifact.produced': {
      const artifact = event.payload.artifact;
      if (artifact.runId !== next.runId) {
        throw new ProjectionError(
          'run_mismatch',
          'Artifact belongs to another run.',
        );
      }
      requireTask(next, artifact.taskId);
      requireAgent(next, artifact.agentInstanceId);
      if (next.artifacts[artifact.id]) {
        throw new ProjectionError(
          'duplicate_entity',
          `Artifact ${artifact.id} exists.`,
        );
      }
      next.artifacts[artifact.id] = artifact;
      break;
    }
    case 'runtime.disconnected':
      next.runtimeConnection = 'disconnected';
      next.recoverySummary = event.payload.reason;
      break;
    case 'runtime.reconciled':
      next.runtimeConnection =
        event.payload.outcome === 'reconnected' ? 'reconciled' : 'disconnected';
      next.recoverySummary = event.payload.reason;
      break;
  }

  next = {
    ...next,
    attentionRequired: deriveAttention(next),
    lastSequence: event.sequence,
    lastEventId: event.id,
    appliedEventIds: [...next.appliedEventIds, event.id],
  };

  return RunProjectionSchema.parse(next);
}

export function replayDomainEvents(
  events: readonly DomainEvent[],
  initial?: RunProjection,
): RunProjection {
  let projection = initial;
  for (const event of events) {
    projection = applyDomainEvent(projection, event);
  }
  if (!projection) {
    throw new ProjectionError(
      'missing_run',
      'Cannot replay an empty event stream.',
    );
  }
  return projection;
}
