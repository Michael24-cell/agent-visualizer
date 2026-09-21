import { useEffect, useState } from 'react';
import type { ProjectFile, ProjectResponse } from '@harness/contracts';
import { projectFileUrl, readProjectFile, revealProjectFile } from './api';
import { Markdown } from './markdown';
import { artifactPaths } from './project-notes';

// Files agents wrote, listed newest first, with the chosen one rendered.
// The content re-reads while the project is changing so a file being
// rewritten updates in place.

export function ArtifactsView({
  project,
  selected,
  onSelect,
}: {
  project: ProjectResponse;
  selected: string | undefined;
  onSelect: (path: string | undefined) => void;
}) {
  const paths = artifactPaths(project);
  const projectId = project.projection.projectId;
  const [actionNote, setActionNote] = useState<string>();
  const act = async (mode: 'reveal' | 'open') => {
    if (!selected) return;
    try {
      await revealProjectFile(projectId, selected, mode);
      setActionNote(mode === 'reveal' ? 'Shown in Finder.' : 'Opened.');
    } catch (cause) {
      setActionNote(cause instanceof Error ? cause.message : 'Could not open.');
    }
  };
  const lastSequence = project.projection.lastSequence;
  const busy = project.busyThreadIds.length > 0;
  const [file, setFile] = useState<ProjectFile>();
  const [error, setError] = useState<string>();
  const [tick, setTick] = useState(0);

  // Re-read on every project change, and every 2s while agents work.
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => setTick((value) => value + 1), 2_000);
    return () => clearInterval(timer);
  }, [busy]);

  useEffect(() => {
    if (!selected) return;
    let active = true;
    void readProjectFile(projectId, selected)
      .then((next) => {
        if (!active) return;
        setFile(next);
        setError(undefined);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setFile(undefined);
        setError(cause instanceof Error ? cause.message : 'Could not read it.');
      });
    return () => {
      active = false;
    };
  }, [projectId, selected, lastSequence, tick]);

  if (!paths.length && !selected) {
    return (
      <p className="detail-lead">
        Nothing written yet. Files agents create or change appear here, and a{' '}
        <strong>Write</strong> or <strong>Read</strong> row in a conversation
        opens them.
      </p>
    );
  }

  return (
    <div className="artifacts">
      <ul className="artifact-list" aria-label="Files agents wrote">
        {paths.map((path) => (
          <li key={path}>
            <button
              type="button"
              aria-pressed={selected === path}
              onClick={() => onSelect(selected === path ? undefined : path)}
            >
              {path}
            </button>
          </li>
        ))}
      </ul>
      {selected ? (
        <section className="artifact" aria-label={selected}>
          <header className="artifact-head">
            <nav className="artifact-crumbs" aria-label="Path">
              {selected.split('/').map((part, index, parts) => (
                <span key={`${index}-${part}`}>
                  {index > 0 ? <span className="crumb-sep">/</span> : null}
                  <span
                    className={index === parts.length - 1 ? 'crumb-leaf' : ''}
                  >
                    {part}
                  </span>
                </span>
              ))}
            </nav>
            {file && file.path === selected ? (
              <span className="doc-meta">
                {formatSize(file.size)}
                {file.truncated ? ' · first 512 KB' : ''}
                {busy ? ' · live' : ''}
              </span>
            ) : null}
            <span className="artifact-actions">
              <button
                type="button"
                className="quiet-button"
                onClick={() => void act('reveal')}
                title="Show in Finder"
              >
                Finder
              </button>
              <button
                type="button"
                className="quiet-button"
                onClick={() => void act('open')}
                title="Open with the default app"
              >
                Open
              </button>
            </span>
          </header>
          {actionNote ? <p className="doc-hint">{actionNote}</p> : null}
          {error ? <p className="field-value muted">{error}</p> : null}
          {file && file.path === selected ? (
            <ArtifactBody file={file} projectId={projectId} />
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function ArtifactBody({
  file,
  projectId,
}: {
  file: ProjectFile;
  projectId: string;
}) {
  const [raw, setRaw] = useState(false);
  if (file.kind === 'binary') {
    return <p className="field-value muted">Binary file; nothing to show.</p>;
  }
  if (file.kind === 'image') {
    return (
      <img
        className="artifact-image"
        src={`${projectFileUrl(projectId, file.path)}&v=${encodeURIComponent(file.modifiedAt)}`}
        alt={file.path}
      />
    );
  }
  const toggle =
    file.kind === 'markdown' || file.kind === 'html' ? (
      <button
        type="button"
        className="quiet-button artifact-toggle"
        onClick={() => setRaw((value) => !value)}
      >
        {raw ? 'Rendered' : 'Source'}
      </button>
    ) : null;
  if (file.kind === 'markdown' && !raw) {
    return (
      <>
        {toggle}
        <div className="artifact-markdown msg-body">
          <Markdown text={file.content} />
        </div>
      </>
    );
  }
  if (file.kind === 'html' && !raw) {
    return (
      <>
        {toggle}
        <iframe
          className="artifact-frame"
          title={file.path}
          sandbox=""
          srcDoc={file.content}
        />
      </>
    );
  }
  return (
    <>
      {toggle}
      <pre className="artifact-code">
        <code>{file.content}</code>
      </pre>
    </>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
