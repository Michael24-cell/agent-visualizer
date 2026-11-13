import { useState } from 'react';
import type { ProjectListResponse, ProjectResponse } from '@harness/contracts';
import {
  attachRepository,
  createAgent,
  editPlanSection,
  listProjects,
  readProject,
  setTrust,
} from './api';
import {
  PLAN_SECTIONS,
  TRUST_POLICIES,
  TrustPolicySchema,
  projectTrust,
  type MessageContext,
  type PlanSectionId,
} from '@harness/contracts';
import { FolderPicker } from './folder-picker';
import {
  firstPane,
  liveTargetId,
  liveTargets,
  workLabels,
  type LiveTarget,
} from './live';
import { LivePane } from './live-pane';
import {
  agentsNote,
  artifactsNote,
  briefNote,
  methodNote,
  planNote,
  runtimeLabel,
  runtimeNote,
  statusLabels,
} from './project-notes';
import { MapView } from './map-view';
import { ReviewView } from './review-view';
import { ProjectDetail, type DetailItem } from './project-panel';

// The project screen: conversations side by side, a thin sidebar to open
// them, and the project's Brief / Method / Plans / Agents / History as a
// detail column on the right when you want it.

const MAX_PANES = 3;

function targetName(target: LiveTarget): string {
  return target.kind === 'agent' ? target.agent.name : 'Coordinator';
}

function targetCategory(target: LiveTarget): string {
  return target.kind === 'agent' ? target.agent.category : 'neutral';
}

