import { describe, expect, it } from 'vitest';
import { AGENT_MODELS } from './project.js';
import { costOf, formatRate, formatUsd, rateFor } from './model-costs.js';

describe('rateFor', () => {
  it('prices every model the agents can be set to', () => {
    for (const model of Object.values(AGENT_MODELS)) {
      expect(rateFor(model.modelId), model.modelId).toBeDefined();
    }
  });

  it('reads dated, prefixed, and mixed-case ids', () => {
    expect(rateFor('claude-haiku-4-5-20251001')?.label).toBe(
      'Claude Haiku 4.5',
    );
    expect(rateFor('anthropic/claude-opus-5')?.input).toBe(5);
    expect(rateFor('OpenAI/GPT-OSS-120B')?.provider).toBe('groq');
  });

  it('prices anything local at zero and says why', () => {
    const rate = rateFor('llama3.2:3b', 'local')!;
    expect([rate.input, rate.output]).toEqual([0, 0]);
    expect(rate.note).toMatch(/no per-token price/);
  });

  it('does not guess at a model it has never heard of', () => {
    expect(rateFor('some-new-model')).toBeUndefined();
  });
});

describe('costOf', () => {
  it('is list price, input and output each per million', () => {
    // 180K in, 12K out on Haiku: 0.18 × $1 + 0.012 × $5.
    expect(
      costOf(
        { inputTokens: 180_000, outputTokens: 12_000 },
        'claude-haiku-4-5',
      ),
    ).toBeCloseTo(0.24, 10);
    // The same work on Opus 5 is five times that.
    expect(
      costOf({ inputTokens: 180_000, outputTokens: 12_000 }, 'claude-opus-5'),
    ).toBeCloseTo(1.2, 10);
  });

  it('is unknown, not free, for an unpriced model', () => {
    expect(
      costOf({ inputTokens: 1, outputTokens: 1 }, 'mystery'),
    ).toBeUndefined();
  });
});

describe('formatting', () => {
  it('keeps small runs readable and large ones to cents', () => {
    expect(formatUsd(0)).toBe('$0');
    expect(formatUsd(0.0042)).toBe('$0.0042');
    expect(formatUsd(0.24)).toBe('$0.240');
    expect(formatUsd(12.345)).toBe('$12.35');
  });

  it('shows a rate the way the model picker needs it', () => {
    expect(formatRate(rateFor('claude-haiku-4-5')!)).toBe('$1 / $5 per M');
    expect(formatRate(rateFor('openai/gpt-oss-120b')!)).toBe(
      '$0.15 / $0.6 per M',
    );
    expect(formatRate(rateFor('x', 'local')!)).toBe('free · local');
  });
});
