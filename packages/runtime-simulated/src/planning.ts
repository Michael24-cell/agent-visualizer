import type {
  Agent,
  AgentTask,
  Check,
  PlanTask,
  ProjectProjection,
} from '@harness/contracts';

// Deterministic planning and per-agent step scripts for Increment 2.6.
// Pure functions: they read the projection and return intents; the service
// materializes events inside its transaction.

// ---------------------------------------------------------------------------
// Coordinator classification
// ---------------------------------------------------------------------------

export type CoordinatorMessageKind =
  'request_work' | 'direct_work' | 'edit_plan' | 'record_request' | 'note';

// Keyword rules. Order matters: an explicit "just do it" beats everything,
// then scope/permission language, then plan edits (only while a plan
// proposal is open), then work requests. Anything else is a note.
export const DIRECT_PHRASES = [
  'just do it',
  'go ahead',
  'no need to confirm',
  "don't ask",
  'do not ask',
  'skip the plan',
] as const;

export const REQUEST_KEYWORDS: Record<
  'scope' | 'permission' | 'dependency',
  readonly string[]
> = {
  scope: [
    'only touch',
    "don't touch",
    'do not touch',
    'stay out of',
    'only in',
  ],
  permission: ['permission', 'allow', 'read-only', 'read only', 'no writes'],
  dependency: ['depends on', 'after the', 'blocked by', 'wait for'],
};

export const EDIT_KEYWORDS = [
  'combine',
  'merge',
  'one agent',
  'single agent',
  'split',
  'two agents',
  'separate',
  'add a check',
  'add checks',
  'assign',
  'reorder',
  'swap',
  'remove',
  'drop',
] as const;

export const WORK_VERBS = [
  'build',
  'implement',
  'add',
  'create',
  'ship',
  'make',
  'write',
  'fix',
  'refactor',
  'design',
  'set up',
  'setup',
] as const;

function has(body: string, phrases: readonly string[]): string | undefined {
  const lower = body.toLowerCase();
  return phrases.find((phrase) => lower.includes(phrase));
}

export function classifyCoordinatorMessage(
  body: string,
  openPlanProposal: boolean,
): {
  kind: CoordinatorMessageKind;
  keywordsMatched: string[];
  requestCategory?: 'scope' | 'permission' | 'dependency';
} {
  const direct = has(body, DIRECT_PHRASES);
  for (const [category, phrases] of Object.entries(REQUEST_KEYWORDS) as Array<
    ['scope' | 'permission' | 'dependency', readonly string[]]
  >) {
    const hit = has(body, phrases);
    if (hit) {
      return {
        kind: 'record_request',
        keywordsMatched: [hit],
        requestCategory: category,
      };
    }
  }
  if (openPlanProposal) {
    const edit = has(body, EDIT_KEYWORDS);
    if (edit) return { kind: 'edit_plan', keywordsMatched: [edit] };
  }
  const work = has(body, WORK_VERBS);
  if (work && direct) {
    return { kind: 'direct_work', keywordsMatched: [work, direct] };
  }
  if (work) return { kind: 'request_work', keywordsMatched: [work] };
  if (direct && openPlanProposal) {
    return { kind: 'direct_work', keywordsMatched: [direct] };
  }
  return { kind: 'note', keywordsMatched: [] };
}

// ---------------------------------------------------------------------------
// Plan derivation
// ---------------------------------------------------------------------------

export const INTERFACE_AGENT = {
  name: 'Interface systems',
  category: 'interface',
} as const;
export const BACKEND_AGENT = {
  name: 'Backend orchestration',
  category: 'orchestration',
} as const;

// The subject of a request: the text after the first work verb, trimmed.
export function subjectOf(body: string): string {
  const lower = body.toLowerCase();
  const verb = WORK_VERBS.map((v) => ({ v, at: lower.indexOf(v) }))
    .filter((hit) => hit.at >= 0)
    .sort((a, b) => a.at - b.at)[0];
  const raw = verb ? body.slice(verb.at + verb.v.length) : body;
  const cleaned = raw
    .replace(/^\s*(the|a|an|me|us)\s+/i, '')
    .replace(/[.!?]+$/, '')
    .trim();
  return (cleaned || body.trim()).slice(0, 60);
}

export interface PlanShape {
  readonly tasks: PlanTask[];
  readonly whyThisMany: string;
}

