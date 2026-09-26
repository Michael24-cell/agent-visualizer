import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import {
  AGENT_MODELS,
  AgentModelSchema,
  TOOL_POLICIES,
  agentModel,
  type Activity,
  type Agent,
  type AgentModel,
  type Ask,
  type Check,
  type Message,
  type MessageContext,
  type Output,
  type ProjectResponse,
  type Proposal,
} from '@harness/contracts';
import { Markdown } from './markdown';
import {
  ApiError,
  advanceAgent,
  listRuntimeModels,
  decideAsk,
  decideProposal,
  postMessage,
  readMessages,
  readProject,
  renameAgent,
  setAgentModel,
  stopAgent,
} from './api';
import {
  liveTargetId,
  liveTargetTitle,
  workLabels,
  type LiveTarget,
} from './live';
import { runtimeLabel } from './project-notes';

// A pane on a real, persisted thread. Everything shown here came back from
// the service: messages are read by cursor, replies arrive in the command
// response, and the agent's state is the projection's, not the client's.

// Who a reply is from, when it is not the pane's own voice: another agent
// or the coordinator speaking in an agent pane, or the service itself.
function authorLabel(message: Message, target: LiveTarget): string | undefined {
  if (message.author.role === 'user') return undefined;
  if (message.author.role === 'coordinator' && target.kind === 'agent')
    return 'Coordinator';
  if (message.author.role === 'system') return 'Harness';
  return undefined;
}

// Typing into an agent pane gives it work when it has none in progress;
// while it is busy, a message is a follow-up. Slash commands:
//   /start <request>  give this agent work (same as typing when idle)
//   /chat <message>   talk without starting work
//   /stop             stop this agent's current work
function parseLiveInput(
  value: string,
):
  | { kind: 'empty' }
  | { kind: 'chat'; body: string }
  | { kind: 'chat_only'; body: string }
  | { kind: 'start'; body: string }
  | { kind: 'stop' }
  | { kind: 'unknown'; name: string } {
  const trimmed = value.trim();
  if (!trimmed) return { kind: 'empty' };
  if (!trimmed.startsWith('/')) return { kind: 'chat', body: trimmed };
  const [name, ...rest] = trimmed.slice(1).split(/\s+/);
  const body = rest.join(' ').trim();
  if (name === 'start')
    return body
      ? { kind: 'start', body }
      : { kind: 'unknown', name: 'start (needs a request)' };
  if (name === 'chat')
    return body
      ? { kind: 'chat_only', body }
      : { kind: 'unknown', name: 'chat (needs a message)' };
  if (name === 'stop') return { kind: 'stop' };
  return { kind: 'unknown', name: name ?? '' };
}

