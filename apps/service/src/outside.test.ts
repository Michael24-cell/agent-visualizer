import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CommandIdSchema,
  CreateProjectCommandSchema,
  ReportTaskCommandSchema,
  type ProjectId,
} from '@harness/contracts';
import { SqliteProjectStore, openHarnessDatabase } from '@harness/persistence';
import type { ModelPlanner } from './model-planner.js';
import { compareWithGit } from './outside.js';
import { ProjectService } from './projects.js';

// Agent tools outside the harness (through the MCP server) take tasks
// from a plan and report back; git is the check on what they say.

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

let counter = 9100;
function commandId() {
  counter += 1;
  return CommandIdSchema.parse(
    `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
  );
}

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@example.invalid',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@example.invalid',
    },
  }).toString();

// A Planner that answers with two tasks, the second waiting on the first.
const TWO_STEP: ModelPlanner = {
  label: 'test-model',
  complete: async () => ({
    text: JSON.stringify({
      tasks: [
        {
          title: 'Invoice PDF endpoint',
          objective: 'Serve each invoice as a PDF.',
          lane: 'orchestration',
        },
        {
          title: 'Invoice download page',
          objective: 'List invoices with a download button.',
          lane: 'interface',
          dependsOn: [0],
        },
      ],
      whyThisMany: 'The page needs the endpoint.',
    }),
  }),
};

function setup(
  options: { live?: boolean; runs?: string[]; planner?: ModelPlanner } = {},
) {
  const root = mkdtempSync(join(tmpdir(), 'visual-agent-outside-'));
  temporaryDirectories.push(root);
  const folder = join(root, 'shop');
  mkdirSync(folder);
  git(folder, 'init', '-q');
  writeFileSync(join(folder, 'README.md'), '# Shop\n');
  git(folder, 'add', '.');
  git(folder, 'commit', '-qm', 'start');
  const database = openHarnessDatabase(join(root, 'test.db'));
  const service = new ProjectService(
    new SqliteProjectStore(database.database),
    {
      folders: { root },
      ...(options.planner ? { planner: options.planner } : {}),
      ...(options.live || options.planner
        ? {
            runtime: { mode: 'live' as const },
            runner: (input) => {
              options.runs?.push(input.prompt);
              return { done: Promise.resolve(), stop() {}, send: () => false };
            },
          }
        : {}),
    },
  );
  const created = service.createProject(
    CreateProjectCommandSchema.parse({
      commandId: commandId(),
      name: 'Shop',
      repositoryPath: folder,
    }),
  );
  return {
    service,
    folder,
    projectId: created.project.projection.projectId,
  };
}

async function askPlanner(
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
}

const take = (service: ProjectService, projectId: ProjectId) =>
  service.takeOutsideTask(projectId, {
    commandId: commandId(),
    client: 'Claude Code',
  });

const report = (
  service: ProjectService,
  projectId: ProjectId,
  taskId: string,
  body: object,
) =>
  service.reportOutsideTask(
    projectId,
    taskId,
    ReportTaskCommandSchema.parse({
      commandId: commandId(),
      client: 'Claude Code',
      ...body,
    }),
  );

describe('outside agent tools', () => {
  it('says when there is no plan to work from', async () => {
    const { service, projectId } = setup();
    expect(await take(service, projectId)).toMatchObject({
      status: 'no_plan',
    });
  });

  it('hands the open plan over and gives out one task at a time', async () => {
    const { service, projectId } = setup();
    await askPlanner(service, projectId, 'Build an invoice download page');
    const first = await take(service, projectId);
    expect(first.status).toBe('taken');
    expect(first.brief).toContain('report_task');
    expect(first.brief).toMatch(/Overview:\n- Goal: /);
    expect(first.brief).toContain(first.task!.id);

    const projection = service.getProject(projectId).projection;
    const plan = Object.values(projection.plans)[0]!;
    expect(plan.assignedAtSequence).toBeDefined();
    const proposal = Object.values(projection.proposals).find(
      (candidate) => candidate.kind === 'plan',
    )!;
    expect(proposal.state).toBe('approved');
    const task = projection.tasks[first.task!.id as never]!;
    expect(task.outside).toMatchObject({ client: 'Claude Code' });
    expect(task.outside?.baseCommit).toMatch(/^[0-9a-f]{40}$/);

    // Asking again hands back the same unfinished task.
    const again = await take(service, projectId);
    expect(again).toMatchObject({
      status: 'continuing',
      task: { id: first.task!.id },
    });
  });

  it('records the report, every changed file, and how it compares with git', async () => {
    const { service, projectId, folder } = setup();
    await askPlanner(service, projectId, 'Build an invoice download page');
    const first = await take(service, projectId);
    writeFileSync(join(folder, 'README.md'), '# Shop\n\nInvoices.\n');
    writeFileSync(join(folder, 'invoices.ts'), 'export const x = 1;\n');

    const result = await report(service, projectId, first.task!.id, {
      outcome: 'done',
      summary: 'Added the invoice list.',
      checks: first.task!.requiredChecks.map((name) => ({
        name,
        command: 'npm test',
        passed: true,
        output: '3 passed',
      })),
      filesChanged: ['invoices.ts'],
    });
    expect(result.state).toBe('done');
    expect(result.comparison).toBe(
      "Git shows 2 changed files. Not in Claude Code's report: README.md.",
    );

    const projection = service.getProject(projectId).projection;
    const outputs = Object.values(projection.outputs).filter(
      (output) => output.taskId === first.task!.id,
    );
    expect(
      outputs.map((output) => [output.kind, output.title, output.digest]),
    ).toEqual(
      expect.arrayContaining([
        ['diff', 'README.md', 'modified · +2 −0'],
        ['diff', 'invoices.ts', 'added · +1 −0'],
        ['report', 'Report from Claude Code', 'Added the invoice list.'],
      ]),
    );
    const readme = outputs.find((output) => output.title === 'README.md')!;
    expect(readme.diff).toMatch(/^@@ /);
    expect(readme.diff).toContain('+Invoices.');
  });

  it('starts the next task once the one it waits on is reported done', async () => {
    const { service, projectId } = setup({ planner: TWO_STEP });
    await askPlanner(service, projectId, 'Build an invoice download page');
    const first = await take(service, projectId);
    const projection = service.getProject(projectId).projection;
    const waiting = Object.values(projection.tasks).filter(
      (task) => task.state === 'waiting',
    );
    expect(waiting).toHaveLength(1);
    expect((await take(service, projectId)).status).toBe('continuing');
    await report(service, projectId, first.task!.id, {
      outcome: 'done',
      summary: 'Done.',
      checks: first.task!.requiredChecks.map((name) => ({
        name,
        command: 'npm test',
        passed: true,
      })),
    });
    const next = await take(service, projectId);
    expect(next.status).toBe('taken');
    expect(next.task!.id).toBe(waiting[0]!.id);
    expect(next.brief).toContain('Done before this');
  });

  it('fails a task reported done without its required checks', async () => {
    const { service, projectId } = setup();
    await askPlanner(service, projectId, 'Build an invoice download page');
    const first = await take(service, projectId);
    const result = await report(service, projectId, first.task!.id, {
      outcome: 'done',
      summary: 'All good.',
    });
    expect(result.state).toBe('failed');
    expect(result.message).toMatch(/required check ".+" never passed/);
  });

  it('refuses a report on a task stopped in the app', async () => {
    const { service, projectId } = setup();
    await askPlanner(service, projectId, 'Build an invoice download page');
    const first = await take(service, projectId);
    const projection = service.getProject(projectId).projection;
    const task = projection.tasks[first.task!.id as never]!;
    const agent = projection.agents[task.agentId]!;
    service.stopAgent(projectId, agent.id, {
      commandId: commandId(),
      expectedSequence: agent.lastSequence,
    });
    await expect(
      report(service, projectId, task.id, {
        outcome: 'done',
        summary: 'Done.',
      }),
    ).rejects.toThrow(/was stopped in Harness/);
  });

  it('keeps the app from stepping or chatting into an outside task', async () => {
    const { service, projectId } = setup();
    await askPlanner(service, projectId, 'Build an invoice download page');
    const first = await take(service, projectId);
    const projection = service.getProject(projectId).projection;
    const agent =
      projection.agents[projection.tasks[first.task!.id as never]!.agentId]!;
    expect(() =>
      service.advanceAgent(projectId, agent.id, {
        commandId: commandId(),
        expectedSequence: agent.lastSequence,
      }),
    ).toThrow(/Claude Code is doing this task/);
    const thread = projection.threads[agent.threadId]!;
    service.postMessage(projectId, thread.id, {
      commandId: commandId(),
      expectedSequence: thread.lastSequence,
      body: 'how is it going?',
      intent: 'chat',
    });
    await service.whenIdle(projectId);
    const last = service
      .listMessages(projectId, thread.id, { limit: 50 })
      .messages.at(-1)!;
    expect(last.body).toMatch(/outside the harness, so it cannot read this/);
  });

  it('starts no harness run for tasks handed to an outside tool', async () => {
    const runs: string[] = [];
    const { service, projectId } = setup({ live: true, runs });
    await askPlanner(service, projectId, 'Build an invoice download page');
    await take(service, projectId);
    await service.whenIdle(projectId);
    expect(runs).toEqual([]);
  });
});

describe('compareWithGit', () => {
  const changes = {
    available: true as const,
    files: [
      { path: 'a.ts', status: 'modified' as const, diff: '' },
      { path: 'b.ts', status: 'added' as const, diff: '' },
    ],
    more: 0,
  };

  it('says when the report matches', () => {
    expect(compareWithGit('Codex', changes, ['./a.ts', 'b.ts'])).toBe(
      "Git shows 2 changed files. It matches Codex's report.",
    );
  });

  it('names files claimed but unchanged', () => {
    expect(compareWithGit('Codex', changes, ['a.ts', 'b.ts', 'c.ts'])).toBe(
      'Git shows 2 changed files. Reported as changed but git shows no change: c.ts.',
    );
  });

  it('says when git cannot answer', () => {
    expect(
      compareWithGit(
        'Codex',
        { available: false, reason: 'This folder is not a git repository.' },
        [],
      ),
    ).toBe(
      "Could not check Codex's report against git: This folder is not a git repository.",
    );
  });
});