export function Workspace({
  initial,
  projects,
  onProjects,
  onHome,
  onError,
  onNotice,
}: {
  initial: ProjectResponse;
  projects: ProjectListResponse['projects'];
  onProjects: (projects: ProjectListResponse['projects']) => void;
  onHome: () => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}) {
  const [project, setProject] = useState(initial);
  const [open, setOpen] = useState<string[]>(() => [firstPane(initial)]);
  const [active, setActive] = useState(0);
  const [sideOpen, setSideOpen] = useState(
    () => typeof window === 'undefined' || window.innerWidth > 960,
  );
  const [detail, setDetail] = useState<DetailItem>();
  const [artifact, setArtifact] = useState<string>();
  // The panes area shows the conversations, or the shape of the work.
  const [view, setView] = useState<'chat' | 'map' | 'review'>('chat');
  // Review keeps its place while you go and ask about something.
  const [reviewOpened, setReviewOpened] = useState(false);
  // What each conversation's next message points at. Documents and
  // artifacts attach here; the pane shows the chips and sends them.
  const [contexts, setContexts] = useState<
    Record<string, readonly MessageContext[]>
  >({});
  const openArtifact = (path: string) => {
    setArtifact(path);
    setDetail('artifacts');
  };
  const [picking, setPicking] = useState(false);
  const repository = project.projection.project.repository;

  const attach = async (path: string) => {
    setPicking(false);
    try {
      const result = await attachRepository(
        project.projection.projectId,
        project.projection.lastSequence,
        path,
      );
      updateProject(result.project);
      onNotice(
        `Attached ${result.project.projection.project.repository?.name ?? 'folder'}.`,
      );
    } catch (error) {
      onError(
        error instanceof Error ? error.message : 'The folder was not attached.',
      );
    }
  };

  // A new agent pane, ready to type into. Named by number; the first
  // task it takes describes it well enough.
  const addAgent = async () => {
    const count = Object.keys(project.projection.agents).length + 1;
    try {
      const result = await createAgent(
        project.projection.projectId,
        project.projection.lastSequence,
        `Agent ${count}`,
        'neutral',
      );
      updateProject(result.project);
      const agentId = result.receipt.createdIds.agents?.[0];
      if (agentId) show(agentId);
    } catch (error) {
      onError(
        error instanceof Error ? error.message : 'The agent was not created.',
      );
    }
  };

  const trust = projectTrust(project.projection.project);
  // Points a document line, file range or element at the conversation you
  // are typing in: the active pane, else the first agent, else the
  // coordinator. Opens that pane and shows the chip.
  // Attaches to targetId's conversation when given (an agent id or
  // 'coordinator'), else to the active pane.
  const attachContext = (item: MessageContext, targetId?: string) => {
    const all = liveTargets(project);
    const active = openTargets[activeIndex];
    const named = targetId
      ? all.find((candidate) => liveTargetId(candidate) === targetId)
      : undefined;
    const chosen =
      named ??
      active ??
      all.find((candidate) => candidate.kind === 'agent') ??
      all[0];
    if (!chosen) return;
    const id = liveTargetId(chosen);
    show(id);
    setContexts((current) => {
      const existing = current[id] ?? [];
      if (
        existing.some(
          (entry) => entry.label === item.label && entry.detail === item.detail,
        )
      ) {
        return current;
      }
      return { ...current, [id]: [...existing, item].slice(-6) };
    });
    onNotice(`Attached ${item.label} to ${targetName(chosen)}.`);
  };

  // Keeps an idea from the conversation: appends it to a Plan section.
  const addToPlan = (text: string, sectionId: PlanSectionId = 'features') => {
    const document = project.projection.planDocument;
    const line = text.trim().replace(/\s+/g, ' ').slice(0, 500);
    const lines = document.sections[sectionId]?.lines ?? [];
    if (!line || lines.some((entry) => entry === line)) {
      onNotice(`Plan · ${PLAN_SECTIONS[sectionId].title} already has that.`);
      return;
    }
    void editPlanSection(
      project.projection.projectId,
      document.lastSequence,
      sectionId,
      [...lines, line],
    )
      .then((result) => {
        updateProject(result.project);
        setDetail('plan');
        onNotice(`Added to Plan · ${PLAN_SECTIONS[sectionId].title}.`);
      })
      .catch((error: unknown) =>
        onError(error instanceof Error ? error.message : 'It was not added.'),
      );
  };

  const targets = liveTargets(project);
  const openTargets = open
    .map((id) => targets.find((t) => liveTargetId(t) === id))
    .filter((t): t is LiveTarget => Boolean(t));
  const activeIndex = Math.min(active, Math.max(openTargets.length - 1, 0));

  const updateProject = (next: ProjectResponse) => {
    setProject(next);
    void listProjects()
      .then((list) => onProjects(list.projects))
      .catch(() => undefined);
  };
  const refresh = async () => {
    try {
      updateProject(await readProject(project.projection.projectId));
      onNotice('Refreshed.');
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Could not refresh.');
    }
  };
  const show = (id: string) => {
    const index = open.indexOf(id);
    if (index >= 0) {
      setActive(index);
      return;
    }
    setOpen((current) => {
      const next = [...current, id];
      return next.length > MAX_PANES
        ? next.slice(next.length - MAX_PANES)
        : next;
    });
    setActive(Math.min(open.length, MAX_PANES - 1));
  };
  const close = (id: string) =>
    setOpen((current) => current.filter((item) => item !== id));

  const attention = project.summary.attention;
  const sections: Array<{ id: DetailItem; label: string; note: string }> = [
    { id: 'brief', label: 'Brief', note: briefNote(project) },
    { id: 'method', label: 'Method', note: methodNote(project) },
    { id: 'plan', label: 'Plan', note: planNote(project) },
    { id: 'agents', label: 'Agents', note: agentsNote(project) },
    { id: 'artifacts', label: 'Artifacts', note: artifactsNote(project) },
    {
      id: 'history',
      label: 'Changes',
      note: `${project.projection.lastSequence} recorded`,
    },
  ];

  return (
    <div
      className={`ws ${sideOpen ? 'has-side' : ''} ${detail ? 'has-detail' : ''}`}
    >
      <a className="skip-link" href="#panes">
        Skip to conversation
      </a>
      <header className="ws-header">
        <button
          type="button"
          className="explorer-toggle"
          aria-pressed={sideOpen}
          aria-label={sideOpen ? 'Hide sidebar' : 'Show sidebar'}
          onClick={() => setSideOpen((value) => !value)}
        >
          <span className="brand-mark small" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span aria-hidden="true">☰</span>
        </button>
        <h1 className="app-title">{project.projection.project.name}</h1>
        <span
          className={`mode-badge mode-${project.runtime.mode}`}
          title={runtimeNote(project.runtime)}
        >
          {runtimeLabel(project.runtime)}
        </span>
        <span
          className={`pane-state work-${project.summary.status}`}
          title="What the project is doing right now"
        >
          {statusLabels[project.summary.status]}
        </span>
        <div className="view-switch" role="group" aria-label="View">
          <button
            type="button"
            aria-pressed={view === 'chat'}
            onClick={() => setView('chat')}
          >
            Conversation
          </button>
          <button
            type="button"
            aria-pressed={view === 'map'}
            onClick={() => setView('map')}
          >
            Map
          </button>
          <button
            type="button"
            aria-pressed={view === 'review'}
            onClick={() => {
              setReviewOpened(true);
              setView('review');
            }}
          >
            Review
          </button>
        </div>
        <div className="app-actions">
          {attention ? (
            <button
              type="button"
              className="attention-chip"
              onClick={() =>
                show(
                  attention.kind === 'ask' || attention.kind === 'check_failed'
                    ? attention.agentId
                    : 'coordinator',
                )
              }
            >
              <span aria-hidden="true">!</span> {attention.label}
            </button>
          ) : null}
          <button
            type="button"
            className="quiet-button"
            onClick={() => void refresh()}
          >
            Refresh
          </button>
        </div>
      </header>

      {sideOpen ? (
        <aside className="ws-side" aria-label="Project">
          <button type="button" className="ws-back" onClick={onHome}>
            ← Projects
          </button>
          <div className="ws-repo">
            {repository ? (
              <>
                <span className="folder-mark is-repo" aria-hidden="true">
                  ⎇
                </span>
                <span className="ws-repo-name" title={repository.path}>
                  {repository.name}
                  {repository.branch ? (
                    <small> · {repository.branch}</small>
                  ) : null}
                </span>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => setPicking(true)}
                >
                  change
                </button>
              </>
            ) : (
              <>
                <span className="ws-repo-name muted">No folder attached</span>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => setPicking(true)}
                >
                  attach
                </button>
              </>
            )}
          </div>
          {picking ? (
            <FolderPicker
              initialPath={repository?.path}
              onPick={(path) => void attach(path)}
              onCancel={() => setPicking(false)}
            />
          ) : null}
          <label className="ws-trust" title={TRUST_POLICIES[trust].note}>
            <span>Asks</span>
            <select
              value={trust}
              aria-label="How often agents ask before acting"
              onChange={(event) => {
                const next = TrustPolicySchema.parse(event.target.value);
                void setTrust(
                  project.projection.projectId,
                  project.projection.lastSequence,
                  next,
                )
                  .then((result) => {
                    updateProject(result.project);
                    onNotice(`${TRUST_POLICIES[next].label}.`);
                  })
                  .catch((error: unknown) =>
                    onError(
                      error instanceof Error
                        ? error.message
                        : 'The setting was not saved.',
                    ),
                  );
              }}
            >
              {TrustPolicySchema.options.map((policy) => (
                <option key={policy} value={policy}>
                  {TRUST_POLICIES[policy].label}
                </option>
              ))}
            </select>
          </label>
          <h2 className="ws-side-title">Conversations</h2>
          <ul className="ws-list">
            {targets.map((target) => {
              const id = liveTargetId(target);
              const isOpen = open.includes(id);
              return (
                <li key={id} className={`category-${targetCategory(target)}`}>
                  <button
                    type="button"
                    aria-pressed={isOpen}
                    onClick={() => show(id)}
                  >
                    <span className="cat-dot" aria-hidden="true" />
                    <span className="ws-list-name">{targetName(target)}</span>
                    <small>
                      {target.kind === 'agent'
                        ? workLabels[target.agent.work]
                        : 'plans with you'}
                    </small>
                  </button>
                </li>
              );
            })}
            <li className="ws-list-add">
              <button type="button" onClick={() => void addAgent()}>
                <span className="cat-dot" aria-hidden="true" />
                <span className="ws-list-name">New agent</span>
                <small>a pane you can type into</small>
              </button>
            </li>
          </ul>
          <h2 className="ws-side-title">Project</h2>
          <ul className="ws-list">
            {sections.map((section) => (
              <li key={section.id}>
                <button
                  type="button"
                  aria-pressed={detail === section.id}
                  onClick={() =>
                    setDetail(detail === section.id ? undefined : section.id)
                  }
                >
                  <span className="ws-list-name">{section.label}</span>
                  <small>{section.note}</small>
                </button>
              </li>
            ))}
          </ul>
          {projects.length > 1 ? (
            <p className="ws-side-foot">
              {projects.length} projects ·{' '}
              <button type="button" className="link-button" onClick={onHome}>
                switch
              </button>
            </p>
          ) : null}
        </aside>
      ) : null}

      {openTargets.length > 1 || targets.length > 1 ? (
        <div
          className="pane-switcher"
          role="tablist"
          aria-label="Conversations"
        >
          {targets.map((target) => {
            const id = liveTargetId(target);
            const index = openTargets.findIndex((t) => liveTargetId(t) === id);
            const isOpen = index >= 0;
            return (
              <button
                type="button"
                role="tab"
                key={id}
                aria-selected={isOpen && index === activeIndex}
                className={`category-${targetCategory(target)} ${isOpen ? '' : 'is-closed'}`}
                onClick={() => show(id)}
              >
                <span className="cat-dot" aria-hidden="true" />
                {targetName(target)}
                {target.kind === 'agent' &&
                target.agent.work === 'needs_you' ? (
                  <b className="tab-badge">1</b>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}

      <main
        className="panes"
        id="panes"
        data-count={view === 'chat' ? openTargets.length : 1}
      >
        {reviewOpened ? (
          <div className="review-slot" hidden={view !== 'review'}>
            <ReviewView
              project={project}
              onAsk={(item, targetId) => {
                attachContext(item, targetId);
                setView('chat');
              }}
              onOpenAgent={(agentId) => {
                show(agentId);
                setView('chat');
              }}
              onOpenArtifact={(path) => openArtifact(path)}
            />
          </div>
        ) : null}
        {view === 'map' ? (
          <MapView
            project={project}
            onOpenAgent={(agentId) => {
              show(agentId);
              setView('chat');
            }}
            onOpenArtifact={(path) => openArtifact(path)}
            onOpenSection={() => setDetail('plan')}
            onAsk={attachContext}
          />
        ) : null}
        {view === 'chat'
          ? openTargets.map((target, index) => (
              <div
                key={liveTargetId(target)}
                className={`pane-slot ${index === activeIndex ? 'is-active' : ''}`}
              >
                <LivePane
                  project={project}
                  target={target}
                  canClose={openTargets.length > 1}
                  onProject={updateProject}
                  onClose={() => close(liveTargetId(target))}
                  onOpenArtifact={openArtifact}
                  onAddToPlan={addToPlan}
                  onNeedFolder={() => {
                    setSideOpen(true);
                    setPicking(true);
                  }}
                  context={contexts[liveTargetId(target)] ?? []}
                  onContext={(next) =>
                    setContexts((current) => ({
                      ...current,
                      [liveTargetId(target)]: next,
                    }))
                  }
                />
              </div>
            ))
          : null}
      </main>

      {detail ? (
        <ProjectDetail
          item={detail}
          artifact={artifact}
          onSelectArtifact={setArtifact}
          project={project}
          busy={false}
          onProject={updateProject}
          onError={onError}
          onAsk={attachContext}
          onOpenArtifact={openArtifact}
          onOpenAgent={(agentId) => {
            show(agentId);
            setView('chat');
          }}
          onOpenSection={(item) => setDetail(item)}
          onClose={() => setDetail(undefined)}
        />
      ) : null}
    </div>
  );
}
