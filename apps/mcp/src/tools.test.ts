import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { AppConfig } from '@harness/config';
import { createService } from '../../service/src/app.js';
import { Harness, readConnection } from './harness.js';
import { clientLabel, createHarnessServer } from './tools.js';

// The MCP server end to end: an MCP client (standing in for Claude Code)
// calls the tools; they reach a real Harness service.

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function temporary(prefix: string) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@example.invalid',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@example.invalid',
    },
  });

async function setup() {
  const root = temporary('visual-agent-mcp-');
  const folder = join(root, 'shop');
  mkdirSync(folder);
  git(folder, 'init', '-q');
  writeFileSync(join(folder, 'README.md'), '# Shop\n');
  git(folder, 'add', '.');
  git(folder, 'commit', '-qm', 'start');
  const dataDirectory = temporary('visual-agent-mcp-data-');
  const config: AppConfig = {
    host: '127.0.0.1',
    port: 4317,
    dataDirectory,
    databasePath: join(dataDirectory, 'test.db'),
    sessionToken: 'c'.repeat(64),
    allowedOrigins: [],
    demoProject: false,
    folderRoot: root,
    runtime: { kind: 'simulated' },
    claudeKeyPresent: false,
    local: {
      baseUrl: 'http://127.0.0.1:11434/v1',
      model: 'qwen2.5-coder:7b',
      tools: 'basic',
    },
  };
  const service = createService(config);
  // fetch, answered by the service in-process.
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    const response = await service.inject({
      method: (init.method ?? 'GET') as 'GET' | 'POST',
      url: new URL(url).pathname + new URL(url).search,
      headers: init.headers as Record<string, string>,
      ...(init.body ? { payload: init.body as string } : {}),
    });
    return new Response(response.body || null, { status: response.statusCode });
  }) as typeof fetch;
  const harness = new Harness(
    () => ({ url: 'http://127.0.0.1:4317', token: config.sessionToken }),
    fetchImpl,
  );
  const server = createHarnessServer({ harness, cwd: folder });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'claude-code', version: '1.0.0' });
  await client.connect(clientSide);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    const content = result.content as { type: string; text: string }[];
    return {
      text: content.map((part) => part.text).join('\n'),
      isError: Boolean(result.isError),
    };
  };
  return { call, client, folder, service };
}

describe('the Harness MCP server', () => {
  it('lists its tools, marking the read-only ones', async () => {
    const { client } = await setup();
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'draft_plan',
      'get_overview',
      'get_plan',
      'next_task',
      'report_task',
    ]);
    const readOnly = tools
      .filter((tool) => tool.annotations?.readOnlyHint)
      .map((tool) => tool.name)
      .sort();
    expect(readOnly).toEqual(['get_overview', 'get_plan']);
  });

  it('says when no project uses the folder', async () => {
    const { call } = await setup();
    const result = await call('get_plan');
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/No Harness project uses .*shop/);
  });

  it('plans, hands out a task, and records the report against git', async () => {
    const { call, folder, service } = await setup();

    const drafted = await call('draft_plan', {
      request: 'Build an invoice download page',
    });
    expect(drafted.isError).toBe(false);
    expect(drafted.text).toMatch(/^Planner: Plan v1 is ready/);
    expect(drafted.text).toMatch(/not started — next_task hands it to you/);

    const overview = await call('get_overview');
    expect(overview.text).toMatch(/^Project: shop\nFolder: .*shop/);

    const taken = await call('next_task');
    expect(taken.text).toMatch(/^Took "/);
    const taskId = /task_id "([^"]+)"/.exec(taken.text)![1]!;
    const checks = /Checks that must pass:\n((?:- .+\n?)+)/
      .exec(taken.text)![1]!
      .trim()
      .split('\n')
      .map((line) => line.slice(2));

    const plan = await call('get_plan');
    expect(plan.text).toMatch(/handed to Claude Code/);
    expect(plan.text).toMatch(/\[in progress\]/);

    writeFileSync(join(folder, 'invoices.ts'), 'export const x = 1;\n');
    const reported = await call('report_task', {
      task_id: taskId,
      outcome: 'done',
      summary: 'Added the invoice list.',
      checks: checks.map((name) => ({
        name,
        command: 'npm test',
        passed: true,
      })),
      files_changed: ['invoices.ts'],
    });
    expect(reported.text).toBe(
      `Recorded "${/Took "(.+)"\./.exec(taken.text)![1]}" as done. Git shows 1 changed file. It matches Claude Code's report. Call next_task for the next one.`,
    );

    const projects = (
      await service.inject({
        method: 'GET',
        url: '/api/projects',
        headers: { 'x-harness-session': 'c'.repeat(64) },
      })
    ).json();
    expect(projects.projects[0].project.name).toBe('shop');
  });

  it('passes on what Harness refuses, in its words', async () => {
    const { call } = await setup();
    await call('draft_plan', { request: 'Build an invoice download page' });
    const result = await call('report_task', {
      task_id: 'task_nope',
      outcome: 'done',
      summary: 'Done.',
    });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(
      /No task task_nope was handed to an outside tool/,
    );
  });
});

describe('finding Harness', () => {
  it('says how to start it when it is not running', () => {
    const dataDirectory = temporary('visual-agent-mcp-none-');
    expect(() => readConnection({ HARNESS_DATA_DIR: dataDirectory })).toThrow(
      /Harness isn't running\. Start it with `npm start`/,
    );
  });

  it('reads the address the service left, and only for this computer', () => {
    const dataDirectory = temporary('visual-agent-mcp-conn-');
    writeFileSync(
      join(dataDirectory, 'connection.json'),
      JSON.stringify({ url: 'http://127.0.0.1:4400', token: 't0k' }),
    );
    expect(readConnection({ HARNESS_DATA_DIR: dataDirectory })).toEqual({
      url: 'http://127.0.0.1:4400',
      token: 't0k',
    });
    writeFileSync(
      join(dataDirectory, 'connection.json'),
      JSON.stringify({ url: 'http://example.com:4400', token: 't0k' }),
    );
    expect(() => readConnection({ HARNESS_DATA_DIR: dataDirectory })).toThrow(
      /not this computer/,
    );
  });

  it('names the tool the way panes show it', () => {
    expect(clientLabel('claude-code')).toBe('Claude Code');
    expect(clientLabel('codex-mcp-client')).toBe('Codex');
    expect(clientLabel(undefined)).toBe('Outside tool');
  });
});