// The plan the coordinator is proposing, with what it will do and why.
function ProposalCard({
  proposal,
  project,
  busy,
  onDecide,
  onEdit,
}: {
  proposal: Proposal;
  project: ProjectResponse;
  busy: boolean;
  onDecide: (decision: 'approved' | 'denied' | 'dismissed') => void;
  onEdit: () => void;
}) {
  const plan =
    proposal.kind === 'plan'
      ? project.projection.plans[proposal.payload.planId]
      : undefined;
  const approveLabel =
    proposal.kind === 'plan'
      ? 'Assign to agents'
      : proposal.kind === 'record_request'
        ? 'Record in Brief'
        : 'Approve';
  return (
    <li className="line plan-card">
      <p>
        <strong>{proposal.title}.</strong> {proposal.summary}
      </p>
      {plan ? (
        <ol className="plan-tasks">
          {plan.tasks.map((task, index) => (
            <li key={index} className={`category-${task.category}`}>
              <span className="cat-dot" aria-hidden="true" />
              <span className="plan-task-index">{index + 1}</span>
              <span className="plan-task-title">{task.title}</span>
              <span className="plan-task-agent">
                {task.agentName}
                {task.dependsOn.length
                  ? ` · after ${task.dependsOn.map((d) => d + 1).join(', ')}`
                  : ''}
                {task.requiredChecks.length
                  ? ` · checks: ${task.requiredChecks.join(', ')}`
                  : ''}
                {task.modelTier ? ` · ${task.modelTier} model` : ''}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
      {proposal.kind === 'record_request' ? (
        <p className="ask-scope">
          {proposal.payload.category}: {proposal.payload.text}
        </p>
      ) : null}
      {proposal.consequences.effects.length ? (
        <p className="plan-why">
          {proposal.consequences.effects.map((e) => e.description).join(' ')}
        </p>
      ) : null}
      <div className="ask-actions">
        <button
          type="button"
          className="primary-action"
          disabled={busy}
          onClick={() => onDecide('approved')}
        >
          {approveLabel}
        </button>
        {proposal.kind === 'plan' ? (
          <button
            type="button"
            className="secondary-action"
            disabled={busy}
            onClick={onEdit}
          >
            Edit
          </button>
        ) : null}
        <button
          type="button"
          className="secondary-action"
          disabled={busy}
          onClick={() => onDecide('dismissed')}
        >
          Not now
        </button>
      </div>
    </li>
  );
}

function AskCard({
  ask,
  busy,
  onDecide,
}: {
  ask: Ask;
  busy: boolean;
  onDecide: (decision: 'approved' | 'denied', trust?: 'once' | 'task') => void;
}) {
  return (
    <li className="line">
      <div className="ask is-pending">
        <strong>{ask.action}</strong>
        <p>{ask.reason}</p>
        <p className="ask-scope">
          <code>{ask.scope}</code> · {ask.consequences}
        </p>
        <div className="ask-actions">
          <button
            type="button"
            className="primary-action"
            disabled={busy}
            onClick={() => onDecide('approved')}
          >
            Approve
          </button>
          <button
            type="button"
            className="secondary-action"
            disabled={busy}
            title="Approve this and every later action in this task without asking"
            onClick={() => onDecide('approved', 'task')}
          >
            Approve all for this task
          </button>
          <button
            type="button"
            className="secondary-action"
            disabled={busy}
            onClick={() => onDecide('denied')}
          >
            Deny
          </button>
        </div>
      </div>
    </li>
  );
}

// Which model this agent runs on, chosen at the bottom of the composer.
// Claude: the three tiers. OpenAI-compatible: whatever the endpoint lists.
function ModelSelect({
  project,
  agent,
  busy,
  onChoose,
}: {
  project: ProjectResponse;
  agent: Agent;
  busy: boolean;
  onChoose: (
    choice: { model?: AgentModel; endpointModel?: string },
    label: string,
  ) => void;
}) {
  const provider = project.runtime.provider;
  const [models, setModels] = useState<string[]>();
  useEffect(() => {
    if (provider !== 'openai') return;
    let active = true;
    void listRuntimeModels()
      .then((list) => {
        if (active) setModels(list);
      })
      .catch(() => {
        if (active) setModels([]);
      });
    return () => {
      active = false;
    };
  }, [provider]);

  if (provider === 'openai') {
    const current = agent.endpointModel ?? project.runtime.model ?? '';
    const options = [...new Set([current, ...(models ?? [])])].filter(Boolean);
    return (
      <label className="composer-model" title="Model for this agent">
        <span className="visually-hidden">Model for {agent.name}</span>
        <select
          value={current}
          disabled={busy}
          onChange={(event) =>
            onChoose(
              { endpointModel: event.target.value },
              shortModelName(event.target.value),
            )
          }
        >
          {options.map((id) => (
            <option key={id} value={id}>
              {shortModelName(id)}
            </option>
          ))}
        </select>
      </label>
    );
  }
  const tier = agentModel(agent);
  return (
    <label className="composer-model" title={AGENT_MODELS[tier].note}>
      <span className="visually-hidden">Model for {agent.name}</span>
      <select
        value={tier}
        disabled={busy}
        onChange={(event) => {
          const model = AgentModelSchema.parse(event.target.value);
          onChoose({ model }, AGENT_MODELS[model].label);
        }}
      >
        {AgentModelSchema.options.map((model) => (
          <option key={model} value={model}>
            {AGENT_MODELS[model].label}
          </option>
        ))}
      </select>
    </label>
  );
}

// "openai/gpt-oss-120b" → "gpt-oss-120b"; ids stay unique enough to read.
function shortModelName(id: string): string {
  return id.includes('/') ? id.slice(id.lastIndexOf('/') + 1) : id;
}

// The agent's name in the pane header; click to rename.
function AgentName({
  name,
  busy,
  onRename,
}: {
  name: string;
  busy: boolean;
  onRename: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  if (!editing) {
    return (
      <button
        type="button"
        className="pane-name"
        title="Rename"
        disabled={busy}
        onClick={() => {
          setDraft(name);
          setEditing(true);
        }}
      >
        {name}
      </button>
    );
  }
  const commit = () => {
    const next = draft.trim();
    setEditing(false);
    if (next && next !== name) onRename(next);
  };
  return (
    <input
      className="pane-name-input"
      autoFocus
      value={draft}
      maxLength={80}
      aria-label="Agent name"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit();
        if (event.key === 'Escape') setEditing(false);
      }}
    />
  );
}

function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

// The most recent tool row of a task, as "Read notes.md".
function lastToolLabel(
  project: ProjectResponse,
  agentId: string,
  taskId: string,
): string | undefined {
  const rows = toolRows(project, agentId).filter((row) =>
    row.kind === 'activity'
      ? row.activity.taskId === taskId
      : row.kind === 'check'
        ? row.check.taskId === taskId
        : row.output.taskId === taskId,
  );
  const last = rows.sort((a, b) => b.sequence - a.sequence)[0];
  if (!last) return undefined;
  if (last.kind === 'activity')
    return `${last.activity.tool} ${last.activity.target}`;
  if (last.kind === 'check') return `Bash ${last.check.command}`;
  return `Write ${last.output.title}`;
}

// A user message posted while the agent's task was running (and not the
// one that started it) was handed into that task.
function forwardedTaskTitle(
  project: ProjectResponse,
  agentId: string,
  message: Message,
): string | undefined {
  for (const task of Object.values(project.projection.tasks)) {
    if (task.agentId !== agentId) continue;
    if (task.originMessageId === message.id) continue;
    const started = task.createdAtSequence;
    const ended = task.endedAtSequence ?? Number.POSITIVE_INFINITY;
    if (message.sequence > started && message.sequence < ended) {
      return task.title.length > 40
        ? `${task.title.slice(0, 39)}…`
        : task.title;
    }
  }
  return undefined;
}

function diffSummary(diff: string): string {
  if (diff.startsWith('(diff too large')) return diff;
  let added = 0;
  let removed = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+')) added += 1;
    else if (line.startsWith('-')) removed += 1;
  }
  return `+${added} −${removed} · show diff`;
}

// What an agent did with a tool, as one row in the conversation: reads
// and searches, commands with their outcome, files written.
type ToolRow =
  | { kind: 'activity'; sequence: number; activity: Activity }
  | { kind: 'check'; sequence: number; check: Check }
  | { kind: 'output'; sequence: number; output: Output };

function toolRows(project: ProjectResponse, agentId: string): ToolRow[] {
  const rows: ToolRow[] = [];
  for (const activity of Object.values(project.projection.activities)) {
    if (activity.agentId === agentId)
      rows.push({ kind: 'activity', sequence: activity.atSequence, activity });
  }
  for (const check of Object.values(project.projection.checks)) {
    if (check.agentId === agentId)
      rows.push({ kind: 'check', sequence: check.startedAtSequence, check });
  }
  for (const output of Object.values(project.projection.outputs)) {
    if (output.agentId === agentId)
      rows.push({
        kind: 'output',
        sequence: output.producedAtSequence,
        output,
      });
  }
  return rows;
}

function ToolRowView({
  row,
  onOpenArtifact,
}: {
  row: ToolRow;
  onOpenArtifact?: ((path: string) => void) | undefined;
}) {
  const [open, setOpen] = useState(false);
  switch (row.kind) {
    case 'activity':
      return (
        <li className="tool-row">
          <span className="tool-dot" aria-hidden="true">
            ⏺
          </span>
          <span className="tool-name">{row.activity.tool}</span>
          {row.activity.tool === 'Read' && onOpenArtifact ? (
            <button
              type="button"
              className="tool-target tool-link"
              title="Open in Artifacts"
              onClick={() => onOpenArtifact(row.activity.target)}
            >
              {row.activity.target}
            </button>
          ) : (
            <span className="tool-target">{row.activity.target}</span>
          )}
          {row.activity.summary ? (
            <span className="tool-note">{row.activity.summary}</span>
          ) : null}
        </li>
      );
    case 'check': {
      const check = row.check;
      const state =
        check.state === 'running'
          ? 'running'
          : check.state === 'passed'
            ? 'passed'
            : 'failed';
      return (
        <li className={`tool-row tool-${state}`}>
          <span className="tool-dot" aria-hidden="true">
            ⏺
          </span>
          <span className="tool-name">Bash</span>
          <span className="tool-target">{check.command}</span>
          <span className="tool-note">
            {state === 'running' ? 'running' : state}
          </span>
          {check.summary ? (
            <button
              type="button"
              className={`tool-result ${open ? 'is-open' : ''}`}
              aria-expanded={open}
              onClick={() => setOpen((value) => !value)}
            >
              <span className="tool-elbow" aria-hidden="true">
                ⎿
              </span>
              <span className="tool-result-text">{check.summary}</span>
            </button>
          ) : null}
        </li>
      );
    }
    default: {
      const output = row.output;
      return (
        <li className="tool-row tool-output">
          <span className="tool-dot" aria-hidden="true">
            ⏺
          </span>
          <span className="tool-name">
            {output.kind === 'diff' ? 'Write' : 'Output'}
          </span>
          {output.location && onOpenArtifact ? (
            <button
              type="button"
              className="tool-target tool-link"
              title="Open in Artifacts"
              onClick={() => onOpenArtifact(output.location!)}
            >
              {output.title}
            </button>
          ) : (
            <span className="tool-target">{output.title}</span>
          )}
          {output.digest &&
          !/^(Wrote|Edited|Created|Edit applied)/.test(output.digest) ? (
            <span className="tool-note">{output.digest}</span>
          ) : null}
          {output.diff ? (
            <button
              type="button"
              className={`tool-result ${open ? 'is-open' : ''}`}
              aria-expanded={open}
              onClick={() => setOpen((value) => !value)}
            >
              <span className="tool-elbow" aria-hidden="true">
                ⎿
              </span>
              {open ? (
                <span className="tool-diff">
                  {output.diff.split('\n').map((line, index) => (
                    <span
                      key={index}
                      className={
                        line.startsWith('+')
                          ? 'diff-add'
                          : line.startsWith('-')
                            ? 'diff-del'
                            : line === '…'
                              ? 'diff-gap'
                              : 'diff-ctx'
                      }
                    >
                      {line}
                    </span>
                  ))}
                </span>
              ) : (
                <span className="tool-result-text">
                  {diffSummary(output.diff)}
                </span>
              )}
            </button>
          ) : null}
        </li>
      );
    }
  }
}

export function LivePane({
  project,
  target,
  canClose,
  onProject,
  onClose,
  onOpenArtifact,
  onAddToPlan,
  context = [],
  onContext,
}: {
  project: ProjectResponse;
  target: LiveTarget;
  canClose: boolean;
  onProject: (next: ProjectResponse) => void;
  onClose: () => void;
  onOpenArtifact?: (path: string) => void;
  // Keeps an idea from the conversation in the Plan document.
  onAddToPlan?: (text: string) => void;
  // What the next message points at, held by the workspace so documents
  // and artifacts can attach to the pane you are typing in.
  context?: readonly MessageContext[];
  onContext?: (next: readonly MessageContext[]) => void;
}) {
  const projectId = project.projection.projectId;
  const threadRef = liveTargetId(target);
  const [messages, setMessages] = useState<Message[]>([]);
  const [olderCursor, setOlderCursor] = useState<number>();
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dismissedFailure, setDismissedFailure] = useState<string>();
  const [now, setNow] = useState(() => Date.now());
  const agentWorking =
    target.kind === 'agent' && target.agent.work === 'working';

  // A clock for the elapsed time while the agent works.
  useEffect(() => {
    if (!agentWorking) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [agentWorking]);
  const [value, setValue] = useState('');
  const [feedback, setFeedback] = useState<string>();
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Latest page on open (the pane is keyed by thread, so opening another
  // thread mounts a fresh pane); newer messages after each command.
  useEffect(() => {
    let active = true;
    void readMessages(projectId, threadRef)
      .then((page) => {
        if (!active) return;
        setMessages(page.messages);
        setOlderCursor(page.olderCursor);
        setLoaded(true);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setFeedback(
          error instanceof Error ? error.message : 'Messages could not load.',
        );
        setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [projectId, threadRef]);

  const threadBusy = project.busyThreadIds.includes(target.thread.id);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages.length, threadBusy]);

  // Latest sequence we hold, readable from the poll without re-subscribing.
  const newestRef = useRef(0);
  useEffect(() => {
    newestRef.current = messages.at(-1)?.sequence ?? 0;
  }, [messages]);

  // One fetch at a time, and never the same message twice: the poll and
  // the "thread moved" effect can both ask for newer messages at once.
  const appendingRef = useRef<Promise<number> | undefined>(undefined);
  const appendNewer = (): Promise<number> => {
    if (appendingRef.current) return appendingRef.current;
    const work = readMessages(projectId, threadRef, {
      after: newestRef.current,
      limit: 100,
    })
      .then((page) => {
        if (page.messages.length) {
          newestRef.current = Math.max(
            newestRef.current,
            page.messages.at(-1)!.sequence,
          );
          setMessages((current) => {
            const known = new Set(current.map((message) => message.id));
            const fresh = page.messages.filter((m) => !known.has(m.id));
            return fresh.length ? [...current, ...fresh] : current;
          });
        }
        return page.messages.length;
      })
      .finally(() => {
        appendingRef.current = undefined;
      });
    appendingRef.current = work;
    return work;
  };

  // The thread moved (a refresh, another pane, the model finishing while
  // we were not polling): fetch what we do not have yet.
  const threadSequence = target.thread.lastSequence;
  useEffect(() => {
    if (!loaded || threadSequence <= newestRef.current) return;
    void appendNewer().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadSequence, loaded]);

  // While the service is producing a reply for this thread, poll for it.
  // Stops on its own when the project says the thread is no longer busy.
  useEffect(() => {
    if (!threadBusy) return;
    let active = true;
    const tick = async () => {
      try {
        await appendNewer();
        const next = await readProject(projectId);
        if (active) onProject(next);
      } catch {
        // Keep polling; a transient failure is not the user's problem.
      }
    };
    const timer = setInterval(() => void tick(), 600);
    return () => {
      active = false;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadBusy, projectId, threadRef]);

  const loadOlder = async () => {
    if (olderCursor === undefined) return;
    const page = await readMessages(projectId, threadRef, {
      before: olderCursor,
    });
    setMessages((current) => [...page.messages, ...current]);
    setOlderCursor(page.olderCursor);
  };

  const run = async (
    command: () => Promise<{ project: ProjectResponse }>,
    done: string,
  ) => {
    setBusy(true);
    try {
      const result = await command();
      onProject(result.project);
      await appendNewer();
      setFeedback(done);
      setValue('');
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        // Something moved this thread first. Refresh and let the user retry.
        onProject(await readProject(projectId));
        await appendNewer();
        setFeedback(
          error.code === 'stale_sequence'
            ? 'This conversation moved on. Refreshed — send again.'
            : error.message,
        );
      } else {
        setFeedback(
          error instanceof Error ? error.message : 'The message was not sent.',
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const parsed = parseLiveInput(value);
    if (parsed.kind === 'empty') return;
    if (parsed.kind === 'unknown') {
      setFeedback(`/${parsed.name} is not a command here. Try /chat or /stop.`);
      return;
    }
    if (parsed.kind === 'stop') {
      if (target.kind !== 'agent') {
        setFeedback(
          'The coordinator has nothing to stop. Stop agents in their own panes.',
        );
        return;
      }
      const agent = target.agent;
      void run(
        () => stopAgent(projectId, agent.id, agent.lastSequence),
        'Stopped. Everything so far is kept.',
      );
      return;
    }
    const agentIdle =
      target.kind === 'agent' &&
      !['waiting', 'working', 'needs_you'].includes(target.agent.work);
    const intent =
      parsed.kind === 'start' || (parsed.kind === 'chat' && agentIdle)
        ? 'start_work'
        : 'chat';
    if (intent === 'start_work' && target.kind !== 'agent') {
      setFeedback(
        'The coordinator does not take work directly yet. Use /start in an agent pane.',
      );
      return;
    }
    const attached = context;
    void run(
      () =>
        postMessage(projectId, threadRef, {
          expectedSequence: target.thread.lastSequence,
          body: parsed.body,
          intent,
          ...(attached.length ? { context: attached } : {}),
        }),
      intent === 'start_work' ? 'Work started.' : 'Sent.',
    ).then(() => onContext?.([]));
  };

  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  const title = liveTargetTitle(target);
  const category = target.kind === 'agent' ? target.agent.category : 'neutral';
  const work = target.kind === 'agent' ? target.agent.work : undefined;
  const currentTask =
    target.kind === 'agent' && target.agent.currentTaskId
      ? project.projection.tasks[target.agent.currentTaskId]
      : undefined;
  const canStop =
    work !== undefined && ['waiting', 'working', 'needs_you'].includes(work);
  // The Method the current task runs under, pinned when it started.
  const snapshot = currentTask?.methodSnapshotId
    ? project.projection.methodSnapshots[currentTask.methodSnapshotId]
    : undefined;
  const methodChip = snapshot
    ? {
        label: snapshot.resolved.title,
        note: `${snapshot.resolved.purpose} Tools: ${
          TOOL_POLICIES[snapshot.resolved.agentDefaults?.tools ?? 'full'].label
        }.`,
      }
    : undefined;
  const elapsed =
    currentTask?.state === 'working' && currentTask.startedAt
      ? formatElapsed(now - Date.parse(currentTask.startedAt))
      : undefined;
  const lastTool =
    target.kind === 'agent' && currentTask?.state === 'working'
      ? lastToolLabel(project, target.agent.id, currentTask.id)
      : undefined;
  const openAsk =
    target.kind === 'agent' && currentTask
      ? Object.values(project.projection.asks).find(
          (ask) => ask.taskId === currentTask.id && ask.state === 'open',
        )
      : undefined;
  // Messages and tool rows in one stream, ordered by project sequence.
  // Tool rows before the oldest loaded message stay hidden with it.
  const oldestLoaded = messages[0]?.sequence ?? 0;
  const timeline: (
    { kind: 'message'; sequence: number; message: Message } | ToolRow
  )[] = [
    ...messages.map((message) => ({
      kind: 'message' as const,
      sequence: message.sequence,
      message,
    })),
    ...(target.kind === 'agent'
      ? toolRows(project, target.agent.id).filter(
          (row) => row.sequence >= oldestLoaded,
        )
      : []),
  ].sort((a, b) => a.sequence - b.sequence);
  const openProposals =
    target.kind === 'coordinator'
      ? Object.values(project.projection.proposals)
          .filter(
            (proposal) =>
              proposal.threadId === target.thread.id &&
              proposal.state === 'open',
          )
          .sort((a, b) => a.openedAtSequence - b.openedAtSequence)
      : [];

  const advance = () => {
    if (target.kind !== 'agent') return;
    const agent = target.agent;
    void run(
      () => advanceAgent(projectId, agent.id, agent.lastSequence),
      'Next step applied.',
    );
  };
  const decideOpenAsk = (
    decision: 'approved' | 'denied',
    trust: 'once' | 'task' = 'once',
  ) => {
    if (target.kind !== 'agent' || !openAsk) return;
    const agent = target.agent;
    void run(
      () =>
        decideAsk(
          projectId,
          agent.id,
          openAsk.id,
          agent.lastSequence,
          decision,
          trust,
        ),
      decision === 'denied'
        ? 'Denied.'
        : trust === 'task'
          ? 'Approved — the rest of this task runs without asking.'
          : 'Approved.',
    );
  };
  const decideOpenProposal = (
    proposal: Proposal,
    decision: 'approved' | 'denied' | 'dismissed',
  ) =>
    void run(
      () =>
        decideProposal(projectId, proposal.id, proposal.lastSequence, decision),
      decision === 'approved'
        ? proposal.kind === 'plan'
          ? 'Assigned. Each agent has its own pane now.'
          : 'Done.'
        : 'Set aside.',
    );

  return (
    <section
      className={`pane live-pane category-${category}`}
      aria-label={`${title} conversation`}
    >
      <header className="pane-header">
        <span className="cat-dot" aria-hidden="true" />
        {target.kind === 'agent' ? (
          <AgentName
            name={title}
            busy={busy}
            onRename={(name) => {
              const agent = target.agent;
              void run(
                () =>
                  renameAgent(projectId, agent.id, agent.lastSequence, name),
                `Renamed to ${name}.`,
              );
            }}
          />
        ) : (
          <strong>{title}</strong>
        )}
        <span className="pane-task">
          {target.kind === 'agent'
            ? (currentTask?.title ?? 'Nothing in progress — type what to do')
            : 'Plans the project with you'}
        </span>
        {methodChip ? (
          <span className="pane-method" title={methodChip.note}>
            {methodChip.label}
          </span>
        ) : null}
        {work ? (
          <span className={`pane-state work-${work}`}>
            {workLabels[work]}
            {work === 'working' && elapsed ? ` · ${elapsed}` : ''}
            {work === 'working' && lastTool ? ` · ${lastTool}` : ''}
          </span>
        ) : null}
        {work === 'working' && project.runtime.mode !== 'live' ? (
          <button
            type="button"
            className="secondary-action small"
            disabled={busy}
            onClick={advance}
          >
            Next step
          </button>
        ) : null}
        {canStop && target.kind === 'agent' ? (
          <button
            type="button"
            className="danger-action small"
            disabled={busy}
            onClick={() => {
              const agent = target.agent;
              void run(
                () => stopAgent(projectId, agent.id, agent.lastSequence),
                'Stopped. Everything so far is kept.',
              );
            }}
          >
            Stop
          </button>
        ) : null}
        {canClose ? (
          <button
            type="button"
            className="pane-close"
            aria-label={`Close ${title} pane`}
            onClick={onClose}
          >
            ×
          </button>
        ) : null}
      </header>
      <div className="pane-scroll" ref={scrollRef}>
        <ol className="lines">
          {olderCursor !== undefined ? (
            <li className="line line-empty">
              <button
                type="button"
                className="quiet-button"
                onClick={() => void loadOlder()}
              >
                Show earlier messages
              </button>
            </li>
          ) : null}
          {loaded && messages.length === 0 ? (
            <li className="line line-empty">Nothing yet.</li>
          ) : null}
          {timeline.map((entry) => {
            if (entry.kind !== 'message') {
              return (
                <ToolRowView
                  key={`tool-${entry.sequence}`}
                  row={entry}
                  onOpenArtifact={onOpenArtifact}
                />
              );
            }
            const message = entry.message;
            const label = authorLabel(message, target);
            if (message.refs?.askId) {
              // The open ask is a card below; a decided one is told by
              // the tool row that follows it (or the denial message).
              const ask = project.projection.asks[message.refs.askId];
              if (
                ask &&
                message.author.role === 'agent' &&
                message.body.startsWith('Needs you:')
              ) {
                return null;
              }
            }
            const mine = message.author.role === 'user';
            const forwardedTo =
              mine && target.kind === 'agent'
                ? forwardedTaskTitle(project, target.agent.id, message)
                : undefined;
            return (
              <li
                key={message.id}
                className={`msg ${mine ? 'msg-user' : 'msg-reply'} role-${message.author.role}`}
              >
                {label ? <span className="msg-from">{label}</span> : null}
                {forwardedTo ? (
                  <span className="msg-forwarded">
                    handed to {title} · {forwardedTo}
                  </span>
                ) : null}
                {!mine && message.body.length > 1 ? (
                  <span className="msg-actions">
                    {onContext ? (
                      <button
                        type="button"
                        className="msg-quote"
                        title="Point your next message at this"
                        onClick={() =>
                          onContext([
                            ...context,
                            {
                              kind: 'message',
                              label: `${label ?? title} · message`,
                              detail: message.body.slice(0, 4_000),
                              messageId: message.id,
                            },
                          ])
                        }
                      >
                        Quote
                      </button>
                    ) : null}
                    {onAddToPlan ? (
                      <button
                        type="button"
                        className="msg-quote"
                        title="Keep this in the Plan document"
                        onClick={() => onAddToPlan(message.body)}
                      >
                        Add to Plan
                      </button>
                    ) : null}
                  </span>
                ) : null}
                {message.context?.length ? (
                  <ul className="msg-context">
                    {message.context.map((item, index) => (
                      <li
                        key={`${item.label}-${index}`}
                        title={item.detail ?? item.label}
                      >
                        {item.label}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {mine || message.author.role === 'system' ? (
                  <p>{message.body}</p>
                ) : (
                  <div className="msg-body">
                    <Markdown text={message.body} />
                  </div>
                )}
              </li>
            );
          })}
          {threadBusy ? (
            <li className="msg msg-reply msg-typing" aria-live="polite">
              <span className="typing" aria-label={`${title} is replying`}>
                <i />
                <i />
                <i />
              </span>
            </li>
          ) : null}
          {openAsk ? (
            <AskCard ask={openAsk} busy={busy} onDecide={decideOpenAsk} />
          ) : null}
          {openProposals.map((proposal) => (
            <ProposalCard
              key={proposal.id}
              proposal={proposal}
              project={project}
              busy={busy}
              onDecide={(decision) => decideOpenProposal(proposal, decision)}
              onEdit={() => {
                setFeedback(
                  'Tell me what to change: "combine into one agent", "split into two agents", "add checks", or "assign <task> to <agent>".',
                );
                inputRef.current?.focus();
              }}
            />
          ))}
        </ol>
      </div>
      {currentTask?.state === 'failed' &&
      dismissedFailure !== currentTask.id ? (
        <div className="pane-failure" role="alert">
          <strong>Failed</strong>
          <span className="pane-failure-reason">
            {currentTask.endReason ?? 'No reason was recorded.'}
          </span>
          <button
            type="button"
            className="secondary-action small"
            onClick={() => {
              setValue(currentTask.objective);
              inputRef.current?.focus();
            }}
          >
            Start again
          </button>
          <button
            type="button"
            className="pane-close"
            aria-label="Dismiss"
            onClick={() => setDismissedFailure(currentTask.id)}
          >
            ×
          </button>
        </div>
      ) : null}
      <form
        className={`composer category-${category}`}
        onSubmit={submit}
        aria-label="Message composer"
      >
        <span className="composer-rail" aria-hidden="true" />
        <div className="composer-field">
          {context.length ? (
            <ul className="context-chips" aria-label="Attached to this message">
              {context.map((item, index) => (
                <li
                  key={`${item.label}-${index}`}
                  className={`chip context-chip kind-${item.kind}`}
                >
                  <span
                    className="context-chip-label"
                    title={item.detail ?? item.label}
                  >
                    {item.label}
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${item.label}`}
                    onClick={() =>
                      onContext?.(context.filter((_, at) => at !== index))
                    }
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <textarea
            ref={inputRef}
            rows={1}
            value={value}
            placeholder={
              target.kind === 'agent'
                ? currentTask &&
                  ['waiting', 'working', 'needs_you'].includes(
                    currentTask.state,
                  )
                  ? `Message ${title}`
                  : `Tell ${title} what to do`
                : `Tell ${title} what to build`
            }
            aria-label={`Message ${title}`}
            onChange={(event) => {
              setValue(event.target.value);
              if (feedback) setFeedback(undefined);
            }}
            onKeyDown={onKey}
            disabled={busy || !loaded}
          />
          <div className="composer-bar">
            {target.kind === 'agent' && project.runtime.mode === 'live' ? (
              <ModelSelect
                project={project}
                agent={target.agent}
                busy={busy}
                onChoose={(choice, label) => {
                  const agent = target.agent;
                  void run(
                    () =>
                      setAgentModel(
                        projectId,
                        agent.id,
                        agent.lastSequence,
                        choice,
                      ),
                    `${label} from the next task on.`,
                  );
                }}
              />
            ) : (
              <span className="composer-note">
                {target.kind === 'agent'
                  ? runtimeLabel(project.runtime)
                  : 'Coordinator'}
              </span>
            )}
            {feedback ? (
              <p className="composer-feedback" role="status">
                {feedback}
              </p>
            ) : null}
          </div>
        </div>
        <button
          type="submit"
          className="composer-send"
          disabled={busy || !loaded}
        >
          Send <kbd>⏎</kbd>
        </button>
      </form>
    </section>
  );
}
