import {
  CommandResponseSchema,
  FolderListingSchema,
  MessagesPageSchema,
  MethodDefinitionSchema,
  ProjectEventsPageSchema,
  ProjectListResponseSchema,
  ProjectResponseSchema,
  type AgentModel,
  type BriefFieldId,
  type MessageContext,
  type PlanSectionId,
  type ProjectFile,
  ProjectFileSchema,
  type RuntimeSettings,
  type RuntimeUpdate,
  type TrustPolicy,
  RuntimeSettingsSchema,
  type CommandResponse,
  type FolderListing,
  type MessagesPage,
  type MethodDefinition,
  type MethodSectionId,
  type ProjectEventsPage,
  type ProjectListResponse,
  type ProjectResponse,
} from '@harness/contracts';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request(input: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, {
    ...init,
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as
      { error?: string; code?: string } | undefined;
    throw new ApiError(
      response.status,
      body?.error ?? `The local service returned ${response.status}.`,
      body?.code,
    );
  }
  return response;
}

// --- Projects, threads, agents (Increment 2.6) ------------------------------

export async function listProjects(): Promise<ProjectListResponse> {
  return ProjectListResponseSchema.parse(
    await (await request('/api/projects')).json(),
  );
}

export async function readProject(projectId: string): Promise<ProjectResponse> {
  return ProjectResponseSchema.parse(
    await (await request(`/api/projects/${projectId}`)).json(),
  );
}

export async function createProject(
  name: string,
  repositoryPath?: string,
): Promise<CommandResponse> {
  return CommandResponseSchema.parse(
    await (
      await request('/api/projects', {
        method: 'POST',
        body: JSON.stringify({
          commandId: crypto.randomUUID(),
          name,
          ...(repositoryPath ? { repositoryPath } : {}),
        }),
      })
    ).json(),
  );
}

export async function listFolders(path?: string): Promise<FolderListing> {
  const suffix = path ? `?path=${encodeURIComponent(path)}` : '';
  return FolderListingSchema.parse(
    await (await request(`/api/folders${suffix}`)).json(),
  );
}

export async function attachRepository(
  projectId: string,
  expectedSequence: number,
  path: string,
): Promise<CommandResponse> {
  return CommandResponseSchema.parse(
    await (
      await request(`/api/projects/${projectId}/repository`, {
        method: 'POST',
        body: JSON.stringify({
          commandId: crypto.randomUUID(),
          expectedSequence,
          path,
        }),
      })
    ).json(),
  );
}

export async function readMessages(
  projectId: string,
  threadRef: string,
  query: { before?: number; after?: number; limit?: number } = {},
): Promise<MessagesPage> {
  const search = new URLSearchParams();
  if (query.before !== undefined) search.set('before', String(query.before));
  if (query.after !== undefined) search.set('after', String(query.after));
  if (query.limit !== undefined) search.set('limit', String(query.limit));
  const suffix = search.size ? `?${search.toString()}` : '';
  return MessagesPageSchema.parse(
    await (
      await request(
        `/api/projects/${projectId}/threads/${threadRef}/messages${suffix}`,
      )
    ).json(),
  );
}

export async function postMessage(
  projectId: string,
  threadRef: string,
  input: {
    expectedSequence: number;
    body: string;
    intent: 'chat' | 'start_work';
    context?: readonly MessageContext[];
    commandId?: string;
  },
): Promise<CommandResponse> {
  return CommandResponseSchema.parse(
    await (
      await request(
        `/api/projects/${projectId}/threads/${threadRef}/messages`,
        {
          method: 'POST',
          body: JSON.stringify({
            commandId: input.commandId ?? crypto.randomUUID(),
            expectedSequence: input.expectedSequence,
            body: input.body,
            intent: input.intent,
            ...(input.context?.length ? { context: input.context } : {}),
          }),
        },
      )
    ).json(),
  );
}

export async function stopAgent(
  projectId: string,
  agentId: string,
  expectedSequence: number,
): Promise<CommandResponse> {
  return CommandResponseSchema.parse(
    await (
      await request(`/api/projects/${projectId}/agents/${agentId}/stop`, {
        method: 'POST',
        body: JSON.stringify({
          commandId: crypto.randomUUID(),
          expectedSequence,
        }),
      })
    ).json(),
  );
}

