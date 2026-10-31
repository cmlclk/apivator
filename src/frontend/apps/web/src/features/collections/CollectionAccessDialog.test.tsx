import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  emptyAuth,
  emptyScripts,
  type CollectionAccessDto,
  type CollectionTreeDto,
  type WorkspaceDto,
} from '@apivator/core';
import { CollectionAccessDialog } from './CollectionAccessDialog';
import { canEditCollection, effectiveNote } from './collectionAccess';

const api = vi.hoisted(() => ({
  access: vi.fn(),
  updateAccess: vi.fn(),
  members: vi.fn(),
  teams: vi.fn(),
}));

vi.mock('../../lib/api', () => ({
  api: {
    collections: { access: api.access, updateAccess: api.updateAccess },
    workspaces: { members: api.members },
    organizations: { teams: api.teams },
  },
}));

const collection: CollectionTreeDto = {
  id: 'c1',
  workspaceId: 'w1',
  name: 'Ödeme API',
  description: null,
  auth: emptyAuth('None'),
  variables: [],
  scripts: emptyScripts(),
  folders: [],
  requests: [],
  examples: [],
  role: 'Admin',
  editingRestricted: false,
};

const workspace: WorkspaceDto = {
  id: 'w1',
  name: 'Ödeme ekibi',
  type: 'Team',
  role: 'Admin',
  organizationId: 'o1',
  organizationName: 'Acme',
};

const accessDto = (over: Partial<CollectionAccessDto> = {}): CollectionAccessDto => ({
  collectionId: 'c1',
  editingRestricted: false,
  canManage: true,
  myRole: 'Admin',
  entries: [
    {
      id: 'e1',
      kind: 'User',
      subjectId: 'u2',
      name: 'Ali Veli',
      email: 'ali@acme.test',
      role: 'Viewer',
      workspaceRole: 'Editor',
    },
  ],
  ...over,
});

function setup(ws: WorkspaceDto = workspace) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <CollectionAccessDialog collection={collection} workspace={ws} onClose={onClose} />
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), onClose };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.members.mockResolvedValue({
    users: [
      { userId: 'u1', displayName: 'Yönetici', email: 'y@acme.test', role: 'Admin' },
      { userId: 'u2', displayName: 'Ali Veli', email: 'ali@acme.test', role: 'Editor' },
      { userId: 'u3', displayName: 'Ayşe Kaya', email: 'ayse@acme.test', role: 'Viewer' },
    ],
    teams: [{ teamId: 't1', name: 'QA', role: 'Viewer', memberCount: 3 }],
    organizationAdmins: [],
  });
  api.teams.mockResolvedValue([{ id: 't1', name: 'QA', members: [{}, {}, {}] }]);
});

describe('CollectionAccessDialog', () => {
  it('lets an admin narrow, grant and restrict, then saves the whole list', async () => {
    api.access.mockResolvedValue(accessDto());
    api.updateAccess.mockResolvedValue(accessDto());
    const { user, onClose } = setup();

    expect(
      await screen.findByText("Workspace'te düzenleyici, burada görüntüleyici", { exact: false }),
    ).toBeInTheDocument();
    const save = screen.getByRole('button', { name: 'Kaydet' });
    expect(save).toBeDisabled();

    // Yöneticiler ve zaten listede olanlar adaylarda yok.
    const picker = screen.getByLabelText('Eklenecek kişi ya da takım');
    await screen.findByRole('option', { name: /Ayşe Kaya/ });
    expect(within(picker).queryByRole('option', { name: /Yönetici/ })).not.toBeInTheDocument();
    expect(within(picker).queryByRole('option', { name: /Ali Veli/ })).not.toBeInTheDocument();

    await user.selectOptions(picker, 'User:u3');
    await user.selectOptions(screen.getByLabelText('Verilecek rol'), 'Editor');
    await user.click(screen.getByRole('button', { name: 'Ekle' }));
    expect(
      screen.getByText("ayse@acme.test · Workspace'te görüntüleyici, burada düzenleyici", { exact: false }),
    ).toBeInTheDocument();

    await user.selectOptions(picker, 'Team:t1');
    await user.click(screen.getByRole('button', { name: 'Ekle' }));
    await user.click(screen.getByRole('checkbox', { name: /Düzenlemeyi kısıtla/ }));
    await user.click(save);

    expect(api.updateAccess).toHaveBeenCalledWith('c1', true, [
      { userId: 'u2', teamId: null, role: 'Viewer' },
      { userId: 'u3', teamId: null, role: 'Editor' },
      { userId: null, teamId: 't1', role: 'Editor' },
    ]);
    expect(onClose).toHaveBeenCalled();
  });

  it('is read-only for members who cannot manage', async () => {
    api.access.mockResolvedValue(accessDto({ canManage: false, myRole: 'Viewer' }));
    setup({ ...workspace, role: 'Editor' });

    expect(await screen.findByText('Görüntüleyici', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByLabelText('Ali Veli collection rolü')).toBeDisabled();
    expect(screen.queryByLabelText('Eklenecek kişi ya da takım')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Kaydet' })).not.toBeInTheDocument();
    expect(api.members).not.toHaveBeenCalled();
  });

  it('explains that personal workspaces have no collection roles', async () => {
    api.access.mockResolvedValue(accessDto({ entries: [] }));
    setup({ ...workspace, type: 'Personal' });
    expect(await screen.findByText(/Kişisel workspace'te collection rolleri yok/)).toBeInTheDocument();
  });
});

describe('collection access helpers', () => {
  it('uses the collection role when the server sends it', () => {
    expect(canEditCollection({ role: 'Viewer' }, 'Editor')).toBe(false);
    expect(canEditCollection({ role: 'Editor' }, 'Viewer')).toBe(true);
    expect(canEditCollection({ role: undefined }, 'Editor')).toBe(true);
    expect(canEditCollection(undefined, 'Viewer')).toBe(false);
  });

  it('describes team entries', () => {
    expect(
      effectiveNote(
        { kind: 'Team', subjectId: 't', name: 'QA', email: null, role: 'Editor', workspaceRole: null },
        false,
      ),
    ).toContain("workspace'e eklenmemiş");
  });
});
