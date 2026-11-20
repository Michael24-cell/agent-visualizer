import type { ProjectResponse } from '@harness/contracts';
import { describe, expect, it } from 'vitest';
import { signalsBetween, waitingOnYou } from './project-sync';

// Only the fields the signals read.
function project(options: {
  asks?: Record<string, unknown>;
  proposals?: Record<string, unknown>;
  tasks?: Record<string, unknown>;
  openAsks?: number;
  openProposals?: number;
}): ProjectResponse {
  return {
    projection: {
      project: { name: 'Shop' },
      agents: { agent_a: { id: 'agent_a', name: 'Interface systems' } },
      asks: options.asks ?? {},
      proposals: options.proposals ?? {},
      tasks: options.tasks ?? {},
    },
    summary: {
      openAskIds: Array.from(
        { length: options.openAsks ?? 0 },
        (_, i) => `a${i}`,
      ),
      openProposalIds: Array.from(
        { length: options.openProposals ?? 0 },
        (_, i) => `p${i}`,
      ),
    },
  } as unknown as ProjectResponse;
}

const task = (state: string, extra: object = {}) => ({
  id: 'task_1',
  agentId: 'agent_a',
  title: 'Search box',
  state,
  ...extra,
});

describe('signalsBetween', () => {
  it('says when an agent asks for something', () => {
    const before = project({});
    const after = project({
      asks: {
        ask_1: {
          id: 'ask_1',
          agentId: 'agent_a',
          state: 'open',
          action: 'Run npm install',
        },
      },
    });
    expect(signalsBetween(before, after)).toEqual([
      {
        kind: 'ask',
        key: 'ask_1',
        title: 'Interface systems needs you',
        body: 'Shop: Run npm install',
      },
    ]);
  });

  it('says when a plan is ready to decide', () => {
    const after = project({
      proposals: {
        p_1: { id: 'p_1', state: 'open', title: 'Assign plan v1' },
      },
    });
    expect(signalsBetween(project({}), after)[0]).toMatchObject({
      kind: 'plan',
      body: 'Shop: Assign plan v1',
    });
  });

  it('names the outside tool when its task ends, with why it failed', () => {
    const before = project({ tasks: { task_1: task('working') } });
    const after = project({
      tasks: {
        task_1: task('failed', {
          outside: { client: 'Claude Code' },
          endReason: 'Tests did not pass.',
        }),
      },
    });
    expect(signalsBetween(before, after)).toEqual([
      {
        kind: 'failed',
        key: 'task_1',
        title: 'Claude Code failed',
        body: 'Shop: Search box — Tests did not pass.',
      },
    ]);
  });

  it('stays quiet when nothing new happened', () => {
    const same = project({ tasks: { task_1: task('done') } });
    expect(signalsBetween(same, same)).toEqual([]);
    const stopped = project({ tasks: { task_1: task('stopped') } });
    expect(
      signalsBetween(project({ tasks: { task_1: task('working') } }), stopped),
    ).toEqual([]);
  });
});

describe('waitingOnYou', () => {
  it('counts asks and plans to decide', () => {
    expect(waitingOnYou(project({ openAsks: 2, openProposals: 1 }))).toBe(3);
  });
});