export async function createAgent(
  projectId: string,
  expectedSequence: number,
  name: string,
  category: 'interface' | 'orchestration' | 'verification' | 'neutral',
): Promise<CommandResponse> {
  return CommandResponseSchema.parse(
    await (
      await request(`/api/projects/${projectId}/agents`, {
        method: 'POST',
        body: JSON.stringify({
          commandId: crypto.randomUUID(),
          expectedSequence,
          name,
          category,
        }),
      })
    ).json(),
  );
}

export async function setTrust(
  projectId: string,
  expectedSequence: number,
  trust: TrustPolicy,
): Promise<CommandResponse> {
  return CommandResponseSchema.parse(
    await (
      await request(`/api/projects/${projectId}/trust`, {
        method: 'POST',
        body: JSON.stringify({
          commandId: crypto.randomUUID(),
          expectedSequence,
          trust,
        }),
      })
    ).json(),
  );
}

export async function renameAgent(
  projectId: string,
  agentId: string,
  expectedSequence: number,
  name: string,
): Promise<CommandResponse> {
  return CommandResponseSchema.parse(
    await (
      await request(`/api/projects/${projectId}/agents/${agentId}/name`, {
        method: 'POST',
        body: JSON.stringify({
          commandId: crypto.randomUUID(),
          expectedSequence,
          name,
        }),
      })
    ).json(),
  );
}

export async function setAgentModel(
  projectId: string,
  agentId: string,
  expectedSequence: number,
  choice: { model?: AgentModel; endpointModel?: string },
): Promise<CommandResponse> {
  return CommandResponseSchema.parse(
    await (
      await request(`/api/projects/${projectId}/agents/${agentId}/model`, {
        method: 'POST',
        body: JSON.stringify({
          commandId: crypto.randomUUID(),
          expectedSequence,
          ...choice,
        }),
      })
    ).json(),
  );
}

export async function advanceAgent(
  projectId: string,
  agentId: string,
  expectedSequence: number,
): Promise<CommandResponse> {
  return CommandResponseSchema.parse(
    await (
      await request(`/api/projects/${projectId}/agents/${agentId}/advance`, {
        method: 'POST',
        body: JSON.stringify({
          commandId: crypto.randomUUID(),
          expectedSequence,
        }),
      })
    ).json(),
  );
}

export async function decideAsk(
  projectId: string,
  agentId: string,
  askId: string,
  expectedSequence: number,
  decision: 'approved' | 'denied',
  trust: 'once' | 'task' = 'once',
): Promise<CommandResponse> {
  return CommandResponseSchema.parse(
    await (
      await request(
        `/api/projects/${projectId}/agents/${agentId}/asks/${askId}`,
        {
          method: 'POST',
          body: JSON.stringify({
            commandId: crypto.randomUUID(),
            expectedSequence,
            decision,
            trust,
          }),
        },
      )
    ).json(),
  );
}

export async function decideProposal(
  projectId: string,
  proposalId: string,
  expectedSequence: number,
  decision: 'approved' | 'denied' | 'dismissed',
): Promise<CommandResponse> {
  return CommandResponseSchema.parse(
    await (
      await request(`/api/projects/${projectId}/proposals/${proposalId}`, {
        method: 'POST',
        body: JSON.stringify({
          commandId: crypto.randomUUID(),
          expectedSequence,
          decision,
        }),
      })
    ).json(),
  );
}

export async function listMethods(): Promise<MethodDefinition[]> {
  const body = (await (await request('/api/methods')).json()) as {
    methods?: unknown;
  };
  return MethodDefinitionSchema.array().parse(body.methods);
}

export async function applyMethod(
  projectId: string,
  expectedSequence: number,
  method: { catalogId: string; catalogVersion: string },
): Promise<CommandResponse> {
  return CommandResponseSchema.parse(
    await (
      await request(`/api/projects/${projectId}/method`, {
        method: 'POST',
        body: JSON.stringify({
          commandId: crypto.randomUUID(),
          expectedSequence,
          ...method,
        }),
      })
    ).json(),
  );
}

