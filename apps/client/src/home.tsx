import { useState, type KeyboardEvent } from 'react';
import type { ProjectListResponse, RuntimeSettings } from '@harness/contracts';
import { createAgent, createProject, postMessage } from './api';
import { FolderPicker } from './folder-picker';
import {
  nameFromRequest,
  recentFolders,
  runtimeLabel,
  runtimeNote,
  statusNotes,
} from './project-notes';
import { RuntimeSetup } from './runtime-setup';

// The start screen. Two decisions, in order: where is the code, and what
// to do. With a folder, typing starts an agent on it. Without one, the
// words go to the coordinator to plan.

export function Home({
  projects,
  runtime,
  onOpen,
  onCreated,
  onError,
  onRuntimeChanged,
}: {
  projects: ProjectListResponse['projects'];
  runtime: ProjectListResponse['runtime'];
  onOpen: (projectId: string) => void;
  onCreated: (projectId: string) => void;
  onError: (message: string) => void;
  onRuntimeChanged: (settings: RuntimeSettings) => void;
}) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [folder, setFolder] = useState<string>();
  const [picking, setPicking] = useState(false);
  const [setup, setSetup] = useState(false);
  const recent = recentFolders(projects);

  const start = async () => {
    const body = value.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      const created = await createProject(nameFromRequest(body), folder);
      const projectId = created.project.projection.projectId;
      if (folder) {
        // A folder means work: one agent, and the words are its task.
        const agent = await createAgent(
          projectId,
          created.project.projection.lastSequence,
          'Agent 1',
          'neutral',
        );
        const agentId = agent.receipt.createdIds.agents?.[0];
        const thread = agentId
          ? agent.project.projection.threads[
              agent.project.projection.agents[agentId]!.threadId
            ]
          : undefined;
        if (agentId && thread) {
          await postMessage(projectId, agentId, {
            expectedSequence: thread.lastSequence,
            body,
            intent: 'start_work',
          });
        }
      } else {
        const coordinator = Object.values(
          created.project.projection.threads,
        ).find((thread) => thread.kind === 'coordinator');
        if (coordinator) {
          await postMessage(projectId, 'coordinator', {
            expectedSequence: coordinator.lastSequence,
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
        {projects.length ? (
          <ul className="home-projects">
            {projects.map((item) => (
              <li key={item.project.id}>
                <button type="button" onClick={() => onOpen(item.project.id)}>
                  <span>{item.project.name}</span>
                  <small>
                    {item.project.repository
                      ? `${item.project.repository.name} · `
                      : ''}
                    {statusNotes[item.summary.status] ?? item.summary.status}
                    {item.project.origin === 'demo' ? ' · demo' : ''}
                  </small>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="home-empty">Nothing yet. Start one on the right.</p>
        )}
      </aside>
      <main className="home-main">
        <section className="home-where" aria-label="Where is the code?">
          <h2 className="home-step">Where is the code?</h2>
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
              Choose a folder…
            </button>
            <button
              type="button"
              className={`chip ${folder === undefined ? 'is-on chip-quiet' : 'chip-quiet'}`}
              aria-pressed={folder === undefined}
              onClick={() => setFolder(undefined)}
            >
              No folder — just plan
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
          aria-label={folder ? 'Start work' : 'Start a project'}
        >
          <span className="composer-rail" aria-hidden="true" />
          <div className="composer-field">
            <textarea
              autoFocus
              rows={3}
              value={value}
              placeholder={
                folder
                  ? `What should the agent do in ${folderName}?`
                  : 'What are we building?'
              }
              aria-label={
                folder ? 'What should the agent do?' : 'What are we building?'
              }
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
            {folder ? 'Start work' : 'Plan'} <kbd>⏎</kbd>
          </button>
        </form>

        <p className="home-hint">
          {folder
            ? 'Enter opens the project on an agent pane and starts this as its first task. You approve what it wants to run or change.'
            : 'Enter opens the project on the coordinator, which plans it with you. Attach a folder any time to start work.'}
        </p>

        <div className="home-runtime">
          <span
            className={`mode-badge mode-${runtime.mode}`}
            title={runtimeNote(runtime)}
          >
            {runtimeLabel(runtime)}
          </span>
          <span className="home-runtime-note">{runtimeNote(runtime)}</span>
          <button
            type="button"
            className="link-button"
            onClick={() => setSetup((open) => !open)}
          >
            {setup ? 'close' : 'change'}
          </button>
        </div>
        {setup ? (
          <RuntimeSetup
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
