// Small open models often write a tool call as JSON text instead of a
// structured tool_calls entry: bare `{"name": …, "arguments": …}`, several
// in a row, inside ```json fences, or wrapped in <tool_call> tags. This
// recovers those so the loop can run them, and returns whatever prose was
// left around them.

export interface RecoveredToolCall {
  readonly id: string;
  readonly type: 'function';
  readonly function: { readonly name: string; readonly arguments: string };
}

const WRAPPERS = /<\/?tool_call>|```(?:json)?|```/g;

function candidateObjects(text: string): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') {
      if (depth === 0) start = index;
      depth += 1;
    } else if (char === '}') {
      if (depth === 0) continue;
      depth -= 1;
      if (depth === 0 && start >= 0) {
        spans.push({ start, end: index + 1 });
        start = -1;
      }
    }
  }
  return spans;
}

export function recoverToolCalls(
  content: string,
  knownTools: readonly string[],
): { calls: RecoveredToolCall[]; prose: string } {
  const text = content.replace(WRAPPERS, ' ');
  const calls: RecoveredToolCall[] = [];
  let prose = '';
  let cursor = 0;
  for (const span of candidateObjects(text)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text.slice(span.start, span.end));
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== 'object') continue;
    const record = parsed as Record<string, unknown>;
    const name = typeof record.name === 'string' ? record.name : undefined;
    const args = record.arguments ?? record.parameters ?? record.input;
    if (!name || !knownTools.includes(name)) continue;
    prose += text.slice(cursor, span.start);
    cursor = span.end;
    calls.push({
      id: `recovered_${calls.length + 1}`,
      type: 'function',
      function: {
        name,
        arguments: JSON.stringify(args && typeof args === 'object' ? args : {}),
      },
    });
  }
  prose += text.slice(cursor);
  return { calls, prose: prose.replace(/\s+/g, ' ').trim() };
}
