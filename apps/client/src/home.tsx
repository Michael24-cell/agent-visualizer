import { useState, type KeyboardEvent } from 'react';
import type { ProjectListResponse, RuntimeSettings } from '@harness/contracts';
import {
  archiveProject,
  createProject,
  deleteProject,
  postMessage,
  renameProject,
} from './api';
import { FolderPicker } from './folder-picker';
import {
  nameFromRequest,
  recentFolders,
  runtimeLabel,
  statusNotes,
} from './project-notes';
import { AccountChoice } from './runtime-setup';

// The start screen asks two things in plain words: what do you want to
// build or change, and where. On a first visit with no model connected it
// asks one more — which account agents should use — before anything else.

type Item = ProjectListResponse['projects'][number];

export function Home({
  projects,
  runtime,
  onOpen,
  onCreated,
  onError,
  onRuntimeChanged,
  onProjectsChanged,
}: {
  projects: ProjectListResponse['projects'];
  runtime: ProjectListResponse['runtime'];
  onOpen: (projectId: string) => void;
  onCreated: (projectId: string) => void;
  onError: (message: string) => void;
  onRuntimeChanged: (settings: RuntimeSettings) => void;
  onProjectsChanged: () => void;
}) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [folder, setFolder] = useState<string>();
  const [picking, setPicking] = useState(false);
  const [setup, setSetup] = useState(false);
  const [accountSettled, setAccountSettled] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const active = projects.filter((item) => !item.project.archivedAt);
  const archived = projects.filter((item) => item.project.archivedAt);
  const recent = recentFolders(active);
  // A first visit: nothing made yet and no model connected.
  const firstRun =
    !accountSettled && projects.length === 0 && runtime.mode === 'simulated';

  const start = async () => {
    const body = value.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      const created = await createProject(nameFromRequest(body), folder);
      const projectId = created.project.projection.projectId;
      if (folder) {
        // A folder means work: the words are the first agent's task.
        const agent = Object.values(created.project.projection.agents)[0];
        const agentId = agent?.id;
        const thread = agent
          ? created.project.projection.threads[agent.threadId]
          : undefined;
        if (agentId && thread) {
          await postMessage(projectId, agentId, {
            expectedSequence: thread.lastSequence,
            body,
            intent: 'start_work',
          });
        }
      } else {
        const planner = Object.values(created.project.projection.threads).find(
          (thread) => thread.kind === 'coordinator',
        );
        if (planner) {
          await postMessage(projectId, 'coordinator', {
            expectedSequence: planner.lastSequence,
            body,
            intent: 'chat',
          });
        }
      }
      setValue('');
      onCreated(projectId);
    } catch (error) {
      onError(
        error instanceof Error ? error.message : 'The project was not created.',
      );
    } finally {
      setBusy(false);
    }
  };

  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void start();
    }
  };

  const folderName = folder?.split('/').pop() ?? '';

  return (
    <div className="home">
      <aside className="home-side" aria-label="Projects">
        <div className="home-brand">
          <span className="brand-mark small" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <strong>Harness</strong>
        </div>
        <h2 className="home-side-title">Projects</h2>
        {active.length ? (
          <ul className="home-projects">
            {active.map((item) => (
              <ProjectRow
                key={item.project.id}
                item={item}
                onOpen={onOpen}
                onChanged={onProjectsChanged}
                onError={onError}
              />
            ))}
          </ul>
        ) : (
          <p className="home-empty">
            {archived.length
              ? 'Nothing open. Start one on the right.'
              : 'Your projects will be listed here.'}
          </p>
        )}
        {archived.length ? (
          <>
            <button
              type="button"
              className="home-side-toggle"
              aria-expanded={showArchived}
              onClick={() => setShowArchived((open) => !open)}
            >
              {showArchived ? '▾' : '▸'} Archived ({archived.length})
            </button>
            {showArchived ? (
              <ul className="home-projects is-archived">
                {archived.map((item) => (
                  <ProjectRow
                    key={item.project.id}
                    item={item}
                    onOpen={onOpen}
                    onChanged={onProjectsChanged}
                    onError={onError}
                  />
                ))}
              </ul>
            ) : null}
          </>
        ) : null}
      </aside>
      <main className="home-main">
        <header className="home-intro">
          <h1>What do you want to build or change?</h1>
          <p>
            Say it in your own words. Agents do the work in a folder you choose,
            ask before they run or change anything, and show you every change
            afterwards.
          </p>
        </header>

        {firstRun ? (
          <AccountChoice
            onSaved={(settings) => {
              onRuntimeChanged(settings);
              setAccountSettled(true);
            }}
          />
        ) : null}

        <section className="home-where" aria-label="Where?">
          <h2 className="home-step">Where?</h2>
          <div className="home-chips">
            {recent.map((path) => (
              <button
                key={path}
                type="button"
                className={`chip ${folder === path ? 'is-on' : ''}`}
                title={path}
                aria-pressed={folder === path}
                onClick={() => setFolder(folder === path ? undefined : path)}
              >
                <span className="folder-mark is-repo" aria-hidden="true">
                  ⎇
                </span>
                {path.split('/').pop()}
              </button>
            ))}
            {folder && !recent.includes(folder) ? (
              <button
                type="button"
                className="chip is-on"
                title={folder}
                aria-pressed
                onClick={() => setFolder(undefined)}
              >
                <span className="folder-mark is-repo" aria-hidden="true">
                  ⎇
                </span>
                {folderName}
              </button>
            ) : null}
            <button
              type="button"
              className="chip chip-action"
              onClick={() => setPicking(true)}
            >
              Choose or make a folder…
            </button>
            <button
              type="button"
              className={`chip ${folder === undefined ? 'is-on chip-quiet' : 'chip-quiet'}`}
              aria-pressed={folder === undefined}
              onClick={() => setFolder(undefined)}
            >
              Just plan it for now
            </button>
          </div>
          {picking ? (
            <FolderPicker
              initialPath={folder}
              onPick={(path) => {
                setFolder(path);
                setPicking(false);
              }}
              onCancel={() => setPicking(false)}
            />
          ) : null}
        </section>

        <form
          className="home-composer composer category-neutral"
          onSubmit={(event) => {
            event.preventDefault();
            void start();
          }}
          aria-label={folder ? 'Start work' : 'Start planning'}
        >
          <span className="composer-rail" aria-hidden="true" />
          <div className="composer-field">
            <textarea
              autoFocus
              rows={3}
              value={value}
              placeholder={
                folder
                  ? `What should change in ${folderName}?`
                  : 'For example: a page where customers can download their invoices'
              }
              aria-label="What do you want to build or change?"
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={onKey}
              disabled={busy}
            />
          </div>
          <button
            type="submit"
            className="composer-send"
            disabled={busy || !value.trim()}
          >
            {folder ? 'Start' : 'Plan it'} <kbd>⏎</kbd>
          </button>
        </form>

        <p className="home-hint">
          {folder
            ? `An agent starts on this in ${folderName} right away. It asks before running commands or changing files.`
            : 'The planner talks it through with you and drafts the tasks. Nothing is changed until you pick a folder.'}
        </p>

        {firstRun ? null : (
          <div className="home-runtime">
            <span>
              Agents: <strong>{runtimeLabel(runtime)}</strong>
            </span>
            <button
              type="button"
              className="link-button"
              aria-expanded={setup}
              onClick={() => setSetup((open) => !open)}
            >
              {setup ? 'close' : 'change'}
            </button>
          </div>
        )}
        {setup && !firstRun ? (
          <AccountChoice
            onSaved={(settings) => {
              onRuntimeChanged(settings);
              setSetup(false);
            }}
            onClose={() => setSetup(false)}
          />
        ) : null}
      </main>
    </div>
  );
}

