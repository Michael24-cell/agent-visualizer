// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WorkspaceFixtureSchema,
  type DemoRunSnapshot,
  type WorkspaceResponse,
} from '@harness/contracts';
import { launchDemoRun, readDemoRun, readWorkspace } from './api';
import { App } from './App';

vi.mock('./api', () => ({
  ApiError: class ApiError extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message);
    }
  },
  advanceDemoRun: vi.fn(),
  cancelDemoRun: vi.fn(),
  decideApproval: vi.fn(),
  launchDemoRun: vi.fn(),
  readDemoRun: vi.fn(),
  readWorkspace: vi.fn(),
}));

const workspace = WorkspaceFixtureSchema.parse({
  project: {
    id: 'fixture',
    name: 'Fixture project',
    repository: 'local/fixture',
    branch: 'main',
    summary: 'A local operational fixture.',
    stack: ['React', 'TypeScript'],
    instructionFindings: [
      {
        title: 'Local boundary',
        detail: 'Keep commands local.',
        status: 'active',
      },
    ],
    validationCapabilities: ['Vitest'],
  },
  context: {
    methodology: {
      name: 'Evidence-led delivery',
      version: '1',
      provenance: 'Fixture',
      summary: 'Validate the handoff.',
    },
    rules: [],
    skills: [],
    validators: [],
  },
  plan: {
    id: 'planv_fixture',
    narrative: 'Define and consume one contract.',
    agentCountRationale: 'Two sequential owners make the handoff visible.',
    risks: ['Contract drift.'],
    validationSummary: 'Each task has a validator.',
    tasks: [
      {
        key: 'interface',
        title: 'Interface task',
        category: 'interface',
        purpose: 'Define the contract.',
        whySeparate: 'Review the contract first.',
        deliverable: 'Contract.',
        acceptanceCriteria: ['Keyboard flow works.'],
        fileScopes: ['client/**'],
        skills: ['Interface craft'],
        dependsOn: [],
        agentProfile: 'Interface systems',
      },
      {
        key: 'service',
        title: 'Service task',
        category: 'orchestration',
        purpose: 'Consume the contract.',
        whySeparate: 'Protect the service boundary.',
        deliverable: 'Endpoint.',
        acceptanceCriteria: ['Authentication remains active.'],
        fileScopes: ['service/**'],
        skills: ['Service contracts'],
        dependsOn: ['interface'],
        agentProfile: 'Backend orchestration',
      },
    ],
  },
  capabilities: [
    {
      id: 'agent-interface-systems',
      name: 'Interface systems',
      kind: 'agent',
      category: 'interface',
      availability: 'active',
      description: 'Owns the interface.',
      source: 'Fixture',
      trust: 'Approved',
      runtime: 'Simulated',
      relatedTo: [],
    },
  ],
});

function snapshot(
  phase: DemoRunSnapshot['phase'],
  runState = phase === 'completed' ? 'completed' : 'executing',
): DemoRunSnapshot {
  return {
    phase,
    availableCommands:
      phase === 'interface_active' ? ['advance', 'cancel'] : [],
    nextStepLabel:
      phase === 'completed'
        ? 'Review completion evidence'
        : 'Complete interface contract',
    events: [],
    projection: {
      runId: 'run_fixture',
      run: {
        id: 'run_fixture',
        planVersionId: 'planv_fixture',
        goal: 'Exercise the shell.',
        state: runState,
        createdAt: '2026-09-18T00:00:00.000Z',
      },
      tasks: {
        task_fixture_interface: {
          id: 'task_fixture_interface',
          runId: 'run_fixture',
          planVersionId: 'planv_fixture',
          title: 'Interface task',
          purpose: 'Define the contract.',
          whySeparate: 'Review the contract first.',
          deliverable: 'Contract.',
          acceptanceCriteria: ['Keyboard flow works.'],
          dependsOn: [],
          allowedFileScopes: ['client/**'],
          skillVersionIds: ['skill_interface_v1'],
          validationRequirements: ['contract-check'],
          state: phase === 'completed' ? 'completed' : 'running',
        },
        task_fixture_service: {
          id: 'task_fixture_service',
          runId: 'run_fixture',
          planVersionId: 'planv_fixture',
          title: 'Service task',
          purpose: 'Consume the contract.',
          whySeparate: 'Protect the boundary.',
          deliverable: 'Endpoint.',
          acceptanceCriteria: ['Authentication remains active.'],
          dependsOn: ['task_fixture_interface'],
          allowedFileScopes: ['service/**'],
          skillVersionIds: ['skill_service_v1'],
          validationRequirements: ['experience-check'],
          state: phase === 'completed' ? 'completed' : 'waiting',
        },
      },
      dependencies: {},
      agents: {},
      approvals: {},
      validations: {},
      artifacts: {},
      runtimeConnection: 'connected',
      attentionRequired: false,
      lastSequence: phase === 'completed' ? 47 : 12,
      lastEventId: 'event_fixture',
      appliedEventIds: ['event_fixture'],
    },
  } as unknown as DemoRunSnapshot;
}

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  vi.mocked(launchDemoRun).mockResolvedValue('run_fixture' as never);
  vi.mocked(readDemoRun).mockResolvedValue(snapshot('interface_active'));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('operational application shell', () => {
  it('defaults to Project before launch and moves to Current run after launch', async () => {
    const user = userEvent.setup();
    vi.mocked(readWorkspace).mockResolvedValue({
      workspace,
    } as WorkspaceResponse);
    render(<App />);

    expect(
      await screen.findByRole('heading', { name: 'Fixture project' }),
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /PlanTask topology/ }));
    await user.click(
      screen.getByRole('button', { name: /Approve plan and launch/ }),
    );

    expect(
      await screen.findByRole('heading', { name: 'Account preferences loop' }),
    ).toBeTruthy();
    expect(window.location.hash).toBe('#/run');
  });

  it('recovers an active run to Run and a terminal run to Review', async () => {
    vi.mocked(readWorkspace).mockResolvedValue({
      workspace,
      activeRun: snapshot('interface_active'),
    });
    const active = render(<App />);
    expect(
      await screen.findByRole('heading', { name: 'Account preferences loop' }),
    ).toBeTruthy();
    active.unmount();

    window.history.replaceState(null, '', '/');
    vi.mocked(readWorkspace).mockResolvedValue({
      workspace,
      activeRun: snapshot('completed'),
    });
    render(<App />);
    await waitFor(() => expect(window.location.hash).toBe('#/review'));
    expect(
      await screen.findByRole('heading', {
        name: 'Ready for human review',
        level: 1,
      }),
    ).toBeTruthy();
  });
});
