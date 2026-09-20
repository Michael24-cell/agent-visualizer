import {
  AgentIdSchema,
  AskIdSchema,
  BriefRequestIdSchema,
  CheckIdSchema,
  EventIdSchema,
  MessageIdSchema,
  MethodSnapshotIdSchema,
  OutputIdSchema,
  PlanIdSchema,
  ProjectEventSchema,
  ProjectIdSchema,
  ProposalIdSchema,
  TaskIdSchema,
  ThreadIdSchema,
  agentModel,
  modelForTier,
  type AdapterProvenanceSchema,
  type Agent,
  type AgentId,
  type AgentTask,
  type ApplyMethodCommand,
  type AskDecisionCommand,
  type AttachRepositoryCommand,
  type BriefFieldCommand,
  type CommandErrorCode,
  type CommandReceipt,
  type CommandResponse,
  type CreateAgentCommand,
  type CreateProjectCommand,
  type MessageAuthor,
  type MessageIntent,
  type MessagesQuery,
  type MethodOverrideCommand,
  type Plan,
  type PlanTask,
  type PostMessageCommand,
  type ProjectEvent,
  type ProjectId,
  type ProjectListResponse,
  type ProjectProjection,
  type ProjectResponse,
  type Proposal,
  type ProposalDecisionCommand,
  type RuntimeInfo,
  type SetAgentModelCommand,
  type Thread,
} from '@harness/contracts';
import {
  ProjectionError,
  TransitionError,
  applyProjectEvent,
  resolveMethod,
  summarizeProject,
} from '@harness/domain';
import type { SqliteProjectStore } from '@harness/persistence';
import {
  SIMULATED_CONVERSATION_ADAPTER,
  classifyCoordinatorMessage,
  coordinatorGreeting,
  findMethod,
  nextAgentStep,
  pendingField,
  planIntake,
  requiredFieldsSettled,
  subjectOf,
  planAgentIntents,
  planCoordinatorIntents,
  planFromRequest,
  revisePlan,
  type AgentStepIntent,
} from '@harness/runtime-simulated';
import {
  CLAUDE_AGENT_ADAPTER,
  buildSystemPrompt,
  buildTaskPrompt,
  runLiveTask,
  sdkFrameSource,
  type AskIntent,
  type FrameSource,
  type LiveTask,
} from '@harness/runtime-claude';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import { renderBrief } from './brief.js';
import { FolderError, inspectFolder, type FolderOptions } from './folders.js';

export class ProjectCommandError extends Error {
  constructor(
    readonly code: CommandErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ProjectCommandError';
  }
}

export function commandErrorStatus(code: CommandErrorCode): number {
  switch (code) {
    case 'not_found':
    case 'folder_not_found':
      return 404;
    case 'folder_not_allowed':
      return 403;
    case 'stale_sequence':
    case 'already_decided':
    case 'agent_busy':
    case 'agent_not_open':
    case 'ask_not_open':
    case 'plan_superseded':
    case 'invalid_transition':
    case 'thread_closed':
    case 'folder_required':
      return 409;
    default:
      return 400;
  }
}

function safe(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100);
}

type Adapter = z.infer<typeof AdapterProvenanceSchema>;

interface EmitMeta {
  threadId?: string | undefined;
  agentId?: string | undefined;
  taskId?: string | undefined;
  source?: ProjectEvent['source'] | undefined;
  adapter?: Adapter | undefined;
}

// Collects the events one command produces, reduces each against the
// projection as it goes (so an invalid step fails before anything is
// written), then commits events + messages + receipt in one transaction.
class ProjectBatch {
  private projection: ProjectProjection | undefined;
  private readonly pending: ProjectEvent[] = [];
  private messageCount = 0;
  readonly createdIds: Record<string, string[]> = {};

  constructor(
    private readonly store: SqliteProjectStore,
    private readonly projectId: ProjectId,
    private readonly commandId: string,
    private readonly now: string,
    current?: ProjectProjection,
  ) {
    this.projection = current;
  }

  get current(): ProjectProjection {
    if (!this.projection) throw new Error('Project has not been created.');
    return this.projection;
  }

  nextSequence(): number {
    return (this.projection?.lastSequence ?? 0) + 1;
  }

  created(kind: string, id: string): void {
    (this.createdIds[kind] ??= []).push(id);
  }

  emit(type: ProjectEvent['type'], payload: unknown, meta: EmitMeta = {}) {
    const sequence = this.nextSequence();
    const event = ProjectEventSchema.parse({
      id: EventIdSchema.parse(
        `event_${safe(this.projectId)}_${String(sequence).padStart(6, '0')}`,
      ),
      type,
      version: 1,
      sequence,
      occurredAt: this.now,
      recordedAt: this.now,
      projectId: this.projectId,
      ...(meta.threadId ? { threadId: meta.threadId } : {}),
      ...(meta.agentId ? { agentId: meta.agentId } : {}),
      ...(meta.taskId ? { taskId: meta.taskId } : {}),
      ...(this.projection ? { causationId: this.projection.lastEventId } : {}),
      source: meta.source ?? 'system',
      ...(meta.adapter ? { adapter: meta.adapter } : {}),
      payload,
    });
    this.projection = applyProjectEvent(this.projection, event);
    this.pending.push(event);
    return event;
  }

  post(
    thread: Thread,
    author: MessageAuthor,
    body: string,
    intent: MessageIntent = 'chat',
    refs?: {
      taskId?: string;
      proposalId?: string;
      askId?: string;
      fromThreadId?: string;
    },
  ) {
    this.messageCount += 1;
    const id = MessageIdSchema.parse(
      `message_${safe(this.commandId)}_${this.messageCount}`,
    );
    const source: ProjectEvent['source'] =
      author.role === 'system' ? 'system' : author.role;
    this.emit(
      'message.posted',
      {
        message: {
          id,
          projectId: this.projectId,
          threadId: thread.id,
          author,
          intent,
          body,
          ...(refs ? { refs } : {}),
          postedAt: this.now,
          sequence: this.nextSequence(),
        },
      },
      { threadId: thread.id, source, adapter: author.adapter },
    );
    this.created('messages', id);
    return id;
  }

  commit(): { projection: ProjectProjection; receipt: CommandReceipt } {
    if (this.pending.length === 0) {
      throw new Error('A command must produce at least one event.');
    }
    const first = this.pending[0]!.sequence;
    const last = this.pending.at(-1)!.sequence;
    const receipt: CommandReceipt = {
      commandId: this.commandId as CommandReceipt['commandId'],
      firstSequence: first,
      lastSequence: last,
      createdIds: this.createdIds,
      replayed: false,
    };
    const projection = this.store.transaction(() => {
      const next = this.store.appendMany(this.pending);
      this.store.saveReceipt(this.projectId, receipt, this.now);
      return next;
    });
    return { projection, receipt };
  }
}

const userAuthor: MessageAuthor = { role: 'user', source: 'client' };

function agentAuthor(
  agent: Agent,
  adapter: Adapter = SIMULATED_CONVERSATION_ADAPTER,
): MessageAuthor {
  return {
    role: 'agent',
    source: adapter.mode === 'live' ? 'live_adapter' : 'simulated_adapter',
    agentId: agent.id,
    adapter,
  };
}

const coordinatorAuthor: MessageAuthor = {
  role: 'coordinator',
  source: 'simulated_adapter',
  adapter: SIMULATED_CONVERSATION_ADAPTER,
};

const systemAuthor: MessageAuthor = { role: 'system', source: 'service' };

export interface ProjectServiceOptions {
  // Injectable clock so tests can pin timestamps.
  readonly now?: () => string;
  // Where attachable folders live (defaults to the home directory).
  readonly folders?: FolderOptions;
  // Replies land in the same transaction as the user's message (inline) or
  // after a delay in their own transaction (deferred), the way a live agent
  // would answer. Tests default to inline; the app runs deferred.
  readonly replies?:
    | { readonly mode: 'inline' }
    | { readonly mode: 'deferred'; readonly delayMs: number };
  // Which runtime executes agent tasks. Live runs each task on a Claude
  // agent in the attached folder; the coordinator stays simulated.
  readonly runtime?: RuntimeInfo;
  // Where live frames come from. Tests substitute fake frames.
  readonly frames?: FrameSource;
}

