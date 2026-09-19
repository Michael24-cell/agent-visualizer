import { useEffect, useMemo, useState } from 'react';
import type { DemoRunSnapshot, WorkspaceResponse } from '@harness/contracts';
import {
  ApiError,
  advanceDemoRun,
  cancelDemoRun,
  decideApproval,
  launchDemoRun,
  readDemoRun,
  readWorkspace,
} from './api';
import { CapabilityAtlas } from './capability-atlas';
import {
  buildAttentionViewModel,
  buildTaskViewModels,
  defaultSurfaceFor,
  isTerminalRun,
  type AppSurface,
  type FixtureTaskKey,
} from './model';
import {
  ContextSurface,
  HistorySurface,
  PlanSurface,
  ProjectSurface,
  ReviewSurface,
  RunSurface,
  TaskGraph,
  TaskInspector,
  TaskList,
} from './operational-surfaces';

export { TaskGraph as TaskRail, TaskInspector, TaskList };

type LoadState =
  | { phase: 'loading' }
  | { phase: 'ready'; data: WorkspaceResponse }
  | { phase: 'error'; message: string };

const surfaces: Array<{
  id: AppSurface;
  label: string;
  short: string;
  icon: string;
}> = [
  { id: 'project', label: 'Project', short: 'Assessment', icon: '⌂' },
  { id: 'context', label: 'Methodologies', short: 'Context stack', icon: '◇' },
  { id: 'plan', label: 'Plan', short: 'Task topology', icon: '⌁' },
  { id: 'run', label: 'Current run', short: 'Supervision', icon: '▶' },
  {
    id: 'atlas',
    label: 'Capabilities',
    short: 'Agent + skill atlas',
    icon: '✣',
  },
  { id: 'review', label: 'Review', short: 'Evidence', icon: '✓' },
  { id: 'history', label: 'History', short: 'Local outcomes', icon: '◷' },
];

