import { mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import type { FolderListing, RepositoryRef } from '@harness/contracts';

// Local folders a project may be attached to. Read-only, with one
// exception: making a new, empty folder for a project to start in.
//
// Attachable folders live under the allowed root (the user's home directory
// unless HARNESS_FOLDER_ROOT says otherwise). Hidden folders are skipped in
// listings; node_modules and the like are shown but never recommended.

export class FolderError extends Error {
  constructor(
    readonly code: 'folder_not_found' | 'folder_not_allowed' | 'folder_exists',
    message: string,
  ) {
    super(message);
    this.name = 'FolderError';
  }
}

export interface FolderOptions {
  readonly root?: string;
}

function allowedRoot(options: FolderOptions): string {
  return resolve(options.root ?? homedir());
}

function within(root: string, candidate: string): boolean {
  const relative = candidate.startsWith(root + sep) || candidate === root;
  return relative;
}

// The current branch from .git/HEAD without shelling out to git.
export function readBranch(folder: string): string | undefined {
  try {
    const head = readFileSync(join(folder, '.git', 'HEAD'), 'utf8').trim();
    const match = /^ref: refs\/heads\/(.+)$/.exec(head);
    return match?.[1] ?? head.slice(0, 12);
  } catch {
    return undefined;
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function inspectFolder(
  input: string,
  options: FolderOptions = {},
  now = new Date().toISOString(),
): RepositoryRef {
  if (!isAbsolute(input)) {
    throw new FolderError(
      'folder_not_found',
      'Give the full path to the folder (starting with /).',
    );
  }
  const path = resolve(input);
  const root = allowedRoot(options);
  if (!within(root, path)) {
    throw new FolderError(
      'folder_not_allowed',
      `Folders outside ${root} cannot be attached.`,
    );
  }
  if (!isDirectory(path)) {
    throw new FolderError('folder_not_found', `${path} is not a folder.`);
  }
  const branch = readBranch(path);
  return {
    path,
    name: basename(path) || path,
    ...(branch ? { branch } : {}),
    attachedAt: now,
  };
}

export function listFolders(
  input: string | undefined,
  options: FolderOptions = {},
): FolderListing {
  const root = allowedRoot(options);
  const path = input ? resolve(input) : root;
  if (!within(root, path)) {
    throw new FolderError(
      'folder_not_allowed',
      `Only folders under ${root} can be browsed.`,
    );
  }
  if (!isDirectory(path)) {
    throw new FolderError('folder_not_found', `${path} is not a folder.`);
  }
  const entries = readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => {
      const full = join(path, entry.name);
      return {
        name: entry.name,
        path: full,
        isRepository: isDirectory(join(full, '.git')),
      };
    })
    .sort((a, b) =>
      a.isRepository === b.isRepository
        ? a.name.localeCompare(b.name)
        : a.isRepository
          ? -1
          : 1,
    );
  const parent = path === root ? undefined : dirname(path);
  return { path, ...(parent ? { parent } : {}), entries };
}

// Makes one new, empty folder inside `parent`. The parent must already be
// under the allowed root, the name is a single path segment, and an
// existing folder is never reused or overwritten.
export function createFolder(
  parent: string,
  name: string,
  options: FolderOptions = {},
): string {
  const root = allowedRoot(options);
  const base = resolve(parent);
  const clean = name.trim();
  if (!clean || /[/\\\0]/.test(clean) || clean === '.' || clean === '..') {
    throw new FolderError(
      'folder_not_allowed',
      'A folder name is one name, without slashes.',
    );
  }
  if (!within(root, base)) {
    throw new FolderError(
      'folder_not_allowed',
      `New folders can only be made under ${root}.`,
    );
  }
  if (!isDirectory(base)) {
    throw new FolderError('folder_not_found', `${base} is not a folder.`);
  }
  const path = join(base, clean);
  if (!within(root, path) || dirname(path) !== base) {
    throw new FolderError('folder_not_allowed', 'That name is not allowed.');
  }
  try {
    mkdirSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new FolderError('folder_exists', `${clean} already exists here.`);
    }
    throw error;
  }
  return path;
}
