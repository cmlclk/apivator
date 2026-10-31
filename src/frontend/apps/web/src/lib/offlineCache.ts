import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { persistQueryClient } from '@tanstack/react-query-persist-client';
import { NetworkError, type ApiRequestDto, type CollectionTreeDto } from '@apivator/core';
import { translate } from '../i18n';
import { useSession } from '../stores/session';
import { api } from './api';
import { isOnline } from './connectivity';
import { UserError } from './errors';
import { kv } from './idb';
import { queryClient as defaultClient } from './queryClient';
import { serverUrl } from './serverUrl';

/**
 * Çevrimdışı önbellek: workspace'ler, collection ağaçları, istek tanımları, environment'lar, globals ve geçmiş
 * kullanıcı başına IndexedDB'de saklanır. Uygulama sunucuya ulaşamadığında bunlarla açılır; bağlantı gelince
 * React Query sorguları kendiliğinden tazeler. Collection'daki istekler ağaç her yüklendiğinde arka planda
 * eşitlenir (yalnızca sürümü değişen collection'lar indirilir), böylece hiç açılmamış istekler de çevrimdışı açılır.
 */

export const OFFLINE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Önbellek biçimi değişirse artırılır; eski önbellek atılır. */
const CACHE_VERSION = '1';

const PERSISTED_ROOTS = new Set([
  'workspaces',
  'collections',
  'request',
  'environments',
  'globals',
  'history',
]);

export const requestQueryKey = (id: string) => ['request', id] as const;

export function shouldPersist(key: QueryKey): boolean {
  const root = key[0];
  if (typeof root !== 'string' || !PERSISTED_ROOTS.has(root)) return false;
  // ['collections', workspaceId] ağaçtır; ['collections', id, 'access'] gibi alt sorgular saklanmaz.
  return root !== 'collections' || key.length === 2;
}

const cachePrefix = () => `apivator-cache:${serverUrl() || location.origin}:`;

let active: { userId: string; stop: () => void } | null = null;

function startFor(queryClient: QueryClient, userId: string) {
  active?.stop();
  // Kullanılmayan sorgular hemen bellekten atılmasın; aksi hâlde önbellekten de düşerler.
  for (const root of PERSISTED_ROOTS) queryClient.setQueryDefaults([root], { gcTime: OFFLINE_MAX_AGE_MS });
  const persister = createAsyncStoragePersister({
    storage: { getItem: kv.get, setItem: kv.set, removeItem: kv.remove },
    key: cachePrefix() + userId,
    throttleTime: 1000,
  });
  const [unsubscribe, restored] = persistQueryClient({
    queryClient,
    persister,
    maxAge: OFFLINE_MAX_AGE_MS,
    buster: CACHE_VERSION,
    dehydrateOptions: {
      shouldDehydrateQuery: (q) => q.state.status === 'success' && shouldPersist(q.queryKey),
    },
  });
  void restored.catch(() => undefined);
  active = { userId, stop: unsubscribe };
}

/** Oturum açılınca (ya da çevrimdışı açılışta) o kullanıcının önbelleğini bağlar; çıkışta siler. */
export function startOfflineCache(queryClient: QueryClient) {
  const sync = () => {
    const { status, user } = useSession.getState();
    if ((status === 'authenticated' || status === 'offline') && user) {
      if (active?.userId !== user.id) startFor(queryClient, user.id);
    } else if (status === 'anonymous' && active) {
      // Çıkış: bu cihazda veri bırakılmaz.
      const userId = active.userId;
      active.stop();
      active = null;
      queryClient.clear();
      void kv.remove(cachePrefix() + userId);
    }
  };
  sync();
  const unsubscribeSession = useSession.subscribe(sync);
  const unsubscribeCache = queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action.type !== 'success') return;
    const key = event.query.queryKey;
    if (key[0] === 'collections' && key.length === 2) {
      scheduleRequestSync(queryClient, event.query.state.data as CollectionTreeDto[] | undefined);
    }
  });
  return () => {
    unsubscribeSession();
    unsubscribeCache();
    active?.stop();
    active = null;
  };
}

// --- İstek tanımlarının arka planda eşitlenmesi ---

const pending = new Map<string, CollectionTreeDto>();
let syncing = false;

/** Önbellekteki tanımı eksik ya da eski olan collection'lar sıraya alınır. */
export function staleCollections(queryClient: QueryClient, trees: CollectionTreeDto[]): CollectionTreeDto[] {
  return trees.filter((tree) =>
    tree.requests.some((r) => {
      // Sürüm bilgisi yoksa (eski sunucu) eşitleme yapılmaz.
      if (r.version === undefined) return false;
      return queryClient.getQueryData<ApiRequestDto>(requestQueryKey(r.id))?.version !== r.version;
    }),
  );
}

export function scheduleRequestSync(queryClient: QueryClient, trees: CollectionTreeDto[] | undefined) {
  if (!trees) return;
  for (const tree of staleCollections(queryClient, trees)) pending.set(tree.id, tree);
  if (!syncing && pending.size) void drain(queryClient);
}

async function drain(queryClient: QueryClient) {
  syncing = true;
  try {
    while (pending.size && isOnline()) {
      const [id] = pending.keys();
      pending.delete(id!);
      try {
        for (const request of await api.requests.list(id!)) {
          queryClient.setQueryData(requestQueryKey(request.id), request);
        }
      } catch {
        // Eşitleme yardımcıdır; hata (ör. erişim kalktı) uygulamayı etkilemez.
      }
    }
  } finally {
    syncing = false;
  }
}

/**
 * Kaydedilmiş isteği yükler: çevrimiçiyken sunucudan (önbelleği de günceller), sunucuya ulaşılamazsa
 * önbellekten.
 */
export async function loadRequest(
  id: string,
  queryClient: QueryClient = defaultClient,
): Promise<ApiRequestDto> {
  const cached = queryClient.getQueryData<ApiRequestDto>(requestQueryKey(id));
  if (!isOnline() && cached) return cached;
  try {
    const request = await api.requests.get(id);
    queryClient.setQueryData(requestQueryKey(id), request);
    return request;
  } catch (error) {
    if (error instanceof NetworkError) {
      if (cached) return cached;
      throw new UserError(translate('common', 'errors.requestNotCached'));
    }
    throw error;
  }
}
