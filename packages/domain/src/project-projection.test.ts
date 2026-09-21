import { describe, expect, it } from 'vitest';
import {
  EventIdSchema,
  MethodDefinitionSchema,
  ProjectEventSchema,
  ProjectIdSchema,
  type AgentTask,
  type ProjectEvent,
  type ProjectProjection,
  type Proposal,
} from '@harness/contracts';
import {
  applyProjectEvent,
  replayProjectEvents,
  resolveMethod,
} from './project-projection.js';
import { summarizeProject } from './project-summary.js';
import { ProjectionError } from './projections.js';
import { TransitionError } from './transitions.js';

// ---------------------------------------------------------------------------
// Fixture helpers. Sequences and timestamps are deterministic so replay can
// be compared byte for byte.
// ---------------------------------------------------------------------------

const projectId = 'project_policy';
const otherProjectId = 'project_other';
const at = '2026-03-01T00:00:00.000Z';
const coordinatorThread = 'thread_coordinator';

type Meta = {
  threadId?: string;
  agentId?: string;
  taskId?: string;
  source?: ProjectEvent['source'];
};

class Scenario {
  projection: ProjectProjection | undefined;
  readonly events: ProjectEvent[] = [];

  next(): number {
    return (this.projection?.lastSequence ?? 0) + 1;
  }

  build(type: ProjectEvent['type'], payload: unknown, meta: Meta = {}) {
    const sequence = this.next();
    return ProjectEventSchema.parse({
      id: `event_${String(sequence).padStart(3, '0')}`,
      type,
      version: 1,
      sequence,
      occurredAt: at,
      recordedAt: at,
      projectId,
      ...(meta.threadId ? { threadId: meta.threadId } : {}),
      ...(meta.agentId ? { agentId: meta.agentId } : {}),
      ...(meta.taskId ? { taskId: meta.taskId } : {}),
      source: meta.source ?? 'system',
      payload,
    });
  }

  emit(type: ProjectEvent['type'], payload: unknown, meta: Meta = {}) {
    const event = this.build(type, payload, meta);
    this.projection = applyProjectEvent(this.projection, event);
    this.events.push(event);
    return this.projection;
  }

  // Applies an event without committing it to the scenario, for rejections.
  attempt(type: ProjectEvent['type'], payload: unknown, meta: Meta = {}) {
    return () =>
      applyProjectEvent(this.projection, this.build(type, payload, meta));
  }

  get p(): ProjectProjection {
    if (!this.projection) throw new Error('No projection yet.');
    return this.projection;
  }

  // --- Common building blocks -------------------------------------------

  createProject() {
    this.emit('project.created', {
      project: {
        id: projectId,
        name: 'Policy project',
        origin: 'user',
        createdAt: at,
      },
    });
    this.emit(
      'thread.opened',
      {
        thread: {
          id: coordinatorThread,
          projectId,
          kind: 'coordinator',
          state: 'open',
          messageCount: 0,
          lastSequence: this.next(),
        },
      },
      { threadId: coordinatorThread },
    );
    return this;
  }

  addAgent(id: string, name = id, category = 'interface') {
    const threadId = `thread_${id.replace(/^agent_/, '')}`;
    this.emit(
      'thread.opened',
      {
        thread: {
          id: threadId,
          projectId,
          kind: 'agent',
          agentId: id,
          state: 'open',
          messageCount: 0,
          lastSequence: this.next(),
        },
      },
      { threadId, agentId: id },
    );
    this.emit(
      'agent.created',
      {
        agent: {
          id,
          projectId,
          threadId,
          name,
          category,
          work: 'idle',
          taskIds: [],
          createdAtSequence: this.next(),
          lastSequence: this.next(),
        },
      },
      { threadId, agentId: id },
    );
    return threadId;
  }

  task(
    id: string,
    agentId: string,
    overrides: Record<string, unknown> = {},
  ): AgentTask {
    const dependsOn = (overrides.dependsOn as string[] | undefined) ?? [];
    return {
      id,
      projectId,
      agentId,
      title: `Task ${id}`,
      objective: 'Do the thing.',
      category: 'interface',
      skills: [],
      scope: ['apps/client/**'],
      scopeHistory: [],
      dependsOn,
      inputsSatisfied: [],
      expectedOutputs: [],
      requiredChecks: [],
      state: dependsOn.length ? 'waiting' : 'working',
      createdAtSequence: this.next(),
      ...overrides,
    } as unknown as AgentTask;
  }

  assign(id: string, agentId: string, overrides: Record<string, unknown> = {}) {
    return this.emit(
      'task.assigned',
      { task: this.task(id, agentId, overrides) },
      { agentId, taskId: id },
    );
  }

  changeTask(taskId: string, to: string, reason = 'Because.') {
    const task = this.p.tasks[taskId];
    if (!task) throw new Error(`Task ${taskId} missing.`);
    return this.emit(
      'task.state_changed',
      { taskId, from: task.state, to, reason },
      { taskId, agentId: task.agentId },
    );
  }

  // Overrides that bind a task to one immutable plan row.
  row(planId: string, index: number): Record<string, unknown> {
    const plan = this.p.plans[planId];
    const row = plan?.tasks[index];
    if (!row) throw new Error(`Plan ${planId} row ${index} missing.`);
    const upstream = row.dependsOn.map(
      (dependency) =>
        Object.values(this.p.tasks).find(
          (task) => task.planId === planId && task.planTaskIndex === dependency,
        )?.id,
    );
    return {
      planId,
      planTaskIndex: index,
      title: row.title,
      objective: row.objective,
      category: row.category,
      whySeparate: row.whySeparate,
      whyThisAgent: row.whyThisAgent,
      skills: row.skills,
      scope: row.scope,
      expectedOutputs: row.expectedOutputs,
      requiredChecks: row.requiredChecks,
      dependsOn: upstream,
    };
  }

