import { useEffect, useMemo, useState } from 'react';
import type { DemoRunSnapshot, WorkspaceResponse } from '@harness/contracts';
import {
  ApiError,
  advanceDemoRun,
  cancelDemoRun,
  decideApproval,
  launchDemoRun,
  readDemoRun,
  readWorkspace,
} from './api';
import {
  buildAttentionViewModel,
  buildReviewViewModel,
  buildTaskViewModels,
  describeEvent,
  isTerminalRun,
  type FixtureTaskKey,
  type TaskViewModel,
} from './model';

type LoadState =
  | { phase: 'loading' }
  | { phase: 'ready'; data: WorkspaceResponse }
  | { phase: 'error'; message: string };

const navigation = [
  ['Project', 'project'],
  ['Context', 'context'],
  ['Plan', 'plan'],
  ['Run', 'run'],
  ['Review', 'review'],
] as const;

function Icon({ name }: { name: 'arrow' | 'check' | 'pulse' | 'shield' }) {
  const paths = {
    arrow: <path d="M4 12h15m-6-6 6 6-6 6" />,
    check: <path d="m5 12 4 4L19 6" />,
    pulse: <path d="M3 12h4l2.2-5 4 10 2.2-5H21" />,
    shield: (
      <path d="M12 3 5.5 6v5.2c0 4.2 2.7 7.6 6.5 9 3.8-1.4 6.5-4.8 6.5-9V6L12 3Z" />
    ),
  };
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

function StatusPill({ task }: { task: TaskViewModel }) {
  return (
    <span className={`status-pill status-${task.state}`}>
      <span aria-hidden="true">{task.statusSymbol}</span>
      {task.stateLabel}
    </span>
  );
}

function Brand() {
  return (
    <a className="brand" href="#project" aria-label="Harness project overview">
      <span className="brand-orbit" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span>
        Harness <small>private preview</small>
      </span>
    </a>
  );
}

export function TaskRail({
  tasks,
  selected,
  onSelect,
}: {
  tasks: TaskViewModel[];
  selected: FixtureTaskKey;
  onSelect: (task: FixtureTaskKey) => void;
}) {
  const handoffComplete = tasks[0]?.state === 'completed';
  return (
    <div className="task-rail" aria-label="Two-task dependency graph">
      {tasks.map((task, index) => (
        <div className="rail-station" key={task.key}>
          <button
            type="button"
            className={`task-node category-${task.category} state-${task.state} ${
              selected === task.key ? 'is-selected' : ''
            }`}
            onClick={() => onSelect(task.key)}
            aria-pressed={selected === task.key}
            aria-label={`${task.title}, ${task.stateLabel}`}
          >
            <span className="node-sequence">0{index + 1}</span>
            <span className="node-core" aria-hidden="true">
              {task.statusSymbol}
            </span>
            <span className="node-copy">
              <strong>{task.title}</strong>
              <small>{task.agentProfile}</small>
            </span>
            <StatusPill task={task} />
          </button>
          {index === 0 ? (
            <div
              className={`handoff-edge ${handoffComplete ? 'is-complete' : ''}`}
              aria-label={
                handoffComplete
                  ? 'Contract handoff satisfied'
                  : 'Service task waits for contract evidence'
              }
            >
              <span className="edge-line" />
              <span className="edge-packet" aria-hidden="true" />
              <small>
                {handoffComplete ? 'contract received' : 'artifact handoff'}
              </small>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function TaskList({
  tasks,
  selected,
  onSelect,
}: {
  tasks: TaskViewModel[];
  selected: FixtureTaskKey;
  onSelect: (task: FixtureTaskKey) => void;
}) {
  return (
    <div className="task-table" role="table" aria-label="Plan task list">
      <div className="task-table-head" role="row">
        <span role="columnheader">Task</span>
        <span role="columnheader">Dependency</span>
        <span role="columnheader">Owner</span>
        <span role="columnheader">Status</span>
      </div>
      {tasks.map((task) => (
        <div
          role="row"
          className={`task-table-row ${
            selected === task.key ? 'is-selected' : ''
          }`}
          key={task.key}
        >
          <span role="cell">
            <button
              type="button"
              onClick={() => onSelect(task.key)}
              aria-label={`Inspect ${task.title}`}
            >
              {task.title}
            </button>
          </span>
          <span role="cell">
            {task.dependsOn.length ? 'Interface contract' : 'None'}
          </span>
          <span role="cell">{task.agentProfile}</span>
          <span role="cell">
            <StatusPill task={task} />
          </span>
        </div>
      ))}
    </div>
  );
}

export function TaskInspector({ task }: { task: TaskViewModel }) {
  return (
    <aside className={`inspector category-${task.category}`}>
      <div className="inspector-heading">
        <div>
          <p className="kicker">Selected task</p>
          <h3>{task.title}</h3>
        </div>
        <StatusPill task={task} />
      </div>
      <p className="inspector-purpose">{task.purpose}</p>
      <dl className="inspector-grid">
        <div>
          <dt>Why separate</dt>
          <dd>{task.whySeparate}</dd>
        </div>
        <div>
          <dt>Current activity</dt>
          <dd>{task.currentActivity}</dd>
        </div>
        <div>
          <dt>Assigned profile</dt>
          <dd>
            {task.agentProfile}
            {task.agentState ? ` · ${task.agentState}` : ''}
          </dd>
        </div>
        <div>
          <dt>Dependency</dt>
          <dd>
            {task.dependsOn.length
              ? 'Validated interface contract'
              : 'No upstream dependency'}
          </dd>
        </div>
      </dl>
      <div className="inspector-detail">
        <h4>Declared file scope</h4>
        {task.fileScopes.map((scope) => (
          <code key={scope}>{scope}</code>
        ))}
      </div>
      <div className="inspector-detail">
        <h4>Skills</h4>
        <div className="tag-row">
          {task.skills.map((skill) => (
            <span key={skill}>{skill}</span>
          ))}
        </div>
      </div>
      <div className="inspector-detail">
        <h4>Acceptance</h4>
        <ul
          className={`check-list ${
            task.state === 'completed' && task.evidence.length
              ? 'is-evidenced'
              : ''
          }`}
        >
          {task.acceptanceCriteria.map((criterion) => (
            <li key={criterion}>{criterion}</li>
          ))}
        </ul>
      </div>
      <div className="inspector-detail">
        <h4>Evidence</h4>
        {task.evidence.length ? (
          <ul className="evidence-list">
            {task.evidence.map((evidence) => (
              <li key={evidence}>{evidence}</li>
            ))}
          </ul>
        ) : (
          <p className="empty-note">Evidence appears here as events land.</p>
        )}
      </div>
    </aside>
  );
}

function ContextCard({
  label,
  items,
}: {
  label: string;
  items: WorkspaceResponse['workspace']['context']['rules'];
}) {
  return (
    <article className="context-card">
      <p className="kicker">{label}</p>
      {items.map((item) => (
        <div className={`context-item category-${item.category}`} key={item.id}>
          <div>
            <strong>{item.name}</strong>
            <p>{item.description}</p>
          </div>
          <div className="context-meta">
            <span>{item.enforcement}-enforced</span>
            <small>{item.provenance}</small>
          </div>
        </div>
      ))}
    </article>
  );
}

function RunControls({
  snapshot,
  busy,
  onAdvance,
  onDecision,
  onCancel,
  onLaunchNew,
}: {
  snapshot: DemoRunSnapshot;
  busy: boolean;
  onAdvance: () => void;
  onDecision: (decision: 'approved' | 'denied') => void;
  onCancel: () => void;
  onLaunchNew: () => void;
}) {
  const approval = Object.values(snapshot.projection.approvals).find(
    (item) => item.state === 'requested',
  );
  return (
    <div className="run-controls" id="run-controls">
      <div>
        <p className="kicker">Next supervised step</p>
        <strong>{snapshot.nextStepLabel}</strong>
      </div>
      <div className="control-actions">
        {snapshot.availableCommands.includes('approve') && approval ? (
          <>
            <button
              className="button button-primary"
              type="button"
              disabled={busy}
              onClick={() => onDecision('approved')}
            >
              Approve bounded write <Icon name="check" />
            </button>
            <button
              className="button button-quiet"
              type="button"
              disabled={busy}
              onClick={() => onDecision('denied')}
            >
              Deny
            </button>
          </>
        ) : null}
        {snapshot.availableCommands.includes('advance') ? (
          <button
            className="button button-primary"
            type="button"
            disabled={busy}
            onClick={onAdvance}
          >
            {snapshot.nextStepLabel} <Icon name="arrow" />
          </button>
        ) : null}
        {snapshot.availableCommands.includes('cancel') ? (
          <button
            className="button button-quiet"
            type="button"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel run
          </button>
        ) : null}
        {isTerminalRun(snapshot) ? (
          <button
            className="button button-primary"
            type="button"
            disabled={busy}
            onClick={onLaunchNew}
          >
            Launch a new run <Icon name="arrow" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function App() {
  const [loadState, setLoadState] = useState<LoadState>({ phase: 'loading' });
  const [selectedTask, setSelectedTask] = useState<FixtureTaskKey>('interface');
  const [planView, setPlanView] = useState<'graph' | 'list'>('graph');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('Loading the local project.');
  const [actionError, setActionError] = useState<string>();

  const selectAttentionTask = (nextData: WorkspaceResponse) => {
    const attention = buildAttentionViewModel(
      nextData.workspace,
      nextData.activeRun,
    );
    if (attention?.taskKey) setSelectedTask(attention.taskKey);
  };

  const load = async (refreshing = false) => {
    try {
      const data = await readWorkspace();
      setNotice(
        refreshing && data.activeRun
          ? `Refreshed from persisted state at event ${data.activeRun.projection.lastSequence}.`
          : data.activeRun
            ? `Recovered ${data.activeRun.phase.replaceAll('_', ' ')} from persisted events.`
            : 'Project context is ready for plan review.',
      );
      selectAttentionTask(data);
      setLoadState({ phase: 'ready', data });
      setActionError(undefined);
    } catch (error) {
      setLoadState({
        phase: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'The local service is unavailable.',
      });
    }
  };

  useEffect(() => {
    let active = true;
    void readWorkspace()
      .then((data) => {
        if (!active) return;
        const attention = buildAttentionViewModel(
          data.workspace,
          data.activeRun,
        );
        if (attention?.taskKey) setSelectedTask(attention.taskKey);
        setLoadState({ phase: 'ready', data });
        setNotice(
          data.activeRun
            ? `Recovered ${data.activeRun.phase.replaceAll('_', ' ')} from persisted events.`
            : 'Project context is ready for plan review.',
        );
      })
      .catch((error: unknown) => {
        if (!active) return;
        setLoadState({
          phase: 'error',
          message:
            error instanceof Error
              ? error.message
              : 'The local service is unavailable.',
        });
      });
    return () => {
      active = false;
    };
  }, []);

  const data = loadState.phase === 'ready' ? loadState.data : undefined;
  const snapshot = data?.activeRun;
  const tasks = useMemo(
    () => (data ? buildTaskViewModels(data.workspace, snapshot) : []),
    [data, snapshot],
  );
  const selected = tasks.find((task) => task.key === selectedTask) ?? tasks[0];

  const updateRun = (next: DemoRunSnapshot, message: string) => {
    if (loadState.phase !== 'ready') return;
    const attention = buildAttentionViewModel(loadState.data.workspace, next);
    if (attention?.taskKey) setSelectedTask(attention.taskKey);
    setLoadState({
      phase: 'ready',
      data: { ...loadState.data, activeRun: next },
    });
    setNotice(message);
    setActionError(undefined);
  };

  const runAction = async (
    action: () => Promise<DemoRunSnapshot>,
    message: string,
  ) => {
    setBusy(true);
    try {
      updateRun(await action(), message);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        try {
          const refreshed = await readWorkspace();
          selectAttentionTask(refreshed);
          setLoadState({ phase: 'ready', data: refreshed });
          setActionError(undefined);
          setNotice(
            'The run changed before that command completed. Refreshed from persisted state.',
          );
        } catch (refreshError) {
          setActionError(
            refreshError instanceof Error
              ? refreshError.message
              : 'The run changed, but its latest state could not be refreshed.',
          );
        }
      } else {
        setActionError(
          error instanceof Error ? error.message : 'The command could not run.',
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const launch = async () => {
    if (!data) return;
    setBusy(true);
    try {
      const runId = await launchDemoRun(data.workspace.plan.id);
      setSelectedTask('interface');
      updateRun(
        await readDemoRun(runId),
        'Run launched. The interface task is now active.',
      );
      document.querySelector('#run')?.scrollIntoView({ behavior: 'smooth' });
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : 'The run could not launch.',
      );
    } finally {
      setBusy(false);
    }
  };

  if (loadState.phase === 'loading') {
    return (
      <main className="loading-screen" aria-live="polite">
        <Brand />
        <div className="loading-orbit" aria-hidden="true" />
        <p>Reconstructing the local workspace…</p>
      </main>
    );
  }

  if (loadState.phase === 'error') {
    return (
      <main className="loading-screen error-screen">
        <Brand />
        <p className="kicker">Local service unavailable</p>
        <h1>The workspace could not be reconstructed.</h1>
        <p>{loadState.message}</p>
        <button
          className="button button-primary"
          type="button"
          onClick={() => void load()}
        >
          Retry connection
        </button>
      </main>
    );
  }

  if (!data || !selected) return null;
  const { workspace } = data;
  const pendingApproval = snapshot
    ? Object.values(snapshot.projection.approvals).find(
        (approval) => approval.state === 'requested',
      )
    : undefined;
  const terminal = isTerminalRun(snapshot);
  const review = buildReviewViewModel(snapshot);
  const attention = buildAttentionViewModel(workspace, snapshot);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="topbar">
        <Brand />
        <nav aria-label="Primary navigation">
          {navigation.map(([label, anchor]) => (
            <a href={`#${anchor}`} key={anchor}>
              {label}
            </a>
          ))}
        </nav>
        <div className="topbar-status">
          {attention ? (
            <a
              className="attention-chip"
              href="#run"
              onClick={() => {
                if (attention.taskKey) setSelectedTask(attention.taskKey);
              }}
            >
              <span aria-hidden="true">!</span> {attention.title}
            </a>
          ) : null}
          <button
            type="button"
            className="connection-badge"
            onClick={() => void load(true)}
            aria-label="Refresh run state from persisted events"
          >
            <span aria-hidden="true" />
            <span className="refresh-copy">Refresh run state</span>
            <span aria-hidden="true">·</span>
            {snapshot?.projection.lastSequence ?? 0}
          </button>
        </div>
      </header>

      <main id="main-content">
        <section className="project-hero section-shell" id="project">
          <div className="hero-copy">
            <p className="eyebrow">Project / {workspace.project.repository}</p>
            <h1>
              See the work.
              <br />
              Trust the handoff.
            </h1>
            <p className="lede">{workspace.project.summary}</p>
            <div className="hero-actions">
              <a className="button button-primary" href="#plan">
                Review the plan <Icon name="arrow" />
              </a>
              <span className="local-note">
                <Icon name="shield" /> Local fixture · no provider connected
              </span>
            </div>
          </div>
          <div className="project-brief" aria-label="Project summary">
            <div className="brief-index">AV / 02</div>
            <div>
              <span>Branch</span>
              <strong>{workspace.project.branch}</strong>
            </div>
            <div>
              <span>Stack</span>
              <strong>{workspace.project.stack.join(' · ')}</strong>
            </div>
            <div>
              <span>Instruction findings</span>
              <strong>
                {workspace.project.instructionFindings.length} reviewed
              </strong>
            </div>
            <div>
              <span>Validation</span>
              <strong>
                {workspace.project.validationCapabilities.length} capabilities
              </strong>
            </div>
          </div>
        </section>

        <section
          className="assessment section-shell"
          aria-labelledby="assessment-title"
        >
          <div className="section-heading">
            <div>
              <p className="kicker">Instruction assessment</p>
              <h2 id="assessment-title">The boundaries that shape this run.</h2>
            </div>
            <p>
              Three repository findings are compiled into the fixture context
              before work begins.
            </p>
          </div>
          <div className="finding-list">
            {workspace.project.instructionFindings.map((finding, index) => (
              <article key={finding.title}>
                <span>0{index + 1}</span>
                <div>
                  <h3>{finding.title}</h3>
                  <p>{finding.detail}</p>
                </div>
                <small>{finding.status}</small>
              </article>
            ))}
          </div>
        </section>

        <section
          className="context-section section-shell"
          id="context"
          aria-labelledby="context-title"
        >
          <div className="section-heading">
            <div>
              <p className="kicker">Context stack</p>
              <h2 id="context-title">
                A visible brief, not invisible prompt glue.
              </h2>
            </div>
            <div className="methodology-stamp">
              <span>{workspace.context.methodology.version}</span>
              <strong>{workspace.context.methodology.name}</strong>
              <small>{workspace.context.methodology.provenance}</small>
            </div>
          </div>
          <p className="section-intro">
            {workspace.context.methodology.summary}
          </p>
          <div className="context-grid">
            <ContextCard label="Rules" items={workspace.context.rules} />
            <ContextCard
              label="Selected skills"
              items={workspace.context.skills}
            />
            <ContextCard
              label="Validators"
              items={workspace.context.validators}
            />
          </div>
        </section>

        <section
          className="plan-section"
          id="plan"
          aria-labelledby="plan-title"
        >
          <div className="section-shell">
            <div className="section-heading plan-heading">
              <div>
                <p className="kicker">Approved plan / {workspace.plan.id}</p>
                <h2 id="plan-title">Two tasks. One deliberate handoff.</h2>
              </div>
              <p>{workspace.plan.narrative}</p>
            </div>
            <div className="plan-toolbar">
              <div className="segmented" aria-label="Plan view">
                <button
                  type="button"
                  aria-pressed={planView === 'graph'}
                  onClick={() => setPlanView('graph')}
                >
                  Graph
                </button>
                <button
                  type="button"
                  aria-pressed={planView === 'list'}
                  onClick={() => setPlanView('list')}
                >
                  Accessible list
                </button>
              </div>
              <div className="agent-rationale">
                <span>Why two agents</span>
                <p>{workspace.plan.agentCountRationale}</p>
              </div>
            </div>
            <div className="plan-workspace">
              <div className="plan-canvas">
                {planView === 'graph' ? (
                  <TaskRail
                    tasks={tasks}
                    selected={selectedTask}
                    onSelect={setSelectedTask}
                  />
                ) : (
                  <TaskList
                    tasks={tasks}
                    selected={selectedTask}
                    onSelect={setSelectedTask}
                  />
                )}
                <div className="plan-notes">
                  <div>
                    <p className="kicker">Risk watch</p>
                    <ul>
                      {workspace.plan.risks.map((risk) => (
                        <li key={risk}>{risk}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="kicker">Validation contract</p>
                    <p>{workspace.plan.validationSummary}</p>
                  </div>
                </div>
                {!snapshot || terminal ? (
                  <button
                    className="button button-launch"
                    type="button"
                    disabled={busy}
                    onClick={() => void launch()}
                  >
                    {terminal ? 'Launch a new run' : 'Approve plan and launch'}{' '}
                    <Icon name="arrow" />
                  </button>
                ) : (
                  <a className="button button-launch" href="#run">
                    Open current run <Icon name="arrow" />
                  </a>
                )}
              </div>
              <TaskInspector task={selected} />
            </div>
          </div>
        </section>

        <section
          className="run-section section-shell"
          id="run"
          aria-labelledby="run-title"
        >
          <div className="section-heading">
            <div>
              <p className="kicker">Live supervision</p>
              <h2 id="run-title">The map follows evidence, not narration.</h2>
            </div>
            <div
              className={`run-state ${snapshot ? `phase-${snapshot.phase}` : ''}`}
            >
              <Icon name="pulse" />
              <span>
                {snapshot
                  ? snapshot.phase.replaceAll('_', ' ')
                  : 'not launched'}
              </span>
            </div>
          </div>

          {attention ? (
            <a
              className="run-attention"
              href="#run-controls"
              onClick={() => {
                if (attention.taskKey) setSelectedTask(attention.taskKey);
              }}
            >
              <span aria-hidden="true">!</span>
              <span>
                <strong>{attention.title}</strong>
                <small>{attention.detail}</small>
              </span>
              <span>Review now →</span>
            </a>
          ) : null}

          {snapshot ? (
            <>
              {pendingApproval ? (
                <aside
                  className="approval-banner"
                  aria-labelledby="approval-title"
                >
                  <div className="approval-mark" aria-hidden="true">
                    !
                  </div>
                  <div>
                    <p className="kicker">Decision required</p>
                    <h3 id="approval-title">
                      {pendingApproval.requestedAction}
                    </h3>
                    <p>{pendingApproval.reason}</p>
                    <dl>
                      <div>
                        <dt>Scope</dt>
                        <dd>{pendingApproval.scope}</dd>
                      </div>
                      <div>
                        <dt>Consequence</dt>
                        <dd>{pendingApproval.consequences}</dd>
                      </div>
                    </dl>
                  </div>
                  <span className="approval-count">1 pending</span>
                </aside>
              ) : null}
              <div className="live-map">
                <TaskRail
                  tasks={tasks}
                  selected={selectedTask}
                  onSelect={setSelectedTask}
                />
              </div>
              <RunControls
                snapshot={snapshot}
                busy={busy}
                onAdvance={() =>
                  void runAction(
                    () => advanceDemoRun(snapshot),
                    'The next deterministic event group was applied.',
                  )
                }
                onDecision={(decision) => {
                  if (!pendingApproval) return;
                  void runAction(
                    () =>
                      decideApproval(snapshot, pendingApproval.id, decision),
                    decision === 'approved'
                      ? 'Approval recorded. Service work resumed.'
                      : 'Approval denied. The run stopped safely.',
                  );
                }}
                onCancel={() =>
                  void runAction(
                    () => cancelDemoRun(snapshot),
                    'The run was cancelled and persisted.',
                  )
                }
                onLaunchNew={() => void launch()}
              />
              <div className="run-lower-grid">
                <TaskInspector task={selected} />
                <div className="event-ledger">
                  <div className="ledger-heading">
                    <div>
                      <p className="kicker">Recent domain events</p>
                      <h3>Execution ledger</h3>
                    </div>
                    <span>{snapshot.events.length} total</span>
                  </div>
                  <ol>
                    {snapshot.events
                      .slice(-7)
                      .reverse()
                      .map((event) => (
                        <li key={event.id}>
                          <span>{String(event.sequence).padStart(2, '0')}</span>
                          <div>
                            <strong>
                              {describeEvent(event, snapshot.projection)}
                            </strong>
                            <small>
                              {event.source} · {event.type}
                            </small>
                          </div>
                        </li>
                      ))}
                  </ol>
                </div>
              </div>
            </>
          ) : (
            <div className="empty-run">
              <span className="empty-run-icon" aria-hidden="true">
                ◇
              </span>
              <h3>No active run yet.</h3>
              <p>
                Approve the pinned two-task plan to create the first
                authoritative events.
              </p>
              <a className="button button-primary" href="#plan">
                Review plan
              </a>
            </div>
          )}
        </section>

        <section
          className="review-section"
          id="review"
          aria-labelledby="review-title"
        >
          <div className="section-shell">
            <div className="section-heading">
              <div>
                <p className="kicker">Review and evidence</p>
                <h2 id="review-title">
                  Evidence keeps its history and status.
                </h2>
              </div>
              <p>
                The review separates historical warnings from the latest
                blocking evidence.
              </p>
            </div>
            <div className="review-grid">
              <article className={`review-verdict review-${review.state}`}>
                <span
                  className={`verdict-mark ${
                    review.state === 'ready' ? 'is-complete' : ''
                  }`}
                  aria-hidden="true"
                >
                  {review.mark}
                </span>
                <p className="kicker">Run verdict</p>
                <h3>{review.title}</h3>
                <p>{review.description}</p>
                {terminal ? (
                  <button
                    className="button button-quiet review-relaunch"
                    type="button"
                    disabled={busy}
                    onClick={() => void launch()}
                  >
                    Launch a new run <Icon name="arrow" />
                  </button>
                ) : null}
              </article>
              <article className="review-evidence">
                <p className="kicker">Validation trail</p>
                {snapshot &&
                Object.values(snapshot.projection.validations).length ? (
                  Object.values(snapshot.projection.validations).map(
                    (validation) => (
                      <div
                        className={`validation-row validation-${validation.status}`}
                        key={validation.id}
                      >
                        <span aria-hidden="true">
                          {validation.status === 'passed'
                            ? '✓'
                            : validation.status === 'failed'
                              ? '×'
                              : '…'}
                        </span>
                        <div>
                          <strong>{validation.validatorType}</strong>
                          <p>
                            {validation.outputSummary ?? 'Validation running.'}
                          </p>
                        </div>
                        <small>{validation.status}</small>
                      </div>
                    ),
                  )
                ) : (
                  <p className="empty-note">No validation evidence yet.</p>
                )}
              </article>
              {review.hasDiffArtifact ? (
                <article className="diff-summary">
                  <p className="kicker">Diff artifact fixture</p>
                  <h3>Preferences loop</h3>
                  <div className="diff-stats">
                    <span>
                      <b>4</b> files
                    </span>
                    <span>
                      <b>+186</b> added
                    </span>
                    <span>
                      <b>−24</b> removed
                    </span>
                  </div>
                  <ul>
                    <li>Shared preferences request contract</li>
                    <li>Authenticated local service route</li>
                    <li>Mobile focus repair and tests</li>
                  </ul>
                  <small>
                    Fixture only · no repository files were changed by the
                    simulated run
                  </small>
                </article>
              ) : (
                <article className="diff-summary diff-empty">
                  <p className="kicker">Diff evidence</p>
                  <h3>No diff artifact recorded</h3>
                  <p>
                    Diff statistics appear only after this run produces a diff
                    artifact.
                  </p>
                </article>
              )}
              <article className="warning-summary">
                <p className="kicker">Warnings</p>
                <h3>{review.warningTitle}</h3>
                <p>{review.warningDescription}</p>
              </article>
            </div>
          </div>
        </section>

        <section
          className="capability-section section-shell"
          aria-labelledby="capability-title"
        >
          <div className="section-heading">
            <div>
              <p className="kicker">Agents and skills</p>
              <h2 id="capability-title">
                Enough capability context. No atlas yet.
              </h2>
            </div>
            <p>
              Active, recommended, and dormant capabilities remain distinct
              without implying execution state.
            </p>
          </div>
          <div className="capability-list">
            {workspace.capabilities.map((capability) => (
              <article
                className={`category-${capability.category} availability-${capability.availability}`}
                key={capability.name}
              >
                <span className="capability-node" aria-hidden="true" />
                <div>
                  <h3>{capability.name}</h3>
                  <p>{capability.description}</p>
                </div>
                <small>{capability.availability}</small>
              </article>
            ))}
          </div>
        </section>
      </main>

      {actionError ? (
        <div className="toast toast-error" role="alert">
          {actionError}
        </div>
      ) : null}
      <div className="sr-live" aria-live="polite" aria-atomic="true">
        {notice}
      </div>
      <footer>
        <span>Visual Agent Harness · Increment 2</span>
        <span>Event-derived · local only · deterministic fixture</span>
      </footer>
    </div>
  );
}
