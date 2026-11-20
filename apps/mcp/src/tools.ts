import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ProjectResponse } from '@harness/contracts';
import { z } from 'zod';
import { Harness, HarnessError } from './harness.js';

// The tools an agent tool (Claude Code, Codex, Cursor) gets from Harness:
// read the project's Overview and plan, ask the Planner for a plan, take
// the next task, and report it. Each works on the Harness project whose
// folder holds the tool's working folder.

export const SERVER_NAME = 'harness';
export const SERVER_VERSION = '0.1.0';

const OVERVIEW_LABELS: Record<string, string> = {
  goal: 'Goal',
  scope: 'Scope',
  constraints: 'Constraints',
  doneMeans: 'Done means',
  checks: 'Checks',
  audience: 'Audience',
};

const STATE_WORDS: Record<string, string> = {
  waiting: 'waiting',
  working: 'in progress',
  needs_you: 'needs you',
  done: 'done',
  stopped: 'stopped',
  failed: 'failed',
};

// How panes name the tool. The MCP client says its own name when it
// connects ("claude-code"); HARNESS_CLIENT_NAME overrides it.
export function clientLabel(name: string | undefined): string {
  const known: Record<string, string> = {
    'claude-code': 'Claude Code',
    'claude-ai': 'Claude',
    codex: 'Codex',
    'codex-mcp-client': 'Codex',
    cursor: 'Cursor',
    'cursor-vscode': 'Cursor',
  };
  if (!name) return 'Outside tool';
  return known[name.toLowerCase()] ?? name.slice(0, 80);
}

export function describeOverview(project: ProjectResponse): string {
  const projection = project.projection;
  const lines = [
    `Project: ${projection.project.name}`,
    `Folder: ${projection.project.repository?.path ?? '(none)'}`,
  ];
  const overview = Object.entries(projection.brief.fields).flatMap(
    ([id, field]) => {
      const value = (field as { value?: unknown }).value;
      return typeof value === 'string' && value.trim()
        ? [`- ${OVERVIEW_LABELS[id] ?? id}: ${value.trim()}`]
        : [];
    },
  );
  lines.push(
    '',
    overview.length
      ? `Overview:\n${overview.join('\n')}`
      : 'Overview: nothing filled in yet.',
  );
  const sections = Object.entries(projection.planDocument.sections).filter(
    ([, section]) => section && section.lines.length,
  );
  if (sections.length) {
    lines.push(
      '',
      'Plan document:',
      ...sections.flatMap(([id, section]) => [
        `${id}:`,
        ...section!.lines.map((line) => `- ${line}`),
      ]),
    );
  }
  return lines.join('\n');
}

export function describePlan(project: ProjectResponse): string {
  const projection = project.projection;
  const plan = Object.values(projection.plans)
    .filter((candidate) => !candidate.supersededByPlanId)
    .sort((a, b) => b.version - a.version)[0];
  if (!plan) {
    return 'There is no plan yet. Ask for one with draft_plan.';
  }
  const tasks = Object.values(projection.tasks).filter(
    (task) => task.planId === plan.id,
  );
  const handedTo = tasks.find((task) => task.outside)?.outside?.client;
  const status = plan.assignedAtSequence
    ? handedTo
      ? `handed to ${handedTo}`
      : "assigned to Harness's own agents"
    : 'not started — next_task hands it to you';
  const rows = plan.tasks.map((row, index) => {
    const task = tasks.find((candidate) => candidate.planTaskIndex === index);
    const after = row.dependsOn.length
      ? ` (after ${row.dependsOn.map((other) => other + 1).join(', ')})`
      : '';
    const state = task ? ` [${STATE_WORDS[task.state] ?? task.state}]` : '';
    return `${index + 1}. ${row.title}${after}${state}\n   ${row.objective}`;
  });
  return [
    `Plan v${plan.version} for "${plan.request}" — ${status}.`,
    plan.whyThisMany,
    '',
    ...rows,
  ].join('\n');
}

// The Planner speaks to the person in the app ("Assign to agents"); here
// the reader is the tool, whose next steps are tool calls.
export function forTool(reply: string): string {
  return reply.replace(
    /Assign to agents, or tell me what (else )?to change\./,
    'Call next_task to start it, or draft_plan again with what to change.',
  );
}

const text = (body: string, isError = false) => ({
  content: [{ type: 'text' as const, text: body }],
  ...(isError ? { isError: true } : {}),
});

const folderInput = z
  .string()
  .optional()
  .describe(
    'The project folder. Leave out to use the folder this session works in.',
  );

export interface ServerOptions {
  readonly harness?: Harness;
  // The folder this session works in, when the client does not say.
  readonly cwd?: string;
  readonly clientName?: string | undefined;
}

