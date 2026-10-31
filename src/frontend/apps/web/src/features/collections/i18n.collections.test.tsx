import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ForkInfoDto } from '@apivator/core';
import { initI18n, setLanguage } from '../../i18n';
import { ForkStatusDialog } from '../forks/ForkStatusDialog';
import { GitPullPanel } from '../gitsync/GitPullPanel';
import { VariablesDialog } from '../environments/VariablesDialog';
import { effectiveNote } from './collectionAccess';
import { DescriptionDialog } from './DescriptionDialog';

const mocks = vi.hoisted(() => ({ compare: vi.fn() }));

vi.mock('../../lib/api', () => ({
  api: { forks: { compare: mocks.compare }, gitSync: { previewPull: vi.fn(), pull: vi.fn() } },
}));

const fork: ForkInfoDto = {
  id: 'f1',
  forkCollectionId: 'c2',
  forkName: 'Users API (fork)',
  forkWorkspaceId: 'w1',
  sourceCollectionId: 'c1',
  sourceName: 'Users API',
  sourceWorkspaceId: 'w2',
  sourceWorkspaceName: 'Team',
  createdByName: 'Ada',
  createdAt: '2026-10-22T08:00:00Z',
  lastPulledAt: null,
} as ForkInfoDto;

beforeEach(async () => {
  mocks.compare.mockResolvedValue({ changes: [], incoming: 0, outgoing: 0, conflicts: 0 });
  await setLanguage('en');
});
afterEach(() => initI18n('tr'));

describe('collections / environments / forks / gitsync in English', () => {
  it('renders the variables dialog in English', () => {
    render(
      <VariablesDialog
        title="Environment: Dev"
        description="desc"
        name="Dev"
        variables={[{ key: 'token', value: '', enabled: true, isSecret: true }]}
        currentValues={{}}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Show secret values' })).toBeInTheDocument();
    expect(screen.getByText('Initial value')).toBeInTheDocument();
    expect(screen.getByLabelText('Current value 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(screen.queryByText(/Kaydet|Vazgeç|Değişken/)).not.toBeInTheDocument();
  });

  it('renders the description dialog and the access notes in English', () => {
    render(
      <DescriptionDialog
        title="Description: A"
        initial=""
        readOnly={false}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('Edit')).toBeInTheDocument();
    expect(
      screen.getByText('Markdown is supported: headings, lists, tables, code blocks, links.'),
    ).toBeInTheDocument();

    expect(
      effectiveNote(
        {
          kind: 'User',
          subjectId: 'u',
          name: 'Ada',
          email: 'a@b.c',
          role: 'Viewer',
          workspaceRole: 'Editor',
        },
        true,
      ),
    ).toBe('a@b.c · Workspace role: editor; here: viewer');
  });

  it('renders the fork status summary in English', async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ForkStatusDialog fork={fork} canEdit onClose={vi.fn()} />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('Changes in the source')).toBeInTheDocument();
    expect(screen.getByText('The fork is up to date with the source.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Unlink fork/ })).toBeInTheDocument();
    expect(screen.getByText(/forked by Ada/)).toHaveTextContent('Source: Users API (Team) · forked by Ada');
    expect(screen.queryByText(/Kaynak|değişiklik/)).not.toBeInTheDocument();
  });

  it('renders the git pull panel in English', () => {
    render(<GitPullPanel collectionId="c1" onDone={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Pull from repository' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show differences' })).toBeInTheDocument();
    expect(screen.queryByText(/Repodan|Farkları/)).not.toBeInTheDocument();
  });
});
