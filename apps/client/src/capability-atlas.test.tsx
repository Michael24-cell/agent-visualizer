// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkspaceFixture } from '@harness/contracts';
import { CapabilityAtlas } from './capability-atlas';

afterEach(cleanup);

const capabilities: WorkspaceFixture['capabilities'] = [
  {
    id: 'agent-interface-systems',
    name: 'Interface systems',
    kind: 'agent',
    category: 'interface',
    availability: 'active',
    description: 'Owns the visible contract.',
    source: 'Fixture',
    trust: 'Approved',
    runtime: 'Simulated',
    relatedTo: ['skill-accessible-interface'],
  },
  {
    id: 'skill-accessible-interface',
    name: 'Accessible interface craft',
    kind: 'skill',
    category: 'interface',
    availability: 'active',
    description: 'Checks keyboard and responsive behavior.',
    source: 'Fixture',
    trust: 'Approved',
    runtime: 'Adapter-neutral',
    relatedTo: ['agent-interface-systems'],
  },
  {
    id: 'agent-verification-review',
    name: 'Verification review',
    kind: 'agent',
    category: 'verification',
    availability: 'recommended',
    description: 'Interprets validation evidence.',
    source: 'Fixture',
    trust: 'Reviewed',
    runtime: 'Simulated',
    relatedTo: [],
  },
  {
    id: 'system-live-provider',
    name: 'Live coding runtime',
    kind: 'system',
    category: 'neutral',
    availability: 'unavailable',
    description: 'No provider connected.',
    source: 'Roadmap',
    trust: 'Unavailable',
    runtime: 'None',
    relatedTo: [],
  },
];

describe('capability Atlas', () => {
  it('keeps graph and list selection connected to one inspector', async () => {
    const user = userEvent.setup();
    render(<CapabilityAtlas capabilities={capabilities} />);

    await user.click(
      screen.getByRole('button', {
        name: 'Verification review, agent, recommended',
      }),
    );
    expect(
      screen.getByRole('complementary', {
        name: 'Selected capability inspector',
      }).textContent,
    ).toContain('Interprets validation evidence.');

    await user.click(screen.getByRole('button', { name: 'List' }));
    expect(
      screen
        .getByRole('button', { name: /Verification review/ })
        .getAttribute('class'),
    ).toContain('is-selected');
  });

  it('exposes active, recommended, and unavailable semantics as text', async () => {
    const user = userEvent.setup();
    render(<CapabilityAtlas capabilities={capabilities} />);

    await user.selectOptions(screen.getByLabelText('State'), 'unavailable');
    expect(
      screen.getByRole('button', {
        name: 'Live coding runtime, system, unavailable',
      }),
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', {
        name: 'Interface systems, agent, active',
      }),
    ).toBeNull();
  });
});
