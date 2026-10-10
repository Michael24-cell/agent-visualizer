// The OpenAI Responses API, spoken in the runner's own Chat Completions
// shapes. ChatGPT plan usage (Sign in with ChatGPT) is served only through
// /v1/responses with store: false and stream: true, so the runner keeps
// its message list and this module translates each turn there and back.

export interface WireToolCall {
  readonly id: string;
  readonly type: 'function';
  readonly function: { readonly name: string; readonly arguments: string };
}

export interface WireMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string | null;
  readonly tool_calls?: readonly WireToolCall[];
  readonly tool_call_id?: string;
  readonly name?: string;
}

export interface WireTool {
  readonly name: string;
  readonly description: string;
  readonly parameters: unknown;
}

export interface WireReply {
  readonly message: {
    readonly content?: string | null;
    readonly tool_calls?: readonly WireToolCall[];
  };
  readonly usage?: {
    readonly prompt_tokens?: number;
    readonly completion_tokens?: number;
  };
}

// Errors the plan route sends, in words a person can act on. Anything else
// keeps the server's own message.
const PLAN_ERRORS: Record<string, string> = {
  subscription_sharing_usage_limit_exceeded:
    "Your ChatGPT plan's usage limit is reached. It resets on its own — ChatGPT settings show when.",
  subscription_sharing_usage_unavailable:
    'ChatGPT plan usage is not available for this request right now. Try again shortly.',
  subscription_sharing_user_not_eligible:
    'This ChatGPT account is not eligible for plan usage in other apps.',
  subscription_sharing_route_not_supported:
    'ChatGPT plan usage does not support this kind of request.',
  model_not_found:
    'This model is not available for your ChatGPT connection. Choose another in the setup panel.',
};

export class ResponsesError extends Error {
  constructor(
    message: string,
    readonly code: string | undefined,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ResponsesError';
  }
}

function errorFrom(
  value: unknown,
  status?: number,
): ResponsesError | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const inner =
    record.error && typeof record.error === 'object'
      ? (record.error as Record<string, unknown>)
      : record;
  const code = typeof inner.code === 'string' ? inner.code : undefined;
  const message = typeof inner.message === 'string' ? inner.message : undefined;
  if (!code && !message) return undefined;
  return new ResponsesError(
    (code && PLAN_ERRORS[code]) ?? message ?? code ?? 'The request failed.',
    code,
    status,
  );
}

// One request body. System messages become instructions; assistant tool
// calls and their results become function_call / function_call_output
// items, matched by call id. Only documented fields are sent.
export function responsesBody(
  model: string,
  messages: readonly WireMessage[],
  tools: readonly WireTool[],
): Record<string, unknown> {
  const instructions = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content ?? '')
    .filter(Boolean)
    .join('\n\n');
  const input: Record<string, unknown>[] = [];
  for (const message of messages) {
    switch (message.role) {
      case 'system':
        break;
      case 'user':
        input.push({ role: 'user', content: message.content ?? '' });
        break;
      case 'assistant':
        if (message.content) {
          input.push({ role: 'assistant', content: message.content });
        }
        for (const call of message.tool_calls ?? []) {
          input.push({
            type: 'function_call',
            call_id: call.id,
            name: call.function.name,
            arguments: call.function.arguments,
          });
        }
        break;
      case 'tool':
        input.push({
          type: 'function_call_output',
          call_id: message.tool_call_id ?? '',
          output: message.content ?? '',
        });
        break;
    }
  }
  return {
    model,
    ...(instructions ? { instructions } : {}),
    input,
    ...(tools.length
      ? {
          tools: tools.map((tool) => ({
            type: 'function',
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          })),
        }
      : {}),
    store: false,
    stream: true,
  };
}

interface OutputItem {
  readonly type?: string;
  readonly call_id?: string;
  readonly name?: string;
  readonly arguments?: string;
  readonly content?: readonly {
    readonly type?: string;
    readonly text?: string;
  }[];
}

// The finished response's output, back in Chat Completions terms.
export function replyFrom(response: {
  readonly output?: readonly OutputItem[];
  readonly usage?: {
    readonly input_tokens?: number;
    readonly output_tokens?: number;
  };
}): WireReply {
  let text = '';
  const calls: WireToolCall[] = [];
  for (const item of response.output ?? []) {
    if (item.type === 'message') {
      for (const part of item.content ?? []) {
        if (part.type === 'output_text' && part.text) text += part.text;
      }
    } else if (item.type === 'function_call' && item.name) {
      calls.push({
        id: item.call_id ?? `call_${calls.length}`,
        type: 'function',
        function: { name: item.name, arguments: item.arguments ?? '{}' },
      });
    }
  }
  return {
    message: {
      content: text || null,
      ...(calls.length ? { tool_calls: calls } : {}),
    },
    ...(response.usage
      ? {
          usage: {
            prompt_tokens: response.usage.input_tokens ?? 0,
            completion_tokens: response.usage.output_tokens ?? 0,
          },
        }
      : {}),
  };
}

// Reads server-sent events until the response completes. Only
// response.completed means success; a stream that ends without it failed.
export async function readResponseStream(
  body: ReadableStream<Uint8Array>,
): Promise<WireReply> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const handle = (block: string): WireReply | undefined => {
    const data = block
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!data || data === '[DONE]') return undefined;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return undefined;
    }
    const response = event.response as Record<string, unknown> | undefined;
    switch (event.type) {
      case 'response.completed':
        return replyFrom(response ?? {});
      case 'response.failed':
        throw (
          errorFrom(response?.error) ??
          new ResponsesError('The response failed.', undefined)
        );
      case 'response.incomplete': {
        const details = response?.incomplete_details as
          { reason?: string } | undefined;
        throw new ResponsesError(
          `The response stopped early${details?.reason ? ` (${details.reason.replaceAll('_', ' ')})` : ''}.`,
          'incomplete',
        );
      }
      case 'error':
        throw (
          errorFrom(event) ??
          new ResponsesError('The stream failed.', undefined)
        );
      default:
        return undefined;
    }
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      // Normalize the whole buffer, so a \r\n split across chunks still
      // joins up before events are cut on blank lines.
      if (value) {
        buffer = (buffer + decoder.decode(value, { stream: true })).replace(
          /\r\n/g,
          '\n',
        );
      }
      let split = buffer.indexOf('\n\n');
      while (split >= 0) {
        const reply = handle(buffer.slice(0, split));
        buffer = buffer.slice(split + 2);
        if (reply) return reply;
        split = buffer.indexOf('\n\n');
      }
      if (done) break;
    }
    const reply = buffer.trim() ? handle(buffer) : undefined;
    if (reply) return reply;
  } finally {
    reader.releaseLock();
  }
  throw new ResponsesError(
    'The response ended before it finished.',
    'incomplete',
  );
}

// A non-2xx answer before any streaming: the body is JSON when the server
// could say why.
export async function responsesHttpError(
  response: Response,
): Promise<ResponsesError> {
  const text = await response.text().catch(() => '');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  if (response.status === 401) {
    return new ResponsesError(
      'Your ChatGPT sign-in is no longer valid. Sign in again from the setup panel.',
      'unauthorized',
      401,
    );
  }
  return (
    errorFrom(parsed, response.status) ??
    new ResponsesError(
      `ChatGPT answered ${response.status}${text ? `: ${text.slice(0, 200)}` : ''}`,
      undefined,
      response.status,
    )
  );
}
