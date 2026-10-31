import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { emptyDefinition, type ForkChangeDto, type ForkSnapshot, type MergeRequestDto } from '@apivator/core';
import { ChangeList } from './ChangeList';
import { snapshotDiff } from './forkDiff';
import { MergeRequestDialog } from './MergeRequestDialog';

const api = vi.hoisted(() => ({ get: vi.fn(), merge: vi.fn(), approve: vi.fn(), comments: vi.fn() }));

vi.mock('../../lib/api', () => ({
  api: {
    mergeRequests: { get: api.get, merge: api.merge, approve: api.approve, decline: vi.fn(), close: vi.fn() },
    comments: { list: api.comments, create: vi.fn() },
    people: { list: vi.fn().mockResolvedValue([]) },
  },
}));

vi.mock('../../stores/session', () => ({
  useSession: (pick: (s: { user: { id: string } }) => unknown) => pick({ user: { id: 'editor' } }),
}));

const snap = (url: string, name = 'Listele'): ForkSnapshot => ({
  name,
  parent: null,
  definition: { ...emptyDefinition(), url },
  examples: [],
  description: null,
  auth: null,
  variables: null,
  scripts: null,
});

const change = (over: Partial<ForkChangeDto>): ForkChangeDto => ({
  key: 'link:1',
  kind: 'Request',
  name: 'Listele',
  path: 'Kullanıcılar',
  forkChange: 'Modified',
  sourceChange: null,
  conflict: false,
  base: snap('/users'),
  fork: snap('/v2/users'),
  source: snap('/users'),
  ...over,
});

describe('snapshotDiff', () => {
  it('istekte değişen bölümleri ve eklenen öğeyi gösterir', () => {
    const modified = snapshotDiff('Request', snap('/users'), snap('/v2/users', 'Kullanıcılar'));
    expect(modified.map((s) => s.label)).toEqual(['Ad', 'Metod ve URL']);
    const added = snapshotDiff('Request', null, snap('/new'));
    expect(added.find((s) => s.label === 'Metod ve URL')?.lines.some((l) => l.kind === 'added')).toBe(true);
  });

  it('klasör taşınmasını ve collection ayarlarını ayırır', () => {
    const folder = (parent: string | null): ForkSnapshot => ({ ...snap(''), definition: null, parent });
    expect(snapshotDiff('Folder', folder(null), folder('link:9')).map((s) => s.label)).toEqual(['Konum']);
    const collection = (description: string): ForkSnapshot => ({
      ...snap(''),
      definition: null,
      description,
    });
    expect(snapshotDiff('Collection', collection('a'), collection('b')).map((s) => s.label)).toEqual([
      'Açıklama',
    ]);
  });
});

describe('ChangeList', () => {
  it('yöne göre listeler; çakışmada seçim yaptırır ve iki tarafı gösterir', async () => {
    const user = userEvent.setup();
    const onResolve = vi.fn();
    const changes = [
      change({ key: 'link:1', conflict: true, sourceChange: 'Modified', source: snap('/kaynak') }),
      change({ key: 'fork:2', name: 'Sil', forkChange: 'Added', base: null, source: null }),
      change({
        key: 'source:3',
        name: 'Oluştur',
        forkChange: null,
        sourceChange: 'Added',
        base: null,
        fork: null,
      }),
    ];
    const { unmount } = render(
      <ChangeList
        changes={changes}
        direction="incoming"
        resolutions={{}}
        onResolve={onResolve}
        empty="yok"
      />,
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('Çakışma')).toBeInTheDocument();
    await user.click(screen.getByLabelText('Benimkini koru'));
    expect(onResolve).toHaveBeenCalledWith('link:1', 'fork');
    await user.click(screen.getByText('Listele'));
    expect(screen.getByText('Kaynakta')).toBeInTheDocument();
    expect(screen.getByText("Fork'ta")).toBeInTheDocument();
    unmount();

    render(<ChangeList changes={changes} direction="outgoing" empty="yok" />);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.queryByLabelText('Benimkini koru')).not.toBeInTheDocument();
  });
});

describe('MergeRequestDialog', () => {
  const request: MergeRequestDto = {
    id: 'mr1',
    forkId: 'f1',
    workspaceId: 'w1',
    sourceCollectionId: 'c1',
    sourceName: 'Kullanıcılar API',
    forkCollectionId: 'c2',
    forkName: 'Kullanıcılar API (fork)',
    forkWorkspaceName: 'Kişisel Workspace',
    title: 'v2 adresleri',
    description: 'Getir v2ye geçti',
    status: 'Open',
    authorId: 'author',
    authorName: 'Ayşe',
    approvals: [],
    mergedChanges: [],
    createdAt: '2026-10-22T08:00:00Z',
    updatedAt: '2026-10-22T08:00:00Z',
    closedAt: null,
    closedByName: null,
    canMerge: true,
    canClose: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    api.comments.mockResolvedValue([]);
    api.merge.mockResolvedValue({ ...request, status: 'Merged' });
    api.approve.mockResolvedValue(request);
  });

  function renderDialog() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MergeRequestDialog id="mr1" onClose={vi.fn()} />
      </QueryClientProvider>,
    );
    return userEvent.setup();
  }

  it('değişiklikleri gösterir; düzenleyici onaylar ve birleştirir', async () => {
    api.get.mockResolvedValue({ request, changes: [change({})], conflicts: 0 });
    const user = renderDialog();
    expect(await screen.findByText('Listele')).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Yorumlar' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Onayla/ }));
    expect(api.approve).toHaveBeenCalledWith('mr1');
    await user.click(screen.getByRole('button', { name: /Birleştir/ }));
    expect(api.merge).toHaveBeenCalledWith('mr1');
  });

  it('çakışma varken birleştirme kapalıdır ve nedeni yazılır', async () => {
    api.get.mockResolvedValue({
      request,
      changes: [change({ conflict: true, sourceChange: 'Modified' })],
      conflicts: 1,
    });
    renderDialog();
    const merge = await screen.findByRole('button', { name: /Birleştir/ });
    expect(merge).toBeDisabled();
    expect(screen.getByText(/kaynakta da değişmiş/)).toBeInTheDocument();
  });

  it('birleştirilen istekte uygulanan değişikliklerin özeti görünür', async () => {
    api.get.mockResolvedValue({
      request: {
        ...request,
        status: 'Merged',
        canMerge: false,
        closedByName: 'Mehmet',
        closedAt: '2026-10-22T09:00:00Z',
        mergedChanges: [{ kind: 'Request', name: 'Listele', change: 'Modified' }],
      },
      changes: [],
      conflicts: 0,
    });
    renderDialog();
    const summary = await screen.findByRole('region', { name: 'Değişiklikler' });
    expect(within(summary).getByText('Listele')).toBeInTheDocument();
    expect(screen.getByText(/Birleştirildi: Mehmet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Birleştir/ })).not.toBeInTheDocument();
  });
});
