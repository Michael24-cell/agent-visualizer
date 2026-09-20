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
import { SqliteStreamStore } from './stream-store.js';

export { EventStoreError } from './stream-store.js';

// The run stream (Increments 1–2). Kept as the compatibility path for the
// demo run and simulated scenarios; new work uses SqliteProjectStore.
export class SqliteEventStore implements DomainEventSink {
  private readonly stream: SqliteStreamStore<DomainEvent, RunProjection>;

  constructor(database: Database.Database) {
    this.stream = new SqliteStreamStore<DomainEvent, RunProjection>(database, {
      eventsTable: 'events',
      projectionsTable: 'run_projections',
      streamColumn: 'run_id',
      streamIdOf: (event) => event.runId,
      projectionStreamIdOf: (projection) => projection.runId,
      parseEvent: parseDomainEvent,
      parseProjection: (input) => RunProjectionSchema.parse(input),
      reduce: applyDomainEvent,
      replay: replayDomainEvents,
    });
  }

  getProjection(runId: RunId): RunProjection | undefined {
    return this.stream.getProjection(RunIdSchema.parse(runId));
  }

  listProjections(): RunProjection[] {
    return this.stream.listProjections();
  }

  append(input: DomainEvent): RunProjection {
    return this.stream.append(input);
  }

  appendMany(events: readonly DomainEvent[]): RunProjection {
    return this.stream.appendMany(events);
  }

  listEvents(runId: RunId): DomainEvent[] {
    return this.stream.listEvents(RunIdSchema.parse(runId));
  }

  rebuildProjection(runId: RunId): RunProjection {
    return this.stream.rebuildProjection(RunIdSchema.parse(runId));
  }

  rebuildAllProjections(): RunProjection[] {
    return this.stream.rebuildAllProjections();
  }
}