  post(
    threadId: string,
    body: string,
    role = 'user',
    intent = 'chat',
    agentId?: string,
  ) {
    return this.emit(
      'message.posted',
      {
        message: {
          id: `message_${this.next()}`,
          projectId,
          threadId,
          author: {
            role,
            source: role === 'user' ? 'client' : 'simulated_adapter',
            ...(agentId ? { agentId } : {}),
          },
          intent,
          body,
          postedAt: at,
          sequence: this.next(),
        },
      },
      { threadId, source: role === 'user' ? 'user' : 'agent' },
    );
  }

  openAsk(id: string, taskId: string) {
    const task = this.p.tasks[taskId];
    if (!task) throw new Error(`Task ${taskId} missing.`);
    return this.emit(
      'ask.opened',
      {
        ask: {
          id,
          projectId,
          agentId: task.agentId,
          taskId,
          action: 'Write a fixture',
          reason: 'One bounded write.',
          scope: 'apps/service/**',
          consequences: 'No real files change.',
          state: 'open',
          openedAtSequence: this.next(),
        },
      },
      { taskId, agentId: task.agentId, source: 'agent' },
    );
  }

  check(id: string, taskId: string, name: string, retryOf?: string) {
    const task = this.p.tasks[taskId];
    if (!task) throw new Error(`Task ${taskId} missing.`);
    return this.emit(
      'check.started',
      {
        check: {
          id,
          projectId,
          agentId: task.agentId,
          taskId,
          name,
          state: 'running',
          ...(retryOf ? { retryOf } : {}),
          startedAtSequence: this.next(),
        },
      },
      { taskId, agentId: task.agentId, source: 'agent' },
    );
  }

  finishCheck(checkId: string, to: 'passed' | 'failed' | 'stopped') {
    const check = this.p.checks[checkId];
    if (!check) throw new Error(`Check ${checkId} missing.`);
    return this.emit(
      'check.finished',
      { checkId, from: 'running', to, summary: `${to}.` },
      { taskId: check.taskId, agentId: check.agentId, source: 'agent' },
    );
  }

  output(id: string, taskId: string) {
    const task = this.p.tasks[taskId];
    if (!task) throw new Error(`Task ${taskId} missing.`);
    return this.emit(
      'output.produced',
      {
        output: {
          id,
          projectId,
          agentId: task.agentId,
          taskId,
          kind: 'contract',
          title: 'Contract',
          digest: 'sha256:x',
          producedAtSequence: this.next(),
        },
      },
      { taskId, agentId: task.agentId, source: 'agent' },
    );
  }

  plan(id: string, version: number, supersedesPlanId?: string, count = 2) {
    return this.emit('plan.recorded', {
      plan: {
        id,
        projectId,
        version,
        request: 'Build it.',
        tasks: Array.from({ length: count }, (_, index) => ({
          title: `Plan task ${index + 1}`,
          objective: 'Build it.',
          agentName: index === 0 ? 'Interface' : 'Backend',
          category: index === 0 ? 'interface' : 'orchestration',
          whySeparate: 'Different boundary.',
          whyThisAgent: 'Owns the boundary.',
          skills: [],
          scope: [],
          dependsOn: index === 0 ? [] : [index - 1],
          expectedOutputs: [],
          requiredChecks: [],
        })),
        whyThisMany: 'Two boundaries.',
        ...(supersedesPlanId ? { supersedesPlanId } : {}),
        recordedAtSequence: this.next(),
      },
    });
  }

  proposal(id: string, kind: Proposal['kind'], payload: unknown) {
    return this.emit(
      'proposal.opened',
      {
        proposal: {
          id,
          projectId,
          threadId: coordinatorThread,
          kind,
          payload,
          title: `Proposal ${id}`,
          summary: 'Summary.',
          state: 'open',
          consequences: {
            effects: [],
            reversible: true,
            touchesRepository: false,
          },
          openedAtSequence: this.next(),
          lastSequence: this.next(),
        },
      },
      { threadId: coordinatorThread, source: 'coordinator' },
    );
  }

  decide(proposalId: string, to: 'approved' | 'denied' | 'dismissed') {
    return this.emit(
      'proposal.decided',
      { proposalId, from: 'open', to },
      { threadId: coordinatorThread, source: 'user' },
    );
  }
}

const method = MethodDefinitionSchema.parse({
  id: 'method_evidence',
  version: '1.0.0',
  title: 'Evidence-led delivery',
  purpose: 'Close work only with visible evidence.',
  whenToUse: 'Any project that ships to users.',
  hardRules: ['Projection is authoritative.'],
  preferences: ['Small diffs.'],
  promptGuidance: [],
  skills: ['contract-check'],
  outputExpectations: ['A diff summary.'],
  checks: ['contract-check'],
  scopeRestrictions: [],
});

function code(expected: ProjectionError['code']) {
  return expect.objectContaining<Partial<ProjectionError>>({ code: expected });
}

function transition(expected: TransitionError['code']) {
  return expect.objectContaining<Partial<TransitionError>>({ code: expected });
}

// ---------------------------------------------------------------------------

