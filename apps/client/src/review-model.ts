import {
  costOf,
  type PlanSectionId,
  type ProjectEvent,
  type ProjectResponse,
} from '@harness/contracts';
import { parseDiff } from './diff-rows';

// Review: every file change the agents made, each with the facts a
// reviewer needs — who, in which task, what they said just before, what
// it serves in the Plan, whether anything was run after — and flags that
// say what deserves a second look. Derived from the event log, so it
// agrees with the conversation and the Changes ledger by construction.

export type FlagKind =
  | 'failed-check'
  | 'unverified'
  | 'possible-secret'
  | 'leftover'
  | 'tests-edited'
  | 'shared-file'
  | 'large'
  | 'mostly-deletion';

// What each flag means and what to do about it, written to teach: the
// same text shows beside every flag and in the guide.
export const FLAG_GUIDE: Record<
  FlagKind,
  { readonly title: string; readonly why: string; readonly next: string }
> = {
  'failed-check': {
    title: 'A check failed after this',
    why: 'Something ran after this change and did not pass. The change may be the cause.',
    next: 'Open the failing check in the conversation, then ask the agent to fix it or explain why it is unrelated.',
  },
  unverified: {
    title: 'Nothing was run after this',
    why: 'No test, build or command ran after the change, so nothing confirms it works.',
    next: 'Ask the agent to run the project’s tests, or run them yourself.',
  },
  'possible-secret': {
    title: 'Looks like a secret',
    why: 'An added line matches the shape of an API key, token, password or private key. Secrets in code end up in history and in other people’s hands.',
    next: 'Move it to an environment variable or .env.local, and rotate the key if it was ever real.',
  },
  leftover: {
    title: 'Debug or TODO left in',
    why: 'An added line has a console.log, print, debugger, or a TODO/FIXME. Usually fine while working; usually not what you want to keep.',
    next: 'Remove it, or turn the TODO into a Plan line so it is not lost.',
  },
  'tests-edited': {
    title: 'A test was changed, not just added',
    why: 'Lines were removed from a test. Changing a test can make failing code pass — sometimes rightly, sometimes not.',
    next: 'Read the removed lines and decide whether the test was wrong or the code is.',
  },
  'shared-file': {
    title: 'More than one agent changed this file',
    why: 'Two agents editing the same file can undo each other’s work without either noticing.',
    next: 'Compare their changes in Sessions, and give one agent ownership of the file.',
  },
  large: {
    title: 'Large change',
    why: 'Big diffs hide small mistakes. Review gets less careful as length grows.',
    next: 'Read it in pieces, or ask the agent to explain it section by section.',
  },
  'mostly-deletion': {
    title: 'Mostly removes code',
    why: 'Far more was removed than added. Deletion is often right, but it is the change that is hardest to notice is wrong.',
    next: 'Check that nothing still depended on what was removed.',
  },
};

// Worst first, so a list of flags reads in order of concern.
const FLAG_ORDER: readonly FlagKind[] = [
  'failed-check',
  'possible-secret',
  'unverified',
  'tests-edited',
  'shared-file',
  'leftover',
  'mostly-deletion',
  'large',
];

export interface Flag {
  readonly kind: FlagKind;
  // New-file line numbers the flag is about, when it is about lines.
  readonly lines?: readonly number[];
}

export interface ReviewChange {
  readonly id: string;
  // 1-based position across the project: "step 4".
  readonly step: number;
  readonly sequence: number;
  readonly at: string;
  readonly path: string;
  readonly diff: string;
  readonly added: number;
  readonly removed: number;
  readonly agentId: string;
  readonly agentName: string;
  readonly taskId: string;
  readonly taskTitle: string;
  readonly sections: readonly PlanSectionId[];
  // What the agent said in this task just before the change.
  readonly said?: string;
  readonly check: 'passed' | 'failed' | 'none';
  readonly flags: readonly Flag[];
}

export interface ReviewSession {
  readonly taskId: string;
  readonly agentId: string;
  readonly agentName: string;
  readonly title: string;
  readonly state: string;
  readonly startedAt?: string;
  readonly endedAt?: string;
  readonly changes: readonly ReviewChange[];
  readonly checks: readonly { name: string; state: string }[];
  readonly tokens: { readonly input: number; readonly output: number };
  // List price; undefined when a model is not in the table.
  readonly cost?: number;
  readonly onPlan: boolean;
}

export interface Review {
  readonly changes: readonly ReviewChange[];
  readonly sessions: readonly ReviewSession[];
}

const TEST_FILE =
  /(^|\/)(__tests__|tests?)\/|\.(test|spec)\.[jt]sx?$|(^|\/)test_[^/]+\.py$|_test\.py$/;
