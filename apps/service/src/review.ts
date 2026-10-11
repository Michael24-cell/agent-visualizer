import { execFile } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { promisify } from 'node:util';
import { lineDiff } from '@harness/runtime-openai';

// What a reviewer needs from the folder itself: functions that do nearly
// the same thing, and the git history of what changed. Everything here is
// read-only. The heuristics are deliberately plain so their findings can
// be explained in a sentence — a finding is a prompt to look, not a
// verdict.

const SOURCE = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.py']);
const SKIP_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.turbo',
  'vendor',
  '__pycache__',
  '.venv',
  'venv',
]);
const MAX_FILES = 1_500;
const MAX_FILE_BYTES = 400_000;
const MAX_FUNCTIONS = 5_000;
// Below this many tokens a function is a one-liner; similar one-liners
// are normal and not worth a reviewer's time.
const MIN_TOKENS = 30;
const SHINGLE = 3;
const NEAR_THRESHOLD = 0.8;
// A shingle shared by this many functions says nothing (think "return
// null ;"), so it is not used to find candidates.
const COMMON_SHINGLE = 40;
const MAX_PAIRS = 60;

// ---------------------------------------------------------------------------
// Finding functions
// ---------------------------------------------------------------------------

export interface FoundFunction {
  readonly name: string;
  readonly path: string;
  // 1-based, inclusive.
  readonly startLine: number;
  readonly endLine: number;
  readonly text: string;
}

// Two blanked copies of the source, same length and line breaks as the
// original: one without comments (for tokens), one without comments or
// strings (for structure, so a brace in a string cannot mislead it).
export function maskSource(source: string): {
  noComments: string;
  code: string;
} {
  const noComments = source.split('');
  const code = source.split('');
  const blank = (array: string[], from: number, to: number) => {
    for (let k = from; k < to; k += 1) {
      if (array[k] !== '\n') array[k] = ' ';
    }
  };
  let i = 0;
  let previous = '';
  while (i < source.length) {
    const c = source[i]!;
    const next = source[i + 1];
    if (c === '/' && next === '/') {
      const end = source.indexOf('\n', i);
      const stop = end < 0 ? source.length : end;
      blank(noComments, i, stop);
      blank(code, i, stop);
      i = stop;
      continue;
    }
    if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end < 0 ? source.length : end + 2;
      blank(noComments, i, stop);
      blank(code, i, stop);
      i = stop;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      let k = i + 1;
      let depth = 0;
      while (k < source.length) {
        const d = source[k]!;
        if (d === '\\') {
          k += 2;
          continue;
        }
        if (c === '`' && d === '$' && source[k + 1] === '{') depth += 1;
        else if (c === '`' && depth > 0 && d === '}') depth -= 1;
        else if (d === c && depth === 0) break;
        else if (d === '\n' && c !== '`') break;
        k += 1;
      }
      blank(code, i + 1, Math.min(k, source.length));
      i = k + 1;
      previous = c;
      continue;
    }
    // A regex literal where an operand is expected: blank it from code
    // so its braces and quotes do not count.
    if (c === '/' && /[(,=:[!&|?{};]|^$/.test(previous)) {
      let k = i + 1;
      let inClass = false;
      while (k < source.length && source[k] !== '\n') {
        const d = source[k]!;
        if (d === '\\') {
          k += 2;
          continue;
        }
        if (d === '[') inClass = true;
        else if (d === ']') inClass = false;
        else if (d === '/' && !inClass) break;
        k += 1;
      }
      if (source[k] === '/') {
        blank(code, i + 1, k);
        i = k + 1;
        previous = '/';
        continue;
      }
    }
    if (!/\s/.test(c)) previous = c;
    i += 1;
  }
  return { noComments: noComments.join(''), code: code.join('') };
}

const KEYWORDS = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'return',
  'function',
  'with',
  'constructor',
  'super',
  'import',
  'typeof',
  'await',
  'new',
  'do',
  'else',
  'try',
]);

function matching(code: string, open: number): number {
  const pairs: Record<string, string> = { '(': ')', '{': '}', '[': ']' };
  const close = pairs[code[open]!];
  if (!close) return -1;
  let depth = 0;
  for (let k = open; k < code.length; k += 1) {
    const c = code[k];
    if (c === code[open]) depth += 1;
    else if (c === close) {
      depth -= 1;
      if (depth === 0) return k;
    }
  }
  return -1;
}

