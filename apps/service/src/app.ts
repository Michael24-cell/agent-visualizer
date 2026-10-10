import { randomUUID, timingSafeEqual } from 'node:crypto';
import Fastify from 'fastify';
import { z } from 'zod';
import type { AppConfig, RuntimeConfig } from '@harness/config';
import {
  AdvanceDemoRunCommandSchema,
  AgentInstanceIdSchema,
  ApprovalDecisionCommandSchema,
  ApprovalIdSchema,
  CancelDemoRunCommandSchema,
  DemoRunSnapshotSchema,
  FoundationStatusSchema,
  LaunchDemoRunCommandSchema,
  LaunchDemoRunResponseSchema,
  PlanVersionIdSchema,
  RunIdSchema,
  RuntimeSettingsSchema,
  RuntimeUpdateSchema,
  ServiceHealthSchema,
  TaskIdSchema,
  WorkspaceResponseSchema,
  type FoundationRecord,
} from '@harness/contracts';
import { RunProjectionSchema, executeRuntimeRun } from '@harness/domain';
import {
  SqliteEventStore,
  SqliteProjectStore,
  getFoundationRecord,
  openHarnessDatabase,
  saveFoundationRecord,
} from '@harness/persistence';
import {
  SimulatedRuntimeAdapter,
  SimulatedScenarioIdSchema,
} from '@harness/runtime-simulated';
import {
  DEMO_PLAN_VERSION_ID,
  DemoCommandError,
  advanceDemoRun,
  cancelDemoRun,
  createDemoRun,
  decideDemoApproval,
  latestDemoSnapshot,
  snapshotFor,
  workspaceFixture,
} from './demo-run.js';
import {
  LOCAL_AGENT_TOOLS,
  LOCAL_AGENT_TOOLS_FULL,
  runOpenAiTask,
} from '@harness/runtime-openai';
import { runLiveTask } from '@harness/runtime-claude';
import {
  CHATGPT_RESOURCE,
  ChatGptAuth,
  ChatGptAuthError,
} from './chatgpt-auth.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { registerProjectRoutes } from './project-routes.js';
import { ProjectService, type TaskRunner } from './projects.js';

const FOUNDATION_RECORD_ID = 'increment-0';
const StartSimulatedRunSchema = z.strictObject({
  scenario: SimulatedScenarioIdSchema,
  goal: z.string().min(1).optional(),
  taskTitle: z.string().min(1).optional(),
});

// The runtime the service reports and the runner that executes tasks.
function runtimeOptions(
  runtime: RuntimeConfig,
  chatgpt: ChatGptAuth,
): {
  runtime: {
    mode: 'simulated' | 'live';
    provider?: 'claude' | 'openai' | 'chatgpt';
    model?: string;
  };
  runner?: TaskRunner;
} {
  switch (runtime.kind) {
    case 'chatgpt':
      // The signed-in ChatGPT plan, through the Responses API it requires.
      // Each request asks for a token so hourly expiry is handled inside.
      return {
        runtime: { mode: 'live', provider: 'chatgpt', model: runtime.model },
        runner: (input, sink) =>
          runOpenAiTask(input, sink, {
            baseUrl: CHATGPT_RESOURCE,
            model: runtime.model,
            transport: 'responses',
            accessToken: () => chatgpt.accessToken(),
            usageProvider: 'chatgpt',
            tools: LOCAL_AGENT_TOOLS_FULL,
          }),
      };
    case 'claude':
      return {
        runtime: { mode: 'live', provider: 'claude' },
        runner: (input, sink) => runLiveTask(input, sink),
      };
    case 'openai':
      return {
        runtime: { mode: 'live', provider: 'openai', model: runtime.model },
        runner: (input, sink) =>
          runOpenAiTask(input, sink, {
            baseUrl: runtime.baseUrl,
            apiKey: runtime.apiKey,
            model: runtime.model,
            tools:
              runtime.tools === 'full'
                ? LOCAL_AGENT_TOOLS_FULL
                : LOCAL_AGENT_TOOLS,
          }),
      };
    default:
      return { runtime: { mode: 'simulated' } };
  }
}

