import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CommandIdSchema,
  CreateProjectCommandSchema,
  type Brief,
  type ProjectId,
} from '@harness/contracts';
import { SqliteProjectStore, openHarnessDatabase } from '@harness/persistence';
import {
  draftPlan,
  parseModelPlan,
  plannerPrompt,
  type ModelPlanner,
} from './model-planner.js';
import { ProjectService } from './projects.js';

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

let counter = 7000;
function commandId() {
  counter += 1;
  return CommandIdSchema.parse(
    `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
  );
}

const EMPTY_BRIEF = {
  version: 1,
  fields: Object.fromEntries(
    ['goal', 'scope', 'constraints', 'doneMeans', 'checks', 'audience'].map(
      (id) => [id, { state: 'missing' }],
    ),
  ),
  requests: [],
  lastSequence: 1,
} as unknown as Brief;

const TWO_TASKS = JSON.stringify({
  tasks: [
    {
      title: 'Invoice download page.',
      objective: 'A page listing invoices with a download button each.',
      lane: 'interface',
      dependsOn: [1, 0],
    },
    {
      title: 'Invoice PDF endpoint',
      objective: 'Serve each invoice as a PDF to its owner only.',
      lane: 'orchestration',
      dependsOn: [0, 0, 5],
      checks: ['unit tests'],
    },
  ],
  whyThisMany: 'The page and the endpoint can be reviewed apart.',
});

const fake = (answer: string | Error, label = 'test-model'): ModelPlanner => ({
  label,
  complete: async () => {
    if (answer instanceof Error) throw answer;
    return { text: answer, usage: { inputTokens: 900, outputTokens: 120 } };
  },
});

describe('parseModelPlan', () => {
  it('turns a model answer into lane tasks, dropping impossible dependencies', () => {
    const result = parseModelPlan(
      `Here is the plan:\n\`\`\`json\n${TWO_TASKS}\n\`\`\`\nHope that helps.`,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [page, endpoint] = result.shape.tasks;
    expect(page).toMatchObject({
      title: 'Invoice download page',
      agentName: 'Interface systems',
      category: 'interface',
      dependsOn: [],
      requiredChecks: ['contract-check'],
    });
    expect(endpoint).toMatchObject({
      agentName: 'Backend orchestration',
      category: 'orchestration',
      dependsOn: [0],
      requiredChecks: ['experience-check', 'unit tests'],
    });
    expect(result.shape.whyThisMany).toMatch(/reviewed apart/);
  });

  it('says why an answer cannot be a plan', () => {
    expect(parseModelPlan('Sure! I would split this in two.')).toEqual({
      ok: false,
      reason: 'the answer was not JSON',
    });
    expect(parseModelPlan('{"tasks": [], "whyThisMany": "none"}')).toEqual({
      ok: false,
      reason: 'the answer did not have the plan shape',
    });
    const six = {
      tasks: Array.from({ length: 6 }, (_, at) => ({
        title: `Task ${at}`,
        objective: 'Do it.',
        lane: 'interface',
      })),
      whyThisMany: 'Many.',
    };
    expect(parseModelPlan(JSON.stringify(six)).ok).toBe(false);
  });
});

describe('plannerPrompt', () => {
  it('gives the model the request, the Overview and the Plan document', () => {
    const brief = {
      ...EMPTY_BRIEF,
      fields: {
        ...EMPTY_BRIEF.fields,
        goal: { state: 'confirmed', value: 'Customers get their invoices' },
      },
    } as unknown as Brief;
    const { system, user } = plannerPrompt({
      request: 'Add invoice downloads',
      projectName: 'Billing',
      brief,
      planDocument: { features: ['Download as PDF'], data: [] },
    });
    expect(system).toMatch(/only a JSON object/);
    expect(user).toContain('Goal: Customers get their invoices');
    expect(user).toContain('- Download as PDF');
    expect(user).toContain('Request: Add invoice downloads');
    expect(user).not.toContain('data:');
  });
});

