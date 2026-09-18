import {
  DemoRunSnapshotSchema,
  LaunchDemoRunResponseSchema,
  WorkspaceResponseSchema,
  type DemoRunSnapshot,
  type RunId,
  type WorkspaceResponse,
} from '@harness/contracts';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
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
      { error?: string } | undefined;
    throw new ApiError(
      response.status,
      body?.error ?? `The local service returned ${response.status}.`,
    );
  }
  return response;
}

export async function readWorkspace(): Promise<WorkspaceResponse> {
  return WorkspaceResponseSchema.parse(
    await (await request('/api/workspace')).json(),
  );
}

export async function launchDemoRun(planVersionId: string): Promise<RunId> {
  const response = await request('/api/demo-runs', {
    method: 'POST',
    body: JSON.stringify({ planVersionId }),
  });
  return LaunchDemoRunResponseSchema.parse(await response.json()).runId;
}

export async function readDemoRun(runId: RunId): Promise<DemoRunSnapshot> {
  return DemoRunSnapshotSchema.parse(
    await (await request(`/api/demo-runs/${runId}`)).json(),
  );
}

export async function advanceDemoRun(
  snapshot: DemoRunSnapshot,
): Promise<DemoRunSnapshot> {
  return DemoRunSnapshotSchema.parse(
    await (
      await request(`/api/demo-runs/${snapshot.projection.runId}/advance`, {
        method: 'POST',
        body: JSON.stringify({
          expectedSequence: snapshot.projection.lastSequence,
        }),
      })
    ).json(),
  );
}

export async function decideApproval(
  snapshot: DemoRunSnapshot,
  approvalId: string,
  decision: 'approved' | 'denied',
): Promise<DemoRunSnapshot> {
  return DemoRunSnapshotSchema.parse(
    await (
      await request(
        `/api/demo-runs/${snapshot.projection.runId}/approvals/${approvalId}`,
        {
          method: 'POST',
          body: JSON.stringify({
            expectedSequence: snapshot.projection.lastSequence,
            decision,
          }),
        },
      )
    ).json(),
  );
}

export async function cancelDemoRun(
  snapshot: DemoRunSnapshot,
): Promise<DemoRunSnapshot> {
  return DemoRunSnapshotSchema.parse(
    await (
      await request(`/api/demo-runs/${snapshot.projection.runId}/cancel`, {
        method: 'POST',
        body: JSON.stringify({
          expectedSequence: snapshot.projection.lastSequence,
        }),
      })
    ).json(),
  );
}