export class ProjectService {
  private readonly now: () => string;
  readonly folders: FolderOptions;
  private readonly replies: NonNullable<ProjectServiceOptions['replies']>;
  private readonly runtime: RuntimeInfo;
  private readonly frames: FrameSource;
  // Live runs by task id, and the permission waits they are paused on.
  private readonly liveRuns = new Map<string, LiveTask>();
  private readonly askWaiters = new Map<
    string,
    (decision: 'approved' | 'denied') => void
  >();
  // Threads with a reply in flight, and the promise that finishes it.
  private readonly pending = new Map<string, Promise<void>>();

  constructor(
    private readonly store: SqliteProjectStore,
    options: ProjectServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.folders = options.folders ?? {};
    this.replies = options.replies ?? { mode: 'inline' };
    this.runtime = options.runtime ?? { mode: 'simulated' };
    this.frames = options.frames ?? sdkFrameSource;
  }

  get isLive(): boolean {
    return this.runtime.mode === 'live';
  }

  // Resolves once every in-flight reply for the project has landed.
  async whenIdle(projectId?: ProjectId): Promise<void> {
    const keys = [...this.pending.keys()].filter(
      (key) => !projectId || key.startsWith(`${projectId}:`),
    );
    await Promise.all(keys.map((key) => this.pending.get(key)));
    const runs = [...this.liveRuns.entries()]
      .filter(([taskId]) => !projectId || taskId.includes(safe(projectId)))
      .map(([, run]) => run.done);
    await Promise.all(runs);
  }

  // Stops every live run; used on shutdown so no agent keeps working
  // after the harness is gone.
  stopAll(): void {
    for (const run of this.liveRuns.values()) run.stop();
    for (const resolve of this.askWaiters.values()) resolve('denied');
    this.askWaiters.clear();
  }

  busyThreadIds(projectId: ProjectId): string[] {
    const replying = [...this.pending.keys()]
      .filter((key) => key.startsWith(`${projectId}:`))
      .map((key) => key.slice(projectId.length + 1));
    if (!this.isLive || this.liveRuns.size === 0) return replying;
    const projection = this.store.getProjection(projectId);
    if (!projection) return replying;
    const working: string[] = [];
    for (const taskId of this.liveRuns.keys()) {
      const task = projection.tasks[taskId];
      if (task?.state !== 'working') continue;
      const threadId = projection.agents[task.agentId]?.threadId;
      if (threadId) working.push(threadId);
    }
    return [...new Set([...replying, ...working])];
  }

  // --- Reads ---------------------------------------------------------------

  requireProjection(projectId: ProjectId): ProjectProjection {
    const projection = this.store.getProjection(projectId);
    if (!projection) {
      throw new ProjectCommandError('not_found', 'Project was not found.');
    }
    return projection;
  }

  response(projection: ProjectProjection): ProjectResponse {
    return {
      projection,
      summary: summarizeProject(projection),
      brief: renderBrief(projection.project, projection.brief),
      busyThreadIds: this.busyThreadIds(
        projection.projectId,
      ) as ProjectResponse['busyThreadIds'],
      runtime: this.runtime,
    };
  }

  getProject(projectId: ProjectId): ProjectResponse {
    return this.response(this.requireProjection(projectId));
  }

  listProjects(): ProjectListResponse {
    return {
      projects: this.store.listProjections().map((projection) => ({
        project: projection.project,
        summary: summarizeProject(projection),
      })),
      runtime: this.runtime,
    };
  }

  // `coordinator`, a thread id, or an agent id all resolve to a thread.
  resolveThread(projection: ProjectProjection, ref: string): Thread {
    const threads = Object.values(projection.threads);
    const thread =
      ref === 'coordinator'
        ? threads.find((candidate) => candidate.kind === 'coordinator')
        : (projection.threads[ref] ??
          threads.find((candidate) => candidate.agentId === ref));
    if (!thread) {
      throw new ProjectCommandError('not_found', 'Thread was not found.');
    }
    return thread;
  }

  listMessages(projectId: ProjectId, threadRef: string, query: MessagesQuery) {
    const projection = this.requireProjection(projectId);
    const thread = this.resolveThread(projection, threadRef);
    return this.store.listMessages(thread.id, query);
  }

  listEvents(projectId: ProjectId, after: number) {
    const projection = this.requireProjection(projectId);
    return {
      events: this.store.listEvents(projection.projectId, after),
      cursor: projection.lastSequence,
    };
  }

  // --- Command plumbing ----------------------------------------------------

  // Receipts are checked before anything else, including stale-sequence,
  // so a retried command succeeds with its original result.
  private run(
    commandId: string,
    expectedProjectId: ProjectId | undefined,
    work: () => { projection: ProjectProjection; receipt: CommandReceipt },
  ): CommandResponse {
    const existing = this.store.getReceipt(commandId);
    if (existing) {
      if (expectedProjectId && existing.projectId !== expectedProjectId) {
        throw new ProjectCommandError(
          'project_mismatch',
          `Command ${commandId} belongs to project ${existing.projectId}, not ${expectedProjectId}.`,
        );
      }
      return {
        receipt: existing.receipt,
        project: this.getProject(existing.projectId),
      };
    }
    try {
      const { projection, receipt } = work();
      if (this.isLive) this.reconcileLiveRuns(projection.projectId);
      return { receipt, project: this.response(projection) };
    } catch (error) {
      throw translateDomainError(error);
    }
  }

  // --- Live runs -----------------------------------------------------------

  // After every command: start a run for each task that is now working
  // without one, stop runs whose task is no longer in progress, and
  // release permission waits whose ask was decided.
  private reconcileLiveRuns(projectId: ProjectId) {
    const projection = this.requireProjection(projectId);
    for (const [askId, resolve] of [...this.askWaiters.entries()]) {
      const ask = projection.asks[askId];
      if (!ask || ask.state === 'open') continue;
      this.askWaiters.delete(askId);
      resolve(ask.state === 'approved' ? 'approved' : 'denied');
    }
    for (const [taskId, run] of [...this.liveRuns.entries()]) {
      const task = projection.tasks[taskId];
      if (!task) continue;
      if (task.state !== 'working' && task.state !== 'needs_you') {
        run.stop();
        this.liveRuns.delete(taskId);
      }
    }
    for (const agent of Object.values(projection.agents)) {
      const task = agent.currentTaskId
        ? projection.tasks[agent.currentTaskId]
        : undefined;
      if (!task || task.state !== 'working' || this.liveRuns.has(task.id))
        continue;
      this.startLiveRun(projectId, agent, task);
    }
  }

  private startLiveRun(projectId: ProjectId, agent: Agent, task: AgentTask) {
    const projection = this.requireProjection(projectId);
    const repository = projection.project.repository;
    const snapshot = Object.values(projection.methodSnapshots).find(
      (candidate) => candidate.taskId === task.id,
    );
    let count = 0;
    const suffix = () => `${safe(task.id)}_${(count += 1)}`;

    const emit = (intents: readonly AgentStepIntent[]): boolean => {
      try {
        const current = this.requireProjection(projectId);
        const liveTask = current.tasks[task.id];
        const liveAgent = current.agents[agent.id];
        if (!liveTask || !liveAgent || liveTask.state !== 'working')
          return false;
        const batch = new ProjectBatch(
          this.store,
          projectId,
          randomUUID(),
          this.now(),
          current,
        );
        for (const intent of intents) {
          this.materializeStep(
            batch,
            projectId,
            liveAgent,
            liveTask,
            this.guardFinish(batch, liveTask, intent),
            suffix(),
            CLAUDE_AGENT_ADAPTER,
          );
        }
        if (batch.current.tasks[task.id]?.state === 'done') {
          this.handOff(batch, task.id);
        }
        batch.commit();
        this.reconcileLiveRuns(projectId);
        return true;
      } catch (error) {
        this.postFailure(projectId, projection.threads[agent.threadId]!, error);
        return false;
      }
    };

    const ask = (intent: AskIntent): Promise<'approved' | 'denied'> => {
      const current = this.requireProjection(projectId);
      if (current.tasks[task.id]?.state !== 'working') {
        return Promise.resolve('denied');
      }
      const batch = new ProjectBatch(
        this.store,
        projectId,
        randomUUID(),
        this.now(),
        current,
      );
      this.materializeStep(
        batch,
        projectId,
        current.agents[agent.id]!,
        current.tasks[task.id]!,
        intent,
        suffix(),
        CLAUDE_AGENT_ADAPTER,
      );
      const askId = batch.createdIds.asks?.[0];
      batch.commit();
      if (!askId) return Promise.resolve('denied');
      return new Promise((resolve) => {
        this.askWaiters.set(askId, resolve);
      });
    };

    if (!repository) {
      emit([
        {
          kind: 'fail',
          reason: 'Attach a folder to this project before starting live work.',
        },
      ]);
      return;
    }
    const run = runLiveTask(
      {
        cwd: repository.path,
        model: agentModel(agent),
        systemPrompt: buildSystemPrompt({
          projectName: projection.project.name,
          agentName: agent.name,
          method: snapshot?.resolved,
        }),
        prompt: buildTaskPrompt(task),
      },
      { emit, ask },
      this.frames,
    );
    this.liveRuns.set(task.id, run);
    void run.done.finally(() => {
      if (this.liveRuns.get(task.id) === run) this.liveRuns.delete(task.id);
    });
  }