describe('project stream basics', () => {
  it('starts with project.created, replays idempotently, and rejects gaps', () => {
    const s = new Scenario();
    expect(
      s.attempt('thread.closed', { threadId: coordinatorThread, reason: 'x' }),
    ).toThrowError(code('missing_project'));
    s.createProject();
    const first = s.events[0]!;
    expect(applyProjectEvent(s.p, first)).toBe(s.p);
    expect(() =>
      applyProjectEvent(s.p, {
        ...s.events[1]!,
        id: EventIdSchema.parse('event_collision'),
      }),
    ).toThrowError(code('sequence_collision'));
    expect(() =>
      applyProjectEvent(s.p, {
        ...s.build('thread.closed', {
          threadId: coordinatorThread,
          reason: 'x',
        }),
        sequence: 9,
      }),
    ).toThrowError(code('sequence_gap'));
    expect(() =>
      applyProjectEvent(s.p, {
        ...s.build('thread.closed', {
          threadId: coordinatorThread,
          reason: 'x',
        }),
        projectId: ProjectIdSchema.parse(otherProjectId),
      }),
    ).toThrowError(code('project_mismatch'));
  });

  it('keeps no message bodies and allows exactly one coordinator thread', () => {
    const s = new Scenario().createProject();
    expect(
      s.attempt('thread.opened', {
        thread: {
          id: 'thread_second',
          projectId,
          kind: 'coordinator',
          state: 'open',
          messageCount: 0,
          lastSequence: s.next(),
        },
      }),
    ).toThrowError(code('duplicate_entity'));
    s.post(coordinatorThread, 'What are we building?', 'coordinator');
    s.post(coordinatorThread, 'A preferences form.');
    expect(s.p.threads[coordinatorThread]?.messageCount).toBe(2);
    expect(JSON.stringify(s.p)).not.toContain('preferences form');
    expect(s.p.threads[coordinatorThread]?.lastSequence).toBe(s.p.lastSequence);
  });

  it('rejects cross-project entities and messages in closed threads', () => {
    const s = new Scenario().createProject();
    const threadId = s.addAgent('agent_a');
    expect(
      s.attempt(
        'task.assigned',
        {
          task: s.task('task_x', 'agent_a', {
            projectId: otherProjectId,
          } as never),
        },
        { agentId: 'agent_a', taskId: 'task_x' },
      ),
    ).toThrowError(code('project_mismatch'));
    s.emit('thread.closed', { threadId, reason: 'Archived.' }, { threadId });
    expect(() => s.post(threadId, 'hello')).toThrowError(code('thread_closed'));
    expect(
      s.attempt('thread.closed', { threadId, reason: 'Again.' }, { threadId }),
    ).toThrowError(transition('terminal_state'));
  });
});

describe('messages and work are separate', () => {
  it('an ordinary message never creates a task; only the user can start work', () => {
    const s = new Scenario().createProject();
    const threadId = s.addAgent('agent_a');
    s.post(threadId, 'What changed?');
    s.post(threadId, 'Nothing yet.', 'agent', 'chat', 'agent_a');
    expect(Object.keys(s.p.tasks)).toEqual([]);
    expect(s.p.agents.agent_a?.work).toBe('idle');
    expect(() =>
      s.post(threadId, 'Go build it', 'agent', 'start_work', 'agent_a'),
    ).toThrowError(code('invalid_payload'));
    s.post(threadId, 'Go build it', 'user', 'start_work');
    // Still no task: the reducer records intent, the service creates work.
    expect(Object.keys(s.p.tasks)).toEqual([]);
  });

  it('an agent may only post in its own thread', () => {
    const s = new Scenario().createProject();
    const threadA = s.addAgent('agent_a');
    s.addAgent('agent_b');
    expect(() =>
      s.post(threadA, 'Hi from B', 'agent', 'chat', 'agent_b'),
    ).toThrowError(code('invalid_payload'));
    // The coordinator thread accepts agent pointers.
    s.post(coordinatorThread, 'Handed off.', 'agent', 'chat', 'agent_a');
  });
});

