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
  agentModel,
  type Ask,
  type Message,
  type ProjectResponse,
  type Proposal,
} from '@harness/contracts';
import {
  ApiError,
  advanceAgent,
  decideAsk,
  decideProposal,
  postMessage,
  readMessages,
  readProject,
  setAgentModel,
  stopAgent,
} from './api';
import {
  liveTargetId,
  liveTargetTitle,
  workLabels,
  type LiveTarget,
} from './live';

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

// Slash commands understood in a live pane. Anything else is a chat message.
//   /start <request>  give this agent work (start_work intent)
//   /stop             stop this agent's current work
function parseLiveInput(
  value: string,
):
  | { kind: 'empty' }
  | { kind: 'chat'; body: string }
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
  onDecide: (decision: 'approved' | 'denied') => void;
}) {
  return (
    <li className="line">
      <div className="ask is-pending">
        <strong>{ask.action}</strong>
        <p>{ask.reason}</p>
        <p className="ask-scope">
          Would write to <code>{ask.scope}</code> · {ask.consequences}
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
            onClick={() => onDecide('denied')}
          >
            Deny
          </button>
        </div>
      </div>
    </li>
  );
}

export function LivePane({
  project,
  target,
  canClose,
  onProject,
  onClose,
}: {
  project: ProjectResponse;
  target: LiveTarget;
  canClose: boolean;
  onProject: (next: ProjectResponse) => void;
  onClose: () => void;
}) {
  const projectId = project.projection.projectId;
  const threadRef = liveTargetId(target);
  const [messages, setMessages] = useState<Message[]>([]);
  const [olderCursor, setOlderCursor] = useState<number>();
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
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

  const appendNewer = async () => {
    const page = await readMessages(projectId, threadRef, {
      after: newestRef.current,
      limit: 100,
    });
    if (page.messages.length) {
      setMessages((current) => [...current, ...page.messages]);
    }
    return page.messages.length;
  };

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
      setFeedback(
        `/${parsed.name} is not a command here. Try /start or /stop.`,
      );
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
    const intent = parsed.kind === 'start' ? 'start_work' : 'chat';
    if (intent === 'start_work' && target.kind !== 'agent') {
      setFeedback(
        'The coordinator does not take work directly yet. Use /start in an agent pane.',
      );
      return;
    }
    void run(
      () =>
        postMessage(projectId, threadRef, {
          expectedSequence: target.thread.lastSequence,
          body: parsed.body,
          intent,
        }),
      intent === 'start_work' ? 'Work started.' : 'Sent.',
    );
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
  const openAsk =
    target.kind === 'agent' && currentTask
      ? Object.values(project.projection.asks).find(
          (ask) => ask.taskId === currentTask.id && ask.state === 'open',
        )
      : undefined;
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
  const decideOpenAsk = (decision: 'approved' | 'denied') => {
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
        ),
      decision === 'approved' ? 'Approved.' : 'Denied.',
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
        <strong>{title}</strong>
        <span className="pane-task">
          {target.kind === 'agent'
            ? (currentTask?.title ??
              'No task yet — type to talk, /start to give it work')
            : 'Plans the project with you'}
        </span>
        {target.kind === 'agent' ? (
          <label className="pane-model">
            <span className="visually-hidden">Model for {title}</span>
            <select
              value={agentModel(target.agent)}
              disabled={busy}
              title={AGENT_MODELS[agentModel(target.agent)].note}
              onChange={(event) => {
                const agent = target.agent;
                const model = AgentModelSchema.parse(event.target.value);
                void run(
                  () =>
                    setAgentModel(
                      projectId,
                      agent.id,
                      agent.lastSequence,
                      model,
                    ),
                  `${AGENT_MODELS[model].label} from the next step on.`,
                );
              }}
            >
              {AgentModelSchema.options.map((model) => (
                <option key={model} value={model}>
                  {AGENT_MODELS[model].label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {work ? (
          <span className={`pane-state work-${work}`}>{workLabels[work]}</span>
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
          {messages.map((message) => {
            const label = authorLabel(message, target);
            if (
              message.refs?.askId &&
              openAsk &&
              message.refs.askId === openAsk.id
            ) {
              // The ask itself is rendered as a card below, not as prose.
              return null;
            }
            const mine = message.author.role === 'user';
            return (
              <li
                key={message.id}
                className={`msg ${mine ? 'msg-user' : 'msg-reply'} role-${message.author.role}`}
              >
                {label ? <span className="msg-from">{label}</span> : null}
                <p>{message.body}</p>
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
      <form
        className={`composer category-${category}`}
        onSubmit={submit}
        aria-label="Message composer"
      >
        <span className="composer-rail" aria-hidden="true" />
        <div className="composer-field">
          <textarea
            ref={inputRef}
            rows={1}
            value={value}
            placeholder={
              target.kind === 'agent'
                ? `Message ${title} · /start to give it work`
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
          {feedback ? (
            <p className="composer-feedback" role="status">
              {feedback}
            </p>
          ) : null}
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
