import {
  BriefFieldIdSchema,
  ProjectProjectionSchema,
  parseProjectEvent,
  type Agent,
  type AgentTask,
  type Brief,
  type Message,
  type MethodDefinition,
  type ProjectEvent,
  type ProjectMethod,
  type ProjectProjection,
  type Proposal,
} from '@harness/contracts';
import { ProjectionError } from './projections.js';
import {
  assertAgentTaskTransition,
  assertAskTransition,
  assertBriefFieldTransition,
  assertCheckTransition,
  assertProposalTransition,
  assertThreadTransition,
  isTerminalTaskState,
} from './project-transitions.js';

export { ProjectProjectionSchema, type ProjectProjection };

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

function requireThread(projection: ProjectProjection, threadId: string) {
  const thread = projection.threads[threadId];
  if (!thread) {
    throw new ProjectionError(
      'missing_entity',
      `Thread ${threadId} does not exist.`,
    );
  }
  return thread;
}

function requireOpenThread(projection: ProjectProjection, threadId: string) {
  const thread = requireThread(projection, threadId);
  if (thread.state !== 'open') {
    throw new ProjectionError('thread_closed', `Thread ${threadId} is closed.`);
  }
  return thread;
}

function requireAgent(projection: ProjectProjection, agentId: string) {
  const agent = projection.agents[agentId];
  if (!agent) {
    throw new ProjectionError(
      'missing_entity',
      `Agent ${agentId} does not exist.`,
    );
  }
  return agent;
}

function requireTask(projection: ProjectProjection, taskId: string) {
  const task = projection.tasks[taskId];
  if (!task) {
    throw new ProjectionError(
      'missing_entity',
      `Task ${taskId} does not exist.`,
    );
  }
  return task;
}

function requirePlan(projection: ProjectProjection, planId: string) {
  const plan = projection.plans[planId];
  if (!plan) {
    throw new ProjectionError(
      'missing_entity',
      `Plan ${planId} does not exist.`,
    );
  }
  return plan;
}

function requireProposal(projection: ProjectProjection, proposalId: string) {
  const proposal = projection.proposals[proposalId];
  if (!proposal) {
    throw new ProjectionError(
      'missing_entity',
      `Proposal ${proposalId} does not exist.`,
    );
  }
  return proposal;
}

function requireApprovedProposal<TKind extends Proposal['kind']>(
  projection: ProjectProjection,
  proposalId: string,
  kind: TKind,
): Extract<Proposal, { kind: TKind }> {
  const proposal = requireProposal(projection, proposalId);
  if (proposal.kind !== kind) {
    throw new ProjectionError(
      'invalid_payload',
      `Proposal ${proposalId} is a ${proposal.kind} proposal, not ${kind}.`,
    );
  }
  if (proposal.state !== 'approved') {
    throw new ProjectionError(
      'not_approved',
      `Proposal ${proposalId} is ${proposal.state}, not approved.`,
    );
  }
  return proposal as Extract<Proposal, { kind: TKind }>;
}

function assertProject(projection: ProjectProjection, projectId: string) {
  if (projectId !== projection.projectId) {
    throw new ProjectionError(
      'project_mismatch',
      `Entity belongs to project ${projectId}, not ${projection.projectId}.`,
    );
  }
}

function assertSequenceField(
  label: string,
  value: number | undefined,
  sequence: number,
) {
  if (value !== sequence) {
    throw new ProjectionError(
      'invalid_payload',
      `${label} must be ${sequence}, received ${String(value)}.`,
    );
  }
}

function openAskFor(projection: ProjectProjection, taskId: string) {
  return Object.values(projection.asks).find(
    (ask) => ask.taskId === taskId && ask.state === 'open',
  );
}

// Every reference a message carries must point at something real in this
// project, and task-bound references must belong to the referenced task.
function assertMessageRefs(
  projection: ProjectProjection,
  refs: Message['refs'],
) {
  if (!refs) return;
  const task = refs.taskId ? requireTask(projection, refs.taskId) : undefined;
  if (refs.proposalId) requireProposal(projection, refs.proposalId);
  if (refs.fromThreadId) requireThread(projection, refs.fromThreadId);
  const bound = <T extends { taskId: string }>(
    label: string,
    id: string | undefined,
    table: Record<string, T>,
  ) => {
    if (!id) return;
    const entity = table[id];
    if (!entity) {
      throw new ProjectionError(
        'missing_entity',
        `${label} ${id} does not exist.`,
      );
    }
    if (task && entity.taskId !== task.id) {
      throw new ProjectionError(
        'invalid_payload',
        `${label} ${id} belongs to task ${entity.taskId}, not ${task.id}.`,
      );
    }
  };
  bound('Ask', refs.askId, projection.asks);
  bound('Check', refs.checkId, projection.checks);
  bound('Output', refs.outputId, projection.outputs);
}

// ---------------------------------------------------------------------------
// Derived pieces
// ---------------------------------------------------------------------------

// The method as it applies right now: catalog definition with each
// project-local override replacing its section. Overrides are applied in
// order, so the latest override of a section wins.
export function resolveMethod(method: ProjectMethod): MethodDefinition {
  let resolved: MethodDefinition = structuredClone(method.definition);
  for (const override of method.overrides) {
    resolved = { ...resolved, [override.sectionId]: [...override.value] };
  }
  return resolved;
}

