import type Database from 'better-sqlite3';
import {
  CommandReceiptSchema,
  MessageSchema,
  ProjectIdSchema,
  parseProjectEvent,
  type CommandReceipt,
  type Message,
  type MessagesPage,
  type ProjectEvent,
  type ProjectId,
} from '@harness/contracts';
import {
  ProjectProjectionSchema,
  applyProjectEvent,
  replayProjectEvents,
  type ProjectProjection,
} from '@harness/domain';
import { SqliteStreamStore } from './stream-store.js';

interface MessageRow {
  readonly message_json: string;
}

interface ReceiptRow {
  readonly command_id: string;
  readonly project_id: string;
  readonly first_sequence: number;
  readonly last_sequence: number;
  readonly created_ids_json: string;
}

export interface StoredReceipt {
  readonly projectId: ProjectId;
  readonly receipt: CommandReceipt;
}

export interface MessageWindow {
  readonly before?: number | undefined;
  readonly after?: number | undefined;
  readonly limit: number;
}

// Project stream plus the two side tables that must move with it: messages
// (read by cursor, never through the projection) and command receipts
// (idempotent retries). All three are written inside one transaction.
export class SqliteProjectStore {
  private readonly stream: SqliteStreamStore<ProjectEvent, ProjectProjection>;

  constructor(readonly database: Database.Database) {
    this.stream = new SqliteStreamStore<ProjectEvent, ProjectProjection>(
      database,
      {
        eventsTable: 'project_events',
        projectionsTable: 'project_projections',
        streamColumn: 'project_id',
        streamIdOf: (event) => event.projectId,
        projectionStreamIdOf: (projection) => projection.projectId,
        parseEvent: parseProjectEvent,
        parseProjection: (input) => ProjectProjectionSchema.parse(input),
        reduce: applyProjectEvent,
        replay: replayProjectEvents,
        onAppend: (event) => {
          if (event.type === 'message.posted') {
            this.insertMessage(event.payload.message);
          }
        },
      },
    );
  }

  // Runs `work` atomically. Nested calls become savepoints.
  transaction<T>(work: () => T): T {
    return this.database.transaction(work)();
  }

  getProjection(projectId: ProjectId): ProjectProjection | undefined {
    return this.stream.getProjection(ProjectIdSchema.parse(projectId));
  }

  listProjections(): ProjectProjection[] {
    return this.stream.listProjections();
  }

  listEvents(projectId: ProjectId, afterSequence = 0): ProjectEvent[] {
    return this.stream.listEvents(
      ProjectIdSchema.parse(projectId),
      afterSequence,
    );
  }

  appendMany(events: readonly ProjectEvent[]): ProjectProjection {
    return this.stream.appendMany(events);
  }

  // Removes a project and everything recorded for it, in one transaction.
  // The only way rows leave the append-only tables. Returns false when
  // there was no such project.
  deleteProject(projectId: ProjectId): boolean {
    const id = ProjectIdSchema.parse(projectId);
    return this.transaction(() => {
      if (!this.getProjection(id)) return false;
      const db = this.database;
      db.prepare('INSERT INTO project_purges (project_id) VALUES (?)').run(id);
      db.prepare('DELETE FROM messages WHERE project_id = ?').run(id);
      db.prepare('DELETE FROM project_events WHERE project_id = ?').run(id);
      db.prepare('DELETE FROM project_projections WHERE project_id = ?').run(
        id,
      );
      db.prepare('DELETE FROM command_receipts WHERE project_id = ?').run(id);
      db.prepare('DELETE FROM project_purges WHERE project_id = ?').run(id);
      return true;
    });
  }

  rebuildAllProjections(): ProjectProjection[] {
    return this.stream.rebuildAllProjections();
  }

  private insertMessage(message: Message): void {
    this.database
      .prepare(
        `INSERT INTO messages (id, project_id, thread_id, sequence, message_json)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        message.id,
        message.projectId,
        message.threadId,
        message.sequence,
        JSON.stringify(message),
      );
  }

  // Latest page by default; `before` walks older, `after` walks newer.
  // Messages are always returned oldest → newest. Cursors are sequences,
  // so a page never repeats or skips a message.
  listMessages(threadId: string, window: MessageWindow): MessagesPage {
    const limit = window.limit;
    let rows: MessageRow[];
    if (window.after !== undefined) {
      rows = this.database
        .prepare(
          `SELECT message_json FROM messages
           WHERE thread_id = ? AND sequence > ?
           ORDER BY sequence ASC LIMIT ?`,
        )
        .all(threadId, window.after, limit) as MessageRow[];
    } else {
      const before = window.before ?? Number.MAX_SAFE_INTEGER;
      rows = (
        this.database
          .prepare(
            `SELECT message_json FROM messages
             WHERE thread_id = ? AND sequence < ?
             ORDER BY sequence DESC LIMIT ?`,
          )
          .all(threadId, before, limit) as MessageRow[]
      ).reverse();
    }
    const messages = rows.map((row) =>
      MessageSchema.parse(JSON.parse(row.message_json)),
    );
    const oldest = messages[0]?.sequence;
    const hasOlder =
      oldest !== undefined &&
      (this.database
        .prepare(
          `SELECT 1 FROM messages WHERE thread_id = ? AND sequence < ? LIMIT 1`,
        )
        .get(threadId, oldest) as unknown) !== undefined;
    const newest = messages.at(-1)?.sequence ?? window.after ?? 0;
    return {
      messages,
      ...(hasOlder && oldest !== undefined ? { olderCursor: oldest } : {}),
      newerCursor: newest,
    };
  }

  getReceipt(commandId: string): StoredReceipt | undefined {
    const row = this.database
      .prepare(
        `SELECT command_id, project_id, first_sequence, last_sequence, created_ids_json
         FROM command_receipts WHERE command_id = ?`,
      )
      .get(commandId) as ReceiptRow | undefined;
    if (!row) return undefined;
    return {
      projectId: ProjectIdSchema.parse(row.project_id),
      receipt: CommandReceiptSchema.parse({
        commandId: row.command_id,
        firstSequence: row.first_sequence,
        lastSequence: row.last_sequence,
        createdIds: JSON.parse(row.created_ids_json),
        replayed: true,
      }),
    };
  }

  saveReceipt(
    projectId: ProjectId,
    receipt: CommandReceipt,
    recordedAt: string,
  ): void {
    this.database
      .prepare(
        `INSERT INTO command_receipts (
           command_id, project_id, first_sequence, last_sequence,
           created_ids_json, recorded_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        receipt.commandId,
        projectId,
        receipt.firstSequence,
        receipt.lastSequence,
        JSON.stringify(receipt.createdIds),
        recordedAt,
      );
  }
}
