import type { HubConnection, HubConnectionState } from '@microsoft/signalr';
import { coreLanguage } from '@apivator/core';
import type { QueryClient } from '@tanstack/react-query';
import { create } from 'zustand';
import { api } from './api';
import { clientId } from './clientId';
import { serverUrl } from './serverUrl';
import { myInvitationsQueryKey, organizationsQueryKey, workspaceMembersKey } from './teams';
import { workspacesQueryKey } from './useWorkspaces';
import { useSession } from '../stores/session';
import { collectionsQueryKey } from '../features/collections/useCollections';
import { environmentsQueryKey, globalsQueryKey } from '../features/environments/useVariables';
import { mocksQueryKey } from '../features/mocks/useMocks';
import { monitorsQueryKey } from '../features/monitors/useMonitors';
import { mergeRequestsQueryKey } from '../features/forks/useForks';
import { isDirty, useTabs } from '../features/requests/tabsStore';
import { collabManager } from '../features/collab/collabManager';
import type { CollabTransport, DocumentJoin } from '../features/collab/CollabSession';
import {
  activityQueryKey,
  commentCountsQueryKey,
  notificationsQueryKey,
} from '../features/activity/activity';

export interface ChangeActor {
  userId: string | null;
  displayName: string | null;
  clientId: string | null;
}

export interface RequestChange {
  id: string;
  collectionId: string;
  version: number;
  deleted: boolean;
}

export interface WorkspaceChangedEvent {
  workspaceId: string;
  collections: boolean;
  environments: boolean;
  runs: boolean;
  workspace: boolean;
  requests: RequestChange[];
  activity: boolean;
  comments: boolean;
  mocks?: boolean;
  monitors?: boolean;
  mergeRequests?: boolean;
  actor: ChangeActor;
}

export interface PresenceUser {
  userId: string;
  displayName: string;
  requestIds: string[];
}

export interface PresenceSnapshot {
  workspaceId: string;
  users: PresenceUser[];
}

export type RealtimeStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'offline';

interface RealtimeState {
  status: RealtimeStatus;
  presence: PresenceSnapshot | null;
}

export const useRealtime = create<RealtimeState>(() => ({ status: 'idle', presence: null }));

/** Access token'ın süresi dolmak üzereyse (ya da dolduysa) önce yeniler; canlı kanal bağlanırken çağrılır. */
async function freshAccessToken(): Promise<string> {
  const token = useSession.getState().accessToken;
  if (token && !expiresSoon(token)) return token;
  const session = await api.refreshSession();
  return session?.accessToken ?? '';
}

function expiresSoon(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))) as {
      exp?: number;
    };
    return !payload.exp || payload.exp * 1000 - Date.now() < 30_000;
  } catch {
    return true;
  }
}

// SignalR istemcisi (~55 KB) ana pakete girmez; canlı kanal ilk açılışta yükler.
let signalR: typeof import('@microsoft/signalr') | null = null;

/**
 * Sekme başına tek bağlantı. Kopan bağlantı kendiliğinden yeniden kurulur; arada kaçan olaylar için yeniden
 * bağlanınca ilgili her şey baştan çekilir.
 */
export class RealtimeClient {
  private connection: HubConnection | null = null;
  private workspaceId: string | null = null;
  private requestId: string | null = null;
  private stopped = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** Her start/stop'ta artar; yükleme sürerken durdurulup yeniden başlatılırsa eski yükleme bağlantı kurmaz. */
  private generation = 0;

  constructor(private readonly queryClient: QueryClient) {}

  start() {
    this.stopped = false;
    void this.load(++this.generation);
  }

  private async load(generation: number) {
    try {
      signalR ??= await import('@microsoft/signalr');
      if (generation !== this.generation) return;
      this.build(signalR);
    } catch {
      if (generation !== this.generation) return;
      // Canlı kanal olmadan da uygulama çalışır; yalnızca ekran kendiliğinden tazelenmez.
      useRealtime.setState({ status: 'offline' });
      return;
    }
    void this.connect();
  }

