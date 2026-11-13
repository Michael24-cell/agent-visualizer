import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';

// The built client, served by the service itself so `npm start` is the
// whole app: one process, one address, no dev proxy. The page gets its
// session as an HttpOnly cookie when it loads, so no token ever appears
// in a URL or in client code.

export const SESSION_COOKIE = 'harness_session';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

export interface StaticFile {
  readonly body: Buffer;
  readonly type: string;
  // The page itself: carries the session cookie and is never cached.
  readonly isPage: boolean;
}

export function clientAvailable(directory: string | undefined): boolean {
  return Boolean(directory && existsSync(join(directory, 'index.html')));
}

// The file for a request path, or the page for anything that is not a
// file (so a reload on any screen still opens the app). Never leaves the
// client directory.
export function readClientFile(
  directory: string,
  urlPath: string,
): StaticFile | undefined {
  const root = resolve(directory);
  let relative: string;
  try {
    relative = decodeURIComponent(urlPath.split('?')[0] ?? '/');
  } catch {
    return undefined;
  }
  const target = resolve(
    root,
    `.${relative.startsWith('/') ? '' : '/'}${relative}`,
  );
  const inside = target === root || target.startsWith(`${root}${sep}`);
  if (inside && target !== root) {
    try {
      if (statSync(target).isFile()) {
        return {
          body: readFileSync(target),
          type: TYPES[extname(target)] ?? 'application/octet-stream',
          isPage: false,
        };
      }
    } catch {
      // Not a file: fall through to the page.
    }
  }
  // A missing asset is a 404, not the page dressed up as a script.
  if (extname(relative) && extname(relative) !== '.html') return undefined;
  try {
    return {
      body: readFileSync(join(root, 'index.html')),
      type: TYPES['.html']!,
      isPage: true,
    };
  } catch {
    return undefined;
  }
}

export function sessionCookie(token: string): string {
  // Strict + HttpOnly: other sites cannot send it or read it, and page
  // scripts never see it. Scoped to the API, the only place it is needed.
  return `${SESSION_COOKIE}=${token}; Path=/api; HttpOnly; SameSite=Strict`;
}

export function cookieValue(
  header: string | undefined,
  name: string,
): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return undefined;
}