function hashSurface(): AppSurface | undefined {
  const value = window.location.hash.replace(/^#\/?/, '');
  return surfaces.some((surface) => surface.id === value)
    ? (value as AppSurface)
    : undefined;
}

function Brand() {
  return (
    <div className="brand" aria-label="Visual Agent Harness">
      <span className="brand-mark" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span>
        <strong>Harness</strong>
        <small>local control plane</small>
      </span>
    </div>
  );
}

function ApplicationNav({
  surface,
  snapshot,
  attention,
  onNavigate,
}: {
  surface: AppSurface;
  snapshot?: DemoRunSnapshot | undefined;
  attention: boolean;
  onNavigate: (surface: AppSurface) => void;
}) {
  return (
    <nav className="app-nav" aria-label="Primary navigation">
      {surfaces.map((item) => {
        const runBadge =
          item.id === 'run' && snapshot && !isTerminalRun(snapshot);
        const reviewBadge = item.id === 'review' && isTerminalRun(snapshot);
        return (
          <button
            type="button"
            className={surface === item.id ? 'is-current' : ''}
            aria-current={surface === item.id ? 'page' : undefined}
            onClick={() => onNavigate(item.id)}
            key={item.id}
          >
            <span className="nav-icon" aria-hidden="true">
              {item.icon}
            </span>
            <span>
              <strong>{item.label}</strong>
              <small>{item.short}</small>
            </span>
            {runBadge ? (
              <i className="nav-state is-active" aria-label="Run active" />
            ) : null}
            {reviewBadge ? (
              <i className="nav-state is-ready" aria-label="Review ready" />
            ) : null}
            {item.id === 'run' && attention ? (
              <b className="nav-count" aria-label="One item needs attention">
                1
              </b>
            ) : null}
          </button>
        );
      })}
      <div className="nav-boundary">
        <span aria-hidden="true">⚙</span>
        <span>
          <strong>Project settings</strong>
          <small>Unavailable in this increment</small>
        </span>
      </div>
    </nav>
  );
}

export function App() {
  const [loadState, setLoadState] = useState<LoadState>({ phase: 'loading' });
  const [surface, setSurface] = useState<AppSurface>(
    hashSurface() ?? 'project',
  );
  const [selectedTask, setSelectedTask] = useState<FixtureTaskKey>('interface');
  const [planView, setPlanView] = useState<'graph' | 'list'>('graph');
  const [runView, setRunView] = useState<'graph' | 'list'>('graph');
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('Loading the local project.');
  const [actionError, setActionError] = useState<string>();

  const navigate = (next: AppSurface, replace = false) => {
    setSurface(next);
    setMenuOpen(false);
    const url = `${window.location.pathname}${window.location.search}#/${next}`;
    window.history[replace ? 'replaceState' : 'pushState'](null, '', url);
  };

  useEffect(() => {
    const syncFromHistory = () => {
      const next = hashSurface();
      if (next) setSurface(next);
    };
    window.addEventListener('hashchange', syncFromHistory);
    window.addEventListener('popstate', syncFromHistory);
    return () => {
      window.removeEventListener('hashchange', syncFromHistory);
      window.removeEventListener('popstate', syncFromHistory);
    };
  }, []);

  const selectAttentionTask = (nextData: WorkspaceResponse) => {
    const attention = buildAttentionViewModel(
      nextData.workspace,
      nextData.activeRun,
    );
    if (attention?.taskKey) setSelectedTask(attention.taskKey);
  };

  const applyWorkspace = (data: WorkspaceResponse, message: string) => {
    selectAttentionTask(data);
    setLoadState({ phase: 'ready', data });
    setNotice(message);
    setActionError(undefined);
  };

  const load = async (refreshing = false) => {
    try {
      const data = await readWorkspace();
      applyWorkspace(
        data,
        refreshing && data.activeRun
          ? `Refreshed from persisted state at event ${data.activeRun.projection.lastSequence}.`
          : data.activeRun
            ? `Recovered ${data.activeRun.phase.replaceAll('_', ' ')} from persisted events.`
            : 'Project context is ready for plan review.',
      );
      if (!hashSurface()) navigate(defaultSurfaceFor(data.activeRun), true);
    } catch (error) {
      setLoadState({
        phase: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'The local service is unavailable.',
      });
    }
  };

  useEffect(() => {
    let active = true;
    void readWorkspace()
      .then((nextData) => {
        if (!active) return;
        const nextAttention = buildAttentionViewModel(
          nextData.workspace,
          nextData.activeRun,
        );
        if (nextAttention?.taskKey) setSelectedTask(nextAttention.taskKey);
        setLoadState({ phase: 'ready', data: nextData });
        setNotice(
          nextData.activeRun
            ? `Recovered ${nextData.activeRun.phase.replaceAll('_', ' ')} from persisted events.`
            : 'Project context is ready for plan review.',
        );
        if (!hashSurface()) {
          const nextSurface = defaultSurfaceFor(nextData.activeRun);
          setSurface(nextSurface);
          window.history.replaceState(
            null,
            '',
            `${window.location.pathname}${window.location.search}#/${nextSurface}`,
          );
        }
      })
      .catch((error: unknown) => {
        if (!active) return;
        setLoadState({
          phase: 'error',
          message:
            error instanceof Error
              ? error.message
              : 'The local service is unavailable.',
        });
      });
    return () => {
      active = false;
    };
  }, []);

  const data = loadState.phase === 'ready' ? loadState.data : undefined;
  const snapshot = data?.activeRun;
  const tasks = useMemo(
    () => (data ? buildTaskViewModels(data.workspace, snapshot) : []),
    [data, snapshot],
  );
  const attention = data
    ? buildAttentionViewModel(data.workspace, snapshot)
    : undefined;

  const updateRun = (next: DemoRunSnapshot, message: string) => {
    if (loadState.phase !== 'ready') return;
    const nextData = { ...loadState.data, activeRun: next };
    selectAttentionTask(nextData);
    setLoadState({ phase: 'ready', data: nextData });
    setNotice(message);
    setActionError(undefined);
  };

  const runAction = async (
    action: () => Promise<DemoRunSnapshot>,
    message: string,
  ) => {
    setBusy(true);
    try {
      updateRun(await action(), message);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        try {
          const refreshed = await readWorkspace();
          applyWorkspace(
            refreshed,
            'The run changed before that command completed. Refreshed from persisted state.',
          );
        } catch (refreshError) {
          setActionError(
            refreshError instanceof Error
              ? refreshError.message
              : 'The run changed, but its latest state could not be refreshed.',
          );
        }
      } else {
        setActionError(
          error instanceof Error ? error.message : 'The command could not run.',
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const launch = async () => {
    if (!data) return;
    setBusy(true);
    try {
      const runId = await launchDemoRun(data.workspace.plan.id);
      setSelectedTask('interface');
      updateRun(
        await readDemoRun(runId),
        'Run launched. The interface task is now active.',
      );
      navigate('run');
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : 'The run could not launch.',
      );
    } finally {
      setBusy(false);
    }
  };

  if (loadState.phase === 'loading') {
    return (
      <main className="loading-screen" aria-live="polite">
        <Brand />
        <span className="loading-orbit" aria-hidden="true" />
        <p>Reconstructing the local workspace…</p>
      </main>
    );
  }

  if (loadState.phase === 'error') {
    return (
      <main className="loading-screen error-screen">
        <Brand />
        <p className="eyebrow">Local service unavailable</p>
        <h1>The workspace could not be reconstructed.</h1>
        <p>{loadState.message}</p>
        <button
          className="primary-action"
          type="button"
          onClick={() => void load()}
        >
          Retry connection
        </button>
      </main>
    );
  }

  if (!data) return null;
  const { workspace } = data;
  const pendingApproval = snapshot
    ? Object.values(snapshot.projection.approvals).find(
        (approval) => approval.state === 'requested',
      )
    : undefined;
  const terminal = isTerminalRun(snapshot);
  const canCancel = snapshot?.availableCommands.includes('cancel') ?? false;

  const renderSurface = () => {
    switch (surface) {
      case 'project':
        return <ProjectSurface workspace={workspace} />;
      case 'context':
        return <ContextSurface workspace={workspace} />;
      case 'plan':
        return (
          <PlanSurface
            workspace={workspace}
            tasks={tasks}
            selected={selectedTask}
            view={planView}
            onSelect={setSelectedTask}
            onView={setPlanView}
            onLaunch={() => void launch()}
            onOpenRun={() => navigate('run')}
            hasRun={Boolean(snapshot)}
            terminal={terminal}
            busy={busy}
          />
        );
      case 'run':
        return (
          <RunSurface
            snapshot={snapshot}
            tasks={tasks}
            selected={selectedTask}
            view={runView}
            onSelect={setSelectedTask}
            onView={setRunView}
            busy={busy}
            onAdvance={() =>
              snapshot &&
              void runAction(
                () => advanceDemoRun(snapshot),
                'The next deterministic event group was applied.',
              )
            }
            onDecision={(decision) => {
              if (snapshot && pendingApproval)
                void runAction(
                  () => decideApproval(snapshot, pendingApproval.id, decision),
                  decision === 'approved'
                    ? 'Approval recorded. Service work resumed.'
                    : 'Approval denied. The run stopped safely.',
                );
            }}
            onCancel={() =>
              snapshot &&
              void runAction(
                () => cancelDemoRun(snapshot),
                'The run was cancelled and persisted.',
              )
            }
            onLaunchNew={() => void launch()}
            onOpenPlan={() => navigate('plan')}
          />
        );
      case 'atlas':
        return <CapabilityAtlas capabilities={workspace.capabilities} />;
      case 'review':
        return (
          <ReviewSurface
            snapshot={snapshot}
            busy={busy}
            onLaunchNew={() => void launch()}
          />
        );
      case 'history':
        return <HistorySurface snapshot={snapshot} />;
    }
  };

  return (
    <div className="application-frame">
      <a className="skip-link" href="#workspace">
        Skip to workspace
      </a>
      <aside className={`sidebar ${menuOpen ? 'is-open' : ''}`}>
        <div className="sidebar-top">
          <Brand />
          <button
            className="menu-close"
            type="button"
            onClick={() => setMenuOpen(false)}
            aria-label="Close navigation"
          >
            ×
          </button>
        </div>
        <ApplicationNav
          surface={surface}
          snapshot={snapshot}
          attention={Boolean(attention)}
          onNavigate={navigate}
        />
        <div className="sidebar-foot">
          <span className="local-pulse" aria-hidden="true" />
          <div>
            <strong>Local + private</strong>
            <small>Simulated adapter</small>
          </div>
        </div>
      </aside>
      {menuOpen ? (
        <button
          className="nav-scrim"
          type="button"
          aria-label="Close navigation"
          onClick={() => setMenuOpen(false)}
        />
      ) : null}

      <div className="application-main">
        <header className="context-header">
          <button
            className="menu-trigger"
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="Open navigation"
          >
            ☰
          </button>
          <div className="project-identity">
            <span>{workspace.project.repository}</span>
            <strong>{workspace.project.name}</strong>
          </div>
          <div className="header-context">
            <span className="branch-badge">⌘ {workspace.project.branch}</span>
            {snapshot ? (
              <button
                type="button"
                className={`run-phase ${attention ? 'needs-attention' : ''}`}
                onClick={() => navigate('run')}
              >
                <span aria-hidden="true">{attention ? '!' : '●'}</span>
                {terminal
                  ? snapshot.phase.replaceAll('_', ' ')
                  : `Run · ${snapshot.phase.replaceAll('_', ' ')}`}
              </button>
            ) : (
              <span className="run-phase is-idle">No run</span>
            )}
            <button
              type="button"
              className="refresh-button"
              disabled={busy}
              onClick={() => void load(true)}
            >
              <span aria-hidden="true">↻</span>
              <span>Refresh</span>
              <small>{snapshot?.projection.lastSequence ?? 0}</small>
            </button>
            {canCancel && snapshot ? (
              <button
                type="button"
                className="header-stop"
                disabled={busy}
                onClick={() =>
                  void runAction(
                    () => cancelDemoRun(snapshot),
                    'The run was cancelled and persisted.',
                  )
                }
              >
                Stop
              </button>
            ) : null}
          </div>
        </header>
        {attention ? (
          <button
            type="button"
            className="global-attention"
            onClick={() => {
              if (attention.taskKey) setSelectedTask(attention.taskKey);
              navigate('run');
            }}
          >
            <span aria-hidden="true">!</span>
            <strong>{attention.title}</strong>
            <small>{attention.detail}</small>
            <b>Review now →</b>
          </button>
        ) : null}
        <main className="workspace" id="workspace" tabIndex={-1}>
          {renderSurface()}
        </main>
      </div>

      {actionError ? (
        <div className="toast toast-error" role="alert">
          {actionError}
        </div>
      ) : null}
      <div className="sr-live" aria-live="polite" aria-atomic="true">
        {notice}
      </div>
    </div>
  );
}
