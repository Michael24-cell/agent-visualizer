import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { laneTask } from '@harness/runtime-simulated';
import { average, gradePlan, loadCases, runCase } from './planner-eval.js';
import type { ModelPlanner } from './model-planner.js';

const CASES = fileURLToPath(
  new URL('../../../evals/planner/cases.json', import.meta.url),
);

// The built-in planner's score on the cases when this was written. A
// change that lowers it should be deliberate; raise it when it improves.
const BUILT_IN_FLOOR = 0.64;

describe('gradePlan', () => {
  it('passes a plan that does what the case asks', () => {
    const checks = gradePlan(
      {
        tasks: [
          laneTask('interface', {
            title: 'Invoice list with PDF download',
            objective: 'Show past invoices with a download button.',
            dependsOn: [],
          }),
          laneTask('orchestration', {
            title: 'Invoice PDF endpoint',
            objective: 'Serve each invoice as a PDF to its owner.',
            dependsOn: [0],
          }),
        ],
        whyThisMany: 'Page and endpoint review apart.',
      },
      {
        tasks: [1, 3],
        lanes: ['interface', 'orchestration'],
        mentions: ['invoice', 'pdf'],
        ordered: true,
      },
    );
    expect(checks.every((check) => check.pass)).toBe(true);
  });

  it('names what a weak plan got wrong', () => {
    const checks = gradePlan(
      {
        tasks: [
          laneTask('interface', {
            title: 'Define the it experience',
            objective: 'Specify it.',
            dependsOn: [1],
          }),
          laneTask('interface', {
            title: 'Second',
            objective: 'More.',
            dependsOn: [],
          }),
        ],
        whyThisMany: 'Two.',
      },
      { tasks: [1, 1], lanes: ['orchestration'], mentions: ['session|login'] },
    );
    const failed = checks.filter((check) => !check.pass).map((c) => c.name);
    expect(failed).toEqual([
      'size',
      'lane:orchestration',
      'mentions:session|login',
      'dependencies',
      'specific titles',
    ]);
  });
});

describe('the planner eval', () => {
  it('keeps the built-in planner at or above its recorded score', async () => {
    const cases = loadCases(CASES);
    expect(cases.length).toBeGreaterThanOrEqual(10);
    const results = await Promise.all(cases.map((item) => runCase(item)));
    expect(average(results)).toBeGreaterThanOrEqual(BUILT_IN_FLOOR);
  });

  it('grades a model run, and a model that fails on its fallback', async () => {
    const [first] = loadCases(CASES);
    const good: ModelPlanner = {
      label: 'fake',
      complete: async () => ({
        text: JSON.stringify({
          tasks: [
            {
              title: 'Fix "recieve" in the README',
              objective: 'Correct the spelling in README.md.',
              lane: 'interface',
            },
          ],
          whyThisMany: 'One word in one file.',
        }),
        usage: { inputTokens: 500, outputTokens: 60 },
      }),
    };
    const ran = await runCase(first!, good);
    expect(ran).toMatchObject({ source: 'model', score: 1 });
    const broken: ModelPlanner = {
      label: 'fake',
      complete: async () => ({ text: 'no' }),
    };
    const fell = await runCase(first!, broken);
    expect(fell.source).toBe('built-in');
    expect(fell.fallback).toBe('fake: the answer was not JSON');
  });
});
