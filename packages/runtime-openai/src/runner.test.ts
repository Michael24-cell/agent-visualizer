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
import { providerFor, retryAfterMs, runOpenAiTask } from './runner.js';
import { LOCAL_AGENT_TOOLS_FULL } from './tools.js';
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
      tools: LOCAL_AGENT_TOOLS_FULL,
    }).done;

    expect(seen.asks).toEqual(['Run Bash echo ok', 'Run Edit src/app.ts']);
    expect(seen.batches).toEqual([
      [{ kind: 'say', body: 'Looking at the file.' }],
      [
        {
          kind: 'activity',
          tool: 'Read',
          target: 'src/app.ts',
          summary: '1 line',
        },
      ],
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
          location: 'src/app.ts',
          diff: '@@ -1 +1 @@\n-export const greeting = "hi";\n+export const greeting = "hello";',
        },
      ],
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
    expect(requests[0]!.messages[0]!.role).toBe('system');
    expect(requests[0]!.messages[0]!.content).toMatch(/^You are an agent\./);
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
    expect(seen.batches.at(-1)).toEqual([
      { kind: 'fail', reason: 'Stopped after 3 turns without finishing.' },
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

describe('guardrails for small models', () => {
  it('refuses an edit before a read and labels an unverified finish', async () => {
    const cwd = project();
    const { fetchFn, requests } = server([
      {
        tool_calls: [
          {
            name: 'edit_file',
            args: { path: 'src/app.ts', old_text: '"hi"', new_text: '"x"' },
          },
        ],
      },
      {
        tool_calls: [
          { name: 'write_file', args: { path: 'notes.txt', content: 'n' } },
        ],
      },
      { content: 'Done.' },
    ]);
    const seen = collect();
    await runOpenAiTask(input(cwd), seen.sink, {
      baseUrl: 'http://fake/v1',
      model: 'm',
      fetch: fetchFn,
      tools: LOCAL_AGENT_TOOLS_FULL,
    }).done;
    const firstTool = requests[1]!.messages.find((m) => m.role === 'tool')!;
    expect(firstTool.content).toMatch(/read_file before editing/);
    expect(readFileSync(join(cwd, 'src', 'app.ts'), 'utf8')).toContain('"hi"');
    expect(seen.batches.at(-1)).toEqual([
      { kind: 'finish', reason: 'Unverified — no command was run. Done.' },
    ]);
  });
});

describe('nudging', () => {
  it('pushes a model that stops calling tools before anything happened, at most twice', async () => {
    const cwd = project();
    const { fetchFn, requests } = server([
      { content: 'Here is what I would do: edit the file.' },
      { content: 'Please run the following command.' },
      { content: 'I cannot.' },
    ]);
    const seen = collect();
    await runOpenAiTask(input(cwd), seen.sink, {
      baseUrl: 'http://fake/v1',
      model: 'm',
      fetch: fetchFn,
    }).done;
    expect(requests).toHaveLength(3);
    expect(requests[1]!.messages.at(-1)).toMatchObject({ role: 'user' });
    expect(requests[1]!.messages.at(-1)!.content).toMatch(/not called a tool/);
    expect(seen.batches.at(-1)).toEqual([
      { kind: 'finish', reason: 'I cannot.' },
    ]);
  });
});

describe('promised work', () => {
  it('nudges a model that announces a next step and stops', async () => {
    const cwd = project();
    const { fetchFn, requests } = server([
      {
        tool_calls: [
          { name: 'write_file', args: { path: 'a.txt', content: 'a' } },
        ],
      },
      { content: "Wrote a.txt. Now I'll run the tests." },
      {
        tool_calls: [{ name: 'run_command', args: { command: 'echo tested' } }],
      },
      { content: 'Done and tested.' },
    ]);
    const seen = collect();
    await runOpenAiTask(input(cwd), seen.sink, {
      baseUrl: 'http://fake/v1',
      model: 'm',
      fetch: fetchFn,
    }).done;
    expect(requests[2]!.messages.at(-1)!.content).toMatch(/did not do it/);
    expect(seen.batches.at(-1)).toEqual([
      { kind: 'finish', reason: 'Done and tested.' },
    ]);
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

describe('hallucinated tool responses', () => {
  it('are stripped from what the model says', async () => {
    const cwd = project();
    const { fetchFn } = server([
      { tool_calls: [{ name: 'run_command', args: { command: 'echo hi' } }] },
      { content: '<tool_response>\nhi\n</tool_response>\nAll good.' },
    ]);
    const seen = collect();
    await runOpenAiTask(input(cwd), seen.sink, {
      baseUrl: 'http://fake/v1',
      model: 'm',
      fetch: fetchFn,
    }).done;
    expect(seen.batches.at(-1)).toEqual([
      { kind: 'finish', reason: 'All good.' },
    ]);
    expect(seen.batches.flat().filter((i) => i.kind === 'say')).toEqual([]);
  });
});

describe('turn bounds', () => {
  it('sends max_tokens and fails a turn that exceeds the timeout with a clear reason', async () => {
    const cwd = project();
    let body: { max_tokens?: number } = {};
    const seen = collect();
    await runOpenAiTask(input(cwd), seen.sink, {
      baseUrl: 'http://fake/v1',
      model: 'slow',
      turnTimeoutMs: 30,
      fetch: (_url, init) => {
        body = JSON.parse(String(init?.body)) as typeof body;
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new Error('aborted')),
          );
        });
      },
    }).done;
    expect(body.max_tokens).toBe(2_048);
    expect(seen.batches).toEqual([
      [{ kind: 'fail', reason: 'slow gave no answer within 0s.' }],
    ]);
  });
});

describe('plan tools', () => {
  it('lets the model read and update the Plan when documents are offered', async () => {
    const cwd = project();
    const edits: [string, string[]][] = [];
    const documents = {
      readPlan: () => ({
        sections: [
          { id: 'overview', title: 'Overview', lines: ['A playground'] },
          { id: 'features', title: 'Features', lines: [] },
        ],
      }),
      updatePlanSection: async (sectionId: string, lines: string[]) => {
        edits.push([sectionId, lines]);
        return `Plan · ${sectionId} now has ${lines.length} lines.`;
      },
    };
    const { fetchFn, requests } = server([
      { tool_calls: [{ name: 'read_plan', args: {} }] },
      {
        tool_calls: [
          {
            name: 'update_plan_section',
            args: {
              section: 'Features',
              lines: ['- Hello script', ' ', '2. Second point'],
            },
          },
        ],
      },
      {
        tool_calls: [
          {
            name: 'update_plan_section',
            args: { section: 'nope', lines: ['x'] },
          },
        ],
      },
      { content: 'Plan updated.' },
    ]);
    const seen = collect();
    await runOpenAiTask({ ...input(cwd), documents }, seen.sink, {
      baseUrl: 'http://fake/v1',
      model: 'm',
      fetch: fetchFn,
    }).done;
    const firstResult = requests[1]!.messages.find((m) => m.role === 'tool')!;
    expect(firstResult.content).toContain('## Overview (overview)');
    expect(firstResult.content).toContain('(empty)');
    expect(edits).toEqual([['features', ['Hello script', 'Second point']]]);
    const badResult = requests[3]!.messages
      .filter((m) => m.role === 'tool')
      .at(-1)!;
    expect(badResult.content).toMatch(/Unknown section "nope"/);
    expect(seen.asks).toEqual([]);
    expect(seen.batches).toEqual([
      [{ kind: 'activity', tool: 'Plan', target: 'Plan', summary: 'read' }],
      [
        {
          kind: 'activity',
          tool: 'Plan',
          target: 'Plan · features',
          summary: 'updated',
        },
      ],
      [{ kind: 'finish', reason: 'Plan updated.' }],
    ]);
  });
});

describe('method tools', () => {
  it('appear only when a Method is applied, and record agent overrides', async () => {
    const cwd = project();
    const edits: [string, string[]][] = [];
    const documents = {
      readPlan: () => ({ sections: [] }),
      updatePlanSection: async () => 'n/a',
      readMethod: () => ({
        title: 'Evidence-led delivery',
        sections: [
          {
            id: 'hardRules',
            title: 'Hard rules',
            lines: ['No network calls.'],
          },
          { id: 'checks', title: 'Checks', lines: [] },
        ],
      }),
      updateMethodSection: async (sectionId: string, lines: string[]) => {
        edits.push([sectionId, lines]);
        return `Method · ${sectionId} now has ${lines.length} lines.`;
      },
    };
    const { fetchFn, requests } = server([
      { tool_calls: [{ name: 'read_method', args: {} }] },
      {
        tool_calls: [
          {
            name: 'update_method_section',
            args: { section: 'checks', lines: ['- npm test'] },
          },
        ],
      },
      { content: 'Method updated.' },
    ]);
    const seen = collect();
    await runOpenAiTask({ ...input(cwd), documents }, seen.sink, {
      baseUrl: 'http://fake/v1',
      model: 'm',
      fetch: fetchFn,
    }).done;
    const firstResult = requests[1]!.messages.find((m) => m.role === 'tool')!;
    expect(firstResult.content).toContain('# Evidence-led delivery');
    expect(firstResult.content).toContain('## Hard rules (hardRules)');
    expect(edits).toEqual([['checks', ['npm test']]]);
    expect(seen.batches).toEqual([
      [{ kind: 'activity', tool: 'Method', target: 'Method', summary: 'read' }],
      [
        {
          kind: 'activity',
          tool: 'Method',
          target: 'Method · checks',
          summary: 'updated',
        },
      ],
      [{ kind: 'finish', reason: 'Method updated.' }],
    ]);

    // Without a Method the tools are not offered at all.
    let toolNames: string[] = [];
    const fakeFetch: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as {
        tools: { function: { name: string } }[];
      };
      toolNames = body.tools.map((t) => t.function.name);
      return new Response(
        JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    };
    await runOpenAiTask(
      {
        ...input(cwd),
        documents: {
          readPlan: documents.readPlan,
          updatePlanSection: documents.updatePlanSection,
        },
      },
      collect().sink,
      { baseUrl: 'http://fake/v1', model: 'm', fetch: fakeFetch, maxTurns: 1 },
    ).done;
    expect(toolNames).toContain('read_plan');
    expect(toolNames).not.toContain('read_method');
  });
});

describe('follow-ups', () => {
  it('delivers a message sent mid-run before the next model turn', async () => {
    const cwd = project();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const requests: { messages: { role: string; content: string | null }[] }[] =
      [];
    let turn = 0;
    const fetchFn: typeof fetch = async (_url, init) => {
      requests.push(
        JSON.parse(String(init?.body)) as (typeof requests)[number],
      );
      turn += 1;
      if (turn === 1) {
        // First turn: a read; hold the reply until the follow-up is sent.
        await gate;
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: null,
                  tool_calls: [
                    {
                      id: 'c1',
                      type: 'function',
                      function: {
                        name: 'read_file',
                        arguments: '{"path":"README.md"}',
                      },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({ choices: [{ message: { content: 'Noted.' } }] }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    };
    const run = runOpenAiTask(input(cwd), collect().sink, {
      baseUrl: 'http://fake/v1',
      model: 'm',
      fetch: fetchFn,
    });
    expect(run.send!('Also keep it short.')).toBe(true);
    release();
    await run.done;
    const second = requests[1]!.messages;
    expect(second.at(-1)).toMatchObject({
      role: 'user',
      content: 'Also keep it short.',
    });
    expect(second.at(-2)).toMatchObject({ role: 'tool' });
    expect(run.send!('too late')).toBe(false);
  });
});

describe('rate limits', () => {
  it('waits out a 429 and retries instead of failing the task', async () => {
    const cwd = project();
    const waits: number[] = [];
    let calls = 0;
    const fetchFn: typeof fetch = async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(
          JSON.stringify({
            error: { message: 'Rate limit reached. Please try again in 1.5s.' },
          }),
          { status: 429 },
        );
      }
      return new Response(
        JSON.stringify({ choices: [{ message: { content: 'Done.' } }] }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    };
    const seen = collect();
    await runOpenAiTask(input(cwd), seen.sink, {
      baseUrl: 'http://fake/v1',
      model: 'm',
      fetch: fetchFn,
      sleep: async (ms) => {
        waits.push(ms);
      },
    }).done;
    expect(waits).toEqual([1500]);
    expect(seen.batches.at(-1)).toEqual([{ kind: 'finish', reason: 'Done.' }]);
  });

  it('reads Retry-After and body hints, with sane bounds', () => {
    expect(retryAfterMs('7', '')).toBe(7000);
    expect(retryAfterMs(null, 'try again in 250ms')).toBe(500);
    expect(retryAfterMs(null, 'Please try again in 2m.')).toBe(90_000);
    expect(retryAfterMs(null, 'nothing useful')).toBe(60_000);
  });
});

describe('tool policies from the Method', () => {
  it('docs only: no shell, writes limited to .md/.txt', async () => {
    const cwd = project();
    let offered: string[] = [];
    const { fetchFn, requests } = server([
      {
        tool_calls: [
          { name: 'write_file', args: { path: 'src/app.ts', content: 'nope' } },
        ],
      },
      {
        tool_calls: [
          { name: 'write_file', args: { path: 'NOTES.md', content: '# ok' } },
        ],
      },
      { content: 'Documented.' },
    ]);
    const spy: typeof fetch = async (url, init) => {
      const body = JSON.parse(String(init?.body)) as {
        tools: { function: { name: string } }[];
      };
      offered = body.tools.map((t) => t.function.name);
      return fetchFn(url, init);
    };
    const seen = collect();
    await runOpenAiTask({ ...input(cwd), tools: 'docs' }, seen.sink, {
      baseUrl: 'http://fake/v1',
      model: 'm',
      fetch: spy,
    }).done;
    expect(offered).toEqual([
      'read_file',
      'list_files',
      'search_files',
      'write_file',
    ]);
    const first = requests[1]!.messages.find((m) => m.role === 'tool')!;
    expect(first.content).toMatch(/Only \.md and \.txt/);
    expect(readFileSync(join(cwd, 'src', 'app.ts'), 'utf8')).toContain('"hi"');
    expect(readFileSync(join(cwd, 'NOTES.md'), 'utf8')).toBe('# ok');
    expect(seen.batches.at(-1)).toEqual([
      {
        kind: 'finish',
        reason: 'Unverified — no command was run. Documented.',
      },
    ]);
  });
});

describe('per-agent endpoint model', () => {
  it('sends the agent model instead of the runtime default', async () => {
    const cwd = project();
    let sent = '';
    const fetchFn: typeof fetch = async (_url, init) => {
      sent = (JSON.parse(String(init?.body)) as { model: string }).model;
      return new Response(
        JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    };
    await runOpenAiTask(
      { ...input(cwd), endpointModel: 'qwen/qwen3.8-27b' },
      collect().sink,
      {
        baseUrl: 'http://fake/v1',
        model: 'openai/gpt-oss-120b',
        fetch: fetchFn,
        maxTurns: 1,
      },
    ).done;
    expect(sent).toBe('qwen/qwen3.8-27b');
  });
});

describe('token usage', () => {
  it('reports each turn the endpoint metered, before what the turn caused', async () => {
    const cwd = project();
    const usages = [
      { prompt_tokens: 1_200, completion_tokens: 40 },
      { prompt_tokens: 1_500, completion_tokens: 25 },
    ];
    let turn = 0;
    const fetchFn: typeof fetch = async () => {
      const reply =
        turn === 0
          ? {
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: {
                    name: 'read_file',
                    arguments: JSON.stringify({ path: 'README.md' }),
                  },
                },
              ],
            }
          : { content: 'Read it.' };
      const usage = usages[turn];
      turn += 1;
      return new Response(
        JSON.stringify({ choices: [{ message: reply }], usage }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };
    const { batches, sink } = collect();
    await runOpenAiTask(input(cwd), sink, {
      baseUrl: 'https://api.groq.com/openai/v1',
      model: 'openai/gpt-oss-120b',
      fetch: fetchFn,
      tools: LOCAL_AGENT_TOOLS_FULL,
    }).done;

    const usage = batches.flat().filter((intent) => intent.kind === 'usage');
    expect(usage).toEqual([
      {
        kind: 'usage',
        modelId: 'openai/gpt-oss-120b',
        provider: 'groq',
        inputTokens: 1_200,
        outputTokens: 40,
      },
      {
        kind: 'usage',
        modelId: 'openai/gpt-oss-120b',
        provider: 'groq',
        inputTokens: 1_500,
        outputTokens: 25,
      },
    ]);
    // The first turn's usage lands before the read it asked for.
    const kinds = batches.flat().map((intent) => intent.kind);
    expect(kinds.indexOf('usage')).toBeLessThan(kinds.indexOf('activity'));
    expect(kinds.at(-1)).toBe('finish');
  });

  it('says nothing about usage when the endpoint does not meter it', async () => {
    const cwd = project();
    const { fetchFn } = server([{ content: 'Nothing to do.' }]);
    const { batches, sink } = collect();
    await runOpenAiTask(input(cwd), sink, {
      baseUrl: 'http://127.0.0.1:11434/v1',
      model: 'llama3.2:3b',
      fetch: fetchFn,
      tools: LOCAL_AGENT_TOOLS_FULL,
    }).done;
    expect(batches.flat().some((intent) => intent.kind === 'usage')).toBe(
      false,
    );
  });

  it('knows a local endpoint from a hosted one', () => {
    expect(providerFor('http://127.0.0.1:11434/v1')).toBe('local');
    expect(providerFor('http://localhost:1234/v1')).toBe('local');
    expect(providerFor('https://api.groq.com/openai/v1')).toBe('groq');
    expect(providerFor('https://api.openai.com/v1')).toBe('openai');
    expect(providerFor('not a url')).toBe('openai');
  });
});

describe('on the ChatGPT plan (Responses API)', () => {
  it('runs a tool turn over /responses with a fresh token each request', async () => {
    const cwd = project();
    const seen: {
      url: string;
      auth: string | null;
      body: Record<string, unknown>;
    }[] = [];
    let turn = 0;
    const sse = (value: object) =>
      new Response(`data: ${JSON.stringify(value)}\n\n`, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    const fetchFn: typeof fetch = async (url, init) => {
      seen.push({
        url: String(url),
        auth: new Headers(init?.headers).get('authorization'),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      });
      turn += 1;
      return sse({
        type: 'response.completed',
        response:
          turn === 1
            ? {
                output: [
                  {
                    type: 'function_call',
                    call_id: 'call_a',
                    name: 'read_file',
                    arguments: JSON.stringify({ path: 'README.md' }),
                  },
                ],
                usage: { input_tokens: 800, output_tokens: 20 },
              }
            : {
                output: [
                  {
                    type: 'message',
                    content: [{ type: 'output_text', text: 'It is a demo.' }],
                  },
                ],
                usage: { input_tokens: 950, output_tokens: 12 },
              },
      });
    };
    let issued = 0;
    const { batches, sink } = collect();
    await runOpenAiTask(input(cwd), sink, {
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-6.1-sol',
      transport: 'responses',
      accessToken: async () => `token-${(issued += 1)}`,
      usageProvider: 'chatgpt',
      fetch: fetchFn,
      tools: LOCAL_AGENT_TOOLS_FULL,
    }).done;

    // Every request goes to /responses with a token fetched for it. (A
    // read-only answer is nudged before it may finish, so there are more
    // than two turns.)
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(
      seen.every(
        (request) => request.url === 'https://api.openai.com/v1/responses',
      ),
    ).toBe(true);
    expect(seen.map((request) => request.auth)).toEqual(
      seen.map((_, index) => `Bearer token-${index + 1}`),
    );
    expect(seen[0]!.body).toMatchObject({ store: false, stream: true });
    // The second turn carries the call and its result back.
    expect(seen[1]!.body.input).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'function_call', call_id: 'call_a' }),
        expect.objectContaining({
          type: 'function_call_output',
          call_id: 'call_a',
          output: expect.stringContaining('# Demo'),
        }),
      ]),
    );
    const intents = batches.flat();
    const usage = intents.filter((intent) => intent.kind === 'usage');
    // One report per metered turn, all billed to the plan.
    expect(usage).toHaveLength(seen.length);
    expect(usage[0]).toEqual({
      kind: 'usage',
      modelId: 'gpt-6.1-sol',
      provider: 'chatgpt',
      inputTokens: 800,
      outputTokens: 20,
    });
    expect(
      usage.every(
        (intent) => intent.kind === 'usage' && intent.provider === 'chatgpt',
      ),
    ).toBe(true);
    expect(intents.at(-1)).toMatchObject({
      kind: 'finish',
      reason: 'It is a demo.',
    });
  });
});