// One project in the list: open it, or from its menu rename, archive or
// restore, and delete (asked twice, because it cannot be undone).
function ProjectRow({
  item,
  onOpen,
  onChanged,
  onError,
}: {
  item: Item;
  onOpen: (projectId: string) => void;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const { project, summary } = item;
  const [mode, setMode] = useState<'idle' | 'menu' | 'rename' | 'delete'>(
    'idle',
  );
  const [name, setName] = useState(project.name);
  const [busy, setBusy] = useState(false);

  const act = async (work: () => Promise<unknown>, failed: string) => {
    setBusy(true);
    try {
      await work();
      setMode('idle');
      onChanged();
    } catch (error) {
      onError(error instanceof Error ? error.message : failed);
    } finally {
      setBusy(false);
    }
  };

  if (mode === 'rename') {
    return (
      <li className="home-project is-editing">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const next = name.trim();
            if (!next || next === project.name) {
              setMode('idle');
              return;
            }
            void act(
              () => renameProject(project.id, summary.lastSequence, next),
              'The project was not renamed.',
            );
          }}
        >
          <input
            autoFocus
            value={name}
            maxLength={120}
            aria-label="Project name"
            disabled={busy}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setName(project.name);
                setMode('idle');
              }
            }}
          />
          <button
            type="submit"
            className="primary-action small"
            disabled={busy}
          >
            Save
          </button>
        </form>
      </li>
    );
  }

  if (mode === 'delete') {
    return (
      <li className="home-project is-confirming" role="alertdialog">
        <p>
          Delete <strong>{project.name}</strong> and its whole history? This
          cannot be undone. Files in its folder are not touched.
        </p>
        <div className="home-project-actions">
          <button
            type="button"
            className="danger-action small"
            disabled={busy}
            onClick={() =>
              void act(
                () => deleteProject(project.id),
                'The project was not deleted.',
              )
            }
          >
            Delete
          </button>
          <button
            type="button"
            className="quiet-button"
            onClick={() => setMode('idle')}
          >
            Keep it
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className={`home-project ${mode === 'menu' ? 'has-menu' : ''}`}>
      <button
        type="button"
        className="home-project-open"
        onClick={() => onOpen(project.id)}
      >
        <span>{project.name}</span>
        <small>
          {project.repository ? `${project.repository.name} · ` : ''}
          {statusNotes[summary.status] ?? summary.status}
          {project.origin === 'demo' ? ' · demo' : ''}
        </small>
      </button>
      <button
        type="button"
        className="home-project-more"
        aria-label={`More for ${project.name}`}
        aria-expanded={mode === 'menu'}
        onClick={() => setMode(mode === 'menu' ? 'idle' : 'menu')}
      >
        ⋯
      </button>
      {mode === 'menu' ? (
        <div className="home-project-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setName(project.name);
              setMode('rename');
            }}
          >
            Rename
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={busy}
            onClick={() =>
              void act(
                () =>
                  archiveProject(
                    project.id,
                    summary.lastSequence,
                    !project.archivedAt,
                  ),
                project.archivedAt
                  ? 'The project was not restored.'
                  : 'The project was not archived.',
              )
            }
          >
            {project.archivedAt ? 'Restore' : 'Archive'}
          </button>
          <button
            type="button"
            role="menuitem"
            className="is-danger"
            onClick={() => setMode('delete')}
          >
            Delete…
          </button>
        </div>
      ) : null}
    </li>
  );
}
