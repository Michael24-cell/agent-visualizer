import type Database from 'better-sqlite3';

// The parts of an event and a projection the generic store needs. Both the
// run stream and the project stream satisfy this shape.
interface StreamEvent {
  readonly id: string;
  readonly sequence: number;
  readonly type: string;
  readonly version: number;
  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly source: string;
  readonly providerMetadata?: Record<string, unknown> | undefined;
}

interface StreamProjection {
  readonly lastSequence: number;
}

export interface StreamStoreConfig<
  TEvent extends StreamEvent,
  TProjection extends StreamProjection,
> {
  readonly eventsTable: string;
  readonly projectionsTable: string;
  // Column that names the stream in both tables (`run_id`, `project_id`).
  readonly streamColumn: string;
  readonly streamIdOf: (event: TEvent) => string;
  readonly projectionStreamIdOf: (projection: TProjection) => string;
  readonly parseEvent: (input: unknown) => TEvent;
  readonly parseProjection: (input: unknown) => TProjection;
  readonly reduce: (
    current: TProjection | undefined,
    event: TEvent,
  ) => TProjection;
  readonly replay: (events: readonly TEvent[]) => TProjection;
  // Extra rows to write for an event, inside the same transaction.
  readonly onAppend?: (event: TEvent) => void;
}

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

// Append-only event stream with a materialized projection per stream.
// Every append validates the event against the reducer before writing, so
// the table never holds an event the projection could not accept.
export class SqliteStreamStore<
  TEvent extends StreamEvent,
  TProjection extends StreamProjection,
> {
  constructor(
    readonly database: Database.Database,
    private readonly config: StreamStoreConfig<TEvent, TProjection>,
  ) {}

  private deserialize(row: StoredEventRow): TEvent {
    const core = JSON.parse(row.event_core_json) as Record<string, unknown>;
    return this.config.parseEvent({
      ...core,
      ...(row.provider_metadata_json
        ? { providerMetadata: JSON.parse(row.provider_metadata_json) }
        : {}),
    });
  }

  private readStoredEvent(eventId: string): TEvent | undefined {
    const row = this.database
      .prepare(
        `SELECT event_core_json, provider_metadata_json
         FROM ${this.config.eventsTable}
         WHERE id = ?`,
      )
      .get(eventId) as StoredEventRow | undefined;
    return row ? this.deserialize(row) : undefined;
  }

  getProjection(streamId: string): TProjection | undefined {
    const row = this.database
      .prepare(
        `SELECT projection_json
         FROM ${this.config.projectionsTable}
         WHERE ${this.config.streamColumn} = ?`,
      )
      .get(streamId) as ProjectionRow | undefined;
    return row
      ? this.config.parseProjection(JSON.parse(row.projection_json))
      : undefined;
  }

  // Newest stream first, by when its first event was recorded.
  listProjections(): TProjection[] {
    const rows = this.database
      .prepare(
        `SELECT projection_json
         FROM ${this.config.projectionsTable} AS projection
         JOIN ${this.config.eventsTable} AS created_event
           ON created_event.${this.config.streamColumn} = projection.${this.config.streamColumn}
          AND created_event.sequence = 1
         ORDER BY created_event.rowid DESC`,
      )
      .all() as ProjectionRow[];
    return rows.map((row) =>
      this.config.parseProjection(JSON.parse(row.projection_json)),
    );
  }

  listEvents(streamId: string, afterSequence = 0): TEvent[] {
    const rows = this.database
      .prepare(
        `SELECT event_core_json, provider_metadata_json
         FROM ${this.config.eventsTable}
         WHERE ${this.config.streamColumn} = ? AND sequence > ?
         ORDER BY sequence ASC`,
      )
      .all(streamId, afterSequence) as StoredEventRow[];
    return rows.map((row) => this.deserialize(row));
  }

  private upsertProjection(projection: TProjection, updatedAt: string): void {
    this.database
      .prepare(
        `INSERT INTO ${this.config.projectionsTable} (
           ${this.config.streamColumn}, last_sequence, projection_json, updated_at
         ) VALUES (?, ?, ?, ?)
         ON CONFLICT(${this.config.streamColumn}) DO UPDATE SET
           last_sequence = excluded.last_sequence,
           projection_json = excluded.projection_json,
           updated_at = excluded.updated_at`,
      )
      .run(
        this.config.projectionStreamIdOf(projection),
        projection.lastSequence,
        JSON.stringify(projection),
        updatedAt,
      );
  }

  private appendWithinTransaction(input: TEvent): TProjection {
    const event = this.config.parseEvent(input);
    const streamId = this.config.streamIdOf(event);
    const existingEvent = this.readStoredEvent(event.id);
    if (existingEvent) {
      if (JSON.stringify(existingEvent) !== JSON.stringify(event)) {
        throw new EventStoreError(
          'duplicate_event',
          `Event ID ${event.id} was reused with different content.`,
        );
      }
      const existingProjection = this.getProjection(streamId);
      if (!existingProjection) {
        throw new EventStoreError(
          'projection_missing',
          `Projection for idempotent event ${event.id} is missing.`,
        );
      }
      return existingProjection;
    }

    const next = this.config.reduce(this.getProjection(streamId), event);
    const { providerMetadata, ...core } = event;
    this.database
      .prepare(
        `INSERT INTO ${this.config.eventsTable} (
           id, ${this.config.streamColumn}, sequence, type, version, occurred_at,
           recorded_at, source, event_core_json, provider_metadata_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.id,
        streamId,
        event.sequence,
        event.type,
        event.version,
        event.occurredAt,
        event.recordedAt,
        event.source,
        JSON.stringify(core),
        providerMetadata ? JSON.stringify(providerMetadata) : null,
      );
    this.upsertProjection(next, event.recordedAt);
    this.config.onAppend?.(event);
    return next;
  }

  append(input: TEvent): TProjection {
    return this.database.transaction((event: TEvent) =>
      this.appendWithinTransaction(event),
    )(input);
  }

  // Appends every event or none. Callers that need more rows in the same
  // transaction (receipts) wrap this in `database.transaction` themselves;
  // better-sqlite3 nests transactions as savepoints.
  appendMany(events: readonly TEvent[]): TProjection {
    if (events.length === 0) {
      throw new Error('appendMany requires at least one event.');
    }
    return this.database.transaction((items: readonly TEvent[]) => {
      let projection: TProjection | undefined;
      for (const event of items) {
        projection = this.appendWithinTransaction(event);
      }
      if (!projection) throw new Error('No projection was produced.');
      return projection;
    })(events);
  }

  rebuildProjection(streamId: string): TProjection {
    const events = this.listEvents(streamId);
    const projection = this.config.replay(events);
    this.upsertProjection(
      projection,
      events.at(-1)?.recordedAt ?? new Date(0).toISOString(),
    );
    return projection;
  }

  rebuildAllProjections(): TProjection[] {
    const rows = this.database
      .prepare(
        `SELECT DISTINCT ${this.config.streamColumn} AS stream_id
         FROM ${this.config.eventsTable}
         ORDER BY stream_id`,
      )
      .all() as Array<{ stream_id: string }>;
    return rows.map(({ stream_id }) => this.rebuildProjection(stream_id));
  }
}
