import { readFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { AgentTask } from '@harness/contracts';
import { lineDiff } from '@harness/runtime-openai';
import { git, gitReason } from './review.js';

// Work done by an agent tool outside the harness (Claude Code, Codex…)
// through the MCP server. The tool says what it did; git says what
// actually changed. Both are recorded, and where they disagree the
// difference is said out loud.

export const OUTSIDE_ADAPTER = {
  id: 'mcp',
  version: '1',
  mode: 'live',
} as const;

// More changed files than this are listed by count, not each recorded.
export const OUTSIDE_FILES_MAX = 40;
const FILE_BYTES_MAX = 200_000;

export async function headCommit(root: string): Promise<string | undefined> {
  try {
    const sha = (await git(root, ['rev-parse', 'HEAD'])).trim();
    return /^[0-9a-f]{7,40}$/.test(sha) ? sha : undefined;
  } catch {
    return undefined;
  }
}

export interface ChangedFile {
  readonly path: string;
  readonly status: 'added' | 'modified' | 'deleted' | 'renamed';
  readonly diff: string;
}

export type FolderChanges =
  | {
      readonly available: true;
      readonly files: readonly ChangedFile[];
      // Changed files beyond OUTSIDE_FILES_MAX, counted only.
      readonly more: number;
    }
  | { readonly available: false; readonly reason: string };

const STATUS: Record<string, ChangedFile['status']> = {
  A: 'added',
  M: 'modified',
  D: 'deleted',
  R: 'renamed',
  C: 'added',
  T: 'modified',
};

// The hunks of one file's git diff, without the header lines, in the same
// shape agent outputs use.
function hunksOnly(diff: string): string {
  const at = diff.indexOf('\n@@');
  if (diff.startsWith('@@')) return diff.trimEnd();
  return at < 0 ? '' : diff.slice(at + 1).trimEnd();
}

// What changed in the folder since `base` (a commit), committed or not,
// plus new files git does not track yet. Without a base, since HEAD.
export async function changesSince(
  root: string,
  base: string | undefined,
): Promise<FolderChanges> {
  const from = base ?? (await headCommit(root));
  const entries: { path: string; status: ChangedFile['status'] }[] = [];
  try {
    if (from) {
      const out = await git(root, ['diff', '--name-status', '-M', from, '--']);
      for (const line of out.split('\n')) {
        if (!line.trim()) continue;
        const [code, ...paths] = line.split('\t');
        const path = paths.at(-1);
        if (!path) continue;
        entries.push({ path, status: STATUS[code![0]!] ?? 'modified' });
      }
    }
    const untracked = await git(root, [
      'ls-files',
      '--others',
      '--exclude-standard',
    ]);
    for (const path of untracked.split('\n')) {
      if (path.trim()) entries.push({ path, status: 'added' });
    }
  } catch (error) {
    return { available: false, reason: gitReason(error) };
  }
  const files: ChangedFile[] = [];
  for (const entry of entries.slice(0, OUTSIDE_FILES_MAX)) {
    files.push({ ...entry, diff: await fileDiff(root, from, entry) });
  }
  return {
    available: true,
    files,
    more: Math.max(0, entries.length - OUTSIDE_FILES_MAX),
  };
}

async function fileDiff(
  root: string,
  from: string | undefined,
  entry: { path: string; status: ChangedFile['status'] },
): Promise<string> {
  try {
    if (from && entry.status !== 'added') {
      return hunksOnly(await git(root, ['diff', from, '--', entry.path]));
    }
    if (from) {
      // Added since base: committed (git knows it) or untracked.
      const tracked = hunksOnly(
        await git(root, ['diff', from, '--', entry.path]),
      );
      if (tracked) return tracked;
    }
    const full = resolve(root, entry.path);
    const inside = relative(root, full);
    if (inside.startsWith('..') || isAbsolute(inside)) return '';
    const content = await readFile(join(root, inside), 'utf8');
    if (content.length > FILE_BYTES_MAX || content.includes('\0')) return '';
    return lineDiff('', content);
  } catch {
    return '';
  }
}

export function diffCounts(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+')) added += 1;
    else if (line.startsWith('-')) removed += 1;
  }
  return { added, removed };
}

// How the tool's own account compares with git, in a sentence or two.
export function compareWithGit(
  client: string,
  changes: FolderChanges,
  claimed: readonly string[] | undefined,
): string {
  if (!changes.available) {
    return `Could not check ${client}'s report against git: ${changes.reason}`;
  }
  const actual = changes.files.map((file) => file.path);
  const total = actual.length + changes.more;
  const counted =
    total === 0
      ? 'Git shows no changed files.'
      : `Git shows ${total} changed ${total === 1 ? 'file' : 'files'}.`;
  if (!claimed) return counted;
  const said = new Set(claimed.map((path) => path.replace(/^\.\//, '')));
  const unmentioned = actual.filter((path) => !said.has(path));
  const unchanged = [...said].filter(
    (path) => !actual.includes(path) && changes.more === 0,
  );
  const parts = [counted];
  if (unmentioned.length) {
    parts.push(`Not in ${client}'s report: ${unmentioned.join(', ')}.`);
  }
  if (unchanged.length) {
    parts.push(
      `Reported as changed but git shows no change: ${unchanged.join(', ')}.`,
    );
  }
  if (!unmentioned.length && !unchanged.length && total > 0) {
    parts.push(`It matches ${client}'s report.`);
  }
  return parts.join(' ');
}

// What an outside tool is told about a task: the same words a harness
// agent gets, plus how to report back.
export function outsideBrief(
  task: AgentTask,
  context: {
    readonly projectName: string;
    readonly folder: string;
    readonly overview: readonly string[];
    readonly upstream: readonly string[];
  },
): string {
  const list = (label: string, items: readonly string[]) =>
    items.length
      ? `${label}:\n${items.map((item) => `- ${item}`).join('\n')}\n\n`
      : '';
  return (
    `Task: ${task.title}\n\n${task.objective}\n\n` +
    `Project: ${context.projectName}\nFolder: ${context.folder}\n\n` +
    list('Overview', context.overview) +
    list('Done before this', context.upstream) +
    list('Scope', task.scope) +
    list('Expected outputs', task.expectedOutputs) +
    list('Checks that must pass', task.requiredChecks) +
    'Work only inside the folder. For each required check, run a command that verifies it (tests, a typecheck, a build) and report it under that exact name. ' +
    `When you finish, call report_task with task_id "${task.id}", what changed, the checks you ran, and the files you changed. If you cannot finish, report it as failed and say why.`
  ).trim();
}