// Writes the runtime keys into .env.local, keeping every other line.
function saveEnvFile(
  path: string,
  values: Record<string, string | undefined>,
): void {
  let lines: string[];
  try {
    lines = readFileSync(path, 'utf8').split(/\r?\n/);
  } catch {
    lines = [];
  }
  const remaining = new Map(Object.entries(values));
  const next = lines
    .map((line) => {
      const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
      if (!match || !remaining.has(match[1]!)) return line;
      const value = remaining.get(match[1]!);
      remaining.delete(match[1]!);
      return value === undefined ? undefined : `${match[1]}=${value}`;
    })
    .filter((line): line is string => line !== undefined);
  for (const [key, value] of remaining) {
    if (value !== undefined) next.push(`${key}=${value}`);
  }
  while (next.length && next[next.length - 1] === '') next.pop();
  writeFileSync(path, `${next.join('\n')}\n`);
}

function tokensMatch(expected: string, presented: string): boolean {
  const expectedBytes = Buffer.from(expected);
  const presentedBytes = Buffer.from(presented);

  return (
    expectedBytes.length === presentedBytes.length &&
    timingSafeEqual(expectedBytes, presentedBytes)
  );
}

function demoErrorStatus(error: DemoCommandError): 400 | 404 | 409 {
  if (error.code === 'not_found') return 404;
  if (error.code === 'stale') return 409;
  return 400;
}

