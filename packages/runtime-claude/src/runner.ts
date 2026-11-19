import {
  query,
  type CanUseTool,
  type SDKMessage,
} from '@anthropic-ai/claude-agent-sdk';
import {
  AGENT_MODELS,
  type AgentModel,
  type ToolPolicy,
} from '@harness/contracts';
import type { AgentStepIntent } from '@harness/runtime-simulated';
import { ClaudeMessageMapper, permissionAsk } from './mapper.js';

// Runs one task on a live Claude agent and hands the service the same
// step intents the simulator produces. The service owns persistence and
// decides whether each batch may still land (the task could have been
// stopped); this module owns the SDK session and its permission pause.

export type AskIntent = Extract<AgentStepIntent, { kind: 'ask' }>;

export interface LiveTaskInput {
  // Where the agent works. Every tool runs inside this folder.
  readonly cwd: string;
  readonly model: AgentModel;
  readonly systemPrompt: string;
  readonly prompt: string;
  readonly maxTurns?: number;
  // The project's documents, when the runtime can offer them as tools.
  readonly documents?: ProjectDocuments | undefined;
  // The Method's tool policy for this task, when one is pinned.
  readonly tools?: ToolPolicy | undefined;
  // For OpenAI-compatible runtimes: the model id to use for this task,
  // overriding the runtime's configured model.
  readonly endpointModel?: string | undefined;
}

// What an agent may do with the Plan document: read it whole, or replace
// one section. Edits land as the same event the user's edits do.
export interface DocumentSections {
  readonly sections: { id: string; title: string; lines: string[] }[];
}

export interface ProjectDocuments {
  readPlan(): DocumentSections;
  updatePlanSection(sectionId: string, lines: string[]): Promise<string>;
  // Absent when no Method is applied to the project.
  readMethod?: (() => DocumentSections & { title: string }) | undefined;
  updateMethodSection?:
    ((sectionId: string, lines: string[]) => Promise<string>) | undefined;
}

export interface LiveTaskSink {
  // One batch of intents from one SDK frame. Return false once the task
  // can no longer accept work (stopped or failed) and the run is aborted.
  emit(intents: readonly AgentStepIntent[]): boolean;
  // The SDK wants to use a tool that needs permission. Resolves with the
  // user's decision; the run waits in the meantime.
  ask(ask: AskIntent): Promise<'approved' | 'denied'>;
}

export interface LiveTask {
  readonly done: Promise<void>;
  stop(): void;
  // Hands the running agent a follow-up from the user, delivered before
  // its next model turn. Returns false when this runtime cannot forward.
  send?: (body: string) => boolean;
}

export interface FrameSourceOptions {
  readonly canUseTool: CanUseTool;
  readonly abortController: AbortController;
}

// Produces SDK frames for a task. The default talks to the SDK; tests
// substitute a generator of fake frames that calls canUseTool themselves.
export type FrameSource = (
  input: LiveTaskInput,
  options: FrameSourceOptions,
) => AsyncIterable<SDKMessage>;

// Tools a live agent may use. Read-only tools run without asking; the
// SDK routes Bash and file writes through canUseTool first.
export const LIVE_AGENT_TOOLS: readonly string[] = [
  'Read',
  'Grep',
  'Glob',
  'Bash',
  'Edit',
  'Write',
  'MultiEdit',
];

// Documents only: no shell, no edits; Write stays and the Method's hard
// rules name the file types (the SDK cannot filter by extension here).
export const LIVE_AGENT_TOOLS_DOCS: readonly string[] = [
  'Read',
  'Grep',
  'Glob',
  'Write',
];

export const sdkFrameSource: FrameSource = (input, options) =>
  query({
    prompt: input.prompt,
    options: {
      cwd: input.cwd,
      model: AGENT_MODELS[input.model].modelId,
      systemPrompt: input.systemPrompt,
      allowedTools: [
        ...(input.tools === 'docs' ? LIVE_AGENT_TOOLS_DOCS : LIVE_AGENT_TOOLS),
      ],
      permissionMode: 'default',
      canUseTool: options.canUseTool,
      abortController: options.abortController,
      maxTurns: input.maxTurns ?? 40,
      // The harness keeps its own history; nothing lands in ~/.claude.
      persistSession: false,
      settingSources: [],
    },
  });

export function runLiveTask(
  input: LiveTaskInput,
  sink: LiveTaskSink,
  source: FrameSource = sdkFrameSource,
): LiveTask {
  const abortController = new AbortController();
  let stopped = false;

  const canUseTool: CanUseTool = async (toolName, toolInput) => {
    if (stopped)
      return { behavior: 'deny', message: 'Stopped.', interrupt: true };
    const decision = await sink.ask(permissionAsk(toolName, toolInput));
    if (decision === 'approved') return { behavior: 'allow' };
    return {
      behavior: 'deny',
      message: 'The user declined this action.',
      interrupt: true,
    };
  };

  const done = (async () => {
    const mapper = new ClaudeMessageMapper(input.cwd);
    try {
      for await (const frame of source(input, {
        canUseTool,
        abortController,
      })) {
        if (stopped) break;
        const intents = mapper.map(frame);
        if (intents.length === 0) continue;
        if (!sink.emit(intents)) {
          stopped = true;
          abortController.abort();
          break;
        }
      }
      if (!stopped && !mapper.isFinished) {
        sink.emit([
          {
            kind: 'fail',
            reason: 'The agent ended without reporting a result.',
          },
        ]);
      }
    } catch (error) {
      if (!stopped) {
        sink.emit([
          {
            kind: 'fail',
            reason: error instanceof Error ? error.message : String(error),
          },
        ]);
      }
    }
  })();

  return {
    done,
    stop() {
      stopped = true;
      abortController.abort();
    },
  };
}

// One plain question and answer on Claude, no tools and one turn: what
// the planner uses to ask for a plan. Nothing is written to ~/.claude.
export async function completeTextClaude(
  model: AgentModel,
  system: string,
  user: string,
  signal: AbortSignal = new AbortController().signal,
): Promise<{
  text: string;
  usage: { inputTokens: number; outputTokens: number } | undefined;
}> {
  const abortController = new AbortController();
  signal.addEventListener('abort', () => abortController.abort(), {
    once: true,
  });
  for await (const message of query({
    prompt: user,
    options: {
      model: AGENT_MODELS[model].modelId,
      systemPrompt: system,
      allowedTools: [],
      tools: [],
      maxTurns: 1,
      abortController,
      persistSession: false,
      settingSources: [],
    },
  })) {
    if (message.type !== 'result') continue;
    if (message.subtype !== 'success' || message.is_error) {
      throw new Error(`Claude did not answer (${message.subtype}).`);
    }
    let inputTokens = 0;
    let outputTokens = 0;
    for (const totals of Object.values(message.modelUsage ?? {})) {
      inputTokens +=
        (totals.inputTokens ?? 0) +
        (totals.cacheReadInputTokens ?? 0) +
        (totals.cacheCreationInputTokens ?? 0);
      outputTokens += totals.outputTokens ?? 0;
    }
    return {
      text: message.result.trim(),
      usage:
        inputTokens || outputTokens ? { inputTokens, outputTokens } : undefined,
    };
  }
  throw new Error('Claude ended without an answer.');
}
