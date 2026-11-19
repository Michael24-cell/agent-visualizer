import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { Brief } from '@harness/contracts';
import { planFromRequest, type PlanShape } from '@harness/runtime-simulated';
import {
  draftPlan,
  type ModelPlanner,
  type TextAnswer,
} from './model-planner.js';

// Grades plans against evals/planner/cases.json: requests a person might
// type, each with what a good plan must do. The same grade applies to the
// built-in planner and to any connected model, so a change to either can
// be shown to help or hurt instead of guessed at.

const ExpectSchema = z.strictObject({
  tasks: z.tuple([z.number().int().min(1), z.number().int().min(1)]),
  lanes: z.array(z.enum(['interface', 'orchestration'])).optional(),
  // Each entry is one idea; "a|b" accepts either word.
  mentions: z.array(z.string().min(1)).optional(),
  // At least one task waits on another.
  ordered: z.boolean().optional(),
});

const CaseSchema = z.strictObject({
  id: z.string().min(1),
  request: z.string().min(1),
  overview: z.record(z.string(), z.string()).optional(),
  planDocument: z.record(z.string(), z.array(z.string())).optional(),
  expect: ExpectSchema,
});

export const CasesFileSchema = z.strictObject({
  about: z.string(),
  cases: z.array(CaseSchema).min(1),
});

export type PlannerCase = z.infer<typeof CaseSchema>;

export interface Check {
  readonly name: string;
  readonly pass: boolean;
  readonly detail: string;
}

export interface CaseResult {
  readonly id: string;
  readonly score: number;
  readonly checks: readonly Check[];
  readonly source: 'built-in' | 'model';
  // Why a model run fell back, when it did.
  readonly fallback?: string | undefined;
  readonly usage?: TextAnswer['usage'];
  readonly titles: readonly string[];
}

export function loadCases(path: string): PlannerCase[] {
  return CasesFileSchema.parse(JSON.parse(readFileSync(path, 'utf8'))).cases;
}

// The built-in planner's fill-in-the-blank titles: a plan that uses them
// has not said anything specific about the request.
const TEMPLATE_TITLE =
  /^(Define the .+ experience|Implement and verify the .+ service handoff|Build .+ end to end)$/;

export function gradePlan(
  shape: PlanShape,
  expect: PlannerCase['expect'],
): Check[] {
  const checks: Check[] = [];
  const [min, max] = expect.tasks;
  const count = shape.tasks.length;
  checks.push({
    name: 'size',
    pass: count >= min && count <= max,
    detail: `${count} ${count === 1 ? 'task' : 'tasks'}, wanted ${min === max ? min : `${min}–${max}`}`,
  });
  const lanes = new Set(
    shape.tasks.map((task) =>
      task.category === 'orchestration' ? 'orchestration' : 'interface',
    ),
  );
  for (const lane of expect.lanes ?? []) {
    checks.push({
      name: `lane:${lane}`,
      pass: lanes.has(lane),
      detail: lanes.has(lane) ? `has ${lane} work` : `no ${lane} task`,
    });
  }
  const text = shape.tasks
    .map((task) => `${task.title}\n${task.objective}`)
    .join('\n')
    .toLowerCase();
  for (const mention of expect.mentions ?? []) {
    const words = mention.toLowerCase().split('|');
    const hit = words.some((word) => text.includes(word));
    checks.push({
      name: `mentions:${mention}`,
      pass: hit,
      detail: hit ? 'named' : `never says ${words.join(' or ')}`,
    });
  }
  const backwards = shape.tasks.every((task, index) =>
    task.dependsOn.every((other) => other < index),
  );
  checks.push({
    name: 'dependencies',
    pass: backwards,
    detail: backwards
      ? 'all point to earlier tasks'
      : 'a task waits on a later one',
  });
  if (expect.ordered) {
    const ordered = shape.tasks.some((task) => task.dependsOn.length > 0);
    checks.push({
      name: 'ordered',
      pass: ordered,
      detail: ordered
        ? 'later work waits on earlier work'
        : 'nothing waits on anything',
    });
  }
  const generic = shape.tasks.filter(
    (task) => TEMPLATE_TITLE.test(task.title) || task.title.length > 90,
  );
  checks.push({
    name: 'specific titles',
    pass: generic.length === 0,
    detail: generic.length
      ? `generic or long: ${generic.map((task) => `"${task.title}"`).join(', ')}`
      : 'every title is specific',
  });
  return checks;
}

const score = (checks: readonly Check[]) =>
  checks.filter((check) => check.pass).length / checks.length;

export function briefFor(overview: Record<string, string> = {}): Brief {
  const ids = [
    'goal',
    'scope',
    'constraints',
    'doneMeans',
    'checks',
    'audience',
  ];
  return {
    version: 1,
    fields: Object.fromEntries(
      ids.map((id) => [
        id,
        overview[id]
          ? { state: 'confirmed', value: overview[id] }
          : { state: 'missing' },
      ]),
    ),
    requests: [],
    lastSequence: 1,
  } as unknown as Brief;
}

// One case on the built-in planner, or on a model when one is given. A
// model that fails is graded on the built-in plan it fell back to, as the
// product would show it, and the reason is kept.
export async function runCase(
  plannerCase: PlannerCase,
  planner?: ModelPlanner,
): Promise<CaseResult> {
  const features = plannerCase.planDocument?.features ?? [];
  const builtIn = () => planFromRequest(plannerCase.request, { features });
  let shape: PlanShape;
  let source: CaseResult['source'] = 'built-in';
  let fallback: string | undefined;
  let usage: TextAnswer['usage'];
  if (planner) {
    const draft = await draftPlan(planner, {
      request: plannerCase.request,
      projectName: plannerCase.id,
      brief: briefFor(plannerCase.overview),
      planDocument: plannerCase.planDocument ?? {},
    });
    if (draft.ok) {
      shape = draft.shape;
      source = 'model';
      usage = draft.usage;
    } else {
      shape = builtIn();
      fallback = draft.reason;
    }
  } else {
    shape = builtIn();
  }
  const checks = gradePlan(shape, plannerCase.expect);
  return {
    id: plannerCase.id,
    score: score(checks),
    checks,
    source,
    ...(fallback ? { fallback } : {}),
    ...(usage ? { usage } : {}),
    titles: shape.tasks.map((task) => task.title),
  };
}

export function average(results: readonly CaseResult[]): number {
  return (
    results.reduce((sum, result) => sum + result.score, 0) / results.length
  );
}
