import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Where an element picked in a preview might come from. A selector names
// ids, classes and tags; the files that mention them are the places an
// agent should look first. This is a hint, not an answer: the agent still
// reads the files.

const SEARCHABLE = new Set([
  '.html',
  '.htm',
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.vue',
  '.svelte',
  '.astro',
  '.md',
  '.mdx',
  '.php',
  '.erb',
]);
const SKIP_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.turbo',
  'vendor',
]);
const MAX_FILES = 600;
const MAX_FILE_BYTES = 400_000;

export interface SelectorHit {
  readonly path: string;
  readonly line: number;
  readonly token: string;
  readonly text: string;
}

// The searchable parts of a selector, most specific first: #ids, then
// .classes, and tags only when there is nothing else to go on.
export function selectorTokens(selector: string): string[] {
  const ids = [...selector.matchAll(/#([A-Za-z_][\w-]*)/g)].map(
    (m) => `#${m[1]}`,
  );
  const classes = [...selector.matchAll(/\.([A-Za-z_][\w-]*)/g)].map(
    (m) => `.${m[1]}`,
  );
  if (ids.length || classes.length) {
    return [...new Set([...ids, ...classes])].slice(0, 6);
  }
  const tags = selector
    .split(/[>\s+~]+/)
    .map((part) => part.replace(/:nth-of-type\(\d+\)/g, '').trim())
    .filter((part) => /^[a-z][a-z0-9-]*$/.test(part));
  // A bare tag is only worth searching when it is not everywhere.
  const rare = tags.filter(
    (tag) =>
      !['div', 'span', 'p', 'a', 'li', 'ul', 'body', 'html'].includes(tag),
  );
  return [...new Set(rare)].slice(0, 3);
}

function* walk(
  root: string,
  directory: string,
  budget: { left: number },
): Generator<string> {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (budget.left <= 0) return;
    if (entry.name.startsWith('.') || SKIP_DIRECTORIES.has(entry.name))
      continue;
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      yield* walk(root, full, budget);
    } else if (entry.isFile()) {
      const dot = entry.name.lastIndexOf('.');
      if (dot < 0 || !SEARCHABLE.has(entry.name.slice(dot).toLowerCase()))
        continue;
      budget.left -= 1;
      yield relative(root, full);
    }
  }
}

// Files that mention the selector's ids or classes, with the line.
export function findSelectorSources(
  root: string,
  selector: string,
  limit = 8,
): SelectorHit[] {
  const tokens = selectorTokens(selector);
  if (tokens.length === 0) return [];
  const hits: SelectorHit[] = [];
  const budget = { left: MAX_FILES };
  for (const path of walk(root, root, budget)) {
    let content: string;
    try {
      if (statSync(join(root, path)).size > MAX_FILE_BYTES) continue;
      content = readFileSync(join(root, path), 'utf8');
    } catch {
      continue;
    }
    for (const token of tokens) {
      // A class or id, as written in CSS or in a class/id attribute.
      const bare = token.slice(1);
      const pattern = new RegExp(
        `${token.startsWith('#') ? '#' : '\\.'}${bare}\\b|\\b(?:class|className|id)\\s*=\\s*["'\`][^"'\`]*\\b${bare}\\b`,
      );
      const lines = content.split('\n');
      for (const [index, line] of lines.entries()) {
        if (!pattern.test(line)) continue;
        hits.push({
          path,
          line: index + 1,
          token,
          text: line.trim().slice(0, 160),
        });
        break;
      }
      if (hits.length >= limit) return hits.slice(0, limit);
    }
  }
  return hits.slice(0, limit);
}

// The hint appended to an element context, or nothing when the folder
// says nothing about it.
export function describeSelectorSources(hits: readonly SelectorHit[]): string {
  if (hits.length === 0) return '';
  return `Where ${[...new Set(hits.map((hit) => hit.token))].join(', ')} appear:\n${hits
    .map((hit) => `- ${hit.path}:${hit.line} — ${hit.text}`)
    .join('\n')}`;
}
