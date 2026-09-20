import { useEffect, useState } from 'react';
import type { FolderListing } from '@harness/contracts';
import { listFolders } from './api';

// Browse folders under the allowed root (your home directory) and pick one.
// Repositories sort first and show their .git mark. You can also paste a path.

export function FolderPicker({
  initialPath,
  onPick,
  onCancel,
}: {
  initialPath?: string | undefined;
  onPick: (path: string) => void;
  onCancel: () => void;
}) {
  const [listing, setListing] = useState<FolderListing>();
  const [error, setError] = useState<string>();
  const [typed, setTyped] = useState('');

  const load = (path?: string) => {
    setError(undefined);
    void listFolders(path)
      .then(setListing)
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error ? cause.message : 'Could not list folders.',
        ),
      );
  };

  useEffect(() => {
    let active = true;
    void listFolders(initialPath)
      .then((result) => {
        if (active) setListing(result);
      })
      .catch((cause: unknown) => {
        if (active)
          setError(
            cause instanceof Error ? cause.message : 'Could not list folders.',
          );
      });
    return () => {
      active = false;
    };
  }, [initialPath]);

  return (
    <div className="folder-picker" role="dialog" aria-label="Choose a folder">
      <div className="folder-path">
        {listing?.parent ? (
          <button
            type="button"
            className="quiet-button"
            onClick={() => load(listing.parent)}
            aria-label="Up one folder"
          >
            ↑
          </button>
        ) : null}
        <code title={listing?.path}>{listing?.path ?? '…'}</code>
      </div>
      {error ? <p className="composer-feedback">{error}</p> : null}
      <ul className="folder-list">
        {listing?.entries.map((entry) => (
          <li key={entry.path}>
            <button type="button" onClick={() => load(entry.path)}>
              <span
                className={`folder-mark ${entry.isRepository ? 'is-repo' : ''}`}
                aria-hidden="true"
              >
                {entry.isRepository ? '⎇' : '▸'}
              </span>
              {entry.name}
            </button>
            <button
              type="button"
              className="secondary-action small"
              onClick={() => onPick(entry.path)}
            >
              Use
            </button>
          </li>
        ))}
        {listing && listing.entries.length === 0 ? (
          <li className="folder-empty">No folders inside.</li>
        ) : null}
      </ul>
      <form
        className="folder-typed"
        onSubmit={(event) => {
          event.preventDefault();
          if (typed.trim()) onPick(typed.trim());
        }}
      >
        <input
          value={typed}
          placeholder="…or paste a full path"
          aria-label="Folder path"
          onChange={(event) => setTyped(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              if (typed.trim()) onPick(typed.trim());
            }
          }}
        />
        <button
          type="submit"
          className="secondary-action small"
          disabled={!typed.trim()}
        >
          Use path
        </button>
      </form>
      <div className="ask-actions">
        {listing ? (
          <button
            type="button"
            className="primary-action small"
            onClick={() => onPick(listing.path)}
          >
            Use this folder
          </button>
        ) : null}
        <button type="button" className="quiet-button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
