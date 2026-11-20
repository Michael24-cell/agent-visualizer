import { useEffect, useState } from 'react';
import type { ProjectListResponse, ProjectResponse } from '@harness/contracts';
import { listProjects, readProject } from './api';
import { Home } from './home';
import { runtimeFromSettings, runtimeLabel } from './project-notes';
import { Workspace } from './workspace';

// Two screens: the start screen (your projects, one composer) and the
// project workspace. Everything on both comes from the local service.

type Screen =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'home' }
  | { kind: 'project'; project: ProjectResponse };

// The open project is kept in the address (#project=…), so a reload or
// a bookmark comes back to it instead of the start screen.
function projectInAddress(): string | undefined {
  const match = /^#project=([\w-]+)$/.exec(window.location.hash);
  return match?.[1];
}

function setAddress(projectId: string | undefined) {
  const next = projectId ? `#project=${projectId}` : '';
  if (window.location.hash === next) return;
  window.history.replaceState(
    null,
    '',
    `${window.location.pathname}${window.location.search}${next}`,
  );
}

export function App() {
  const [screen, setScreen] = useState<Screen>({ kind: 'loading' });
  const [projects, setProjects] = useState<ProjectListResponse['projects']>([]);
  const [runtime, setRuntime] = useState<ProjectListResponse['runtime']>({
    mode: 'simulated',
  });
  const [actionError, setActionError] = useState<string>();
  const [notice, setNotice] = useState('');

  const load = async () => {
    try {
      const list = await listProjects();
      setProjects(list.projects);
      setRuntime(list.runtime);
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
      .then(async (list) => {
        if (!active) return;
        setProjects(list.projects);
        setRuntime(list.runtime);
        const remembered = projectInAddress();
        if (
          remembered &&
          list.projects.some((item) => item.project.id === remembered)
        ) {
          try {
            const project = await readProject(remembered);
            if (active) setScreen({ kind: 'project', project });
            return;
          } catch {
            // Fall through to the start screen.
          }
        }
        setAddress(undefined);
        if (active) setScreen({ kind: 'home' });
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

  // A service that is restarting comes back by itself: keep trying
  // quietly instead of leaving a dead end that needs a click.
  const waiting = screen.kind === 'error';
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => {
      void listProjects()
        .then((list) => {
          setProjects(list.projects);
          setRuntime(list.runtime);
          setScreen({ kind: 'home' });
        })
        .catch(() => undefined);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [waiting]);

  const openProject = async (projectId: string) => {
    try {
      const project = await readProject(projectId);
      setScreen({ kind: 'project', project });
      setAddress(projectId);
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
    setAddress(undefined);
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
        <p className="muted">
          Trying again every few seconds. If it stays down, restart it with{' '}
          <code>npm start</code> in the project folder.
        </p>
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
          runtime={runtime}
          onOpen={(id) => void openProject(id)}
          onCreated={(id) => void openProject(id)}
          onError={setActionError}
          onProjectsChanged={() => {
            void listProjects()
              .then((list) => setProjects(list.projects))
              .catch(() => undefined);
          }}
          onRuntimeChanged={(settings) => {
            setRuntime(runtimeFromSettings(settings));
            setNotice(
              settings.kind === 'simulated'
                ? 'Agents are practice agents.'
                : `Agents now use ${runtimeLabel(runtimeFromSettings(settings))}.`,
            );
          }}
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