function emptyBrief(sequence: number): Brief {
  return {
    version: 0,
    fields: Object.fromEntries(
      BriefFieldIdSchema.options.map((fieldId) => [
        fieldId,
        { state: 'missing' as const },
      ]),
    ) as Brief['fields'],
    requests: [],
    lastSequence: sequence,
  };
}

// The threads, agents, and tasks an event touches. The reducer derives these
// from the payload (the authoritative source) so per-target `lastSequence`
// is right whether or not the envelope names them. Envelope ids, when
// present, must agree with what was derived.
class Targets {
  readonly threads = new Set<string>();
  readonly agents = new Set<string>();
  readonly tasks = new Set<string>();

  constructor(private readonly projection: ProjectProjection) {}

  thread(threadId: string | undefined) {
    if (threadId) this.threads.add(threadId);
    return this;
  }

  agent(agentId: string | undefined) {
    if (agentId) this.agents.add(agentId);
    return this;
  }

  task(taskId: string | undefined) {
    if (!taskId) return this;
    this.tasks.add(taskId);
    const task = this.projection.tasks[taskId];
    if (task) this.agents.add(task.agentId);
    return this;
  }

  assertEnvelope(event: ProjectEvent) {
    const mismatch = (label: string, id: string, set: Set<string>) => {
      if (!set.has(id)) {
        throw new ProjectionError(
          'invalid_payload',
          `Event ${label} ${id} does not match the ${label} this event affects.`,
        );
      }
    };
    if (event.threadId) mismatch('thread', event.threadId, this.threads);
    if (event.agentId) mismatch('agent', event.agentId, this.agents);
    if (event.taskId) mismatch('task', event.taskId, this.tasks);
  }

  apply(sequence: number) {
    for (const threadId of this.threads) {
      const thread = this.projection.threads[threadId];
      if (thread)
        this.projection.threads[threadId] = {
          ...thread,
          lastSequence: sequence,
        };
    }
    for (const agentId of this.agents) {
      const agent = this.projection.agents[agentId];
      if (agent)
        this.projection.agents[agentId] = { ...agent, lastSequence: sequence };
    }
  }
}

// An agent's work state is its current task's state, or idle.
function syncAgentWork(projection: ProjectProjection, agentId: string) {
  const agent = requireAgent(projection, agentId);
  const task = agent.currentTaskId
    ? projection.tasks[agent.currentTaskId]
    : undefined;
  const next: Agent = { ...agent, work: task ? task.state : 'idle' };
  projection.agents[agentId] = next;
}

