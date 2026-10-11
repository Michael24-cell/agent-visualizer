// A recorded diff as rows a view can number, select and colour. Reads
// both forms the runtimes have written: '@@ -old +new @@' hunk headers,
// which carry line numbers, and the older '…' gap marker, which does not.
// Git's unified diffs ('@@ -a,b +c,d @@ context') read the same way.

export type DiffRowKind = 'add' | 'del' | 'ctx' | 'gap' | 'note';

export interface DiffRow {
  readonly kind: DiffRowKind;
  readonly text: string;
  // Line in the version before / after, when the diff says.
  readonly oldLine?: number;
  readonly newLine?: number;
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function parseDiff(diff: string): DiffRow[] {
  const rows: DiffRow[] = [];
  let oldLine: number | undefined;
  let newLine: number | undefined;
  for (const line of diff.split('\n')) {
    const hunk = HUNK.exec(line);
    if (hunk) {
      // The first header only sets the counters; later ones mark a gap.
      if (rows.length) rows.push({ kind: 'gap', text: '' });
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      continue;
    }
    if (line === '…') {
      rows.push({ kind: 'gap', text: '' });
      oldLine = undefined;
      newLine = undefined;
      continue;
    }
    const mark = line[0];
    const text = line.slice(1);
    if (mark === '+') {
      rows.push({
        kind: 'add',
        text,
        ...(newLine !== undefined ? { newLine: newLine++ } : {}),
      });
    } else if (mark === '-') {
      rows.push({
        kind: 'del',
        text,
        ...(oldLine !== undefined ? { oldLine: oldLine++ } : {}),
      });
    } else if (mark === ' ') {
      rows.push({
        kind: 'ctx',
        text,
        ...(oldLine !== undefined ? { oldLine: oldLine++ } : {}),
        ...(newLine !== undefined ? { newLine: newLine++ } : {}),
      });
    } else if (line.trim()) {
      // "(diff too large …)" and anything else that is not a diff line.
      rows.push({ kind: 'note', text: line });
    }
  }
  return rows;
}

export function diffCounts(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const row of parseDiff(diff)) {
    if (row.kind === 'add') added += 1;
    else if (row.kind === 'del') removed += 1;
  }
  return { added, removed };
}

// The span of the new file a selection of rows covers, for "ask about
// lines 12–18". Removed rows fall back to their old line numbers.
export function lineSpan(
  rows: readonly DiffRow[],
): { from: number; to: number } | undefined {
  const lines = rows
    .map((row) => row.newLine ?? row.oldLine)
    .filter((line): line is number => line !== undefined);
  if (!lines.length) return undefined;
  return { from: Math.min(...lines), to: Math.max(...lines) };
}
