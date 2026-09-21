// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CommandResponseSchema,
  MessageSchema,
  MessagesPageSchema,
  ProjectResponseSchema,
  type ProjectResponse,
} from '@harness/contracts';
import { postMessage, readMessages, stopAgent } from './api';
import { liveTargets } from './live';
import { LivePane } from './live-pane';

vi.mock('./api', () => ({
  ApiError: class ApiError extends Error {
    constructor(
      readonly status: number,
      message: string,
      readonly code?: string,
    ) {
      super(message);
    }
  },
  postMessage: vi.fn(),
  readMessages: vi.fn(),
  readProject: vi.fn(),
  stopAgent: vi.fn(),
}));

const at = '2026-03-01T00:00:00.000Z';

function project(work: 'idle' | 'working' = 'idle'): ProjectResponse {
  const task =
    work === 'working'
      ? {
          task_1: {
            id: 'task_1',
            projectId: 'project_x',
            agentId: 'agent_a',
            title: 'Build the form',
            objective: 'Build the form',
            category: 'interface',
            skills: [],
            scope: [],
            scopeHistory: [],
            dependsOn: [],
            inputsSatisfied: [],
            expectedOutputs: [],
            requiredChecks: [],
            state: 'working',
            createdAtSequence: 5,
          },
        }
      : {};
  return ProjectResponseSchema.parse({
    projection: {
      projectId: 'project_x',
      project: { id: 'project_x', name: 'X', origin: 'user', createdAt: at },
      brief: {
        version: 0,
        fields: Object.fromEntries(
          [
            'goal',
            'scope',
            'constraints',
            'doneMeans',
            'checks',
            'audience',
          ].map((id) => [id, { state: 'missing' }]),
        ),
        requests: [],
        lastSequence: 1,
      },
      method: null,
      methodSnapshots: {},
      threads: {
        thread_c: {
          id: 'thread_c',
          projectId: 'project_x',
          kind: 'coordinator',
          state: 'open',
          messageCount: 1,
          lastSequence: 3,
        },
        thread_a: {
          id: 'thread_a',
          projectId: 'project_x',
          kind: 'agent',
          agentId: 'agent_a',
          state: 'open',
          messageCount: 0,
          lastSequence: 4,
        },
      },
      agents: {
        agent_a: {
          id: 'agent_a',
          projectId: 'project_x',
          threadId: 'thread_a',
          name: 'Interface systems',
          category: 'interface',
          work,
          ...(work === 'working' ? { currentTaskId: 'task_1' } : {}),
          taskIds: work === 'working' ? ['task_1'] : [],
          createdAtSequence: 4,
          lastSequence: 5,
        },
      },
      tasks: task,
      planDocument: { sections: {}, lastSequence: 1 },
      plans: {},
      proposals: {},
      asks: {},
      checks: {},
      outputs: {},
      activities: {},
      lastSequence: 5,
      lastEventId: 'event_5',
      appliedEventIds: ['event_1', 'event_2', 'event_3', 'event_4', 'event_5'],
    },
    summary: {
      status: work === 'working' ? 'working' : 'intake',
      briefReady: false,
      agentCounts: {
        idle: work === 'idle' ? 1 : 0,
        waiting: 0,
        working: work === 'working' ? 1 : 0,
        needs_you: 0,
        done: 0,
        stopped: 0,
        failed: 0,
      },
      openAskIds: [],
      openProposalIds: [],
      lastSequence: 5,
    },
    brief: { markdown: '# X', digest: 'sha256:x' },
  });
}

function message(sequence: number, role: 'user' | 'agent', body: string) {
  return MessageSchema.parse({
    id: `message_${sequence}`,
    projectId: 'project_x',
    threadId: 'thread_a',
    author:
      role === 'user'
        ? { role, source: 'client' }
        : { role, source: 'simulated_adapter', agentId: 'agent_a' },
    intent: 'chat',
    body,
    postedAt: at,
    sequence,
  });
}