  private build({ HttpTransportType, HubConnectionBuilder, LogLevel }: NonNullable<typeof signalR>) {
    // Web'de sunucu adresi boştur (aynı origin); SignalR mutlak adres ister.
    // Tarayıcı WebSocket'e başlık ekleyemez; sunucu mesajlarının dili sorgu dizgisiyle gider (Faz 8.2).
    const hubUrl = new URL('/hubs/workspace', serverUrl() || globalThis.location.origin);
    hubUrl.searchParams.set('lang', coreLanguage());
    const url = hubUrl.toString();
    const connection = new HubConnectionBuilder()
      .withUrl(url, {
        accessTokenFactory: freshAccessToken,
        // WebSocket yoksa (ör. kurumsal proxy) SSE ve long polling'e düşer.
        transport:
          HttpTransportType.WebSockets | HttpTransportType.ServerSentEvents | HttpTransportType.LongPolling,
      })
      .withAutomaticReconnect([0, 2_000, 5_000, 10_000, 30_000])
      .configureLogging(LogLevel.Warning)
      .build();
    this.connection = connection;

    connection.on('workspaceChanged', (e: WorkspaceChangedEvent) => void this.onWorkspaceChanged(e));
    connection.on('organizationChanged', () => this.refreshTeams());
    connection.on('accessChanged', () => void this.onAccessChanged());
    connection.on('notificationsChanged', () => {
      void this.queryClient.invalidateQueries({ queryKey: notificationsQueryKey });
    });
    connection.on('invitationsChanged', () => {
      void this.queryClient.invalidateQueries({ queryKey: myInvitationsQueryKey });
    });
    connection.on('presence', (p: PresenceSnapshot) => {
      if (p.workspaceId === this.workspaceId) useRealtime.setState({ presence: p });
    });
    connection.on('docUpdate', (id: string, update: string) => collabManager.onUpdate(id, update));
    connection.on('docAwareness', (id: string, payload: string, userId: string, name: string) =>
      collabManager.onAwareness(id, payload, { userId, name }),
    );
    connection.on('docRevoked', (id: string) => collabManager.onRevoked(id));
    connection.on('docAccessChanged', (id: string, canEdit: boolean) => collabManager.onAccess(id, canEdit));
    connection.onreconnecting(() => useRealtime.setState({ status: 'reconnecting' }));
    connection.onreconnected(() => void this.afterConnect(true));
    connection.onclose(() => {
      useRealtime.setState({ status: this.stopped ? 'idle' : 'offline', presence: null });
      if (!this.stopped) this.scheduleRetry(30_000);
    });
  }

  stop() {
    this.stopped = true;
    this.generation++;
    collabManager.stop();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    void this.connection?.stop();
    this.connection = null;
    useRealtime.setState({ status: 'idle', presence: null });
  }

  /** Görüntülenen workspace; değişince eski grubun olayları kesilir. */
  setWorkspace(workspaceId: string | null) {
    if (workspaceId === this.workspaceId) return;
    this.workspaceId = workspaceId;
    this.requestId = null;
    useRealtime.setState({ presence: null });
    void this.join();
  }

  /** Etkin sekmedeki kayıtlı istek; ekip arkadaşları kimin neye baktığını görür. */
  setViewing(requestId: string | null) {
    if (requestId === this.requestId) return;
    this.requestId = requestId;
    if (this.connected()) void this.connection!.invoke('ViewRequest', requestId).catch(() => undefined);
  }

  /** Ortak düzenleme (Yjs) için hub uçları. */
  private readonly collabTransport: CollabTransport = {
    isConnected: () => this.connected(),
    join: (id) => this.connection!.invoke<DocumentJoin>('JoinDocument', id),
    leave: (id) => this.connection!.invoke('LeaveDocument', id),
    sendUpdate: (id, update) => this.connection!.invoke('SendUpdate', id, update),
    sendAwareness: (id, payload) => this.connection!.invoke('SendAwareness', id, payload),
    compact: (id, count, generation, merged) =>
      this.connection!.invoke<boolean>('CompactDocument', id, count, generation, merged),
  };

  private connected() {
    return this.isState('Connected');
  }

  /** Bağlantı varsa SignalR yüklenmiştir; durum adları kütüphanenin enum'undan okunur. */
  private isState(state: keyof typeof HubConnectionState) {
    return !!signalR && this.connection?.state === signalR.HubConnectionState[state];
  }

  private async connect() {
    if (!this.connection || this.stopped) return;
    useRealtime.setState({ status: 'connecting' });
    try {
      await this.connection.start();
      await this.afterConnect(false);
    } catch {
      useRealtime.setState({ status: 'offline' });
      this.scheduleRetry(10_000);
    }
  }

  /** Sunucuya yeniden ulaşıldı: bağlantı kopuksa beklemeden yeniden dene. */
  retryNow() {
    if (!this.stopped && this.isState('Disconnected')) {
      if (this.retryTimer) clearTimeout(this.retryTimer);
      this.retryTimer = null;
      void this.connect();
    }
  }

