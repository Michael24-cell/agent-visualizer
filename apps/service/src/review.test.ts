import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  commitDiff,
  compareFunctions,
  findFunctions,
  listCommits,
  maskSource,
  similarFunctions,
} from './review.js';

const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0))
    rmSync(folder, { recursive: true, force: true });
});
function folder(): string {
  const path = mkdtempSync(join(tmpdir(), 'review-'));
  folders.push(path);
  return path;
}

describe('maskSource', () => {
  it('blanks comments and strings without moving anything', () => {
    const source = [
      'const a = "{ not a brace }"; // also { not',
      "const b = /[{}]/g; /* { */ const c = `x ${'{'} y`;",
    ].join('\n');
    const { code, noComments } = maskSource(source);
    expect(code).toHaveLength(source.length);
    expect(code.split('\n')).toHaveLength(2);
    expect(code).not.toMatch(/[{}]/);
    // Strings survive in the token copy; comments do not.
    expect(noComments).toContain('"{ not a brace }"');
    expect(noComments).not.toContain('also');
  });
});

describe('findFunctions', () => {
  it('finds declarations, braced arrows, methods and typed returns', () => {
    const source = `import x from 'y';
export function total(items: Item[]): number {
  return items.reduce((sum, item) => sum + item.price, 0);
}
const format = async (value: number) => {
  return value.toFixed(2);
};
const short = (a: number) => a + 1;
class Cart {
  private add(item: Item): { ok: boolean } {
    if (item) { this.items.push(item); }
    return { ok: true };
  }
}
if (ready) {
  start();
}
`;
    const found = findFunctions('src/cart.ts', source);
    expect(found.map((fn) => [fn.name, fn.startLine, fn.endLine])).toEqual([
      ['total', 2, 4],
      ['format', 5, 7],
      ['add', 10, 13],
    ]);
  });

  it('reads Python functions by indentation', () => {
    const source = `def load(path):
    # comment
    with open(path) as handle:
        return handle.read()

def save(path, text):
    pass
`;
    expect(
      findFunctions('io.py', source).map((fn) => [
        fn.name,
        fn.startLine,
        fn.endLine,
      ]),
    ).toEqual([
      ['load', 1, 4],
      ['save', 6, 7],
    ]);
  });
});

const body = (name: string, field: string, limit: number, extra = '') => `
function ${name}(rows) {
  const result = [];
  for (const row of rows) {
    if (row.${field} === undefined) continue;
    if (row.${field} > ${limit}) {
      result.push({ id: row.id, value: row.${field} });
    }${extra}
  }
  return result.sort((a, b) => a.value - b.value);
}
`;

describe('compareFunctions', () => {
  it('names identical copies, renamed copies, and near copies apart', () => {
    const fns = [
      ...findFunctions('a.js', body('overBudget', 'cost', 100)),
      ...findFunctions('b.js', body('overBudgetCopy', 'cost', 100)),
      ...findFunctions('c.js', body('heavyItems', 'weight', 20)),
      ...findFunctions(
        'd.js',
        body('lateOrders', 'cost', 100, '\n    else console.log(row.id);'),
      ),
    ];
    const pairs = compareFunctions(fns);
    const pairOf = (x: string, y: string) =>
      pairs.find(
        (pair) =>
          [pair.a.name, pair.b.name].sort().join() === [x, y].sort().join(),
      );
    const kind = (x: string, y: string) => pairOf(x, y)?.kind;
    // Same tokens, different name: the name is not what it does.
    expect(kind('overBudget', 'overBudgetCopy')).toBe('identical');
    // Same shape, different field and limit: one function with parameters.
    expect(kind('overBudget', 'heavyItems')).toBe('renamed');
    // One extra branch: nearly the same.
    expect(kind('overBudget', 'lateOrders')).toBe('near');
    const near = pairOf('overBudget', 'lateOrders')!;
    expect(near.diff).toContain('+    else console.log(row.id);');
    expect(near.differingLines).toBe(1);
  });

  it('leaves small and unrelated functions alone', () => {
    const fns = [
      ...findFunctions('a.js', 'function one() {\n  return 1;\n}\n'),
      ...findFunctions('b.js', 'function two() {\n  return 2;\n}\n'),
      ...findFunctions('c.js', body('overBudget', 'cost', 100)),
      ...findFunctions(
        'd.js',
        `function parse(text) {
  const lines = text.split('\\n');
  const out = new Map();
  lines.forEach((line, index) => {
    const [key, value] = line.split('=');
    if (!key) throw new Error('bad line ' + index);
    out.set(key.trim(), value?.trim() ?? '');
  });
  return out;
}`,
      ),
    ];
    expect(compareFunctions(fns)).toEqual([]);
  });

  it('puts pairs in files the agents changed first, and tests last', () => {
    const fns = [
      ...findFunctions('src/a.js', body('alpha', 'cost', 1)),
      ...findFunctions('src/b.js', body('beta', 'cost', 1)),
      ...findFunctions('test/a.test.js', body('gamma', 'cost', 1)),
      ...findFunctions('test/b.test.js', body('delta', 'cost', 1)),
      ...findFunctions('lib/c.js', body('epsilon', 'size', 9)),
      ...findFunctions('lib/d.js', body('zeta', 'size', 9)),
    ];
    const pairs = compareFunctions(fns, new Set(['lib/c.js']));
    expect(pairs[0]!.touched).toBe(true);
    expect(pairs.at(-1)!.inTests).toBe(true);
  });
});