const page = (input: unknown) => MessagesPageSchema.parse(input);
const command = (input: unknown) => CommandResponseSchema.parse(input);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('live pane', () => {
  it('shows persisted messages; /chat talks and a plain message gives an idle agent work', async () => {
    const initial = project();
    const target = liveTargets(initial).find((t) => t.kind === 'agent')!;
    vi.mocked(readMessages)
      .mockResolvedValueOnce(page({ messages: [], newerCursor: 0 }))
      .mockResolvedValueOnce(
        page({
          messages: [
            message(6, 'user', 'What changed?'),
            message(7, 'agent', 'Nothing yet.'),
          ],
          newerCursor: 7,
        }),
      )
      .mockResolvedValueOnce(
        page({
          messages: [
            message(8, 'user', 'Build the form'),
            message(10, 'agent', 'Starting: Build the form.'),
          ],
          newerCursor: 10,
        }),
      );
    vi.mocked(postMessage)
      .mockResolvedValueOnce(
        command({
          receipt: {
            commandId: '00000000-0000-4000-8000-000000000001',
            firstSequence: 6,
            lastSequence: 7,
            createdIds: {},
            replayed: false,
          },
          project: initial,
        }),
      )
      .mockResolvedValueOnce(
        command({
          receipt: {
            commandId: '00000000-0000-4000-8000-000000000002',
            firstSequence: 8,
            lastSequence: 10,
            createdIds: { tasks: ['task_1'] },
            replayed: false,
          },
          project: project('working'),
        }),
      );
    const onProject = vi.fn();
    render(
      <LivePane
        project={initial}
        target={target}
        canClose={false}
        onProject={onProject}
        onClose={() => undefined}
      />,
    );
    expect(await screen.findByText('Nothing yet.')).toBeTruthy();
    const box = screen.getByLabelText('Message Interface systems');
    const user = userEvent.setup();
    await user.type(box, '/chat What changed?{Enter}');
    await waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith('project_x', 'agent_a', {
        expectedSequence: 4,
        body: 'What changed?',
        intent: 'chat',
      }),
    );
    expect(await screen.findByText('Nothing yet.')).toBeTruthy();
    expect(screen.getByText('What changed?')).toBeTruthy();

    await user.type(box, 'Build the form{Enter}');
    await waitFor(() =>
      expect(postMessage).toHaveBeenLastCalledWith('project_x', 'agent_a', {
        expectedSequence: 4,
        body: 'Build the form',
        intent: 'start_work',
      }),
    );
    expect(await screen.findByText('Starting: Build the form.')).toBeTruthy();
    expect(onProject).toHaveBeenLastCalledWith(
      expect.objectContaining({
        summary: expect.objectContaining({ status: 'working' }),
      }),
    );
  });

  it('offers Stop only while the agent is working and sends the agent sequence', async () => {
    const working = project('working');
    const target = liveTargets(working).find((t) => t.kind === 'agent')!;
    vi.mocked(readMessages).mockResolvedValue(
      page({ messages: [], newerCursor: 0 }),
    );
    vi.mocked(stopAgent).mockResolvedValue(
      command({
        receipt: {
          commandId: '00000000-0000-4000-8000-000000000003',
          firstSequence: 11,
          lastSequence: 12,
          createdIds: {},
          replayed: false,
        },
        project: project(),
      }),
    );
    render(
      <LivePane
        project={working}
        target={target}
        canClose={false}
        onProject={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(screen.getByText('Working')).toBeTruthy();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(() =>
      expect(stopAgent).toHaveBeenCalledWith('project_x', 'agent_a', 5),
    );
    cleanup();
    render(
      <LivePane
        project={project()}
        target={liveTargets(project()).find((t) => t.kind === 'agent')!}
        canClose={false}
        onProject={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    expect(screen.getByText('Idle')).toBeTruthy();
  });
});
