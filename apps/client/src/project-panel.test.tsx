// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CommandResponseSchema,
  ProjectResponseSchema,
  type ProjectResponse,
} from '@harness/contracts';
import { listMethods, updateBriefField } from './api';
import { ProjectDetail } from './project-panel';

vi.mock('./api', () => ({
  applyMethod: vi.fn(),
  createProject: vi.fn(),
  listMethods: vi.fn(),
  overrideMethod: vi.fn(),
  readEvents: vi.fn(),
  updateBriefField: vi.fn(),
}));

const at = '2026-03-01T00:00:00.000Z';

function project(
  goalState: 'missing' | 'inferred' = 'inferred',
): ProjectResponse {
  return ProjectResponseSchema.parse({
    projection: {
      projectId: 'project_x',
      project: {
        id: 'project_x',
        name: 'Exports',
        origin: 'user',
        createdAt: at,
      },
      brief: {
        version: 1,
        fields: {
          goal:
            goalState === 'inferred'
              ? {
                  state: 'inferred',
                  value: 'Monthly exports',
                  source: 'coordinator',
                }
              : { state: 'missing' },
          scope: { state: 'missing' },
          constraints: { state: 'missing' },
          doneMeans: { state: 'missing' },
          checks: { state: 'missing' },
          audience: { state: 'missing' },
        },
        requests: [],
        lastSequence: 4,
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
      },
      agents: {},
      tasks: {},
      plans: {},
      proposals: {},
      asks: {},
      checks: {},
      outputs: {},
      lastSequence: 4,
      lastEventId: 'event_4',
      appliedEventIds: ['event_1', 'event_2', 'event_3', 'event_4'],
    },
    summary: {
      status: 'intake',
      briefReady: false,
      agentCounts: {
        idle: 0,
        waiting: 0,
        working: 0,
        needs_you: 0,
        done: 0,
        stopped: 0,
        failed: 0,
      },
      openAskIds: [],
      openProposalIds: [],
      attention: {
        kind: 'intake',
        label: 'Tell the coordinator what to build',
      },
      lastSequence: 4,
    },
    brief: { markdown: '# Exports', digest: 'sha256:0123456789abcdef0123' },
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('project panel', () => {
  it('confirms an inferred Brief field through the command, with the brief sequence', async () => {
    const before = project('inferred');
    vi.mocked(updateBriefField).mockResolvedValue(
      CommandResponseSchema.parse({
        receipt: {
          commandId: '00000000-0000-4000-8000-000000000010',
          firstSequence: 5,
          lastSequence: 5,
          createdIds: {},
          replayed: false,
        },
        project: before,
      }),
    );
    const onProject = vi.fn();
    render(
      <ProjectDetail
        item="brief"
        project={before}
        busy={false}
        onProject={onProject}
        onError={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(screen.getByText('Inferred — confirm?')).toBeTruthy();
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() =>
      expect(updateBriefField).toHaveBeenCalledWith(
        'project_x',
        4,
        'goal',
        'confirm',
        undefined,
      ),
    );
    expect(onProject).toHaveBeenCalled();
  });

  it('shows the catalog while no Method is applied', async () => {
    vi.mocked(listMethods).mockResolvedValue([]);
    render(
      <ProjectDetail
        item="method"
        project={project()}
        busy={false}
        onProject={() => undefined}
        onError={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(screen.getByText('Default behavior.')).toBeTruthy();
    await waitFor(() => expect(listMethods).toHaveBeenCalled());
  });
});
