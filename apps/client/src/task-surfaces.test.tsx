// @vitest-environment jsdom

import { useState } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { TaskInspector, TaskList, TaskRail } from './App';
import type { FixtureTaskKey, TaskViewModel } from './model';

afterEach(cleanup);

const tasks: TaskViewModel[] = [
  {
    key: 'interface',
    title: 'Interface task',
    category: 'interface',
    state: 'running',
    stateLabel: 'In progress',
    statusSymbol: '▶',
    purpose: 'Define the visible contract.',
    whySeparate: 'Review the contract before implementation.',
    deliverable: 'Contract',
    acceptanceCriteria: ['Keyboard flow works.'],
    fileScopes: ['client/**'],
    skills: ['Interface craft'],
    dependsOn: [],
    agentProfile: 'Interface systems',
    agentState: 'active',
    currentActivity: 'Defining form states.',
    evidence: [],
  },
  {
    key: 'service',
    title: 'Service task',
    category: 'orchestration',
    state: 'waiting',
    stateLabel: 'Waiting on dependency',
    statusSymbol: '↳',
    purpose: 'Consume the visible contract.',
    whySeparate: 'Protect the authenticated boundary.',
    deliverable: 'Endpoint',
    acceptanceCriteria: ['Authentication remains active.'],
    fileScopes: ['service/**'],
    skills: ['Service contracts'],
    dependsOn: ['interface'],
    agentProfile: 'Backend orchestration',
    currentActivity: 'Waiting for contract evidence.',
    evidence: [],
  },
];

function SelectionHarness({ view }: { view: 'graph' | 'list' }) {
  const [selected, setSelected] = useState<FixtureTaskKey>('interface');
  const selectedTask = tasks.find((task) => task.key === selected) ?? tasks[0];
  if (!selectedTask) throw new Error('Expected a selected task.');
  return (
    <>
      {view === 'graph' ? (
        <TaskRail tasks={tasks} selected={selected} onSelect={setSelected} />
      ) : (
        <TaskList tasks={tasks} selected={selected} onSelect={setSelected} />
      )}
      <TaskInspector task={selectedTask} />
    </>
  );
}

describe('task presentation interactions', () => {
  it('updates the inspector when a graph task is selected', async () => {
    const user = userEvent.setup();
    render(<SelectionHarness view="graph" />);
    await user.click(
      screen.getByRole('button', {
        name: 'Service task, Waiting on dependency',
      }),
    );
    expect(screen.getByText('Consume the visible contract.')).toBeTruthy();
    expect(screen.getByText('service/**')).toBeTruthy();
  });

  it('supports keyboard selection in the accessible list', async () => {
    const user = userEvent.setup();
    render(<SelectionHarness view="list" />);
    const serviceRow = screen.getByRole('button', {
      name: 'Inspect Service task',
    });
    serviceRow.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByText('Consume the visible contract.')).toBeTruthy();
    expect(serviceRow.closest('[role="row"]')?.getAttribute('class')).toContain(
      'is-selected',
    );
  });

  it('presents activity without creating a competing live region', () => {
    const { container } = render(
      <TaskInspector
        task={{
          ...tasks[0]!,
          state: 'repair_pending',
          stateLabel: 'Repair required',
          currentActivity: 'A bounded focus repair is required.',
        }}
      />,
    );
    expect(
      screen.getByText('A bounded focus repair is required.'),
    ).toBeTruthy();
    expect(container.querySelector('[aria-live]')).toBeNull();
    expect(container.querySelector('.check-list.is-evidenced')).toBeNull();
  });

  it('marks acceptance criteria as evidenced only for completed work with evidence', () => {
    const { container } = render(
      <TaskInspector
        task={{
          ...tasks[0]!,
          state: 'completed',
          stateLabel: 'Completed',
          evidence: ['experience-check: passed'],
        }}
      />,
    );
    expect(container.querySelector('.check-list.is-evidenced')).toBeTruthy();
  });
});