describe('agent, task, and work lifecycles', () => {
  it('assigns work, mirrors task state on the agent, and rejects a second task while busy', () => {
    const s = new Scenario().createProject();
    s.addAgent('agent_a');
    s.assign('task_1', 'agent_a');
    expect(s.p.agents.agent_a).toMatchObject({
      work: 'working',
      currentTaskId: 'task_1',
      taskIds: ['task_1'],
    });
    expect(() => s.assign('task_2', 'agent_a')).toThrowError(
      code('agent_busy'),
    );
    s.openAsk('ask_1', 'task_1');
    s.changeTask('task_1', 'needs_you');
    expect(s.p.agents.agent_a?.work).toBe('needs_you');
    expect(() => s.assign('task_2', 'agent_a')).toThrowError(
      code('agent_busy'),
    );
  });

  it('keeps the conversation open after done, stopped, or failed, and starts new work explicitly', () => {
    const s = new Scenario().createProject();
    const threadId = s.addAgent('agent_a');
    s.assign('task_1', 'agent_a');
    s.output('output_1', 'task_1');
    s.changeTask('task_1', 'stopped', 'User stopped it.');
    expect(s.p.agents.agent_a?.work).toBe('stopped');
    expect(s.p.threads[threadId]?.state).toBe('open');
    expect(s.p.outputs.output_1).toBeDefined();
    expect(s.p.tasks.task_1).toMatchObject({ endReason: 'User stopped it.' });
    s.post(threadId, 'Why did you stop?');
    s.assign('task_2', 'agent_a');
    expect(s.p.agents.agent_a).toMatchObject({
      work: 'working',
      currentTaskId: 'task_2',
      taskIds: ['task_1', 'task_2'],
    });
    s.changeTask('task_2', 'failed');
    s.assign('task_3', 'agent_a');
    s.changeTask('task_3', 'done');
    s.assign('task_4', 'agent_a');
    expect(s.p.agents.agent_a?.work).toBe('working');
    expect(() => s.changeTask('task_1', 'working')).toThrowError(
      transition('terminal_state'),
    );
  });

  it('will not stop or finish a task while its ask is open', () => {
    const s = new Scenario().createProject();
    s.addAgent('agent_a');
    s.assign('task_1', 'agent_a');
    s.openAsk('ask_1', 'task_1');
    s.changeTask('task_1', 'needs_you');
    expect(() => s.changeTask('task_1', 'stopped')).toThrowError(
      code('ask_open'),
    );
    expect(() => s.openAsk('ask_2', 'task_1')).toThrowError(
      code('state_mismatch'),
    );
    s.emit(
      'ask.decided',
      { askId: 'ask_1', from: 'open', to: 'closed', note: 'Stopped.' },
      { taskId: 'task_1', agentId: 'agent_a', source: 'user' },
    );
    expect(
      s.attempt(
        'ask.decided',
        { askId: 'ask_1', from: 'open', to: 'approved' },
        { taskId: 'task_1', agentId: 'agent_a', source: 'user' },
      ),
    ).toThrowError(code('state_mismatch'));
    s.changeTask('task_1', 'stopped');
    expect(s.p.asks.ask_1?.state).toBe('closed');
    expect(s.p.agents.agent_a?.work).toBe('stopped');
  });

  it('requires passing evidence for every required check, with retries superseding', () => {
    const s = new Scenario().createProject();
    s.addAgent('agent_a');
    s.assign('task_1', 'agent_a', { requiredChecks: ['contract-check'] });
    expect(() => s.changeTask('task_1', 'done')).toThrowError(
      code('completion_blocked'),
    );
    s.check('check_1', 'task_1', 'contract-check');
    s.finishCheck('check_1', 'failed');
    expect(() => s.changeTask('task_1', 'done')).toThrowError(
      code('completion_blocked'),
    );
    expect(summarizeProject(s.p).attention).toMatchObject({
      kind: 'check_failed',
      checkId: 'check_1',
    });
    s.check('check_2', 'task_1', 'contract-check', 'check_1');
    s.finishCheck('check_2', 'passed');
    s.changeTask('task_1', 'done');
    expect(s.p.agents.agent_a?.work).toBe('done');
    expect(
      s.attempt(
        'check.finished',
        { checkId: 'check_2', from: 'running', to: 'passed', summary: 'x' },
        { taskId: 'task_1', agentId: 'agent_a' },
      ),
    ).toThrowError(code('state_mismatch'));
  });

  it('gates handoffs on a finished upstream output', () => {
    const s = new Scenario().createProject();
    s.addAgent('agent_a');
    s.addAgent('agent_b', 'Backend', 'orchestration');
    s.assign('task_a', 'agent_a');
    s.assign('task_b', 'agent_b', { dependsOn: ['task_a'] });
    expect(s.p.agents.agent_b?.work).toBe('waiting');
    expect(() => s.changeTask('task_b', 'working')).toThrowError(
      code('inputs_missing'),
    );
    s.output('output_a', 'task_a');
    expect(
      s.attempt(
        'task.input_satisfied',
        { taskId: 'task_b', upstreamTaskId: 'task_a', outputId: 'output_a' },
        { taskId: 'task_b', agentId: 'agent_b' },
      ),
    ).toThrowError(code('inputs_missing'));
    s.changeTask('task_a', 'done');
    s.emit(
      'task.input_satisfied',
      { taskId: 'task_b', upstreamTaskId: 'task_a', outputId: 'output_a' },
      { taskId: 'task_b', agentId: 'agent_b' },
    );
    expect(
      s.attempt(
        'task.input_satisfied',
        { taskId: 'task_b', upstreamTaskId: 'task_a', outputId: 'output_a' },
        { taskId: 'task_b', agentId: 'agent_b' },
      ),
    ).toThrowError(code('duplicate_entity'));
    s.changeTask('task_b', 'working');
    expect(s.p.agents.agent_b?.work).toBe('working');
  });

  it('tracks a last sequence per agent so panes stay independent', () => {
    const s = new Scenario().createProject();
    const threadA = s.addAgent('agent_a');
    s.addAgent('agent_b');
    s.assign('task_a', 'agent_a');
    const before = s.p.agents.agent_b!.lastSequence;
    s.post(threadA, 'Keep going');
    s.assign('task_b', 'agent_b');
    expect(s.p.agents.agent_b?.lastSequence).toBe(s.p.lastSequence);
    s.changeTask('task_a', 'done');
    expect(s.p.agents.agent_b?.lastSequence).not.toBe(s.p.lastSequence);
    expect(s.p.agents.agent_b?.lastSequence).toBeGreaterThan(before);
  });
});

