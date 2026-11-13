import type { ProjectResponse } from '@harness/contracts';
import { describe, expect, it } from 'vitest';
import { firstPane } from './live';

// Only the fields firstPane reads.
function project(options: {
  coordinatorMessages: number;
  agentTasks: string[];
}): ProjectResponse {
  return {
    projection: {
      threads: {
        thread_c: {
          id: 'thread_c',
          kind: 'coordinator',
          state: 'open',
          messageCount: options.coordinatorMessages,
          lastSequence: 3,
        },
        thread_a: {
          id: 'thread_a',
          kind: 'agent',
          agentId: 'agent_a',
          state: 'open',
          messageCount: 0,
          lastSequence: 2,
        },
      },
      agents: {
        agent_a: {
          id: 'agent_a',
          threadId: 'thread_a',
          name: 'Agent 1',
          category: 'neutral',
          work: 'idle',
          taskIds: options.agentTasks,
          createdAtSequence: 2,
          lastSequence: 2,
        },
      },
    },
  } as unknown as ProjectResponse;
}

describe('firstPane', () => {
  it('opens the coordinator when that is where you just spoke', () => {
    expect(firstPane(project({ coordinatorMessages: 2, agentTasks: [] }))).toBe(
      'coordinator',
    );
  });

  it('opens the agent that has work, whatever the coordinator said', () => {
    expect(
      firstPane(project({ coordinatorMessages: 5, agentTasks: ['task_1'] })),
    ).toBe('agent_a');
  });

  it('opens the agent pane on a project nobody has spoken in yet', () => {
    expect(firstPane(project({ coordinatorMessages: 1, agentTasks: [] }))).toBe(
      'agent_a',
    );
  });
});
