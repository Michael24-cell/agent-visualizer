#!/usr/bin/env node
// Starts the Harness MCP server: the built copy when there is one,
// otherwise straight from source.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const built = join(root, 'dist', 'index.js');
if (existsSync(built)) {
  await import(pathToFileURL(built).href);
} else {
  const { register } = await import('tsx/esm/api');
  register();
  await import(pathToFileURL(join(root, 'src', 'index.ts')).href);
}
