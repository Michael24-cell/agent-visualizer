import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentStepIntent } from '@harness/runtime-simulated';
import { describe, expect, it } from 'vitest';
import {
  runLiveTask,
  type FrameSource,
  type LiveTaskInput,
  type LiveTaskSink,
} from './runner.js';

const input: LiveTaskInput = {
  cwd: '/tmp/project',
  model: 'sonnet',
  systemPrompt: 'sys',
  prompt: 'do it',
};

function text(body: string): SDKMessage {
  return {
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text: body }] },
    parent_tool_use_id: null,
  } as unknown as SDKMessage;
}

function toolUse(id: string, name: string, toolInput: object): SDKMessage {
  return {
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', id, name, input: toolInput }],
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

const success: SDKMessage = {
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: 'All done.',
} as unknown as SDKMessage;

const permissionOptions = {
  signal: new AbortController().signal,
  toolUseID: 'tu',
  requestId: 'rq',
};

function collect() {
  const batches: AgentStepIntent[][] = [];
  const asks: string[] = [];
  const sink: LiveTaskSink = {
    emit(intents) {
      batches.push([...intents]);
      return true;
    },
    async ask(ask) {
      asks.push(ask.scope);
      return 'approved';
    },
  };
  return { batches, asks, sink };
}

describe('runLiveTask', () => {
  it('streams frames through the mapper and pauses on permission', async () => {
    const seen = collect();
    const source: FrameSource = async function* (_input, options) {
      yield text('Checking the tests.');
      const permission = await options.canUseTool(
        'Bash',
        { command: 'npm test' },
        permissionOptions,
      );
      expect(permission?.behavior).toBe('allow');
      yield toolUse('t1', 'Bash', { command: 'npm test' });
      yield toolResult('t1', '3 passed');
      yield success;
    };
    await runLiveTask(input, seen.sink, source).done;
    expect(seen.asks).toEqual(['npm test']);
    expect(seen.batches).toEqual([
      [{ kind: 'say', body: 'Checking the tests.' }],
      [
        {
          kind: 'check_pass',
          name: 'npm test',
          command: 'npm test',
          summary: '3 passed',
        },
      ],
      [{ kind: 'finish', reason: 'All done.' }],
    ]);
  });

  it('denies with interrupt when the user declines', async () => {
    const seen = collect();
    seen.sink.ask = async () => 'denied';
    let permission: unknown;
    const source: FrameSource = async function* (_input, options) {
      permission = await options.canUseTool(
        'Write',
        { file_path: 'a.ts' },
        permissionOptions,
      );
      yield {
        type: 'result',
        subtype: 'error_during_execution',
        is_error: true,
      } as unknown as SDKMessage;
    };
    await runLiveTask(input, seen.sink, source).done;
    expect(permission).toMatchObject({ behavior: 'deny', interrupt: true });
    expect(seen.batches).toEqual([
      [{ kind: 'fail', reason: 'error during execution' }],
    ]);
  });

  it('aborts when the sink refuses a batch and emits nothing more', async () => {
    const seen = collect();
    let aborted = false;
    seen.sink.emit = (intents) => {
      seen.batches.push([...intents]);
      return false;
    };
    const source: FrameSource = async function* (_input, options) {
      options.abortController.signal.addEventListener('abort', () => {
        aborted = true;
      });
      yield text('one');
      yield text('two');
      yield success;
    };
    await runLiveTask(input, seen.sink, source).done;
    expect(aborted).toBe(true);
    expect(seen.batches).toEqual([[{ kind: 'say', body: 'one' }]]);
  });

  it('stop() ends the run without a trailing failure', async () => {
    const seen = collect();
    let release: () => void = () => {};
    const source: FrameSource = async function* () {
      yield text('working');
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      yield text('never seen');
    };
    const run = runLiveTask(input, seen.sink, source);
    await new Promise((resolve) => setTimeout(resolve, 0));
    run.stop();
    release();
    await run.done;
    expect(seen.batches).toEqual([[{ kind: 'say', body: 'working' }]]);
  });

  it('fails the task when the stream ends without a result or throws', async () => {
    const ended = collect();
    const silent: FrameSource = async function* () {
      yield text('hm');
    };
    await runLiveTask(input, ended.sink, silent).done;
    expect(ended.batches.at(-1)).toEqual([
      { kind: 'fail', reason: 'The agent ended without reporting a result.' },
    ]);

    const thrown = collect();
    const broken: FrameSource = async function* () {
      yield text('hm');
      throw new Error('socket closed');
    };
    await runLiveTask(input, thrown.sink, broken).done;
    expect(thrown.batches.at(-1)).toEqual([
      { kind: 'fail', reason: 'socket closed' },
    ]);
  });
});
