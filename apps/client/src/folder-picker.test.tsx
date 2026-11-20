// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FolderListing } from '@harness/contracts';
import { listFolders } from './api';
import { FolderPicker } from './folder-picker';

vi.mock('./api', () => ({
  listFolders: vi.fn(),
  createFolder: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const listings: Record<string, FolderListing> = {
  '/home/me': {
    path: '/home/me',
    entries: [
      { name: 'shop', path: '/home/me/shop', isRepository: true },
      { name: 'notes', path: '/home/me/notes', isRepository: false },
    ],
  } as FolderListing,
  '/home/me/shop': {
    path: '/home/me/shop',
    parent: '/home/me',
    entries: [{ name: 'src', path: '/home/me/shop/src', isRepository: false }],
  } as FolderListing,
};

function setup() {
  vi.mocked(listFolders).mockImplementation(
    async (path) => listings[path ?? '/home/me']!,
  );
  const onPick = vi.fn();
  render(<FolderPicker onPick={onPick} onCancel={() => undefined} />);
  return { onPick, user: userEvent.setup() };
}

describe('FolderPicker', () => {
  it('uses the folder you are in until you select one', async () => {
    const { onPick, user } = setup();
    await user.click(await screen.findByRole('button', { name: 'Use “me”' }));
    expect(onPick).toHaveBeenCalledWith('/home/me');
  });

  it('selecting a folder names it on the one Use button', async () => {
    const { onPick, user } = setup();
    await user.click(await screen.findByRole('button', { name: /^shop/ }));
    expect(
      screen.getByRole('button', { name: /^shop/, pressed: true }),
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Use “shop”' }));
    expect(onPick).toHaveBeenCalledWith('/home/me/shop');
  });

  it('opens a folder only with its open control, and forgets the selection', async () => {
    const { onPick, user } = setup();
    await user.click(await screen.findByRole('button', { name: /^notes/ }));
    await user.click(screen.getByRole('button', { name: 'Open shop' }));
    await screen.findByRole('button', { name: /^src/ });
    // Inside shop, nothing selected: the button means shop itself.
    await user.click(screen.getByRole('button', { name: 'Use “shop”' }));
    expect(onPick).toHaveBeenCalledWith('/home/me/shop');
  });
});
