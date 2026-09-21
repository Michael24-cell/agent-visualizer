import { useState } from 'react';
import type { ProjectListResponse, ProjectResponse } from '@harness/contracts';
import {
  attachRepository,
  createAgent,
  listProjects,
  readProject,
  setTrust,
} from './api';
import {
  TRUST_POLICIES,
  TrustPolicySchema,
  projectTrust,
} from '@harness/contracts';
import { FolderPicker } from './folder-picker';
import { liveTargetId, liveTargets, workLabels, type LiveTarget } from './live';
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
  const [open, setOpen] = useState<string[]>(() => {
    const first = liveTargets(initial).find((t) => t.kind === 'agent');
    return [first ? liveTargetId(first) : 'coordinator'];
  });
  const [active, setActive] = useState(0);
  const [sideOpen, setSideOpen] = useState(
    () => typeof window === 'undefined' || window.innerWidth > 960,
  );
  const [detail, setDetail] = useState<DetailItem>();
  const [artifact, setArtifact] = useState<string>();
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
      label: 'History',
      note: `${project.projection.lastSequence} events`,
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

      <main className="panes" id="panes" data-count={openTargets.length}>
        {openTargets.map((target, index) => (
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
            />
          </div>
        ))}
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
          onClose={() => setDetail(undefined)}
        />
      ) : null}
    </div>
  );
}