// Two boundaries by default: the visible contract, then the service that
// consumes it. Rationale is data so the plan view can explain itself.
export function planFromRequest(
  body: string,
  options: { readonly single?: boolean; readonly extraChecks?: boolean } = {},
): PlanShape {
  const subject = subjectOf(body);
  const interfaceTask: PlanTask = {
    title: `Define the ${subject} experience`,
    objective: `Specify the states, accessible behavior, and request contract for ${subject}.`,
    agentName: INTERFACE_AGENT.name,
    category: INTERFACE_AGENT.category,
    whySeparate:
      'The interaction contract must be reviewable before the service consumes it.',
    whyThisAgent: 'Owns the visible contract and accessible interaction.',
    skills: ['Accessible interface craft', 'Contract-first UI'],
    scope: ['apps/client/src/**', 'packages/contracts/src/**'],
    dependsOn: [],
    expectedOutputs: ['Interface contract'],
    requiredChecks: ['contract-check'],
    modelTier: 'standard',
  };
  const backendTask: PlanTask = {
    title: `Implement and verify the ${subject} service handoff`,
    objective: `Consume the approved contract through the authenticated local service for ${subject}.`,
    agentName: BACKEND_AGENT.name,
    category: BACKEND_AGENT.category,
    whySeparate:
      'Service permissions and check evidence need an independent boundary.',
    whyThisAgent: 'Owns the authenticated handoff and durable events.',
    skills: ['Service contract discipline', 'SQLite event replay'],
    scope: ['apps/service/src/**', 'packages/persistence/src/**'],
    dependsOn: [0],
    expectedOutputs: ['Authenticated endpoint', 'Diff summary'],
    requiredChecks: ['experience-check'],
    modelTier: 'deep',
  };
  if (options.extraChecks) {
    interfaceTask.requiredChecks = [
      ...interfaceTask.requiredChecks,
      'experience-check',
    ];
  }
  if (options.single) {
    return {
      tasks: [
        {
          ...interfaceTask,
          title: `Build ${subject} end to end`,
          objective: `Deliver ${subject} from contract to verified service in one owner.`,
          whySeparate:
            'One owner keeps the handoff inside a single conversation.',
          scope: [...interfaceTask.scope, ...backendTask.scope],
          expectedOutputs: [
            ...interfaceTask.expectedOutputs,
            ...backendTask.expectedOutputs,
          ],
          requiredChecks: ['contract-check', 'experience-check'],
          modelTier: 'deep',
        },
      ],
      whyThisMany:
        'One agent, as requested: fewer handoffs, one conversation to follow.',
    };
  }
  return {
    tasks: [interfaceTask, backendTask],
    whyThisMany:
      'Two sequential owners make the contract handoff inspectable; they do not run in parallel, so ownership stays unambiguous.',
  };
}

// Revise an existing plan from an edit request. Documented rules:
//   combine / merge / one agent / single agent → one task
//   split / two agents / separate            → two tasks
//   add a check / add checks                 → experience-check on every task
//   assign <task words> to <agent name>       → change that task's agent
export function revisePlan(
  current: PlanShape,
  body: string,
  originalRequest: string,
  agents: readonly Agent[],
): PlanShape {
  const lower = body.toLowerCase();
  if (has(lower, ['combine', 'merge', 'one agent', 'single agent'])) {
    return planFromRequest(originalRequest, { single: true });
  }
  if (has(lower, ['split', 'two agents', 'separate'])) {
    return planFromRequest(originalRequest);
  }
  if (has(lower, ['add a check', 'add checks'])) {
    return {
      tasks: current.tasks.map((task) => ({
        ...task,
        requiredChecks: task.requiredChecks.includes('experience-check')
          ? task.requiredChecks
          : [...task.requiredChecks, 'experience-check'],
      })),
      whyThisMany: current.whyThisMany,
    };
  }
  const assign = /assign\s+(.+?)\s+to\s+(.+)$/i.exec(body.trim());
  if (assign) {
    const [, taskWords, agentWords] = assign;
    const agent = agents.find((candidate) =>
      candidate.name
        .toLowerCase()
        .includes((agentWords ?? '').toLowerCase().replace(/[.!?]+$/, '')),
    );
    const index = current.tasks.findIndex((task) =>
      task.title.toLowerCase().includes((taskWords ?? '').toLowerCase()),
    );
    if (agent && index >= 0) {
      const alreadyOwnsAnotherRow = current.tasks.some(
        (task, at) => at !== index && task.agentName === agent.name,
      );
      if (alreadyOwnsAnotherRow) return current;
      return {
        tasks: current.tasks.map((task, at) =>
          at === index
            ? {
                ...task,
                agentName: agent.name,
                category: agent.category,
                whyThisAgent: 'Assigned by you.',
              }
            : task,
        ),
        whyThisMany: current.whyThisMany,
      };
    }
  }
  return current;
}

// ---------------------------------------------------------------------------
// Per-agent step scripts
// ---------------------------------------------------------------------------

export type AgentStepIntent =
  | { kind: 'say'; body: string }
  | {
      kind: 'output';
      outputKind: 'contract' | 'diff' | 'note' | 'report';
      title: string;
      digest: string;
    }
  | {
      kind: 'check_pass';
      name: string;
      command: string;
      summary: string;
      retryOf?: string;
    }
  | { kind: 'check_fail'; name: string; command: string; summary: string }
  | {
      kind: 'ask';
      action: string;
      reason: string;
      scope: string;
      consequences: string;
    }
  | { kind: 'finish'; reason: string };

export type AgentStepResult =
  | { ok: true; label: string; intents: readonly AgentStepIntent[] }
  | { ok: false; reason: string };

