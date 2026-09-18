import { describe, expect, it } from 'vitest';
import {
  WorkspaceFixtureSchema,
  type DemoRunSnapshot,
  type DomainEvent,
} from '@harness/contracts';
import {
  buildReviewViewModel,
  buildTaskViewModels,
  describeEvent,
} from './model.js';

const fixture = WorkspaceFixtureSchema.parse({
  project: {
    id: 'fixture',
    name: 'Fixture',
    repository: 'local/fixture',
    branch: 'main',
    summary: 'A fixture project.',
    stack: ['React'],
    instructionFindings: [],
    validationCapabilities: ['Vitest'],
  },
  context: {
    methodology: {
      name: 'Method',
      version: '1',
      provenance: 'Fixture',
      summary: 'Method summary.',
    },
    rules: [],
    skills: [],
    validators: [],
  },
  plan: {
    id: 'planv_fixture',
    narrative: 'Two tasks in sequence.',
    agentCountRationale: 'Two sequential owners.',
    risks: ['Contract drift.'],
    validationSummary: 'Each task is validated.',
    tasks: [
      {
        key: 'interface',
        title: 'Interface task',
        category: 'interface',
        purpose: 'Define the contract.',
        whySeparate: 'Review it first.',
        deliverable: 'Contract.',
        acceptanceCriteria: ['Contract exists.'],
        fileScopes: ['client/**'],
        skills: ['UI'],
        dependsOn: [],
        agentProfile: 'Interface',
      },
      {
        key: 'service',
        title: 'Service task',
        category: 'orchestration',
        purpose: 'Consume the contract.',
        whySeparate: 'Protect the boundary.',
        deliverable: 'Endpoint.',
        acceptanceCriteria: ['Endpoint works.'],
        fileScopes: ['service/**'],
        skills: ['Backend'],
        dependsOn: ['interface'],
        agentProfile: 'Service',
      },
    ],
  },
  capabilities: [],
});

function makeSnapshot(
  phase: DemoRunSnapshot['phase'],
  options: {
    taskState?: string;
    runState?: string;
    attentionRequired?: boolean;
    validations?: Record<string, unknown>;
    artifacts?: Record<string, unknown>;
    events?: DomainEvent[];
  } = {},
): DemoRunSnapshot {
  return {
    phase,
    availableCommands: [],
    nextStepLabel: 'Review state',
    events: options.events ?? [],
    projection: {
      runId: 'run_fixture',
      run: {
        id: 'run_fixture',
        planVersionId: 'planv_fixture',
        goal: 'Exercise the review model.',
        state: options.runState ?? 'executing',
        createdAt: '2026-09-18T00:00:00.000Z',
      },
      tasks: {
        task_interface: {
          id: 'task_interface',
          runId: 'run_fixture',
          planVersionId: 'planv_fixture',
          title: 'Interface task',
          purpose: 'Define the contract.',
          whySeparate: 'Review it first.',
          deliverable: 'Contract.',
          acceptanceCriteria: ['Contract exists.'],
          dependsOn: [],
          allowedFileScopes: ['client/**'],
          skillVersionIds: ['skill_ui_v1'],
          validationRequirements: ['experience-check'],
          state: options.taskState ?? 'running',
        },
      },
      dependencies: {},
      agents: {},
      approvals: {},
      validations: options.validations ?? {},
      artifacts: options.artifacts ?? {},
      runtimeConnection: 'connected',
      attentionRequired: options.attentionRequired ?? false,
      lastSequence: 1,
      lastEventId: 'event_fixture_1',
      appliedEventIds: ['event_fixture_1'],
    },
  } as unknown as DemoRunSnapshot;
}

const failedValidation = {
  id: 'validation_experience_1',
  runId: 'run_fixture',
  taskId: 'task_interface',
  validatorType: 'experience-check',
  startedAt: '2026-09-18T00:00:01.000Z',
  finishedAt: '2026-09-18T00:00:02.000Z',
  status: 'failed',
  outputSummary: 'Focus did not move to the error summary.',
  blocksCompletion: true,
};

