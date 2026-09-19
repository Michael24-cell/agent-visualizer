import type { DemoRunSnapshot, WorkspaceFixture } from '@harness/contracts';
import type {
  ComposerInput,
  RoomId,
  RoomMessage,
  RoomViewModel,
} from './conversation';
import { Composer, StepCard } from './conversation-surfaces';
import type { TaskViewModel } from './model';

function MessageLine({
  message,
  busy,
  deferTo,
  onDecision,
}: {
  message: RoomMessage;
  busy: boolean;
  deferTo?: RoomViewModel | undefined;
  onDecision: (approvalId: string, decision: 'approved' | 'denied') => void;
}) {
  const pending = message.proposal?.state === 'requested';
  if (message.proposal && deferTo) {
    return (
      <li className={`line tone-${message.tone}`}>
        <p>
          {deferTo.title} is asking: {message.proposal.action}.{' '}
          {pending
            ? 'Answer in its pane.'
            : `You ${message.proposal.state} it.`}
        </p>
      </li>
    );
  }
  return (
    <li className={`line tone-${message.tone}`}>
      <p>
        {message.role === 'user' ? <span className="line-you">You</span> : null}
        {message.body}
      </p>
      {message.proposal ? (
        <div className={`ask ${pending ? 'is-pending' : ''}`}>
          <strong>{message.proposal.action}</strong>
          <p>{message.proposal.reason}</p>
          <p className="ask-scope">
            Would write to <code>{message.proposal.scope}</code> ·{' '}
            {message.proposal.consequences}
          </p>
          {pending ? (
            <div className="ask-actions">
              <button
                type="button"
                className="primary-action"
                disabled={busy}
                onClick={() =>
                  onDecision(message.proposal!.approvalId, 'approved')
                }
              >
                Approve
              </button>
              <button
                type="button"
                className="secondary-action"
                disabled={busy}
                onClick={() =>
                  onDecision(message.proposal!.approvalId, 'denied')
                }
              >
                Deny
              </button>
            </div>
          ) : (
            <span className={`ask-state state-${message.proposal.state}`}>
              {message.proposal.state}
            </span>
          )}
        </div>
      ) : null}
    </li>
  );
}

function PlanCard({
  workspace,
  tasks,
  busy,
  onLaunch,
  onShowPlan,
}: {
  workspace: WorkspaceFixture;
  tasks: readonly TaskViewModel[];
  busy: boolean;
  onLaunch: () => void;
  onShowPlan: () => void;
}) {
  return (
    <li className="line plan-card">
      <p>
        Plan v1 is ready: {tasks.length} tasks, in sequence.{' '}
        {workspace.plan.narrative}
      </p>
      <ol className="plan-tasks">
        {tasks.map((task, index) => (
          <li key={task.key} className={`category-${task.category}`}>
            <span className="cat-dot" aria-hidden="true" />
            <span className="plan-task-index">{index + 1}</span>
            <span className="plan-task-title">{task.title}</span>
            <span className="plan-task-agent">
              {task.agentProfile}
              {task.dependsOn.length
                ? ` · waits on ${task.dependsOn.length}`
                : ''}
            </span>
          </li>
        ))}
      </ol>
      <p className="plan-why">{workspace.plan.agentCountRationale}</p>
      <div className="ask-actions">
        <button
          type="button"
          className="primary-action"
          disabled={busy}
          onClick={onLaunch}
        >
          Approve and start
        </button>
        <button type="button" className="secondary-action" onClick={onShowPlan}>
          Show plan
        </button>
      </div>
    </li>
  );
}

export function Pane({
  room,
  messages,
  workspace,
  tasks,
  snapshot,
  busy,
  canClose,
  isPrimary,
  openRooms,
  onClose,
  onDecision,
  onAdvance,
  onCancel,
  onLaunch,
  onShowPlan,
  onCommand,
}: {
  room: RoomViewModel;
  messages: readonly RoomMessage[];
  workspace: WorkspaceFixture;
  tasks: readonly TaskViewModel[];
  snapshot: DemoRunSnapshot | undefined;
  busy: boolean;
  canClose: boolean;
  isPrimary: boolean;
  openRooms: readonly RoomViewModel[];
  onClose: () => void;
  onDecision: (approvalId: string, decision: 'approved' | 'denied') => void;
  onAdvance: () => void;
  onCancel: () => void;
  onLaunch: () => void;
  onShowPlan: () => void;
  onCommand: (input: Extract<ComposerInput, { kind: 'command' }>) => string;
}) {
  const showPlanCard = room.kind === 'coordinator' && !snapshot;
  return (
    <section
      className={`pane category-${room.category}`}
      aria-label={`${room.title} conversation`}
    >
      <header className="pane-header">
        <span className="cat-dot" aria-hidden="true" />
        <strong>{room.title}</strong>
        <span className="pane-task">
          {room.kind === 'coordinator'
            ? 'Plans the project with you'
            : room.subtitle}
        </span>
        {room.kind === 'task' ? (
          <span className="pane-state">{room.stateLabel}</span>
        ) : null}
        {canClose ? (
          <button
            type="button"
            className="pane-close"
            aria-label={`Close ${room.title} pane`}
            onClick={onClose}
          >
            ×
          </button>
        ) : null}
      </header>
      <div className="pane-scroll">
        <ol className="lines">
          {showPlanCard ? (
            <PlanCard
              workspace={workspace}
              tasks={tasks}
              busy={busy}
              onLaunch={onLaunch}
              onShowPlan={onShowPlan}
            />
          ) : null}
          {messages.map((message) => (
            <MessageLine
              key={message.id}
              message={message}
              busy={busy}
              deferTo={
                room.kind === 'coordinator' && message.fromRoom
                  ? openRooms.find((open) => open.id === message.fromRoom)
                  : undefined
              }
              onDecision={onDecision}
            />
          ))}
          {!showPlanCard && messages.length === 0 ? (
            <li className="line line-empty">
              {room.open ? 'Nothing yet.' : 'Starts when you approve the plan.'}
            </li>
          ) : null}
          {snapshot && isPrimary ? (
            <li className="line line-step">
              <StepCard
                snapshot={snapshot}
                busy={busy}
                onAdvance={onAdvance}
                onCancel={onCancel}
                onLaunchNew={onLaunch}
              />
            </li>
          ) : null}
        </ol>
      </div>
      <Composer
        target={room.id}
        rooms={[room]}
        busy={busy}
        onTarget={() => undefined}
        onCommand={onCommand}
      />
    </section>
  );
}

export function AddPaneMenu({
  rooms,
  open,
  onAdd,
}: {
  rooms: readonly RoomViewModel[];
  open: readonly RoomId[];
  onAdd: (room: RoomId) => void;
}) {
  const available = rooms.filter(
    (room) => room.open && !open.includes(room.id),
  );
  if (!available.length) return null;
  return (
    <div className="add-pane">
      <span>Add pane</span>
      {available.map((room) => (
        <button
          type="button"
          key={room.id}
          className={`category-${room.category}`}
          onClick={() => onAdd(room.id)}
        >
          <span className="cat-dot" aria-hidden="true" />
          {room.title}
          {room.attention ? <b className="tab-badge">1</b> : null}
        </button>
      ))}
    </div>
  );
}