function latestCheckPassed(
  projection: ProjectProjection,
  task: AgentTask,
  name: string,
): boolean {
  const attempts = Object.values(projection.checks)
    .filter((check) => check.taskId === task.id && check.name === name)
    .sort((a, b) => a.startedAtSequence - b.startedAtSequence);
  return attempts.at(-1)?.state === 'passed';
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export function applyProjectEvent(
  current: ProjectProjection | undefined,
  input: ProjectEvent,
): ProjectProjection {
  const event = parseProjectEvent(input);
  const sequence = event.sequence;

  if (!current) {
    if (event.type !== 'project.created' || sequence !== 1) {
      throw new ProjectionError(
        'missing_project',
        'The first event for a project must be project.created at sequence 1.',
      );
    }
    if (event.payload.project.id !== event.projectId) {
      throw new ProjectionError(
        'project_mismatch',
        'Created project does not match the event project ID.',
      );
    }
    return ProjectProjectionSchema.parse({
      projectId: event.projectId,
      project: event.payload.project,
      brief: emptyBrief(sequence),
      method: null,
      methodSnapshots: {},
      threads: {},
      agents: {},
      tasks: {},
      planDocument: { sections: {}, lastSequence: sequence },
      plans: {},
      proposals: {},
      asks: {},
      checks: {},
      outputs: {},
      activities: {},
      lastSequence: sequence,
      lastEventId: event.id,
      appliedEventIds: [event.id],
    });
  }

  if (current.projectId !== event.projectId) {
    throw new ProjectionError(
      'project_mismatch',
      `Event ${event.id} belongs to another project.`,
    );
  }
  if (sequence <= current.lastSequence) {
    if (current.appliedEventIds.includes(event.id)) return current;
    throw new ProjectionError(
      'sequence_collision',
      `Sequence ${sequence} is already occupied by another event.`,
    );
  }
  if (sequence !== current.lastSequence + 1) {
    throw new ProjectionError(
      'sequence_gap',
      `Expected sequence ${current.lastSequence + 1}, received ${sequence}.`,
    );
  }

  let next: ProjectProjection = structuredClone(current);
  const targets = new Targets(next);

  switch (event.type) {
    case 'project.created':
      throw new ProjectionError('duplicate_entity', 'Project already exists.');

    case 'project.renamed': {
      if (next.project.name === event.payload.name) {
        throw new ProjectionError(
          'invalid_payload',
          `The project is already called ${event.payload.name}.`,
        );
      }
      next.project = { ...next.project, name: event.payload.name };
      break;
    }

    case 'project.archived': {
      if (next.project.archivedAt) {
        throw new ProjectionError('invalid_payload', 'Already archived.');
      }
      next.project = { ...next.project, archivedAt: event.occurredAt };
      break;
    }

    case 'project.unarchived': {
      if (!next.project.archivedAt) {
        throw new ProjectionError('invalid_payload', 'Not archived.');
      }
      const restored = { ...next.project };
      delete restored.archivedAt;
      next.project = restored;
      break;
    }

    case 'project.trust_changed': {
      if ((next.project.trust ?? 'ask') === event.payload.trust) {
        throw new ProjectionError(
          'invalid_payload',
          `Trust is already ${event.payload.trust}.`,
        );
      }
      next.project = { ...next.project, trust: event.payload.trust };
      break;
    }

    case 'project.repository_attached': {
      // Re-attaching is allowed (the user moved or renamed the folder); the
      // event history keeps every attachment.
      next.project = { ...next.project, repository: event.payload.repository };
      break;
    }

    case 'thread.opened': {
      const thread = event.payload.thread;
      assertProject(next, thread.projectId);
      if (next.threads[thread.id]) {
        throw new ProjectionError(
          'duplicate_entity',
          `Thread ${thread.id} exists.`,
        );
      }
      if (thread.state !== 'open' || thread.messageCount !== 0) {
        throw new ProjectionError(
          'invalid_payload',
          'A new thread must be open and empty.',
        );
      }
      assertSequenceField('thread.lastSequence', thread.lastSequence, sequence);
      if (thread.kind === 'coordinator') {
        if (thread.agentId) {
          throw new ProjectionError(
            'invalid_payload',
            'The coordinator thread has no agent.',
          );
        }
        if (Object.values(next.threads).some((t) => t.kind === 'coordinator')) {
          throw new ProjectionError(
            'duplicate_entity',
            'A project has exactly one coordinator thread.',
          );
        }
      } else if (!thread.agentId) {
        throw new ProjectionError(
          'invalid_payload',
          'An agent thread must name its agent.',
        );
      } else if (
        Object.values(next.threads).some((t) => t.agentId === thread.agentId)
      ) {
        throw new ProjectionError(
          'duplicate_entity',
          `Agent ${thread.agentId} already has a thread.`,
        );
      }
      next.threads[thread.id] = thread;
      targets.thread(thread.id).agent(thread.agentId);
      break;
    }

    case 'thread.closed': {
      const thread = requireThread(next, event.payload.threadId);
      assertThreadTransition(thread.state, 'closed');
      next.threads[thread.id] = { ...thread, state: 'closed' };
      targets.thread(thread.id).agent(thread.agentId);
      break;
    }

    case 'message.posted': {
      const message = event.payload.message;
      assertProject(next, message.projectId);
      assertSequenceField('message.sequence', message.sequence, sequence);
      const thread = requireOpenThread(next, message.threadId);
      if (message.author.agentId) {
        requireAgent(next, message.author.agentId);
      }
      if (message.author.role === 'agent') {
        if (!message.author.agentId) {
          throw new ProjectionError(
            'invalid_payload',
            'An agent message must name its agent.',
          );
        }
        if (
          thread.kind === 'agent' &&
          thread.agentId !== message.author.agentId
        ) {
          throw new ProjectionError(
            'invalid_payload',
            'An agent may only post in its own thread.',
          );
        }
      }
      if (message.intent !== 'chat' && message.author.role !== 'user') {
        throw new ProjectionError(
          'invalid_payload',
          `Only the user can post a ${message.intent} message.`,
        );
      }
      assertMessageRefs(next, message.refs);
      next.threads[thread.id] = {
        ...thread,
        messageCount: thread.messageCount + 1,
      };
      targets
        .thread(thread.id)
        .agent(thread.agentId)
        .agent(message.author.agentId);
      break;
    }

    case 'brief.field_updated': {
      const { fieldId, to, value, source, messageId } = event.payload;
      const field = next.brief.fields[fieldId];
      assertBriefFieldTransition(field.state, to);
      if (to !== 'skipped' && !value) {
        throw new ProjectionError(
          'invalid_payload',
          `A ${to} brief field needs a value.`,
        );
      }
      next.brief.fields[fieldId] = {
        state: to,
        ...(value ? { value } : {}),
        source,
        ...(messageId ? { messageId } : {}),
        updatedAtSequence: sequence,
      };
      next.brief.version += 1;
      next.brief.lastSequence = sequence;
      break;
    }

    case 'brief.request_recorded': {
      const request = event.payload.request;
      assertSequenceField(
        'request.recordedAtSequence',
        request.recordedAtSequence,
        sequence,
      );
      const proposal = requireApprovedProposal(
        next,
        request.proposalId,
        'record_request',
      );
      if (
        next.brief.requests.some(
          (existing) =>
            existing.id === request.id ||
            existing.proposalId === request.proposalId,
        )
      ) {
        throw new ProjectionError(
          'duplicate_entity',
          `Request for proposal ${request.proposalId} was already recorded.`,
        );
      }
      if (
        request.text !== proposal.payload.text ||
        request.category !== proposal.payload.category
      ) {
        throw new ProjectionError(
          'invalid_payload',
          'A recorded request must match its approved proposal.',
        );
      }
      next.brief.requests.push(request);
      next.brief.version += 1;
      next.brief.lastSequence = sequence;
      break;
    }

    case 'method.applied': {
      const { definition, proposalId } = event.payload;
      if (proposalId) {
        const proposal = requireApprovedProposal(
          next,
          proposalId,
          'set_method',
        );
        if (
          proposal.payload.catalogId !== definition.id ||
          proposal.payload.catalogVersion !== definition.version
        ) {
          throw new ProjectionError(
            'invalid_payload',
            'Applied method must match its approved proposal.',
          );
        }
      }
      next.method = {
        definition,
        overrides: [],
        version: (next.method?.version ?? 0) + 1,
        lastSequence: sequence,
      };
      break;
    }

    case 'method.override_recorded': {
      if (!next.method) {
        throw new ProjectionError(
          'missing_entity',
          'No method is applied to this project.',
        );
      }
      next.method = {
        ...next.method,
        overrides: [
          ...next.method.overrides,
          {
            sectionId: event.payload.sectionId,
            value: event.payload.value,
            ...(event.payload.source ? { source: event.payload.source } : {}),
            recordedAtSequence: sequence,
          },
        ],
        version: next.method.version + 1,
        lastSequence: sequence,
      };
      break;
    }

    case 'plan.section_edited': {
      const { sectionId, lines, source } = event.payload;
      const previous = next.planDocument.sections[sectionId];
      if (
        previous &&
        previous.lines.length === lines.length &&
        previous.lines.every((line, index) => line === lines[index])
      ) {
        throw new ProjectionError(
          'invalid_payload',
          `Plan section ${sectionId} already reads that way.`,
        );
      }
      next.planDocument = {
        sections: {
          ...next.planDocument.sections,
          [sectionId]: { lines, source, updatedAtSequence: sequence },
        },
        lastSequence: sequence,
      };
      break;
    }

    case 'method.overrides_cleared': {
      if (!next.method) {
        throw new ProjectionError(
          'missing_entity',
          'No method is applied to this project.',
        );
      }
      if (next.method.overrides.length === 0) {
        throw new ProjectionError(
          'invalid_payload',
          'The Method already matches its catalog entry.',
        );
      }
      next.method = {
        ...next.method,
        overrides: [],
        version: next.method.version + 1,
        lastSequence: sequence,
      };
      break;
    }

    case 'method.snapshot_pinned': {
      const snapshot = event.payload.snapshot;
      assertSequenceField(
        'snapshot.pinnedAtSequence',
        snapshot.pinnedAtSequence,
        sequence,
      );
      if (!next.method) {
        throw new ProjectionError(
          'missing_entity',
          'No method is applied, so there is nothing to pin.',
        );
      }
      if (next.methodSnapshots[snapshot.id]) {
        throw new ProjectionError(
          'duplicate_entity',
          `Snapshot ${snapshot.id} exists.`,
        );
      }
      const task = requireTask(next, snapshot.taskId);
      if (task.methodSnapshotId) {
        throw new ProjectionError(
          'snapshot_mismatch',
          `Task ${task.id} already has a pinned method snapshot.`,
        );
      }
      if (isTerminalTaskState(task.state)) {
        throw new ProjectionError(
          'state_mismatch',
          `Task ${task.id} is ${task.state}; a snapshot cannot be pinned now.`,
        );
      }
      if (
        snapshot.methodVersion !== next.method.version ||
        JSON.stringify(snapshot.resolved) !==
          JSON.stringify(resolveMethod(next.method))
      ) {
        throw new ProjectionError(
          'snapshot_mismatch',
          'A snapshot must equal the method in force when it is pinned.',
        );
      }
      next.methodSnapshots[snapshot.id] = snapshot;
      next.tasks[task.id] = { ...task, methodSnapshotId: snapshot.id };
      targets.task(task.id);
      break;
    }

    case 'agent.created': {
      const agent = event.payload.agent;
      assertProject(next, agent.projectId);
      if (next.agents[agent.id]) {
        throw new ProjectionError(
          'duplicate_entity',
          `Agent ${agent.id} exists.`,
        );
      }
      const thread = requireThread(next, agent.threadId);
      if (thread.kind !== 'agent' || thread.agentId !== agent.id) {
        throw new ProjectionError(
          'invalid_payload',
          `Thread ${thread.id} is not the thread for agent ${agent.id}.`,
        );
      }
      if (
        agent.work !== 'idle' ||
        agent.currentTaskId ||
        agent.taskIds.length !== 0
      ) {
        throw new ProjectionError(
          'invalid_payload',
          'A new agent starts idle with no tasks.',
        );
      }
      assertSequenceField(
        'agent.createdAtSequence',
        agent.createdAtSequence,
        sequence,
      );
      assertSequenceField('agent.lastSequence', agent.lastSequence, sequence);
      next.agents[agent.id] = agent;
      targets.agent(agent.id).thread(agent.threadId);
      break;
    }

    case 'agent.renamed': {
      const agent = requireAgent(next, event.payload.agentId);
      if (agent.name === event.payload.name) {
        throw new ProjectionError(
          'invalid_payload',
          `Agent ${agent.id} is already called ${agent.name}.`,
        );
      }
      next.agents[agent.id] = { ...agent, name: event.payload.name };
      targets.agent(agent.id);
      break;
    }

    case 'agent.model_changed': {
      const agent = requireAgent(next, event.payload.agentId);
      const { model, endpointModel } = event.payload;
      const sameTier = model === undefined || agent.model === model;
      const sameEndpoint =
        endpointModel === undefined || agent.endpointModel === endpointModel;
      if (sameTier && sameEndpoint) {
        throw new ProjectionError(
          'invalid_payload',
          `Agent ${agent.id} already runs on that model.`,
        );
      }
      next.agents[agent.id] = {
        ...agent,
        ...(model ? { model } : {}),
        ...(endpointModel ? { endpointModel } : {}),
      };
      targets.agent(agent.id);
      break;
    }

    case 'plan.recorded': {
      const plan = event.payload.plan;
      assertProject(next, plan.projectId);
      if (next.plans[plan.id]) {
        throw new ProjectionError(
          'duplicate_entity',
          `Plan ${plan.id} exists.`,
        );
      }
      if (plan.version !== Object.keys(next.plans).length + 1) {
        throw new ProjectionError(
          'invalid_payload',
          `Plan version must be ${Object.keys(next.plans).length + 1}.`,
        );
      }
      if (
        plan.proposalId ||
        plan.assignedAtSequence ||
        plan.supersededByPlanId
      ) {
        throw new ProjectionError(
          'invalid_payload',
          'A new plan has no proposal, assignment, or successor yet.',
        );
      }
      assertSequenceField(
        'plan.recordedAtSequence',
        plan.recordedAtSequence,
        sequence,
      );
      const live = Object.values(next.plans).find(
        (existing) =>
          !existing.assignedAtSequence && !existing.supersededByPlanId,
      );
      if (live && plan.supersedesPlanId !== live.id) {
        throw new ProjectionError(
          'plan_conflict',
          `Plan ${live.id} is still current; a new plan must supersede it.`,
        );
      }
      if (plan.supersedesPlanId) {
        const previous = requirePlan(next, plan.supersedesPlanId);
        if (previous.assignedAtSequence || previous.supersededByPlanId) {
          throw new ProjectionError(
            'plan_superseded',
            `Plan ${previous.id} can no longer be superseded.`,
          );
        }
        next.plans[previous.id] = { ...previous, supersededByPlanId: plan.id };
        if (previous.proposalId) {
          const proposal = requireProposal(next, previous.proposalId);
          if (proposal.state === 'open') {
            assertProposalTransition(proposal.state, 'superseded');
            next.proposals[proposal.id] = {
              ...proposal,
              state: 'superseded',
              decidedAtSequence: sequence,
              lastSequence: sequence,
            };
          }
        }
      }
      next.plans[plan.id] = plan;
      break;
    }

    case 'plan.assigned': {
      const plan = requirePlan(next, event.payload.planId);
      if (plan.supersededByPlanId) {
        throw new ProjectionError(
          'plan_superseded',
          `Plan ${plan.id} was superseded by ${plan.supersededByPlanId}.`,
        );
      }
      if (plan.assignedAtSequence) {
        throw new ProjectionError(
          'duplicate_entity',
          `Plan ${plan.id} was already assigned.`,
        );
      }
      if (plan.proposalId) {
        if (event.payload.proposalId !== plan.proposalId) {
          throw new ProjectionError(
            'not_approved',
            `Plan ${plan.id} can only be assigned through its proposal.`,
          );
        }
        requireApprovedProposal(next, plan.proposalId, 'plan');
      }
      const rows = new Map<number, AgentTask>();
      for (const task of Object.values(next.tasks)) {
        if (task.planId !== plan.id) continue;
        const index = task.planTaskIndex ?? -1;
        if (rows.has(index)) {
          throw new ProjectionError(
            'plan_incomplete',
            `Plan ${plan.id} row ${index} was assigned more than once.`,
          );
        }
        rows.set(index, task);
        targets.task(task.id);
      }
      const missing = plan.tasks
        .map((_, index) => index)
        .filter((index) => !rows.has(index));
      if (missing.length || rows.size !== plan.tasks.length) {
        throw new ProjectionError(
          'plan_incomplete',
          `Plan ${plan.id} rows ${missing.join(', ') || '(none)'} are not assigned.`,
        );
      }
      next.plans[plan.id] = { ...plan, assignedAtSequence: sequence };
      break;
    }

    case 'task.assigned': {
      const task = event.payload.task;
      assertProject(next, task.projectId);
      if (next.tasks[task.id]) {
        throw new ProjectionError(
          'duplicate_entity',
          `Task ${task.id} exists.`,
        );
      }
      const agent = requireAgent(next, task.agentId);
      if (!['idle', 'done', 'stopped', 'failed'].includes(agent.work)) {
        throw new ProjectionError(
          'agent_busy',
          `Agent ${agent.id} is ${agent.work}; finish or stop its current task first.`,
        );
      }
      for (const dependency of task.dependsOn) {
        if (dependency === task.id) {
          throw new ProjectionError(
            'invalid_payload',
            'A task cannot depend on itself.',
          );
        }
        requireTask(next, dependency);
      }
      const expectedState = task.dependsOn.length ? 'waiting' : 'working';
      if (task.state !== expectedState) {
        throw new ProjectionError(
          'invalid_payload',
          `A task with ${task.dependsOn.length} dependencies starts ${expectedState}.`,
        );
      }
      if (
        task.inputsSatisfied.length ||
        task.scopeHistory.length ||
        task.methodSnapshotId ||
        task.endedAtSequence ||
        task.endReason
      ) {
        throw new ProjectionError(
          'invalid_payload',
          'A new task has no inputs, scope history, snapshot, or end yet.',
        );
      }
      assertSequenceField(
        'task.createdAtSequence',
        task.createdAtSequence,
        sequence,
      );
      if (task.planId) {
        const plan = requirePlan(next, task.planId);
        if (plan.supersededByPlanId) {
          throw new ProjectionError(
            'plan_superseded',
            `Plan ${plan.id} was superseded; its tasks cannot be assigned.`,
          );
        }
        if (plan.assignedAtSequence) {
          throw new ProjectionError(
            'duplicate_entity',
            `Plan ${plan.id} was already assigned.`,
          );
        }
        if (plan.proposalId)
          requireApprovedProposal(next, plan.proposalId, 'plan');
        const row = plan.tasks[task.planTaskIndex ?? -1];
        if (!row) {
          throw new ProjectionError(
            'invalid_payload',
            `Plan ${plan.id} has no row ${String(task.planTaskIndex)}.`,
          );
        }
        if (
          Object.values(next.tasks).some(
            (existing) =>
              existing.planId === plan.id &&
              existing.planTaskIndex === task.planTaskIndex,
          )
        ) {
          throw new ProjectionError(
            'duplicate_entity',
            `Plan ${plan.id} row ${String(task.planTaskIndex)} is already assigned.`,
          );
        }
        // A plan-derived task is the row, verbatim. Dependencies are the
        // ids of the tasks already assigned for the row's upstream rows.
        const same = (a: unknown, b: unknown) =>
          JSON.stringify(a) === JSON.stringify(b);
        const upstreamIds = row.dependsOn.map(
          (index) =>
            Object.values(next.tasks).find(
              (existing) =>
                existing.planId === plan.id && existing.planTaskIndex === index,
            )?.id,
        );
        const matchesRow =
          task.title === row.title &&
          task.objective === row.objective &&
          task.category === row.category &&
          agent.name === row.agentName &&
          same(task.skills, row.skills) &&
          same(task.scope, row.scope) &&
          same(task.expectedOutputs, row.expectedOutputs) &&
          same(task.requiredChecks, row.requiredChecks) &&
          task.modelTier === row.modelTier &&
          same(task.sections ?? [], row.sections ?? []) &&
          task.whySeparate === row.whySeparate &&
          task.whyThisAgent === row.whyThisAgent &&
          upstreamIds.every((id) => id !== undefined) &&
          same([...task.dependsOn].sort(), [...upstreamIds].sort());
        if (!matchesRow) {
          throw new ProjectionError(
            'invalid_payload',
            `Task ${task.id} does not match plan ${plan.id} row ${String(task.planTaskIndex)}.`,
          );
        }
      }
      next.tasks[task.id] =
        task.state === 'working' && !task.startedAt
          ? { ...task, startedAt: event.occurredAt }
          : task;
      next.agents[agent.id] = {
        ...agent,
        currentTaskId: task.id,
        taskIds: [...agent.taskIds, task.id],
      };
      syncAgentWork(next, agent.id);
      targets.task(task.id);
      break;
    }

    case 'task.state_changed': {
      const task = requireTask(next, event.payload.taskId);
      const { from, to, reason } = event.payload;
      if (task.state !== from) {
        throw new ProjectionError(
          'state_mismatch',
          `Task is ${task.state}, not ${from}.`,
        );
      }
      assertAgentTaskTransition(from, to);
      if (
        to === 'working' &&
        from === 'waiting' &&
        !task.dependsOn.every((id) => task.inputsSatisfied.includes(id))
      ) {
        throw new ProjectionError(
          'inputs_missing',
          `Task ${task.id} is still waiting on an upstream output.`,
        );
      }
      if (isTerminalTaskState(to) && openAskFor(next, task.id)) {
        throw new ProjectionError(
          'ask_open',
          `Task ${task.id} has an open ask; decide or close it first.`,
        );
      }
      if (
        to === 'done' &&
        !task.requiredChecks.every((name) =>
          latestCheckPassed(next, task, name),
        )
      ) {
        throw new ProjectionError(
          'completion_blocked',
          `Task ${task.id} does not have passing evidence for every required check.`,
        );
      }
      next.tasks[task.id] = {
        ...task,
        state: to,
        ...(to === 'working' && !task.startedAt
          ? { startedAt: event.occurredAt }
          : {}),
        ...(isTerminalTaskState(to)
          ? { endedAtSequence: sequence, endReason: reason }
          : {}),
      };
      syncAgentWork(next, task.agentId);
      targets.task(task.id);
      break;
    }

    case 'task.input_satisfied': {
      const task = requireTask(next, event.payload.taskId);
      const { upstreamTaskId, outputId } = event.payload;
      if (!task.dependsOn.includes(upstreamTaskId)) {
        throw new ProjectionError(
          'invalid_payload',
          `Task ${task.id} does not depend on ${upstreamTaskId}.`,
        );
      }
      if (task.inputsSatisfied.includes(upstreamTaskId)) {
        throw new ProjectionError(
          'duplicate_entity',
          `Input from ${upstreamTaskId} was already satisfied.`,
        );
      }
      if (task.state !== 'waiting') {
        throw new ProjectionError(
          'state_mismatch',
          `Task ${task.id} is ${task.state}, not waiting.`,
        );
      }
      const upstream = requireTask(next, upstreamTaskId);
      const output = next.outputs[outputId];
      if (
        upstream.state !== 'done' ||
        !output ||
        output.taskId !== upstream.id
      ) {
        throw new ProjectionError(
          'inputs_missing',
          `Upstream task ${upstreamTaskId} has not produced a finished output.`,
        );
      }
      next.tasks[task.id] = {
        ...task,
        inputsSatisfied: [...task.inputsSatisfied, upstreamTaskId],
      };
      targets.task(task.id);
      break;
    }

    case 'task.scope_changed': {
      const task = requireTask(next, event.payload.taskId);
      if (isTerminalTaskState(task.state)) {
        throw new ProjectionError(
          'state_mismatch',
          `Task ${task.id} is ${task.state}; its scope is frozen.`,
        );
      }
      const proposal = requireApprovedProposal(
        next,
        event.payload.proposalId,
        'change_task_scope',
      );
      if (
        proposal.payload.taskId !== task.id ||
        JSON.stringify(proposal.payload.scope) !==
          JSON.stringify(event.payload.scope)
      ) {
        throw new ProjectionError(
          'invalid_payload',
          'A scope change must match its approved proposal exactly.',
        );
      }
      if (task.scopeHistory.some((entry) => entry.proposalId === proposal.id)) {
        throw new ProjectionError(
          'duplicate_entity',
          `Scope from proposal ${proposal.id} was already applied.`,
        );
      }
      next.tasks[task.id] = {
        ...task,
        scope: [...event.payload.scope],
        scopeHistory: [
          ...task.scopeHistory,
          {
            proposalId: proposal.id,
            scope: [...event.payload.scope],
            appliedAtSequence: sequence,
          },
        ],
      };
      targets.task(task.id);
      break;
    }

    case 'ask.opened': {
      const ask = event.payload.ask;
      assertProject(next, ask.projectId);
      if (next.asks[ask.id]) {
        throw new ProjectionError('duplicate_entity', `Ask ${ask.id} exists.`);
      }
      const task = requireTask(next, ask.taskId);
      requireAgent(next, ask.agentId);
      if (task.agentId !== ask.agentId) {
        throw new ProjectionError(
          'invalid_payload',
          `Task ${task.id} belongs to another agent.`,
        );
      }
      if (task.state !== 'working') {
        throw new ProjectionError(
          'state_mismatch',
          `Task ${task.id} is ${task.state}; only working tasks can ask.`,
        );
      }
      if (openAskFor(next, task.id)) {
        throw new ProjectionError(
          'ask_open',
          `Task ${task.id} already has an open ask.`,
        );
      }
      if (ask.state !== 'open' || ask.decidedAtSequence || ask.note) {
        throw new ProjectionError('invalid_payload', 'A new ask is open.');
      }
      assertSequenceField(
        'ask.openedAtSequence',
        ask.openedAtSequence,
        sequence,
      );
      next.asks[ask.id] = ask;
      targets.task(ask.taskId);
      break;
    }

    case 'ask.decided': {
      const ask = next.asks[event.payload.askId];
      if (!ask) {
        throw new ProjectionError('missing_entity', 'Ask does not exist.');
      }
      if (ask.state !== event.payload.from) {
        throw new ProjectionError(
          'state_mismatch',
          `Ask is ${ask.state}, not open.`,
        );
      }
      assertAskTransition(ask.state, event.payload.to);
      next.asks[ask.id] = {
        ...ask,
        state: event.payload.to,
        decidedAtSequence: sequence,
        ...(event.payload.note ? { note: event.payload.note } : {}),
      };
      if (event.payload.trust === 'task') {
        if (event.payload.to !== 'approved') {
          throw new ProjectionError(
            'invalid_payload',
            'Only an approval can trust the rest of a task.',
          );
        }
        const task = requireTask(next, ask.taskId);
        next.tasks[task.id] = { ...task, trusted: true };
      }
      targets.task(ask.taskId);
      break;
    }

    case 'check.started': {
      const check = event.payload.check;
      assertProject(next, check.projectId);
      if (next.checks[check.id]) {
        throw new ProjectionError(
          'duplicate_entity',
          `Check ${check.id} exists.`,
        );
      }
      const task = requireTask(next, check.taskId);
      if (task.agentId !== check.agentId) {
        throw new ProjectionError(
          'invalid_payload',
          `Task ${task.id} belongs to another agent.`,
        );
      }
      if (task.state !== 'working') {
        throw new ProjectionError(
          'state_mismatch',
          `Task ${task.id} is ${task.state}; checks run on working tasks.`,
        );
      }
      if (check.retryOf) {
        const previous = next.checks[check.retryOf];
        if (!previous || previous.taskId !== check.taskId) {
          throw new ProjectionError(
            'missing_entity',
            `Check ${check.retryOf} is not an earlier check on this task.`,
          );
        }
      }
      if (
        check.state !== 'running' ||
        check.summary ||
        check.finishedAtSequence
      ) {
        throw new ProjectionError('invalid_payload', 'A new check is running.');
      }
      assertSequenceField(
        'check.startedAtSequence',
        check.startedAtSequence,
        sequence,
      );
      next.checks[check.id] = check;
      targets.task(check.taskId);
      break;
    }

    case 'check.finished': {
      const check = next.checks[event.payload.checkId];
      if (!check) {
        throw new ProjectionError('missing_entity', 'Check does not exist.');
      }
      if (check.state !== event.payload.from) {
        throw new ProjectionError(
          'state_mismatch',
          `Check is ${check.state}, not running.`,
        );
      }
      assertCheckTransition(check.state, event.payload.to);
      next.checks[check.id] = {
        ...check,
        state: event.payload.to,
        summary: event.payload.summary,
        finishedAtSequence: sequence,
      };
      targets.task(check.taskId);
      break;
    }

    case 'task.tool_used': {
      const activity = event.payload.activity;
      assertProject(next, activity.projectId);
      if (next.activities[activity.id]) {
        throw new ProjectionError(
          'duplicate_entity',
          `Activity ${activity.id} exists.`,
        );
      }
      const task = requireTask(next, activity.taskId);
      if (task.agentId !== activity.agentId) {
        throw new ProjectionError(
          'invalid_payload',
          `Task ${task.id} belongs to another agent.`,
        );
      }
      assertSequenceField('activity.atSequence', activity.atSequence, sequence);
      next.activities[activity.id] = activity;
      targets.task(task.id);
      break;
    }

    case 'task.usage_reported': {
      const { taskId, agentId, modelId, provider } = event.payload;
      const task = requireTask(next, taskId);
      if (task.agentId !== agentId) {
        throw new ProjectionError(
          'invalid_payload',
          `Task ${task.id} belongs to another agent.`,
        );
      }
      const before = task.usage?.[modelId];
      next.tasks[task.id] = {
        ...task,
        usage: {
          ...task.usage,
          [modelId]: {
            provider,
            inputTokens: (before?.inputTokens ?? 0) + event.payload.inputTokens,
            outputTokens:
              (before?.outputTokens ?? 0) + event.payload.outputTokens,
            turns: (before?.turns ?? 0) + 1,
          },
        },
      };
      targets.task(task.id);
      break;
    }

    case 'output.produced': {
      const output = event.payload.output;
      assertProject(next, output.projectId);
      if (next.outputs[output.id]) {
        throw new ProjectionError(
          'duplicate_entity',
          `Output ${output.id} exists.`,
        );
      }
      const task = requireTask(next, output.taskId);
      if (task.agentId !== output.agentId) {
        throw new ProjectionError(
          'invalid_payload',
          `Task ${task.id} belongs to another agent.`,
        );
      }
      if (isTerminalTaskState(task.state)) {
        throw new ProjectionError(
          'state_mismatch',
          `Task ${task.id} is ${task.state}; it cannot produce more output.`,
        );
      }
      assertSequenceField(
        'output.producedAtSequence',
        output.producedAtSequence,
        sequence,
      );
      next.outputs[output.id] = output;
      targets.task(output.taskId);
      break;
    }

    case 'proposal.opened': {
      const proposal = event.payload.proposal;
      assertProject(next, proposal.projectId);
      if (next.proposals[proposal.id]) {
        throw new ProjectionError(
          'duplicate_entity',
          `Proposal ${proposal.id} exists.`,
        );
      }
      requireOpenThread(next, proposal.threadId);
      if (proposal.state !== 'open' || proposal.decidedAtSequence) {
        throw new ProjectionError('invalid_payload', 'A new proposal is open.');
      }
      assertSequenceField(
        'proposal.openedAtSequence',
        proposal.openedAtSequence,
        sequence,
      );
      assertSequenceField(
        'proposal.lastSequence',
        proposal.lastSequence,
        sequence,
      );
      if (proposal.kind === 'plan') {
        const plan = requirePlan(next, proposal.payload.planId);
        if (plan.supersededByPlanId || plan.assignedAtSequence) {
          throw new ProjectionError(
            'plan_superseded',
            `Plan ${plan.id} is no longer proposable.`,
          );
        }
        if (plan.proposalId) {
          throw new ProjectionError(
            'duplicate_entity',
            `Plan ${plan.id} already has proposal ${plan.proposalId}.`,
          );
        }
        next.plans[plan.id] = { ...plan, proposalId: proposal.id };
      } else if (proposal.kind === 'change_task_scope') {
        const task = requireTask(next, proposal.payload.taskId);
        if (isTerminalTaskState(task.state)) {
          throw new ProjectionError(
            'state_mismatch',
            `Task ${task.id} is ${task.state}; its scope is frozen.`,
          );
        }
      }
      next.proposals[proposal.id] = proposal;
      targets.thread(proposal.threadId);
      if (proposal.kind === 'change_task_scope')
        targets.task(proposal.payload.taskId);
      break;
    }

    case 'proposal.decided': {
      const proposal = requireProposal(next, event.payload.proposalId);
      if (proposal.state !== event.payload.from) {
        throw new ProjectionError(
          'state_mismatch',
          `Proposal is ${proposal.state}, not open.`,
        );
      }
      assertProposalTransition(proposal.state, event.payload.to);
      next.proposals[proposal.id] = {
        ...proposal,
        state: event.payload.to,
        decidedAtSequence: sequence,
        lastSequence: sequence,
      };
      targets.thread(proposal.threadId);
      if (proposal.kind === 'change_task_scope')
        targets.task(proposal.payload.taskId);
      break;
    }
  }

  targets.assertEnvelope(event);
  targets.apply(sequence);

  next = {
    ...next,
    lastSequence: sequence,
    lastEventId: event.id,
    appliedEventIds: [...next.appliedEventIds, event.id],
  };
  return ProjectProjectionSchema.parse(next);
}

export function replayProjectEvents(
  events: readonly ProjectEvent[],
  initial?: ProjectProjection,
): ProjectProjection {
  let projection = initial;
  for (const event of events) {
    projection = applyProjectEvent(projection, event);
  }
  if (!projection) {
    throw new ProjectionError(
      'missing_project',
      'Cannot replay an empty event stream.',
    );
  }
  return projection;
}
