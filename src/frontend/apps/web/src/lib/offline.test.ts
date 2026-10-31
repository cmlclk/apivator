import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, onlineManager } from '@tanstack/react-query';
import { NetworkError, emptyDefinition, type ApiRequestDto, type CollectionTreeDto } from '@apivator/core';

const api = vi.hoisted(() => ({
  requests: { get: vi.fn(), list: vi.fn(), update: vi.fn() },
}));
vi.mock('./api', () => ({ api }));

import {
  isOnline,
  onReconnect,
  reportReachability,
  resetConnectivity,
  startConnectivity,
  useConnectivity,
} from './connectivity';
import {
  loadRequest,
  requestQueryKey,
  scheduleRequestSync,
  shouldPersist,
  staleCollections,
} from './offlineCache';
import { rememberedUser, useSession } from '../stores/session';
import { useTabs } from '../features/requests/tabsStore';
import { flushPendingSaves, saveExistingTab } from '../features/requests/useRequestActions';

const dto = (id: string, version: number, url = 'https://x.test'): ApiRequestDto => ({
  id,
  collectionId: 'c1',
  folderId: null,
  name: id,
  definition: { ...emptyDefinition(), url },
  version,
  updatedAt: '2026-10-22T10:00:00Z',
});

const tree = (requests: { id: string; version?: number }[]): CollectionTreeDto => ({
  id: 'c1',
  workspaceId: 'w1',
  name: 'C',
  description: null,
  auth: emptyDefinition().auth,
  variables: [],
  scripts: emptyDefinition().scripts,
  folders: [],
  requests: requests.map((r, i) => ({
    id: r.id,
    folderId: null,
    name: r.id,
    method: 'GET',
    sortOrder: i,
    version: r.version,
  })),
  examples: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  resetConnectivity();
  localStorage.clear();
  useSession.setState({ status: 'loading', accessToken: null, user: null, unreachable: false });
  useTabs.setState({ tabs: [], activeTabId: null });
});

afterEach(() => resetConnectivity());

describe('connectivity', () => {
  it('goes offline on a network failure and runs reconnect listeners once it is back', () => {
    startConnectivity();
    const listener = vi.fn();
    onReconnect(listener);

    reportReachability(false);
    expect(isOnline()).toBe(false);
    expect(onlineManager.isOnline()).toBe(false);
    reportReachability(false);

    reportReachability(true);
    expect(isOnline()).toBe(true);
    expect(onlineManager.isOnline()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(useConnectivity.getState().lastReachedAt).not.toBeNull();
  });
});

describe('session when the server is unreachable', () => {
  it('opens offline with the user remembered on this device', () => {
    useSession.getState().setSession({
      accessToken: 't',
      accessTokenExpiresAt: '',
      refreshToken: 'r',
      refreshTokenExpiresAt: '',
      user: { id: 'u1', email: 'a@b.test', displayName: 'Ayşe', emailConfirmed: true },
    });
    expect(rememberedUser()?.id).toBe('u1');

    useSession.setState({ status: 'loading', user: null, accessToken: null });
    useSession.getState().setUnreachable();
    expect(useSession.getState()).toMatchObject({ status: 'offline', user: { id: 'u1' } });

    // Oturum açıkken kopma oturumu değiştirmez.
    useSession.setState({ status: 'authenticated' });
    useSession.getState().setUnreachable();
    expect(useSession.getState().status).toBe('authenticated');
  });

  it('stays on the login page without a remembered user, and forgets the user on sign-out', () => {
    useSession.getState().setUnreachable();
    expect(useSession.getState()).toMatchObject({ status: 'anonymous', unreachable: true });
    useSession.getState().setSession(null);
    expect(rememberedUser()).toBeNull();
  });
});

describe('offline cache', () => {
  it('persists only the data needed to work offline', () => {
    expect(shouldPersist(['collections', 'w1'])).toBe(true);
    expect(shouldPersist(['collections', 'c1', 'access'])).toBe(false);
    expect(shouldPersist(['request', 'r1'])).toBe(true);
    expect(shouldPersist(['environments', 'w1'])).toBe(true);
    expect(shouldPersist(['mock-calls', 'm1'])).toBe(false);
    expect(shouldPersist(['notifications'])).toBe(false);
  });

  it('downloads only collections whose request versions changed', async () => {
    const qc = new QueryClient();
    qc.setQueryData(requestQueryKey('r1'), dto('r1', 2));
    expect(staleCollections(qc, [tree([{ id: 'r1', version: 2 }])])).toHaveLength(0);
    expect(staleCollections(qc, [tree([{ id: 'r1' }, { id: 'r2' }])])).toHaveLength(0);
    expect(staleCollections(qc, [tree([{ id: 'r1', version: 3 }])])).toHaveLength(1);

    api.requests.list.mockResolvedValue([dto('r1', 3), dto('r2', 1)]);
    scheduleRequestSync(qc, [
      tree([
        { id: 'r1', version: 3 },
        { id: 'r2', version: 1 },
      ]),
    ]);
    await vi.waitFor(() => expect(qc.getQueryData<ApiRequestDto>(requestQueryKey('r2'))?.version).toBe(1));
    expect(api.requests.list).toHaveBeenCalledWith('c1');
  });

  it('opens a request from the cache when the server is unreachable', async () => {
    const qc = new QueryClient();
    api.requests.get.mockResolvedValueOnce(dto('r1', 1, 'https://taze.test'));
    expect((await loadRequest('r1', qc)).definition.url).toBe('https://taze.test');

    api.requests.get.mockRejectedValue(new NetworkError('x'));
    expect((await loadRequest('r1', qc)).definition.url).toBe('https://taze.test');
    await expect(loadRequest('r9', qc)).rejects.toThrow(/henüz bu cihaza indirilmemiş/);

    // Çevrimdışı olduğu biliniyorsa sunucu hiç denenmez.
    reportReachability(false);
    api.requests.get.mockClear();
    await loadRequest('r1', qc);
    expect(api.requests.get).not.toHaveBeenCalled();
  });
});

describe('saving while offline', () => {
  it('keeps the change on this device and saves it when the connection returns', async () => {
    const qc = new QueryClient();
    const id = useTabs.getState().newTab('w1');
    useTabs.getState().markSaved(id, dto('r1', 1));
    useTabs.getState().updateDraft(id, { url: 'https://degisti.test' });

    api.requests.update.mockRejectedValueOnce(new NetworkError('x'));
    await saveExistingTab(qc, useTabs.getState().tabs[0]!);
    expect(useTabs.getState().tabs[0]).toMatchObject({ pendingSave: true, saveError: null });

    // Hâlâ ulaşılamıyor: işaret kalır.
    api.requests.update.mockRejectedValueOnce(new NetworkError('x'));
    expect(await flushPendingSaves(qc)).toBe(0);
    expect(useTabs.getState().tabs[0]!.pendingSave).toBe(true);

    api.requests.update.mockResolvedValueOnce(dto('r1', 2, 'https://degisti.test'));
    expect(await flushPendingSaves(qc)).toBe(1);
    expect(api.requests.update).toHaveBeenLastCalledWith(
      'r1',
      'r1',
      expect.objectContaining({ url: 'https://degisti.test' }),
      1,
    );
    expect(useTabs.getState().tabs[0]).toMatchObject({ pendingSave: false, saved: { version: 2 } });
    expect(qc.getQueryData<ApiRequestDto>(requestQueryKey('r1'))?.version).toBe(2);
  });
});
