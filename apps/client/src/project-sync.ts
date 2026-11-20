import { useEffect, useRef, useState } from 'react';
import type { ProjectResponse } from '@harness/contracts';
import { readEvents, readProject } from './api';

// Keeps the open project current on its own. Work lands from places this
// screen did not start: agents in panes that are not open, an agent tool
// working through the MCP server, another tab. A cheap check for new
// events runs every couple of seconds (less often while the tab is in the
// background); only when something happened is the project read again.

const VISIBLE_MS = 1_500;
const HIDDEN_MS = 5_000;

export function useProjectSync(
  project: ProjectResponse,
  onChange: (next: ProjectResponse) => void,
): void {
  const projectId = project.projection.projectId;
  const seen = useRef(project.projection.lastSequence);
  const change = useRef(onChange);
  useEffect(() => {
    seen.current = Math.max(seen.current, project.projection.lastSequence);
  }, [project.projection.lastSequence]);
  useEffect(() => {
    change.current = onChange;
  }, [onChange]);

  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    let checking = false;
    const check = async () => {
      if (checking) return;
      checking = true;
      try {
        const page = await readEvents(projectId, seen.current);
        if (active && page.cursor > seen.current) {
          const next = await readProject(projectId);
          if (active && next.projection.lastSequence > seen.current) {
            seen.current = next.projection.lastSequence;
            change.current(next);
          }
        }
      } catch {
        // The service may be restarting; the next check tries again.
      } finally {
        checking = false;
      }
    };
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(
        async () => {
          await check();
          if (active) schedule();
        },
        document.hidden ? HIDDEN_MS : VISIBLE_MS,
      );
    };
    // Coming back to the tab: catch up at once.
    const onVisible = () => {
      if (!document.hidden) void check();
      schedule();
    };
    document.addEventListener('visibilitychange', onVisible);
    schedule();
    return () => {
      active = false;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [projectId]);
}

// --- Tell me when it needs me ----------------------------------------------

const NOTIFY_KEY = 'harness.notify';

function storedNotify(): boolean {
  try {
    return window.localStorage.getItem(NOTIFY_KEY) === '1';
  } catch {
    return false;
  }
}

export const notificationsSupported = () =>
  typeof window !== 'undefined' && 'Notification' in window;

// Whether to send a system notification while the tab is in the
// background. Asks the browser for permission when turned on.
export function useNotifyPreference(): [boolean, () => Promise<void>] {
  const [on, setOn] = useState(
    () =>
      notificationsSupported() &&
      storedNotify() &&
      Notification.permission === 'granted',
  );
  const toggle = async () => {
    let next = !on;
    if (next && notificationsSupported()) {
      const permission =
        Notification.permission === 'default'
          ? await Notification.requestPermission()
          : Notification.permission;
      next = permission === 'granted';
    }
    try {
      window.localStorage.setItem(NOTIFY_KEY, next ? '1' : '0');
    } catch {
      // Remembering is a convenience.
    }
    setOn(next);
  };
  return [on, toggle];
}

export interface Signal {
  readonly kind: 'ask' | 'plan' | 'done' | 'failed';
  readonly key: string;
  readonly title: string;
  readonly body: string;
}

// What changed between two looks at a project that a person would want
// to hear about: something to decide, or a task that ended.
export function signalsBetween(
  before: ProjectResponse,
  after: ProjectResponse,
): Signal[] {
  const signals: Signal[] = [];
  const name = after.projection.project.name;
  for (const ask of Object.values(after.projection.asks)) {
    if (ask.state !== 'open' || before.projection.asks[ask.id]) continue;
    const agent = after.projection.agents[ask.agentId];
    signals.push({
      kind: 'ask',
      key: ask.id,
      title: `${agent?.name ?? 'An agent'} needs you`,
      body: `${name}: ${ask.action}`,
    });
  }
  for (const proposal of Object.values(after.projection.proposals)) {
    if (proposal.state !== 'open' || before.projection.proposals[proposal.id])
      continue;
    signals.push({
      kind: 'plan',
      key: proposal.id,
      title: 'Ready for you to decide',
      body: `${name}: ${proposal.title}`,
    });
  }
  for (const task of Object.values(after.projection.tasks)) {
    const was = before.projection.tasks[task.id]?.state;
    if (was === task.state) continue;
    if (task.state !== 'done' && task.state !== 'failed') continue;
    const agent = after.projection.agents[task.agentId];
    const who = task.outside?.client ?? agent?.name ?? 'An agent';
    signals.push({
      kind: task.state,
      key: task.id,
      title: task.state === 'done' ? `${who} finished` : `${who} failed`,
      body: `${name}: ${task.title}${
        task.state === 'failed' && task.endReason ? ` — ${task.endReason}` : ''
      }`,
    });
  }
  return signals;
}

// How many things are waiting on the person in this project.
export const waitingOnYou = (project: ProjectResponse) =>
  project.summary.openAskIds.length + project.summary.openProposalIds.length;

// The tab title says what needs you, and what finished while you were
// away; with notifications on, the system says it too.
export function useAttentionSignals(
  project: ProjectResponse,
  notify: boolean,
): void {
  const previous = useRef(project);
  const [missed, setMissed] = useState<Signal[]>([]);

  useEffect(() => {
    const signals = signalsBetween(previous.current, project);
    previous.current = project;
    if (!signals.length || !document.hidden) return;
    setMissed((current) => [...current, ...signals]);
    if (notify && notificationsSupported()) {
      for (const signal of signals) {
        try {
          new Notification(signal.title, {
            body: signal.body,
            tag: signal.key,
          });
        } catch {
          // Some browsers only notify from a service worker; the title
          // still says it.
        }
      }
    }
  }, [project, notify]);

  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden) setMissed([]);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  const waiting = waitingOnYou(project);
  const name = project.projection.project.name;
  const finished = missed.filter(
    (signal) => signal.kind === 'done' || signal.kind === 'failed',
  );
  const failed = finished.some((signal) => signal.kind === 'failed');
  useEffect(() => {
    const prefix = waiting
      ? `(${waiting}) `
      : finished.length
        ? failed
          ? '✕ '
          : '✓ '
        : '';
    document.title = `${prefix}${name} — Harness`;
  }, [waiting, finished.length, failed, name]);
  useEffect(() => {
    const original = document.title;
    return () => {
      document.title = original;
    };
  }, []);
}
