import { useEffect, useMemo, useState } from 'react';
import type {
  DemoRunSnapshot,
  ProjectListResponse,
  ProjectResponse,
  WorkspaceResponse,
} from '@harness/contracts';
import {
  ApiError,
  advanceDemoRun,
  cancelDemoRun,
  decideApproval,
  launchDemoRun,
  listProjects,
  readDemoRun,
  readProject,
  readWorkspace,
} from './api';
import {
  buildRoomMessages,
  buildRooms,
  phaseLabel,
  type ComposerInput,
  type RoomId,
} from './conversation';
import {
  buildAttentionViewModel,
  buildTaskViewModels,
  isTerminalRun,
  type FixtureTaskKey,
} from './model';
import { TaskGraph, TaskInspector, TaskList } from './operational-surfaces';
import { ExplorerDetail, ProjectExplorer, type ExplorerItem } from './explorer';
import { liveTargetId, liveTargets } from './live';
import { LivePane } from './live-pane';
import { AddPaneMenu, Pane } from './panes';
import { ProjectDetail, ProjectPanel } from './project-panel';
import type { Stage } from './stages';

export { TaskGraph as TaskRail, TaskInspector, TaskList };

const statusLabels: Record<ProjectResponse['summary']['status'], string> = {
  intake: 'Getting started',
  planning: 'Plan ready',
  idle: 'Idle',
  working: 'Working',
  needs_you: 'Needs you',
  reviewing: 'Needs a fix',
  complete: 'Complete',
  partially_stopped: 'Partly stopped',
};

type LoadState =
  | { phase: 'loading' }
  | { phase: 'ready'; data: WorkspaceResponse }
  | { phase: 'error'; message: string };

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
      </span>
    </div>
  );
}

