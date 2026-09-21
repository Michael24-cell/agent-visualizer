import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LiveTaskSink } from '@harness/runtime-claude';
import type { AgentStepIntent } from '@harness/runtime-simulated';
import { afterEach, describe, expect, it } from 'vitest';
import { runOpenAiTask } from './runner.js';
import { insideFolder } from './tools.js';

const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0))
    rmSync(folder, { recursive: true, force: true });
});

function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'runtime-openai-'));
  folders.push(root);
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'app.ts'), 'export const greeting = "hi";\n');
  writeFileSync(join(root, 'README.md'), '# Demo\n');
  return root;
}

type Reply = {
  content?: string;
  tool_calls?: { name: string; args: object }[];
};

// A fake endpoint that answers each turn from a script and records the
// messages it was sent.
function server(script: Reply[]) {
  const requests: {
    messages: { role: string; content: string | null; name?: string }[];
  }[] = [];
  let turn = 0;
  const fetchFn: typeof fetch = async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)) as (typeof requests)[number]);
    const reply = script[turn] ?? { content: 'done' };
    turn += 1;
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: reply.content ?? null,
              tool_calls: reply.tool_calls?.map((call, index) => ({
                id: `call_${turn}_${index}`,
                type: 'function',
                function: {
                  name: call.name,
                  arguments: JSON.stringify(call.args),
                },
              })),
            },
          },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
  return { fetchFn, requests };
}

function collect(decision: 'approved' | 'denied' = 'approved') {
  const batches: AgentStepIntent[][] = [];
  const asks: string[] = [];
  const sink: LiveTaskSink = {
    emit(intents) {
      batches.push([...intents]);
      return true;
    },
    async ask(ask) {
      asks.push(`${ask.action} ${ask.scope}`);
      return decision;
    },
  };
  return { batches, asks, sink };
}

const input = (cwd: string) => ({
  cwd,
  model: 'sonnet' as const,
  systemPrompt: 'You are an agent.',
  prompt: 'Rename the greeting.',
});

