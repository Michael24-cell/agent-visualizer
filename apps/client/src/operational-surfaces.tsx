import type { DemoRunSnapshot, WorkspaceFixture } from '@harness/contracts';
import type { CSSProperties, ReactNode } from 'react';
import {
  buildReviewViewModel,
  describeEvent,
  isTerminalRun,
  type FixtureTaskKey,
  type TaskViewModel,
} from './model';

export function StatusPill({ task }: { task: TaskViewModel }) {
  return (
    <span className={`status-pill status-${task.state}`}>
      <span aria-hidden="true">{task.statusSymbol}</span>
      {task.stateLabel}
    </span>
  );
}

export function TaskGraph({
  tasks,
  selected,
  onSelect,
  label = 'Task dependency graph',
}: {
  tasks: TaskViewModel[];
  selected: FixtureTaskKey;
  onSelect: (task: FixtureTaskKey) => void;
  label?: string;
}) {
  const handoffComplete = tasks[0]?.state === 'completed';
  return (
    <div className="task-graph" aria-label={label}>
      <div
        className={`dependency-line ${handoffComplete ? 'is-satisfied' : ''}`}
      >
        <span aria-hidden="true" />
        <small>
          {handoffComplete
            ? 'contract evidence received'
            : 'artifact dependency'}
        </small>
      </div>
      {tasks.map((task, index) => (
        <button
          type="button"
          className={`task-node graph-node category-${task.category} state-${task.state} ${
            selected === task.key ? 'is-selected' : ''
          }`}
          key={task.key}
          onClick={() => onSelect(task.key)}
          aria-pressed={selected === task.key}
          aria-label={`${task.title}, ${task.stateLabel}`}
          style={{ '--node-order': index } as CSSProperties}
        >
          <span className="node-index">0{index + 1}</span>
          <span className="node-dot" aria-hidden="true">
            {task.statusSymbol}
          </span>
          <span className="node-text">
            <strong>{task.title}</strong>
            <small>{task.currentActivity}</small>
          </span>
          <StatusPill task={task} />
        </button>
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
    <div className="task-list" role="table" aria-label="Task list">
      <div className="task-list-head" role="row">
        <span role="columnheader">Task</span>
        <span role="columnheader">Dependency</span>
        <span role="columnheader">Owner</span>
        <span role="columnheader">State</span>
      </div>
      {tasks.map((task) => (
        <div
          role="row"
          className={`task-list-row task-table-row category-${task.category} ${
            selected === task.key ? 'is-selected' : ''
          }`}
          key={task.key}
        >
          <span role="cell">
            <button
              type="button"
              aria-label={`Inspect ${task.title}`}
              onClick={() => onSelect(task.key)}
            >
              <strong>{task.title}</strong>
              <small>{task.currentActivity}</small>
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
  const evidenced = task.state === 'completed' && task.evidence.length > 0;
  return (
    <aside
      className={`task-inspector category-${task.category}`}
      aria-label="Selected task inspector"
    >
      <div className="inspector-rail" aria-hidden="true" />
      <header className="inspector-header">
        <div>
          <p className="eyebrow">Selected task</p>
          <h2>{task.title}</h2>
        </div>
        <StatusPill task={task} />
      </header>

      <section className="inspector-section">
        <p className="inspector-lede">{task.purpose}</p>
        <dl className="answer-list">
          <div>
            <dt>Current activity</dt>
            <dd>{task.currentActivity}</dd>
          </div>
          <div>
            <dt>Why separate</dt>
            <dd>{task.whySeparate}</dd>
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
      </section>

      <section className="inspector-section">
        <h3>Scope and skills</h3>
        <div className="code-stack">
          {task.fileScopes.map((scope) => (
            <code key={scope}>{scope}</code>
          ))}
        </div>
        <div className="tag-row">
          {task.skills.map((skill) => (
            <span key={skill}>{skill}</span>
          ))}
        </div>
      </section>

      <section className="inspector-section">
        <h3>Acceptance</h3>
        <ul
          className={`criteria-list check-list ${evidenced ? 'is-evidenced' : ''}`}
        >
          {task.acceptanceCriteria.map((criterion) => (
            <li key={criterion}>
              <span aria-hidden="true">{evidenced ? '✓' : '○'}</span>
              {criterion}
            </li>
          ))}
        </ul>
      </section>

      <section className="inspector-section">
        <h3>Evidence</h3>
        {task.evidence.length ? (
          <ul className="evidence-list">
            {task.evidence.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : (
          <p className="empty-copy">
            Evidence appears as the service records it.
          </p>
        )}
      </section>
    </aside>
  );
}

function SurfaceHeading({
  eyebrow,
  title,
  description,
  aside,
}: {
  eyebrow: string;
  title: string;
  description: string;
  aside?: ReactNode;
}) {
  return (
    <header className="surface-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {aside ? <div className="surface-heading-aside">{aside}</div> : null}
    </header>
  );
}

export function ProjectSurface({ workspace }: { workspace: WorkspaceFixture }) {
  return (
    <section
      className="surface project-surface"
      aria-labelledby="project-title"
    >
      <SurfaceHeading
        eyebrow="Project / assessment"
        title={workspace.project.name}
        description={workspace.project.summary}
        aside={
          <span className="truth-badge">Fixture assessment · local only</span>
        }
      />
      <div className="project-strip" aria-label="Project context">
        <div>
          <span>Repository</span>
          <strong>{workspace.project.repository}</strong>
        </div>
        <div>
          <span>Branch</span>
          <strong>{workspace.project.branch}</strong>
        </div>
        <div>
          <span>Stack</span>
          <strong>{workspace.project.stack.join(' · ')}</strong>
        </div>
      </div>
      <div className="project-columns">
        <section className="quiet-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Assessment findings</p>
              <h2 id="project-title">Known operating boundaries</h2>
            </div>
            <span>
              {workspace.project.instructionFindings.length} fixture findings
            </span>
          </div>
          <ol className="finding-list">
            {workspace.project.instructionFindings.map((finding, index) => (
              <li key={finding.title}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <div>
                  <strong>{finding.title}</strong>
                  <p>{finding.detail}</p>
                </div>
                <small>{finding.status}</small>
              </li>
            ))}
          </ol>
        </section>
        <aside className="next-action-panel">
          <p className="eyebrow">Highest-priority next action</p>
          <h2>Review the pinned two-task plan</h2>
          <p>
            The scanner is not connected yet. These schema-validated fixture
            findings establish the direction without claiming repository
            intelligence.
          </p>
          <div className="validation-list">
            {workspace.project.validationCapabilities.map((capability) => (
              <span key={capability}>✓ {capability}</span>
            ))}
          </div>
        </aside>
      </div>
    </section>
  );
}

function ContextGroup({
  label,
  items,
}: {
  label: string;
  items: WorkspaceFixture['context']['rules'];
}) {
  return (
    <section className="context-group">
      <header>
        <h2>{label}</h2>
        <span>{items.length}</span>
      </header>
      {items.map((item) => (
        <article
          className={`context-item category-${item.category}`}
          key={item.id}
        >
          <span className="context-dot" aria-hidden="true" />
          <div>
            <strong>{item.name}</strong>
            <p>{item.description}</p>
            <small>{item.provenance}</small>
          </div>
          <span className="enforcement">{item.enforcement}</span>
        </article>
      ))}
    </section>
  );
}

export function ContextSurface({ workspace }: { workspace: WorkspaceFixture }) {
  return (
    <section
      className="surface context-surface"
      aria-labelledby="context-title"
    >
      <SurfaceHeading
        eyebrow="Methodologies / context stack"
        title={workspace.context.methodology.name}
        description={workspace.context.methodology.summary}
        aside={
          <div className="method-stamp">
            <span>Version {workspace.context.methodology.version}</span>
            <strong>Fixture only</strong>
            <small>{workspace.context.methodology.provenance}</small>
          </div>
        }
      />
      <div className="context-map" aria-hidden="true">
        <span className="context-hub">Method</span>
        <i className="line-one" />
        <i className="line-two" />
        <i className="line-three" />
        <span className="context-satellite cyan">Rules</span>
        <span className="context-satellite amber">Skills</span>
        <span className="context-satellite orchid">Validators</span>
      </div>
      <div className="context-groups">
        <ContextGroup label="Hard rules" items={workspace.context.rules} />
        <ContextGroup label="Applied skills" items={workspace.context.skills} />
        <ContextGroup label="Validators" items={workspace.context.validators} />
      </div>
      <p className="boundary-note">
        Guided summary is available. Editing, compilation, conflict resolution,
        publishing, and expert manifests begin in Increment 4.
      </p>
    </section>
  );
}

export function PlanSurface({
  workspace,
  tasks,
  selected,
  view,
  onSelect,
  onView,
  onLaunch,
  onOpenRun,
  hasRun,
  terminal,
  busy,
}: {
  workspace: WorkspaceFixture;
  tasks: TaskViewModel[];
  selected: FixtureTaskKey;
  view: 'graph' | 'list';
  onSelect: (task: FixtureTaskKey) => void;
  onView: (view: 'graph' | 'list') => void;
  onLaunch: () => void;
  onOpenRun: () => void;
  hasRun: boolean;
  terminal: boolean;
  busy: boolean;
}) {
  const selectedTask = tasks.find((task) => task.key === selected) ?? tasks[0];
  if (!selectedTask) return null;
  return (
    <section className="surface plan-surface" aria-labelledby="plan-title">
      <SurfaceHeading
        eyebrow={`Plan / ${workspace.plan.id}`}
        title="Two tasks. One deliberate handoff."
        description={workspace.plan.narrative}
        aside={<span className="truth-badge">Read-only simulated plan</span>}
      />
      <div className="surface-toolbar">
        <div className="segmented" aria-label="Plan view">
          <button
            type="button"
            aria-pressed={view === 'graph'}
            onClick={() => onView('graph')}
          >
            Graph
          </button>
          <button
            type="button"
            aria-pressed={view === 'list'}
            onClick={() => onView('list')}
          >
            List
          </button>
        </div>
        <p>
          <strong>Why two:</strong> {workspace.plan.agentCountRationale}
        </p>
      </div>
      <div className="workspace-with-inspector">
        <div className="workspace-canvas">
          {view === 'graph' ? (
            <TaskGraph tasks={tasks} selected={selected} onSelect={onSelect} />
          ) : (
            <TaskList tasks={tasks} selected={selected} onSelect={onSelect} />
          )}
          <div className="plan-footnotes">
            <div>
              <p className="eyebrow">Risk / approval</p>
              <ul>
                {workspace.plan.risks.map((risk) => (
                  <li key={risk}>{risk}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="eyebrow">Validation contract</p>
              <p>{workspace.plan.validationSummary}</p>
            </div>
          </div>
          {!hasRun || terminal ? (
            <button
              className="primary-action"
              type="button"
              disabled={busy}
              onClick={onLaunch}
            >
              {terminal ? 'Launch a new run' : 'Approve plan and launch'}{' '}
              <span aria-hidden="true">→</span>
            </button>
          ) : (
            <button
              className="primary-action"
              type="button"
              onClick={onOpenRun}
            >
              Open current run <span aria-hidden="true">→</span>
            </button>
          )}
        </div>
        <TaskInspector task={selectedTask} />
      </div>
    </section>
  );
}

export function RunControls({
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
    <div className="run-controls" aria-label="Run controls">
      <div>
        <p className="eyebrow">Next supervised step</p>
        <strong>{snapshot.nextStepLabel}</strong>
      </div>
      <div className="control-actions">
        {snapshot.availableCommands.includes('approve') && approval ? (
          <>
            <button
              className="primary-action"
              type="button"
              disabled={busy}
              onClick={() => onDecision('approved')}
            >
              Approve bounded write
            </button>
            <button
              className="secondary-action"
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
            className="primary-action"
            type="button"
            disabled={busy}
            onClick={onAdvance}
          >
            {snapshot.nextStepLabel} <span aria-hidden="true">→</span>
          </button>
        ) : null}
        {snapshot.availableCommands.includes('cancel') ? (
          <button
            className="danger-action"
            type="button"
            disabled={busy}
            onClick={onCancel}
          >
            Stop run
          </button>
        ) : null}
        {isTerminalRun(snapshot) ? (
          <button
            className="primary-action"
            type="button"
            disabled={busy}
            onClick={onLaunchNew}
          >
            Launch a new run <span aria-hidden="true">→</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function RunSurface({
  snapshot,
  tasks,
  selected,
  view,
  onSelect,
  onView,
  busy,
  onAdvance,
  onDecision,
  onCancel,
  onLaunchNew,
  onOpenPlan,
}: {
  snapshot?: DemoRunSnapshot | undefined;
  tasks: TaskViewModel[];
  selected: FixtureTaskKey;
  view: 'graph' | 'list';
  onSelect: (task: FixtureTaskKey) => void;
  onView: (view: 'graph' | 'list') => void;
  busy: boolean;
  onAdvance: () => void;
  onDecision: (decision: 'approved' | 'denied') => void;
  onCancel: () => void;
  onLaunchNew: () => void;
  onOpenPlan: () => void;
}) {
  const selectedTask = tasks.find((task) => task.key === selected) ?? tasks[0];
  if (!selectedTask) return null;
  if (!snapshot)
    return (
      <section className="surface centered-empty" aria-labelledby="run-title">
        <span className="empty-glyph" aria-hidden="true">
          ◇
        </span>
        <p className="eyebrow">Current run</p>
        <h1 id="run-title">No run has been launched.</h1>
        <p>
          The approved fixture plan is ready. Launching creates the first
          authoritative events.
        </p>
        <button className="primary-action" type="button" onClick={onOpenPlan}>
          Review the plan <span aria-hidden="true">→</span>
        </button>
      </section>
    );
  const approval = Object.values(snapshot.projection.approvals).find(
    (item) => item.state === 'requested',
  );
  const repair = Object.values(snapshot.projection.tasks).find(
    (task) => task.state === 'repair_pending',
  );
  return (
    <section className="surface run-surface" aria-labelledby="run-title">
      <SurfaceHeading
        eyebrow="Current run / simulated adapter"
        title="Account preferences loop"
        description={`Phase: ${snapshot.phase.replaceAll('_', ' ')}. ${snapshot.nextStepLabel}.`}
        aside={
          <span className={`phase-badge phase-${snapshot.phase}`}>
            {snapshot.projection.attentionRequired
              ? '! Attention required'
              : '● Authoritative state'}
          </span>
        }
      />
      {approval || repair ? (
        <aside className="attention-banner" aria-label="Run attention">
          <span aria-hidden="true">!</span>
          <div>
            <strong>
              {approval
                ? `Approval needed: ${approval.requestedAction}`
                : `Repair needed: ${repair?.title}`}
            </strong>
            <p>
              {approval?.reason ??
                'A blocking validation must be repaired before execution can continue.'}
            </p>
          </div>
          <small>Decision blocks next step</small>
        </aside>
      ) : null}
      <div className="surface-toolbar run-toolbar">
        <div className="segmented" aria-label="Run view">
          <button
            type="button"
            aria-pressed={view === 'graph'}
            onClick={() => onView('graph')}
          >
            Map
          </button>
          <button
            type="button"
            aria-pressed={view === 'list'}
            onClick={() => onView('list')}
          >
            List
          </button>
        </div>
        <span className="sequence-label">
          Event {snapshot.projection.lastSequence} · persisted locally
        </span>
      </div>
      <div className="workspace-with-inspector run-workspace">
        <div className="workspace-canvas">
          {view === 'graph' ? (
            <TaskGraph
              tasks={tasks}
              selected={selected}
              onSelect={onSelect}
              label="Current run task map"
            />
          ) : (
            <TaskList tasks={tasks} selected={selected} onSelect={onSelect} />
          )}
          <RunControls
            snapshot={snapshot}
            busy={busy}
            onAdvance={onAdvance}
            onDecision={onDecision}
            onCancel={onCancel}
            onLaunchNew={onLaunchNew}
          />
          <details className="event-drawer">
            <summary>
              <span>
                <strong>Evidence ledger</strong>
                <small>Recent domain events</small>
              </span>
              <span>{snapshot.events.length} events</span>
            </summary>
            <ol>
              {snapshot.events
                .slice(-8)
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
          </details>
        </div>
        <TaskInspector task={selectedTask} />
      </div>
    </section>
  );
}

export function ReviewSurface({
  snapshot,
  busy,
  onLaunchNew,
}: {
  snapshot?: DemoRunSnapshot | undefined;
  busy: boolean;
  onLaunchNew: () => void;
}) {
  const review = buildReviewViewModel(snapshot);
  const validations = snapshot
    ? Object.values(snapshot.projection.validations)
    : [];
  const artifacts = snapshot
    ? Object.values(snapshot.projection.artifacts)
    : [];
  return (
    <section className="surface review-surface" aria-labelledby="review-title">
      <SurfaceHeading
        eyebrow="Review / outcome package"
        title={review.title}
        description={review.description}
        aside={
          <span className={`review-mark review-${review.state}`}>
            {review.mark}
          </span>
        }
      />
      <div className="review-layout">
        <section className="quiet-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Validation trail</p>
              <h2 id="review-title">Evidence by validator</h2>
            </div>
            <span>{validations.length} records</span>
          </div>
          {validations.length ? (
            <div className="validation-ledger">
              {validations.map((validation) => (
                <article
                  className={`validation-${validation.status}`}
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
                    <p>{validation.outputSummary ?? 'Validation running.'}</p>
                    <small>
                      {validation.status}
                      {validation.retryOf
                        ? ` · retry of ${validation.retryOf}`
                        : ''}
                    </small>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="empty-copy">
              No validation evidence has been recorded.
            </p>
          )}
        </section>
        <aside className={`outcome-panel outcome-${review.state}`}>
          <p className="eyebrow">Readiness</p>
          <h2>{review.title}</h2>
          <p>{review.description}</p>
          {isTerminalRun(snapshot) ? (
            <button
              className="primary-action"
              type="button"
              disabled={busy}
              onClick={onLaunchNew}
            >
              Launch a new run <span aria-hidden="true">→</span>
            </button>
          ) : null}
        </aside>
        <section className="quiet-panel artifact-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Artifacts</p>
              <h2>Recorded outputs</h2>
            </div>
            <span>{artifacts.length}</span>
          </div>
          {artifacts.length ? (
            <ul>
              {artifacts.map((artifact) => (
                <li key={artifact.id}>
                  <strong>{artifact.type}</strong>
                  <code>{artifact.digest}</code>
                  <small>{artifact.validationStatus}</small>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-copy">
              No diff artifact recorded. File and line statistics remain hidden
              until real evidence exists.
            </p>
          )}
        </section>
        <section className={`warning-panel warning-${review.warningState}`}>
          <p className="eyebrow">Warnings</p>
          <h2>{review.warningTitle}</h2>
          <p>{review.warningDescription}</p>
        </section>
      </div>
    </section>
  );
}

export function HistorySurface({
  snapshot,
}: {
  snapshot?: DemoRunSnapshot | undefined;
}) {
  return (
    <section
      className="surface history-surface"
      aria-labelledby="history-title"
    >
      <SurfaceHeading
        eyebrow="History"
        title="Runs as outcomes, not chat archives."
        description="Durable multi-run history and analytics are not connected in this increment."
        aside={<span className="truth-badge">Preview boundary</span>}
      />
      {snapshot ? (
        <article className="history-row">
          <span
            className={`history-status phase-${snapshot.phase}`}
            aria-hidden="true"
          />
          <div>
            <p className="eyebrow">Newest local run</p>
            <h2 id="history-title">Account preferences loop</h2>
            <p>{snapshot.projection.run.goal}</p>
          </div>
          <dl>
            <div>
              <dt>Outcome</dt>
              <dd>{snapshot.phase.replaceAll('_', ' ')}</dd>
            </div>
            <div>
              <dt>Events</dt>
              <dd>{snapshot.projection.lastSequence}</dd>
            </div>
            <div>
              <dt>Evidence</dt>
              <dd>
                {Object.keys(snapshot.projection.validations).length}{' '}
                validations
              </dd>
            </div>
          </dl>
        </article>
      ) : (
        <div className="centered-empty compact">
          <span className="empty-glyph" aria-hidden="true">
            ○
          </span>
          <h2 id="history-title">No local run outcome yet.</h2>
          <p>Launch the fixture plan to create an inspectable outcome.</p>
        </div>
      )}
      <p className="boundary-note">
        Duration, cost, success rate, and learned recommendations are
        intentionally absent because the service does not provide them.
      </p>
    </section>
  );
}
