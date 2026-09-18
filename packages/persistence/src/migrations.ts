import type Database from 'better-sqlite3';

interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

const migrations: readonly Migration[] = [
  {
    version: 1,
    name: 'foundation-records',
    sql: `
      CREATE TABLE foundation_records (
        id TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 2,
    name: 'events-and-run-projections',
    sql: `
      CREATE TABLE events (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        sequence INTEGER NOT NULL CHECK (sequence > 0),
        type TEXT NOT NULL,
        version INTEGER NOT NULL CHECK (version > 0),
        occurred_at TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        source TEXT NOT NULL,
        event_core_json TEXT NOT NULL,
        provider_metadata_json TEXT,
        UNIQUE (run_id, sequence)
      );

      CREATE INDEX events_run_sequence_idx
        ON events (run_id, sequence);

      CREATE TRIGGER events_are_append_only_update
      BEFORE UPDATE ON events
      BEGIN
        SELECT RAISE(ABORT, 'events are append-only');
      END;

      CREATE TRIGGER events_are_append_only_delete
      BEFORE DELETE ON events
      BEGIN
        SELECT RAISE(ABORT, 'events are append-only');
      END;

      CREATE TABLE run_projections (
        run_id TEXT PRIMARY KEY,
        last_sequence INTEGER NOT NULL CHECK (last_sequence > 0),
        projection_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
  },
];

export function runMigrations(database: Database.Database): number {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const appliedVersions = new Set(
    database
      .prepare('SELECT version FROM schema_migrations ORDER BY version')
      .all()
      .map((row) => (row as { version: number }).version),
  );

  const applyMigration = database.transaction((migration: Migration) => {
    database.exec(migration.sql);
    database
      .prepare(
        'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
      )
      .run(migration.version, migration.name, new Date().toISOString());
  });

  for (const migration of migrations) {
    if (!appliedVersions.has(migration.version)) {
      applyMigration(migration);
    }
  }

  return getMigrationCount(database);
}

export function getMigrationCount(database: Database.Database): number {
  const row = database
    .prepare('SELECT COUNT(*) AS count FROM schema_migrations')
    .get() as { count: number };

  return row.count;
}
