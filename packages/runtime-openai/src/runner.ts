import {
  permissionAsk,
  type LiveTask,
  type LiveTaskInput,
  type LiveTaskSink,
} from '@harness/runtime-claude';
import type { AgentStepIntent } from '@harness/runtime-simulated';
import { recoverToolCalls } from './tool-calls.js';
import {
  LOCAL_AGENT_TOOLS,
  documentTools,
  sdkInput,
  type ToolDefinition,
} from './tools.js';

// Runs one task on any OpenAI-compatible chat endpoint (Ollama locally,
// Groq, Gemini, OpenRouter…) with our own tool loop, and hands the service
// the same step intents the simulator and the Claude runtime produce.

export interface OpenAiRuntimeOptions {
  // e.g. http://127.0.0.1:11434/v1 for Ollama.
  readonly baseUrl: string;
  readonly apiKey?: string | undefined;
  readonly model: string;
  readonly maxTurns?: number | undefined;
  // Bounds one model turn: output tokens and wall time. Small models can
  // spiral into repetition; without these a turn never ends.
  readonly maxOutputTokens?: number | undefined;
  readonly turnTimeoutMs?: number | undefined;
  // Injectable for tests; defaults to global fetch.
  readonly fetch?: typeof fetch | undefined;
  readonly tools?: readonly ToolDefinition[] | undefined;
}

interface ToolCall {
  readonly id: string;
  readonly type: 'function';
  readonly function: { readonly name: string; readonly arguments: string };
}

interface ChatMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string | null;
  readonly tool_calls?: readonly ToolCall[];
  readonly tool_call_id?: string;
  readonly name?: string;
}

interface ChatCompletion {
  readonly choices: readonly {
    readonly message: {
      readonly content?: string | null;
      readonly tool_calls?: readonly ToolCall[];
    };
    readonly finish_reason?: string;
  }[];
  readonly error?: { readonly message?: string };
}

const SUMMARY_MAX = 600;

const NUDGE =
  'You have not called a tool yet, so nothing has changed. Do the work now by calling read_file, edit_file, write_file or run_command — one call, no prose. If the task is truly impossible, say why in one sentence.';

// Some models echo an imagined tool result back as prose; that is never
// something to show or to accept as a summary.
function stripHallucinatedResponses(content: string): string {
  return content
    .replace(/<tool_response>[\s\S]*?(<\/tool_response>|$)/g, ' ')
    .replace(/\s+\n/g, '\n')
    .trim();
}

const NUDGE_CONTINUE =
  'You described a next step but did not do it. Do it now with a tool call (write_file or run_command). Only reply without a tool call once everything is done and the tests have been run.';

