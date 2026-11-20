import { randomUUID } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { basename, join, sep } from 'node:path';
import { harnessDataDirectory } from '@harness/config';
import {
  CommandResponseSchema,
  MessagesPageSchema,
  ProjectListResponseSchema,
  ProjectResponseSchema,
  type ProjectListResponse,
  type ProjectResponse,
} from '@harness/contracts';

// Talks to the Harness service running on this computer. The service
// writes its address and session token to connection.json in its data
// folder when it starts; this reads it on every call, so restarting the
// app (new port or token) needs nothing here.

export class HarnessError extends Error {}

export interface Connection {
  readonly url: string;
  readonly token: string;
}

const NOT_RUNNING =
  "Harness isn't running. Start it with `npm start` in the Harness folder, then try again.";

export function readConnection(
  source: NodeJS.ProcessEnv = process.env,
): Connection {
  if (source.HARNESS_URL && source.HARNESS_SESSION_TOKEN) {
    return { url: source.HARNESS_URL, token: source.HARNESS_SESSION_TOKEN };
  }
  const path = join(harnessDataDirectory(source), 'connection.json');
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new HarnessError(NOT_RUNNING);
  }
  const { url, token } = (raw ?? {}) as { url?: unknown; token?: unknown };
  if (typeof url !== 'string' || typeof token !== 'string') {
    throw new HarnessError(NOT_RUNNING);
  }
  // Only ever this computer: the token must not go anywhere else.
  const host = new URL(url).hostname;
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) {
    throw new HarnessError(
      `connection.json points at ${host}, not this computer.`,
    );
  }
  return { url, token };
}

function real(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

const within = (folder: string, root: string) =>
  folder === root || folder.startsWith(root.endsWith(sep) ? root : root + sep);

export class Harness {
  constructor(
    private readonly connect: () => Connection = () => readConnection(),
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async call(
    method: 'GET' | 'POST',
    path: string,
    body?: object,
  ): Promise<unknown> {
    const connection = this.connect();
    let response: Response;
    try {
      response = await this.fetchImpl(`${connection.url}${path}`, {
        method,
        headers: {
          'x-harness-session': connection.token,
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new HarnessError(NOT_RUNNING);
    }
    const text = await response.text();
    const json: unknown = text ? JSON.parse(text) : undefined;
    if (!response.ok) {
      const said = (json as { error?: unknown } | undefined)?.error;
      throw new HarnessError(
        response.status === 401
          ? 'Harness restarted since this session began and refused the old session. Try again.'
          : typeof said === 'string'
            ? said
            : `Harness answered ${response.status}.`,
      );
    }
    return json;
  }

  async listProjects(): Promise<ProjectListResponse> {
    return ProjectListResponseSchema.parse(
      await this.call('GET', '/api/projects'),
    );
  }

  async getProject(projectId: string): Promise<ProjectResponse> {
    return ProjectResponseSchema.parse(
      await this.call('GET', `/api/projects/${encodeURIComponent(projectId)}`),
    );
  }

  // The project whose folder holds `folder`: the closest one when
  // projects are nested. Archived projects are left out.
  async projectFor(folder: string): Promise<ProjectResponse | undefined> {
    const target = real(folder);
    const { projects } = await this.listProjects();
    const match = projects
      .filter((item) => !item.project.archivedAt && item.project.repository)
      .map((item) => ({
        id: item.project.id,
        root: real(item.project.repository!.path),
      }))
      .filter((item) => within(target, item.root))
      .sort((a, b) => b.root.length - a.root.length)[0];
    return match ? this.getProject(match.id) : undefined;
  }

  async createProject(folder: string): Promise<ProjectResponse> {
    const response = CommandResponseSchema.parse(
      await this.call('POST', '/api/projects', {
        commandId: randomUUID(),
        name: basename(folder) || folder,
        repositoryPath: folder,
      }),
    );
    return response.project;
  }

  // Says something to the Planner and waits for its answer.
  async askPlanner(
    project: ProjectResponse,
    body: string,
    timeoutMs = 120_000,
  ): Promise<{ reply: string; project: ProjectResponse }> {
    const projectId = project.projection.projectId;
    const planner = Object.values(project.projection.threads).find(
      (thread) => thread.kind === 'coordinator',
    );
    if (!planner) throw new HarnessError('This project has no Planner.');
    const sent = CommandResponseSchema.parse(
      await this.call(
        'POST',
        `/api/projects/${encodeURIComponent(projectId)}/threads/${encodeURIComponent(planner.id)}/messages`,
        {
          commandId: randomUUID(),
          expectedSequence: planner.lastSequence,
          body,
          intent: 'chat',
        },
      ),
    );
    const after = sent.receipt.firstSequence;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const page = MessagesPageSchema.parse(
        await this.call(
          'GET',
          `/api/projects/${encodeURIComponent(projectId)}/threads/${encodeURIComponent(planner.id)}/messages?after=${after}&limit=20`,
        ),
      );
      const reply = page.messages.find(
        (message) => message.author.role !== 'user' && message.sequence > after,
      );
      if (reply) {
        return { reply: reply.body, project: await this.getProject(projectId) };
      }
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
    throw new HarnessError(
      `The Planner had not answered after ${Math.round(timeoutMs / 1000)}s. Its answer will still show up in Harness; call get_plan later.`,
    );
  }

  async takeTask(projectId: string, client: string): Promise<TakeResult> {
    return (await this.call(
      'POST',
      `/api/projects/${encodeURIComponent(projectId)}/outside/take`,
      { commandId: randomUUID(), client },
    )) as TakeResult;
  }

  async reportTask(
    projectId: string,
    taskId: string,
    report: {
      client: string;
      outcome: 'done' | 'failed';
      summary: string;
      checks?: readonly {
        name: string;
        command: string;
        passed: boolean;
        output?: string | undefined;
      }[];
      filesChanged?: readonly string[] | undefined;
    },
  ): Promise<ReportResult> {
    return (await this.call(
      'POST',
      `/api/projects/${encodeURIComponent(projectId)}/outside/tasks/${encodeURIComponent(taskId)}/report`,
      { commandId: randomUUID(), ...report },
    )) as ReportResult;
  }
}

export interface TakeResult {
  readonly status:
    'taken' | 'continuing' | 'waiting' | 'no_plan' | 'assigned_in_app';
  readonly message: string;
  readonly task?: { readonly id: string; readonly title: string };
  readonly brief?: string;
}

export interface ReportResult {
  readonly state: string;
  readonly message: string;
}
