import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import {
  CommandIdSchema,
  CreateProjectCommandSchema,
  PostMessageCommandSchema,
  type CommandResponse,
} from '@harness/contracts';
import { SqliteProjectStore, openHarnessDatabase } from '@harness/persistence';
import type { FrameSource } from '@harness/runtime-claude';
import { ProjectService } from './projects.js';

// The service drives live runs from fake SDK frames: the frames are
// scripted, the permission pause and the stop are real.

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

let counter = 4000;
function commandId() {
  counter += 1;
  return CommandIdSchema.parse(
    `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
  );
}

function text(body: string): SDKMessage {
  return {
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text: body }] },
    parent_tool_use_id: null,
  } as unknown as SDKMessage;
}

function toolUse(id: string, name: string, input: object): SDKMessage {
  return {
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', id, name, input }],
    },
    parent_tool_use_id: null,
  } as unknown as SDKMessage;
}

function toolResult(id: string, content: string): SDKMessage {
  return {
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: id, content }],
    },
    parent_tool_use_id: null,
  } as unknown as SDKMessage;
}

const success = (result: string): SDKMessage =>
  ({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result,
  }) as unknown as SDKMessage;

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function setup(frames: FrameSource) {
  const root = mkdtempSync(join(tmpdir(), 'visual-agent-live-'));
  temporaryDirectories.push(root);
  mkdirSync(join(root, 'repo'));
  const database = openHarnessDatabase(join(root, 'test.db'));
  const store = new SqliteProjectStore(database.database);
  const service = new ProjectService(store, {
    folders: { root },
    runtime: { mode: 'live' },
    frames,
  });
  return { root, service };
}

function createProject(service: ProjectService, root: string, withRepo = true) {
  const created = service.createProject(
    CreateProjectCommandSchema.parse({
      commandId: commandId(),
      name: 'Live',
      ...(withRepo ? { repositoryPath: join(root, 'repo') } : {}),
    }),
  );
  const projectId = created.project.projection.projectId;
  const agent = service.createAgent(projectId, {
    commandId: commandId(),
    expectedSequence: created.project.projection.lastSequence,
    name: 'Interface systems',
    category: 'interface',
  });
  const agentId = agent.receipt.createdIds.agents![0]!;
  const threadId = agent.project.projection.agents[agentId]!.threadId;
  return { projectId, agentId, threadId };
}

function startWork(
  service: ProjectService,
  ids: { projectId: string; threadId: string },
  body: string,
): CommandResponse {
  const thread = service.getProject(ids.projectId as never).projection.threads[
    ids.threadId
  ]!;
  return service.postMessage(
    ids.projectId as never,
    ids.threadId,
    PostMessageCommandSchema.parse({
      commandId: commandId(),
      expectedSequence: thread.lastSequence,
      body,
      intent: 'start_work',
    }),
  );
}

describe('live runs', () => {
  it('runs a task from frames, pauses on permission, and finishes done', async () => {
    const inputs: unknown[] = [];
    const frames: FrameSource = async function* (input, options) {
      inputs.push(input);
      yield text('Reading the code first.');
      const permission = await options.canUseTool(
        'Bash',
        { command: 'npm test', description: 'Run tests' },
        {
          signal: options.abortController.signal,
          toolUseID: 't',
          requestId: 'r',
        },
      );
      if (permission?.behavior !== 'allow') return;
      yield toolUse('t1', 'Bash', {
        command: 'npm test',
        description: 'Run tests',
      });
      yield toolResult('t1', '4 passed');
      yield toolUse('w1', 'Edit', { file_path: 'src/a.ts' });
      yield toolResult('w1', '');
      yield success('Added the endpoint and tests pass.');
    };
    const { root, service } = setup(frames);
    const ids = createProject(service, root);
    const started = startWork(service, ids, 'Add the endpoint');
    const taskId = started.receipt.createdIds.tasks![0]!;
    expect(started.project.projection.tasks[taskId]!.state).toBe('working');
    expect(started.project.busyThreadIds).toEqual([ids.threadId]);
    expect(started.project.runtime.mode).toBe('live');

    // The run posts text, then pauses on the permission ask.
    for (
      let i = 0;
      i < 10 &&
      Object.keys(service.getProject(ids.projectId as never).projection.asks)
        .length === 0;
      i += 1
    ) {
      await tick();
    }
    let project = service.getProject(ids.projectId as never);
    const ask = Object.values(project.projection.asks)[0]!;
    expect(ask).toMatchObject({
      action: 'Run Bash',
      scope: 'npm test',
      state: 'open',
    });
    expect(project.projection.tasks[taskId]!.state).toBe('needs_you');
    expect(project.busyThreadIds).toEqual([]);
    expect(inputs[0]).toMatchObject({
      cwd: join(root, 'repo'),
      model: 'sonnet',
    });
    expect((inputs[0] as { prompt: string }).prompt).toContain(
      'Add the endpoint',
    );

    // Approve: the run resumes, records the check and the edit, and finishes.
    const agent = project.projection.agents[ids.agentId]!;
    service.decideAsk(ids.projectId as never, ids.agentId as never, ask.id, {
      commandId: commandId(),
      expectedSequence: agent.lastSequence,
      decision: 'approved',
      trust: 'once',
    });
    await service.whenIdle();
    project = service.getProject(ids.projectId as never);
    expect(project.projection.tasks[taskId]!.state).toBe('done');
    const checks = Object.values(project.projection.checks);
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ name: 'Run tests', state: 'passed' });
    const outputs = Object.values(project.projection.outputs);
    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toMatchObject({ kind: 'diff', title: 'src/a.ts' });
    const messages = service
      .listMessages(ids.projectId as never, ids.threadId, { limit: 20 })
      .messages.map((m) => [m.author.source, m.body]);
    expect(messages).toContainEqual([
      'live_adapter',
      'Reading the code first.',
    ]);
    expect(project.projection.agents[ids.agentId]!.work).toBe('done');
    expect(project.busyThreadIds).toEqual([]);
  });

  it('denying the ask fails the task and interrupts the run', async () => {
    let permission: unknown;
    const frames: FrameSource = async function* (_input, options) {
      permission = await options.canUseTool(
        'Write',
        { file_path: 'x.ts' },
        {
          signal: options.abortController.signal,
          toolUseID: 't',
          requestId: 'r',
        },
      );
      yield text('this should be dropped');
    };
    const { root, service } = setup(frames);
    const ids = createProject(service, root);
    const started = startWork(service, ids, 'Write x');
    const taskId = started.receipt.createdIds.tasks![0]!;
    for (
      let i = 0;
      i < 10 &&
      Object.keys(service.getProject(ids.projectId as never).projection.asks)
        .length === 0;
      i += 1
    ) {
      await tick();
    }
    let project = service.getProject(ids.projectId as never);
    const ask = Object.values(project.projection.asks)[0]!;
    service.decideAsk(ids.projectId as never, ids.agentId as never, ask.id, {
      commandId: commandId(),
      expectedSequence: project.projection.agents[ids.agentId]!.lastSequence,
      decision: 'denied',
      trust: 'once',
    });
    await service.whenIdle();
    expect(permission).toMatchObject({ behavior: 'deny', interrupt: true });
    project = service.getProject(ids.projectId as never);
    expect(project.projection.tasks[taskId]!.state).toBe('failed');
    const bodies = service
      .listMessages(ids.projectId as never, ids.threadId, { limit: 20 })
      .messages.map((m) => m.body);
    expect(bodies).not.toContain('this should be dropped');
  });

  it('stop aborts the run and later frames are dropped', async () => {
    let release: () => void = () => {};
    let aborted = false;
    const frames: FrameSource = async function* (_input, options) {
      options.abortController.signal.addEventListener('abort', () => {
        aborted = true;
      });
      yield text('started');
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      yield text('after stop');
      yield success('done anyway');
    };
    const { root, service } = setup(frames);
    const ids = createProject(service, root);
    const started = startWork(service, ids, 'Long task');
    const taskId = started.receipt.createdIds.tasks![0]!;
    await tick();
    await tick();
    let project = service.getProject(ids.projectId as never);
    service.stopAgent(ids.projectId as never, ids.agentId as never, {
      commandId: commandId(),
      expectedSequence: project.projection.agents[ids.agentId]!.lastSequence,
    });
    expect(aborted).toBe(true);
    release();
    await service.whenIdle();
    project = service.getProject(ids.projectId as never);
    expect(project.projection.tasks[taskId]!.state).toBe('stopped');
    const bodies = service
      .listMessages(ids.projectId as never, ids.threadId, { limit: 20 })
      .messages.map((m) => m.body);
    expect(bodies).toContain('started');
    expect(bodies).not.toContain('after stop');
  });

  it('refuses live work without a folder, does not fake chat, and has no manual step', async () => {
    const frames: FrameSource = async function* () {
      yield success('x');
    };
    const { root, service } = setup(frames);
    const ids = createProject(service, root, false);
    expect(() => startWork(service, ids, 'Do it')).toThrow(/Attach a folder/);

    const thread = service.getProject(ids.projectId as never).projection
      .threads[ids.threadId]!;
    const chat = service.postMessage(
      ids.projectId as never,
      ids.threadId,
      PostMessageCommandSchema.parse({
        commandId: commandId(),
        expectedSequence: thread.lastSequence,
        body: 'hello?',
      }),
    );
    expect(Object.keys(chat.project.projection.tasks)).toEqual([]);
    const last = service
      .listMessages(ids.projectId as never, ids.threadId, { limit: 5 })
      .messages.at(-1)!;
    expect(last.author.role).toBe('system');
    expect(last.body).toMatch(/takes work, not chat/);

    expect(() =>
      service.advanceAgent(ids.projectId as never, ids.agentId as never, {
        commandId: commandId(),
        expectedSequence:
          chat.project.projection.agents[ids.agentId]!.lastSequence,
      }),
    ).toThrow(/works on its own/);
  });

  it('after a restart, tasks left running are stopped honestly instead of re-run', async () => {
    // A run that never finishes: the process "dies" with the task working.
    const frames: FrameSource = async function* () {
      yield text('working away');
      await new Promise(() => {});
    };
    const { root, service } = setup(frames);
    const ids = createProject(service, root);
    const started = startWork(service, ids, 'Long task');
    const taskId = started.receipt.createdIds.tasks![0]!;
    await tick();
    await tick();

    // A second service over the same store, as after a restart.
    const database = openHarnessDatabase(join(root, 'test.db'));
    const store = new SqliteProjectStore(database.database);
    store.rebuildAllProjections();
    const restarted = new ProjectService(store, {
      folders: { root },
      runtime: { mode: 'live' },
      frames: async function* () {
        yield text('must not start a run');
        throw new Error('must not start a run');
      },
    });
    restarted.recoverInterruptedRuns();
    const project = restarted.getProject(ids.projectId as never);
    expect(project.projection.tasks[taskId]!.state).toBe('stopped');
    expect(project.projection.agents[ids.agentId]!.work).toBe('stopped');
    const last = restarted
      .listMessages(ids.projectId as never, ids.threadId, { limit: 5 })
      .messages.at(-1)!;
    expect(last.author.role).toBe('system');
    expect(last.body).toMatch(/restarted/);

    // The next command does not resurrect the run.
    const thread = project.projection.threads[ids.threadId]!;
    restarted.postMessage(
      ids.projectId as never,
      ids.threadId,
      PostMessageCommandSchema.parse({
        commandId: commandId(),
        expectedSequence: thread.lastSequence,
        body: 'hello',
      }),
    );
    await restarted.whenIdle();
    expect(
      restarted.getProject(ids.projectId as never).projection.tasks[taskId]!
        .state,
    ).toBe('stopped');
    service.stopAll();
  });

  it('handles a live agent message at once even when simulated replies are deferred', async () => {
    const frames: FrameSource = async function* () {
      yield text('on it');
      yield success('done');
    };
    const root = mkdtempSync(join(tmpdir(), 'visual-agent-live-'));
    temporaryDirectories.push(root);
    mkdirSync(join(root, 'repo'));
    const database = openHarnessDatabase(join(root, 'test.db'));
    const store = new SqliteProjectStore(database.database);
    const service = new ProjectService(store, {
      folders: { root },
      runtime: { mode: 'live' },
      frames,
      replies: { mode: 'deferred', delayMs: 5 },
    });
    const ids = createProject(service, root);
    const sent = startWork(service, ids, 'Deferred task');
    // The task is created in the same command; no typing delay for a
    // live agent thread.
    expect(sent.receipt.createdIds.tasks).toHaveLength(1);
    await service.whenIdle();
    const project = service.getProject(ids.projectId as never);
    const task = Object.values(project.projection.tasks)[0]!;
    expect(task.state).toBe('done');
    const bodies = service
      .listMessages(ids.projectId as never, ids.threadId, { limit: 10 })
      .messages.map((m) => m.body);
    expect(bodies).toContain('on it');
  });

  it('one approval can trust the rest of the task; later permissions run without a card', async () => {
    const permissions: string[] = [];
    const frames: FrameSource = async function* (_input, options) {
      const first = await options.canUseTool(
        'Bash',
        { command: 'npm test' },
        {
          signal: options.abortController.signal,
          toolUseID: 'a',
          requestId: 'a',
        },
      );
      permissions.push(first?.behavior ?? 'none');
      const second = await options.canUseTool(
        'Write',
        { file_path: 'x.ts' },
        {
          signal: options.abortController.signal,
          toolUseID: 'b',
          requestId: 'b',
        },
      );
      permissions.push(second?.behavior ?? 'none');
      yield toolUse('w1', 'Write', { file_path: 'x.ts' });
      yield toolResult('w1', '');
      yield toolUse('r1', 'Read', { file_path: 'x.ts' });
      yield toolResult('r1', 'line one\nline two');
      yield success('Trusted run finished.');
    };
    const { root, service } = setup(frames);
    const ids = createProject(service, root);
    const started = startWork(service, ids, 'Trust me');
    const taskId = started.receipt.createdIds.tasks![0]!;
    for (
      let i = 0;
      i < 10 &&
      Object.keys(service.getProject(ids.projectId as never).projection.asks)
        .length === 0;
      i += 1
    ) {
      await tick();
    }
    let project = service.getProject(ids.projectId as never);
    const ask = Object.values(project.projection.asks)[0]!;
    service.decideAsk(ids.projectId as never, ids.agentId as never, ask.id, {
      commandId: commandId(),
      expectedSequence: project.projection.agents[ids.agentId]!.lastSequence,
      decision: 'approved',
      trust: 'task',
    });
    await service.whenIdle();
    project = service.getProject(ids.projectId as never);
    expect(permissions).toEqual(['allow', 'allow']);
    // Exactly one ask was ever opened; the task carries the trust.
    expect(Object.keys(project.projection.asks)).toHaveLength(1);
    expect(project.projection.tasks[taskId]).toMatchObject({
      state: 'done',
      trusted: true,
    });
    // Reads show up as activity; the final text is posted once.
    expect(Object.values(project.projection.activities)).toMatchObject([
      { tool: 'Read', target: 'x.ts', summary: '2 lines' },
    ]);
    const bodies = service
      .listMessages(ids.projectId as never, ids.threadId, { limit: 20 })
      .messages.map((m) => m.body);
    expect(bodies.filter((b) => b === 'Trusted run finished.')).toHaveLength(1);
  });

  it('offers the Plan document to the run and records agent edits with the agent as source', async () => {
    let seen: { id: string; lines: string[] }[] = [];
    let reply = '';
    const frames: FrameSource = async function* (input) {
      seen = input.documents!.readPlan().sections;
      reply = await input.documents!.updatePlanSection('features', [
        'Hello script',
        'Notes file',
      ]);
      yield success('Plan noted.');
    };
    const { root, service } = setup(frames);
    const ids = createProject(service, root);
    startWork(service, ids, 'Update the plan');
    await service.whenIdle();
    expect(seen.map((s) => s.id)).toEqual([
      'overview',
      'features',
      'ui',
      'visual',
      'data',
      'risks',
    ]);
    expect(reply).toBe('Plan · Features now has 2 lines.');
    const project = service.getProject(ids.projectId as never);
    expect(project.projection.planDocument.sections.features).toMatchObject({
      lines: ['Hello script', 'Notes file'],
      source: 'agent',
    });
    expect(Object.values(project.projection.tasks)[0]!.state).toBe('done');
  });

  it('offers the Method only when applied; agent edits become overrides without touching pinned snapshots', async () => {
    const offered: boolean[] = [];
    let reply = '';
    const frames: FrameSource = async function* (input) {
      offered.push(Boolean(input.documents?.readMethod));
      if (input.documents?.updateMethodSection) {
        const before = input.documents.readMethod!();
        expect(before.title).toBe('Evidence-led delivery');
        reply = await input.documents.updateMethodSection('checks', [
          'npm test',
        ]);
      }
      yield success('ok');
    };
    const { root, service } = setup(frames);
    const ids = createProject(service, root);
    // No Method: not offered.
    startWork(service, ids, 'First');
    await service.whenIdle();
    let project = service.getProject(ids.projectId as never);
    service.applyMethod(ids.projectId as never, {
      commandId: commandId(),
      expectedSequence: project.projection.lastSequence,
      catalogId: 'method_evidence-led-delivery' as never,
      catalogVersion: '1.2.0',
    });
    startWork(service, ids, 'Second');
    await service.whenIdle();
    project = service.getProject(ids.projectId as never);
    expect(offered).toEqual([false, true]);
    expect(reply).toMatch(/Method · Checks now has 1 line/);
    const method = project.projection.method!;
    expect(method.overrides.at(-1)).toMatchObject({
      sectionId: 'checks',
      value: ['npm test'],
      source: 'agent',
    });
    // The second task's snapshot was pinned before the edit and keeps it.
    const second = Object.values(project.projection.tasks).find(
      (task) => task.title === 'Second',
    )!;
    const snapshot =
      project.projection.methodSnapshots[second.methodSnapshotId!]!;
    expect(snapshot.resolved.checks).not.toContain('npm test');
    expect(second.state).toBe('done');
  });

  it('forwards a follow-up into a running task when the runtime can take it', async () => {
    const forwarded: string[] = [];
    let finish: () => void = () => {};
    const root = mkdtempSync(join(tmpdir(), 'visual-agent-live-'));
    temporaryDirectories.push(root);
    mkdirSync(join(root, 'repo'));
    const database = openHarnessDatabase(join(root, 'test.db'));
    const store = new SqliteProjectStore(database.database);
    const service = new ProjectService(store, {
      folders: { root },
      runtime: { mode: 'live' },
      runner: (_input, sink) => ({
        done: new Promise<void>((resolve) => {
          finish = () => {
            sink.emit([{ kind: 'finish', reason: 'Done.' }]);
            resolve();
          };
        }),
        stop: () => undefined,
        send: (body) => {
          forwarded.push(body);
          return true;
        },
      }),
    });
    const ids = createProject(service, root);
    startWork(service, ids, 'Long task');
    const thread = service.getProject(ids.projectId as never).projection
      .threads[ids.threadId]!;
    service.postMessage(
      ids.projectId as never,
      ids.threadId,
      PostMessageCommandSchema.parse({
        commandId: commandId(),
        expectedSequence: thread.lastSequence,
        body: 'Also add a test.',
      }),
    );
    expect(forwarded).toEqual(['Also add a test.']);
    const bodies = service
      .listMessages(ids.projectId as never, ids.threadId, { limit: 10 })
      .messages.map((m) => [m.author.role, m.body]);
    expect(bodies.at(-1)).toEqual(['user', 'Also add a test.']);
    finish();
    await service.whenIdle();
  });

  it('trust policy: once per task needs one approval; commands-only skips file asks', async () => {
    const decisions: string[] = [];
    const frames: FrameSource = async function* (_input, options) {
      const opts = (id: string) => ({
        signal: options.abortController.signal,
        toolUseID: id,
        requestId: id,
      });
      decisions.push(
        (await options.canUseTool('Write', { file_path: 'a.ts' }, opts('a')))
          ?.behavior ?? 'none',
      );
      decisions.push(
        (await options.canUseTool('Bash', { command: 'npm test' }, opts('b')))
          ?.behavior ?? 'none',
      );
      decisions.push(
        (await options.canUseTool('Write', { file_path: 'b.ts' }, opts('c')))
          ?.behavior ?? 'none',
      );
      yield success('ok');
    };
    const { root, service } = setup(frames);
    const ids = createProject(service, root);
    let project = service.getProject(ids.projectId as never);
    service.setTrust(ids.projectId as never, {
      commandId: commandId(),
      expectedSequence: project.projection.lastSequence,
      trust: 'task',
    });
    startWork(service, ids, 'Once per task');
    for (
      let i = 0;
      i < 10 &&
      Object.keys(service.getProject(ids.projectId as never).projection.asks)
        .length === 0;
      i += 1
    ) {
      await tick();
    }
    project = service.getProject(ids.projectId as never);
    const ask = Object.values(project.projection.asks)[0]!;
    service.decideAsk(ids.projectId as never, ids.agentId as never, ask.id, {
      commandId: commandId(),
      expectedSequence: project.projection.agents[ids.agentId]!.lastSequence,
      decision: 'approved',
      trust: 'once',
    });
    await service.whenIdle();
    expect(decisions).toEqual(['allow', 'allow', 'allow']);
    expect(
      Object.keys(service.getProject(ids.projectId as never).projection.asks),
    ).toHaveLength(1);

    // Commands only: the Write goes ahead, Bash asks, the next Write too.
    decisions.length = 0;
    project = service.getProject(ids.projectId as never);
    service.setTrust(ids.projectId as never, {
      commandId: commandId(),
      expectedSequence: project.projection.lastSequence,
      trust: 'commands',
    });
    startWork(service, ids, 'Commands only');
    for (
      let i = 0;
      i < 10 &&
      Object.values(
        service.getProject(ids.projectId as never).projection.asks,
      ).filter((a) => a.state === 'open').length === 0;
      i += 1
    ) {
      await tick();
    }
    project = service.getProject(ids.projectId as never);
    const bashAsk = Object.values(project.projection.asks).find(
      (a) => a.state === 'open',
    )!;
    expect(bashAsk.action).toBe('Run Bash');
    expect(decisions).toEqual(['allow']);
    service.decideAsk(
      ids.projectId as never,
      ids.agentId as never,
      bashAsk.id,
      {
        commandId: commandId(),
        expectedSequence: project.projection.agents[ids.agentId]!.lastSequence,
        decision: 'approved',
        trust: 'once',
      },
    );
    await service.whenIdle();
    expect(decisions).toEqual(['allow', 'allow', 'allow']);
    const task = Object.values(
      service.getProject(ids.projectId as never).projection.tasks,
    ).find((t) => t.title === 'Commands only')!;
    expect(task.state).toBe('done');
    expect(task.startedAt).toBeDefined();
  });
});
