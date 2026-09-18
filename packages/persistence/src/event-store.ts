import type Database from 'better-sqlite3';
import {
  RunIdSchema,
  parseDomainEvent,
  type DomainEvent,
  type RunId,
} from '@harness/contracts';
import {
  RunProjectionSchema,
  applyDomainEvent,
  replayDomainEvents,
  type DomainEventSink,
  type RunProjection,
} from '@harness/domain';

interface StoredEventRow {
  readonly event_core_json: string;
  readonly provider_metadata_json: string | null;
}

interface ProjectionRow {
  readonly projection_json: string;
}

export class EventStoreError extends Error {
  constructor(
    readonly code: 'duplicate_event' | 'projection_missing',
    message: string,
  ) {
    super(message);
    this.name = 'EventStoreError';
  }
}

function serializeEvent(event: DomainEvent): {
  core: string;
  providerMetadata: string | null;
} {
  const { providerMetadata, ...core } = event;
  return {
    core: JSON.stringify(core),
    providerMetadata: providerMetadata
      ? JSON.stringify(providerMetadata)
      : null,
  };
}

function deserializeEvent(row: StoredEventRow): DomainEvent {
  const core = JSON.parse(row.event_core_json) as Record<string, unknown>;
  return parseDomainEvent({
    ...core,
    ...(row.provider_metadata_json
      ? { providerMetadata: JSON.parse(row.provider_metadata_json) }
      : {}),
  });
}

export class SqliteEventStore implements DomainEventSink {
  constructor(private readonly database: Database.Database) {}

  private readStoredEvent(eventId: string): DomainEvent | undefined {
    const row = this.database
      .prepare(
        `SELECT event_core_json, provider_metadata_json
         FROM events
         WHERE id = ?`,
      )
      .get(eventId) as StoredEventRow | undefined;
    return row ? deserializeEvent(row) : undefined;
  }

  getProjection(runIdInput: RunId): RunProjection | undefined {
    const runId = RunIdSchema.parse(runIdInput);
    const row = this.database
      .prepare(
        `SELECT projection_json
         FROM run_projections
         WHERE run_id = ?`,
      )
      .get(runId) as ProjectionRow | undefined;
    return row
      ? RunProjectionSchema.parse(JSON.parse(row.projection_json))
      : undefined;
  }

  listProjections(): RunProjection[] {
    const rows = this.database
      .prepare(
        `SELECT projection_json
         FROM run_projections
         ORDER BY rowid DESC`,
      )
      .all() as ProjectionRow[];
    return rows.map((row) =>
      RunProjectionSchema.parse(JSON.parse(row.projection_json)),
    );
  }

  private appendWithinTransaction(input: DomainEvent): RunProjection {
    const event = parseDomainEvent(input);
    const existingEvent = this.readStoredEvent(event.id);
    if (existingEvent) {
      if (JSON.stringify(existingEvent) !== JSON.stringify(event)) {
        throw new EventStoreError(
          'duplicate_event',
          `Event ID ${event.id} was reused with different content.`,
        );
      }
      const existingProjection = this.getProjection(event.runId);
      if (!existingProjection) {
        throw new EventStoreError(
          'projection_missing',
          `Projection for idempotent event ${event.id} is missing.`,
        );
      }
      return existingProjection;
    }

    const current = this.getProjection(event.runId);
    const next = applyDomainEvent(current, event);
    const serialized = serializeEvent(event);

    this.database
      .prepare(
        `INSERT INTO events (
           id, run_id, sequence, type, version, occurred_at, recorded_at,
           source, event_core_json, provider_metadata_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.id,
        event.runId,
        event.sequence,
        event.type,
        event.version,
        event.occurredAt,
        event.recordedAt,
        event.source,
        serialized.core,
        serialized.providerMetadata,
      );

    this.database
      .prepare(
        `INSERT INTO run_projections (
           run_id, last_sequence, projection_json, updated_at
         ) VALUES (?, ?, ?, ?)
         ON CONFLICT(run_id) DO UPDATE SET
           last_sequence = excluded.last_sequence,
           projection_json = excluded.projection_json,
           updated_at = excluded.updated_at`,
      )
      .run(
        next.runId,
        next.lastSequence,
        JSON.stringify(next),
        event.recordedAt,
      );

    return next;
  }

  append(input: DomainEvent): RunProjection {
    return this.database.transaction((event: DomainEvent) =>
      this.appendWithinTransaction(event),
    )(input);
  }

  appendMany(events: readonly DomainEvent[]): RunProjection {
    if (events.length === 0) {
      throw new Error('appendMany requires at least one event.');
    }
    return this.database.transaction((items: readonly DomainEvent[]) => {
      let projection: RunProjection | undefined;
      for (const event of items) {
        projection = this.appendWithinTransaction(event);
      }
      if (!projection) throw new Error('No projection was produced.');
      return projection;
    })(events);
  }

  listEvents(runIdInput: RunId): DomainEvent[] {
    const runId = RunIdSchema.parse(runIdInput);
    const rows = this.database
      .prepare(
        `SELECT event_core_json, provider_metadata_json
         FROM events
         WHERE run_id = ?
         ORDER BY sequence ASC`,
      )
      .all(runId) as StoredEventRow[];
    return rows.map(deserializeEvent);
  }

  rebuildProjection(runIdInput: RunId): RunProjection {
    const runId = RunIdSchema.parse(runIdInput);
    const events = this.listEvents(runId);
    const projection = replayDomainEvents(events);
    this.database
      .prepare(
        `INSERT INTO run_projections (
           run_id, last_sequence, projection_json, updated_at
         ) VALUES (?, ?, ?, ?)
         ON CONFLICT(run_id) DO UPDATE SET
           last_sequence = excluded.last_sequence,
           projection_json = excluded.projection_json,
           updated_at = excluded.updated_at`,
      )
      .run(
        projection.runId,
        projection.lastSequence,
        JSON.stringify(projection),
        events.at(-1)?.recordedAt ?? new Date(0).toISOString(),
      );
    return projection;
  }

  rebuildAllProjections(): RunProjection[] {
    const rows = this.database
      .prepare('SELECT DISTINCT run_id FROM events ORDER BY run_id')
      .all() as Array<{ run_id: string }>;
    return rows.map(({ run_id }) =>
      this.rebuildProjection(RunIdSchema.parse(run_id)),
    );
  }
}