const LEFTOVER =
  /\b(TODO|FIXME|HACK|XXX)\b|console\.(log|debug|trace)\(|\bdebugger\b|^\s*print\(/;
const SECRET =
  /sk-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|(api[_-]?key|secret|password|passwd|token)["']?\s*[:=]\s*["'][^"'\s]{8,}["']/i;
const LARGE = 150;

function flagsFor(
  path: string,
  diff: string,
  check: ReviewChange['check'],
  sharedPaths: ReadonlySet<string>,
): Flag[] {
  const rows = parseDiff(diff);
  const added = rows.filter((row) => row.kind === 'add');
  const removed = rows.filter((row) => row.kind === 'del').length;
  const linesMatching = (pattern: RegExp) =>
    added
      .filter((row) => pattern.test(row.text))
      .map((row) => row.newLine)
      .filter((line): line is number => line !== undefined);
  const flags: Flag[] = [];
  const hit = (kind: FlagKind, pattern: RegExp) => {
    if (!added.some((row) => pattern.test(row.text))) return;
    const lines = linesMatching(pattern);
    flags.push(lines.length ? { kind, lines } : { kind });
  };
  if (check === 'failed') flags.push({ kind: 'failed-check' });
  if (check === 'none') flags.push({ kind: 'unverified' });
  hit('possible-secret', SECRET);
  hit('leftover', LEFTOVER);
  if (TEST_FILE.test(path) && removed > 0) flags.push({ kind: 'tests-edited' });
  if (sharedPaths.has(path)) flags.push({ kind: 'shared-file' });
  if (added.length + removed > LARGE) flags.push({ kind: 'large' });
  if (removed > 40 && removed > added.length * 2) {
    flags.push({ kind: 'mostly-deletion' });
  }
  return flags.sort(
    (a, b) => FLAG_ORDER.indexOf(a.kind) - FLAG_ORDER.indexOf(b.kind),
  );
}

export function buildReview(
  project: ProjectResponse,
  events: readonly ProjectEvent[],
): Review {
  const { projection } = project;
  const ordered = [...events].sort((a, b) => a.sequence - b.sequence);

  // Which agents touched each path, to flag shared files.
  const writers = new Map<string, Set<string>>();
  for (const event of ordered) {
    if (event.type !== 'output.produced') continue;
    const { location, agentId } = event.payload.output;
    if (!location) continue;
    const set = writers.get(location) ?? new Set<string>();
    set.add(agentId);
    writers.set(location, set);
  }
  const sharedPaths = new Set(
    [...writers].filter(([, agents]) => agents.size > 1).map(([path]) => path),
  );

  const lastSaid = new Map<string, string>();
  const changes: ReviewChange[] = [];
  for (const event of ordered) {
    if (event.type === 'message.posted') {
      const message = event.payload.message;
      const refs = message.refs;
      // The agent's own words only: permission requests, check results and
      // output notices are posted in its thread too, but carry a ref.
      const notice = Boolean(
        refs?.askId || refs?.checkId || refs?.outputId || refs?.proposalId,
      );
      if (message.author.role === 'agent' && refs?.taskId && !notice) {
        lastSaid.set(refs.taskId, message.body);
      }
      continue;
    }
    if (event.type !== 'output.produced') continue;
    const output = event.payload.output;
    if (!output.location) continue;
    const task = projection.tasks[output.taskId];
    const agent = projection.agents[output.agentId];
    // The latest check that started after this change says whether it
    // was verified.
    const after = Object.values(projection.checks)
      .filter(
        (check) =>
          check.taskId === output.taskId &&
          check.startedAtSequence > event.sequence,
      )
      .sort((a, b) => b.startedAtSequence - a.startedAtSequence)[0];
    const check: ReviewChange['check'] = !after
      ? 'none'
      : after.state === 'passed'
        ? 'passed'
        : after.state === 'failed'
          ? 'failed'
          : 'none';
    const diff = output.diff ?? '';
    const rows = parseDiff(diff);
    const said = lastSaid.get(output.taskId);
    changes.push({
      id: output.id,
      step: changes.length + 1,
      sequence: event.sequence,
      at: event.occurredAt,
      path: output.location,
      diff,
      added: rows.filter((row) => row.kind === 'add').length,
      removed: rows.filter((row) => row.kind === 'del').length,
      agentId: output.agentId,
      agentName: agent?.name ?? 'Agent',
      taskId: output.taskId,
      taskTitle: task?.title ?? 'Task',
      sections: task?.sections ?? [],
      ...(said ? { said: said.slice(0, 600) } : {}),
      check,
      flags: flagsFor(output.location, diff, check, sharedPaths),
    });
  }

  const sessions: ReviewSession[] = Object.values(projection.tasks)
    .sort((a, b) => a.createdAtSequence - b.createdAtSequence)
    .map((task) => {
      const agent = projection.agents[task.agentId];
      const own = changes.filter((change) => change.taskId === task.id);
      const checks = Object.values(projection.checks)
        .filter((check) => check.taskId === task.id)
        .sort((a, b) => a.startedAtSequence - b.startedAtSequence)
        .map((check) => ({ name: check.name, state: check.state }));
      const usage = Object.entries(task.usage ?? {});
      let cost: number | undefined = 0;
      for (const [modelId, totals] of usage) {
        const part = costOf(
          {
            inputTokens: totals.inputTokens,
            outputTokens: totals.outputTokens,
          },
          modelId,
          totals.provider,
        );
        cost =
          part === undefined || cost === undefined ? undefined : cost + part;
      }
      const ended = [...ordered]
        .reverse()
        .find(
          (event) =>
            event.type === 'task.state_changed' &&
            event.payload.taskId === task.id &&
            ['done', 'failed', 'stopped'].includes(event.payload.to),
        );
      return {
        taskId: task.id,
        agentId: task.agentId,
        agentName: agent?.name ?? 'Agent',
        title: task.title,
        state: task.state,
        ...(task.startedAt ? { startedAt: task.startedAt } : {}),
        ...(ended ? { endedAt: ended.occurredAt } : {}),
        changes: own,
        checks,
        tokens: {
          input: usage.reduce((sum, [, t]) => sum + t.inputTokens, 0),
          output: usage.reduce((sum, [, t]) => sum + t.outputTokens, 0),
        },
        ...(cost !== undefined && usage.length ? { cost } : {}),
        onPlan: usage.some(([, t]) => t.provider === 'chatgpt'),
      };
    });

  return { changes, sessions };
}

export function flagged(change: ReviewChange): boolean {
  // Unverified alone is common while work is in progress; everything
  // else is a reason to look.
  return change.flags.some((flag) => flag.kind !== 'unverified');
}
