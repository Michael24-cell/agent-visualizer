import { describe, expect, it } from 'vitest';
import { recoverToolCalls } from './tool-calls.js';

const tools = ['read_file', 'edit_file', 'run_command'];

describe('recoverToolCalls', () => {
  it('recovers a bare JSON call and leaves no prose', () => {
    expect(
      recoverToolCalls(
        '{"name": "read_file", "arguments": {"path": "README.md"}}',
        tools,
      ),
    ).toEqual({
      calls: [
        {
          id: 'recovered_1',
          type: 'function',
          function: { name: 'read_file', arguments: '{"path":"README.md"}' },
        },
      ],
      prose: '',
    });
  });

  it('recovers several calls, fenced or tagged, and keeps the prose around them', () => {
    const text =
      'Let me look.\n```json\n{"name": "read_file", "arguments": {"path": "a"}}\n```\n' +
      '<tool_call>{"name":"run_command","parameters":{"command":"npm test"}}</tool_call> Then done.';
    const result = recoverToolCalls(text, tools);
    expect(
      result.calls.map((c) => [c.function.name, c.function.arguments]),
    ).toEqual([
      ['read_file', '{"path":"a"}'],
      ['run_command', '{"command":"npm test"}'],
    ]);
    expect(result.prose).toBe('Let me look. Then done.');
  });

  it('ignores JSON that is not a known tool call, and braces inside strings', () => {
    expect(recoverToolCalls('{"result": "ok"}', tools).calls).toEqual([]);
    expect(
      recoverToolCalls('{"name": "delete_everything", "arguments": {}}', tools)
        .calls,
    ).toEqual([]);
    const tricky =
      '{"name": "edit_file", "arguments": {"path": "x", "old_text": "}", "new_text": "{"}}';
    const result = recoverToolCalls(tricky, tools);
    expect(JSON.parse(result.calls[0]!.function.arguments)).toEqual({
      path: 'x',
      old_text: '}',
      new_text: '{',
    });
  });
});
