import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';
import { ClaudeMessageMapper, permissionAsk } from './mapper.js';

// Fake SDK frames. Only the fields the mapper reads are filled in; the
// rest of the SDK's wire shape is irrelevant to what the project records.
function assistant(
  content: unknown[],
  parent: string | null = null,
): SDKMessage {
  return {
    type: 'assistant',
    message: { role: 'assistant', content },
    parent_tool_use_id: parent,
    uuid: 'a',
    session_id: 's',
  } as unknown as SDKMessage;
}

function toolResult(
  toolUseId: string,
  content: unknown,
  isError = false,
): SDKMessage {
  return {
    type: 'user',
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolUseId,
          content,
          is_error: isError,
        },
      ],
    },
    parent_tool_use_id: null,
    uuid: 'u',
    session_id: 's',
  } as unknown as SDKMessage;
}

function success(result: string): SDKMessage {
  return {
    type: 'result',
    subtype: 'success',
    is_error: false,
    result,
  } as unknown as SDKMessage;
}

describe('ClaudeMessageMapper', () => {
  it('turns assistant text into a say and ignores thinking', () => {
    const mapper = new ClaudeMessageMapper();
    expect(
      mapper.map(
        assistant([
          { type: 'thinking', thinking: 'hmm' },
          { type: 'text', text: '  Looking at the repo.  ' },
          { type: 'text', text: '   ' },
        ]),
      ),
    ).toEqual([{ kind: 'say', body: 'Looking at the repo.' }]);
  });

  it('records a Bash call as a check once its result arrives', () => {
    const mapper = new ClaudeMessageMapper();
    expect(
      mapper.map(
        assistant([
          {
            type: 'tool_use',
            id: 't1',
            name: 'Bash',
            input: { command: 'npm test', description: 'Run the tests' },
          },
        ]),
      ),
    ).toEqual([]);
    expect(mapper.map(toolResult('t1', '12 passed'))).toEqual([
      {
        kind: 'check_pass',
        name: 'Run the tests',
        command: 'npm test',
        summary: '12 passed',
      },
    ]);
  });

  it('records a failed Bash call as a failed check', () => {
    const mapper = new ClaudeMessageMapper();
    mapper.map(
      assistant([
        { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'tsc' } },
      ]),
    );
    expect(
      mapper.map(
        toolResult('t1', [{ type: 'text', text: 'error TS2322' }], true),
      ),
    ).toEqual([
      {
        kind: 'check_fail',
        name: 'tsc',
        command: 'tsc',
        summary: 'error TS2322',
      },
    ]);
  });

  it('records a successful file write as a diff output', () => {
    const mapper = new ClaudeMessageMapper();
    mapper.map(
      assistant([
        {
          type: 'tool_use',
          id: 'w1',
          name: 'Edit',
          input: { file_path: 'src/app.ts', old_string: 'a', new_string: 'b' },
        },
      ]),
    );
    expect(mapper.map(toolResult('w1', ''))).toEqual([
      {
        kind: 'output',
        outputKind: 'diff',
        title: 'src/app.ts',
        digest: 'Edit applied.',
      },
    ]);
  });

  it('keeps read-only tools, failed writes and subagent frames out of history', () => {
    const mapper = new ClaudeMessageMapper();
    mapper.map(
      assistant([
        { type: 'tool_use', id: 'r1', name: 'Read', input: { file_path: 'x' } },
        {
          type: 'tool_use',
          id: 'w1',
          name: 'Write',
          input: { file_path: 'y' },
        },
      ]),
    );
    expect(mapper.map(toolResult('r1', 'contents'))).toEqual([]);
    expect(mapper.map(toolResult('w1', 'EACCES', true))).toEqual([]);
    expect(
      mapper.map(assistant([{ type: 'text', text: 'inner' }], 'task-1')),
    ).toEqual([]);
  });

  it('ignores a result for a call it never saw', () => {
    const mapper = new ClaudeMessageMapper();
    expect(mapper.map(toolResult('ghost', 'x'))).toEqual([]);
  });

  it('finishes on a successful result and fails on an error result', () => {
    const ok = new ClaudeMessageMapper();
    expect(ok.map(success('Done: added the endpoint.'))).toEqual([
      { kind: 'finish', reason: 'Done: added the endpoint.' },
    ]);
    expect(ok.isFinished).toBe(true);

    const bad = new ClaudeMessageMapper();
    expect(
      bad.map({
        type: 'result',
        subtype: 'error_max_turns',
        is_error: true,
      } as unknown as SDKMessage),
    ).toEqual([{ kind: 'fail', reason: 'error max turns' }]);

    const withErrors = new ClaudeMessageMapper();
    expect(
      withErrors.map({
        type: 'result',
        subtype: 'error_during_execution',
        is_error: true,
        errors: ['boom'],
      } as unknown as SDKMessage),
    ).toEqual([{ kind: 'fail', reason: 'boom' }]);
  });

  it('reports a denied permission and drops frames it does not model', () => {
    const mapper = new ClaudeMessageMapper();
    expect(
      mapper.map({
        type: 'system',
        subtype: 'permission_denied',
        tool_name: 'Bash',
        tool_use_id: 't',
      } as unknown as SDKMessage),
    ).toEqual([
      {
        kind: 'say',
        body: 'Permission denied for Bash; continuing without it.',
      },
    ]);
    expect(
      mapper.map({ type: 'status', status: 'x' } as unknown as SDKMessage),
    ).toEqual([]);
  });

  it('clips long summaries', () => {
    const mapper = new ClaudeMessageMapper();
    mapper.map(
      assistant([
        { type: 'tool_use', id: 't', name: 'Bash', input: { command: 'ls' } },
      ]),
    );
    const [intent] = mapper.map(toolResult('t', 'x'.repeat(2_000)));
    expect(intent?.kind).toBe('check_pass');
    if (intent?.kind === 'check_pass') {
      expect(intent.summary.length).toBe(600);
      expect(intent.summary.endsWith('…')).toBe(true);
    }
  });
});

describe('permissionAsk', () => {
  it('describes a shell command by its command and a write by its file', () => {
    expect(permissionAsk('Bash', { command: 'rm -rf dist' })).toMatchObject({
      kind: 'ask',
      action: 'Run Bash',
      scope: 'rm -rf dist',
      consequences: 'Runs the command in the attached folder.',
    });
    expect(permissionAsk('Write', { file_path: 'README.md' })).toMatchObject({
      scope: 'README.md',
      consequences: 'Changes files in the attached folder.',
    });
    expect(permissionAsk('WebFetch', { url: 'x' })).toMatchObject({
      scope: 'WebFetch',
    });
  });
});