export function createService(config: AppConfig) {
  const service = Fastify({ logger: true });
  const store = openHarnessDatabase(config.databasePath);
  const eventStore = new SqliteEventStore(store.database);
  eventStore.rebuildAllProjections();
  const projectStore = new SqliteProjectStore(store.database);
  projectStore.rebuildAllProjections();
  const chatgpt = new ChatGptAuth({ dataDirectory: config.dataDirectory });
  let chatgptModel = config.chatgptModel ?? 'gpt-6.1-sol';
  const projects = new ProjectService(projectStore, {
    folders: config.folderRoot ? { root: config.folderRoot } : {},
    replies:
      config.replyDelayMs === undefined
        ? { mode: 'inline' }
        : { mode: 'deferred', delayMs: config.replyDelayMs },
    ...runtimeOptions(config.runtime, chatgpt),
  });
  // Runtime settings can change while running; this is the current one.
  let currentRuntime: RuntimeConfig = config.runtime;
  const claudeKeyPresent = config.claudeKeyPresent;
  let local = { ...config.local };
  if (config.demoProject) projects.ensureDemoProject();
  projects.recoverInterruptedRuns();
  const foundationRecord: FoundationRecord = {
    id: FOUNDATION_RECORD_ID,
    value: 'Repository foundation ready',
    createdAt: new Date().toISOString(),
  };

  if (!getFoundationRecord(store.database, FOUNDATION_RECORD_ID)) {
    saveFoundationRecord(store.database, foundationRecord);
  }

  service.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    if (origin && !config.allowedOrigins.includes(origin)) {
      return reply.code(403).send({ error: 'Origin is not allowed.' });
    }

    const presentedToken = request.headers['x-harness-session'];
    if (
      typeof presentedToken !== 'string' ||
      !tokensMatch(config.sessionToken, presentedToken)
    ) {
      return reply
        .code(401)
        .send({ error: 'A valid local session is required.' });
    }
  });

  service.get('/api/health', async () =>
    ServiceHealthSchema.parse({
      service: 'ready',
      database: 'ready',
      checkedAt: new Date().toISOString(),
    }),
  );

  service.get('/api/foundation', async () => {
    const record = getFoundationRecord(store.database, FOUNDATION_RECORD_ID);
    if (!record) {
      throw new Error(
        'Foundation record is missing after database initialization.',
      );
    }

    return FoundationStatusSchema.parse({
      record,
      migrationCount: store.migrationCount,
    });
  });

  service.get('/api/workspace', async () =>
    WorkspaceResponseSchema.parse({
      workspace: workspaceFixture,
      activeRun: latestDemoSnapshot(eventStore),
    }),
  );

  service.post('/api/demo-runs', async (request, reply) => {
    const command = LaunchDemoRunCommandSchema.safeParse(request.body);
    if (!command.success) {
      return reply.code(400).send({ error: 'Invalid launch command.' });
    }
    if (command.data.planVersionId !== DEMO_PLAN_VERSION_ID) {
      return reply.code(409).send({ error: 'The plan version is stale.' });
    }
    const runId = RunIdSchema.parse(`run_${randomUUID()}`);
    createDemoRun(eventStore, runId);
    return reply.code(202).send(LaunchDemoRunResponseSchema.parse({ runId }));
  });

  service.get('/api/demo-runs/:runId', async (request, reply) => {
    const parameters = z
      .strictObject({ runId: RunIdSchema })
      .safeParse(request.params);
    if (!parameters.success) {
      return reply.code(400).send({ error: 'Invalid run ID.' });
    }
    try {
      return DemoRunSnapshotSchema.parse(
        snapshotFor(eventStore, parameters.data.runId),
      );
    } catch (error) {
      if (error instanceof DemoCommandError) {
        return reply
          .code(demoErrorStatus(error))
          .send({ error: error.message });
      }
      throw error;
    }
  });

  service.post('/api/demo-runs/:runId/advance', async (request, reply) => {
    const parameters = z
      .strictObject({ runId: RunIdSchema })
      .safeParse(request.params);
    const command = AdvanceDemoRunCommandSchema.safeParse(request.body);
    if (!parameters.success || !command.success) {
      return reply.code(400).send({ error: 'Invalid advance command.' });
    }
    try {
      return DemoRunSnapshotSchema.parse(
        advanceDemoRun(
          eventStore,
          parameters.data.runId,
          command.data.expectedSequence,
        ),
      );
    } catch (error) {
      if (error instanceof DemoCommandError) {
        return reply
          .code(demoErrorStatus(error))
          .send({ error: error.message });
      }
      throw error;
    }
  });

  service.post(
    '/api/demo-runs/:runId/approvals/:approvalId',
    async (request, reply) => {
      const parameters = z
        .strictObject({ runId: RunIdSchema, approvalId: ApprovalIdSchema })
        .safeParse(request.params);
      const command = ApprovalDecisionCommandSchema.safeParse(request.body);
      if (!parameters.success || !command.success) {
        return reply.code(400).send({ error: 'Invalid approval command.' });
      }
      try {
        return DemoRunSnapshotSchema.parse(
          decideDemoApproval(
            eventStore,
            parameters.data.runId,
            parameters.data.approvalId,
            command.data.decision,
            command.data.expectedSequence,
          ),
        );
      } catch (error) {
        if (error instanceof DemoCommandError) {
          return reply
            .code(demoErrorStatus(error))
            .send({ error: error.message });
        }
        throw error;
      }
    },
  );

  service.post('/api/demo-runs/:runId/cancel', async (request, reply) => {
    const parameters = z
      .strictObject({ runId: RunIdSchema })
      .safeParse(request.params);
    const command = CancelDemoRunCommandSchema.safeParse(request.body);
    if (!parameters.success || !command.success) {
      return reply.code(400).send({ error: 'Invalid cancellation command.' });
    }
    try {
      return DemoRunSnapshotSchema.parse(
        cancelDemoRun(
          eventStore,
          parameters.data.runId,
          command.data.expectedSequence,
        ),
      );
    } catch (error) {
      if (error instanceof DemoCommandError) {
        return reply
          .code(demoErrorStatus(error))
          .send({ error: error.message });
      }
      throw error;
    }
  });

  service.get('/api/runs/:runId/events', async (request, reply) => {
    const parameters = z
      .strictObject({ runId: RunIdSchema })
      .safeParse(request.params);
    const query = z
      .strictObject({ after: z.coerce.number().int().nonnegative().default(0) })
      .safeParse(request.query);
    if (!parameters.success || !query.success) {
      return reply.code(400).send({ error: 'Invalid event cursor.' });
    }
    const projection = eventStore.getProjection(parameters.data.runId);
    if (!projection) {
      return reply.code(404).send({ error: 'Run was not found.' });
    }
    const events = eventStore
      .listEvents(parameters.data.runId)
      .filter((event) => event.sequence > query.data.after);
    const body = [
      ...events.map(
        (event) =>
          `id: ${event.sequence}\nevent: domain-event\ndata: ${JSON.stringify(event)}\n`,
      ),
      `event: stream-end\ndata: ${JSON.stringify({ cursor: projection.lastSequence })}\n`,
    ].join('\n');
    return reply
      .header('content-type', 'text/event-stream; charset=utf-8')
      .header('cache-control', 'no-cache, no-transform')
      .header('x-accel-buffering', 'no')
      .send(`${body}\n`);
  });

  service.post('/api/simulated-runs', async (request, reply) => {
    const command = StartSimulatedRunSchema.safeParse(request.body);
    if (!command.success) {
      return reply.code(400).send({
        error: 'Invalid simulated run command.',
        issues: command.error.issues.map((issue) => issue.message),
      });
    }

    const suffix = randomUUID();
    const scenario = command.data.scenario;
    const projection = await executeRuntimeRun(
      new SimulatedRuntimeAdapter(),
      eventStore,
      {
        runId: RunIdSchema.parse(`run_${suffix}`),
        planVersionId: PlanVersionIdSchema.parse(`planv_${suffix}`),
        taskId: TaskIdSchema.parse(`task_${suffix}`),
        agentInstanceId: AgentInstanceIdSchema.parse(`agent_${suffix}`),
        goal: command.data.goal ?? `Exercise ${scenario}.`,
        taskTitle: command.data.taskTitle ?? `Fixture: ${scenario}`,
        runtimeConfiguration: { scenario },
      },
    );

    return reply.code(201).send(RunProjectionSchema.parse(projection));
  });

  service.get('/api/runs/:runId', async (request, reply) => {
    const parameters = z
      .strictObject({ runId: RunIdSchema })
      .safeParse(request.params);
    if (!parameters.success) {
      return reply.code(400).send({ error: 'Invalid run ID.' });
    }

    const projection = eventStore.getProjection(parameters.data.runId);
    if (!projection) {
      return reply.code(404).send({ error: 'Run was not found.' });
    }
    return RunProjectionSchema.parse(projection);
  });

  registerProjectRoutes(service, projects);

  // What the configured OpenAI-compatible endpoint offers, so a wrong
  // model name is a one-line fix rather than a failed task.
  service.get('/api/runtime', async () =>
    RuntimeSettingsSchema.parse(describeRuntime()),
  );

  service.post('/api/runtime', async (request, reply) => {
    const update = RuntimeUpdateSchema.safeParse(request.body);
    if (!update.success) {
      return reply.code(400).send({
        error: 'Runtime settings are not valid.',
        code: 'invalid_command',
      });
    }
    const body = update.data;
    if (body.kind === 'claude' && !claudeKeyPresent) {
      return reply.code(409).send({
        error:
          'ANTHROPIC_API_KEY is not set. Export it in the shell that starts the app, then restart.',
        code: 'invalid_transition',
      });
    }
    if (body.kind === 'chatgpt' && !chatgpt.signedIn) {
      return reply.code(409).send({
        error: 'Sign in with ChatGPT first, then choose it as the runtime.',
        code: 'invalid_transition',
      });
    }
    if (body.kind === 'chatgpt') {
      chatgptModel = body.model ?? chatgptModel;
      currentRuntime = { kind: 'chatgpt', model: chatgptModel };
    } else if (body.kind === 'openai') {
      local = {
        baseUrl: body.baseUrl ?? local.baseUrl,
        model: body.model ?? local.model,
        tools: body.tools ?? local.tools,
        apiKey: body.apiKey ? body.apiKey : local.apiKey,
      };
      currentRuntime = { kind: 'openai', ...local };
    } else {
      currentRuntime = { kind: body.kind };
    }
    const options = runtimeOptions(currentRuntime, chatgpt);
    projects.setRuntime(options.runtime, options.runner);
    if (config.envFile) {
      try {
        saveEnvFile(config.envFile, {
          HARNESS_RUNTIME:
            currentRuntime.kind === 'openai' ? 'local' : currentRuntime.kind,
          ...(currentRuntime.kind === 'chatgpt'
            ? { HARNESS_CHATGPT_MODEL: chatgptModel }
            : {}),
          ...(currentRuntime.kind === 'openai'
            ? {
                HARNESS_LOCAL_BASE_URL: local.baseUrl,
                HARNESS_LOCAL_MODEL: local.model,
                HARNESS_LOCAL_TOOLS: local.tools,
                ...(body.apiKey ? { HARNESS_LOCAL_API_KEY: body.apiKey } : {}),
              }
            : {}),
        });
      } catch (error) {
        service.log.warn(error, 'could not save .env.local');
      }
    }
    return RuntimeSettingsSchema.parse(describeRuntime());
  });

  function describeRuntime() {
    return {
      kind: currentRuntime.kind,
      baseUrl: local.baseUrl,
      model: local.model,
      tools: local.tools,
      keyPresent: Boolean(local.apiKey),
      claudeKeyPresent,
      chatgpt: { ...chatgpt.status(), model: chatgptModel },
      ...(config.envFile ? { envFile: config.envFile } : {}),
    };
  }

  // Sign in with ChatGPT. The browser opens the returned URL; the service
  // listens on 127.0.0.1 for the callback and keeps the tokens itself.
  service.get('/api/chatgpt', async () => chatgpt.status());

  service.post('/api/chatgpt/sign-in', async (_request, reply) => {
    try {
      return { url: await chatgpt.startSignIn() };
    } catch (error) {
      return reply.code(503).send({
        error:
          error instanceof Error
            ? error.message
            : 'The sign-in could not start.',
        code: 'invalid_command',
      });
    }
  });

  service.post('/api/chatgpt/sign-out', async () => {
    await chatgpt.signOut();
    if (currentRuntime.kind === 'chatgpt') {
      // Nothing left to run on: fall back to the simulator, honestly.
      currentRuntime = { kind: 'simulated' };
      const options = runtimeOptions(currentRuntime, chatgpt);
      projects.setRuntime(options.runtime, options.runner);
    }
    return RuntimeSettingsSchema.parse(describeRuntime());
  });

  service.get('/api/chatgpt/models', async (_request, reply) => {
    try {
      return { configured: chatgptModel, models: await chatgpt.listModels() };
    } catch (error) {
      return reply.code(error instanceof ChatGptAuthError ? 409 : 502).send({
        error: error instanceof Error ? error.message : String(error),
        code: 'invalid_command',
      });
    }
  });

  service.get('/api/runtime/models', async (_request, reply) => {
    // On the ChatGPT plan the picker beside Send lists the plan's models.
    if (currentRuntime.kind === 'chatgpt') {
      try {
        const models = await chatgpt.listModels();
        return {
          runtime: 'chatgpt',
          configured: chatgptModel,
          models: models.map((model) => model.slug).sort(),
        };
      } catch (error) {
        return reply.code(502).send({
          error: error instanceof Error ? error.message : String(error),
          code: 'invalid_command',
        });
      }
    }
    const runtime =
      currentRuntime.kind === 'openai'
        ? currentRuntime
        : { kind: 'openai' as const, ...local };
    try {
      const response = await fetch(
        `${runtime.baseUrl.replace(/\/$/, '')}/models`,
        {
          headers: runtime.apiKey
            ? { authorization: `Bearer ${runtime.apiKey}` }
            : {},
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!response.ok) {
        return reply.code(502).send({
          error: `${runtime.baseUrl} answered ${response.status} when listing models.`,
          code: 'invalid_command',
        });
      }
      const body = (await response.json()) as {
        data?: { id?: string; name?: string }[];
        models?: { id?: string; name?: string }[];
      };
      const models = (body.data ?? body.models ?? [])
        .map((entry) => entry.id ?? entry.name ?? '')
        .filter((id) => id.length > 0)
        .sort();
      return { runtime: 'openai', configured: runtime.model, models };
    } catch (error) {
      return reply.code(502).send({
        error: error instanceof Error ? error.message : String(error),
        code: 'invalid_command',
      });
    }
  });

  service.addHook('onClose', async () => {
    chatgpt.close();
    projects.stopAll();
    await projects.whenIdle();
    store.close();
  });

  return service;
}
