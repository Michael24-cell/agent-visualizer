import { describe, expect, it } from 'vitest';
import type { DemoRunSnapshot, DomainEvent } from '@harness/contracts';
import {
  buildRoomMessages,
  buildRooms,
  listCommands,
  parseComposerInput,
  resolveRoomId,
  type RoomViewModel,
} from './conversation';
import type { TaskViewModel } from './model';

const tasks: TaskViewModel[] = [
  {
    key: 'interface',
    title: 'Interface task',
    category: 'interface',
    state: 'completed',
    stateLabel: 'Completed',
    statusSymbol: '✓',
    purpose: 'p',
    whySeparate: 'w',
    deliverable: 'd',
    acceptanceCriteria: ['a'],
    fileScopes: ['client/**'],
    skills: ['UI'],
    dependsOn: [],
    agentProfile: 'Interface systems',
    currentActivity: 'Handed off.',
    evidence: [],
  },
  {
    key: 'service',
    title: 'Service task',
    category: 'orchestration',
    state: 'awaiting_input',
    stateLabel: 'Needs approval',
    statusSymbol: '!',
    purpose: 'p',
    whySeparate: 'w',
    deliverable: 'd',
    acceptanceCriteria: ['a'],
    fileScopes: ['service/**'],
    skills: ['Contracts'],
    dependsOn: ['interface'],
    agentProfile: 'Backend orchestration',
    currentActivity: 'Waiting for a decision.',
    evidence: [],
  },
];

function event(partial: Record<string, unknown>): DomainEvent {
  return {
    id: `event_${String(partial.sequence ?? 1)}`,
    version: 1,
    sequence: 1,
    occurredAt: '2026-09-18T00:00:00.000Z',
    recordedAt: '2026-09-18T00:00:00.000Z',
    runId: 'run_fixture',
    source: 'orchestrator',
    ...partial,
  } as unknown as DomainEvent;
}

const snapshot = {
  phase: 'approval_required',
  availableCommands: ['approve', 'deny', 'cancel'],
  nextStepLabel: 'Review the requested capability',
  events: [
    event({
      sequence: 1,
      type: 'run.state_changed',
      payload: { from: 'preparing', to: 'executing', reason: 'Started.' },
    }),
    event({
      sequence: 2,
      type: 'task.state_changed',
      taskId: 'task_fixture_service',
      payload: { from: 'ready', to: 'running', reason: 'Working.' },
    }),
    event({
      sequence: 3,
      type: 'approval.requested',
      taskId: 'task_fixture_service',
      source: 'runtime',
      payload: {
        approval: { id: 'approval_1', requestedAction: 'Write fixture' },
      },
    }),
  ],
  projection: {
    runId: 'run_fixture',
    tasks: {
      task_fixture_service: { id: 'task_fixture_service' },
      task_fixture_interface: { id: 'task_fixture_interface' },
    },
    approvals: {
      approval_1: {
        id: 'approval_1',
        requestedAction: 'Write fixture',
        reason: 'Needs one bounded write.',
        scope: 'service/fixtures/**',
        consequences: 'No real files change.',
        state: 'requested',
      },
    },
    validations: {},
  },
} as unknown as DemoRunSnapshot;

describe('composer input', () => {
  it('parses commands, arguments, free text, and unknown commands', () => {
    expect(parseComposerInput('  ')).toEqual({ kind: 'empty' });
    expect(parseComposerInput('/next')).toEqual({
      kind: 'command',
      name: 'next',
    });
    expect(parseComposerInput('/to service')).toEqual({
      kind: 'command',
      name: 'to',
      argument: 'service',
    });
    expect(parseComposerInput('/nope')).toEqual({
      kind: 'unknown-command',
      name: 'nope',
    });
    expect(parseComposerInput('please hurry')).toEqual({
      kind: 'text',
      text: 'please hurry',
    });
  });

  it('suggests commands by prefix and resolves room aliases', () => {
    expect(listCommands('/ap').map((command) => command.name)).toEqual([
      'approve',
    ]);
    expect(resolveRoomId('backend')).toBe('service');
    expect(resolveRoomId('coord')).toBe('coordinator');
    expect(resolveRoomId('nowhere')).toBeUndefined();
  });
});

describe('rooms', () => {
  it('always lists the coordinator first and closes task rooms before launch', () => {
    const rooms = buildRooms({} as never, tasks, undefined, undefined);
    expect(rooms.map((room) => room.id)).toEqual([
      'coordinator',
      'interface',
      'service',
    ]);
    expect(rooms[0]?.open).toBe(true);
    expect(rooms[1]?.open).toBe(false);
  });

  it('marks only the attention task room and mirrors task state', () => {
    const rooms = buildRooms({} as never, tasks, snapshot, 'service');
    expect(
      rooms.filter((room) => room.attention).map((room) => room.id),
    ).toEqual(['service']);
    expect(rooms[2]?.stateLabel).toBe('Needs approval');
  });

  it('routes task events to their room and approvals to both rooms', () => {
    const rooms = buildRooms({} as never, tasks, snapshot, 'service');
    const service = rooms[2] as RoomViewModel;
    const coordinator = rooms[0] as RoomViewModel;
    const serviceMessages = buildRoomMessages(service, snapshot);
    const coordinatorMessages = buildRoomMessages(coordinator, snapshot);
    expect(serviceMessages.map((message) => message.sequence)).toEqual([2, 3]);
    expect(serviceMessages[1]?.proposal).toMatchObject({
      approvalId: 'approval_1',
      state: 'requested',
      scope: 'service/fixtures/**',
    });
    expect(coordinatorMessages.map((message) => message.sequence)).toEqual([
      1, 3,
    ]);
    expect(buildRoomMessages(rooms[1] as RoomViewModel, snapshot)).toEqual([]);
  });
});
