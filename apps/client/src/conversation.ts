import type {
  Approval,
  DemoRunSnapshot,
  WorkspaceFixture,
} from '@harness/contracts';
import {
  describeEvent,
  type FixtureTaskKey,
  type TaskViewModel,
} from './model';

export type RoomId = 'coordinator' | FixtureTaskKey;
export type RoomLayout = 'focus' | 'split';

export interface RoomViewModel {
  readonly id: RoomId;
  readonly kind: 'coordinator' | 'task';
  readonly title: string;
  readonly subtitle: string;
  readonly category: TaskViewModel['category'];
  readonly now: string;
  readonly stateLabel: string;
  readonly statusSymbol: string;
  readonly open: boolean;
  readonly attention: boolean;
  readonly task?: TaskViewModel;
}

export interface ProposalViewModel {
  readonly approvalId: string;
  readonly action: string;
  readonly reason: string;
  readonly scope: string;
  readonly consequences: string;
  readonly state: Approval['state'];
}

export interface RoomMessage {
  readonly id: string;
  readonly role: 'system' | 'runtime' | 'validator' | 'user';
  readonly sequence: number;
  readonly body: string;
  readonly detail?: string;
  readonly tone: 'neutral' | 'success' | 'failure' | 'attention';
  readonly proposal?: ProposalViewModel;
  readonly fromRoom?: RoomId;
}

const commandCatalog = [
  { name: 'next', summary: 'Apply the next step' },
  { name: 'approve', summary: 'Approve the open request' },
  { name: 'deny', summary: 'Deny the open request' },
  { name: 'stop', summary: 'Stop work and keep what is done' },
  { name: 'launch', summary: 'Approve the plan and start' },
  { name: 'to', summary: 'Address a room: /to service' },
] as const;

export type ComposerCommandName = (typeof commandCatalog)[number]['name'];

export type ComposerInput =
  | {
      readonly kind: 'command';
      readonly name: ComposerCommandName;
      readonly argument?: string;
    }
  | { readonly kind: 'unknown-command'; readonly name: string }
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'empty' };

