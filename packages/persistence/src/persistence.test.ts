import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
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
    expect(firstConnection.migrationCount).toBe(1);
    expect(runMigrations(firstConnection.database)).toBe(1);

    const record = {
      id: 'increment-0',
      value: 'Repository foundation ready',
      createdAt: new Date().toISOString(),
    };
    saveFoundationRecord(firstConnection.database, record);
    firstConnection.close();

    const secondConnection = openHarnessDatabase(databasePath);
    expect(getMigrationCount(secondConnection.database)).toBe(1);
    expect(getFoundationRecord(secondConnection.database, record.id)).toEqual(
      record,
    );
    secondConnection.close();
  });
});