export function App() {
  const [loadState, setLoadState] = useState<LoadState>({ phase: 'loading' });
  const [selectedTask, setSelectedTask] = useState<FixtureTaskKey>('interface');
  const [panes, setPanes] = useState<RoomId[]>(['coordinator']);
  // The persisted project (Increment 2.6). When present, its first agent's
  // thread is the default pane and the fixture rooms move behind "Add pane".
  const [project, setProject] = useState<ProjectResponse>();
  const [projects, setProjects] = useState<ProjectListResponse['projects']>([]);
  const [livePanes, setLivePanes] = useState<string[]>([]);

  // Opening a project: its first agent pane, or the coordinator when it has
  // no agents yet (a brand-new project starts with intake).
  const openProject = (loaded: ProjectResponse) => {
    setProject(loaded);
    const firstAgent = liveTargets(loaded).find((t) => t.kind === 'agent');
    setLivePanes([firstAgent ? liveTargetId(firstAgent) : 'coordinator']);
    setPanes([]);
    setActivePane(0);
  };
  const refreshProjects = async () => {
    const list = await listProjects();
    setProjects(list.projects);
    return list;
  };
  const switchProject = async (projectId: string) => {
    try {
      openProject(await readProject(projectId));
      setExplorerItem(undefined);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : 'The project could not open.',
      );
    }
  };
  const [activePane, setActivePane] = useState(0);
  const [explorerOpen, setExplorerOpen] = useState(
    () => typeof window === 'undefined' || window.innerWidth > 960,
  );
  const [explorerItem, setExplorerItem] = useState<ExplorerItem>();
  const [drawerStage, setDrawerStage] = useState<Stage>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('Loading the local project.');
  const [actionError, setActionError] = useState<string>();

  const followAttention = (nextData: WorkspaceResponse) => {
    const attention = buildAttentionViewModel(
      nextData.workspace,
      nextData.activeRun,
    );
    if (attention?.taskKey) {
      const key = attention.taskKey;
      setSelectedTask(key);
      setPanes((current) =>
        current.includes(key)
          ? current
          : [...current, key].slice(current.length >= 3 ? 1 : 0),
      );
    }
  };

  const applyWorkspace = (data: WorkspaceResponse, message: string) => {
    followAttention(data);
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
          ? 'Refreshed.'
          : data.activeRun
            ? `Restored: work ${phaseLabel(data.activeRun.phase)}.`
            : 'Project ready. Review the plan.',
      );
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
    void listProjects()
      .then(async (list) => {
        if (!active) return;
        setProjects(list.projects);
        const first = list.projects[0];
        if (!first) return;
        const loaded = await readProject(first.project.id);
        if (!active) return;
        openProject(loaded);
      })
      .catch(() => {
        // No persisted project yet: the fixture shell stands on its own.
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    void readWorkspace()
      .then((data) => {
        if (!active) return;
        followAttention(data);
        setLoadState({ phase: 'ready', data });
        setNotice(
          data.activeRun
            ? `Restored: work ${phaseLabel(data.activeRun.phase)}.`
            : 'Project ready. Review the plan.',
        );
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
  const rooms = useMemo(
    () =>
      data
        ? buildRooms(data.workspace, tasks, snapshot, attention?.taskKey)
        : [],
    [data, tasks, snapshot, attention?.taskKey],
  );

  const updateRun = (next: DemoRunSnapshot, message: string) => {
    if (loadState.phase !== 'ready') return;
    const nextData = { ...loadState.data, activeRun: next };
    followAttention(nextData);
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
          applyWorkspace(
            await readWorkspace(),
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
      setPanes(['coordinator', 'interface', 'service']);
      setActivePane(1);
      setDrawerStage(undefined);
      updateRun(
        await readDemoRun(runId),
        'Plan started. The interface agent is working.',
      );
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

  const advance = () =>
    snapshot &&
    void runAction(() => advanceDemoRun(snapshot), 'Next step applied.');
  const decide = (approvalId: string, decision: 'approved' | 'denied') =>
    snapshot &&
    void runAction(
      () => decideApproval(snapshot, approvalId, decision),
      decision === 'approved'
        ? 'Approved. The agent continues.'
        : 'Denied. Work stopped.',
    );
  const cancel = () =>
    snapshot &&
    void runAction(
      () => cancelDemoRun(snapshot),
      'Stopped. Everything so far is kept.',
    );

  const runComposerCommand = (
    input: Extract<ComposerInput, { kind: 'command' }>,
  ): string => {
    switch (input.name) {
      case 'launch':
        if (snapshot && !terminal) return 'Work is already in progress.';
        void launch();
        return 'Launching from plan v1.';
      case 'next':
        if (!snapshot) return 'Nothing started yet. Use /launch first.';
        if (!snapshot.availableCommands.includes('advance'))
          return snapshot.availableCommands.includes('approve')
            ? 'An agent is waiting on you. Use /approve or /deny.'
            : 'Nothing to apply right now.';
        advance();
        return `Applied: ${snapshot.nextStepLabel}.`;
      case 'approve':
      case 'deny': {
        if (!pendingApproval) return 'No open request.';
        decide(
          pendingApproval.id,
          input.name === 'approve' ? 'approved' : 'denied',
        );
        return `${input.name === 'approve' ? 'Approved' : 'Denied'}: ${pendingApproval.requestedAction}.`;
      }
      case 'stop':
        if (!snapshot || !canCancel) return 'Nothing is running.';
        cancel();
        return 'Stopping. Everything so far is kept.';
      case 'to':
        return '';
    }
  };

  const openPanes = panes
    .map((id) => rooms.find((room) => room.id === id))
    .filter((room): room is NonNullable<typeof room> => Boolean(room?.open));
  const targets = project ? liveTargets(project) : [];
  const openLive = livePanes
    .map((id) => targets.find((target) => liveTargetId(target) === id))
    .filter((target): target is NonNullable<typeof target> => Boolean(target));
  const slotCount = openLive.length + openPanes.length;
  const activeIndex = Math.min(activePane, Math.max(slotCount - 1, 0));

  const addPane = (room: RoomId) => {
    setPanes((current) => {
      if (current.includes(room)) return current;
      const next = [...current, room];
      const roomLimit = Math.max(3 - livePanes.length, 1);
      return next.length > roomLimit
        ? next.slice(next.length - roomLimit)
        : next;
    });
    setActivePane(Math.min(slotCount, 2));
  };
  const closePane = (room: RoomId) =>
    setPanes((current) => current.filter((id) => id !== room));
  const addLivePane = (id: string) => {
    setLivePanes((current) => {
      if (current.includes(id)) return current;
      const next = [...current, id];
      return next.length > 3 ? next.slice(next.length - 3) : next;
    });
    setActivePane(Math.min(slotCount, 2));
  };
  const closeLivePane = (id: string) =>
    setLivePanes((current) => current.filter((open) => open !== id));
  const availableLive = targets.filter(
    (target) => !livePanes.includes(liveTargetId(target)),
  );

  const paneHandlers = {
    workspace,
    tasks,
    snapshot,
    busy,
    onDecision: decide,
    onAdvance: advance,
    onCancel: cancel,
    onLaunch: () => void launch(),
    onShowPlan: () => {
      setDrawerStage('plan');
      setExplorerItem('plan');
      setExplorerOpen(true);
    },
    onCommand: runComposerCommand,
  };

  return (
    <div
      className={`app ${explorerOpen ? 'has-explorer' : ''} ${
        explorerOpen && explorerItem ? `has-detail detail-${explorerItem}` : ''
      }`}
    >
      <a className="skip-link" href="#panes">
        Skip to conversation
      </a>
      <header className="app-header">
        <button
          type="button"
          className="explorer-toggle"
          aria-pressed={explorerOpen}
          aria-label={
            explorerOpen ? 'Hide project panel' : 'Show project panel'
          }
          onClick={() => setExplorerOpen((open) => !open)}
        >
          <span className="brand-mark small" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span aria-hidden="true">☰</span>
        </button>
        <h1 className="app-title">
          {project ? project.projection.project.name : workspace.project.name}
        </h1>
        <span className="mode-badge" title="Simulated coordinator and agents">
          Simulated
        </span>
        {project ? (
          <span
            className={`pane-state work-${project.summary.status}`}
            title="What the project is doing right now"
          >
            {statusLabels[project.summary.status]}
          </span>
        ) : null}
        <div className="app-actions">
          {project?.summary.attention ? (
            <button
              type="button"
              className="attention-chip"
              onClick={() => {
                const item = project.summary.attention!;
                const id =
                  item.kind === 'ask' || item.kind === 'check_failed'
                    ? item.agentId
                    : 'coordinator';
                addLivePane(id);
                setActivePane(
                  Math.max(
                    openLive.findIndex((t) => liveTargetId(t) === id),
                    openLive.length,
                  ),
                );
              }}
            >
              <span aria-hidden="true">!</span>{' '}
              {project.summary.attention.label}
            </button>
          ) : null}
          {!project && attention ? (
            <button
              type="button"
              className="attention-chip"
              onClick={() => {
                if (attention.taskKey) {
                  addPane(attention.taskKey);
                  setActivePane(
                    Math.max(
                      openPanes.findIndex(
                        (room) => room.id === attention.taskKey,
                      ),
                      0,
                    ),
                  );
                }
              }}
            >
              <span aria-hidden="true">!</span> {attention.title}
            </button>
          ) : null}
          {availableLive.length ? (
            <div className="add-pane">
              <span>Open</span>
              {availableLive.map((target) => (
                <button
                  type="button"
                  key={liveTargetId(target)}
                  className={`category-${
                    target.kind === 'agent' ? target.agent.category : 'neutral'
                  }`}
                  onClick={() => addLivePane(liveTargetId(target))}
                >
                  <span className="cat-dot" aria-hidden="true" />
                  {target.kind === 'agent' ? target.agent.name : 'Coordinator'}
                </button>
              ))}
            </div>
          ) : null}
          <AddPaneMenu
            rooms={rooms}
            open={panes}
            label={project ? 'Plan demo' : 'Add pane'}
            onAdd={addPane}
          />
          {canCancel && snapshot ? (
            <button
              type="button"
              className="danger-action small"
              disabled={busy}
              onClick={cancel}
            >
              Stop
            </button>
          ) : null}
          <button
            type="button"
            className="quiet-button"
            disabled={busy}
            onClick={() => void load(true)}
          >
            Refresh
          </button>
        </div>
      </header>

      {explorerOpen && project ? (
        <ProjectPanel
          projects={projects}
          project={project}
          selected={explorerItem}
          busy={busy}
          onSelect={setExplorerItem}
          onSwitch={(id) => void switchProject(id)}
          onCreated={(created) => {
            void refreshProjects();
            openProject(created);
            setExplorerItem('brief');
            setNotice(`Created ${created.projection.project.name}.`);
          }}
          onError={setActionError}
        />
      ) : explorerOpen ? (
        <ProjectExplorer
          workspace={workspace}
          snapshot={snapshot}
          selected={explorerItem}
          onSelect={setExplorerItem}
        />
      ) : null}
      {explorerOpen && explorerItem && project ? (
        <ProjectDetail
          item={explorerItem}
          project={project}
          busy={busy}
          onProject={(next) => {
            setProject(next);
            void refreshProjects();
          }}
          onError={setActionError}
          onClose={() => setExplorerItem(undefined)}
        />
      ) : explorerOpen && explorerItem ? (
        <ExplorerDetail
          item={explorerItem}
          workspace={workspace}
          tasks={tasks}
          selectedTask={selectedTask}
          snapshot={snapshot}
          busy={busy}
          stage={drawerStage}
          onStage={setDrawerStage}
          onSelectTask={(task) => {
            setSelectedTask(task);
            if (rooms.find((room) => room.id === task)?.open) addPane(task);
          }}
          onLaunch={() => void launch()}
          onClose={() => setExplorerItem(undefined)}
        />
      ) : null}

      {slotCount > 1 || targets.length > 1 ? (
        <div
          className="pane-switcher"
          role="tablist"
          aria-label="Conversations"
        >
          {/* On narrow screens this strip is the only navigation, so it lists
              every conversation; tapping one that is not open opens it. */}
          {targets.map((target) => {
            const id = liveTargetId(target);
            const index = openLive.findIndex(
              (open) => liveTargetId(open) === id,
            );
            const isOpen = index >= 0;
            return (
              <button
                type="button"
                role="tab"
                key={id}
                aria-selected={isOpen && index === activeIndex}
                className={`category-${
                  target.kind === 'agent' ? target.agent.category : 'neutral'
                } ${isOpen ? '' : 'is-closed'}`}
                onClick={() => {
                  if (isOpen) {
                    setActivePane(index);
                    return;
                  }
                  addLivePane(id);
                  setActivePane(Math.min(openLive.length, 2));
                }}
              >
                <span className="cat-dot" aria-hidden="true" />
                {target.kind === 'agent' ? target.agent.name : 'Coordinator'}
                {target.kind === 'agent' &&
                target.agent.work === 'needs_you' ? (
                  <b className="tab-badge">1</b>
                ) : null}
              </button>
            );
          })}
          {openPanes.map((room, offset) => (
            <button
              type="button"
              role="tab"
              key={room.id}
              aria-selected={openLive.length + offset === activeIndex}
              className={`category-${room.category}`}
              onClick={() => setActivePane(openLive.length + offset)}
            >
              <span className="cat-dot" aria-hidden="true" />
              {room.title}
              {room.attention ? <b className="tab-badge">1</b> : null}
            </button>
          ))}
        </div>
      ) : null}

      <main className="panes" id="panes" data-count={slotCount}>
        {project
          ? openLive.map((target, index) => (
              <div
                key={liveTargetId(target)}
                className={`pane-slot ${index === activeIndex ? 'is-active' : ''}`}
              >
                <LivePane
                  project={project}
                  target={target}
                  canClose={slotCount > 1}
                  onProject={(next) => {
                    setProject(next);
                    void refreshProjects();
                  }}
                  onClose={() => closeLivePane(liveTargetId(target))}
                />
              </div>
            ))
          : null}
        {openPanes.map((room, offset) => (
          <div
            key={room.id}
            className={`pane-slot ${
              openLive.length + offset === activeIndex ? 'is-active' : ''
            }`}
          >
            <Pane
              room={room}
              messages={buildRoomMessages(room, snapshot)}
              canClose={
                (room.kind !== 'coordinator' || openLive.length > 0) &&
                slotCount > 1
              }
              isPrimary={offset === 0}
              openRooms={openPanes}
              onClose={() => closePane(room.id)}
              {...paneHandlers}
            />
          </div>
        ))}
      </main>

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
