import { describe, expect, it } from 'vitest';
import {
  readResponseStream,
  responsesBody,
  responsesHttpError,
} from './responses.js';

function stream(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

const event = (value: object) => `data: ${JSON.stringify(value)}\n\n`;

describe('responsesBody', () => {
  it('turns a tool conversation into instructions and matched call items', () => {
    const body = responsesBody(
      'gpt-6.1-sol',
      [
        { role: 'system', content: 'You are an agent.' },
        { role: 'user', content: 'Read the README.' },
        {
          role: 'assistant',
          content: 'Reading it.',
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: {
                name: 'read_file',
                arguments: '{"path":"README.md"}',
              },
            },
          ],
        },
        {
          role: 'tool',
          tool_call_id: 'call_1',
          name: 'read_file',
          content: '# Demo',
        },
      ],
      [
        {
          name: 'read_file',
          description: 'Read a file.',
          parameters: { type: 'object' },
        },
      ],
    );
    expect(body).toEqual({
      model: 'gpt-6.1-sol',
      instructions: 'You are an agent.',
      input: [
        { role: 'user', content: 'Read the README.' },
        { role: 'assistant', content: 'Reading it.' },
        {
          type: 'function_call',
          call_id: 'call_1',
          name: 'read_file',
          arguments: '{"path":"README.md"}',
        },
        { type: 'function_call_output', call_id: 'call_1', output: '# Demo' },
      ],
      tools: [
        {
          type: 'function',
          name: 'read_file',
          description: 'Read a file.',
          parameters: { type: 'object' },
        },
      ],
      // Required by plan usage on every request.
      store: false,
      stream: true,
    });
  });
});

describe('readResponseStream', () => {
  it('reads text, tool calls, and usage from the completed response', async () => {
    const reply = await readResponseStream(
      stream(
        event({ type: 'response.created' }),
        event({ type: 'response.output_text.delta', delta: 'Look' }),
        event({
          type: 'response.completed',
          response: {
            output: [
              {
                type: 'message',
                content: [{ type: 'output_text', text: 'Looking.' }],
              },
              {
                type: 'function_call',
                call_id: 'call_9',
                name: 'read_file',
                arguments: '{"path":"a.ts"}',
              },
            ],
            usage: { input_tokens: 900, output_tokens: 30 },
          },
        }),
      ),
    );
    expect(reply).toEqual({
      message: {
        content: 'Looking.',
        tool_calls: [
          {
            id: 'call_9',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"a.ts"}' },
          },
        ],
      },
      usage: { prompt_tokens: 900, completion_tokens: 30 },
    });
  });

  it('joins events split across chunks and CRLF line endings', async () => {
    const done = JSON.stringify({
      type: 'response.completed',
      response: {
        output: [
          { type: 'message', content: [{ type: 'output_text', text: 'ok' }] },
        ],
      },
    });
    const reply = await readResponseStream(
      stream(`data: ${done.slice(0, 20)}`, `${done.slice(20)}\r`, '\n\r\n'),
    );
    expect(reply.message.content).toBe('ok');
  });

  it('says the plan limit is reached in words, not a code', async () => {
    await expect(
      readResponseStream(
        stream(
          event({
            type: 'response.failed',
            response: {
              error: {
                code: 'subscription_sharing_usage_limit_exceeded',
                message: 'limit',
              },
            },
          }),
        ),
      ),
    ).rejects.toThrow(/usage limit is reached/);
  });

  it('treats a stream that ends without completing as failed', async () => {
    await expect(
      readResponseStream(
        stream(event({ type: 'response.output_text.delta', delta: 'half' })),
      ),
    ).rejects.toThrow(/ended before it finished/);
  });

  it('reports an incomplete response with its reason', async () => {
    await expect(
      readResponseStream(
        stream(
          event({
            type: 'response.incomplete',
            response: { incomplete_details: { reason: 'max_output_tokens' } },
          }),
        ),
      ),
    ).rejects.toThrow('The response stopped early (max output tokens).');
  });
});

describe('responsesHttpError', () => {
  it('asks for a new sign-in on 401 and keeps the server reason otherwise', async () => {
    expect(
      (await responsesHttpError(new Response('nope', { status: 401 }))).message,
    ).toMatch(/Sign in again/);
    expect(
      (
        await responsesHttpError(
          Response.json(
            { error: { code: 'model_not_found', message: 'x' } },
            { status: 404 },
          ),
        )
      ).message,
    ).toMatch(/not available for your ChatGPT connection/);
  });
});
