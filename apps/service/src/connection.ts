import { chmodSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// How a local program on this computer — the MCP server that Claude Code
// or Codex start — reaches the running service: its address and session
// token, in a file only this user can read. Written when the service
// starts listening, removed when it stops.

export const CONNECTION_FILE = 'connection.json';

export function writeConnection(
  dataDirectory: string,
  details: { readonly url: string; readonly token: string },
): string {
  const path = join(dataDirectory, CONNECTION_FILE);
  writeFileSync(
    path,
    `${JSON.stringify(
      { ...details, pid: process.pid, startedAt: new Date().toISOString() },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  // mode only applies to a new file; an old one keeps its own.
  chmodSync(path, 0o600);
  return path;
}

export function removeConnection(dataDirectory: string): void {
  rmSync(join(dataDirectory, CONNECTION_FILE), { force: true });
}
