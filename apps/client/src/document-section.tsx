import { useState, type KeyboardEvent } from 'react';

// One section of a project document (Plan or Method): a heading, a few
// lines, and an in-place editor. Edits are one line per row; the same
// section can also be changed by telling the coordinator.

export function DocumentSection({
  id,
  title,
  hint,
  lines,
  meta,
  example,
  busy,
  onSave,
}: {
  id: string;
  title: string;
  hint: string;
  lines: readonly string[];
  // Who last wrote it, e.g. "you · just now" or "from catalog".
  meta: string;
  // The phrase that edits this section through the coordinator.
  example: string;
  busy: boolean;
  onSave: (lines: string[]) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const start = () => {
    setDraft(lines.join('\n'));
    setEditing(true);
  };
  const save = async () => {
    setSaving(true);
    try {
      await onSave(
        draft
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean),
      );
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };
  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') setEditing(false);
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void save();
    }
  };

  return (
    <section className={`doc-section ${editing ? 'is-editing' : ''}`}>
      <header className="doc-section-head">
        <h3 id={`doc-${id}`}>{title}</h3>
        <span className="doc-meta">{meta}</span>
        {!editing ? (
          <button
            type="button"
            className="doc-edit"
            disabled={busy}
            aria-label={`Edit ${title}`}
            onClick={start}
          >
            Edit
          </button>
        ) : null}
      </header>
      {editing ? (
        <form
          className="doc-editor"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <textarea
            autoFocus
            rows={Math.max(3, Math.min(12, lines.length + 2))}
            value={draft}
            aria-labelledby={`doc-${id}`}
            placeholder={hint}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKey}
          />
          <div className="doc-editor-actions">
            <span className="doc-hint">One line per item · ⌘⏎ saves</span>
            <button
              type="button"
              className="secondary-action small"
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="primary-action small"
              disabled={saving || busy}
            >
              Save
            </button>
          </div>
        </form>
      ) : lines.length ? (
        <ul className="doc-lines">
          {lines.map((line, index) => (
            <li key={`${index}-${line}`}>{line}</li>
          ))}
        </ul>
      ) : (
        <button type="button" className="doc-empty" onClick={start}>
          <span>{hint}</span>
          <span className="doc-hint">
            Write it here, or tell the coordinator “{example}”.
          </span>
        </button>
      )}
    </section>
  );
}
