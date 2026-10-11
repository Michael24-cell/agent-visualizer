import {
  ProjectResponseSchema,
  type ProjectEvent,
  type ProjectResponse,
} from '@harness/contracts';
import { describe, expect, it } from 'vitest';
import { lineSpan, parseDiff } from './diff-rows';
import { buildReview, flagged } from './review-model';

const at = (minute: number) =>
  `2026-03-01T10:${String(minute).padStart(2, '0')}:00.000Z`;

const agent = (id: string, name: string, taskIds: string[]) => ({
  id,
  projectId: 'project_x',
  threadId: `thread_${id}`,
  name,
  category: 'neutral',
  work: 'done',
  taskIds,
  createdAtSequence: 1,
  lastSequence: 20,
});

const task = (
  id: string,
  agentId: string,
  title: string,
  createdAtSequence: number,
  usage?: object,
) => ({
  id,
  projectId: 'project_x',
  agentId,
  title,
  objective: title,
  category: 'neutral',
  skills: [],
  scope: [],
  scopeHistory: [],
  dependsOn: [],
  inputsSatisfied: [],
  expectedOutputs: [],
  requiredChecks: [],
  sections: ['features'],
  state: 'done',
  startedAt: at(1),
  createdAtSequence,
  ...(usage ? { usage } : {}),
});

const output = (
  id: string,
  agentId: string,
  taskId: string,
  location: string,
  diff: string,
  producedAtSequence: number,
) => ({
  id,
  projectId: 'project_x',
  agentId,
  taskId,
  kind: 'diff',
  title: location,
  digest: `Wrote ${location}.`,
  location,
  diff,
  producedAtSequence,
});

const OUTPUTS = {
  // Step 1: Ada's first write, verified by a check that starts after it.
  output_1: output(
    'output_1',
    'agent_a',
    'task_1',
    'src/app.ts',
    '@@ -1 +1 @@\n-const a = 1;\n+const a = 2;',
    4,
  ),
  // Step 2: Ada again, with a key and a console.log, nothing run after.
  output_2: output(
    'output_2',
    'agent_a',
    'task_1',
    'src/config.ts',
    [
      '@@ -3 +3 @@',
      ' export const config = {',
      "+  apiKey: 'sk-live1234567890abcdefXYZ',",
      "+  debug: console.log('loaded'),",
      ' };',
    ].join('\n'),
    7,
  ),
  // Step 3: Bo edits the file Ada wrote, and a test loses an assertion.
  output_3: output(
    'output_3',
    'agent_b',
    'task_2',
    'src/app.ts',
    '@@ -1 +1 @@\n-const a = 2;\n+const a = 3;',
    11,
  ),
  output_4: output(
    'output_4',
    'agent_b',
    'task_2',
    'src/app.test.ts',
    '@@ -5 +5 @@\n   expect(a).toBe(2);\n-  expect(b).toBe(3);',
    12,
  ),
};

function project(): ProjectResponse {
  return ProjectResponseSchema.parse({
    projection: {
      projectId: 'project_x',
      project: {
        id: 'project_x',
        name: 'Review',
        origin: 'user',
        createdAt: at(0),
      },
      brief: {
        version: 1,
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
      threads: {},
      agents: {
        agent_a: agent('agent_a', 'Ada', ['task_1']),
        agent_b: agent('agent_b', 'Bo', ['task_2']),
      },
      tasks: {
        task_1: task('task_1', 'agent_a', 'Wire the config', 2, {
          'claude-sonnet-5': {
            provider: 'anthropic',
            inputTokens: 1_000_000,
            outputTokens: 100_000,
            turns: 4,
          },
        }),
        task_2: task('task_2', 'agent_b', 'Bump the value', 9, {
          'gpt-6.1-sol': {
            provider: 'chatgpt',
            inputTokens: 5_000,
            outputTokens: 400,
            turns: 2,
          },
        }),
      },
      planDocument: { sections: {}, lastSequence: 1 },
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
          startedAtSequence: 5,
        },
      },
      outputs: OUTPUTS,
      activities: {},
      lastSequence: 20,
      lastEventId: 'event_20',
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
        done: 2,
        stopped: 0,
        failed: 0,
      },
      openAskIds: [],
      openProposalIds: [],
      lastSequence: 20,
    },
    brief: { markdown: '# Review', digest: 'sha256:0123456789abcdef0123' },
  });
}

// Only the fields buildReview reads; the full shapes are covered by the
// contract tests.
function said(sequence: number, taskId: string, body: string): ProjectEvent {
  return {
    sequence,
    occurredAt: at(sequence),
    type: 'message.posted',
    payload: {
      message: { author: { role: 'agent' }, refs: { taskId }, body },
    },
  } as unknown as ProjectEvent;
}
function wrote(sequence: number, id: keyof typeof OUTPUTS): ProjectEvent {
  return {
    sequence,
    occurredAt: at(sequence),
    type: 'output.produced',
    payload: { output: OUTPUTS[id] },
  } as unknown as ProjectEvent;
}
function ended(sequence: number, taskId: string): ProjectEvent {
  return {
    sequence,
    occurredAt: at(sequence),
    type: 'task.state_changed',
    payload: { taskId, from: 'working', to: 'done', reason: 'Done.' },
  } as unknown as ProjectEvent;
}