describe('similarFunctions', () => {
  it('walks the folder, skipping dependencies and generated files', () => {
    const root = folder();
    mkdirSync(join(root, 'src'));
    mkdirSync(join(root, 'node_modules'));
    writeFileSync(join(root, 'src', 'a.ts'), body('first', 'cost', 5));
    writeFileSync(join(root, 'src', 'b.ts'), body('second', 'cost', 5));
    writeFileSync(join(root, 'node_modules', 'c.js'), body('dep', 'cost', 5));
    writeFileSync(join(root, 'src', 'types.d.ts'), body('decl', 'cost', 5));
    const result = similarFunctions(root);
    expect(result.files).toBe(2);
    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0]).toMatchObject({
      kind: 'identical',
      a: { path: 'src/a.ts', name: 'first', startLine: 2 },
      b: { path: 'src/b.ts', name: 'second' },
    });
  });
});

describe('git history', () => {
  const git = (root: string, ...args: string[]) =>
    execFileSync(
      'git',
      ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args],
      { cwd: root, stdio: 'pipe' },
    );

  it('lists commits that touched the folder and shows their diffs', async () => {
    const root = folder();
    git(root, 'init', '-q');
    writeFileSync(join(root, 'app.js'), 'const a = 1;\n');
    git(root, 'add', '.');
    git(root, 'commit', '-q', '-m', 'First');
    writeFileSync(join(root, 'app.js'), 'const a = 2;\nconst b = 3;\n');
    writeFileSync(join(root, 'notes.md'), '# Notes\n');
    git(root, 'add', '.');
    git(root, 'commit', '-q', '-m', 'Second change');

    const { available, commits } = await listCommits(root);
    expect(available).toBe(true);
    expect(commits.map((commit) => commit.subject)).toEqual([
      'Second change',
      'First',
    ]);
    expect(commits[0]!.files).toEqual(['app.js', 'notes.md']);
    expect(commits[0]!.author).toBe('Test');

    const shown = await commitDiff(root, commits[0]!.sha);
    expect(
      shown.files.map((file) => [file.path, file.added, file.removed]),
    ).toEqual([
      ['app.js', 2, 1],
      ['notes.md', 1, 0],
    ]);
    expect(shown.files[0]!.diff).toMatch(/^@@ -1 \+1,2 @@/);
    expect(shown.files[0]!.diff).toContain('+const b = 3;');
  });

  it('is honest about a folder that is not a repository', async () => {
    expect(await listCommits(folder())).toEqual({
      available: false,
      commits: [],
      reason: 'This folder is not a git repository.',
    });
  });

  it('refuses anything that is not a commit id', async () => {
    await expect(commitDiff(folder(), 'HEAD; rm -rf /')).rejects.toThrow(
      /not a commit id/,
    );
  });
});
