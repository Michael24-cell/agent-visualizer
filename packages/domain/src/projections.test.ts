import { describe, expect, it } from 'vitest';
import {
  DomainEventSchema,
  PlanVersionIdSchema,
  RunIdSchema,
  RunSchema,
  UnsupportedEventVersionError,
  parseDomainEvent,
} from '@harness/contracts';
import { ProjectionError, applyDomainEvent } from './projections.js';
import { TransitionError } from './transitions.js';

const runId = RunIdSchema.parse('run_projection-policy');
const planVersionId = PlanVersionIdSchema.parse('planv_projection-policy');
const createdAt = '2026-01-01T00:00:00.000Z';

const run = RunSchema.parse({
  id: runId,
  planVersionId,
  goal: 'Exercise projection policies.',
  state: 'draft',
  createdAt,
});

function runEvent(
  sequence: number,
  type: 'run.created' | 'run.state_changed',
  payload: unknown,
) {
  return DomainEventSchema.parse({
    id: `event_projection_${sequence}`,
    type,
    version: 1,
    sequence,
    occurredAt: createdAt,
    recordedAt: createdAt,
    runId,
    source: 'orchestrator',
    payload,
  });
}

describe('run projection policy', () => {
  it('applies the same event idempotently', () => {
    const event = runEvent(1, 'run.created', { run });
    const projection = applyDomainEvent(undefined, event);
    expect(applyDomainEvent(projection, event)).toBe(projection);
  });

  it('rejects sequence collisions and gaps', () => {
    const projection = applyDomainEvent(
      undefined,
      runEvent(1, 'run.created', { run }),
    );
    expect(() =>
      applyDomainEvent(
        projection,
        DomainEventSchema.parse({
          ...runEvent(1, 'run.created', { run }),
          id: 'event_projection_collision',
        }),
      ),
    ).toThrowError(
      expect.objectContaining<Partial<ProjectionError>>({
        code: 'sequence_collision',
      }),
    );
    expect(() =>
      applyDomainEvent(
        projection,
        runEvent(3, 'run.state_changed', {
          from: 'draft',
          to: 'planned',
          reason: 'Skipped a sequence.',
        }),
      ),
    ).toThrowError(
      expect.objectContaining<Partial<ProjectionError>>({
        code: 'sequence_gap',
      }),
    );
  });

  it('rejects invalid and repeated terminal transitions', () => {
    const draft = applyDomainEvent(
      undefined,
      runEvent(1, 'run.created', { run }),
    );
    expect(() =>
      applyDomainEvent(
        draft,
        runEvent(2, 'run.state_changed', {
          from: 'draft',
          to: 'verifying',
          reason: 'Invalid jump.',
        }),
      ),
    ).toThrowError(
      expect.objectContaining<Partial<TransitionError>>({
        code: 'invalid_transition',
      }),
    );

    const cancelled = applyDomainEvent(
      draft,
      runEvent(2, 'run.state_changed', {
        from: 'draft',
        to: 'cancelled',
        reason: 'User cancelled.',
      }),
    );
    expect(() =>
      applyDomainEvent(
        cancelled,
        runEvent(3, 'run.state_changed', {
          from: 'cancelled',
          to: 'cancelled',
          reason: 'Duplicate terminal event.',
        }),
      ),
    ).toThrowError(
      expect.objectContaining<Partial<TransitionError>>({
        code: 'terminal_state',
      }),
    );
  });

  it('rejects unsupported stored event versions explicitly', () => {
    expect(() =>
      parseDomainEvent({
        ...runEvent(1, 'run.created', { run }),
        version: 2,
      }),
    ).toThrowError(UnsupportedEventVersionError);
  });

  it('rejects an entity whose run identity disagrees with its event', () => {
    const mismatchedRun = RunSchema.parse({
      ...run,
      id: RunIdSchema.parse('run_another-run'),
    });
    expect(() =>
      applyDomainEvent(
        undefined,
        runEvent(1, 'run.created', { run: mismatchedRun }),
      ),
    ).toThrowError(
      expect.objectContaining<Partial<ProjectionError>>({
        code: 'run_mismatch',
      }),
    );
  });
});