describe('plans and proposals', () => {
  it('supersedes an earlier plan and only assigns the approved current one', () => {
    const s = new Scenario().createProject();
    s.plan('plan_v1', 1);
    s.proposal('proposal_1', 'plan', { planId: 'plan_v1' });
    expect(s.p.plans.plan_v1?.proposalId).toBe('proposal_1');
    expect(() => s.plan('plan_bad', 2)).toThrowError(code('plan_conflict'));
    s.plan('plan_v2', 2, 'plan_v1');
    expect(s.p.plans.plan_v1?.supersededByPlanId).toBe('plan_v2');
    expect(s.p.proposals.proposal_1?.state).toBe('superseded');
    expect(() => s.decide('proposal_1', 'approved')).toThrowError(
      code('state_mismatch'),
    );
    expect(
      s.attempt('plan.assigned', {
        planId: 'plan_v1',
        proposalId: 'proposal_1',
      }),
    ).toThrowError(code('plan_superseded'));
    s.proposal('proposal_2', 'plan', { planId: 'plan_v2' });
    expect(
      s.attempt('plan.assigned', {
        planId: 'plan_v2',
        proposalId: 'proposal_2',
      }),
    ).toThrowError(code('not_approved'));
    s.decide('proposal_2', 'approved');
    expect(() => s.decide('proposal_2', 'denied')).toThrowError(
      code('state_mismatch'),
    );
    s.addAgent('agent_a', 'Interface');
    s.addAgent('agent_b', 'Backend', 'orchestration');
    s.assign('task_1', 'agent_a', s.row('plan_v2', 0));
    expect(
      s.attempt('plan.assigned', {
        planId: 'plan_v2',
        proposalId: 'proposal_2',
      }),
    ).toThrowError(code('plan_incomplete'));
    s.assign('task_2', 'agent_b', {
      ...s.row('plan_v2', 1),
      dependsOn: ['task_1'],
    });
    s.emit('plan.assigned', { planId: 'plan_v2', proposalId: 'proposal_2' });
    expect(s.p.plans.plan_v2?.assignedAtSequence).toBe(s.p.lastSequence);
    expect(
      s.attempt('plan.assigned', {
        planId: 'plan_v2',
        proposalId: 'proposal_2',
      }),
    ).toThrowError(code('duplicate_entity'));
    expect(() =>
      s.assign('task_3', 'agent_a', s.row('plan_v2', 0)),
    ).toThrowError(code('agent_busy'));
  });

  it('assigns a plan directly when no proposal was opened, and dismissal is real', () => {
    const s = new Scenario().createProject();
    s.plan('plan_v1', 1, undefined, 1);
    s.addAgent('agent_a', 'Interface');
    s.assign('task_1', 'agent_a', s.row('plan_v1', 0));
    s.emit('plan.assigned', { planId: 'plan_v1' });
    s.proposal('proposal_m', 'set_method', {
      catalogId: method.id,
      catalogVersion: method.version,
    });
    s.decide('proposal_m', 'dismissed');
    expect(s.p.proposals.proposal_m?.state).toBe('dismissed');
    expect(s.p.method).toBeNull();
  });

  it('changes scope only through an approved structured proposal', () => {
    const s = new Scenario().createProject();
    s.addAgent('agent_a');
    s.assign('task_1', 'agent_a');
    const change = {
      taskId: 'task_1',
      proposalId: 'proposal_s',
      scope: ['apps/service/**'],
    };
    expect(
      s.attempt('task.scope_changed', change, {
        taskId: 'task_1',
        agentId: 'agent_a',
      }),
    ).toThrowError(code('missing_entity'));
    s.proposal('proposal_s', 'change_task_scope', {
      taskId: 'task_1',
      scope: ['apps/service/**'],
    });
    expect(
      s.attempt('task.scope_changed', change, {
        taskId: 'task_1',
        agentId: 'agent_a',
      }),
    ).toThrowError(code('not_approved'));
    s.decide('proposal_s', 'approved');
    s.emit('task.scope_changed', change, {
      taskId: 'task_1',
      agentId: 'agent_a',
    });
    expect(s.p.tasks.task_1?.scope).toEqual(['apps/service/**']);
    expect(
      s.attempt('task.scope_changed', change, {
        taskId: 'task_1',
        agentId: 'agent_a',
      }),
    ).toThrowError(code('duplicate_entity'));
  });

  it('records a brief request once per approved proposal', () => {
    const s = new Scenario().createProject();
    const payload = {
      text: 'Only touch apps/client',
      category: 'scope',
      keywordsMatched: ['only touch'],
    };
    s.proposal('proposal_r', 'record_request', payload);
    s.decide('proposal_r', 'approved');
    const request = {
      id: 'request_1',
      text: payload.text,
      category: 'scope',
      proposalId: 'proposal_r',
      recordedAtSequence: s.next(),
    };
    s.emit('brief.request_recorded', { request });
    expect(s.p.brief.requests).toHaveLength(1);
    expect(
      s.attempt('brief.request_recorded', {
        request: { ...request, id: 'request_2', recordedAtSequence: s.next() },
      }),
    ).toThrowError(code('duplicate_entity'));
  });
});

describe('brief and method', () => {
  it('moves brief fields through inferred, confirmed, corrected, and skipped', () => {
    const s = new Scenario().createProject();
    const update = (fieldId: string, to: string, value?: string) =>
      s.emit('brief.field_updated', {
        fieldId,
        to,
        ...(value ? { value } : {}),
        source: 'user',
      });
    update('goal', 'inferred', 'Ship preferences');
    update('goal', 'confirmed', 'Ship preferences');
    expect(() => update('goal', 'inferred', 'x')).toThrowError(
      transition('invalid_transition'),
    );
    update('goal', 'corrected', 'Ship account preferences');
    expect(() => update('scope', 'confirmed')).toThrowError(
      code('invalid_payload'),
    );
    update('scope', 'skipped');
    update('doneMeans', 'confirmed', 'Form saves.');
    expect(s.p.brief.version).toBe(5);
    expect(summarizeProject(s.p).briefReady).toBe(true);
  });

  it('pins a method snapshot per task that later overrides never change', () => {
    const s = new Scenario().createProject();
    s.addAgent('agent_a');
    s.assign('task_1', 'agent_a');
    expect(
      s.attempt('method.snapshot_pinned', {
        snapshot: {
          id: 'methodsnap_1',
          taskId: 'task_1',
          resolved: method,
          methodVersion: 1,
          pinnedAtSequence: s.next(),
        },
      }),
    ).toThrowError(code('missing_entity'));
    s.emit('method.applied', { definition: method });
    expect(
      s.attempt('method.snapshot_pinned', {
        snapshot: {
          id: 'methodsnap_1',
          taskId: 'task_1',
          resolved: { ...method, hardRules: ['tampered'] },
          methodVersion: 1,
          pinnedAtSequence: s.next(),
        },
      }),
    ).toThrowError(code('snapshot_mismatch'));
    s.emit('method.snapshot_pinned', {
      snapshot: {
        id: 'methodsnap_1',
        taskId: 'task_1',
        resolved: resolveMethod(s.p.method!),
        methodVersion: 1,
        pinnedAtSequence: s.next(),
      },
    });
    expect(s.p.tasks.task_1?.methodSnapshotId).toBe('methodsnap_1');
    s.emit('method.override_recorded', {
      sectionId: 'hardRules',
      value: ['Projection is authoritative.', 'No network calls.'],
    });
    expect(s.p.method?.version).toBe(2);
    expect(resolveMethod(s.p.method!).hardRules).toHaveLength(2);
    expect(s.p.methodSnapshots.methodsnap_1?.resolved.hardRules).toEqual([
      'Projection is authoritative.',
    ]);
    // Reset to catalog clears every override and bumps the version.
    s.emit('method.overrides_cleared', {});
    expect(s.p.method?.overrides).toEqual([]);
    expect(s.p.method?.version).toBe(3);
    expect(resolveMethod(s.p.method!).hardRules).toEqual(method.hardRules);
    expect(s.attempt('method.overrides_cleared', {})).toThrowError(
      code('invalid_payload'),
    );
    expect(
      s.attempt('method.snapshot_pinned', {
        snapshot: {
          id: 'methodsnap_2',
          taskId: 'task_1',
          resolved: resolveMethod(s.p.method!),
          methodVersion: 2,
          pinnedAtSequence: s.next(),
        },
      }),
    ).toThrowError(code('snapshot_mismatch'));
  });
});