  // A live agent says it is done, but a required check has no passing run
  // on record: that is a failure with a clear reason, not a quiet pass.
  private guardFinish(
    batch: ProjectBatch,
    task: AgentTask,
    intent: AgentStepIntent,
  ): AgentStepIntent {
    if (intent.kind !== 'finish') return intent;
    const checks = Object.values(batch.current.checks).filter(
      (check) => check.taskId === task.id,
    );
    const unmet = task.requiredChecks.filter(
      (name) =>
        !checks.some(
          (check) => check.name === name && check.state === 'passed',
        ),
    );
    if (unmet.length === 0) return intent;
    return {
      kind: 'fail',
      reason: `Reported done, but required check "${unmet[0]}" never passed. ${intent.reason}`,
    };
  }

  private assertSequence(label: string, actual: number, expected: number) {
    if (actual !== expected) {
      throw new ProjectCommandError(
        'stale_sequence',
        `${label} moved to sequence ${actual}; refresh before retrying.`,
      );
    }
  }

  // --- Commands ------------------------------------------------------------

  createProject(command: CreateProjectCommand): CommandResponse {
    return this.run(command.commandId, undefined, () => {
      const suffix = safe(command.commandId);
      const projectId = ProjectIdSchema.parse(`project_${suffix}`);
      // Validate the folder before anything is written.
      const repository = command.repositoryPath
        ? this.inspect(command.repositoryPath)
        : undefined;
      return this.materializeProject(
        projectId,
        command.commandId,
        command.name,
        'user',
        repository,
      );
    });
  }

  private inspect(path: string) {
    try {
      return inspectFolder(path, this.folders, this.now());
    } catch (error) {
      if (error instanceof FolderError) {
        throw new ProjectCommandError(error.code, error.message);
      }
      throw error;
    }
  }

  attachRepository(
    projectId: ProjectId,
    command: AttachRepositoryCommand,
  ): CommandResponse {
    return this.run(command.commandId, projectId, () => {
      const projection = this.requireProjection(projectId);
      this.assertSequence(
        'Project',
        projection.lastSequence,
        command.expectedSequence,
      );
      const repository = this.inspect(command.path);
      const batch = new ProjectBatch(
        this.store,
        projectId,
        command.commandId,
        this.now(),
        projection,
      );
      batch.emit(
        'project.repository_attached',
        { repository },
        { source: 'user' },
      );
      const coordinator = Object.values(batch.current.threads).find(
        (thread) => thread.kind === 'coordinator',
      )!;
      batch.post(
        coordinator,
        coordinatorAuthor,
        `Attached ${repository.name}${repository.branch ? ` (${repository.branch})` : ''}. Agents in this build still simulate their work; a live agent would work in this folder.`,
      );
      return batch.commit();
    });
  }

  // Shared by user projects and the flagged demo project.
  materializeProject(
    projectId: ProjectId,
    commandId: string,
    name: string,
    origin: 'user' | 'demo',
    repository?: ReturnType<typeof inspectFolder>,
  ) {
    const now = this.now();
    const batch = new ProjectBatch(this.store, projectId, commandId, now);
    batch.emit(
      'project.created',
      {
        project: {
          id: projectId,
          name,
          origin,
          createdAt: now,
          ...(repository ? { repository } : {}),
        },
      },
      { source: 'user' },
    );
    batch.created('projects', projectId);
    const threadId = ThreadIdSchema.parse(
      `thread_${safe(projectId.replace(/^project_/, ''))}_coordinator`,
    );
    batch.emit(
      'thread.opened',
      {
        thread: {
          id: threadId,
          projectId,
          kind: 'coordinator',
          state: 'open',
          messageCount: 0,
          lastSequence: batch.nextSequence(),
        },
      },
      { threadId },
    );
    batch.created('threads', threadId);
    batch.post(
      batch.current.threads[threadId]!,
      coordinatorAuthor,
      coordinatorGreeting(name),
    );
    return batch.commit();
  }

  createAgent(
    projectId: ProjectId,
    command: CreateAgentCommand,
  ): CommandResponse {
    return this.run(command.commandId, projectId, () => {
      const projection = this.requireProjection(projectId);
      this.assertSequence(
        'Project',
        projection.lastSequence,
        command.expectedSequence,
      );
      const batch = new ProjectBatch(
        this.store,
        projectId,
        command.commandId,
        this.now(),
        projection,
      );
      this.addAgent(batch, projectId, safe(command.commandId), command);
      return batch.commit();
    });
  }

  setAgentModel(
    projectId: ProjectId,
    agentId: AgentId,
    command: SetAgentModelCommand,
  ): CommandResponse {
    return this.run(command.commandId, projectId, () => {
      const projection = this.requireProjection(projectId);
      const agent = projection.agents[agentId];
      if (!agent)
        throw new ProjectCommandError('not_found', 'Agent was not found.');
      this.assertSequence(
        'Agent',
        agent.lastSequence,
        command.expectedSequence,
      );
      const batch = new ProjectBatch(
        this.store,
        projectId,
        command.commandId,
        this.now(),
        projection,
      );
      batch.emit(
        'agent.model_changed',
        { agentId, model: command.model },
        { agentId, source: 'user' },
      );
      return batch.commit();
    });
  }

  private addAgent(
    batch: ProjectBatch,
    projectId: ProjectId,
    suffix: string,
    input: {
      name: string;
      category: Agent['category'];
      model?: Agent['model'];
      modelTier?: Agent['modelTier'];
    },
  ): AgentId {
    const agentId = AgentIdSchema.parse(`agent_${suffix}`);
    const threadId = ThreadIdSchema.parse(`thread_${suffix}`);
    batch.emit(
      'thread.opened',
      {
        thread: {
          id: threadId,
          projectId,
          kind: 'agent',
          agentId,
          state: 'open',
          messageCount: 0,
          lastSequence: batch.nextSequence(),
        },
      },
      { threadId, agentId },
    );
    batch.emit(
      'agent.created',
      {
        agent: {
          id: agentId,
          projectId,
          threadId,
          name: input.name,
          category: input.category,
          ...(input.modelTier ? { modelTier: input.modelTier } : {}),
          model: input.model ?? modelForTier(input.modelTier),
          work: 'idle',
          taskIds: [],
          createdAtSequence: batch.nextSequence(),
          lastSequence: batch.nextSequence(),
        },
      },
      { threadId, agentId, source: 'user' },
    );
    batch.created('agents', agentId);
    batch.created('threads', threadId);
    return agentId;
  }

