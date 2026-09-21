import { useState, type KeyboardEvent } from 'react';
import type { ProjectListResponse } from '@harness/contracts';
import { createProject, postMessage } from './api';
import { FolderPicker } from './folder-picker';
import { runtimeNote, nameFromRequest, statusNotes } from './project-notes';

// The start screen. One thing to do: say what you're building. That
// creates the project and hands your words to its coordinator.

export function Home({
  projects,
  runtime,
  onOpen,
  onCreated,
  onError,
}: {
  projects: ProjectListResponse['projects'];
  runtime: ProjectListResponse['runtime'];
  onOpen: (projectId: string) => void;
  onCreated: (projectId: string) => void;
  onError: (message: string) => void;
}) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [folder, setFolder] = useState<string>();
  const [picking, setPicking] = useState(false);

  const start = async () => {
    const body = value.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      const created = await createProject(nameFromRequest(body), folder);
      const projectId = created.project.projection.projectId;
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
        <form
          className="home-composer composer category-neutral"
          onSubmit={(event) => {
            event.preventDefault();
            void start();
          }}
          aria-label="Start a project"
        >
          <span className="composer-rail" aria-hidden="true" />
          <div className="composer-field">
            <textarea
              autoFocus
              rows={3}
              value={value}
              placeholder="What are we building?"
              aria-label="What are we building?"
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
            Start <kbd>⏎</kbd>
          </button>
        </form>
        <div className="home-folder">
          {folder ? (
            <>
              <span className="folder-mark is-repo" aria-hidden="true">
                ⎇
              </span>
              <code title={folder}>{folder.split('/').pop()}</code>
              <button
                type="button"
                className="link-button"
                onClick={() => setPicking(true)}
              >
                change
              </button>
              <button
                type="button"
                className="link-button"
                onClick={() => setFolder(undefined)}
              >
                remove
              </button>
            </>
          ) : (
            <>
              <span>No folder attached</span>
              <button
                type="button"
                className="link-button"
                onClick={() => setPicking(true)}
              >
                choose a folder
              </button>
            </>
          )}
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
        <p className="home-hint">
          Enter starts a project: a coordinator that plans with you, and agent
          panes you can type into directly. Attach a folder so agents know where
          the code lives. {runtimeNote(runtime)}
        </p>
      </main>
    </div>
  );
}