function notice(sequence: number, taskId: string, body: string): ProjectEvent {
  return {
    sequence,
    occurredAt: at(sequence),
    type: 'message.posted',
    payload: {
      message: {
        author: { role: 'agent' },
        refs: { taskId, askId: 'ask_1' },
        body,
      },
    },
  } as unknown as ProjectEvent;
}

const EVENTS = [
  said(3, 'task_1', 'Changing a to 2 so the totals match.'),
  // The harness asking permission is not the agent's reason.
  notice(3, 'task_1', 'Needs you: Run Write. Would write to src/app.ts.'),
  wrote(4, 'output_1'),
  said(6, 'task_1', 'Adding the config the service reads.'),
  wrote(7, 'output_2'),
  // Said after the change: must not be taken as its reason.
  said(8, 'task_1', 'All done.'),
  ended(8, 'task_1'),
  wrote(11, 'output_3'),
  wrote(12, 'output_4'),
  ended(13, 'task_2'),
];

describe('buildReview', () => {
  it('numbers changes in order, with the reason the agent gave before each', () => {
    const { changes } = buildReview(project(), EVENTS);
    expect(
      changes.map((change) => [change.step, change.path, change.agentName]),
    ).toEqual([
      [1, 'src/app.ts', 'Ada'],
      [2, 'src/config.ts', 'Ada'],
      [3, 'src/app.ts', 'Bo'],
      [4, 'src/app.test.ts', 'Bo'],
    ]);
    expect(changes[0]!.said).toBe('Changing a to 2 so the totals match.');
    expect(changes[1]!.said).toBe('Adding the config the service reads.');
    // Bo said nothing before writing.
    expect(changes[2]!.said).toBeUndefined();
    expect(changes[0]).toMatchObject({
      added: 1,
      removed: 1,
      taskTitle: 'Wire the config',
      sections: ['features'],
    });
  });

  it('counts a check as verifying only what came before it', () => {
    const { changes } = buildReview(project(), EVENTS);
    expect(changes.map((change) => change.check)).toEqual([
      'passed',
      'none',
      'none',
      'none',
    ]);
  });

  it('flags what deserves a second look, worst first, with the lines', () => {
    const { changes } = buildReview(project(), EVENTS);
    expect(changes[1]!.flags).toEqual([
      { kind: 'possible-secret', lines: [4] },
      { kind: 'unverified' },
      { kind: 'leftover', lines: [5] },
    ]);
    // Two agents wrote src/app.ts.
    expect(changes[0]!.flags.map((flag) => flag.kind)).toEqual(['shared-file']);
    expect(changes[3]!.flags.map((flag) => flag.kind)).toContain(
      'tests-edited',
    );
    // Unverified alone is not enough to call it out.
    expect(changes.map(flagged)).toEqual([true, true, true, true]);
  });

  it('groups sessions by task with their checks, tokens and price', () => {
    const { sessions } = buildReview(project(), EVENTS);
    expect(sessions.map((session) => session.title)).toEqual([
      'Wire the config',
      'Bump the value',
    ]);
    const [first, second] = sessions;
    expect(first).toMatchObject({
      agentName: 'Ada',
      checks: [{ name: 'tests', state: 'passed' }],
      tokens: { input: 1_000_000, output: 100_000 },
      onPlan: false,
      endedAt: at(8),
    });
    // 1M in × $2 + 0.1M out × $10 on Sonnet 5.
    expect(first!.cost).toBeCloseTo(3, 10);
    expect(first!.changes.map((change) => change.step)).toEqual([1, 2]);
    expect(second).toMatchObject({ onPlan: true, cost: 0 });
  });
});

describe('parseDiff', () => {
  it('numbers lines from hunk headers, in both versions', () => {
    const rows = parseDiff('@@ -10 +12 @@\n a\n-b\n+B\n+C\n c');
    expect(rows.map((row) => [row.kind, row.oldLine, row.newLine])).toEqual([
      ['ctx', 10, 12],
      ['del', 11, undefined],
      ['add', undefined, 13],
      ['add', undefined, 14],
      ['ctx', 12, 15],
    ]);
    expect(lineSpan(rows.slice(1, 4))).toEqual({ from: 11, to: 14 });
  });

  it('reads git hunks and older diffs with no numbers', () => {
    expect(
      parseDiff('@@ -1,2 +1,3 @@ function f() {\n x\n+y').map(
        (row) => row.newLine,
      ),
    ).toEqual([1, 2]);
    const legacy = parseDiff(' a\n-b\n…\n+c');
    expect(legacy.map((row) => row.kind)).toEqual(['ctx', 'del', 'gap', 'add']);
    expect(legacy.every((row) => row.newLine === undefined)).toBe(true);
    expect(parseDiff('(diff too large: 4000 → 4001 lines)')).toEqual([
      { kind: 'note', text: '(diff too large: 4000 → 4001 lines)' },
    ]);
  });
});