function checksFor(projection: ProjectProjection, task: AgentTask): Check[] {
  return Object.values(projection.checks)
    .filter((check) => check.taskId === task.id)
    .sort((a, b) => a.startedAtSequence - b.startedAtSequence);
}

// What this agent does next, derived from the task's own evidence so the
// script is replay-safe. Interface tasks: contract → check → done.
// Orchestration tasks: ask → failed check → repaired check → done.
// Anything else: note → check → done.
export function nextAgentStep(
  projection: ProjectProjection,
  agent: Agent,
): AgentStepResult {
  const task = agent.currentTaskId
    ? projection.tasks[agent.currentTaskId]
    : undefined;
  if (!task)
    return { ok: false, reason: `${agent.name} has no task in progress.` };
  if (task.state === 'waiting') {
    return {
      ok: false,
      reason: `"${task.title}" is waiting on an upstream output.`,
    };
  }
  if (task.state === 'needs_you') {
    return {
      ok: false,
      reason: `"${task.title}" is waiting on your decision.`,
    };
  }
  if (task.state !== 'working') {
    return { ok: false, reason: `"${task.title}" is ${task.state}.` };
  }
  const outputs = Object.values(projection.outputs).filter(
    (o) => o.taskId === task.id,
  );
  const checks = checksFor(projection, task);
  const asks = Object.values(projection.asks).filter(
    (a) => a.taskId === task.id,
  );
  const required = task.requiredChecks;
  const passed = (name: string) =>
    checks.filter((c) => c.name === name).at(-1)?.state === 'passed';
  const missingChecks = required.filter((name) => !passed(name));

  if (task.category === 'orchestration') {
    if (asks.length === 0) {
      return {
        ok: true,
        label: 'Ask before writing',
        intents: [
          {
            kind: 'ask',
            action: 'Write the simulated service fixture',
            reason:
              'This task needs one bounded write to its declared fixture scope.',
            scope: task.scope[0] ?? 'apps/service/src/fixtures/**',
            consequences:
              'Creates one simulated endpoint fixture; no real files change.',
          },
        ],
      };
    }
    if (outputs.length === 0 && checks.length === 0) {
      const name = required[0] ?? 'experience-check';
      return {
        ok: true,
        label: 'Run the first check',
        intents: [
          { kind: 'say', body: `Implemented the handoff. Running ${name}.` },
          {
            kind: 'check_fail',
            name,
            command: `npm test -- ${name}`,
            summary:
              'Mobile error summary did not receive focus after submission.',
          },
          {
            kind: 'say',
            body: `${name} failed: mobile error summary did not receive focus. Applying a bounded fix.`,
          },
        ],
      };
    }
    if (missingChecks.length) {
      const name = missingChecks[0]!;
      const previous = checks.filter((c) => c.name === name).at(-1);
      return {
        ok: true,
        label: 'Repair and re-check',
        intents: [
          {
            kind: 'check_pass',
            name,
            command: `npm test -- ${name}`,
            summary:
              'Keyboard, mobile focus, and authenticated request checks passed.',
            ...(previous ? { retryOf: previous.id } : {}),
          },
          {
            kind: 'output',
            outputKind: 'diff',
            title: 'Diff summary',
            digest: `sha256:${task.id}-diff`,
          },
          {
            kind: 'say',
            body: `${name} passed after the fix. Diff summary is ready.`,
          },
        ],
      };
    }
    return {
      ok: true,
      label: 'Finish',
      intents: [
        {
          kind: 'finish',
          reason: 'Service handoff verified with passing evidence.',
        },
        {
          kind: 'say',
          body: 'Done. The service handoff has passing evidence and a diff summary.',
        },
      ],
    };
  }

  // Interface and generic scripts.
  if (outputs.length === 0) {
    const isInterface = task.category === 'interface';
    return {
      ok: true,
      label: isInterface ? 'Define the contract' : 'Draft the work',
      intents: [
        {
          kind: 'output',
          outputKind: isInterface ? 'contract' : 'note',
          title: isInterface ? 'Interface contract' : 'Working notes',
          digest: `sha256:${task.id}-${isInterface ? 'contract' : 'note'}`,
        },
        {
          kind: 'say',
          body: isInterface
            ? 'Defined the form states, keyboard flow, and request contract.'
            : 'Drafted the first pass and wrote up what changed.',
        },
      ],
    };
  }
  if (missingChecks.length || (required.length === 0 && checks.length === 0)) {
    const name = missingChecks[0] ?? 'contract-check';
    return {
      ok: true,
      label: `Run ${name}`,
      intents: [
        {
          kind: 'check_pass',
          name,
          command: `npm test -- ${name}`,
          summary: 'Shared request contract and keyboard states agree.',
        },
        { kind: 'say', body: `${name} passed.` },
      ],
    };
  }
  return {
    ok: true,
    label: 'Finish',
    intents: [
      { kind: 'finish', reason: 'Work finished with passing evidence.' },
      {
        kind: 'say',
        body: 'Done. Output and evidence are ready for whoever depends on this.',
      },
    ],
  };
}
