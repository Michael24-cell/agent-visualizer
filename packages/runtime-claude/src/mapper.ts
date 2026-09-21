import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AdapterProvenanceSchema } from '@harness/contracts';
import type { AgentStepIntent } from '@harness/runtime-simulated';
import type { z } from 'zod';

// Turns the Claude Agent SDK's message stream into the same step intents
// the simulator produces, so the service materializes live work and
// simulated work through one path. Everything here is pure and keyed only
// on message shape: tests feed plain objects, no key and no network.

export const CLAUDE_AGENT_ADAPTER: z.infer<typeof AdapterProvenanceSchema> = {
  id: 'claude-agent-sdk',
  version: '0.3',
  mode: 'live',
};

const SUMMARY_MAX = 600;
const TITLE_MAX = 80;

// Tools whose results are evidence worth recording. Read-only tools
// (Read, Grep, Glob, WebFetch…) are noise in a project history and stay
// in the SDK transcript only.
const CHECK_TOOLS = new Set(['Bash']);
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const READ_TOOLS: Record<string, 'Read' | 'Grep' | 'Glob'> = {
  Read: 'Read',
  Grep: 'Grep',
  Glob: 'Glob',
};

interface PendingToolUse {
  readonly id: string;
  readonly name: string;
  readonly input: Record<string, unknown>;
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function nonEmpty(text: string, fallback: string): string {
  const clipped = clip(text, SUMMARY_MAX);
  return clipped.length > 0 ? clipped : fallback;
}

function stringOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value
    : undefined;
}

// The text of a tool_result block, whether the SDK sent a string or blocks.
function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block: unknown) =>
      block && typeof block === 'object' && 'text' in block
        ? String((block as { text: unknown }).text)
        : '',
    )
    .join('\n');
}

function commandLabel(input: Record<string, unknown>): string {
  const description = stringOf(input.description);
  if (description) return clip(description, TITLE_MAX);
  const command = stringOf(input.command) ?? 'command';
  return clip(command, TITLE_MAX);
}

function rawPath(input: Record<string, unknown>): string | undefined {
  return (
    stringOf(input.file_path) ??
    stringOf(input.notebook_path) ??
    stringOf(input.path)
  );
}

function pathLabel(input: Record<string, unknown>): string {
  const path =
    stringOf(input.file_path) ??
    stringOf(input.notebook_path) ??
    stringOf(input.path) ??
    'file';
  return clip(path, TITLE_MAX);
}

// Tracks tool_use blocks until their tool_result arrives so a check or an
// output is recorded once, with both the call and its outcome.
export class ClaudeMessageMapper {
  private readonly pending = new Map<string, PendingToolUse>();
  private finished = false;
  private lastSaid = '';

  // The task folder, so file outputs carry a path relative to it.
  constructor(private readonly cwd?: string) {}

  get isFinished(): boolean {
    return this.finished;
  }

  map(message: SDKMessage): AgentStepIntent[] {
    switch (message.type) {
      case 'assistant':
        return this.mapAssistant(message);
      case 'user':
        return this.mapUser(message);
      case 'result':
        return this.mapResult(message);
      case 'system':
        return message.subtype === 'permission_denied'
          ? [
              {
                kind: 'say',
                body: `Permission denied for ${message.tool_name}; continuing without it.`,
              },
            ]
          : [];
      default:
        return [];
    }
  }

  private mapAssistant(
    message: Extract<SDKMessage, { type: 'assistant' }>,
  ): AgentStepIntent[] {
    // Subagent frames are internal to the SDK's own Task tool.
    if (message.parent_tool_use_id) return [];
    const intents: AgentStepIntent[] = [];
    for (const block of message.message.content) {
      if (block.type === 'text') {
        const body = block.text.trim();
        if (body.length > 0) {
          intents.push({ kind: 'say', body });
          this.lastSaid = body;
        }
      } else if (block.type === 'tool_use') {
        this.pending.set(block.id, {
          id: block.id,
          name: block.name,
          input:
            block.input && typeof block.input === 'object'
              ? (block.input as Record<string, unknown>)
              : {},
        });
      }
    }
    return intents;
  }