export function createHarnessServer(options: ServerOptions = {}): McpServer {
  const harness = options.harness ?? new Harness();
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        'Harness is where the person plans and reviews agent work. Use these tools when they ask you to work from their Harness plan: draft_plan to make one, next_task to take a task, report_task when it is finished. Do one task at a time and report each before taking the next.',
    },
  );

  const client = () =>
    options.clientName ?? clientLabel(server.server.getClientVersion()?.name);

  // The folder: what the tool passed, else the client's first root, else
  // the folder this server was started in.
  const folderFor = async (given: string | undefined): Promise<string> => {
    if (given)
      return isAbsolute(given)
        ? given
        : resolve(options.cwd ?? process.cwd(), given);
    if (server.server.getClientCapabilities()?.roots) {
      try {
        const { roots } = await server.server.listRoots();
        const first = roots.find((root) => root.uri.startsWith('file:'));
        if (first) return fileURLToPath(first.uri);
      } catch {
        // Fall back to the working folder.
      }
    }
    return options.cwd ?? process.cwd();
  };

  const projectIn = async (folder: string) => {
    const project = await harness.projectFor(folder);
    if (!project) {
      throw new HarnessError(
        `No Harness project uses ${folder}. Make one in Harness with this folder, or call draft_plan to make one here.`,
      );
    }
    return project;
  };

  const guarded =
    <A>(work: (args: A) => Promise<ReturnType<typeof text>>) =>
    async (args: A) => {
      try {
        return await work(args);
      } catch (error) {
        if (error instanceof HarnessError) return text(error.message, true);
        throw error;
      }
    };

  server.registerTool(
    'get_overview',
    {
      title: 'Read the project Overview',
      description:
        "The Harness project's goal, scope, constraints, what done means, and the Plan document.",
      inputSchema: { folder: folderInput },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guarded(async ({ folder }) =>
      text(describeOverview(await projectIn(await folderFor(folder)))),
    ),
  );

  server.registerTool(
    'get_plan',
    {
      title: 'Read the current plan',
      description:
        'The latest plan: each task, what it waits on, and how far it has got.',
      inputSchema: { folder: folderInput },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guarded(async ({ folder }) =>
      text(describePlan(await projectIn(await folderFor(folder)))),
    ),
  );

  server.registerTool(
    'draft_plan',
    {
      title: 'Ask the Planner for a plan',
      description:
        'Sends the person\'s request to the Harness Planner, which drafts a plan of tasks (or changes the open plan, e.g. "combine into one task"). The person sees and can edit the plan in Harness. Makes a Harness project for this folder if there is none.',
      inputSchema: {
        request: z
          .string()
          .trim()
          .min(1)
          .max(4_000)
          .describe("What to build or change, in the person's words."),
        folder: folderInput,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    guarded(async ({ request, folder }) => {
      const where = await folderFor(folder);
      const project =
        (await harness.projectFor(where)) ??
        (await harness.createProject(where));
      const answer = await harness.askPlanner(project, request);
      return text(
        `Planner: ${forTool(answer.reply)}\n\n${describePlan(answer.project)}`,
      );
    }),
  );

  server.registerTool(
    'next_task',
    {
      title: 'Take the next task',
      description:
        'Gives you the next task that is ready, with everything needed to do it. If the plan has not been started, this approves it and hands it to you, so only call it when the person asked you to work from the Harness plan. If you already have an unfinished task, you get that one again.',
      inputSchema: { folder: folderInput },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    guarded(async ({ folder }) => {
      const project = await projectIn(await folderFor(folder));
      const result = await harness.takeTask(
        project.projection.projectId,
        client(),
      );
      return text(
        result.brief ? `${result.message}\n\n${result.brief}` : result.message,
      );
    }),
  );

  server.registerTool(
    'report_task',
    {
      title: 'Report a task finished or failed',
      description:
        'Tells Harness the task is done (or could not be done). Harness records your summary and checks, compares the files you list with what git shows changed, and puts the changes in Review. Done needs every required check reported as passing.',
      inputSchema: {
        task_id: z.string().min(1).describe('The task id next_task gave you.'),
        outcome: z.enum(['done', 'failed']),
        summary: z
          .string()
          .trim()
          .min(1)
          .max(4_000)
          .describe('What changed and how it was verified, or why it failed.'),
        checks: z
          .array(
            z.object({
              name: z
                .string()
                .min(1)
                .max(80)
                .describe(
                  'The required check this verifies, by its exact name.',
                ),
              command: z.string().min(1).max(500),
              passed: z.boolean(),
              output: z
                .string()
                .max(4_000)
                .optional()
                .describe('The end of what the command printed.'),
            }),
          )
          .max(20)
          .optional(),
        files_changed: z
          .array(z.string().min(1).max(500))
          .max(500)
          .optional()
          .describe('Paths you changed, relative to the folder.'),
        folder: folderInput,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    guarded(async (args) => {
      const project = await projectIn(await folderFor(args.folder));
      const result = await harness.reportTask(
        project.projection.projectId,
        args.task_id,
        {
          client: client(),
          outcome: args.outcome,
          summary: args.summary,
          ...(args.checks ? { checks: args.checks } : {}),
          ...(args.files_changed ? { filesChanged: args.files_changed } : {}),
        },
      );
      const next =
        result.state === 'done' ? ' Call next_task for the next one.' : '';
      return text(`${result.message}${next}`);
    }),
  );

  return server;
}
