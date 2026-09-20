import { useEffect, useState } from 'react';
import type { ProjectListResponse, ProjectResponse } from '@harness/contracts';
import { listProjects, readProject } from './api';
import { Home } from './home';
import { Workspace } from './workspace';

// Two screens: the start screen (your projects, one composer) and the
// project workspace. Everything on both comes from the local service.

type Screen =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'home' }
  | { kind: 'project'; project: ProjectResponse };

export function App() {
  const [screen, setScreen] = useState<Screen>({ kind: 'loading' });
  const [projects, setProjects] = useState<ProjectListResponse['projects']>([]);
  const [actionError, setActionError] = useState<string>();
  const [notice, setNotice] = useState('');

  const load = async () => {
    try {
      const list = await listProjects();
      setProjects(list.projects);
      setScreen({ kind: 'home' });
    } catch (error) {
      setScreen({
        kind: 'error',
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
      .then((list) => {
        if (!active) return;
        setProjects(list.projects);
        setScreen({ kind: 'home' });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setScreen({
          kind: 'error',
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

  const openProject = async (projectId: string) => {
    try {
      const project = await readProject(projectId);
      setScreen({ kind: 'project', project });
      setActionError(undefined);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : 'Could not open the project.',
      );
    }
  };

  const goHome = async () => {
    try {
      setProjects((await listProjects()).projects);
    } catch {
      // Keep the list we have.
    }
    setScreen({ kind: 'home' });
  };

  if (screen.kind === 'loading') {
    return (
      <main className="loading-screen" aria-live="polite">
        <span className="loading-orbit" aria-hidden="true" />
        <p>Opening your projects…</p>
      </main>
    );
  }
  if (screen.kind === 'error') {
    return (
      <main className="loading-screen error-screen">
        <h1>The local service is not answering.</h1>
        <p>{screen.message}</p>
        <button
          className="primary-action"
          type="button"
          onClick={() => void load()}
        >
          Try again
        </button>
      </main>
    );
  }

  return (
    <>
      {screen.kind === 'home' ? (
        <Home
          projects={projects}
          onOpen={(id) => void openProject(id)}
          onCreated={(id) => void openProject(id)}
          onError={setActionError}
        />
      ) : (
        <Workspace
          key={screen.project.projection.projectId}
          initial={screen.project}
          projects={projects}
          onProjects={setProjects}
          onHome={() => void goHome()}
          onError={setActionError}
          onNotice={setNotice}
        />
      )}
      {actionError ? (
        <div className="toast toast-error" role="alert">
          {actionError}
          <button
            type="button"
            className="quiet-button"
            onClick={() => setActionError(undefined)}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      ) : null}
      <div className="sr-live" aria-live="polite" aria-atomic="true">
        {notice}
      </div>
    </>
  );
}
