import { ProjectEventSchema, type ProjectEvent } from '@harness/contracts';
import { describe, expect, it } from 'vitest';
import { buildChanges } from './project-changes';

const at = '2026-03-01T00:00:00.000Z';
let sequence = 0;

function event(
  type: string,
  payload: unknown,
  source: ProjectEvent['source'] = 'user',
): ProjectEvent {
  sequence += 1;
  return ProjectEventSchema.parse({
    id: `event_${sequence}`,
    version: 1,
    sequence,
    occurredAt: at,
    recordedAt: at,
    projectId: 'project_x',
    source,
    type,
    payload,
  });
}

describe('buildChanges', () => {
  it('describes an edit by what it added and removed, newest first', () => {
    sequence = 0;
    const changes = buildChanges([
      event('plan.section_edited', {
        sectionId: 'features',
        lines: ['Offline sync'],
        source: 'user',
      }),
      event(
        'plan.section_edited',
        {
          sectionId: 'features',
          lines: ['Offline sync', 'Dark mode'],
          source: 'coordinator',
        },
        'coordinator',
      ),
    ]);
    expect(changes.map((change) => change.sequence)).toEqual([2, 1]);
    expect(changes[0]).toMatchObject({
      kind: 'idea',
      who: 'coordinator',
      title: 'Plan · Features',
      added: ['Dark mode'],
      removed: [],
      target: { kind: 'plan' },
    });
    expect(changes[1]!.added).toEqual(['Offline sync']);
  });

  it('reads files, checks, task ends and settings out of the log', () => {
    sequence = 0;
    const changes = buildChanges([
      event('agent.created', {
        agent: {
          id: 'agent_a',
          projectId: 'project_x',
          threadId: 'thread_a',
          name: 'Explorer',
          category: 'neutral',
          work: 'idle',
          taskIds: [],
          createdAtSequence: 1,
          lastSequence: 1,
        },
      }),
      event('task.assigned', {
        task: {
          id: 'task_1',
          projectId: 'project_x',
          agentId: 'agent_a',
          title: 'Add a line',
          objective: 'Add it',
          category: 'neutral',
          skills: [],
          scope: [],
          scopeHistory: [],
          dependsOn: [],
          inputsSatisfied: [],
          expectedOutputs: [],
          requiredChecks: [],
          state: 'working',
          createdAtSequence: 2,
        },
      }),
      event(
        'output.produced',
        {
          output: {
            id: 'output_1',
            projectId: 'project_x',
            agentId: 'agent_a',
            taskId: 'task_1',
            kind: 'diff',
            title: 'README.md',
            digest: 'Wrote README.md.',
            location: 'README.md',
            diff: '+a line',
            producedAtSequence: 3,
          },
        },
        'agent',
      ),
      event(
        'check.started',
        {
          check: {
            id: 'check_1',
            projectId: 'project_x',
            agentId: 'agent_a',
            taskId: 'task_1',
            name: 'tests',
            command: 'npm test',
            state: 'running',
            startedAtSequence: 4,
          },
        },
        'agent',
      ),
      event(
        'check.finished',
        {
          checkId: 'check_1',
          from: 'running',
          to: 'failed',
          summary: 'one failing',
        },
        'agent',
      ),
      event(
        'task.state_changed',
        { taskId: 'task_1', from: 'working', to: 'failed', reason: 'gave up' },
        'agent',
      ),
      event('project.trust_changed', { trust: 'task' }),
    ]);
    expect(
      changes.map((change) => [change.kind, change.title]).reverse(),
    ).toEqual([
      ['task', 'Started “Add a line”'],
      ['file', 'README.md'],
      ['check', 'Failed: npm test'],
      ['task', 'Failed “Add a line”'],
      ['setting', 'Asks: task'],
    ]);
    const file = changes.find((change) => change.kind === 'file')!;
    expect(file).toMatchObject({
      who: 'agent',
      detail: '+a line',
      target: { kind: 'file', path: 'README.md' },
    });
    const started = changes.find((change) =>
      change.title.startsWith('Started'),
    )!;
    expect(started.detail).toBe('Explorer');
  });
});