// After a parameter list: skip a return type, then find the body's '{'.
// Arrow functions with an expression body have none and are skipped.
function bodyStart(code: string, afterParams: number): number {
  let k = afterParams;
  const skipSpace = () => {
    while (k < code.length && /\s/.test(code[k]!)) k += 1;
  };
  skipSpace();
  if (code[k] === ':') {
    k += 1;
    // A type: balanced brackets and anything else up to '{' or '=>' at
    // depth zero. An object type in braces comes first, then the body.
    let depth = 0;
    for (; k < code.length; k += 1) {
      const c = code[k]!;
      if (c === '(' || c === '[' || c === '<') depth += 1;
      else if (c === ')' || c === ']' || (c === '>' && code[k - 1] !== '=')) {
        depth -= 1;
      } else if (depth === 0 && c === '{') {
        // An object type is followed by '{' or '=>'; a body is not.
        const end = matching(code, k);
        if (end < 0) return -1;
        const after = code.slice(end + 1).trimStart();
        if (after.startsWith('{') || after.startsWith('=>')) {
          k = end;
          continue;
        }
        return k;
      } else if (depth === 0 && c === '=' && code[k + 1] === '>') break;
      else if (depth === 0 && (c === ';' || c === '\n')) {
        if (c === ';') return -1;
      }
    }
  }
  skipSpace();
  if (code[k] === '=' && code[k + 1] === '>') {
    k += 2;
    skipSpace();
  }
  return code[k] === '{' ? k : -1;
}

function lineAt(text: string, index: number): number {
  let line = 1;
  for (let k = 0; k < index; k += 1) if (text[k] === '\n') line += 1;
  return line;
}

