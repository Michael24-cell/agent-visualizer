import { z } from 'zod';
import type { Brief, PlanTask } from '@harness/contracts';
import { laneTask, type PlanShape } from '@harness/runtime-simulated';

// The Planner on a live account: the connected model drafts and revises
// plans instead of the keyword rules. It answers in a small, fixed JSON
// shape; the harness checks it and fills in owners, skills and checks per
// lane, so a model plan and a built-in plan look and behave the same.
// Anything the model gets wrong — no answer, bad JSON, impossible
// dependencies — falls back to the built-in plan with the reason said.

export interface TextAnswer {
  readonly text: string;
  readonly usage?:
    { readonly inputTokens: number; readonly outputTokens: number } | undefined;
}

export interface ModelPlanner {
  // Shown to the user: "Drafted by gpt-6.1-sol."
  readonly label: string;
  readonly complete: (
    system: string,
    user: string,
    signal: AbortSignal,
  ) => Promise<TextAnswer>;
}

export interface PlanDraftInput {
  readonly request: string;
  readonly projectName: string;
  readonly brief: Brief;
  // The Plan document, section id → lines.
  readonly planDocument: Readonly<Record<string, readonly string[]>>;
  // Present when revising: the plan as it stands and what to change.
  readonly current?: PlanShape | undefined;
  readonly instruction?: string | undefined;
}

export type PlanDraft =
  | {
      readonly ok: true;
      readonly shape: PlanShape;
      readonly usage?: TextAnswer['usage'];
    }
  | { readonly ok: false; readonly reason: string };

export const MAX_MODEL_TASKS = 5;

// What the model must return. Kept small: words and structure only.
export const ModelPlanSchema = z.object({
  tasks: z
    .array(
      z.object({
        title: z.string().trim().min(1),
        objective: z.string().trim().min(1),
        lane: z.enum(['interface', 'orchestration']),
        dependsOn: z.array(z.number().int().nonnegative()).default([]),
        checks: z.array(z.string().trim().min(1)).optional(),
      }),
    )
    .min(1)
    .max(MAX_MODEL_TASKS),
  whyThisMany: z.string().trim().min(1),
});

const SYSTEM = `You are the Planner in a coding workspace. You turn a person's request into the smallest set of tasks that agents can do and a person can review.

Rules:
- Use as few tasks as the work honestly needs. One task is right for most small requests. Split only where a piece can be reviewed on its own or can run in parallel.
- At most ${MAX_MODEL_TASKS} tasks.
- Each task has a lane: "interface" for what a person sees and uses (screens, pages, copy, interaction, accessibility); "orchestration" for what is behind it (data, services, APIs, storage, permissions, jobs).
- Titles say what will exist when the task is done, in the person's own words where possible, under 90 characters, sentence case, no trailing period.
- Objectives say what to build and how to know it is done, in 1–4 sentences.
- dependsOn lists the indexes (0-based) of earlier tasks that must finish first. Never depend on a later task or on itself.
- checks (optional) names extra checks beyond the defaults, such as "unit tests" or "accessibility check".
- whyThisMany explains the number of tasks in one sentence.

Answer with only a JSON object, no prose and no code fence:
{"tasks":[{"title":"…","objective":"…","lane":"interface","dependsOn":[],"checks":[]}],"whyThisMany":"…"}`;

function briefLines(brief: Brief): string[] {
  const labels: Record<string, string> = {
    goal: 'Goal',
    scope: 'Scope',
    constraints: 'Constraints',
    doneMeans: 'Done means',
    checks: 'Checks',
    audience: 'Audience',
  };
  const lines: string[] = [];
  for (const [id, field] of Object.entries(brief.fields)) {
    const value = (field as { value?: unknown }).value;
    if (typeof value === 'string' && value.trim()) {
      lines.push(`${labels[id] ?? id}: ${value.trim()}`);
    }
  }
  for (const request of brief.requests ?? []) {
    const text = (request as { text?: unknown }).text;
    if (typeof text === 'string') lines.push(`Request: ${text}`);
  }
  return lines;
}

export function plannerPrompt(input: PlanDraftInput): {
  system: string;
  user: string;
} {
  const parts: string[] = [`Project: ${input.projectName}`];
  const brief = briefLines(input.brief);
  if (brief.length) parts.push(`Overview:\n${brief.join('\n')}`);
  const doc = Object.entries(input.planDocument)
    .filter(([, lines]) => lines.length)
    .map(([section, lines]) =>
      [`${section}:`, ...lines.map((line) => `- ${line}`)].join('\n'),
    );
  if (doc.length) parts.push(`Plan document:\n${doc.join('\n')}`);
  if (input.current && input.instruction) {
    parts.push(
      `Current plan:\n${JSON.stringify(
        {
          tasks: input.current.tasks.map((task) => ({
            title: task.title,
            objective: task.objective,
            lane:
              task.category === 'orchestration' ? 'orchestration' : 'interface',
            dependsOn: task.dependsOn,
          })),
          whyThisMany: input.current.whyThisMany,
        },
        null,
        2,
      )}`,
      `The original request: ${input.request}`,
      `Change the plan as follows, keeping everything else: ${input.instruction}`,
    );
  } else {
    parts.push(`Request: ${input.request}`);
  }
  return { system: SYSTEM, user: parts.join('\n\n') };
}

// The JSON object in a reply, with or without a code fence or chatter.
function jsonIn(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = fenced ? fenced[1]! : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON object');
  return JSON.parse(body.slice(start, end + 1));
}

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

// A checked model answer as a plan, or why it cannot be one.
export function parseModelPlan(
  text: string,
): { ok: true; shape: PlanShape } | { ok: false; reason: string } {
  let raw: unknown;
  try {
    raw = jsonIn(text);
  } catch {
    return { ok: false, reason: 'the answer was not JSON' };
  }
  const parsed = ModelPlanSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, reason: 'the answer did not have the plan shape' };
  }
  const tasks: PlanTask[] = parsed.data.tasks.map((task, index) => {
    const dependsOn = [...new Set(task.dependsOn)].filter(
      (other) => other < index,
    );
    return laneTask(task.lane, {
      title: clip(task.title.replace(/\.$/, ''), 200),
      objective: clip(task.objective, 2_000),
      dependsOn,
      checks: task.checks,
    });
  });
  return {
    ok: true,
    shape: { tasks, whyThisMany: clip(parsed.data.whyThisMany, 400) },
  };
}

export async function draftPlan(
  planner: ModelPlanner,
  input: PlanDraftInput,
  timeoutMs = 90_000,
): Promise<PlanDraft> {
  const { system, user } = plannerPrompt(input);
  let answer: TextAnswer;
  try {
    answer = await planner.complete(
      system,
      user,
      AbortSignal.timeout(timeoutMs),
    );
  } catch (error) {
    const timedOut =
      error instanceof Error &&
      (error.name === 'TimeoutError' || error.name === 'AbortError');
    return {
      ok: false,
      reason: timedOut
        ? `${planner.label} did not answer within ${Math.round(timeoutMs / 1000)}s`
        : `${planner.label} could not be reached (${error instanceof Error ? clip(error.message, 160) : 'unknown error'})`,
    };
  }
  const result = parseModelPlan(answer.text);
  if (!result.ok)
    return { ok: false, reason: `${planner.label}: ${result.reason}` };
  return { ok: true, shape: result.shape, usage: answer.usage };
}
