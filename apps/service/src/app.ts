import { randomUUID, timingSafeEqual } from 'node:crypto';
import Fastify from 'fastify';
import { z } from 'zod';
import type { AppConfig } from '@harness/config';
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
import { registerProjectRoutes } from './project-routes.js';
import { ProjectService } from './projects.js';

const FOUNDATION_RECORD_ID = 'increment-0';
const StartSimulatedRunSchema = z.strictObject({
  scenario: SimulatedScenarioIdSchema,
  goal: z.string().min(1).optional(),
  taskTitle: z.string().min(1).optional(),
});

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
  const projects = new ProjectService(projectStore);
  if (config.demoProject) projects.ensureDemoProject();
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

  service.addHook('onClose', async () => {
    store.close();
  });

  return service;
}
