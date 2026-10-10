import type { z } from 'zod';
import type { UsageProviderSchema } from './project.js';

// What a model costs per token, in US dollars, at list price. No cache,
// batch, or plan discounts: the number answers "what did this work use",
// not "what will the invoice say". Rates change, so the table carries the
// date it was read and where each number came from.

export const RATES_READ_ON = '2026-10-09';

export type RateProvider = z.infer<typeof UsageProviderSchema>;

export interface ModelRate {
  readonly provider: RateProvider;
  readonly label: string;
  // US dollars per million tokens.
  readonly input: number;
  readonly output: number;
  // Where the number came from; 'third-party' means the provider's own
  // page could not be read and the rate is from price trackers.
  readonly source: 'provider' | 'third-party' | 'none';
  readonly note?: string;
}

const anthropic = (
  label: string,
  input: number,
  output: number,
): ModelRate => ({
  provider: 'anthropic',
  label,
  input,
  output,
  source: 'provider',
});

const openai = (label: string, input: number, output: number): ModelRate => ({
  provider: 'openai',
  label,
  input,
  output,
  source: 'provider',
});

// Keys are the model ids the runtimes send. Lookups also try the id with a
// trailing date stripped and with a provider prefix removed (see rateFor).
export const MODEL_RATES: Readonly<Record<string, ModelRate>> = {
  // Anthropic — first-party API list prices.
  'claude-fable-5-1': anthropic('Claude Fable 5.1', 10, 50),
  'claude-fable-5': anthropic('Claude Fable 5', 10, 50),
  'claude-opus-5-5': anthropic('Claude Opus 5.5', 4, 20),
  'claude-opus-5': anthropic('Claude Opus 5', 5, 25),
  'claude-opus-4-8': anthropic('Claude Opus 4.8', 5, 25),
  'claude-opus-4-7': anthropic('Claude Opus 4.7', 5, 25),
  'claude-opus-4-6': anthropic('Claude Opus 4.6', 5, 25),
  'claude-sonnet-5': anthropic('Claude Sonnet 5', 2, 10),
  'claude-sonnet-4-6': anthropic('Claude Sonnet 4.6', 3, 15),
  'claude-haiku-4-5': anthropic('Claude Haiku 4.5', 1, 5),

  // OpenAI — standard tier, short context (≤272K input).
  'gpt-6-astra': openai('GPT-6 Astra', 10, 50),
  'gpt-6.1-sol': openai('GPT-6.1 Sol', 2, 10),
  'gpt-6-sol': openai('GPT-6 Sol', 2, 10),
  'gpt-6-luna': openai('GPT-6 Luna', 0.1, 0.5),
  'gpt-5.6-sol': openai('GPT-5.6 Sol', 4, 20),
  'gpt-5.6-terra': openai('GPT-5.6 Terra', 2, 12),
  'gpt-5.6-luna': openai('GPT-5.6 Luna', 0.2, 1.2),
  'gpt-5.5': openai('GPT-5.5', 5, 30),
  'gpt-5.4': openai('GPT-5.4', 2.5, 15),
  'gpt-5.4-mini': openai('GPT-5.4 mini', 0.75, 4.5),
  'gpt-5.4-nano': openai('GPT-5.4 nano', 0.2, 1.25),
  'gpt-5.3-codex': openai('GPT-5.3 Codex', 1.75, 14),
  'gpt-5.2': openai('GPT-5.2', 1.75, 14),
  'gpt-5.1': openai('GPT-5.1', 1.25, 10),
  'gpt-5': openai('GPT-5', 1.25, 10),
  'gpt-5-mini': openai('GPT-5 mini', 0.25, 2),
  'gpt-5-nano': openai('GPT-5 nano', 0.05, 0.4),
  'gpt-4.1': openai('GPT-4.1', 2, 8),
  'gpt-4.1-mini': openai('GPT-4.1 mini', 0.4, 1.6),
  'gpt-4.1-nano': openai('GPT-4.1 nano', 0.1, 0.4),
  'gpt-4o': openai('GPT-4o', 2.5, 10),
  'gpt-4o-mini': openai('GPT-4o mini', 0.15, 0.6),
  o3: openai('o3', 2, 8),
  'o4-mini': openai('o4-mini', 1.1, 4.4),
  'o3-mini': openai('o3-mini', 1.1, 4.4),
  o1: openai('o1', 15, 60),

  // What this project runs on today. Groq's own page could not be read;
  // the rate is the paid-tier price trackers agree on. The free tier we
  // use bills nothing, so this is what the same work would cost on paid.
  'openai/gpt-oss-120b': {
    provider: 'groq',
    label: 'gpt-oss-120b (Groq)',
    input: 0.15,
    output: 0.6,
    source: 'third-party',
    note: 'Free tier bills $0; this is the paid-tier rate.',
  },
};

// A model on your own machine has no per-token price. Its real cost is
// electricity and hardware, which tokens do not measure.
export const LOCAL_RATE: ModelRate = {
  provider: 'local',
  label: 'Local model',
  input: 0,
  output: 0,
  source: 'none',
  note: 'Runs on your machine; no per-token price.',
};

// Ids arrive in several spellings: dated snapshots
// (claude-haiku-4-5-20251001), provider-prefixed (anthropic/claude-opus-5),
// or Ollama tags (llama3.2:3b). Try them in order of how specific they are.
// Work run through Sign in with ChatGPT counts against the plan's
// allowance; there is no per-token bill to show.
export const CHATGPT_PLAN_RATE: ModelRate = {
  provider: 'chatgpt',
  label: 'ChatGPT plan',
  input: 0,
  output: 0,
  source: 'none',
  note: 'Counts against your ChatGPT plan, not billed per token.',
};

export function rateFor(
  modelId: string,
  provider?: RateProvider,
): ModelRate | undefined {
  if (provider === 'local') return LOCAL_RATE;
  if (provider === 'chatgpt') return CHATGPT_PLAN_RATE;
  const id = modelId.trim().toLowerCase();
  const undated = id.replace(/-\d{8}$/, '');
  const bare = undated.includes('/') ? undated.split('/').pop()! : undated;
  return MODEL_RATES[id] ?? MODEL_RATES[undated] ?? MODEL_RATES[bare];
}

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

// Dollars for one piece of work at list price, or undefined when the model
// is not in the table — an unknown cost is shown as unknown, never as $0.
export function costOf(
  usage: TokenUsage,
  modelId: string,
  provider?: RateProvider,
): number | undefined {
  const rate = rateFor(modelId, provider);
  if (!rate) return undefined;
  return (
    (usage.inputTokens * rate.input + usage.outputTokens * rate.output) /
    1_000_000
  );
}

// $0.0042 reads better than $0.00 for small runs; large ones round to cents.
export function formatUsd(amount: number): string {
  if (amount === 0) return '$0';
  if (amount < 0.01) return `$${amount.toPrecision(2)}`;
  if (amount < 1) return `$${amount.toFixed(3)}`;
  return `$${amount.toFixed(2)}`;
}

// "$1 / $5 per M" — what the model picker shows beside a model's name.
export function formatRate(rate: ModelRate): string {
  if (rate.provider === 'local') return 'free · local';
  if (rate.provider === 'chatgpt') return 'ChatGPT plan';
  const n = (value: number) =>
    value < 1
      ? `$${value}`
      : `$${Number.isInteger(value) ? value : value.toFixed(2)}`;
  return `${n(rate.input)} / ${n(rate.output)} per M`;
}