describe('plan document', () => {
  it('starts empty, records section edits with their source, and rejects no-ops', () => {
    const s = new Scenario().createProject();
    expect(s.p.planDocument).toEqual({ sections: {}, lastSequence: 1 });
    s.emit('plan.section_edited', {
      sectionId: 'features',
      lines: ['Offline sync', 'Shared lists'],
      source: 'user',
    });
    expect(s.p.planDocument.sections.features).toEqual({
      lines: ['Offline sync', 'Shared lists'],
      source: 'user',
      updatedAtSequence: s.p.lastSequence,
    });
    expect(s.p.planDocument.lastSequence).toBe(s.p.lastSequence);
    expect(
      s.attempt('plan.section_edited', {
        sectionId: 'features',
        lines: ['Offline sync', 'Shared lists'],
        source: 'coordinator',
      }),
    ).toThrowError(code('invalid_payload'));
    s.emit('plan.section_edited', {
      sectionId: 'features',
      lines: [],
      source: 'coordinator',
    });
    expect(s.p.planDocument.sections.features?.lines).toEqual([]);
    expect(s.p.planDocument.sections.features?.source).toBe('coordinator');
    expect(s.p.planDocument.sections.ui).toBeUndefined();
  });
});

describe('right-now summary', () => {
  it('derives status and attention deterministically through a project lifetime', () => {
    const s = new Scenario().createProject();
    expect(summarizeProject(s.p)).toMatchObject({
      status: 'intake',
      attention: { kind: 'intake' },
    });
    for (const fieldId of ['goal', 'scope', 'doneMeans']) {
      s.emit('brief.field_updated', {
        fieldId,
        to: 'confirmed',
        value: 'v',
        source: 'user',
      });
    }
    expect(summarizeProject(s.p).status).toBe('idle');
    s.plan('plan_v1', 1);
    s.proposal('proposal_1', 'plan', { planId: 'plan_v1' });
    expect(summarizeProject(s.p)).toMatchObject({
      status: 'planning',
      attention: { kind: 'proposal', proposalId: 'proposal_1' },
    });
    s.decide('proposal_1', 'approved');
    s.addAgent('agent_a', 'Interface');
    s.addAgent('agent_b', 'Backend', 'orchestration');
    s.assign('task_1', 'agent_a', s.row('plan_v1', 0));
    s.assign('task_2', 'agent_b', {
      ...s.row('plan_v1', 1),
      dependsOn: ['task_1'],
    });
    s.emit('plan.assigned', { planId: 'plan_v1', proposalId: 'proposal_1' });
    const working = summarizeProject(s.p);
    expect(working).toMatchObject({
      status: 'working',
      agentCounts: { working: 1, waiting: 1 },
    });
    expect(working.attention).toBeUndefined();
    s.openAsk('ask_1', 'task_1');
    s.changeTask('task_1', 'needs_you');
    expect(summarizeProject(s.p)).toMatchObject({
      status: 'needs_you',
      openAskIds: ['ask_1'],
      attention: { kind: 'ask', askId: 'ask_1', agentId: 'agent_a' },
    });
    s.emit(
      'ask.decided',
      { askId: 'ask_1', from: 'open', to: 'approved' },
      { taskId: 'task_1', agentId: 'agent_a', source: 'user' },
    );
    s.changeTask('task_1', 'working');
    s.output('output_1', 'task_1');
    s.changeTask('task_1', 'done');
    s.emit(
      'task.input_satisfied',
      { taskId: 'task_2', upstreamTaskId: 'task_1', outputId: 'output_1' },
      { taskId: 'task_2', agentId: 'agent_b' },
    );
    s.changeTask('task_2', 'working');
    s.changeTask('task_2', 'stopped');
    expect(summarizeProject(s.p)).toMatchObject({
      status: 'partially_stopped',
      agentCounts: { done: 1, stopped: 1 },
    });
    s.assign('task_3', 'agent_b');
    s.changeTask('task_3', 'done');
    expect(summarizeProject(s.p).status).toBe('idle');
    const twice = summarizeProject(s.p);
    expect(twice).toEqual(summarizeProject(s.p));
  });

  it('is complete when every task is done', () => {
    const s = new Scenario().createProject();
    s.addAgent('agent_a');
    s.assign('task_1', 'agent_a');
    s.changeTask('task_1', 'done');
    expect(summarizeProject(s.p).status).toBe('complete');
  });

  it('only raises failed-check attention for checks required by the task', () => {
    const s = new Scenario().createProject();
    s.addAgent('agent_a');
    s.assign('task_1', 'agent_a', {
      requiredChecks: ['contract-check'],
    });
    s.check('check_optional', 'task_1', 'optional-diagnostic');
    s.finishCheck('check_optional', 'failed');
    expect(summarizeProject(s.p)).toMatchObject({ status: 'working' });
    expect(summarizeProject(s.p).attention).toBeUndefined();

    s.check('check_required', 'task_1', 'contract-check');
    s.finishCheck('check_required', 'failed');
    expect(summarizeProject(s.p)).toMatchObject({
      status: 'reviewing',
      attention: { kind: 'check_failed', checkId: 'check_required' },
    });
  });
});

