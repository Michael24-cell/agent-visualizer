import {
  permissionAsk,
  type LiveTask,
  type LiveTaskInput,
  type LiveTaskSink,
} from '@harness/runtime-claude';
import type { AgentStepIntent } from '@harness/runtime-simulated';
import { LOCAL_AGENT_TOOLS, sdkInput, type ToolDefinition } from './tools.js';

// Runs one task on any OpenAI-compatible chat endpoint (Ollama locally,
// Groq, Gemini, OpenRouter…) with our own tool loop, and hands the service
// the same step intents the simulator and the Claude runtime produce.

export interface OpenAiRuntimeOptions {
  // e.g. http://127.0.0.1:11434/v1 for Ollama.
  readonly baseUrl: string;
  readonly apiKey?: string | undefined;
  readonly model: string;
  readonly maxTurns?: number | undefined;
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
  const response = await doFetch(
    `${options.baseUrl.replace(/\/$/, '')}/chat/completions`,
    {
      method: 'POST',
      signal,
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
        stream: false,
      }),
    },
  );
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
  const tools = options.tools ?? LOCAL_AGENT_TOOLS;
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

  const done = (async () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: input.systemPrompt },
      { role: 'user', content: input.prompt },
    ];
    try {
      for (let turn = 0; turn < maxTurns; turn += 1) {
        if (stopped) return;
        const reply = await complete(
          options,
          messages,
          tools,
          abortController.signal,
        );
        const text = (reply.content ?? '').trim();
        const calls = reply.tool_calls ?? [];
        messages.push({
          role: 'assistant',
          content: reply.content ?? null,
          ...(calls.length ? { tool_calls: calls } : {}),
        });
        if (text && !emit([{ kind: 'say', body: text }])) return;
        if (calls.length === 0) {
          emit([
            { kind: 'finish', reason: clip(text, SUMMARY_MAX) || 'Finished.' },
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
  })();

  return {
    done,
    stop() {
      stopped = true;
      abortController.abort();
    },
  };
}

// What one tool call leaves in the project history: shell commands are
// checks, file changes are outputs, reads are noise.
function intentsFor(
  tool: ToolDefinition,
  args: Record<string, unknown>,
  result: { text: string; isError?: boolean },
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
        },
      ];
    default:
      return [];
  }
}