describe('draftPlan', () => {
  it('returns the plan and what it used', async () => {
    const draft = await draftPlan(fake(TWO_TASKS), {
      request: 'Add invoice downloads',
      projectName: 'Billing',
      brief: EMPTY_BRIEF,
      planDocument: {},
    });
    expect(draft.ok && draft.shape.tasks.length).toBe(2);
    expect(draft.ok && draft.usage).toEqual({
      inputTokens: 900,
      outputTokens: 120,
    });
  });

  it('reports a model that fails or never answers', async () => {
    const input = {
      request: 'x',
      projectName: 'p',
      brief: EMPTY_BRIEF,
      planDocument: {},
    };
    expect(await draftPlan(fake(new Error('401 Unauthorized')), input)).toEqual(
      {
        ok: false,
        reason: 'test-model could not be reached (401 Unauthorized)',
      },
    );
    const silent: ModelPlanner = {
      label: 'slow-model',
      complete: (_system, _user, signal) =>
        new Promise((_, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason)),
        ),
    };
    expect(await draftPlan(silent, input, 20)).toEqual({
      ok: false,
      reason: 'slow-model did not answer within 0s',
    });
  });
});

describe('the Planner on a live account', () => {
  function setup(planner: ModelPlanner) {
    const root = mkdtempSync(join(tmpdir(), 'visual-agent-planner-'));
    temporaryDirectories.push(root);
    const database = openHarnessDatabase(join(root, 'test.db'));
    const service = new ProjectService(
      new SqliteProjectStore(database.database),
      { folders: { root }, runtime: { mode: 'live' }, planner },
    );
    const created = service.createProject(
      CreateProjectCommandSchema.parse({
        commandId: commandId(),
        name: 'Billing',
      }),
    );
    return { service, projectId: created.project.projection.projectId };
  }

  async function ask(
    service: ProjectService,
    projectId: ProjectId,
    body: string,
  ) {
    const planner = Object.values(
      service.getProject(projectId).projection.threads,
    ).find((thread) => thread.kind === 'coordinator')!;
    service.postMessage(projectId, 'coordinator', {
      commandId: commandId(),
      expectedSequence: planner.lastSequence,
      body,
      intent: 'chat',
    });
    await service.whenIdle(projectId);
    const project = service.getProject(projectId).projection;
    const plans = Object.values(project.plans).sort(
      (a, b) => b.version - a.version,
    );
    const page = service.listMessages(projectId, 'coordinator', { limit: 50 });
    return { plan: plans[0], last: page.messages.at(-1)!.body };
  }

  it('records the model plan and says who drafted it', async () => {
    const { service, projectId } = setup(fake(TWO_TASKS, 'gpt-test'));
    const { plan, last } = await ask(
      service,
      projectId,
      'Build an invoice download page',
    );
    expect(plan?.tasks.map((task) => task.title)).toEqual([
      'Invoice download page',
      'Invoice PDF endpoint',
    ]);
    expect(last).toMatch(/^Plan v1 is ready: 2 tasks\./);
    expect(last).toMatch(/Drafted by gpt-test\.$/);
  });

  it('falls back to the built-in plan and says why', async () => {
    const { service, projectId } = setup(fake('I cannot help with that.'));
    const { plan, last } = await ask(
      service,
      projectId,
      'Build an invoice download page',
    );
    expect(plan?.tasks.length).toBeGreaterThan(0);
    expect(last).toMatch(
      /Drafted by the built-in planner: test-model: the answer was not JSON\.$/,
    );
  });

  it('revises the open plan with the model', async () => {
    const one = JSON.stringify({
      tasks: [
        {
          title: 'Invoice downloads, page and endpoint',
          objective: 'Both in one.',
          lane: 'interface',
        },
      ],
      whyThisMany: 'Small enough for one owner.',
    });
    let answer = TWO_TASKS;
    const planner: ModelPlanner = {
      label: 'gpt-test',
      complete: async () => ({ text: answer }),
    };
    const { service, projectId } = setup(planner);
    await ask(service, projectId, 'Build an invoice download page');
    answer = one;
    const { plan, last } = await ask(
      service,
      projectId,
      'combine into one agent',
    );
    expect(plan?.version).toBe(2);
    expect(plan?.tasks.map((task) => task.title)).toEqual([
      'Invoice downloads, page and endpoint',
    ]);
    expect(last).toMatch(
      /Plan v2 replaces v1: 1 task\..*Drafted by gpt-test\./,
    );
  });

  it('leaves conversation that is not planning to the built-in replies', async () => {
    let calls = 0;
    const planner: ModelPlanner = {
      label: 'gpt-test',
      complete: async () => {
        calls += 1;
        return { text: TWO_TASKS };
      },
    };
    const { service, projectId } = setup(planner);
    await ask(service, projectId, 'hi');
    expect(calls).toBe(0);
  });
});
