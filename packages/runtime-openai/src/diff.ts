// A small line diff for showing what a write changed. Unified-style text:
// context lines start with a space, removals with '-', additions with '+'.
// Big inputs get a summary instead of a quadratic diff.

const MAX_LINES = 3_000;
const CONTEXT = 2;

export function lineDiff(before: string, after: string): string {
  if (before === after) return '';
  // A trailing newline is not a line of its own.
  const a = before.replace(/\n$/, '').split('\n');
  const b = after.replace(/\n$/, '').split('\n');
  if (a.length > MAX_LINES || b.length > MAX_LINES) {
    return `(diff too large: ${a.length} → ${b.length} lines)`;
  }
  // LCS table.
  const n = a.length;
  const m = b.length;
  const table: Uint16Array[] = [];
  for (let i = 0; i <= n; i += 1) table.push(new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i]![j] =
        a[i] === b[j]
          ? table[i + 1]![j + 1]! + 1
          : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  // Walk it into ops.
  const ops: { kind: ' ' | '-' | '+'; text: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: ' ', text: a[i]! });
      i += 1;
      j += 1;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      ops.push({ kind: '-', text: a[i]! });
      i += 1;
    } else {
      ops.push({ kind: '+', text: b[j]! });
      j += 1;
    }
  }
  while (i < n) ops.push({ kind: '-', text: a[i++]! });
  while (j < m) ops.push({ kind: '+', text: b[j++]! });
  // Keep only changes with a little context, separated by '…'.
  const keep = new Set<number>();
  ops.forEach((op, index) => {
    if (op.kind === ' ') return;
    for (
      let k = Math.max(0, index - CONTEXT);
      k <= Math.min(ops.length - 1, index + CONTEXT);
      k += 1
    ) {
      keep.add(k);
    }
  });
  const out: string[] = [];
  let last = -1;
  for (let index = 0; index < ops.length; index += 1) {
    if (!keep.has(index)) continue;
    if (last >= 0 && index > last + 1) out.push('…');
    out.push(`${ops[index]!.kind}${ops[index]!.text}`);
    last = index;
  }
  return out.join('\n');
}
