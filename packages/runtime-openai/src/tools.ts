import { execFile } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

// The tools a local model gets. Every path is confined to the task's
// folder; the shell runs there too. Names mirror the Claude Agent SDK's so
// permissions and history read the same whichever runtime did the work.

export interface ToolContext {
  readonly cwd: string;
  readonly signal: AbortSignal;
}

export interface ToolResult {
  readonly text: string;
  readonly isError?: boolean;
}

export interface ToolDefinition {
  // The name the model calls (snake_case for OpenAI-style function calling).
  readonly name: string;
  // The SDK-style name used for asks, checks and outputs.
  readonly sdkName:
    'Read' | 'Glob' | 'Grep' | 'Bash' | 'Edit' | 'Write' | 'Plan';
  readonly description: string;
  readonly parameters: Record<string, unknown>;
  readonly needsPermission: boolean;
  run(
    input: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult>;
}

const OUTPUT_LIMIT = 12_000;
const IGNORED_DIRECTORIES = new Set(['node_modules', '.git', 'dist', 'build']);

function clip(text: string): string {
  return text.length > OUTPUT_LIMIT
    ? `${text.slice(0, OUTPUT_LIMIT)}\n… (${text.length - OUTPUT_LIMIT} more characters)`
    : text;
}

function str(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== 'string') throw new Error(`"${key}" must be a string.`);
  return value;
}

// Resolves a model-supplied path inside cwd, refusing anything outside,
// including paths that only leave through a symlink.
export function insideFolder(cwd: string, path: string): string {
  const target = resolve(cwd, path);
  const outside = (rel: string) =>
    rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel);
  if (outside(relative(cwd, target))) {
    throw new Error(`"${path}" is outside the project folder.`);
  }
  // Compare real locations: the nearest existing ancestor of the target
  // against the real folder.
  let existing = target;
  while (!existsSync(existing)) existing = dirname(existing);
  const realRoot = realpathSync(cwd);
  const realTarget = realpathSync(existing);
  if (realTarget !== realRoot && outside(relative(realRoot, realTarget))) {
    throw new Error(`"${path}" is outside the project folder.`);
  }
  return target;
}

async function* walk(root: string, dir: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.') || IGNORED_DIRECTORIES.has(entry.name))
      continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(root, full);
    else if (entry.isFile()) yield relative(root, full);
  }
}

// A minimal glob: `*` within a segment, `**` across segments.
function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '(?:.*/)?')
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]');
  return new RegExp(`^${escaped}$`);
}

export const readTool: ToolDefinition = {
  name: 'read_file',
  sdkName: 'Read',
  description: 'Read a text file from the project folder.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path relative to the project folder.',
      },
    },
    required: ['path'],
  },
  needsPermission: false,
  async run(input, context) {
    const path = insideFolder(context.cwd, str(input, 'path'));
    const info = await stat(path);
    if (!info.isFile())
      return { text: `${str(input, 'path')} is not a file.`, isError: true };
    return { text: clip(await readFile(path, 'utf8')) };
  },
};

export const globTool: ToolDefinition = {
  name: 'list_files',
  sdkName: 'Glob',
  description:
    'List files in the project folder matching a glob such as "src/**/*.ts". Omit the pattern to list everything.',
  parameters: {
    type: 'object',
    properties: { pattern: { type: 'string' } },
  },
  needsPermission: false,
  async run(input, context) {
    const pattern =
      typeof input.pattern === 'string' && input.pattern
        ? input.pattern
        : '**/*';
    const matcher = globToRegExp(pattern);
    const matches: string[] = [];
    for await (const file of walk(context.cwd, context.cwd)) {
      if (matcher.test(file)) matches.push(file);
      if (matches.length >= 500) break;
    }
    return {
      text: matches.length ? clip(matches.join('\n')) : 'No files match.',
    };
  },
};

export const grepTool: ToolDefinition = {
  name: 'search_files',
  sdkName: 'Grep',
  description:
    'Search file contents in the project folder for a regular expression. Returns path:line: text.',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'A regular expression.' },
      glob: {
        type: 'string',
        description: 'Only search files matching this glob.',
      },
    },
    required: ['pattern'],
  },
  needsPermission: false,
  async run(input, context) {
    const regex = new RegExp(str(input, 'pattern'), 'i');
    const only =
      typeof input.glob === 'string' && input.glob
        ? globToRegExp(input.glob)
        : undefined;
    const hits: string[] = [];
    for await (const file of walk(context.cwd, context.cwd)) {
      if (only && !only.test(file)) continue;
      let content: string;
      try {
        content = await readFile(join(context.cwd, file), 'utf8');
      } catch {
        continue;
      }
      if (content.includes('\0')) continue;
      const lines = content.split('\n');
      for (const [index, line] of lines.entries()) {
        if (regex.test(line))
          hits.push(`${file}:${index + 1}: ${line.trim().slice(0, 200)}`);
        if (hits.length >= 200) break;
      }
      if (hits.length >= 200) break;
    }
    return { text: hits.length ? clip(hits.join('\n')) : 'No matches.' };
  },
};

