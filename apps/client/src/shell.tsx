import type { DemoRunSnapshot, WorkspaceFixture } from '@harness/contracts';
import type { RoomId, RoomMessage, RoomViewModel } from './conversation';
import { Composer, Room } from './conversation-surfaces';
import type { ComposerInput } from './conversation';
import {
  buildReviewViewModel,
  isTerminalRun,
  type FixtureTaskKey,
  type TaskViewModel,
} from './model';
import { TaskGraph } from './operational-surfaces';
import { phaseLabel } from './conversation';

import { stageLabels, stageOrder, type Stage } from './stages';

export function ProjectSidebar({
  workspace,
  snapshot,
  attention,
  onOpenMore,
}: {
  workspace: WorkspaceFixture;
  snapshot?: DemoRunSnapshot | undefined;
  attention: boolean;
  onOpenMore: (view: 'atlas' | 'history') => void;
}) {
  const status = !snapshot ? 'Plan ready' : phaseLabel(snapshot.phase);
  return (
    <aside className="projects" aria-label="Projects">
      <div className="projects-head">
        <strong>Projects</strong>
        <span className="mode-badge" title="Simulated coordinator and runtime">
          Simulated
        </span>
      </div>
      <button
        type="button"
        className="new-project"
        disabled
        aria-describedby="new-project-note"
      >
        + New project
      </button>
      <p id="new-project-note" className="new-project-note">
        Creating projects arrives with the coordinator service.
      </p>
      <ul className="project-list">
        <li className="project-row is-current" aria-current="true">
          <span className={`project-dot ${attention ? 'needs-you' : ''}`} />
          <span className="project-copy">
            <strong>{workspace.project.name}</strong>
            <small>{status}</small>
          </span>
          {attention ? <b className="project-badge">1</b> : null}
        </li>
      </ul>
      <div className="projects-more">
        <button type="button" onClick={() => onOpenMore('atlas')}>
          Capabilities
        </button>
        <button type="button" onClick={() => onOpenMore('history')}>
          History
        </button>
      </div>
      <div className="projects-foot">
        {workspace.project.repository} · {workspace.project.branch}
      </div>
    </aside>
  );
}