  postMessage(
    projectId: ProjectId,
    threadRef: string,
    command: PostMessageCommand,
  ): CommandResponse {
    return this.run(command.commandId, projectId, () => {
      const projection = this.requireProjection(projectId);
      const thread = this.resolveThread(projection, threadRef);
      if (thread.state !== 'open') {
        throw new ProjectCommandError(
          'thread_closed',
          'This thread is closed.',
        );
      }
      this.assertSequence(
        'Thread',
        thread.lastSequence,
        command.expectedSequence,
      );
      const batch = new ProjectBatch(
        this.store,
        projectId,
        command.commandId,
        this.now(),
        projection,
      );
      const messageId = batch.post(
        thread,
        userAuthor,
        command.body,
        command.intent,
      );
      if (this.replies.mode === 'inline') {
        this.buildReply(batch, projectId, thread, command, messageId);
        return batch.commit();
      }
      const committed = batch.commit();
      this.scheduleReply(projectId, thread, command, messageId);
      return committed;
    });
  }

  // A deferred reply: its own transaction, its own command id, after the
  // configured delay. Failures (the thread changed underneath it) are
  // logged in the thread as a system message rather than lost.
  private scheduleReply(
    projectId: ProjectId,
    thread: Thread,
    command: PostMessageCommand,
    messageId: string,
  ) {
    if (this.replies.mode !== 'deferred') return;
    const key = `${projectId}:${thread.id}`;
    const delay = this.replies.delayMs;
    const previous = this.pending.get(key) ?? Promise.resolve();
    const work = previous.then(
      () =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            try {
              const projection = this.requireProjection(projectId);
              const current = projection.threads[thread.id]!;
              const batch = new ProjectBatch(
                this.store,
                projectId,
                randomUUID(),
                this.now(),
                projection,
              );
              this.buildReply(batch, projectId, current, command, messageId);
              batch.commit();
            } catch (error) {
              this.postFailure(projectId, thread, error);
            } finally {
              if (this.pending.get(key) === work) this.pending.delete(key);
              resolve();
            }
          }, delay);
        }),
    );
    this.pending.set(key, work);
  }

  private postFailure(projectId: ProjectId, thread: Thread, error: unknown) {
    try {
      const projection = this.requireProjection(projectId);
      const batch = new ProjectBatch(
        this.store,
        projectId,
        randomUUID(),
        this.now(),
        projection,
      );
      batch.post(
        projection.threads[thread.id]!,
        systemAuthor,
        `That reply could not be produced: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      batch.commit();
    } catch {
      // Nothing more to do; the user's message is already persisted.
    }
  }

  // The simulated agent's or coordinator's answer to one user message.
  private buildReply(
    batch: ProjectBatch,
    projectId: ProjectId,
    thread: Thread,
    command: PostMessageCommand,
    messageId: string | undefined,
  ) {
    if (thread.kind === 'agent' && thread.agentId) {
      const agent = batch.current.agents[thread.agentId]!;
      const currentTask = agent.currentTaskId
        ? batch.current.tasks[agent.currentTaskId]
        : undefined;
      if (this.isLive) {
        this.replyLive(
          batch,
          projectId,
          thread,
          agent,
          currentTask,
          command,
          messageId,
        );
        return;
      }
      const intents = planAgentIntents({
        agent,
        currentTask,
        intent: command.intent,
        body: command.body,
      });
      for (const intent of intents) {
        if (intent.kind === 'assign_task') {
          const taskId = TaskIdSchema.parse(`task_${safe(command.commandId)}`);
          batch.emit(
            'task.assigned',
            {
              task: {
                id: taskId,
                projectId,
                agentId: agent.id,
                title: intent.title,
                objective: intent.objective,
                category: agent.category,
                skills: [],
                scope: [],
                scopeHistory: [],
                dependsOn: [],
                inputsSatisfied: [],
                expectedOutputs: [],
                requiredChecks: [
                  agent.category === 'orchestration'
                    ? 'experience-check'
                    : 'contract-check',
                ],
                state: 'working',
                ...(messageId ? { originMessageId: messageId } : {}),
                createdAtSequence: batch.nextSequence(),
              },
            },
            { agentId: agent.id, taskId, source: 'agent' },
          );
          batch.created('tasks', taskId);
          this.pinMethod(batch, taskId, safe(command.commandId));
        } else {
          const latestTask = batch.current.agents[agent.id]?.currentTaskId;
          batch.post(
            thread,
            agentAuthor(agent),
            intent.body,
            'chat',
            latestTask ? { taskId: latestTask } : undefined,
          );
        }
      }
    } else if (thread.kind === 'coordinator') {
      this.handleCoordinatorMessage(
        batch,
        projectId,
        thread,
        command.commandId,
        command.body,
        messageId,
      );
    }
  }

  // A live agent thread. Work starts a task that the runner picks up
  // after commit; plain chat is not forwarded into a running session yet,
  // and the harness says so instead of answering in the agent's voice.
  private replyLive(
    batch: ProjectBatch,
    projectId: ProjectId,
    thread: Thread,
    agent: Agent,
    currentTask: AgentTask | undefined,
    command: PostMessageCommand,
    messageId: string | undefined,
  ) {
    const inProgress =
      currentTask &&
      ['waiting', 'working', 'needs_you'].includes(currentTask.state);
    if (command.intent !== 'start_work') {
      batch.post(
        thread,
        systemAuthor,
        inProgress
          ? `${agent.name} is working on "${currentTask.title}". Messages aren't forwarded into a running task yet — stop it or wait for it to finish.`
          : `${agent.name} runs on Claude and takes work, not chat, in this build. Type /start followed by what to do.`,
      );
      return;
    }
    if (inProgress) {
      throw new ProjectCommandError(
        'agent_busy',
        `${agent.name} is already working on "${currentTask.title}". Stop it first.`,
      );
    }
    if (!batch.current.project.repository) {
      throw new ProjectCommandError(
        'folder_required',
        'Attach a folder to this project before starting live work.',
      );
    }
    const taskId = TaskIdSchema.parse(`task_${safe(command.commandId)}`);
    batch.emit(
      'task.assigned',
      {
        task: {
          id: taskId,
          projectId,
          agentId: agent.id,
          title: command.body.split('\n')[0]!.slice(0, 200),
          objective: command.body,
          category: agent.category,
          skills: [],
          scope: [],
          scopeHistory: [],
          dependsOn: [],
          inputsSatisfied: [],
          expectedOutputs: [],
          requiredChecks: [],
          state: 'working',
          ...(messageId ? { originMessageId: messageId } : {}),
          createdAtSequence: batch.nextSequence(),
        },
      },
      { agentId: agent.id, taskId, source: 'user' },
    );
    batch.created('tasks', taskId);
    this.pinMethod(batch, taskId, safe(command.commandId));
  }

  // --- Planning and dispersal ---------------------------------------------

  private openPlanProposal(projection: ProjectProjection) {
    return Object.values(projection.proposals).find(
      (proposal): proposal is Extract<Proposal, { kind: 'plan' }> =>
        proposal.kind === 'plan' && proposal.state === 'open',
    );
  }

  private livePlan(projection: ProjectProjection): Plan | undefined {
    return Object.values(projection.plans).find(
      (plan) => !plan.assignedAtSequence && !plan.supersededByPlanId,
    );
  }

  private handleCoordinatorMessage(
    batch: ProjectBatch,
    projectId: ProjectId,
    thread: Thread,
    commandId: string,
    body: string,
    messageId: string | undefined,
  ) {
    const projection = batch.current;
    const open = this.openPlanProposal(projection);
    const classified = classifyCoordinatorMessage(body, Boolean(open));
    const suffix = safe(commandId);

    switch (classified.kind) {
      case 'note': {
        if (pendingField(projection.brief)) {
          const intake = planIntake(projection.brief, body);
          for (const update of intake.updates) {
            batch.emit(
              'brief.field_updated',
              {
                fieldId: update.fieldId,
                to: update.to,
                ...(update.value ? { value: update.value } : {}),
                source: update.to === 'inferred' ? 'coordinator' : 'user',
                ...(messageId ? { messageId } : {}),
              },
              { source: update.to === 'inferred' ? 'coordinator' : 'user' },
            );
          }
          batch.post(thread, coordinatorAuthor, intake.reply);
          this.offerMethodOnce(batch, projectId, thread, suffix, messageId);
          return;
        }
        for (const intent of planCoordinatorIntents({
          projectName: projection.project.name,
          brief: projection.brief,
          body,
          agentNames: Object.values(projection.agents).map((a) => a.name),
        })) {
          batch.post(thread, coordinatorAuthor, intent.body);
        }
        return;
      }
      case 'record_request': {
        const proposalId = ProposalIdSchema.parse(`proposal_${suffix}`);
        const category = classified.requestCategory ?? 'other';
        batch.emit(
          'proposal.opened',
          {
            proposal: {
              id: proposalId,
              projectId,
              threadId: thread.id,
              kind: 'record_request',
              payload: {
                text: body,
                category,
                keywordsMatched: classified.keywordsMatched,
              },
              title: 'Record request',
              summary: `Add this ${category} request to the Brief so agents see it.`,
              state: 'open',
              consequences: {
                effects: [
                  {
                    kind: 'append_brief_request',
                    description: 'Appends one request to the Brief.',
                  },
                ],
                reversible: true,
                touchesRepository: false,
              },
              ...(messageId ? { messageId } : {}),
              openedAtSequence: batch.nextSequence(),
              lastSequence: batch.nextSequence(),
            },
          },
          {
            threadId: thread.id,
            source: 'coordinator',
            adapter: SIMULATED_CONVERSATION_ADAPTER,
          },
        );
        batch.created('proposals', proposalId);
        batch.post(
          thread,
          coordinatorAuthor,
          `That sounds like a ${category} request. Record it in the Brief?`,
          'chat',
          { proposalId },
        );
        return;
      }
      case 'edit_plan': {
        if (!open) return;
        const current = projection.plans[open.payload.planId]!;
        const revised = revisePlan(
          { tasks: current.tasks, whyThisMany: current.whyThisMany },
          body,
          current.request,
          Object.values(projection.agents),
        );
        const unchanged =
          JSON.stringify(revised.tasks) === JSON.stringify(current.tasks);
        if (unchanged) {
          batch.post(
            thread,
            coordinatorAuthor,
            'I could not turn that into a plan change. Try: "combine into one agent", "split into two agents", "add checks", or "assign <task> to <agent>".',
            'chat',
            { proposalId: open.id },
          );
          return;
        }
        const plan = this.recordPlan(
          batch,
          projectId,
          suffix,
          current.request,
          revised,
          current.id,
        );
        const proposalId = this.proposePlan(
          batch,
          projectId,
          thread,
          suffix,
          plan,
          messageId,
        );
        batch.post(
          thread,
          coordinatorAuthor,
          `Plan v${plan.version} replaces v${current.version}: ${plan.tasks.length} ${plan.tasks.length === 1 ? 'task' : 'tasks'}. Assign to agents, or tell me what else to change.`,
          'chat',
          { proposalId },
        );
        return;
      }
      case 'request_work': {
        const live = this.livePlan(projection);
        if (projection.brief.fields.goal.state === 'missing') {
          batch.emit(
            'brief.field_updated',
            {
              fieldId: 'goal',
              to: 'inferred',
              value: subjectOf(body),
              source: 'coordinator',
              ...(messageId ? { messageId } : {}),
            },
            { source: 'coordinator', adapter: SIMULATED_CONVERSATION_ADAPTER },
          );
        }
        const plan = this.recordPlan(
          batch,
          projectId,
          suffix,
          body,
          planFromRequest(body),
          live?.id,
        );
        const proposalId = this.proposePlan(
          batch,
          projectId,
          thread,
          suffix,
          plan,
          messageId,
        );
        batch.post(
          thread,
          coordinatorAuthor,
          `Plan v${plan.version} is ready: ${plan.tasks.length} ${plan.tasks.length === 1 ? 'task' : 'tasks'}. Assign to agents, or tell me what to change.`,
          'chat',
          { proposalId },
        );
        return;
      }
      case 'direct_work': {
        const live = this.livePlan(projection);
        const shape =
          open && live
            ? { tasks: live.tasks, whyThisMany: live.whyThisMany }
            : planFromRequest(body);
        const request = open && live ? live.request : body;
        // A direct go-ahead on an open proposal assigns that plan; the
        // proposal itself is closed as approved so history reads right.
        if (open && live) {
          batch.emit(
            'proposal.decided',
            {
              proposalId: open.id,
              from: 'open',
              to: 'approved',
              note: 'Approved in chat.',
            },
            { threadId: thread.id, source: 'user' },
          );
          this.disperse(batch, projectId, suffix, live, open.id);
          return;
        }
        const plan = this.recordPlan(
          batch,
          projectId,
          suffix,
          request,
          shape,
          live?.id,
        );
        this.disperse(batch, projectId, suffix, plan, undefined);
        return;
      }
    }
  }

  private recordPlan(
    batch: ProjectBatch,
    projectId: ProjectId,
    suffix: string,
    request: string,
    shape: { tasks: PlanTask[]; whyThisMany: string },
    supersedesPlanId: string | undefined,
  ): Plan {
    const planId = PlanIdSchema.parse(`plan_${suffix}`);
    batch.emit(
      'plan.recorded',
      {
        plan: {
          id: planId,
          projectId,
          version: Object.keys(batch.current.plans).length + 1,
          request,
          tasks: shape.tasks,
          whyThisMany: shape.whyThisMany,
          ...(supersedesPlanId ? { supersedesPlanId } : {}),
          recordedAtSequence: batch.nextSequence(),
        },
      },
      { source: 'coordinator', adapter: SIMULATED_CONVERSATION_ADAPTER },
    );
    batch.created('plans', planId);
    return batch.current.plans[planId]!;
  }

  private proposePlan(
    batch: ProjectBatch,
    projectId: ProjectId,
    thread: Thread,
    suffix: string,
    plan: Plan,
    messageId: string | undefined,
  ) {
    const proposalId = ProposalIdSchema.parse(`proposal_${suffix}`);
    const newAgents = plan.tasks
      .map((task) => task.agentName)
      .filter(
        (name, index, all) =>
          all.indexOf(name) === index &&
          !Object.values(batch.current.agents).some(
            (agent) => agent.name === name,
          ),
      );
    batch.emit(
      'proposal.opened',
      {
        proposal: {
          id: proposalId,
          projectId,
          threadId: thread.id,
          kind: 'plan',
          payload: { planId: plan.id },
          title: `Plan v${plan.version}: ${plan.tasks.length} ${plan.tasks.length === 1 ? 'task' : 'tasks'}`,
          summary: plan.whyThisMany,
          state: 'open',
          consequences: {
            effects: [
              ...(newAgents.length
                ? [
                    {
                      kind: 'create_agents' as const,
                      description: `Opens ${newAgents.join(' and ')}.`,
                    },
                  ]
                : []),
              {
                kind: 'assign_tasks' as const,
                description: `Assigns ${plan.tasks.length} ${plan.tasks.length === 1 ? 'task' : 'tasks'} and starts the first.`,
              },
              ...(batch.current.method
                ? [
                    {
                      kind: 'pin_method' as const,
                      description: 'Pins the current Method to each task.',
                    },
                  ]
                : []),
            ],
            reversible: false,
            touchesRepository: false,
          },
          ...(messageId ? { messageId } : {}),
          openedAtSequence: batch.nextSequence(),
          lastSequence: batch.nextSequence(),
        },
      },
      {
        threadId: thread.id,
        source: 'coordinator',
        adapter: SIMULATED_CONVERSATION_ADAPTER,
      },
    );
    batch.created('proposals', proposalId);
    return proposalId;
  }

  // Everything a plan assignment touches, in one batch (one transaction):
  // new agents and threads, every task in row order, method snapshots,
  // plan.assigned, then one message per agent and one summary.
  private disperse(
    batch: ProjectBatch,
    projectId: ProjectId,
    suffix: string,
    plan: Plan,
    proposalId: string | undefined,
  ) {
    const coordinator = Object.values(batch.current.threads).find(
      (thread) => thread.kind === 'coordinator',
    )!;
    if (this.isLive && !batch.current.project.repository) {
      throw new ProjectCommandError(
        'folder_required',
        'Attach a folder to this project before assigning a plan to live agents.',
      );
    }
    const taskIds: string[] = [];
    plan.tasks.forEach((row, index) => {
      let agent = Object.values(batch.current.agents).find(
        (candidate) => candidate.name === row.agentName,
      );
      if (!agent) {
        const agentId = this.addAgent(batch, projectId, `${suffix}_${index}`, {
          name: row.agentName,
          category: row.category,
          ...(row.modelTier ? { modelTier: row.modelTier } : {}),
        });
        agent = batch.current.agents[agentId]!;
      }
      if (!['idle', 'done', 'stopped', 'failed'].includes(agent.work)) {
        throw new ProjectCommandError(
          'agent_busy',
          `${agent.name} is ${agent.work}; stop or finish its current task before assigning this plan.`,
        );
      }
      const taskId = TaskIdSchema.parse(`task_${suffix}_${index}`);
      const dependsOn = row.dependsOn.map((upstream) => taskIds[upstream]!);
      batch.emit(
        'task.assigned',
        {
          task: {
            id: taskId,
            projectId,
            agentId: agent.id,
            planId: plan.id,
            planTaskIndex: index,
            title: row.title,
            objective: row.objective,
            category: row.category,
            whySeparate: row.whySeparate,
            whyThisAgent: row.whyThisAgent,
            skills: row.skills,
            scope: row.scope,
            scopeHistory: [],
            dependsOn,
            inputsSatisfied: [],
            expectedOutputs: row.expectedOutputs,
            requiredChecks: row.requiredChecks,
            ...(row.modelTier ? { modelTier: row.modelTier } : {}),
            state: dependsOn.length ? 'waiting' : 'working',
            createdAtSequence: batch.nextSequence(),
          },
        },
        {
          agentId: agent.id,
          taskId,
          source: 'coordinator',
          adapter: SIMULATED_CONVERSATION_ADAPTER,
        },
      );
      batch.created('tasks', taskId);
      taskIds.push(taskId);
      this.pinMethod(batch, taskId, `${suffix}_${index}`);
      const thread = batch.current.threads[agent.threadId]!;
      batch.post(
        thread,
        coordinatorAuthor,
        dependsOn.length
          ? `Assigned: ${row.title}. Waiting on ${dependsOn.map((id) => batch.current.tasks[id]!.title).join(', ')} first.`
          : `Assigned: ${row.title}. Starting now.`,
        'chat',
        { taskId, fromThreadId: coordinator.id },
      );
    });
    batch.emit(
      'plan.assigned',
      { planId: plan.id, ...(proposalId ? { proposalId } : {}) },
      { source: 'user' },
    );
    batch.post(
      coordinator,
      coordinatorAuthor,
      `Assigned plan v${plan.version}: ${plan.tasks
        .map((row) => `${row.agentName} → ${row.title}`)
        .join('; ')}. Each agent works in its own pane; use Next step there.`,
      'chat',
      proposalId ? { proposalId } : undefined,
    );
  }

  private pinMethod(batch: ProjectBatch, taskId: string, suffix: string) {
    const method = batch.current.method;
    if (!method) return;
    const snapshotId = MethodSnapshotIdSchema.parse(`methodsnap_${suffix}`);
    batch.emit(
      'method.snapshot_pinned',
      {
        snapshot: {
          id: snapshotId,
          taskId,
          resolved: resolveMethod(method),
          methodVersion: method.version,
          pinnedAtSequence: batch.nextSequence(),
        },
      },
      { taskId },
    );
    batch.created('methodSnapshots', snapshotId);
  }

  // Once the required Brief fields are settled and no Method is applied,
  // offer one — exactly once. Ignoring it never blocks anything.
  private offerMethodOnce(
    batch: ProjectBatch,
    projectId: ProjectId,
    thread: Thread,
    suffix: string,
    messageId: string | undefined,
  ) {
    const projection = batch.current;
    if (!requiredFieldsSettled(projection.brief) || projection.method) return;
    if (
      Object.values(projection.proposals).some(
        (proposal) => proposal.kind === 'set_method',
      )
    )
      return;
    const method = findMethod('method_evidence-led-delivery', '1.2.0')!;
    const proposalId = ProposalIdSchema.parse(`proposal_${suffix}_method`);
    batch.emit(
      'proposal.opened',
      {
        proposal: {
          id: proposalId,
          projectId,
          threadId: thread.id,
          kind: 'set_method',
          payload: { catalogId: method.id, catalogVersion: method.version },
          title: `Apply a Method: ${method.title}`,
          summary:
            'Default behavior is fine for most projects. If you want rules, skills, and checks shaping how agents work here, apply a method. You can customize it per project afterwards.',
          state: 'open',
          consequences: {
            effects: [
              {
                kind: 'pin_method',
                description:
                  'Every task assigned from now on pins this Method as it stands at that moment.',
              },
            ],
            reversible: true,
            touchesRepository: false,
          },
          ...(messageId ? { messageId } : {}),
          openedAtSequence: batch.nextSequence(),
          lastSequence: batch.nextSequence(),
        },
      },
      {
        threadId: thread.id,
        source: 'coordinator',
        adapter: SIMULATED_CONVERSATION_ADAPTER,
      },
    );
    batch.created('proposals', proposalId);
  }

  private applyMethodDefinition(
    batch: ProjectBatch,
    catalogId: string,
    catalogVersion: string,
    proposalId: string | undefined,
  ) {
    const method = findMethod(catalogId, catalogVersion);
    if (!method) {
      throw new ProjectCommandError(
        'not_found',
        `Method ${catalogId} ${catalogVersion} is not in the catalog.`,
      );
    }
    batch.emit(
      'method.applied',
      { definition: method, ...(proposalId ? { proposalId } : {}) },
      { source: 'user' },
    );
    const coordinator = Object.values(batch.current.threads).find(
      (thread) => thread.kind === 'coordinator',
    )!;
    batch.post(
      coordinator,
      coordinatorAuthor,
      `Method applied: ${method.title} v${method.version}. Tasks assigned from now on pin it; tasks already running keep what they had.`,
      'chat',
      proposalId ? { proposalId } : undefined,
    );
  }

  applyMethod(
    projectId: ProjectId,
    command: ApplyMethodCommand,
  ): CommandResponse {
    return this.run(command.commandId, projectId, () => {
      const projection = this.requireProjection(projectId);
      this.assertSequence(
        'Method',
        projection.method?.lastSequence ?? projection.lastSequence,
        command.expectedSequence,
      );
      const batch = new ProjectBatch(
        this.store,
        projectId,
        command.commandId,
        this.now(),
        projection,
      );
      for (const proposal of Object.values(projection.proposals)) {
        if (proposal.kind === 'set_method' && proposal.state === 'open') {
          batch.emit(
            'proposal.decided',
            {
              proposalId: proposal.id,
              from: 'open',
              to: 'dismissed',
              note: 'Dismissed because a Method was applied directly.',
            },
            { threadId: proposal.threadId, source: 'user' },
          );
        }
      }
      this.applyMethodDefinition(
        batch,
        command.catalogId,
        command.catalogVersion,
        undefined,
      );
      return batch.commit();
    });
  }

  overrideMethod(
    projectId: ProjectId,
    command: MethodOverrideCommand,
  ): CommandResponse {
    return this.run(command.commandId, projectId, () => {
      const projection = this.requireProjection(projectId);
      if (!projection.method) {
        throw new ProjectCommandError(
          'invalid_command',
          'Apply a Method before customizing it.',
        );
      }
      this.assertSequence(
        'Method',
        projection.method.lastSequence,
        command.expectedSequence,
      );
      const batch = new ProjectBatch(
        this.store,
        projectId,
        command.commandId,
        this.now(),
        projection,
      );
      batch.emit(
        'method.override_recorded',
        { sectionId: command.sectionId, value: command.value },
        { source: 'user' },
      );
      return batch.commit();
    });
  }

  updateBriefField(
    projectId: ProjectId,
    command: BriefFieldCommand,
  ): CommandResponse {
    return this.run(command.commandId, projectId, () => {
      const projection = this.requireProjection(projectId);
      this.assertSequence(
        'Brief',
        projection.brief.lastSequence,
        command.expectedSequence,
      );
      const field = projection.brief.fields[command.fieldId];
      const to =
        command.action === 'skip'
          ? 'skipped'
          : command.action === 'correct'
            ? 'corrected'
            : 'confirmed';
      const value =
        command.action === 'skip' ? undefined : (command.value ?? field.value);
      if (to !== 'skipped' && !value) {
        throw new ProjectCommandError(
          'invalid_command',
          'Give the field a value to confirm or correct it.',
        );
      }
      const batch = new ProjectBatch(
        this.store,
        projectId,
        command.commandId,
        this.now(),
        projection,
      );
      batch.emit(
        'brief.field_updated',
        {
          fieldId: command.fieldId,
          to,
          ...(value ? { value } : {}),
          source: 'user',
        },
        { source: 'user' },
      );
      return batch.commit();
    });
  }

  decideProposal(
    projectId: ProjectId,
    proposalId: string,
    command: ProposalDecisionCommand,
  ): CommandResponse {
    return this.run(command.commandId, projectId, () => {
      const projection = this.requireProjection(projectId);
      const proposal = projection.proposals[proposalId];
      if (!proposal) {
        throw new ProjectCommandError('not_found', 'Proposal was not found.');
      }
      if (proposal.state !== 'open') {
        throw new ProjectCommandError(
          'already_decided',
          `This proposal was already ${proposal.state}.`,
        );
      }
      this.assertSequence(
        'Proposal',
        proposal.lastSequence,
        command.expectedSequence,
      );
      const batch = new ProjectBatch(
        this.store,
        projectId,
        command.commandId,
        this.now(),
        projection,
      );
      const thread = projection.threads[proposal.threadId]!;
      batch.emit(
        'proposal.decided',
        {
          proposalId: proposal.id,
          from: 'open',
          to: command.decision,
          ...(command.note ? { note: command.note } : {}),
        },
        { threadId: thread.id, source: 'user' },
      );
      if (command.decision !== 'approved') {
        batch.post(
          thread,
          coordinatorAuthor,
          command.decision === 'denied'
            ? `Understood — ${proposal.title.toLowerCase()} will not happen. Tell me what to change, or ask for something else.`
            : `Set aside: ${proposal.title.toLowerCase()}. It stays in history; ask again whenever you like.`,
          'chat',
          { proposalId: proposal.id },
        );
        return batch.commit();
      }
      const suffix = safe(command.commandId);
      switch (proposal.kind) {
        case 'plan':
          this.disperse(
            batch,
            projectId,
            suffix,
            projection.plans[proposal.payload.planId]!,
            proposal.id,
          );
          break;
        case 'record_request': {
          const requestId = BriefRequestIdSchema.parse(`request_${suffix}`);
          batch.emit('brief.request_recorded', {
            request: {
              id: requestId,
              text: proposal.payload.text,
              category: proposal.payload.category,
              proposalId: proposal.id,
              ...(proposal.messageId ? { messageId: proposal.messageId } : {}),
              recordedAtSequence: batch.nextSequence(),
            },
          });
          batch.created('briefRequests', requestId);
          batch.post(
            thread,
            coordinatorAuthor,
            'Recorded in the Brief.',
            'chat',
            {
              proposalId: proposal.id,
            },
          );
          break;
        }
        case 'change_task_scope': {
          const task = projection.tasks[proposal.payload.taskId]!;
          batch.emit(
            'task.scope_changed',
            {
              taskId: task.id,
              proposalId: proposal.id,
              scope: proposal.payload.scope,
            },
            { taskId: task.id, source: 'user' },
          );
          batch.post(
            batch.current.threads[
              batch.current.agents[task.agentId]!.threadId
            ]!,
            coordinatorAuthor,
            `Scope for "${task.title}" is now ${proposal.payload.scope.join(', ')}.`,
            'chat',
            { taskId: task.id, proposalId: proposal.id },
          );
          break;
        }
        case 'set_method':
          this.applyMethodDefinition(
            batch,
            proposal.payload.catalogId,
            proposal.payload.catalogVersion,
            proposal.id,
          );
          break;
      }
      return batch.commit();
    });
  }

  // --- Per-agent advancement, asks, handoffs -------------------------------

  advanceAgent(
    projectId: ProjectId,
    agentId: AgentId,
    command: { commandId: string; expectedSequence: number },
  ): CommandResponse {
    return this.run(command.commandId, projectId, () => {
      const projection = this.requireProjection(projectId);
      const agent = projection.agents[agentId];
      if (!agent)
        throw new ProjectCommandError('not_found', 'Agent was not found.');
      this.assertSequence(
        'Agent',
        agent.lastSequence,
        command.expectedSequence,
      );
      if (this.isLive) {
        throw new ProjectCommandError(
          'invalid_transition',
          `${agent.name} runs on Claude and works on its own; there is no step to take by hand.`,
        );
      }
      const step = nextAgentStep(projection, agent);
      if (!step.ok)
        throw new ProjectCommandError('invalid_transition', step.reason);
      const task = projection.tasks[agent.currentTaskId!]!;
      const batch = new ProjectBatch(
        this.store,
        projectId,
        command.commandId,
        this.now(),
        projection,
      );
      const suffix = safe(command.commandId);
      let count = 0;
      for (const intent of step.intents) {
        count += 1;
        this.materializeStep(
          batch,
          projectId,
          agent,
          task,
          intent,
          `${suffix}_${count}`,
        );
      }
      if (batch.current.tasks[task.id]?.state === 'done') {
        this.handOff(batch, task.id);
      }
      return batch.commit();
    });
  }

  private materializeStep(
    batch: ProjectBatch,
    projectId: ProjectId,
    agent: Agent,
    task: AgentTask,
    intent: AgentStepIntent,
    suffix: string,
    adapter: Adapter = SIMULATED_CONVERSATION_ADAPTER,
  ) {
    const thread = batch.current.threads[agent.threadId]!;
    const meta = {
      agentId: agent.id,
      taskId: task.id,
      source: 'agent' as const,
      adapter,
    };
    switch (intent.kind) {
      case 'say':
        batch.post(thread, agentAuthor(agent, adapter), intent.body, 'chat', {
          taskId: task.id,
        });
        return;
      case 'output': {
        const outputId = OutputIdSchema.parse(`output_${suffix}`);
        batch.emit(
          'output.produced',
          {
            output: {
              id: outputId,
              projectId,
              agentId: agent.id,
              taskId: task.id,
              kind: intent.outputKind,
              title: intent.title,
              digest: intent.digest,
              producedAtSequence: batch.nextSequence(),
            },
          },
          meta,
        );
        batch.created('outputs', outputId);
        return;
      }
      case 'check_pass':
      case 'check_fail': {
        const checkId = CheckIdSchema.parse(`check_${suffix}`);
        batch.emit(
          'check.started',
          {
            check: {
              id: checkId,
              projectId,
              agentId: agent.id,
              taskId: task.id,
              name: intent.name,
              command: intent.command,
              state: 'running',
              ...(intent.kind === 'check_pass' && intent.retryOf
                ? { retryOf: intent.retryOf }
                : {}),
              startedAtSequence: batch.nextSequence(),
            },
          },
          meta,
        );
        batch.emit(
          'check.finished',
          {
            checkId,
            from: 'running',
            to: intent.kind === 'check_pass' ? 'passed' : 'failed',
            summary: intent.summary,
          },
          meta,
        );
        batch.created('checks', checkId);
        return;
      }
      case 'ask': {
        const askId = AskIdSchema.parse(`ask_${suffix}`);
        batch.emit(
          'ask.opened',
          {
            ask: {
              id: askId,
              projectId,
              agentId: agent.id,
              taskId: task.id,
              action: intent.action,
              reason: intent.reason,
              scope: intent.scope,
              consequences: intent.consequences,
              state: 'open',
              openedAtSequence: batch.nextSequence(),
            },
          },
          meta,
        );
        batch.emit(
          'task.state_changed',
          {
            taskId: task.id,
            from: 'working',
            to: 'needs_you',
            reason: intent.reason,
          },
          meta,
        );
        batch.created('asks', askId);
        batch.post(
          thread,
          agentAuthor(agent, adapter),
          `Needs you: ${intent.action}. ${intent.reason} Would write to ${intent.scope}.`,
          'chat',
          { taskId: task.id, askId },
        );
        return;
      }
      case 'finish':
      case 'fail':
        batch.emit(
          'task.state_changed',
          {
            taskId: task.id,
            from: 'working',
            to: intent.kind === 'finish' ? 'done' : 'failed',
            reason: intent.reason,
          },
          meta,
        );
        return;
    }
  }

  // A finished task satisfies every waiting task that depends on it. When
  // all of a task's inputs are in, it starts and its agent is told.
  private handOff(batch: ProjectBatch, finishedTaskId: AgentTask['id']) {
    const finished = batch.current.tasks[finishedTaskId]!;
    const output = Object.values(batch.current.outputs)
      .filter((candidate) => candidate.taskId === finishedTaskId)
      .sort((a, b) => b.producedAtSequence - a.producedAtSequence)[0];
    if (!output) return;
    for (const downstream of Object.values(batch.current.tasks)) {
      if (
        downstream.state !== 'waiting' ||
        !downstream.dependsOn.includes(finishedTaskId)
      )
        continue;
      if (downstream.inputsSatisfied.includes(finishedTaskId)) continue;
      batch.emit(
        'task.input_satisfied',
        {
          taskId: downstream.id,
          upstreamTaskId: finishedTaskId,
          outputId: output.id,
        },
        {
          taskId: downstream.id,
          source: 'coordinator',
          adapter: SIMULATED_CONVERSATION_ADAPTER,
        },
      );
      const updated = batch.current.tasks[downstream.id]!;
      const agent = batch.current.agents[updated.agentId]!;
      const thread = batch.current.threads[agent.threadId]!;
      const finishedAgent = batch.current.agents[finished.agentId]!;
      if (
        updated.dependsOn.every((id) => updated.inputsSatisfied.includes(id))
      ) {
        batch.emit(
          'task.state_changed',
          {
            taskId: updated.id,
            from: 'waiting',
            to: 'working',
            reason: `Received ${output.title} from ${finishedAgent.name}.`,
          },
          {
            taskId: updated.id,
            source: 'coordinator',
            adapter: SIMULATED_CONVERSATION_ADAPTER,
          },
        );
        batch.post(
          thread,
          agentAuthor(agent),
          `Received ${output.title} from ${finishedAgent.name}. Starting "${updated.title}".`,
          'chat',
          { taskId: updated.id, fromThreadId: finishedAgent.threadId },
        );
      } else {
        batch.post(
          thread,
          agentAuthor(agent),
          `Received ${output.title} from ${finishedAgent.name}. Still waiting on other inputs.`,
          'chat',
          { taskId: updated.id, fromThreadId: finishedAgent.threadId },
        );
      }
    }
  }

  decideAsk(
    projectId: ProjectId,
    agentId: AgentId,
    askId: string,
    command: AskDecisionCommand,
  ): CommandResponse {
    return this.run(command.commandId, projectId, () => {
      const projection = this.requireProjection(projectId);
      const agent = projection.agents[agentId];
      if (!agent)
        throw new ProjectCommandError('not_found', 'Agent was not found.');
      const ask = projection.asks[askId];
      if (!ask || ask.agentId !== agentId) {
        throw new ProjectCommandError('not_found', 'Ask was not found.');
      }
      if (ask.state !== 'open') {
        throw new ProjectCommandError(
          'ask_not_open',
          `This ask was already ${ask.state}.`,
        );
      }
      this.assertSequence(
        'Agent',
        agent.lastSequence,
        command.expectedSequence,
      );
      const task = projection.tasks[ask.taskId]!;
      const batch = new ProjectBatch(
        this.store,
        projectId,
        command.commandId,
        this.now(),
        projection,
      );
      const meta = { agentId, taskId: task.id, source: 'user' as const };
      batch.emit(
        'ask.decided',
        {
          askId: ask.id,
          from: 'open',
          to: command.decision,
          ...(command.note ? { note: command.note } : {}),
        },
        meta,
      );
      const thread = projection.threads[agent.threadId]!;
      if (command.decision === 'approved') {
        batch.emit(
          'task.state_changed',
          {
            taskId: task.id,
            from: 'needs_you',
            to: 'working',
            reason: `Approved: ${ask.action}.`,
          },
          meta,
        );
        if (!this.isLive) {
          batch.post(
            thread,
            agentAuthor(agent),
            `Thanks — going ahead with: ${ask.action.toLowerCase()}.`,
            'chat',
            { taskId: task.id, askId: ask.id },
          );
        }
      } else {
        batch.emit(
          'task.state_changed',
          {
            taskId: task.id,
            from: 'needs_you',
            to: 'failed',
            reason: `Denied: ${ask.action}.`,
          },
          meta,
        );
        batch.post(
          thread,
          this.isLive ? systemAuthor : agentAuthor(agent),
          this.isLive
            ? `Denied: ${ask.action.toLowerCase()}. The agent was stopped and "${task.title}" is marked failed.`
            : `Understood. Without that write I can't finish "${task.title}", so I've marked it failed. Start me again with a different approach whenever you like.`,
          'chat',
          { taskId: task.id, askId: ask.id },
        );
      }
      return batch.commit();
    });
  }

  stopAgent(
    projectId: ProjectId,
    agentId: AgentId,
    command: { commandId: string; expectedSequence: number },
  ): CommandResponse {
    return this.run(command.commandId, projectId, () => {
      const projection = this.requireProjection(projectId);
      const agent = projection.agents[agentId];
      if (!agent) {
        throw new ProjectCommandError('not_found', 'Agent was not found.');
      }
      this.assertSequence(
        'Agent',
        agent.lastSequence,
        command.expectedSequence,
      );
      const task = agent.currentTaskId
        ? projection.tasks[agent.currentTaskId]
        : undefined;
      if (!task || !['waiting', 'working', 'needs_you'].includes(task.state)) {
        throw new ProjectCommandError(
          'invalid_transition',
          `${agent.name} has nothing in progress to stop.`,
        );
      }
      const batch = new ProjectBatch(
        this.store,
        projectId,
        command.commandId,
        this.now(),
        projection,
      );
      for (const ask of Object.values(projection.asks)) {
        if (ask.taskId === task.id && ask.state === 'open') {
          batch.emit(
            'ask.decided',
            {
              askId: ask.id,
              from: 'open',
              to: 'closed',
              note: 'Closed because the task was stopped.',
            },
            { taskId: task.id, agentId, source: 'user' },
          );
        }
      }
      batch.emit(
        'task.state_changed',
        {
          taskId: task.id,
          from: task.state,
          to: 'stopped',
          reason: 'Stopped by you.',
        },
        { taskId: task.id, agentId, source: 'user' },
      );
      batch.post(
        projection.threads[agent.threadId]!,
        agentAuthor(agent),
        `Stopped "${task.title}". What I produced so far is kept.`,
        'chat',
        { taskId: task.id },
      );
      return batch.commit();
    });
  }

  // The demo project exists only when the service is started with the
  // flag. It is created once and then behaves like any user project.
  ensureDemoProject(): ProjectProjection {
    const projectId = ProjectIdSchema.parse('project_harness-demo');
    const existing = this.store.getProjection(projectId);
    if (existing) return existing;
    const commandId = 'demo-project-seed';
    this.materializeProject(
      projectId,
      commandId,
      'Account preferences loop',
      'demo',
    );
    const projection = this.requireProjection(projectId);
    const batch = new ProjectBatch(
      this.store,
      projectId,
      `${commandId}-agents`,
      this.now(),
      projection,
    );
    this.addAgent(batch, projectId, 'harness-demo_interface', {
      name: 'Interface systems',
      category: 'interface',
    });
    this.addAgent(batch, projectId, 'harness-demo_service', {
      name: 'Backend orchestration',
      category: 'orchestration',
    });
    return batch.commit().projection;
  }
}

// Reducer rejections surface as command errors with the closest code.
function translateDomainError(error: unknown): unknown {
  if (error instanceof ProjectCommandError) return error;
  if (error instanceof ProjectionError) {
    const code: CommandErrorCode =
      error.code === 'agent_busy'
        ? 'agent_busy'
        : error.code === 'thread_closed'
          ? 'thread_closed'
          : error.code === 'plan_superseded'
            ? 'plan_superseded'
            : error.code === 'missing_entity'
              ? 'not_found'
              : 'invalid_command';
    return new ProjectCommandError(code, error.message);
  }
  if (error instanceof TransitionError) {
    return new ProjectCommandError('invalid_transition', error.message);
  }
  return error;
}
