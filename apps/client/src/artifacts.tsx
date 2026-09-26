import { useEffect, useState } from 'react';
import type {
  MessageContext,
  ProjectFile,
  ProjectResponse,
} from '@harness/contracts';
import {
  projectFileUrl,
  readProjectFile,
  revealProjectFile,
  writeProjectFile,
} from './api';
import { Markdown } from './markdown';
import { artifactPaths } from './project-notes';

// Files agents wrote, listed newest first, with the chosen one rendered.
// The content re-reads while the project is changing so a file being
// rewritten updates in place.

export function ArtifactsView({
  project,
  selected,
  onSelect,
  onAsk,
}: {
  project: ProjectResponse;
  selected: string | undefined;
  onSelect: (path: string | undefined) => void;
  onAsk?: ((context: MessageContext) => void) | undefined;
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
            <ArtifactBody
              file={file}
              projectId={projectId}
              onAsk={onAsk}
              onSaved={(next) => {
                setFile(next);
                setActionNote('Saved.');
              }}
              onError={(message) => setActionNote(message)}
            />
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function ArtifactBody({
  file,
  projectId,
  onAsk,
  onSaved,
  onError,
}: {
  file: ProjectFile;
  projectId: string;
  onAsk?: ((context: MessageContext) => void) | undefined;
  onSaved: (next: ProjectFile) => void;
  onError: (message: string) => void;
}) {
  const [raw, setRaw] = useState(false);
  const [draft, setDraft] = useState<string>();
  const [saving, setSaving] = useState(false);
  // What you selected inside the file, so you can ask about just that.
  const [selection, setSelection] = useState<{
    text: string;
    from: number;
    to: number;
  }>();

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

  const save = async () => {
    if (draft === undefined) return;
    setSaving(true);
    try {
      onSaved(
        await writeProjectFile(projectId, file.path, draft, file.modifiedAt),
      );
      setDraft(undefined);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'It was not saved.');
    } finally {
      setSaving(false);
    }
  };

  if (draft !== undefined) {
    return (
      <div className="artifact-edit">
        <textarea
          className="artifact-editor"
          autoFocus
          value={draft}
          aria-label={`Contents of ${file.path}`}
          spellCheck={false}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setDraft(undefined);
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void save();
            }
          }}
        />
        <div className="doc-editor-actions">
          <span className="doc-hint">⌘⏎ saves · Esc cancels</span>
          <button
            type="button"
            className="secondary-action small"
            onClick={() => setDraft(undefined)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="primary-action small"
            disabled={saving}
            onClick={() => void save()}
          >
            Save
          </button>
        </div>
      </div>
    );
  }

  // The lines a text selection covers, found in the file's own content.
  const noteSelection = () => {
    const text = window.getSelection()?.toString() ?? '';
    const trimmed = text.trim();
    if (trimmed.length < 2) {
      setSelection(undefined);
      return;
    }
    const at = file.content.indexOf(trimmed);
    const from = at < 0 ? 1 : file.content.slice(0, at).split('\n').length;
    const to = from + trimmed.split('\n').length - 1;
    setSelection({ text: trimmed.slice(0, 4_000), from, to });
  };

  const actions = (
    <div className="artifact-body-actions">
      {file.kind === 'markdown' || file.kind === 'html' ? (
        <button
          type="button"
          className="quiet-button"
          onClick={() => setRaw((value) => !value)}
        >
          {raw ? 'Rendered' : 'Source'}
        </button>
      ) : null}
      <button
        type="button"
        className="quiet-button"
        onClick={() => setDraft(file.content)}
        disabled={file.truncated}
        title={
          file.truncated ? 'Too large to edit here' : 'Edit this file yourself'
        }
      >
        Edit
      </button>
      {onAsk && selection ? (
        <button
          type="button"
          className="primary-action small"
          onClick={() => {
            onAsk({
              kind: 'file',
              label: `${file.path}:${selection.from}${
                selection.to > selection.from ? `-${selection.to}` : ''
              }`,
              detail: selection.text,
              path: file.path,
              from: selection.from,
              to: selection.to,
            });
            setSelection(undefined);
          }}
        >
          Ask about selection
        </button>
      ) : null}
    </div>
  );

  const body =
    file.kind === 'markdown' && !raw ? (
      <div className="artifact-markdown msg-body">
        <Markdown text={file.content} />
      </div>
    ) : file.kind === 'html' && !raw ? (
      <iframe
        className="artifact-frame"
        title={file.path}
        sandbox=""
        srcDoc={file.content}
      />
    ) : (
      <pre className="artifact-code">
        <code>{file.content}</code>
      </pre>
    );

  return (
    <>
      {actions}
      <div onMouseUp={noteSelection} onKeyUp={noteSelection}>
        {body}
      </div>
    </>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