  private scheduleRetry(delay: number) {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      if (!this.stopped && this.isState('Disconnected')) void this.connect();
    }, delay);
  }

  private async afterConnect(reconnected: boolean) {
    useRealtime.setState({ status: 'connected' });
    if (reconnected) {
      // Bağlantı yokken gelen olaylar kaçtı; görünen her şey tazelenir.
      await this.connection?.invoke('RefreshGroups').catch(() => undefined);
      void this.queryClient.invalidateQueries();
    }
    await this.join();
    collabManager.setTransport(this.collabTransport);
    collabManager.connected();
  }

  private async join() {
    if (!this.connected() || !this.workspaceId) return;
    const workspaceId = this.workspaceId;
    try {
      const snapshot = await this.connection!.invoke<PresenceSnapshot>('JoinWorkspace', workspaceId);
      if (workspaceId !== this.workspaceId) return;
      useRealtime.setState({ presence: snapshot });
      if (this.requestId) await this.connection!.invoke('ViewRequest', this.requestId);
    } catch {
      // Erişim yoksa (ör. az önce çıkarıldı) workspace listesi yenilenince başka workspace seçilir.
      useRealtime.setState({ presence: null });
    }
  }

  private refreshTeams() {
    void this.queryClient.invalidateQueries({ queryKey: organizationsQueryKey });
    void this.queryClient.invalidateQueries({ queryKey: workspacesQueryKey });
  }

  private async onAccessChanged() {
    this.refreshTeams();
    void this.queryClient.invalidateQueries({ queryKey: myInvitationsQueryKey });
    await this.connection?.invoke('RefreshGroups').catch(() => undefined);
    await this.join();
  }

  private async onWorkspaceChanged(e: WorkspaceChangedEvent) {
    const invalidate = (queryKey: readonly unknown[]) =>
      void this.queryClient.invalidateQueries({ queryKey });
    // Etkinlik akışı ve sürüm listeleri kendi değişikliklerimizde de tazelenir.
    if (e.activity) {
      invalidate(activityQueryKey(e.workspaceId));
      invalidate(['versions']);
    }
    // Zamanlanmış monitör çalıştırmaları sunucudan gelir; durum ve geçmiş her zaman tazelenir.
    if (e.monitors) invalidate(monitorsQueryKey(e.workspaceId));
    if (e.runs) invalidate(['monitor-runs']);
    if (e.mergeRequests) {
      invalidate(mergeRequestsQueryKey(e.workspaceId));
      invalidate(['merge-request']);
    }
    // Fork karşılaştırmaları ve rozetleri iki tarafın değişikliğinde de eskir.
    if (e.collections) {
      invalidate(['forks']);
      invalidate(['fork-compare']);
      invalidate(['merge-request']);
    }
    // Kendi sekmemizin değişikliği: ekranın geri kalanı zaten güncel.
    if (e.actor.clientId === clientId) return;
    if (e.comments) {
      invalidate(['comments']);
      invalidate(commentCountsQueryKey(e.workspaceId));
    }
    if (e.collections) invalidate(collectionsQueryKey(e.workspaceId));
    if (e.environments) invalidate(environmentsQueryKey(e.workspaceId));
    if (e.runs) invalidate(['runs', e.workspaceId]);
    if (e.mocks) invalidate(mocksQueryKey(e.workspaceId));
    // Örnek eklenince/silinince mock'un uç noktaları değişir.
    if (e.collections) invalidate(['mock-routes']);
    if (e.workspace) {
      invalidate(workspacesQueryKey);
      invalidate(workspaceMembersKey(e.workspaceId));
      invalidate(globalsQueryKey(e.workspaceId));
    }
    for (const change of e.requests) await applyRemoteRequest(change, e.actor.displayName);
  }
}

/**
 * Başkasının kaydettiği istek açık sekmelere yansır: sekmede kaydedilmemiş değişiklik yoksa sessizce güncellenir,
 * varsa çakışma gösterilir ve kullanıcı seçer.
 */
export async function applyRemoteRequest(change: RequestChange, byName: string | null) {
  const affected = () =>
    useTabs
      .getState()
      .tabs.filter(
        (t) => t.requestId === change.id && t.saved && (change.deleted || t.saved.version < change.version),
      );
  if (affected().length === 0) return;

  const { setRemote, markSaved } = useTabs.getState();
  if (change.deleted) {
    for (const tab of affected()) setRemote(tab.id, { deleted: true, byName, request: null });
    return;
  }

  let latest;
  try {
    latest = await api.requests.get(change.id);
  } catch {
    return;
  }
  for (const tab of affected()) {
    // Ortak taslakta başkasının kaydı çakışma değildir: taslak korunur, yalnızca kaydedilen sürüm tazelenir.
    if (isDirty(tab) && !tab.collab) setRemote(tab.id, { deleted: false, byName, request: latest });
    else markSaved(tab.id, latest);
  }
}
