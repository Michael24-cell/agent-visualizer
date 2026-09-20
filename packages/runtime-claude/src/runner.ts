import {
  query,
  type CanUseTool,
  type SDKMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { AGENT_MODELS, type AgentModel } from '@harness/contracts';
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

export const sdkFrameSource: FrameSource = (input, options) =>
  query({
    prompt: input.prompt,
    options: {
      cwd: input.cwd,
      model: AGENT_MODELS[input.model].modelId,
      systemPrompt: input.systemPrompt,
      allowedTools: [...LIVE_AGENT_TOOLS],
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
    const mapper = new ClaudeMessageMapper();
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