export function ThreadTabs({
  rooms,
  focused,
  pinned,
  onFocus,
  onPin,
}: {
  rooms: readonly RoomViewModel[];
  focused: RoomId;
  pinned: RoomId | undefined;
  onFocus: (room: RoomId) => void;
  onPin: (room: RoomId | undefined) => void;
}) {
  return (
    <div className="thread-tabs" role="tablist" aria-label="Conversations">
      {rooms.map((room) => {
        const isFocused = focused === room.id;
        const isPinned = pinned === room.id;
        return (
          <div
            key={room.id}
            className={`thread-tab category-${room.category} ${
              isFocused ? 'is-focused' : ''
            } ${isPinned ? 'is-pinned' : ''} ${room.open ? '' : 'is-closed'}`}
          >
            <button
              type="button"
              role="tab"
              aria-selected={isFocused}
              disabled={!room.open}
              onClick={() => onFocus(room.id)}
              title={room.open ? room.now : 'Opens when the run launches'}
            >
              <span className="tab-dot" aria-hidden="true" />
              <span className="tab-title">{room.title}</span>
              {room.attention ? (
                <b className="tab-badge" aria-label="needs a decision">
                  1
                </b>
              ) : null}
            </button>
            {room.open && !isFocused ? (
              <button
                type="button"
                className="tab-pin"
                aria-pressed={isPinned}
                aria-label={
                  isPinned
                    ? `Unpin ${room.title}`
                    : `Show ${room.title} beside the current conversation`
                }
                onClick={() => onPin(isPinned ? undefined : room.id)}
              >
                {isPinned ? '⊟' : '⊞'}
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function ThreadPane({
  room,
  messages,
  snapshot,
  busy,
  showStep,
  onDecision,
  onAdvance,
  onCancel,
  onLaunchNew,
  onCommand,
}: {
  room: RoomViewModel;
  messages: readonly RoomMessage[];
  snapshot: DemoRunSnapshot | undefined;
  busy: boolean;
  showStep: boolean;
  onDecision: (approvalId: string, decision: 'approved' | 'denied') => void;
  onAdvance: () => void;
  onCancel: () => void;
  onLaunchNew: () => void;
  onCommand: (input: Extract<ComposerInput, { kind: 'command' }>) => string;
}) {
  return (
    <div className={`thread-pane category-${room.category}`}>
      <div className="thread-scroll">
        <Room
          room={room}
          messages={messages}
          snapshot={snapshot}
          busy={busy}
          showStep={showStep}
          onDecision={onDecision}
          onAdvance={onAdvance}
          onCancel={onCancel}
          onLaunchNew={onLaunchNew}
        />
      </div>
      <Composer
        target={room.id}
        rooms={[room]}
        busy={busy}
        onTarget={() => undefined}
        onCommand={onCommand}
      />
    </div>
  );
}

export function BriefStage({ workspace }: { workspace: WorkspaceFixture }) {
  const findings = workspace.project.instructionFindings;
  return (
    <div className="stage-body">
      <h2>Project brief</h2>
      <p className="stage-lede">{workspace.project.summary}</p>
      <dl className="fact-list">
        <div>
          <dt>Stack</dt>
          <dd>{workspace.project.stack.join(', ')}</dd>
        </div>
        <div>
          <dt>Validation</dt>
          <dd>{workspace.project.validationCapabilities.join(', ')}</dd>
        </div>
      </dl>
      <h3>Boundaries from the repository</h3>
      <ul className="plain-list">
        {findings.map((finding) => (
          <li key={finding.title}>
            <strong>{finding.title}</strong>
            <span>{finding.detail}</span>
          </li>
        ))}
      </ul>
      <p className="stage-note">
        The coordinator will write this with you once it can talk. For now it is
        a fixture.
      </p>
    </div>
  );
}

export function MethodStage({ workspace }: { workspace: WorkspaceFixture }) {
  const { methodology, rules, skills, validators } = workspace.context;
  const group = (
    label: string,
    items: WorkspaceFixture['context']['rules'],
  ) => (
    <section className="method-group">
      <h3>{label}</h3>
      <ul className="plain-list">
        {items.map((item) => (
          <li key={item.id} className={`category-${item.category}`}>
            <span className="cat-dot" aria-hidden="true" />
            <strong>{item.name}</strong>
            <span>{item.description}</span>
            <small>{item.enforcement}-enforced</small>
          </li>
        ))}
      </ul>
    </section>
  );
  return (
    <div className="stage-body">
      <h2>{methodology.name}</h2>
      <p className="stage-lede">{methodology.summary}</p>
      <p className="stage-meta">
        Version {methodology.version} · applied to this project
      </p>
      {group('Hard rules', rules)}
      {group('Skills', skills)}
      {group('Validators', validators)}
      <div className="stage-actions">
        <button type="button" className="secondary-action" disabled>
          Edit sections
        </button>
        <button type="button" className="secondary-action" disabled>
          Change method
        </button>
      </div>
      <p className="stage-note">
        Editing and switching methods arrive with the coordinator.
      </p>
    </div>
  );
}

function TaskFacts({ task }: { task: TaskViewModel }) {
  return (
    <div className={`task-facts category-${task.category}`}>
      <div className="task-facts-head">
        <span className="cat-dot" aria-hidden="true" />
        <strong>{task.title}</strong>
        <span className="task-state">
          <span aria-hidden="true">{task.statusSymbol} </span>
          {task.stateLabel}
        </span>
      </div>
      <p>{task.purpose}</p>
      <dl className="fact-list">
        <div>
          <dt>Now</dt>
          <dd>{task.currentActivity}</dd>
        </div>
        <div>
          <dt>Why separate</dt>
          <dd>{task.whySeparate}</dd>
        </div>
        <div>
          <dt>Agent</dt>
          <dd>
            {task.agentProfile}
            {task.agentState ? ` · ${task.agentState}` : ''}
          </dd>
        </div>
        <div>
          <dt>Files</dt>
          <dd>
            {task.fileScopes.map((scope) => (
              <code key={scope}>{scope}</code>
            ))}
          </dd>
        </div>
        <div>
          <dt>Skills</dt>
          <dd>{task.skills.join(', ')}</dd>
        </div>
        <div>
          <dt>Done when</dt>
          <dd>
            <ul className="criteria">
              {task.acceptanceCriteria.map((criterion) => (
                <li key={criterion}>{criterion}</li>
              ))}
            </ul>
          </dd>
        </div>
        {task.evidence.length ? (
          <div>
            <dt>Evidence</dt>
            <dd>
              <ul className="criteria evidence">
                {task.evidence.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}

function PlanStage({
  workspace,
  tasks,
  selected,
  snapshot,
  busy,
  onSelect,
  onLaunch,
}: {
  workspace: WorkspaceFixture;
  tasks: TaskViewModel[];
  selected: FixtureTaskKey;
  snapshot?: DemoRunSnapshot | undefined;
  busy: boolean;
  onSelect: (task: FixtureTaskKey) => void;
  onLaunch: () => void;
}) {
  const task = tasks.find((item) => item.key === selected) ?? tasks[0];
  const launchable = !snapshot || isTerminalRun(snapshot);
  return (
    <div className="stage-body">
      <h2>Plan v1 · {tasks.length} tasks, in sequence</h2>
      <p className="stage-lede">{workspace.plan.narrative}</p>
      <TaskGraph
        tasks={tasks}
        selected={selected}
        onSelect={onSelect}
        label="Plan task graph"
      />
      <p className="stage-why">
        <strong>Why two agents:</strong> {workspace.plan.agentCountRationale}
      </p>
      {task ? <TaskFacts task={task} /> : null}
      {launchable ? (
        <div className="stage-actions">
          <button
            type="button"
            className="primary-action"
            disabled={busy}
            onClick={onLaunch}
          >
            {snapshot ? 'Start the plan again' : 'Approve and start'}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function RunStage({
  tasks,
  selected,
  snapshot,
  onSelect,
}: {
  tasks: TaskViewModel[];
  selected: FixtureTaskKey;
  snapshot: DemoRunSnapshot;
  onSelect: (task: FixtureTaskKey) => void;
}) {
  const task = tasks.find((item) => item.key === selected) ?? tasks[0];
  return (
    <div className="stage-body">
      <h2>Work · {phaseLabel(snapshot.phase)}</h2>
      <p className="stage-meta">Next: {snapshot.nextStepLabel}</p>
      <TaskGraph
        tasks={tasks}
        selected={selected}
        onSelect={onSelect}
        label="Current run task map"
      />
      {task ? <TaskFacts task={task} /> : null}
    </div>
  );
}

function ReviewStage({
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
    <div className="stage-body">
      <h2 className={`review-title review-${review.state}`}>
        <span aria-hidden="true">{review.mark}</span> {review.title}
      </h2>
      <p className="stage-lede">{review.description}</p>
      <h3>Checks</h3>
      {validations.length ? (
        <ul className="plain-list validations">
          {validations.map((validation) => (
            <li
              key={validation.id}
              className={`validation-${validation.status}`}
            >
              <span aria-hidden="true">
                {validation.status === 'passed'
                  ? '✓'
                  : validation.status === 'failed'
                    ? '×'
                    : '…'}
              </span>
              <strong>{validation.validatorType}</strong>
              <span>{validation.outputSummary ?? 'Running.'}</span>
              <small>
                {validation.status}
                {validation.retryOf ? ' · retry' : ''}
              </small>
            </li>
          ))}
        </ul>
      ) : (
        <p className="stage-note">No checks have run yet.</p>
      )}
      <h3>Outputs</h3>
      {artifacts.length ? (
        <ul className="plain-list">
          {artifacts.map((artifact) => (
            <li key={artifact.id}>
              <strong>{artifact.type}</strong>
              <code>{artifact.digest}</code>
            </li>
          ))}
        </ul>
      ) : (
        <p className="stage-note">No outputs yet.</p>
      )}
      <h3>Warnings</h3>
      <p className={`warning-line warning-${review.warningState}`}>
        <strong>{review.warningTitle}.</strong> {review.warningDescription}
      </p>
      {isTerminalRun(snapshot) ? (
        <div className="stage-actions">
          <button
            type="button"
            className="primary-action"
            disabled={busy}
            onClick={onLaunchNew}
          >
            Launch a new run
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function StagePanel({
  stages = stageOrder,
  stage,
  current,
  workspace,
  tasks,
  selected,
  snapshot,
  busy,
  onStage,
  onSelect,
  onLaunch,
}: {
  stages?: readonly Stage[];
  stage: Stage;
  current: Stage;
  workspace: WorkspaceFixture;
  tasks: TaskViewModel[];
  selected: FixtureTaskKey;
  snapshot?: DemoRunSnapshot | undefined;
  busy: boolean;
  onStage: (stage: Stage) => void;
  onSelect: (task: FixtureTaskKey) => void;
  onLaunch: () => void;
}) {
  const currentIndex = stageOrder.indexOf(current);
  return (
    <aside className="stage-panel" aria-label="Project stage">
      <ol className="stage-steps" aria-label="Stages">
        {stages.map((item) => {
          const index = stageOrder.indexOf(item);
          const reachable = index <= currentIndex || item === 'review';
          return (
            <li key={item}>
              <button
                type="button"
                aria-current={stage === item ? 'step' : undefined}
                className={`${index < currentIndex ? 'is-done' : ''} ${
                  item === current ? 'is-current' : ''
                }`}
                disabled={!reachable && !snapshot}
                onClick={() => onStage(item)}
              >
                <span className="step-index" aria-hidden="true">
                  {index < currentIndex ? '✓' : index + 1}
                </span>
                {stageLabels[item]}
              </button>
            </li>
          );
        })}
      </ol>
      {stage === 'brief' ? <BriefStage workspace={workspace} /> : null}
      {stage === 'method' ? <MethodStage workspace={workspace} /> : null}
      {stage === 'plan' ? (
        <PlanStage
          workspace={workspace}
          tasks={tasks}
          selected={selected}
          snapshot={snapshot}
          busy={busy}
          onSelect={onSelect}
          onLaunch={onLaunch}
        />
      ) : null}
      {stage === 'run' ? (
        snapshot ? (
          <RunStage
            tasks={tasks}
            selected={selected}
            snapshot={snapshot}
            onSelect={onSelect}
          />
        ) : (
          <div className="stage-body">
            <h2>Work</h2>
            <p className="stage-note">
              Nothing started. Approve the plan first.
            </p>
          </div>
        )
      ) : null}
      {stage === 'review' ? (
        <ReviewStage snapshot={snapshot} busy={busy} onLaunchNew={onLaunch} />
      ) : null}
    </aside>
  );
}