describe('replay', () => {
  it('rebuilds the same projection from the event log', () => {
    const s = new Scenario().createProject();
    s.emit('method.applied', { definition: method });
    s.addAgent('agent_a');
    s.addAgent('agent_b', 'Backend', 'orchestration');
    s.assign('task_1', 'agent_a', { requiredChecks: ['contract-check'] });
    s.emit('method.snapshot_pinned', {
      snapshot: {
        id: 'methodsnap_1',
        taskId: 'task_1',
        resolved: resolveMethod(s.p.method!),
        methodVersion: 1,
        pinnedAtSequence: s.next(),
      },
    });
    s.post('thread_a', 'Start with the contract.');
    s.check('check_1', 'task_1', 'contract-check');
    s.finishCheck('check_1', 'passed');
    s.output('output_1', 'task_1');
    s.changeTask('task_1', 'done');
    expect(replayProjectEvents(s.events)).toEqual(s.p);
    expect(
      replayProjectEvents(
        s.events.slice(3),
        replayProjectEvents(s.events.slice(0, 3)),
      ),
    ).toEqual(s.p);
  });
});

describe('exact plan-to-task mapping', () => {
  function planned() {
    const s = new Scenario().createProject();
    s.plan('plan_v1', 1);
    s.addAgent('agent_a', 'Interface');
    s.addAgent('agent_b', 'Backend', 'orchestration');
    return s;
  }

  it('requires a valid plan row and a matching task', () => {
    const s = planned();
    expect(() =>
      s.assign('task_x', 'agent_a', { planId: 'plan_v1', planTaskIndex: 7 }),
    ).toThrowError(code('invalid_payload'));
    expect(() =>
      s.assign('task_x', 'agent_a', { planId: 'plan_v1' }),
    ).toThrowError();
    expect(() =>
      s.assign('task_x', 'agent_a', {
        ...s.row('plan_v1', 0),
        title: 'Something else entirely',
      }),
    ).toThrowError(code('invalid_payload'));
  });

  it('rejects a duplicate row, a missing row, and substitution under the same plan id', () => {
    const s = planned();
    s.assign('task_1', 'agent_a', s.row('plan_v1', 0));
    expect(() =>
      s.assign('task_dup', 'agent_b', s.row('plan_v1', 0)),
    ).toThrowError(code('duplicate_entity'));
    // Row 1 missing.
    expect(s.attempt('plan.assigned', { planId: 'plan_v1' })).toThrowError(
      code('plan_incomplete'),
    );
    // A second task on the same plan id but bound to row 0 again is refused
    // above, so the only way to complete the plan is row 1 exactly.
    s.assign('task_2', 'agent_b', {
      ...s.row('plan_v1', 1),
      dependsOn: ['task_1'],
    });
    s.emit('plan.assigned', { planId: 'plan_v1' });
    expect(s.p.plans.plan_v1?.assignedAtSequence).toBe(s.p.lastSequence);
    expect(s.p.agents.agent_a?.lastSequence).toBe(s.p.lastSequence);
    expect(s.p.agents.agent_b?.lastSequence).toBe(s.p.lastSequence);
  });
});

describe('reducer-owned target sequences', () => {
  function working() {
    const s = new Scenario().createProject();
    const threadA = s.addAgent('agent_a');
    const threadB = s.addAgent('agent_b', 'Backend', 'orchestration');
    s.assign('task_a', 'agent_a');
    s.assign('task_b', 'agent_b', { dependsOn: ['task_a'] });
    return { s, threadA, threadB };
  }

  it('updates the affected agent from the payload alone', () => {
    const { s } = working();
    const bare = (type: ProjectEvent['type'], payload: unknown) =>
      s.emit(type, payload);

    bare('ask.opened', {
      ask: {
        id: 'ask_1',
        projectId,
        agentId: 'agent_a',
        taskId: 'task_a',
        action: 'Write',
        reason: 'r',
        scope: 's',
        consequences: 'c',
        state: 'open',
        openedAtSequence: s.next(),
      },
    });
    expect(s.p.agents.agent_a?.lastSequence).toBe(s.p.lastSequence);
    const untouched = s.p.agents.agent_b!.lastSequence;

    bare('ask.decided', { askId: 'ask_1', from: 'open', to: 'approved' });
    expect(s.p.agents.agent_a?.lastSequence).toBe(s.p.lastSequence);

    bare('check.started', {
      check: {
        id: 'check_1',
        projectId,
        agentId: 'agent_a',
        taskId: 'task_a',
        name: 'contract-check',
        state: 'running',
        startedAtSequence: s.next(),
      },
    });
    expect(s.p.agents.agent_a?.lastSequence).toBe(s.p.lastSequence);
    bare('check.finished', {
      checkId: 'check_1',
      from: 'running',
      to: 'passed',
      summary: 'ok',
    });
    expect(s.p.agents.agent_a?.lastSequence).toBe(s.p.lastSequence);

    bare('output.produced', {
      output: {
        id: 'output_a',
        projectId,
        agentId: 'agent_a',
        taskId: 'task_a',
        kind: 'contract',
        title: 'Contract',
        digest: 'sha256:x',
        producedAtSequence: s.next(),
      },
    });
    expect(s.p.agents.agent_a?.lastSequence).toBe(s.p.lastSequence);
    expect(s.p.agents.agent_b?.lastSequence).toBe(untouched);

    bare('task.state_changed', {
      taskId: 'task_a',
      from: 'working',
      to: 'done',
      reason: 'Finished.',
    });
    bare('task.input_satisfied', {
      taskId: 'task_b',
      upstreamTaskId: 'task_a',
      outputId: 'output_a',
    });
    expect(s.p.agents.agent_b?.lastSequence).toBe(s.p.lastSequence);

    s.proposal('proposal_s', 'change_task_scope', {
      taskId: 'task_b',
      scope: ['apps/service/**'],
    });
    expect(s.p.threads[coordinatorThread]?.lastSequence).toBe(s.p.lastSequence);
    bare('proposal.decided', {
      proposalId: 'proposal_s',
      from: 'open',
      to: 'approved',
    });
    expect(s.p.threads[coordinatorThread]?.lastSequence).toBe(s.p.lastSequence);
    expect(s.p.agents.agent_b?.lastSequence).toBe(s.p.lastSequence);
    bare('task.scope_changed', {
      taskId: 'task_b',
      proposalId: 'proposal_s',
      scope: ['apps/service/**'],
    });
    expect(s.p.agents.agent_b?.lastSequence).toBe(s.p.lastSequence);
  });

  it('touches a closed thread and its agent, and rejects mismatched envelope ids', () => {
    const { s, threadA, threadB } = working();
    s.emit('thread.closed', { threadId: threadB, reason: 'Archived.' });
    expect(s.p.threads[threadB]?.lastSequence).toBe(s.p.lastSequence);
    expect(s.p.agents.agent_b?.lastSequence).toBe(s.p.lastSequence);

    expect(
      s.attempt(
        'ask.opened',
        {
          ask: {
            id: 'ask_1',
            projectId,
            agentId: 'agent_a',
            taskId: 'task_a',
            action: 'Write',
            reason: 'r',
            scope: 's',
            consequences: 'c',
            state: 'open',
            openedAtSequence: s.next(),
          },
        },
        { agentId: 'agent_b' },
      ),
    ).toThrowError(code('invalid_payload'));
    expect(
      s.attempt(
        'task.state_changed',
        { taskId: 'task_a', from: 'working', to: 'done', reason: 'x' },
        { taskId: 'task_b' },
      ),
    ).toThrowError(code('invalid_payload'));
    expect(
      s.attempt(
        'thread.closed',
        { threadId: threadA, reason: 'x' },
        { threadId: coordinatorThread },
      ),
    ).toThrowError(code('invalid_payload'));
    expect(() => s.post(coordinatorThread, 'hi', 'user', 'chat')).not.toThrow();
  });
});

