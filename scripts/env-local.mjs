// Loads .env.local from the repository root into process.env, without
// overriding variables already set in the shell. The file is git-ignored;
// it is where API keys and runtime selection live so `npm run dev` needs
// no flags. Format: KEY=value per line, # comments, optional quotes.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function loadEnvLocal(
  root = join(dirname(fileURLToPath(import.meta.url)), '..'),
) {
  const path = join(root, '.env.local');
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return [];
  }
  const loaded = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(
      line,
    );
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
      loaded.push(key);
    }
  }
  return loaded;
}
