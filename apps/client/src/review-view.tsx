import {
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {
  PLAN_SECTIONS,
  formatUsd,
  type MessageContext,
  type ProjectEvent,
  type ProjectResponse,
} from '@harness/contracts';
import {
  readAllEvents,
  readCommitDiff,
  readCommits,
  readSimilarCode,
  type CommitFile,
  type CommitSummary,
  type SimilarPair,
} from './api';
import { lineSpan, parseDiff, type DiffRow } from './diff-rows';
import {
  FLAG_GUIDE,
  buildReview,
  flagged,
  type Flag,
  type ReviewChange,
  type ReviewSession,
} from './review-model';
import { workLabels } from './live';

// Review: what the agents changed, organised the way you want to read it
// — step by step, by session, or by commit — with the reasons for each
// change, what deserves a second look and why, and near-duplicate code.
// Select lines in any diff to ask about them in the conversation.

type Grouping = 'steps' | 'sessions' | 'commits';
type Selection =
  | { readonly kind: 'guide' }
  | { readonly kind: 'change'; readonly id: string }
  | { readonly kind: 'session'; readonly taskId: string }
  | { readonly kind: 'commit'; readonly sha: string }
  | { readonly kind: 'similar' }
  | { readonly kind: 'pair'; readonly index: number };

const SIMILAR_GUIDE: Record<
  SimilarPair['kind'],
  { readonly title: string; readonly why: string; readonly next: string }
> = {
  identical: {
    title: 'Identical',
    why: 'The same code in two places, under different names. A fix to one will not reach the other.',
    next: 'Keep one, export it, and call it from both places.',
  },
  renamed: {
    title: 'Same shape',
    why: 'The same logic with different names or values — the classic copy, paste and tweak.',
    next: 'Usually one function with a parameter for what differs.',
  },
  near: {
    title: 'Nearly the same',
    why: 'Almost identical, with a few lines different. Either the difference is deliberate and deserves a name, or one of them has a bug the other fixed.',
    next: 'Read the differing lines below and decide which.',
  },
};

const GROUPINGS: { id: Grouping; label: string; hint: string }[] = [
  { id: 'steps', label: 'Steps', hint: 'Every change, in order.' },
  {
    id: 'sessions',
    label: 'Sessions',
    hint: 'One agent working one task: what it changed, ran and used.',
  },
  {
    id: 'commits',
    label: 'Commits',
    hint: 'The git history of the attached folder.',
  },
];

function time(at: string | undefined): string {
  if (!at) return '';
  const date = new Date(at);
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function rowText(row: DiffRow): string {
  return `${row.kind === 'add' ? '+' : row.kind === 'del' ? '-' : ' '}${row.text}`;
}

// ---------------------------------------------------------------------------
// A diff you can read with line numbers and select to ask about.
// ---------------------------------------------------------------------------

function DiffTable({
  diff,
  highlight,
  onAsk,
  askLabel,
}: {
  diff: string;
  // New-file lines to mark, e.g. the lines a flag is about.
  highlight?: readonly number[] | undefined;
  onAsk?: ((rows: DiffRow[]) => void) | undefined;
  askLabel?: string | undefined;
}) {
  const rows = useMemo(() => parseDiff(diff), [diff]);
  // A selection belongs to the diff it was made in; showing another diff
  // shows it unselected.
  const [picked, setPicked] = useState<{
    diff: string;
    from: number;
    to: number;
  }>();
  const range = picked?.diff === diff ? picked : undefined;
  const setRange = (next: { from: number; to: number } | undefined) =>
    setPicked(next ? { diff, ...next } : undefined);
  if (!diff) {
    return (
      <p className="review-empty">No diff was recorded for this change.</p>
    );
  }
  const marked = new Set(highlight ?? []);
  const pick = (index: number, extend: boolean) => {
    setRange(
      extend && range
        ? {
            from: Math.min(range.from, index),
            to: Math.max(range.from, index),
          }
        : { from: index, to: index },
    );
  };
  const selected = range ? rows.slice(range.from, range.to + 1) : [];
  const span = lineSpan(selected);
  return (
    <div className="review-diff">
      {/* Always present, so selecting never moves the rows under the
          cursor: the hint until something is selected, then the action. */}
      {onAsk ? (
        <div className="review-diff-bar" role="toolbar" aria-label="Selection">
          {range ? (
            <>
              <span>
                {span
                  ? span.from === span.to
                    ? `Line ${span.from}`
                    : `Lines ${span.from}–${span.to}`
                  : `${selected.length} ${selected.length === 1 ? 'row' : 'rows'}`}{' '}
                selected
              </span>
              <button
                type="button"
                className="primary-action small"
                onClick={() => {
                  onAsk(selected);
                  setRange(undefined);
                }}
              >
                {askLabel ?? 'Ask about this'}
              </button>
              <button
                type="button"
                className="link-button"
                onClick={() => setRange(undefined)}
              >
                Clear
              </button>
            </>
          ) : (
            <span className="review-hint-inline">
              Click a line number to select it, shift-click another for a range,
              then ask about it.
            </span>
          )}
        </div>
      ) : null}
      <table>
        <tbody>
          {rows.map((row, index) => {
            const inRange =
              range !== undefined && index >= range.from && index <= range.to;
            const line = row.newLine ?? row.oldLine;
            return (
              <tr
                key={index}
                className={`diff-${row.kind} ${inRange ? 'is-selected' : ''} ${
                  row.newLine !== undefined && marked.has(row.newLine)
                    ? 'is-flagged'
                    : ''
                }`}
              >
                {row.kind === 'gap' ? (
                  <td colSpan={3} className="review-gap">
                    ⋯
                  </td>
                ) : (
                  <>
                    <td className="review-num">
                      {onAsk && row.kind !== 'note' ? (
                        <button
                          type="button"
                          aria-label={`Select line ${line ?? index + 1}${range ? '; shift-click to extend' : ''}`}
                          aria-pressed={inRange}
                          onClick={(event) => pick(index, event.shiftKey)}
                        >
                          {/* Older diffs carry no line numbers; a dot still
                              gives you something to click. */}
                          {line ?? <span className="is-unnumbered">·</span>}
                        </button>
                      ) : (
                        (line ?? '')
                      )}
                    </td>
                    <td className="review-sign" aria-hidden="true">
                      {row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : ''}
                    </td>
                    <td className="review-code">
                      <code>{row.text || ' '}</code>
                    </td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FlagList({
  flags,
  onShow,
}: {
  flags: readonly Flag[];
  onShow?: ((lines: readonly number[]) => void) | undefined;
}) {
  if (!flags.length) {
    return (
      <p className="review-clear">Nothing flagged. Read it once and move on.</p>
    );
  }
  return (
    <ul className="review-flags">
      {flags.map((flag) => {
        const guide = FLAG_GUIDE[flag.kind];
        return (
          <li key={flag.kind} className={`flag-${flag.kind}`}>
            <strong>{guide.title}</strong>
            <span>{guide.why}</span>
            <span className="review-next">{guide.next}</span>
            {flag.lines?.length && onShow ? (
              <button
                type="button"
                className="link-button"
                onClick={() => onShow(flag.lines!)}
              >
                Mark line{flag.lines.length > 1 ? 's' : ''}{' '}
                {flag.lines.slice(0, 6).join(', ')}
                {flag.lines.length > 6 ? '…' : ''}
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function FlagDots({ flags }: { flags: readonly Flag[] }) {
  const shown = flags.filter((flag) => flag.kind !== 'unverified');
  if (!shown.length) return null;
  return (
    <span
      className="review-dots"
      title={shown.map((flag) => FLAG_GUIDE[flag.kind].title).join(' · ')}
    >
      {shown.length} to review
    </span>
  );
}

// ---------------------------------------------------------------------------

export function ReviewView({
  project,
  onAsk,
  onOpenAgent,
  onOpenArtifact,
}: {
  project: ProjectResponse;
  // Attach to the conversation of targetId (an agent id, or
  // 'coordinator'); without one, to whichever pane is active.
  onAsk: (context: MessageContext, targetId?: string) => void;
  onOpenAgent: (agentId: string) => void;
  onOpenArtifact: (path: string) => void;
}) {
  const projectId = project.projection.projectId;
  const hasFolder = Boolean(project.projection.project.repository);
  const [grouping, setGrouping] = useState<Grouping>('steps');
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [selection, setSelection] = useState<Selection>({ kind: 'guide' });
  const [events, setEvents] = useState<ProjectEvent[]>();
  const [error, setError] = useState<string>();
  const [similar, setSimilar] =
    useState<Awaited<ReturnType<typeof readSimilarCode>>>();
  const [similarBusy, setSimilarBusy] = useState(false);
  const [commits, setCommits] =
    useState<Awaited<ReturnType<typeof readCommits>>>();
  const [commitFiles, setCommitFiles] = useState<Record<string, CommitFile[]>>(
    {},
  );
  const [marked, setMarked] = useState<readonly number[]>();

  // Re-read the log whenever the project moves on.
  const lastSequence = project.projection.lastSequence;
  useEffect(() => {
    let active = true;
    void readAllEvents(projectId)
      .then((all) => {
        if (active) setEvents(all);
      })
      .catch((cause: unknown) => {
        if (active)
          setError(cause instanceof Error ? cause.message : 'Not loaded.');
      });
    return () => {
      active = false;
    };
  }, [projectId, lastSequence]);

  const review = useMemo(
    () => (events ? buildReview(project, events) : undefined),
    [project, events],
  );

  useEffect(() => {
    if (grouping !== 'commits' || commits || !hasFolder) return;
    let active = true;
    void readCommits(projectId)
      .then((result) => {
        if (active) setCommits(result);
      })
      .catch((cause: unknown) => {
        if (active)
          setError(cause instanceof Error ? cause.message : 'Not loaded.');
      });
    return () => {
      active = false;
    };
  }, [grouping, commits, hasFolder, projectId]);

  useEffect(() => {
    if (selection.kind !== 'commit' || commitFiles[selection.sha]) return;
    let active = true;
    void readCommitDiff(projectId, selection.sha)
      .then((result) => {
        if (active)
          setCommitFiles((current) => ({
            ...current,
            [selection.sha]: result.files,
          }));
      })
      .catch((cause: unknown) => {
        if (active)
          setError(cause instanceof Error ? cause.message : 'Not loaded.');
      });
    return () => {
      active = false;
    };
  }, [selection, commitFiles, projectId]);

  const scanSimilar = () => {
    setSelection({ kind: 'similar' });
    if (similar || similarBusy || !hasFolder) return;
    setSimilarBusy(true);
    void readSimilarCode(projectId)
      .then(setSimilar)
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : 'Scan failed.'),
      )
      .finally(() => setSimilarBusy(false));
  };

  const changes = (review?.changes ?? []).filter(
    (change) => !onlyFlagged || flagged(change),
  );
  const sessions = (review?.sessions ?? []).filter(
    (session) =>
      !onlyFlagged || session.changes.some((change) => flagged(change)),
  );

  // The rail as a flat list of ids, so arrow keys can walk it.
  const railItems: Selection[] =
    grouping === 'steps'
      ? changes.map((change) => ({ kind: 'change', id: change.id }))
      : grouping === 'sessions'
        ? sessions.map((session) => ({
            kind: 'session',
            taskId: session.taskId,
          }))
        : (commits?.commits ?? []).map((commit) => ({
            kind: 'commit',
            sha: commit.sha,
          }));
  const same = (a: Selection, b: Selection) =>
    JSON.stringify(a) === JSON.stringify(b);
  const onRailKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const at = railItems.findIndex((item) => same(item, selection));
    const next =
      railItems[
        Math.max(
          0,
          Math.min(
            railItems.length - 1,
            at + (event.key === 'ArrowDown' ? 1 : -1),
          ),
        )
      ];
    if (next) {
      setSelection(next);
      setMarked(undefined);
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLElement>('.review-rail [aria-current="true"]')
          ?.focus(),
      );
    }
  };

  const askAboutChange = (change: ReviewChange, rows: DiffRow[]) => {
    const span = lineSpan(rows);
    onAsk(
      {
        kind: 'file',
        label:
          `${change.path}${span ? `:${span.from}${span.to > span.from ? `-${span.to}` : ''}` : ''}`.slice(
            0,
            120,
          ),
        detail: `From step ${change.step} (${change.taskTitle}):\n${rows
          .map(rowText)
          .join('\n')}`.slice(0, 4_000),
        path: change.path,
        ...(span ? { from: span.from, to: span.to } : {}),
      },
      change.agentId,
    );
  };

  const select = (next: Selection) => {
    setSelection(next);
    setMarked(undefined);
  };

  let detail: ReactNode;
  if (selection.kind === 'guide') {
    detail = <Guide />;
  } else if (selection.kind === 'change') {
    const change = review?.changes.find((entry) => entry.id === selection.id);
    detail = change ? (
      <ChangeDetail
        change={change}
        marked={marked}
        onMark={setMarked}
        onAsk={(rows) => askAboutChange(change, rows)}
        onOpenAgent={onOpenAgent}
        onOpenArtifact={onOpenArtifact}
      />
    ) : (
      <p className="review-empty">That change is no longer here.</p>
    );
  } else if (selection.kind === 'session') {
    const session = review?.sessions.find(
      (entry) => entry.taskId === selection.taskId,
    );
    detail = session ? (
      <SessionDetail
        session={session}
        onSelectChange={(id) => {
          setGrouping('steps');
          select({ kind: 'change', id });
        }}
        onOpenAgent={onOpenAgent}
      />
    ) : null;
  } else if (selection.kind === 'commit') {
    const commit = commits?.commits.find(
      (entry) => entry.sha === selection.sha,
    );
    detail = commit ? (
      <CommitDetail
        commit={commit}
        files={commitFiles[commit.sha]}
        onAsk={(path, rows) => {
          const span = lineSpan(rows);
          onAsk({
            kind: 'file',
            label:
              `${path}${span ? `:${span.from}-${span.to}` : ''} @ ${commit.short}`.slice(
                0,
                120,
              ),
            detail: `From commit ${commit.short} "${commit.subject}":\n${rows
              .map(rowText)
              .join('\n')}`.slice(0, 4_000),
            path,
            ...(span ? { from: span.from, to: span.to } : {}),
          });
        }}
        onOpenArtifact={onOpenArtifact}
      />
    ) : null;
  } else if (selection.kind === 'similar') {
    detail = (
      <SimilarList
        result={similar}
        busy={similarBusy}
        hasFolder={hasFolder}
        onSelect={(index) => select({ kind: 'pair', index })}
      />
    );
  } else {
    const pair = similar?.pairs[selection.index];
    detail = pair ? (
      <PairDetail
        pair={pair}
        onBack={() => select({ kind: 'similar' })}
        onOpenArtifact={onOpenArtifact}
        onAsk={() => {
          // Both sides, to the coordinator: whether to merge them is a
          // decision about the codebase, not one agent's task.
          for (const side of [pair.a, pair.b]) {
            onAsk(
              {
                kind: 'file',
                label: `${side.path}:${side.startLine}-${side.endLine}`.slice(
                  0,
                  120,
                ),
                detail: `${side.name}() — ${SIMILAR_GUIDE[pair.kind].title.toLowerCase()} to ${
                  side === pair.a ? pair.b.name : pair.a.name
                }() (${Math.round(pair.similarity * 100)}% same shape).`,
                path: side.path,
                from: side.startLine,
                to: side.endLine,
              },
              'coordinator',
            );
          }
        }}
      />
    ) : null;
  }

  const flaggedCount = (review?.changes ?? []).filter(flagged).length;

  return (
    <div className="review-view">
      <nav className="review-rail" aria-label="Review">
        <div className="review-tabs" role="tablist" aria-label="Organise by">
          {GROUPINGS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={grouping === entry.id}
              title={entry.hint}
              onClick={() => setGrouping(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <p className="review-rail-hint">
          {GROUPINGS.find((entry) => entry.id === grouping)?.hint}
        </p>
        {grouping !== 'commits' ? (
          <label className="review-filter">
            <input
              type="checkbox"
              checked={onlyFlagged}
              onChange={(event) => setOnlyFlagged(event.target.checked)}
            />
            Only what needs review
            {flaggedCount ? <span>{flaggedCount}</span> : null}
          </label>
        ) : null}
        <button
          type="button"
          className="review-pin"
          aria-current={selection.kind === 'guide'}
          onClick={() => select({ kind: 'guide' })}
        >
          How to read this
        </button>
        <button
          type="button"
          className="review-pin"
          aria-current={
            selection.kind === 'similar' || selection.kind === 'pair'
          }
          onClick={scanSimilar}
        >
          Similar code
          {similar ? <span>{similar.pairs.length}</span> : null}
        </button>

        <ul className="review-list" onKeyDown={onRailKey}>
          {!review && !error ? (
            <li className="review-empty">Loading…</li>
          ) : null}
          {grouping === 'steps' ? (
            changes.length ? (
              changes.map((change) => (
                <li key={change.id}>
                  <button
                    type="button"
                    aria-current={same(selection, {
                      kind: 'change',
                      id: change.id,
                    })}
                    onClick={() => select({ kind: 'change', id: change.id })}
                  >
                    <span className="review-step">{change.step}</span>
                    <span className="review-item">
                      <span className="review-path">{change.path}</span>
                      <small>
                        {change.agentName} · +{change.added} −{change.removed}
                      </small>
                    </span>
                    <FlagDots flags={change.flags} />
                  </button>
                </li>
              ))
            ) : review ? (
              <li className="review-empty">
                {onlyFlagged
                  ? 'Nothing flagged.'
                  : 'No files changed yet. Changes appear here as agents write.'}
              </li>
            ) : null
          ) : null}
          {grouping === 'sessions'
            ? sessions.map((session) => (
                <li key={session.taskId}>
                  <button
                    type="button"
                    aria-current={same(selection, {
                      kind: 'session',
                      taskId: session.taskId,
                    })}
                    onClick={() =>
                      select({ kind: 'session', taskId: session.taskId })
                    }
                  >
                    <span className={`cat-dot work-${session.state}`} />
                    <span className="review-item">
                      <span className="review-path">{session.title}</span>
                      <small>
                        {session.agentName} · {session.changes.length}{' '}
                        {session.changes.length === 1 ? 'file' : 'files'}
                        {session.startedAt
                          ? ` · ${time(session.startedAt)}`
                          : ''}
                      </small>
                    </span>
                  </button>
                </li>
              ))
            : null}
          {grouping === 'commits' ? (
            !hasFolder ? (
              <li className="review-empty">
                Attach a folder to see its commits.
              </li>
            ) : !commits ? (
              <li className="review-empty">Reading git history…</li>
            ) : !commits.available ? (
              <li className="review-empty">
                {commits.reason ?? 'Git history is not available here.'}
              </li>
            ) : (
              commits.commits.map((commit) => (
                <li key={commit.sha}>
                  <button
                    type="button"
                    aria-current={same(selection, {
                      kind: 'commit',
                      sha: commit.sha,
                    })}
                    onClick={() => select({ kind: 'commit', sha: commit.sha })}
                  >
                    <code className="review-sha">{commit.short}</code>
                    <span className="review-item">
                      <span className="review-path">{commit.subject}</span>
                      <small>
                        {commit.author} · {time(commit.at)} ·{' '}
                        {commit.files.length}{' '}
                        {commit.files.length === 1 ? 'file' : 'files'}
                      </small>
                    </span>
                  </button>
                </li>
              ))
            )
          ) : null}
        </ul>
      </nav>
      <section className="review-detail" aria-live="polite">
        {error ? <p className="setup-error">{error}</p> : null}
        {detail}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Guide() {
  return (
    <article className="review-guide">
      <h2>How to read this</h2>
      <p>
        Review shows every file the agents changed, with the facts you need to
        judge it. Nothing here is a verdict: flags point at what deserves a
        second look, and say why.
      </p>
      <h3>Three ways to organise it</h3>
      <dl>
        <dt>Steps</dt>
        <dd>
          Every change in the order it happened, numbered. Best for following
          what happened.
        </dd>
        <dt>Sessions</dt>
        <dd>
          One agent working one task: the files it changed, the checks it ran,
          the tokens it used. Best for judging a piece of work as a whole.
        </dd>
        <dt>Commits</dt>
        <dd>
          The folder&apos;s git history, including changes made outside the
          harness. Best once work is committed.
        </dd>
      </dl>
      <h3>What each change shows</h3>
      <dl>
        <dt>Why</dt>
        <dd>
          What the agent said in that task just before it wrote the file — its
          own stated reason — and the Plan sections the task serves.
        </dd>
        <dt>Verified</dt>
        <dd>Whether a check ran after the change, and whether it passed.</dd>
      </dl>
      <h3>Flags</h3>
      <dl>
        {Object.values(FLAG_GUIDE).map((guide) => (
          <div key={guide.title}>
            <dt>{guide.title}</dt>
            <dd>
              {guide.why} <em>{guide.next}</em>
            </dd>
          </div>
        ))}
      </dl>
      <h3>Similar code</h3>
      <p>
        Functions across the folder that do almost the same thing. Matching
        ignores names and literal values, so a copy that was renamed and tweaked
        still shows. Pairs in files the agents changed come first; pairs between
        two tests come last, because tests often repeat on purpose.
      </p>
      <dl>
        {Object.values(SIMILAR_GUIDE).map((guide) => (
          <div key={guide.title}>
            <dt>{guide.title}</dt>
            <dd>
              {guide.why} <em>{guide.next}</em>
            </dd>
          </div>
        ))}
      </dl>
      <h3>Asking and editing</h3>
      <p>
        Select lines in any diff and press Ask: they are attached to the
        conversation of the agent that wrote them, ready for your question. Edit
        opens the file in the editor.
      </p>
    </article>
  );
}

function ChangeDetail({
  change,
  marked,
  onMark,
  onAsk,
  onOpenAgent,
  onOpenArtifact,
}: {
  change: ReviewChange;
  marked: readonly number[] | undefined;
  onMark: (lines: readonly number[]) => void;
  onAsk: (rows: DiffRow[]) => void;
  onOpenAgent: (agentId: string) => void;
  onOpenArtifact: (path: string) => void;
}) {
  return (
    <article className="review-change">
      <header className="review-head">
        <span className="review-step">{change.step}</span>
        <h2>{change.path}</h2>
        <span className="review-counts">
          <span className="diff-add">+{change.added}</span>{' '}
          <span className="diff-del">−{change.removed}</span>
        </span>
        <button
          type="button"
          className="secondary-action small"
          onClick={() => onOpenArtifact(change.path)}
        >
          Edit file
        </button>
      </header>
      <dl className="review-facts">
        <dt>Who</dt>
        <dd>
          <button
            type="button"
            className="link-button"
            onClick={() => onOpenAgent(change.agentId)}
          >
            {change.agentName}
          </button>{' '}
          in “{change.taskTitle}” · {time(change.at)}
        </dd>
        <dt>Why</dt>
        <dd>
          {change.said ? (
            <blockquote>{change.said}</blockquote>
          ) : (
            <span className="muted">
              The agent said nothing in this task before the change.
            </span>
          )}
          {change.sections.length ? (
            <span className="review-sections">
              Serves{' '}
              {change.sections.map((id) => (
                <span key={id} className="section-chip">
                  {PLAN_SECTIONS[id].title}
                </span>
              ))}
            </span>
          ) : null}
        </dd>
        <dt>Verified</dt>
        <dd className={`review-check check-${change.check}`}>
          {change.check === 'passed'
            ? 'A check passed after this change.'
            : change.check === 'failed'
              ? 'A check failed after this change.'
              : 'Nothing was run after this change.'}
        </dd>
      </dl>
      <h3 className="review-sub">Up for review</h3>
      <FlagList flags={change.flags} onShow={onMark} />
      <h3 className="review-sub">The change</h3>
      <DiffTable
        diff={change.diff}
        highlight={marked}
        onAsk={onAsk}
        askLabel={`Ask ${change.agentName}`}
      />
    </article>
  );
}

function SessionDetail({
  session,
  onSelectChange,
  onOpenAgent,
}: {
  session: ReviewSession;
  onSelectChange: (id: string) => void;
  onOpenAgent: (agentId: string) => void;
}) {
  const flags = session.changes.flatMap((change) =>
    change.flags.filter((flag) => flag.kind !== 'unverified'),
  );
  return (
    <article className="review-session">
      <header className="review-head">
        <h2>{session.title}</h2>
        <span className={`pane-state work-${session.state}`}>
          {workLabels[session.state as keyof typeof workLabels] ??
            session.state}
        </span>
        <button
          type="button"
          className="secondary-action small"
          onClick={() => onOpenAgent(session.agentId)}
        >
          Open conversation
        </button>
      </header>
      <div className="review-stats">
        <div>
          <strong>{session.agentName}</strong>
          <span>agent</span>
        </div>
        <div>
          <strong>{session.changes.length}</strong>
          <span>{session.changes.length === 1 ? 'file' : 'files'} changed</span>
        </div>
        <div>
          <strong>
            {session.checks.filter((check) => check.state === 'passed').length}/
            {session.checks.length}
          </strong>
          <span>checks passed</span>
        </div>
        <div>
          <strong>{flags.length}</strong>
          <span>flags</span>
        </div>
        <div>
          <strong>
            {(session.tokens.input + session.tokens.output).toLocaleString()}
          </strong>
          <span>
            tokens
            {session.onPlan
              ? ' · on your ChatGPT plan'
              : session.cost !== undefined
                ? ` · ${formatUsd(session.cost)} at list price`
                : ''}
          </span>
        </div>
      </div>
      {session.startedAt ? (
        <p className="review-when">
          {time(session.startedAt)}
          {session.endedAt ? ` → ${time(session.endedAt)}` : ' → still going'}
        </p>
      ) : null}
      <h3 className="review-sub">Files, in order</h3>
      {session.changes.length ? (
        <ol className="review-steps">
          {session.changes.map((change) => (
            <li key={change.id}>
              <button
                type="button"
                className="link-button"
                onClick={() => onSelectChange(change.id)}
              >
                Step {change.step} · {change.path}
              </button>{' '}
              <small>
                +{change.added} −{change.removed}
              </small>{' '}
              <FlagDots flags={change.flags} />
            </li>
          ))}
        </ol>
      ) : (
        <p className="review-empty">This session changed no files.</p>
      )}
      {session.checks.length ? (
        <>
          <h3 className="review-sub">Checks</h3>
          <ul className="review-checks">
            {session.checks.map((check, index) => (
              <li key={index} className={`check-${check.state}`}>
                {check.name} — {check.state}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </article>
  );
}

function CommitDetail({
  commit,
  files,
  onAsk,
  onOpenArtifact,
}: {
  commit: CommitSummary;
  files: CommitFile[] | undefined;
  onAsk: (path: string, rows: DiffRow[]) => void;
  onOpenArtifact: (path: string) => void;
}) {
  const [open, setOpen] = useState<string>();
  return (
    <article className="review-commit">
      <header className="review-head">
        <code className="review-sha">{commit.short}</code>
        <h2>{commit.subject}</h2>
      </header>
      <p className="review-when">
        {commit.author} · {time(commit.at)}
      </p>
      {!files ? <p className="review-empty">Reading the commit…</p> : null}
      <ul className="review-files">
        {(files ?? []).map((file) => {
          const isOpen = open === file.path || (files?.length ?? 0) === 1;
          return (
            <li key={file.path}>
              <div className="review-file-head">
                <button
                  type="button"
                  className="link-button"
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? undefined : file.path)}
                >
                  {isOpen ? '▾' : '▸'} {file.path}
                </button>
                <small>
                  <span className="diff-add">+{file.added}</span>{' '}
                  <span className="diff-del">−{file.removed}</span>
                </small>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => onOpenArtifact(file.path)}
                >
                  Edit
                </button>
              </div>
              {isOpen ? (
                <DiffTable
                  diff={file.diff}
                  onAsk={(rows) => onAsk(file.path, rows)}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    </article>
  );
}

function SimilarList({
  result,
  busy,
  hasFolder,
  onSelect,
}: {
  result: Awaited<ReturnType<typeof readSimilarCode>> | undefined;
  busy: boolean;
  hasFolder: boolean;
  onSelect: (index: number) => void;
}) {
  if (!hasFolder) {
    return <p className="review-empty">Attach a folder to scan its code.</p>;
  }
  if (busy || !result) {
    return <p className="review-empty">Reading the folder’s functions…</p>;
  }
  return (
    <article className="review-similar">
      <header className="review-head">
        <h2>Similar code</h2>
      </header>
      <p className="review-when">
        {result.functions.toLocaleString()} functions in{' '}
        {result.files.toLocaleString()} files
        {result.truncated
          ? ' (the folder is large; only part was read)'
          : ''}.{' '}
        {result.pairs.length
          ? `${result.pairs.length} pairs do nearly the same thing.`
          : 'No two functions do nearly the same thing.'}
      </p>
      <ul className="review-pairs">
        {result.pairs.map((pair, index) => (
          <li key={index}>
            <button type="button" onClick={() => onSelect(index)}>
              <span className={`review-kind kind-${pair.kind}`}>
                {SIMILAR_GUIDE[pair.kind].title}
              </span>
              <span className="review-item">
                <span className="review-path">
                  {pair.a.name}() · {pair.b.name}()
                </span>
                <small>
                  {pair.a.path}:{pair.a.startLine} · {pair.b.path}:
                  {pair.b.startLine}
                  {pair.kind === 'near'
                    ? ` · differ in ${pair.differingLines} lines`
                    : ''}
                </small>
              </span>
              {pair.touched ? (
                <span className="review-dots">agents changed</span>
              ) : pair.inTests ? (
                <small className="muted">tests</small>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </article>
  );
}

function PairDetail({
  pair,
  onBack,
  onAsk,
  onOpenArtifact,
}: {
  pair: SimilarPair;
  onBack: () => void;
  onAsk: () => void;
  onOpenArtifact: (path: string) => void;
}) {
  const guide = SIMILAR_GUIDE[pair.kind];
  return (
    <article className="review-pair">
      <button type="button" className="link-button" onClick={onBack}>
        ← All similar code
      </button>
      <header className="review-head">
        <span className={`review-kind kind-${pair.kind}`}>{guide.title}</span>
        <h2>
          {pair.a.name}() and {pair.b.name}()
        </h2>
        <span className="review-counts">
          {Math.round(pair.similarity * 100)}% same shape
        </span>
      </header>
      <p className="review-explain">
        {guide.why} <em>{guide.next}</em>
      </p>
      <div className="review-sides">
        {[pair.a, pair.b].map((side, index) => (
          <div key={index}>
            <strong>{index === 0 ? 'A' : 'B'}</strong>{' '}
            <code>
              {side.path}:{side.startLine}–{side.endLine}
            </code>{' '}
            <button
              type="button"
              className="link-button"
              onClick={() => onOpenArtifact(side.path)}
            >
              Edit
            </button>
          </div>
        ))}
      </div>
      <h3 className="review-sub">
        {pair.diff
          ? 'From A to B (names lined up, so only real differences show)'
          : 'No differences once names are lined up'}
      </h3>
      {pair.diff ? <DiffTable diff={pair.diff} /> : null}
      <div className="review-actions">
        <button type="button" className="primary-action small" onClick={onAsk}>
          Ask the coordinator about these two
        </button>
      </div>
    </article>
  );
}
