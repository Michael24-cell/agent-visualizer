import { describe, expect, it } from 'vitest';
import {
  TransitionError,
  assertAgentTransition,
  assertRunTransition,
  assertTaskTransition,
} from './transitions.js';

describe('transition policies', () => {
  it('accepts explicit lifecycle transitions', () => {
    expect(() => assertRunTransition('draft', 'planned')).not.toThrow();
    expect(() => assertTaskTransition('running', 'validating')).not.toThrow();
    expect(() => assertAgentTransition('disconnected', 'active')).not.toThrow();
  });

  it('rejects invalid transitions without mutating state', () => {
    expect(() => assertTaskTransition('proposed', 'completed')).toThrowError(
      expect.objectContaining<Partial<TransitionError>>({
        code: 'invalid_transition',
        entity: 'task',
      }),
    );
  });

  it('rejects a second terminal transition', () => {
    expect(() => assertRunTransition('completed', 'completed')).toThrowError(
      expect.objectContaining<Partial<TransitionError>>({
        code: 'terminal_state',
        entity: 'run',
      }),
    );
  });
});
