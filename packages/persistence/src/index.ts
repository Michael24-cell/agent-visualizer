import Database from 'better-sqlite3';
import type { FoundationRecord } from '@harness/contracts';
import { runMigrations } from './migrations.js';

export interface HarnessDatabase {
  readonly database: Database.Database;
  readonly migrationCount: number;
  close(): void;
}

export function openHarnessDatabase(databasePath: string): HarnessDatabase {
  const database = new Database(databasePath);
  database.pragma('foreign_keys = ON');
  database.pragma('journal_mode = WAL');
  const migrationCount = runMigrations(database);

  return {
    database,
    migrationCount,
    close: () => database.close(),
  };
}

export function saveFoundationRecord(
  database: Database.Database,
  record: FoundationRecord,
): void {
  database
    .prepare(
      `INSERT INTO foundation_records (id, value, created_at)
       VALUES (@id, @value, @createdAt)
       ON CONFLICT(id) DO UPDATE SET value = excluded.value`,
    )
    .run(record);
}

export function getFoundationRecord(
  database: Database.Database,
  id: string,
): FoundationRecord | undefined {
  const row = database
    .prepare(
      `SELECT id, value, created_at AS createdAt
       FROM foundation_records
       WHERE id = ?`,
    )
    .get(id);

  return row as FoundationRecord | undefined;
}

export { getMigrationCount, runMigrations } from './migrations.js';
export * from './event-store.js';