describe('plan task presentation model', () => {
  it('gives the graph and accessible list one ordered task source', () => {
    const tasks = buildTaskViewModels(fixture);
    expect(
      tasks.map(({ key, title, state }) => ({ key, title, state })),
    ).toEqual([
      { key: 'interface', title: 'Interface task', state: 'proposed' },
      { key: 'service', title: 'Service task', state: 'proposed' },
    ]);
    expect(tasks[1]?.dependsOn).toEqual(['interface']);
  });

  it('uses the latest task or agent event reason for current activity', () => {
    const taskEvent = {
      id: 'event_fixture_2',
      version: 1,
      sequence: 2,
      occurredAt: '2026-09-18T00:00:02.000Z',
      recordedAt: '2026-09-18T00:00:02.000Z',
      runId: 'run_fixture',
      taskId: 'task_interface',
      source: 'orchestrator',
      type: 'task.state_changed',
      payload: {
        from: 'validating',
        to: 'repair_pending',
        reason: 'A bounded focus repair is required.',
      },
    } as unknown as DomainEvent;
    const snapshot = makeSnapshot('repair_required', {
      taskState: 'repair_pending',
      attentionRequired: true,
      events: [taskEvent],
    });

    expect(buildTaskViewModels(fixture, snapshot)[0]?.currentActivity).toBe(
      'A bounded focus repair is required.',
    );
  });

  it('falls back to state prose when no applicable event exists', () => {
    const snapshot = makeSnapshot('interface_active');
    expect(buildTaskViewModels(fixture, snapshot)[0]?.currentActivity).toBe(
      'Defining form states and the shared request contract.',
    );
  });

  it('identifies the validator in completed validation ledger entries', () => {
    const snapshot = makeSnapshot('repair_required', {
      validations: { validation_experience_1: failedValidation },
    });
    const event = {
      id: 'event_fixture_3',
      version: 1,
      sequence: 3,
      occurredAt: '2026-09-18T00:00:03.000Z',
      recordedAt: '2026-09-18T00:00:03.000Z',
      runId: 'run_fixture',
      taskId: 'task_interface',
      source: 'validator',
      type: 'validation.completed',
      payload: {
        validationId: 'validation_experience_1',
        from: 'running',
        to: 'failed',
        finishedAt: '2026-09-18T00:00:03.000Z',
        outputSummary: 'Focus did not move to the error summary.',
      },
    } as unknown as DomainEvent;
    expect(describeEvent(event, snapshot.projection)).toContain(
      'experience-check failed',
    );
  });
});

describe('phase-aware review presentation', () => {
  it('keeps the pre-launch review empty and hides fixture diff statistics', () => {
    expect(buildReviewViewModel()).toMatchObject({
      state: 'prelaunch',
      title: 'Review begins after launch',
      hasDiffArtifact: false,
      warningState: 'none',
    });
  });

  it('keeps a failed validator unresolved while repair is required', () => {
    const review = buildReviewViewModel(
      makeSnapshot('repair_required', {
        taskState: 'repair_pending',
        attentionRequired: true,
        validations: { validation_experience_1: failedValidation },
      }),
    );
    expect(review).toMatchObject({
      state: 'attention',
      title: 'Repair required before review',
      warningState: 'unresolved',
      warningTitle: '1 unresolved validation warning',
      hasDiffArtifact: false,
    });
  });

  it('marks a warning resolved only after a later pass for the same task and validator', () => {
    const passedValidation = {
      ...failedValidation,
      id: 'validation_experience_2',
      startedAt: '2026-09-18T00:00:03.000Z',
      finishedAt: '2026-09-18T00:00:04.000Z',
      status: 'passed',
      outputSummary: 'Focus behavior passed.',
      retryOf: failedValidation.id,
    };
    const review = buildReviewViewModel(
      makeSnapshot('completed', {
        taskState: 'completed',
        runState: 'completed',
        validations: {
          validation_experience_1: failedValidation,
          validation_experience_2: passedValidation,
        },
        artifacts: {
          artifact_diff: {
            id: 'artifact_diff',
            runId: 'run_fixture',
            taskId: 'task_interface',
            agentInstanceId: 'agent_interface',
            type: 'diff',
            digest: 'sha256:fixture',
            createdAt: '2026-09-18T00:00:05.000Z',
            validationStatus: 'valid',
          },
        },
      }),
    );
    expect(review).toMatchObject({
      state: 'ready',
      title: 'Ready for human review',
      warningState: 'resolved',
      warningTitle: '1 resolved validation warning',
      hasDiffArtifact: true,
    });
  });

  it.each([
    ['failed', 'failed', 'Run failed and remains blocked'],
    ['cancelled', 'cancelled', 'Run cancelled with work preserved'],
  ] as const)(
    'describes a %s terminal run truthfully',
    (phase, state, title) => {
      expect(
        buildReviewViewModel(
          makeSnapshot(phase, { runState: state, taskState: state }),
        ),
      ).toMatchObject({ state, title, hasDiffArtifact: false });
    },
  );

  it('describes genuinely active work as in progress', () => {
    expect(
      buildReviewViewModel(makeSnapshot('interface_active')),
    ).toMatchObject({
      state: 'in_progress',
      title: 'Run is in progress',
    });
  });
});