  private mapUser(
    message: Extract<SDKMessage, { type: 'user' }>,
  ): AgentStepIntent[] {
    if (message.parent_tool_use_id) return [];
    const content = message.message.content;
    if (!Array.isArray(content)) return [];
    const intents: AgentStepIntent[] = [];
    for (const block of content) {
      if (block.type !== 'tool_result') continue;
      const call = this.pending.get(block.tool_use_id);
      if (!call) continue;
      this.pending.delete(block.tool_use_id);
      const text = resultText(block.content);
      const failed = block.is_error === true;
      if (CHECK_TOOLS.has(call.name)) {
        const command = stringOf(call.input.command) ?? call.name;
        intents.push(
          failed
            ? {
                kind: 'check_fail',
                name: commandLabel(call.input),
                command,
                summary: nonEmpty(text, 'Command failed with no output.'),
              }
            : {
                kind: 'check_pass',
                name: commandLabel(call.input),
                command,
                summary: nonEmpty(text, 'Command completed with no output.'),
              },
        );
      } else if (WRITE_TOOLS.has(call.name) && !failed) {
        const location = this.relative(rawPath(call.input));
        intents.push({
          kind: 'output',
          outputKind: 'diff',
          title: location ? clip(location, TITLE_MAX) : pathLabel(call.input),
          digest: nonEmpty(text, `${call.name} applied.`),
          ...(location ? { location } : {}),
        });
      } else if (READ_TOOLS[call.name] && !failed) {
        intents.push({
          kind: 'activity',
          tool: READ_TOOLS[call.name]!,
          target: readTarget(call.name, call.input),
          summary: readSummary(call.name, text),
        });
      }
    }
    return intents;
  }

  private relative(path: string | undefined): string | undefined {
    if (!path) return undefined;
    if (!this.cwd) return path;
    const root = this.cwd.endsWith('/') ? this.cwd : `${this.cwd}/`;
    return path.startsWith(root) ? path.slice(root.length) : path;
  }

  private mapResult(
    message: Extract<SDKMessage, { type: 'result' }>,
  ): AgentStepIntent[] {
    this.finished = true;
    if (message.subtype === 'success' && !message.is_error) {
      const reason = nonEmpty(message.result, 'Finished.');
      return [
        {
          kind: 'finish',
          reason,
          // The SDK's result repeats the last assistant text.
          alreadySaid: message.result.trim() === this.lastSaid,
        },
      ];
    }
    const detail =
      'errors' in message && Array.isArray(message.errors)
        ? message.errors.map(String).join('; ')
        : message.subtype === 'success'
          ? message.result
          : message.subtype.replaceAll('_', ' ');
    return [
      {
        kind: 'fail',
        reason: nonEmpty(detail, 'The agent stopped with an error.'),
      },
    ];
  }
}

function readTarget(tool: string, input: Record<string, unknown>): string {
  if (tool === 'Read') return pathLabel(input);
  const pattern = stringOf(input.pattern) ?? '';
  const path = stringOf(input.path) ?? stringOf(input.glob) ?? '';
  return clip(
    [pattern, path].filter(Boolean).join(' in ') || tool,
    TITLE_MAX * 2,
  );
}

function readSummary(tool: string, text: string): string {
  const lines = text
    .split('\n')
    .filter((line) => line.trim().length > 0).length;
  if (tool === 'Read') return `${lines} ${lines === 1 ? 'line' : 'lines'}`;
  return `${lines} ${lines === 1 ? 'match' : 'matches'}`;
}

// One permission request from the SDK's canUseTool hook, expressed as the
// ask the user sees. The driver pauses the query until the ask is decided.
export function permissionAsk(
  toolName: string,
  input: Record<string, unknown>,
): Extract<AgentStepIntent, { kind: 'ask' }> {
  const scope = CHECK_TOOLS.has(toolName)
    ? (stringOf(input.command) ?? 'the shell')
    : WRITE_TOOLS.has(toolName)
      ? pathLabel(input)
      : toolName;
  return {
    kind: 'ask',
    action: `Run ${toolName}`,
    reason: `${toolName} needs your permission before it runs.`,
    scope: clip(scope, TITLE_MAX * 2),
    consequences: CHECK_TOOLS.has(toolName)
      ? 'Runs the command in the attached folder.'
      : WRITE_TOOLS.has(toolName)
        ? 'Changes files in the attached folder.'
        : 'Uses the tool as requested.',
  };
}