export async function overrideMethod(
  projectId: string,
  expectedSequence: number,
  sectionId: MethodSectionId,
  value: string[],
): Promise<CommandResponse> {
  return CommandResponseSchema.parse(
    await (
      await request(`/api/projects/${projectId}/method/overrides`, {
        method: 'POST',
        body: JSON.stringify({
          commandId: crypto.randomUUID(),
          expectedSequence,
          sectionId,
          value,
        }),
      })
    ).json(),
  );
}

export async function resetMethod(
  projectId: string,
  expectedSequence: number,
): Promise<CommandResponse> {
  return CommandResponseSchema.parse(
    await (
      await request(`/api/projects/${projectId}/method/reset`, {
        method: 'POST',
        body: JSON.stringify({
          commandId: crypto.randomUUID(),
          expectedSequence,
        }),
      })
    ).json(),
  );
}

export async function editPlanSection(
  projectId: string,
  expectedSequence: number,
  sectionId: PlanSectionId,
  lines: string[],
): Promise<CommandResponse> {
  return CommandResponseSchema.parse(
    await (
      await request(`/api/projects/${projectId}/plan/sections`, {
        method: 'POST',
        body: JSON.stringify({
          commandId: crypto.randomUUID(),
          expectedSequence,
          sectionId,
          lines,
        }),
      })
    ).json(),
  );
}

export async function updateBriefField(
  projectId: string,
  expectedSequence: number,
  fieldId: BriefFieldId,
  action: 'confirm' | 'correct' | 'skip',
  value?: string,
): Promise<CommandResponse> {
  return CommandResponseSchema.parse(
    await (
      await request(`/api/projects/${projectId}/brief/fields/${fieldId}`, {
        method: 'POST',
        body: JSON.stringify({
          commandId: crypto.randomUUID(),
          expectedSequence,
          action,
          ...(value ? { value } : {}),
        }),
      })
    ).json(),
  );
}

export async function readProjectFile(
  projectId: string,
  path: string,
): Promise<ProjectFile> {
  return ProjectFileSchema.parse(
    await (
      await request(
        `/api/projects/${projectId}/files?path=${encodeURIComponent(path)}`,
      )
    ).json(),
  );
}

export async function readRuntime(): Promise<RuntimeSettings> {
  return RuntimeSettingsSchema.parse(
    await (await request('/api/runtime')).json(),
  );
}

export async function updateRuntime(
  update: RuntimeUpdate,
): Promise<RuntimeSettings> {
  return RuntimeSettingsSchema.parse(
    await (
      await request('/api/runtime', {
        method: 'POST',
        body: JSON.stringify(update),
      })
    ).json(),
  );
}

export async function listRuntimeModels(): Promise<string[]> {
  const body = (await (await request('/api/runtime/models')).json()) as {
    models?: string[];
  };
  return body.models ?? [];
}

export async function writeProjectFile(
  projectId: string,
  path: string,
  content: string,
  expectedModifiedAt?: string,
): Promise<ProjectFile> {
  return ProjectFileSchema.parse(
    await (
      await request(`/api/projects/${projectId}/files`, {
        method: 'POST',
        body: JSON.stringify({
          path,
          content,
          ...(expectedModifiedAt ? { expectedModifiedAt } : {}),
        }),
      })
    ).json(),
  );
}

export function projectFileUrl(projectId: string, path: string): string {
  return `/api/projects/${projectId}/files/raw?path=${encodeURIComponent(path)}`;
}

export async function revealProjectFile(
  projectId: string,
  path: string,
  mode: 'reveal' | 'open' = 'reveal',
): Promise<void> {
  await request(`/api/projects/${projectId}/files/reveal`, {
    method: 'POST',
    body: JSON.stringify({ path, mode }),
  });
}

export async function readEvents(
  projectId: string,
  after = 0,
): Promise<ProjectEventsPage> {
  return ProjectEventsPageSchema.parse(
    await (
      await request(`/api/projects/${projectId}/events?after=${after}`)
    ).json(),
  );
}