const DECLARATIONS = [
  // function name(  /  async function* name<T>(
  /\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)\s*(?:<[^>()]*>)?\s*\(/g,
  // const name = (…) =>  /  const name = async function (…)
  /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;\n]+)?=\s*(?:async\s+)?(?:function\b\s*\*?\s*[\w$]*\s*)?(?:<[^>()]*>)?\s*\(/g,
  // name(…) {  at the start of a line: class and object methods
  /^[ \t]*(?:(?:public|private|protected|static|async|readonly|override|get|set)\s+)*\*?\s*([A-Za-z_$][\w$]*)\s*(?:<[^>()]*>)?\s*\(/gm,
];

export function findFunctions(path: string, source: string): FoundFunction[] {
  if (extname(path) === '.py') return findPythonFunctions(path, source);
  const { code, noComments } = maskSource(source);
  const found = new Map<number, FoundFunction>();
  for (const pattern of DECLARATIONS) {
    pattern.lastIndex = 0;
    for (const match of code.matchAll(pattern)) {
      const name = match[1]!;
      if (KEYWORDS.has(name)) continue;
      const paren = match.index + match[0].length - 1;
      const closeParen = matching(code, paren);
      if (closeParen < 0) continue;
      const open = bodyStart(code, closeParen + 1);
      if (open < 0 || found.has(open)) continue;
      const close = matching(code, open);
      if (close < 0) continue;
      const start =
        match.index + (match[0].length - match[0].trimStart().length);
      found.set(open, {
        name,
        path,
        startLine: lineAt(source, start),
        endLine: lineAt(source, close),
        text: noComments.slice(start, close + 1),
      });
    }
  }
  return [...found.values()].sort((a, b) => a.startLine - b.startLine);
}

function findPythonFunctions(path: string, source: string): FoundFunction[] {
  const lines = source.split('\n');
  const found: FoundFunction[] = [];
  lines.forEach((line, index) => {
    const match = /^(\s*)(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/.exec(line);
    if (!match) return;
    const indent = match[1]!.length;
    let end = index;
    for (let k = index + 1; k < lines.length; k += 1) {
      const next = lines[k]!;
      if (!next.trim()) continue;
      if (next.length - next.trimStart().length <= indent) break;
      end = k;
    }
    found.push({
      name: match[2]!,
      path,
      startLine: index + 1,
      endLine: end + 1,
      text: lines
        .slice(index, end + 1)
        .map((text) => text.replace(/#.*$/, ''))
        .join('\n'),
    });
  });
  return found;
}

// ---------------------------------------------------------------------------
// Comparing them
// ---------------------------------------------------------------------------

const TOKEN =
  /[A-Za-z_$][\w$]*|\d[\d_.]*(?:e[+-]?\d+)?|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|=>|===|!==|==|!=|<=|>=|&&|\|\||\?\?|\?\.|\.\.\.|[^\s\w]/g;

const LANGUAGE_WORDS = new Set([
  ...KEYWORDS,
  'const',
  'let',
  'var',
  'async',
  'of',
  'in',
  'true',
  'false',
  'null',
  'undefined',
  'this',
  'throw',
  'break',
  'continue',
  'case',
  'default',
  'export',
  'class',
  'extends',
  'instanceof',
  'void',
  'yield',
  'def',
  'self',
  'None',
  'True',
  'False',
  'and',
  'or',
  'not',
  'is',
  'lambda',
  'pass',
  'raise',
  'elif',
  'except',
  'finally',
  'public',
  'private',
  'protected',
  'static',
  'readonly',
  'override',
  'get',
  'set',
]);

export function tokensOf(text: string): { raw: string[]; shape: string[] } {
  const raw = text.match(TOKEN) ?? [];
  // The shape: what is left when every name and literal is a blank.
  // Two functions with the same shape are one function with parameters.
  const shape = raw.map((token) => {
    if (/^["'`]/.test(token)) return 'S';
    if (/^\d/.test(token)) return 'N';
    if (/^[A-Za-z_$]/.test(token) && !LANGUAGE_WORDS.has(token)) return 'I';
    return token;
  });
  // The name itself is not part of what the function does.
  const nameAt = raw.findIndex((token) => !LANGUAGE_WORDS.has(token));
  if (nameAt >= 0) {
    raw.splice(nameAt, 1);
    shape.splice(nameAt, 1);
  }
  return { raw, shape };
}

function shingles(tokens: readonly string[]): Set<string> {
  const set = new Set<string>();
  for (let k = 0; k + SHINGLE <= tokens.length; k += 1) {
    set.add(tokens.slice(k, k + SHINGLE).join('\u0001'));
  }
  return set;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1;
  let both = 0;
  for (const item of a) if (b.has(item)) both += 1;
  return both / (a.size + b.size - both);
}

function dedent(text: string): string {
  const lines = text.split('\n');
  const indents = lines
    .slice(1)
    .filter((line) => line.trim())
    .map((line) => line.length - line.trimStart().length);
  const cut = indents.length ? Math.min(...indents) : 0;
  return lines
    .map((line, index) => (index === 0 ? line.trimStart() : line.slice(cut)))
    .join('\n');
}

export type SimilarKind = 'identical' | 'renamed' | 'near';

export interface SimilarPair {
  readonly kind: SimilarKind;
  // 0..1, how much of the two functions' shape they share.
  readonly similarity: number;
  readonly a: Omit<FoundFunction, 'text'>;
  readonly b: Omit<FoundFunction, 'text'>;
  // Lines that differ, a's text to b's, as a line diff.
  readonly diff: string;
  readonly differingLines: number;
  // Either side is in a file the agents changed.
  readonly touched: boolean;
  // Both sides are tests, where repetition is often on purpose.
  readonly inTests: boolean;
}

const TEST_FILE =
  /(^|\/)(__tests__|tests?)\/|\.(test|spec)\.[jt]sx?$|(^|\/)test_[^/]+\.py$|_test\.py$/;

export function compareFunctions(
  functions: readonly FoundFunction[],
  touchedPaths: ReadonlySet<string> = new Set(),
): SimilarPair[] {
  const prepared = functions
    .map((fn) => {
      const tokens = tokensOf(fn.text);
      return { fn, tokens, shapeSet: shingles(tokens.shape) };
    })
    .filter((entry) => entry.tokens.shape.length >= MIN_TOKENS);

  // Candidates share enough uncommon shingles to be worth comparing.
  const index = new Map<string, number[]>();
  prepared.forEach((entry, at) => {
    for (const shingle of entry.shapeSet) {
      const list = index.get(shingle);
      if (list) list.push(at);
      else index.set(shingle, [at]);
    }
  });
  const shared = new Map<string, number>();
  for (const list of index.values()) {
    if (list.length < 2 || list.length > COMMON_SHINGLE) continue;
    for (let x = 0; x < list.length; x += 1) {
      for (let y = x + 1; y < list.length; y += 1) {
        const key = `${list[x]}:${list[y]}`;
        shared.set(key, (shared.get(key) ?? 0) + 1);
      }
    }
  }

  const pairs: SimilarPair[] = [];
  for (const [key, count] of shared) {
    const [x, y] = key.split(':').map(Number) as [number, number];
    const left = prepared[x]!;
    const right = prepared[y]!;
    const smaller = Math.min(left.shapeSet.size, right.shapeSet.size);
    if (count < smaller * NEAR_THRESHOLD * 0.8) continue;
    // A function nested inside the other is not a duplicate of it.
    if (
      left.fn.path === right.fn.path &&
      left.fn.startLine <= right.fn.endLine &&
      right.fn.startLine <= left.fn.endLine
    ) {
      continue;
    }
    const sameRaw = left.tokens.raw.join(' ') === right.tokens.raw.join(' ');
    const sameShape =
      left.tokens.shape.join(' ') === right.tokens.shape.join(' ');
    const similarity = jaccard(left.shapeSet, right.shapeSet);
    if (!sameRaw && !sameShape && similarity < NEAR_THRESHOLD) continue;
    // Line the names up first: a different name is not a difference in
    // what the code does, and the reader already sees both names.
    const [rightHead = '', ...rightRest] = dedent(right.fn.text).split('\n');
    const aligned = [
      rightHead.replace(right.fn.name, left.fn.name),
      ...rightRest,
    ].join('\n');
    const diff = lineDiff(dedent(left.fn.text), aligned);
    const strip = (fn: FoundFunction) => ({
      name: fn.name,
      path: fn.path,
      startLine: fn.startLine,
      endLine: fn.endLine,
    });
    pairs.push({
      kind: sameRaw ? 'identical' : sameShape ? 'renamed' : 'near',
      similarity: Math.round(similarity * 100) / 100,
      a: strip(left.fn),
      b: strip(right.fn),
      diff,
      differingLines: diff
        .split('\n')
        .filter((line) => line.startsWith('+') || line.startsWith('-')).length,
      touched:
        touchedPaths.has(left.fn.path) || touchedPaths.has(right.fn.path),
      inTests: TEST_FILE.test(left.fn.path) && TEST_FILE.test(right.fn.path),
    });
  }
  const rank = (pair: SimilarPair) =>
    (pair.touched ? 4 : 0) + (pair.inTests ? 0 : 2) + pair.similarity;
  return pairs.sort((p, q) => rank(q) - rank(p)).slice(0, MAX_PAIRS);
}

export function similarFunctions(
  root: string,
  touchedPaths: ReadonlySet<string> = new Set(),
): {
  pairs: SimilarPair[];
  files: number;
  functions: number;
  truncated: boolean;
} {
  const functions: FoundFunction[] = [];
  let files = 0;
  let truncated = false;
  const walk = (directory: string) => {
    if (files >= MAX_FILES || functions.length >= MAX_FUNCTIONS) {
      truncated = true;
      return;
    }
    let entries: string[];
    try {
      entries = readdirSync(directory);
    } catch {
      return;
    }
    for (const entry of entries.sort()) {
      if (entry.startsWith('.') && entry !== '.') continue;
      const full = join(directory, entry);
      let stats;
      try {
        stats = statSync(full);
      } catch {
        continue;
      }
      if (stats.isDirectory()) {
        if (!SKIP_DIRECTORIES.has(entry)) walk(full);
        continue;
      }
      if (
        !SOURCE.has(extname(entry)) ||
        entry.endsWith('.d.ts') ||
        entry.endsWith('.min.js') ||
        stats.size > MAX_FILE_BYTES
      ) {
        continue;
      }
      if (files >= MAX_FILES) {
        truncated = true;
        return;
      }
      files += 1;
      let source: string;
      try {
        source = readFileSync(full, 'utf8');
      } catch {
        continue;
      }
      // Generated or minified: one huge line says nothing about design.
      if (source.split('\n').some((line) => line.length > 1_000)) continue;
      functions.push(
        ...findFunctions(relative(root, full), source).slice(
          0,
          MAX_FUNCTIONS - functions.length,
        ),
      );
    }
  };
  walk(root);
  return {
    pairs: compareFunctions(functions, touchedPaths),
    files,
    functions: functions.length,
    truncated,
  };
}

// ---------------------------------------------------------------------------
// Git history, read-only
// ---------------------------------------------------------------------------

const run = promisify(execFile);
const SHA = /^[0-9a-f]{7,40}$/;
const FILE_DIFF_MAX = 20_000;

export interface CommitSummary {
  readonly sha: string;
  readonly short: string;
  readonly author: string;
  readonly at: string;
  readonly subject: string;
  // Paths only: line counts need a content diff per commit, which is the
  // slow part on a large repository, so they come with commitDiff.
  readonly files: readonly string[];
}

export interface CommitFile {
  readonly path: string;
  readonly diff: string;
  readonly added: number;
  readonly removed: number;
}

// git with fixed arguments, no shell, inside the folder, limited to it.
async function git(root: string, args: readonly string[]): Promise<string> {
  const { stdout } = await run(
    'git',
    ['-c', 'core.quotepath=off', '--no-pager', ...args],
    {
      cwd: root,
      timeout: 30_000,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, GIT_PAGER: 'cat', LC_ALL: 'C' },
    },
  );
  return stdout;
}

// Why git could not answer, in a sentence, from what it printed.
function gitReason(error: unknown): string {
  const failure = error as NodeJS.ErrnoException & {
    stderr?: string;
    killed?: boolean;
  };
  if (failure.code === 'ENOENT') return 'git is not installed or not on PATH.';
  if (failure.killed) return 'git took too long to answer.';
  const said = (failure.stderr || failure.message || '').trim();
  if (/not a git repository/i.test(said)) {
    return 'This folder is not a git repository.';
  }
  if (/does not have any commits/i.test(said)) {
    return 'This repository has no commits yet.';
  }
  return said.split('\n')[0]!.slice(0, 200) || 'git could not read history.';
}

export async function listCommits(
  root: string,
  limit = 40,
): Promise<{
  available: boolean;
  commits: CommitSummary[];
  reason?: string;
}> {
  let out: string;
  try {
    out = await git(root, [
      'log',
      `-n${Math.min(Math.max(limit, 1), 200)}`,
      '--no-color',
      '--format=%x1e%H%x1f%h%x1f%an%x1f%aI%x1f%s',
      '--name-only',
      '--',
      '.',
    ]);
  } catch (error) {
    // Not a repository, no commits yet, or no git: say which.
    return { available: false, commits: [], reason: gitReason(error) };
  }
  const commits = out
    .split('\x1e')
    .filter((record) => record.trim())
    .map((record) => {
      const [head = '', ...rest] = record.split('\n');
      const [sha = '', short = '', author = '', at = '', subject = ''] =
        head.split('\x1f');
      const files = rest.filter((line) => line.trim());
      return { sha, short, author, at, subject, files };
    });
  return { available: true, commits };
}

export async function commitDiff(
  root: string,
  sha: string,
): Promise<{ sha: string; files: CommitFile[] }> {
  if (!SHA.test(sha)) throw new Error('That is not a commit id.');
  const stats = new Map<string, { added: number; removed: number }>();
  for (const line of (
    await git(root, [
      'show',
      '--no-color',
      '--format=',
      '--numstat',
      sha,
      '--',
      '.',
    ])
  ).split('\n')) {
    const [added, removed, ...path] = line.split('\t');
    if (!path.length) continue;
    // '-' is git's word for a binary file.
    stats.set(path.join('\t'), {
      added: Number(added) || 0,
      removed: Number(removed) || 0,
    });
  }
  const out = await git(root, [
    'show',
    '--no-color',
    '--no-ext-diff',
    '--format=',
    '-U3',
    sha,
    '--',
    '.',
  ]);
  const files: CommitFile[] = [];
  for (const chunk of out.split(/^diff --git /m).slice(1)) {
    const header = /^a\/(.+?) b\/(.+)$/m.exec(chunk);
    const path = header?.[2] ?? 'unknown';
    const hunk = chunk.indexOf('\n@@');
    const body =
      hunk >= 0
        ? chunk.slice(hunk + 1)
        : /Binary files/.test(chunk)
          ? '(binary file)'
          : '(no text changes)';
    files.push({
      path,
      diff:
        body.length > FILE_DIFF_MAX
          ? `${body.slice(0, FILE_DIFF_MAX)}\n(diff truncated)`
          : body.replace(/\n$/, ''),
      added: stats.get(path)?.added ?? 0,
      removed: stats.get(path)?.removed ?? 0,
    });
  }
  return { sha, files };
}
