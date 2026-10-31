import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyDefinition, type ApiRequestDto } from '@apivator/core';
import { isDirty, useTabs } from '../features/requests/tabsStore';

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('./api', () => ({ api: { requests: { get: mocks.get }, refreshSession: vi.fn() } }));

const { applyRemoteRequest } = await import('./realtime');

const v3: ApiRequestDto = {
  id: 'r1',
  collectionId: 'c1',
  folderId: null,
  name: 'Kullanıcılar',
  definition: { ...emptyDefinition(), url: 'https://x.test/users' },
  version: 3,
  updatedAt: '2026-10-20T10:00:00Z',
};
const v4: ApiRequestDto = {
  ...v3,
  definition: { ...v3.definition, url: 'https://x.test/v2/users' },
  version: 4,
};

const only = () => useTabs.getState().tabs[0]!;

beforeEach(() => {
  useTabs.setState({ tabs: [], activeTabId: null });
  useTabs.getState().openSaved('w1', v3);
  mocks.get.mockReset().mockResolvedValue(v4);
});

describe('başkasının kaydettiği istek', () => {
  it('değişiklik yoksa sekme sessizce güncellenir', async () => {
    await applyRemoteRequest({ id: 'r1', collectionId: 'c1', version: 4, deleted: false }, 'Mert');
    expect(only().draft.url).toBe('https://x.test/v2/users');
    expect(only().saved?.version).toBe(4);
    expect(only().remote ?? null).toBeNull();
  });

  it('sekmede kaydedilmemiş değişiklik varsa çakışma olarak bekler; taslak korunur', async () => {
    useTabs.getState().updateDraft(only().id, { url: 'https://x.test/benim' });
    await applyRemoteRequest({ id: 'r1', collectionId: 'c1', version: 4, deleted: false }, 'Mert');
    expect(only().draft.url).toBe('https://x.test/benim');
    expect(only().remote).toMatchObject({ byName: 'Mert', deleted: false, request: { version: 4 } });
  });

  it('benimkini koru: taban güncel sürüm olur, taslak kaydedilmeye hazır kalır', async () => {
    useTabs.getState().updateDraft(only().id, { url: 'https://x.test/benim' });
    await applyRemoteRequest({ id: 'r1', collectionId: 'c1', version: 4, deleted: false }, 'Mert');
    useTabs.getState().keepMine(only().id);
    expect(only().saved?.version).toBe(4);
    expect(only().draft.url).toBe('https://x.test/benim');
    expect(isDirty(only())).toBe(true);
    expect(only().remote).toBeNull();
  });

  it('aynı ya da eski sürüm yok sayılır (kendi kaydımızın yankısı)', async () => {
    await applyRemoteRequest({ id: 'r1', collectionId: 'c1', version: 3, deleted: false }, 'Mert');
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('silinen istek sekmeyi kaybetmez; yeni istek olarak saklanabilir', async () => {
    await applyRemoteRequest({ id: 'r1', collectionId: 'c1', version: 3, deleted: true }, 'Mert');
    expect(only().remote).toMatchObject({ deleted: true, byName: 'Mert' });
    useTabs.getState().detach(only().id);
    expect(only()).toMatchObject({ requestId: null, saved: null, remote: null });
    expect(only().draft.url).toBe('https://x.test/users');
  });
});
