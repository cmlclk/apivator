import type { CollabSession, CollabTransport, CollabUser, DraftPort } from './CollabSession';
import { clearCollab, patchCollab } from './collabStore';
import { useTabs, type RequestTab } from '../requests/tabsStore';

// Yjs ve oturum kodu (~100 KB) ana pakete girmez; ilk oturum gerektiğinde yüklenir.
let sessionModule: typeof import('./CollabSession') | null = null;
let loading: Promise<void> | null = null;

/**
 * Açık, kayıtlı istek sekmelerinin ortak düzenleme oturumları. Canlı kanal bağlıyken her kayıtlı isteğin sekmesi
 * hub'daki belgesine katılır; sekme kapanınca ya da kanal kopunca oturum ona göre sürer/biter.
 */
class CollabManager {
  private readonly sessions = new Map<string, CollabSession>();
  private transport: CollabTransport | null = null;
  private user: CollabUser | null = null;
  private unsubscribe: (() => void) | null = null;

  /** Canlı kanal hazır olunca (ya da kopunca null) çağrılır. */
  setTransport(transport: CollabTransport | null) {
    this.transport = transport;
    if (!transport) return;
    this.unsubscribe ??= useTabs.subscribe((state, prev) => {
      if (signature(state.tabs) !== signature(prev.tabs)) this.reconcile();
    });
    this.reconcile();
  }

  setUser(user: CollabUser | null) {
    if (this.user?.id === user?.id) return;
    this.user = user;
    this.disposeAll();
    this.reconcile();
  }

  /** Bağlantı kurulunca/yeniden kurulunca: mevcut oturumlar kaçanları alır, yeni sekmeler katılır. */
  connected() {
    for (const session of this.sessions.values()) void session.rejoin();
    this.reconcile();
  }

  stop() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.transport = null;
    this.disposeAll();
  }

  session(tabId: string): CollabSession | undefined {
    return this.sessions.get(tabId);
  }

  onUpdate(requestId: string, update: string) {
    this.byRequest(requestId)?.receive(update);
  }

  onAwareness(requestId: string, payload: string, sender: { userId: string; name: string }) {
    this.byRequest(requestId)?.receiveAwareness(payload, sender);
  }

  onRevoked(requestId: string) {
    this.byRequest(requestId)?.revoked();
  }

  onAccess(requestId: string, canEdit: boolean) {
    this.byRequest(requestId)?.setCanEdit(canEdit);
  }

  private byRequest(requestId: string) {
    return [...this.sessions.values()].find((s) => s.requestId === requestId);
  }

  private reconcile() {
    const transport = this.transport;
    const user = this.user;
    const wanted = new Map<string, RequestTab>();
    if (transport?.isConnected() && user) {
      for (const tab of useTabs.getState().tabs) {
        if (tab.requestId && tab.saved && !tab.pendingSave) wanted.set(tab.id, tab);
      }
    }
    for (const [tabId, session] of [...this.sessions]) {
      if (wanted.get(tabId)?.requestId !== session.requestId) this.dispose(tabId, session);
    }
    if (wanted.size && !sessionModule) {
      // Yüklenince istenen sekmeler o anki duruma göre yeniden hesaplanır.
      loading ??= import('./CollabSession').then(
        (m) => {
          sessionModule = m;
          this.reconcile();
        },
        () => {
          // Ortak düzenleme olmadan da editör çalışır; sonraki uzlaştırmada yeniden denenir.
          loading = null;
        },
      );
      return;
    }
    for (const [tabId, tab] of wanted) {
      if (!this.sessions.has(tabId)) this.create(sessionModule!, tab, transport!, user!);
    }
  }

  private create(
    { CollabSession }: typeof import('./CollabSession'),
    tab: RequestTab,
    transport: CollabTransport,
    user: CollabUser,
  ) {
    const tabId = tab.id;
    const session = new CollabSession(tab.requestId!, transport, portFor(tabId), user, {
      onStatus: (status) => {
        patchCollab(tabId, { status });
        useTabs.getState().setCollab(tabId, status === 'live' || status === 'readonly');
      },
      onPeers: (peers) => patchCollab(tabId, { peers }),
    });
    this.sessions.set(tabId, session);
    patchCollab(tabId, { status: 'joining', peers: [] });
    void session.start();
  }

  private dispose(tabId: string, session: CollabSession) {
    session.dispose();
    this.sessions.delete(tabId);
    clearCollab(tabId);
    useTabs.getState().setCollab(tabId, false);
  }

  private disposeAll() {
    for (const [tabId, session] of [...this.sessions]) this.dispose(tabId, session);
  }
}

/** Hangi sekmelerin oturum gerektirdiğini belirleyen özet: değişmedikçe uzlaştırma çalışmaz. */
function signature(tabs: RequestTab[]): string {
  return tabs
    .map((t) => `${t.id}:${t.requestId ?? ''}:${t.saved ? 1 : 0}:${t.pendingSave ? 1 : 0}`)
    .join('|');
}

function portFor(tabId: string): DraftPort {
  const find = () => useTabs.getState().tabs.find((t) => t.id === tabId);
  return {
    getDraft: () => find()!.draft,
    getSaved: () => find()?.saved?.definition ?? null,
    setDraft: (definition) => useTabs.getState().setDraft(tabId, definition),
    subscribe: (listener) =>
      useTabs.subscribe((state, prev) => {
        const tab = state.tabs.find((t) => t.id === tabId);
        const before = prev.tabs.find((t) => t.id === tabId);
        if (tab && before && tab.draft !== before.draft) listener(tab.draft);
      }),
  };
}

export const collabManager = new CollabManager();
