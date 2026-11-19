import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AgentInstanceIdSchema,
  PlanVersionIdSchema,
  RunIdSchema,
  TaskIdSchema,
} from '@harness/contracts';
import { executeRuntimeRun } from '@harness/domain';
import { SimulatedRuntimeAdapter } from '@harness/runtime-simulated';
import {
  SqliteEventStore,
  SqliteProjectStore,
  getFoundationRecord,
  getMigrationCount,
  openHarnessDatabase,
  runMigrations,
  saveFoundationRecord,
} from './index.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('persistence foundation', () => {
  it('runs migrations repeatedly and persists a record across connections', () => {
    const directory = mkdtempSync(join(tmpdir(), 'visual-agent-harness-'));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, 'test.db');

    const firstConnection = openHarnessDatabase(databasePath);
    expect(firstConnection.migrationCount).toBe(4);
    expect(runMigrations(firstConnection.database)).toBe(4);

    const record = {
      id: 'increment-0',
      value: 'Repository foundation ready',
      createdAt: new Date().toISOString(),
    };
    saveFoundationRecord(firstConnection.database, record);
    firstConnection.close();

    const secondConnection = openHarnessDatabase(databasePath);
    expect(getMigrationCount(secondConnection.database)).toBe(4);
    expect(getFoundationRecord(secondConnection.database, record.id)).toEqual(
      record,
    );
    secondConnection.close();
  });
});

describe('increment 2.6 migration safety', () => {
  it('upgrades a database that holds runs without changing their events or projections', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'visual-agent-harness-'));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, 'existing.db');

    // Representative pre-2.6 data: a completed simulated run.
    const seeded = openHarnessDatabase(databasePath);
    const store = new SqliteEventStore(seeded.database);
    const ids = {
      runId: RunIdSchema.parse('run_pre-upgrade'),
      planVersionId: PlanVersionIdSchema.parse('planv_pre-upgrade'),
      taskId: TaskIdSchema.parse('task_pre-upgrade'),
      agentInstanceId: AgentInstanceIdSchema.parse('agent_pre-upgrade'),
    };
    await executeRuntimeRun(new SimulatedRuntimeAdapter(), store, {
      ...ids,
      goal: 'Exercise successful-task.',
      taskTitle: 'Fixture: successful-task',
      runtimeConfiguration: { scenario: 'successful-task' },
    });
    const eventsBefore = JSON.stringify(store.listEvents(ids.runId));
    const projectionBefore = JSON.stringify(store.getProjection(ids.runId));

    // Roll the schema back to version 2 so the 2.6 migration runs for real.
    seeded.database.exec(`
      DROP TABLE project_purges;
      DELETE FROM schema_migrations WHERE version = 4;
      DROP TABLE command_receipts;
      DROP TABLE messages;
      DROP TABLE project_projections;
      DROP TABLE project_events;
      DELETE FROM schema_migrations WHERE version = 3;
    `);
    expect(getMigrationCount(seeded.database)).toBe(2);
    seeded.close();

    const upgraded = openHarnessDatabase(databasePath);
    expect(upgraded.migrationCount).toBe(4);
    expect(runMigrations(upgraded.database)).toBe(4);
    const after = new SqliteEventStore(upgraded.database);
    expect(JSON.stringify(after.listEvents(ids.runId))).toBe(eventsBefore);
    expect(JSON.stringify(after.getProjection(ids.runId))).toBe(
      projectionBefore,
    );
    expect(JSON.stringify(after.rebuildProjection(ids.runId))).toBe(
      projectionBefore,
    );
    expect(new SqliteProjectStore(upgraded.database).listProjections()).toEqual(
      [],
    );
    upgraded.close();
  });
});