// "Now I'll…", "Next, I will…": the model narrating work it has not done.
const PROMISES_MORE =
  /\b(?:now,?\s+)?(?:i'?ll|i will|let'?s|next,? i|i am going to|i'm going to)\b/i;

// Small models need telling; larger ones ignore it harmlessly.
const TOOL_GUIDANCE =
  'Use the provided tools to look at and change the project; do not guess file contents. ' +
  'Call one tool at a time and wait for its result before the next. ' +
  'To change a file: read it, then write_file its complete new contents (every line, not a fragment). Run the tests after changing code. ' +
  'When the work is done, reply with a short plain-text summary and no tool call.';
const TITLE_MAX = 80;

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function parseArguments(raw: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(raw || '{}');
    return value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

async function complete(
  options: OpenAiRuntimeOptions,
  messages: readonly ChatMessage[],
  tools: readonly ToolDefinition[],
  signal: AbortSignal,
): Promise<ChatCompletion['choices'][number]['message']> {
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.turnTimeoutMs ?? 180_000;
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = AbortSignal.any([signal, timeout]);
  const response = await doFetch(
    `${options.baseUrl.replace(/\/$/, '')}/chat/completions`,
    {
      method: 'POST',
      signal: combined,
      headers: {
        'content-type': 'application/json',
        ...(options.apiKey
          ? { authorization: `Bearer ${options.apiKey}` }
          : {}),
      },
      body: JSON.stringify({
        model: options.model,
        messages,
        tools: tools.map((tool) => ({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          },
        })),
        temperature: 0.2,
        max_tokens: options.maxOutputTokens ?? 2_048,
        stream: false,
      }),
    },
  ).catch((error: unknown) => {
    if (timeout.aborted) {
      throw new Error(
        `${options.model} gave no answer within ${Math.round(timeoutMs / 1000)}s.`,
      );
    }
    throw error;
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `${options.model} at ${options.baseUrl} answered ${response.status}${body ? `: ${clip(body, 200)}` : ''}`,
    );
  }
  const completion = (await response.json()) as ChatCompletion;
  if (completion.error?.message) throw new Error(completion.error.message);
  const message = completion.choices?.[0]?.message;
  if (!message) throw new Error('The model returned no choices.');
  return message;
}

export function runOpenAiTask(
  input: LiveTaskInput,
  sink: LiveTaskSink,
  options: OpenAiRuntimeOptions,
): LiveTask {
  const abortController = new AbortController();
  // Follow-ups from the user, appended before the next model turn.
  const inbox: string[] = [];
  let finished = false;
  const tools = [
    ...(options.tools ?? LOCAL_AGENT_TOOLS),
    ...(input.documents ? documentTools(input.documents) : []),
  ];
  const maxTurns = options.maxTurns ?? 30;
  let stopped = false;

  const emit = (intents: AgentStepIntent[]): boolean => {
    if (stopped || intents.length === 0) return !stopped;
    if (!sink.emit(intents)) {
      stopped = true;
      abortController.abort();
      return false;
    }
    return true;
  };

  // Guardrails for small models: edits need a prior read of that file,
  // and a finish after changes without any command run is labelled so.
  const readPaths = new Set<string>();
  let changedFiles = 0;
  let commandsRun = 0;
  let planEdits = 0;
  let nudges = 0;

  const done = (async () => {
    try {
      await loop();
    } finally {
      finished = true;
    }
  })();

  async function loop(): Promise<void> {
    const messages: ChatMessage[] = [
      { role: 'system', content: `${input.systemPrompt}\n\n${TOOL_GUIDANCE}` },
      { role: 'user', content: input.prompt },
    ];
    try {
      for (let turn = 0; turn < maxTurns; turn += 1) {
        if (stopped) return;
        while (inbox.length > 0) {
          messages.push({ role: 'user', content: inbox.shift()! });
        }
        const reply = await complete(
          options,
          messages,
          tools,
          abortController.signal,
        );
        let text = stripHallucinatedResponses(reply.content ?? '');
        let calls: readonly ToolCall[] = reply.tool_calls ?? [];
        if (calls.length === 0 && text) {
          const recovered = recoverToolCalls(
            text,
            tools.map((tool) => tool.name),
          );
          if (recovered.calls.length) {
            calls = recovered.calls;
            text = recovered.prose;
          }
        }
        messages.push({
          role: 'assistant',
          content: text || null,
          ...(calls.length ? { tool_calls: calls } : {}),
        });
        // The final turn's text becomes the finish message; saying it
        // first would show it twice.
        if (text && calls.length > 0 && !emit([{ kind: 'say', body: text }]))
          return;
        if (calls.length === 0 && nudges < 2) {
          const nothingHappened =
            changedFiles === 0 && commandsRun === 0 && planEdits === 0;
          const promisedMore = PROMISES_MORE.test(text);
          if (nothingHappened || promisedMore) {
            // The model drifted into prose (nothing changed and nothing
            // ran) or announced its next step and stopped. Ask it to act.
            nudges += 1;
            messages.push({
              role: 'user',
              content: nothingHappened ? NUDGE : NUDGE_CONTINUE,
            });
            continue;
          }
        }
        if (calls.length === 0) {
          const unverified = changedFiles > 0 && commandsRun === 0;
          emit([
            {
              kind: 'finish',
              reason: `${unverified ? 'Unverified — no command was run. ' : ''}${clip(text, SUMMARY_MAX) || 'Finished.'}`,
            },
          ]);
          return;
        }
        for (const call of calls) {
          if (stopped) return;
          const tool = tools.find(
            (candidate) => candidate.name === call.function.name,
          );
          const args = parseArguments(call.function.arguments);
          let result: { text: string; isError?: boolean };
          if (!tool) {
            result = {
              text: `Unknown tool ${call.function.name}.`,
              isError: true,
            };
          } else if (
            tool.sdkName === 'Edit' &&
            typeof args.path === 'string' &&
            !readPaths.has(args.path)
          ) {
            result = {
              text: `Read ${args.path} with read_file before editing it, so old_text matches the real contents.`,
              isError: true,
            };
          } else if (
            tool.needsPermission &&
            (await sink.ask(
              permissionAsk(tool.sdkName, sdkInput(tool, args)),
            )) !== 'approved'
          ) {
            emit([{ kind: 'fail', reason: `You declined: ${tool.sdkName}.` }]);
            stopped = true;
            return;
          } else {
            try {
              result = await tool.run(args, {
                cwd: input.cwd,
                signal: abortController.signal,
              });
              if (tool.sdkName === 'Read' && typeof args.path === 'string') {
                readPaths.add(args.path);
              }
              if (tool.sdkName === 'Bash') commandsRun += 1;
              if (
                (tool.name === 'update_plan_section' ||
                  tool.name === 'update_method_section') &&
                !result.isError
              ) {
                planEdits += 1;
              }
              if (
                (tool.sdkName === 'Edit' || tool.sdkName === 'Write') &&
                !result.isError
              ) {
                changedFiles += 1;
              }
            } catch (error) {
              result = {
                text: error instanceof Error ? error.message : String(error),
                isError: true,
              };
            }
          }
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            name: call.function.name,
            content: result.text,
          });
          if (tool && !emit(intentsFor(tool, args, result))) return;
        }
      }
      emit([
        {
          kind: 'fail',
          reason: `Stopped after ${maxTurns} turns without finishing.`,
        },
      ]);
    } catch (error) {
      if (!stopped) {
        emit([
          {
            kind: 'fail',
            reason: error instanceof Error ? error.message : String(error),
          },
        ]);
      }
    }
  }

  return {
    done,
    stop() {
      stopped = true;
      abortController.abort();
    },
    send(body) {
      if (stopped || finished) return false;
      inbox.push(body);
      return true;
    },
  };
}

