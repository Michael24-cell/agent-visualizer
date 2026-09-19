import { useId, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { DemoRunSnapshot } from '@harness/contracts';
import {
  listCommands,
  parseComposerInput,
  resolveRoomId,
  type ComposerInput,
  type RoomId,
  type RoomLayout,
  type RoomMessage,
  type RoomViewModel,
} from './conversation';

export function ConversationRail({
  rooms,
  focused,
  onFocus,
}: {
  rooms: readonly RoomViewModel[];
  focused: RoomId;
  onFocus: (room: RoomId) => void;
}) {
  return (
    <nav className="conversation-rail" aria-label="Conversations">
      <p className="rail-label">Conversations</p>
      {rooms.map((room) => (
        <button
          type="button"
          key={room.id}
          className={`room-row category-${room.category} ${
            focused === room.id ? 'is-focused' : ''
          } ${room.open ? '' : 'is-closed'}`}
          aria-current={focused === room.id ? 'true' : undefined}
          aria-label={`${room.title}, ${room.stateLabel}${
            room.attention ? ', needs a decision' : ''
          }`}
          onClick={() => onFocus(room.id)}
        >
          <span className="room-rail" aria-hidden="true" />
          <span className="room-glyph" aria-hidden="true">
            {room.statusSymbol}
          </span>
          <span className="room-copy">
            <strong>{room.title}</strong>
            <small>{room.now}</small>
          </span>
          {room.attention ? (
            <b className="room-badge" aria-hidden="true">
              1
            </b>
          ) : null}
        </button>
      ))}
    </nav>
  );
}

export function LayoutSwitch({
  layout,
  canSplit,
  onLayout,
}: {
  layout: RoomLayout;
  canSplit: boolean;
  onLayout: (layout: RoomLayout) => void;
}) {
  return (
    <div className="segmented" aria-label="Room layout">
      <button
        type="button"
        aria-pressed={layout === 'focus'}
        onClick={() => onLayout('focus')}
      >
        Focus
      </button>
      <button
        type="button"
        aria-pressed={layout === 'split'}
        disabled={!canSplit}
        onClick={() => onLayout('split')}
      >
        Split
      </button>
      <span className="segmented-note">
        Compare and supervise need two active agents
      </span>
    </div>
  );
}

function MessageRow({
  message,
  busy,
  onDecision,
}: {
  message: RoomMessage;
  busy: boolean;
  onDecision: (approvalId: string, decision: 'approved' | 'denied') => void;
}) {
  const pending = message.proposal?.state === 'requested';
  return (
    <li className={`message tone-${message.tone} role-${message.role}`}>
      <span className="message-seq" aria-hidden="true">
        {String(message.sequence).padStart(2, '0')}
      </span>
      <div className="message-body">
        <p>
          {message.role === 'user' || message.role === 'runtime' ? (
            <span className="message-role">{message.role}</span>
          ) : null}
          {message.body}
          {message.detail ? <small> · {message.detail}</small> : null}
        </p>
        {message.proposal ? (
          <div
            className={`proposal ${pending ? 'is-pending' : 'is-decided'}`}
            aria-label="Approval proposal"
          >
            <p className="proposal-title">{message.proposal.action}</p>
            <p>{message.proposal.reason}</p>
            <dl>
              <div>
                <dt>Scope</dt>
                <dd>
                  <code>{message.proposal.scope}</code>
                </dd>
              </div>
              <div>
                <dt>Consequence</dt>
                <dd>{message.proposal.consequences}</dd>
              </div>
            </dl>
            {pending ? (
              <div className="proposal-actions">
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
              <span
                className={`proposal-state state-${message.proposal.state}`}
              >
                {message.proposal.state}
              </span>
            )}
          </div>
        ) : null}
      </div>
    </li>
  );
}

export function StepCard({
  snapshot,
  busy,
  onAdvance,
  onCancel,
  onLaunchNew,
}: {
  snapshot: DemoRunSnapshot;
  busy: boolean;
  onAdvance: () => void;
  onCancel: () => void;
  onLaunchNew: () => void;
}) {
  const terminal = ['completed', 'failed', 'cancelled'].includes(
    snapshot.phase,
  );
  const canAdvance = snapshot.availableCommands.includes('advance');
  const awaitingDecision = snapshot.availableCommands.includes('approve');
  return (
    <div className="step-card" aria-label="Next supervised step">
      <div>
        <span className="step-label">
          {terminal ? 'Work finished' : 'Next step'}
        </span>
        <strong>{snapshot.nextStepLabel}</strong>
        {awaitingDecision ? (
          <small>Answer the open request first.</small>
        ) : null}
      </div>
      <div className="step-actions">
        {canAdvance ? (
          <button
            type="button"
            className="primary-action"
            disabled={busy}
            onClick={onAdvance}
          >
            Apply <kbd>/next</kbd>
          </button>
        ) : null}
        {snapshot.availableCommands.includes('cancel') ? (
          <button
            type="button"
            className="danger-action"
            disabled={busy}
            onClick={onCancel}
          >
            Stop
          </button>
        ) : null}
        {terminal ? (
          <button
            type="button"
            className="primary-action"
            disabled={busy}
            onClick={onLaunchNew}
          >
            Start the plan again
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function Room({
  room,
  messages,
  snapshot,
  busy,
  compact = false,
  showStep = false,
  onDecision,
  onAdvance,
  onCancel,
  onLaunchNew,
}: {
  room: RoomViewModel;
  messages: readonly RoomMessage[];
  snapshot: DemoRunSnapshot | undefined;
  busy: boolean;
  compact?: boolean;
  showStep?: boolean;
  onDecision: (approvalId: string, decision: 'approved' | 'denied') => void;
  onAdvance: () => void;
  onCancel: () => void;
  onLaunchNew: () => void;
}) {
  const task = room.task;
  const shown = compact ? messages.slice(-4) : messages;
  return (
    <section
      className={`room category-${room.category} ${compact ? 'is-compact' : ''}`}
      aria-label={`${room.title} room`}
    >
      <header className="room-header">
        <span className="room-rail" aria-hidden="true" />
        <div className="room-identity">
          <h2>{room.title}</h2>
          <p className="room-subtitle">
            {room.kind === 'coordinator'
              ? 'Steers the whole project · simulated coordinator'
              : `${room.subtitle} · simulated agent`}
          </p>
        </div>
        <dl className="room-facts">
          {task ? (
            <>
              <div>
                <dt>Profile</dt>
                <dd>{task.agentProfile}</dd>
              </div>
              <div>
                <dt>State</dt>
                <dd>
                  <span aria-hidden="true">{task.statusSymbol} </span>
                  {task.stateLabel}
                </dd>
              </div>
              <div>
                <dt>Scope</dt>
                <dd>
                  <code>{task.fileScopes[0]}</code>
                  {task.fileScopes.length > 1
                    ? ` +${task.fileScopes.length - 1}`
                    : ''}
                </dd>
              </div>
              <div>
                <dt>Skills</dt>
                <dd>{task.skills.join(', ')}</dd>
              </div>
            </>
          ) : (
            <>
              <div>
                <dt>Scope</dt>
                <dd>Whole run</dd>
              </div>
              <div>
                <dt>State</dt>
                <dd>{room.stateLabel}</dd>
              </div>
            </>
          )}
        </dl>
      </header>
      {snapshot && showStep ? (
        <StepCard
          snapshot={snapshot}
          busy={busy}
          onAdvance={onAdvance}
          onCancel={onCancel}
          onLaunchNew={onLaunchNew}
        />
      ) : null}
      {shown.length ? (
        <ol className="message-list">
          {shown.map((message) => (
            <MessageRow
              key={message.id}
              message={message}
              busy={busy}
              onDecision={onDecision}
            />
          ))}
        </ol>
      ) : (
        <p className="empty-copy room-empty">
          {room.open
            ? 'Nothing has happened in this room yet.'
            : 'This room opens when the run launches.'}
        </p>
      )}
    </section>
  );
}

export interface ComposerHandlers {
  onCommand: (input: Extract<ComposerInput, { kind: 'command' }>) => string;
}

export function Composer({
  target,
  rooms,
  busy,
  onTarget,
  onCommand,
}: {
  target: RoomId;
  rooms: readonly RoomViewModel[];
  busy: boolean;
  onTarget: (room: RoomId) => void;
  onCommand: ComposerHandlers['onCommand'];
}) {
  const [value, setValue] = useState('');
  const [feedback, setFeedback] = useState<string>();
  const listId = useId();
  const targetRoom = rooms.find((room) => room.id === target) ?? rooms[0];
  const suggestions = value.startsWith('/') ? listCommands(value) : [];

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const parsed = parseComposerInput(value);
    if (parsed.kind === 'empty') return;
    if (parsed.kind === 'text') {
      setFeedback(
        'Free-text steering reaches the simulated coordinator in the next increment. Commands work now: /next, /approve, /deny, /stop, /launch, /to.',
      );
      return;
    }
    if (parsed.kind === 'unknown-command') {
      setFeedback(`/${parsed.name} is not a command. Try /next or /approve.`);
      return;
    }
    if (parsed.name === 'to') {
      const room = resolveRoomId(parsed.argument);
      if (!room) {
        setFeedback(
          'Say which room: /to coordinator, /to interface, /to service.',
        );
        return;
      }
      onTarget(room);
      setFeedback(undefined);
      setValue('');
      return;
    }
    setFeedback(onCommand(parsed));
    setValue('');
  };

  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <form
      className={`composer category-${targetRoom?.category ?? 'neutral'}`}
      onSubmit={submit}
      aria-label="Message composer"
    >
      <span className="composer-rail" aria-hidden="true" />
      {rooms.length > 1 ? (
        <label className="composer-target">
          <span>To</span>
          <select
            value={target}
            onChange={(event) => onTarget(event.target.value as RoomId)}
            aria-label="Message target"
          >
            {rooms.map((room) => (
              <option key={room.id} value={room.id} disabled={!room.open}>
                {room.title}
                {room.open ? '' : ' (opens at launch)'}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div className="composer-field">
        <textarea
          rows={1}
          value={value}
          placeholder={`Message ${targetRoom?.title ?? 'the coordinator'}`}
          aria-label={`Message ${targetRoom?.title ?? 'the coordinator'}`}
          aria-describedby={feedback ? `${listId}-feedback` : undefined}
          onChange={(event) => {
            setValue(event.target.value);
            if (feedback) setFeedback(undefined);
          }}
          onKeyDown={onKey}
          disabled={busy}
        />
        {suggestions.length ? (
          <ul className="command-list" id={listId} role="listbox">
            {suggestions.map((command) => (
              <li key={command.name} role="option" aria-selected={false}>
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => setValue(`/${command.name} `)}
                >
                  <code>/{command.name}</code>
                  <span>{command.summary}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {feedback ? (
          <p
            className="composer-feedback"
            id={`${listId}-feedback`}
            role="status"
          >
            {feedback}
          </p>
        ) : null}
      </div>
      <button type="submit" className="composer-send" disabled={busy}>
        Send <kbd>⏎</kbd>
      </button>
    </form>
  );
}