describe('runOpenAiTask', () => {
  it('reads, asks before running and editing, records checks and outputs, and finishes', async () => {
    const cwd = project();
    const { fetchFn, requests } = server([
      {
        content: 'Looking at the file.',
        tool_calls: [{ name: 'read_file', args: { path: 'src/app.ts' } }],
      },
      {
        tool_calls: [
          {
            name: 'run_command',
            args: { command: 'echo ok', description: 'Smoke check' },
          },
        ],
      },
      {
        tool_calls: [
          {
            name: 'edit_file',
            args: { path: 'src/app.ts', old_text: '"hi"', new_text: '"hello"' },
          },
        ],
      },
      { content: 'Renamed the greeting and verified.' },
    ]);
    const seen = collect();
    await runOpenAiTask(input(cwd), seen.sink, {
      baseUrl: 'http://fake/v1',
      model: 'test-model',
      fetch: fetchFn,
    }).done;

    expect(seen.asks).toEqual(['Run Bash echo ok', 'Run Edit src/app.ts']);
    expect(seen.batches).toEqual([
      [{ kind: 'say', body: 'Looking at the file.' }],
      [
        {
          kind: 'check_pass',
          name: 'Smoke check',
          command: 'echo ok',
          summary: 'ok',
        },
      ],
      [
        {
          kind: 'output',
          outputKind: 'diff',
          title: 'src/app.ts',
          digest: 'Edited src/app.ts.',
        },
      ],
      [{ kind: 'say', body: 'Renamed the greeting and verified.' }],
      [{ kind: 'finish', reason: 'Renamed the greeting and verified.' }],
    ]);
    expect(readFileSync(join(cwd, 'src', 'app.ts'), 'utf8')).toBe(
      'export const greeting = "hello";\n',
    );

    // The model saw the file contents and the tool results in order.
    const toolMessages = requests
      .at(-1)!
      .messages.filter((m) => m.role === 'tool');
    expect(toolMessages.map((m) => m.name)).toEqual([
      'read_file',
      'run_command',
      'edit_file',
    ]);
    expect(toolMessages[0]!.content).toContain('greeting');
    expect(requests[0]!.messages[0]).toMatchObject({
      role: 'system',
      content: 'You are an agent.',
    });
  });

  it('records a failed command as a failed check and keeps going', async () => {
    const cwd = project();
    const { fetchFn } = server([
      { tool_calls: [{ name: 'run_command', args: { command: 'exit 3' } }] },
      { content: 'That failed; giving up.' },
    ]);
    const seen = collect();
    await runOpenAiTask(input(cwd), seen.sink, {
      baseUrl: 'http://fake/v1',
      model: 'm',
      fetch: fetchFn,
    }).done;
    expect(seen.batches[0]).toEqual([
      {
        kind: 'check_fail',
        name: 'exit 3',
        command: 'exit 3',
        summary: 'Command failed with no output. (exit 3)',
      },
    ]);
    expect(seen.batches.at(-1)).toEqual([
      { kind: 'finish', reason: 'That failed; giving up.' },
    ]);
  });

  it('a declined permission fails the task and stops', async () => {
    const cwd = project();
    const { fetchFn, requests } = server([
      {
        tool_calls: [
          { name: 'write_file', args: { path: 'x.txt', content: 'x' } },
        ],
      },
      { content: 'never asked' },
    ]);
    const seen = collect('denied');
    await runOpenAiTask(input(cwd), seen.sink, {
      baseUrl: 'http://fake/v1',
      model: 'm',
      fetch: fetchFn,
    }).done;
    expect(seen.batches).toEqual([
      [{ kind: 'fail', reason: 'You declined: Write.' }],
    ]);
    expect(requests).toHaveLength(1);
  });

  it('refuses paths outside the folder, reports errors to the model, and caps turns', async () => {
    const cwd = project();
    const { fetchFn, requests } = server([
      {
        tool_calls: [{ name: 'read_file', args: { path: '../../etc/passwd' } }],
      },
      { tool_calls: [{ name: 'read_file', args: { path: 'README.md' } }] },
      { tool_calls: [{ name: 'read_file', args: { path: 'README.md' } }] },
    ]);
    const seen = collect();
    await runOpenAiTask(input(cwd), seen.sink, {
      baseUrl: 'http://fake/v1',
      model: 'm',
      fetch: fetchFn,
      maxTurns: 3,
    }).done;
    const firstTool = requests[1]!.messages.find((m) => m.role === 'tool')!;
    expect(firstTool.content).toMatch(/outside the project folder/);
    expect(seen.batches).toEqual([
      [{ kind: 'fail', reason: 'Stopped after 3 turns without finishing.' }],
    ]);
  });

  it('stop() aborts and an unreachable endpoint fails the task with the reason', async () => {
    const cwd = project();
    const seen = collect();
    const run = runOpenAiTask(input(cwd), seen.sink, {
      baseUrl: 'http://fake/v1',
      model: 'm',
      fetch: async () => new Response('no model', { status: 404 }),
    });
    await run.done;
    expect(seen.batches).toEqual([
      [{ kind: 'fail', reason: 'm at http://fake/v1 answered 404: no model' }],
    ]);

    const hanging = collect();
    const slow = runOpenAiTask(input(cwd), hanging.sink, {
      baseUrl: 'http://fake/v1',
      model: 'm',
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new Error('aborted')),
          );
        }),
    });
    slow.stop();
    await slow.done;
    expect(hanging.batches).toEqual([]);
  });
});

describe('insideFolder', () => {
  it('keeps paths inside the folder, including through symlinks', () => {
    const cwd = project();
    expect(insideFolder(cwd, 'src/a.ts')).toBe(join(cwd, 'src/a.ts'));
    expect(insideFolder(cwd, 'new/file.txt')).toBe(join(cwd, 'new/file.txt'));
    expect(insideFolder(cwd, '.')).toBe(cwd);
    expect(() => insideFolder(cwd, '../x')).toThrow(/outside/);
    expect(() => insideFolder(cwd, '/etc/passwd')).toThrow(/outside/);
    symlinkSync(tmpdir(), join(cwd, 'escape'));
    expect(() => insideFolder(cwd, 'escape/anything')).toThrow(/outside/);
  });
});
