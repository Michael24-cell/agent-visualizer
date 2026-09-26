import { useState, type KeyboardEvent, type ReactNode } from 'react';

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
  onAsk,
  onMove,
  moveTargets = [],
  footer,
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
  // Point your next message at one line.
  onAsk?: ((line: string, index: number) => void) | undefined;
  // Move one line to another section of the same document.
  onMove?: ((line: string, index: number, target: string) => void) | undefined;
  moveTargets?: readonly { id: string; title: string }[];
  // Shown under the lines: e.g. which tasks implement this section.
  footer?: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [editingLine, setEditingLine] = useState<number>();
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  // One line at a time: edit it in place, or move it within the section.
  const saveLine = (index: number, next: string) => {
    setEditingLine(undefined);
    const trimmed = next.trim();
    if (trimmed === lines[index]) return;
    const updated = trimmed
      ? lines.map((line, at) => (at === index ? trimmed : line))
      : lines.filter((_, at) => at !== index);
    void onSave(updated);
  };
  const swap = (from: number, to: number) => {
    if (to < 0 || to >= lines.length) return;
    const updated = [...lines];
    const [moved] = updated.splice(from, 1);
    updated.splice(to, 0, moved!);
    return onSave(updated);
  };

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
            <li key={`${index}-${line}`} className="doc-line">
              {editingLine === index ? (
                <input
                  className="doc-line-input"
                  autoFocus
                  defaultValue={line}
                  aria-label={`${title} line ${index + 1}`}
                  onBlur={(event) => saveLine(index, event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      saveLine(index, event.currentTarget.value);
                    }
                    if (event.key === 'Escape') setEditingLine(undefined);
                  }}
                />
              ) : (
                <>
                  <span className="doc-line-text">{line}</span>
                  <span className="doc-line-actions">
                    {onAsk ? (
                      <button
                        type="button"
                        title="Point your next message at this line"
                        onClick={() => onAsk(line, index)}
                      >
                        Ask
                      </button>
                    ) : null}
                    <button
                      type="button"
                      title="Edit this line"
                      aria-label={`Edit ${title} line ${index + 1}`}
                      onClick={() => setEditingLine(index)}
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      title="Move up"
                      aria-label={`Move ${title} line ${index + 1} up`}
                      disabled={index === 0 || busy}
                      onClick={() => void swap(index, index - 1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      title="Move down"
                      aria-label={`Move ${title} line ${index + 1} down`}
                      disabled={index === lines.length - 1 || busy}
                      onClick={() => void swap(index, index + 1)}
                    >
                      ↓
                    </button>
                    {onMove && moveTargets.length ? (
                      <select
                        aria-label={`Move ${title} line ${index + 1} to another section`}
                        title="Move to another section"
                        value=""
                        disabled={busy}
                        onChange={(event) => {
                          if (event.target.value)
                            onMove(line, index, event.target.value);
                        }}
                      >
                        <option value="">Move…</option>
                        {moveTargets.map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {entry.title}
                          </option>
                        ))}
                      </select>
                    ) : null}
                    <button
                      type="button"
                      title="Remove this line"
                      aria-label={`Remove ${title} line ${index + 1}`}
                      disabled={busy}
                      onClick={() =>
                        void onSave(lines.filter((_, at) => at !== index))
                      }
                    >
                      ×
                    </button>
                  </span>
                </>
              )}
            </li>
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
      {footer}
    </section>
  );
}
