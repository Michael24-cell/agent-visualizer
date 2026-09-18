import { describe, expect, it } from 'vitest';
import { WorkspaceFixtureSchema } from '@harness/contracts';
import { buildTaskViewModels } from './model.js';

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
});