describe('scope proposals apply once', () => {
  it('rejects replaying proposal A after proposal B changed the scope again', () => {
    const s = new Scenario().createProject();
    s.addAgent('agent_a');
    s.assign('task_1', 'agent_a');
    s.proposal('proposal_a', 'change_task_scope', {
      taskId: 'task_1',
      scope: ['x/**'],
    });
    s.decide('proposal_a', 'approved');
    s.emit('task.scope_changed', {
      taskId: 'task_1',
      proposalId: 'proposal_a',
      scope: ['x/**'],
    });
    s.proposal('proposal_b', 'change_task_scope', {
      taskId: 'task_1',
      scope: ['y/**'],
    });
    s.decide('proposal_b', 'approved');
    s.emit('task.scope_changed', {
      taskId: 'task_1',
      proposalId: 'proposal_b',
      scope: ['y/**'],
    });
    expect(s.p.tasks.task_1?.scope).toEqual(['y/**']);
    expect(
      s.p.tasks.task_1?.scopeHistory.map((entry) => entry.proposalId),
    ).toEqual(['proposal_a', 'proposal_b']);
    expect(
      s.attempt('task.scope_changed', {
        taskId: 'task_1',
        proposalId: 'proposal_a',
        scope: ['x/**'],
      }),
    ).toThrowError(code('duplicate_entity'));
  });
});

describe('message references', () => {
  function postWithRefs(s: Scenario, refs: Record<string, unknown>) {
    return s.attempt(
      'message.posted',
      {
        message: {
          id: `message_${s.next()}`,
          projectId,
          threadId: coordinatorThread,
          author: { role: 'coordinator', source: 'service' },
          intent: 'chat',
          body: 'Pointer.',
          refs,
          postedAt: at,
          sequence: s.next(),
        },
      },
      { threadId: coordinatorThread },
    );
  }

  it('rejects dangling and mis-owned references', () => {
    const s = new Scenario().createProject();
    s.addAgent('agent_a');
    s.addAgent('agent_b', 'Backend', 'orchestration');
    s.assign('task_a', 'agent_a');
    s.assign('task_b', 'agent_b');
    s.openAsk('ask_a', 'task_a');
    s.check('check_b', 'task_b', 'contract-check');
    s.output('output_b', 'task_b');

    expect(postWithRefs(s, { askId: 'ask_nope' })).toThrowError(
      code('missing_entity'),
    );
    expect(postWithRefs(s, { checkId: 'check_nope' })).toThrowError(
      code('missing_entity'),
    );
    expect(postWithRefs(s, { outputId: 'output_nope' })).toThrowError(
      code('missing_entity'),
    );
    expect(postWithRefs(s, { fromThreadId: 'thread_nope' })).toThrowError(
      code('missing_entity'),
    );
    expect(postWithRefs(s, { taskId: 'task_b', askId: 'ask_a' })).toThrowError(
      code('invalid_payload'),
    );
    expect(
      postWithRefs(s, { taskId: 'task_a', checkId: 'check_b' }),
    ).toThrowError(code('invalid_payload'));
    expect(
      postWithRefs(s, { taskId: 'task_a', outputId: 'output_b' }),
    ).toThrowError(code('invalid_payload'));
    expect(
      postWithRefs(s, {
        taskId: 'task_b',
        checkId: 'check_b',
        outputId: 'output_b',
        fromThreadId: 'thread_b',
      }),
    ).not.toThrow();
  });
});