// What one tool call leaves in the project history: shell commands are
// checks, file changes are outputs, reads are noise.
function intentsFor(
  tool: ToolDefinition,
  args: Record<string, unknown>,
  result: { text: string; isError?: boolean; diff?: string },
): AgentStepIntent[] {
  const summary = clip(result.text, SUMMARY_MAX) || '(no output)';
  switch (tool.sdkName) {
    case 'Bash': {
      const command =
        typeof args.command === 'string' ? args.command : tool.name;
      const name = clip(
        typeof args.description === 'string' && args.description
          ? args.description
          : command,
        TITLE_MAX,
      );
      return [
        result.isError
          ? { kind: 'check_fail', name, command, summary }
          : { kind: 'check_pass', name, command, summary },
      ];
    }
    case 'Read':
    case 'Grep':
    case 'Glob': {
      if (result.isError) return [];
      const lines = result.text
        .split('\n')
        .filter((line) => line.trim().length > 0).length;
      const target =
        tool.sdkName === 'Read'
          ? typeof args.path === 'string'
            ? args.path
            : 'file'
          : [args.pattern, args.glob ?? args.path]
              .filter((v): v is string => typeof v === 'string' && v.length > 0)
              .join(' in ') || tool.sdkName;
      return [
        {
          kind: 'activity',
          tool: tool.sdkName,
          target: clip(target, TITLE_MAX * 2),
          summary:
            tool.sdkName === 'Read'
              ? `${lines} ${lines === 1 ? 'line' : 'lines'}`
              : `${lines} ${lines === 1 ? 'match' : 'matches'}`,
        },
      ];
    }
    case 'Plan':
    case 'Method': {
      if (result.isError) return [];
      const section =
        typeof args.section === 'string' ? args.section : undefined;
      const label = tool.sdkName === 'Plan' ? section?.toLowerCase() : section;
      return [
        {
          kind: 'activity',
          tool: tool.sdkName,
          target: label ? `${tool.sdkName} · ${label}` : tool.sdkName,
          summary: label ? 'updated' : 'read',
        },
      ];
    }
    case 'Edit':
    case 'Write':
      if (result.isError) return [];
      return [
        {
          kind: 'output',
          outputKind: 'diff',
          title: clip(
            typeof args.path === 'string' ? args.path : 'file',
            TITLE_MAX,
          ),
          digest: summary,
          ...(typeof args.path === 'string' ? { location: args.path } : {}),
          ...(result.diff ? { diff: result.diff } : {}),
        },
      ];
    default:
      return [];
  }
}