export function listCommands(
  prefix = '',
): readonly (typeof commandCatalog)[number][] {
  const needle = prefix.replace(/^\//, '').toLowerCase();
  return commandCatalog.filter((command) => command.name.startsWith(needle));
}

export function parseComposerInput(raw: string): ComposerInput {
  const text = raw.trim();
  if (!text) return { kind: 'empty' };
  if (!text.startsWith('/')) return { kind: 'text', text };
  const [head = '', ...rest] = text.slice(1).split(/\s+/);
  const name = head.toLowerCase();
  const match = commandCatalog.find((command) => command.name === name);
  if (!match) return { kind: 'unknown-command', name };
  const argument = rest.join(' ').trim();
  return argument
    ? { kind: 'command', name: match.name, argument }
    : { kind: 'command', name: match.name };
}

export function resolveRoomId(
  argument: string | undefined,
): RoomId | undefined {
  const value = (argument ?? '').toLowerCase();
  if (['coordinator', 'coord', 'run', 'main'].includes(value))
    return 'coordinator';
  if (['interface', 'ui', 'frontend', '1', '01'].includes(value))
    return 'interface';
  if (['service', 'backend', 'api', '2', '02'].includes(value))
    return 'service';
  return undefined;
}

export function phaseLabel(phase: DemoRunSnapshot['phase']): string {
  const labels: Record<DemoRunSnapshot['phase'], string> = {
    interface_active: 'in progress',
    handoff_ready: 'in progress',
    approval_required: 'needs you',
    approval_granted: 'in progress',
    repair_required: 'needs a fix',
    completed: 'done',
    failed: 'failed',
    cancelled: 'stopped',
  };
  return labels[phase];
}

export function buildRooms(
  workspace: WorkspaceFixture,
  tasks: readonly TaskViewModel[],
  snapshot: DemoRunSnapshot | undefined,
  attentionTask: FixtureTaskKey | undefined,
): RoomViewModel[] {
  const coordinatorNow = !snapshot
    ? 'Plan v1 is ready to start.'
    : ['completed', 'failed', 'cancelled'].includes(snapshot.phase)
      ? `Work ${phaseLabel(snapshot.phase)}.`
      : snapshot.nextStepLabel;
  const coordinator: RoomViewModel = {
    id: 'coordinator',
    kind: 'coordinator',
    title: 'Coordinator',
    subtitle: 'Project steering · simulated',
    category: 'neutral',
    now: coordinatorNow,
    stateLabel: snapshot ? phaseLabel(snapshot.phase) : 'not started',
    statusSymbol: '◎',
    open: true,
    attention: false,
  };
  const taskRooms = tasks.map<RoomViewModel>((task) => ({
    id: task.key,
    kind: 'task',
    title: task.agentProfile,
    subtitle: task.title,
    category: task.category,
    now: snapshot ? task.currentActivity : 'Starts with the plan.',
    stateLabel: task.stateLabel,
    statusSymbol: task.statusSymbol,
    open: Boolean(snapshot),
    attention: attentionTask === task.key,
    task,
  }));
  void workspace;
  return [coordinator, ...taskRooms];
}

function toneFor(
  event: DemoRunSnapshot['events'][number],
): RoomMessage['tone'] {
  switch (event.type) {
    case 'validation.completed':
      return event.payload.to === 'passed' ? 'success' : 'failure';
    case 'approval.requested':
      return 'attention';
    case 'task.state_changed':
      return event.payload.to === 'completed'
        ? 'success'
        : ['failed', 'cancelled'].includes(event.payload.to)
          ? 'failure'
          : ['awaiting_input', 'repair_pending'].includes(event.payload.to)
            ? 'attention'
            : 'neutral';
    case 'run.state_changed':
      return event.payload.to === 'completed'
        ? 'success'
        : ['failed', 'cancelled'].includes(event.payload.to)
          ? 'failure'
          : 'neutral';
    default:
      return 'neutral';
  }
}

function roleFor(source: DemoRunSnapshot['events'][number]['source']) {
  if (source === 'user') return 'user' as const;
  if (source === 'runtime') return 'runtime' as const;
  if (source === 'validator') return 'validator' as const;
  return 'system' as const;
}

export function buildRoomMessages(
  room: RoomViewModel,
  snapshot: DemoRunSnapshot | undefined,
): RoomMessage[] {
  if (!snapshot) return [];
  const { projection } = snapshot;
  const taskId =
    room.kind === 'task'
      ? Object.values(projection.tasks).find((task) =>
          task.id.endsWith(`_${room.id}`),
        )?.id
      : undefined;
  const relevant = snapshot.events.filter((event) =>
    room.kind === 'coordinator'
      ? !event.taskId ||
        event.type === 'approval.requested' ||
        event.type === 'approval.decided'
      : event.taskId === taskId,
  );
  return relevant
    .filter((event) => {
      if (
        event.type === 'task.created' ||
        event.type === 'agent.instance_created' ||
        event.type === 'dependency.created' ||
        event.type === 'validation.started'
      )
        return false;
      if (event.type === 'agent.state_changed')
        return ['failed', 'cancelled', 'disconnected'].includes(
          event.payload.to,
        );
      if (event.type === 'run.state_changed')
        return ['executing', 'completed', 'failed', 'cancelled'].includes(
          event.payload.to,
        );
      return true;
    })
    .map<RoomMessage>((event) => {
      const fromRoom = (['interface', 'service'] as const).find((key) =>
        event.taskId?.endsWith(`_${key}`),
      );
      const base = {
        id: event.id,
        role: roleFor(event.source),
        sequence: event.sequence,
        tone: toneFor(event),
        ...(fromRoom ? { fromRoom } : {}),
      };
      if (event.type === 'approval.requested') {
        const approval = projection.approvals[event.payload.approval.id];
        return {
          ...base,
          body: `Asked: ${event.payload.approval.requestedAction}`,
          ...(approval
            ? {
                proposal: {
                  approvalId: approval.id,
                  action: approval.requestedAction,
                  reason: approval.reason,
                  scope: approval.scope,
                  consequences: approval.consequences,
                  state: approval.state,
                },
              }
            : {}),
        };
      }
      if (event.type === 'validation.completed') {
        return {
          ...base,
          body: describeEvent(event, projection),
          detail: `exit ${event.payload.exitCode ?? '—'}`,
        };
      }
      return { ...base, body: describeEvent(event, projection) };
    });
}
