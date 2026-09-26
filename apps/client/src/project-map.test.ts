import { ProjectResponseSchema } from '@harness/contracts';
import { describe, expect, it } from 'vitest';
import { branchOf, buildProjectMap } from './project-map';

const at = '2026-03-01T00:00:00.000Z';

// A project where one idea became a task that wrote a file and passed a
// check, and another idea nobody has taken.
function project() {
  return ProjectResponseSchema.parse({
    projection: {
      projectId: 'project_x',
      project: { id: 'project_x', name: 'Map', origin: 'user', createdAt: at },
      brief: {
        version: 1,
        fields: {
          goal: { state: 'missing' },
          scope: { state: 'missing' },
          constraints: { state: 'missing' },
          doneMeans: { state: 'missing' },
          checks: { state: 'missing' },
          audience: { state: 'missing' },
        },
        requests: [],
        lastSequence: 1,
      },
      method: null,
      methodSnapshots: {},
      threads: {
        thread_a: {
          id: 'thread_a',
          projectId: 'project_x',
          kind: 'agent',
          agentId: 'agent_a',
          state: 'open',
          messageCount: 2,
          lastSequence: 6,
        },
      },
      agents: {
        agent_a: {
          id: 'agent_a',
          projectId: 'project_x',
          threadId: 'thread_a',
          name: 'Interface systems',
          category: 'interface',
          work: 'done',
          taskIds: ['task_1'],
          createdAtSequence: 2,
          lastSequence: 6,
        },
      },
      tasks: {
        task_1: {
          id: 'task_1',
          projectId: 'project_x',
          agentId: 'agent_a',
          title: 'Build the search page',
          objective: 'Build it',
          category: 'interface',
          skills: [],
          scope: [],
          scopeHistory: [],
          dependsOn: [],
          inputsSatisfied: [],
          expectedOutputs: [],
          requiredChecks: [],
          sections: ['ui'],
          state: 'done',
          createdAtSequence: 3,
        },
      },
      planDocument: {
        sections: {
          features: {
            lines: ['Offline sync'],
            source: 'user',
            updatedAtSequence: 2,
          },
          ui: { lines: ['Search page'], source: 'user', updatedAtSequence: 2 },
        },
        lastSequence: 2,
      },
      plans: {},
      proposals: {},
      asks: {},
      checks: {
        check_1: {
          id: 'check_1',
          projectId: 'project_x',
          agentId: 'agent_a',
          taskId: 'task_1',
          name: 'tests',
          command: 'npm test',
          state: 'passed',
          startedAtSequence: 4,
        },
      },
      outputs: {
        output_1: {
          id: 'output_1',
          projectId: 'project_x',
          agentId: 'agent_a',
          taskId: 'task_1',
          kind: 'diff',
          title: 'src/search.ts',
          digest: 'Wrote it.',
          location: 'src/search.ts',
          producedAtSequence: 5,
        },
      },
      activities: {},
      lastSequence: 6,
      lastEventId: 'event_6',
      appliedEventIds: ['event_1'],
    },
    summary: {
      status: 'complete',
      briefReady: false,
      agentCounts: {
        idle: 0,
        waiting: 0,
        working: 0,
        needs_you: 0,
        done: 1,
        stopped: 0,
        failed: 0,
      },
      openAskIds: [],
      openProposalIds: [],
      lastSequence: 6,
    },
    brief: { markdown: '# Map', digest: 'sha256:0123456789abcdef0123' },
  });
}

describe('buildProjectMap', () => {
  it('links ideas to tasks to files, and marks what nobody took', () => {
    const map = buildProjectMap(project());
    expect(map.ideas.map((idea) => [idea.sectionId, idea.unclaimed])).toEqual([
      ['features', true],
      ['ui', false],
    ]);
    expect(map.tasks).toMatchObject([
      {
        id: 'task_1',
        agentName: 'Interface systems',
        state: 'done',
        fileIds: ['file:src/search.ts'],
        checksPassed: 1,
        checksFailed: 0,
        unverified: false,
      },
    ]);
    expect(map.files).toMatchObject([
      { id: 'file:src/search.ts', path: 'src/search.ts', taskIds: ['task_1'] },
    ]);
    expect(map.edges).toEqual([
      { from: 'idea:ui', to: 'task_1' },
      { from: 'task_1', to: 'file:src/search.ts' },
    ]);
  });

  it('marks a task that changed files without a passing check', () => {
    const response = project();
    const stripped = {
      ...response,
      projection: { ...response.projection, checks: {} },
    };
    expect(buildProjectMap(stripped).tasks[0]).toMatchObject({
      unverified: true,
      checksPassed: 0,
    });
  });

  it('walks a whole branch from any node in it', () => {
    const map = buildProjectMap(project());
    expect([...branchOf(map, 'file:src/search.ts')].sort()).toEqual([
      'file:src/search.ts',
      'idea:ui',
      'task_1',
    ]);
    expect([...branchOf(map, 'idea:features')]).toEqual(['idea:features']);
  });
});