export const bashTool: ToolDefinition = {
  name: 'run_command',
  sdkName: 'Bash',
  description:
    'Run a shell command in the project folder (tests, builds, git). Returns stdout and stderr.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string' },
      description: {
        type: 'string',
        description: 'What the command is for, in a few words.',
      },
    },
    required: ['command'],
  },
  needsPermission: true,
  run(input, context) {
    const command = str(input, 'command');
    return new Promise((resolvePromise) => {
      execFile(
        '/bin/sh',
        ['-lc', command],
        {
          cwd: context.cwd,
          signal: context.signal,
          timeout: 120_000,
          maxBuffer: 4_000_000,
        },
        (error, stdout, stderr) => {
          const text = clip([stdout, stderr].filter(Boolean).join('\n').trim());
          if (error) {
            const code =
              'code' in error && typeof error.code === 'number'
                ? ` (exit ${error.code})`
                : '';
            resolvePromise({
              text: `${text || (error.name === 'AbortError' ? 'Stopped.' : 'Command failed with no output.')}${code}`,
              isError: true,
            });
          } else {
            resolvePromise({ text: text || '(no output)' });
          }
        },
      );
    });
  },
};

export const editTool: ToolDefinition = {
  name: 'edit_file',
  sdkName: 'Edit',
  description:
    'Replace one exact occurrence of old_text in a file with new_text. old_text must match exactly once.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      old_text: { type: 'string' },
      new_text: { type: 'string' },
    },
    required: ['path', 'old_text', 'new_text'],
  },
  needsPermission: true,
  async run(input, context) {
    const path = insideFolder(context.cwd, str(input, 'path'));
    const oldText = str(input, 'old_text');
    const newText = str(input, 'new_text');
    const content = await readFile(path, 'utf8');
    const first = content.indexOf(oldText);
    if (first < 0)
      return { text: 'old_text was not found in the file.', isError: true };
    if (content.indexOf(oldText, first + 1) >= 0) {
      return {
        text: 'old_text matches more than once; include more context.',
        isError: true,
      };
    }
    await writeFile(
      path,
      content.slice(0, first) + newText + content.slice(first + oldText.length),
    );
    return { text: `Edited ${str(input, 'path')}.` };
  },
};

export const writeTool: ToolDefinition = {
  name: 'write_file',
  sdkName: 'Write',
  description: 'Create or overwrite a file with the given content.',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string' }, content: { type: 'string' } },
    required: ['path', 'content'],
  },
  needsPermission: true,
  async run(input, context) {
    const path = insideFolder(context.cwd, str(input, 'path'));
    await writeFile(path, str(input, 'content'));
    return { text: `Wrote ${str(input, 'path')}.` };
  },
};

// The default set leaves out edit_file: small models treat search/replace
// as "insert after this marker" and corrupt files, while whole-file
// writes are reliable. Larger models get the full set.
export const LOCAL_AGENT_TOOLS: readonly ToolDefinition[] = [
  readTool,
  globTool,
  grepTool,
  bashTool,
  writeTool,
];

export const LOCAL_AGENT_TOOLS_FULL: readonly ToolDefinition[] = [
  readTool,
  globTool,
  grepTool,
  bashTool,
  editTool,
  writeTool,
];

// The SDK-style tool input shape, so permissionAsk() and the intents read
// like the Claude runtime's ("file_path", "command").
export function sdkInput(
  tool: ToolDefinition,
  input: Record<string, unknown>,
): Record<string, unknown> {
  switch (tool.sdkName) {
    case 'Bash':
      return { command: input.command, description: input.description };
    case 'Edit':
    case 'Write':
    case 'Read':
      return { file_path: input.path };
    default:
      return input;
  }
}

// Harness-side tools over the project's Plan document. Not gated by a
// permission: the change is visible at once and easy to undo by editing.
export function planTools(documents: {
  readPlan(): { sections: { id: string; title: string; lines: string[] }[] };
  updatePlanSection(sectionId: string, lines: string[]): Promise<string>;
}): ToolDefinition[] {
  const sectionIds = () => documents.readPlan().sections.map((s) => s.id);
  return [
    {
      name: 'read_plan',
      sdkName: 'Plan',
      description:
        'Read the project Plan document: what the project should become, in sections (overview, features, ui, visual, data, risks).',
      parameters: { type: 'object', properties: {} },
      needsPermission: false,
      async run() {
        const { sections } = documents.readPlan();
        const text = sections
          .map(
            (section) =>
              `## ${section.title} (${section.id})\n${
                section.lines.length
                  ? section.lines.map((line) => `- ${line}`).join('\n')
                  : '(empty)'
              }`,
          )
          .join('\n\n');
        return { text };
      },
    },
    {
      name: 'update_plan_section',
      sdkName: 'Plan',
      description:
        'Replace one section of the project Plan document with new lines. Use read_plan first; keep lines short, one point each.',
      parameters: {
        type: 'object',
        properties: {
          section: {
            type: 'string',
            description: 'One of: overview, features, ui, visual, data, risks.',
          },
          lines: { type: 'array', items: { type: 'string' } },
        },
        required: ['section', 'lines'],
      },
      needsPermission: false,
      async run(input) {
        const section = str(input, 'section').toLowerCase();
        if (!sectionIds().includes(section)) {
          return {
            text: `Unknown section "${section}". Use one of: ${sectionIds().join(', ')}.`,
            isError: true,
          };
        }
        // One point per line; models often add their own bullet markers.
        const lines = Array.isArray(input.lines)
          ? input.lines
              .map((line) =>
                String(line)
                  .trim()
                  .replace(/^(?:[-*•]|\d+[.)])\s+/, ''),
              )
              .filter(Boolean)
          : [];
        return { text: await documents.updatePlanSection(section, lines) };
      },
    },
  ];
}
