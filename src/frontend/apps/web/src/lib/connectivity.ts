import { create } from 'zustand';
import { onlineManager } from '@tanstack/react-query';
import { serverUrl } from './serverUrl';

/** Sunucu ulaşılamazken yeniden deneme aralığı. */
export const PROBE_INTERVAL_MS = 10_000;

interface ConnectivityState {
  /** Tarayıcı ağa bağlı mı (navigator.onLine). */
  browser: boolean;
  /** Son istekte sunucuya ulaşıldı mı. */
  server: boolean;
  /** Sunucuya en son ulaşılan an (çevrimdışı bandında gösterilir). */
  lastReachedAt: string | null;
}

const LAST_REACHED_KEY = 'apivator-last-reached';

function storedLastReached(): string | null {
  try {
    return localStorage.getItem(LAST_REACHED_KEY);
  } catch {
    return null;
  }
}

export const useConnectivity = create<ConnectivityState>(() => ({
  browser: typeof navigator === 'undefined' ? true : navigator.onLine,
  server: true,
  lastReachedAt: storedLastReached(),
}));

export const isOnline = (s: ConnectivityState = useConnectivity.getState()) => s.browser && s.server;

const reconnectListeners = new Set<() => void>();
let probeTimer: ReturnType<typeof setTimeout> | null = null;
let setQueryOnline: ((online: boolean) => void) | null = null;

/** Bağlantı (yeniden) gelince çağrılır: oturumu yenile, sorguları tazele, bekleyen kayıtları gönder. */
export function onReconnect(listener: () => void): () => void {
  reconnectListeners.add(listener);
  return () => reconnectListeners.delete(listener);
}

function update(change: Partial<ConnectivityState>) {
  const before = isOnline();
  useConnectivity.setState(change);
  const after = isOnline();
  // React Query çevrimdışıyken sorguları duraklatır, gelince kaldığı yerden sürdürür.
  setQueryOnline?.(after);
  if (!after) scheduleProbe();
  if (!before && after) for (const listener of [...reconnectListeners]) listener();
}

/** API istemcisinden: ağ hatasında false, herhangi bir yanıtta true. */
export function reportReachability(reachable: boolean) {
  const state = useConnectivity.getState();
  if (reachable) {
    if (!state.server || !state.lastReachedAt || Date.now() - Date.parse(state.lastReachedAt) > 5_000) {
      const now = new Date().toISOString();
      try {
        localStorage.setItem(LAST_REACHED_KEY, now);
      } catch {
        // Yalnızca bilgi amaçlı.
      }
      update({ server: true, lastReachedAt: now });
    }
  } else if (state.server) {
    update({ server: false });
  }
}

/** Sunucuyu oturumsuz bir uçla yoklar. */
export async function probe(): Promise<boolean> {
  try {
    const response = await fetch(`${serverUrl()}/api/ping`, { cache: 'no-store', credentials: 'omit' });
    const ok = response.status < 502 || response.status > 504;
    reportReachability(ok);
    return ok;
  } catch {
    reportReachability(false);
    return false;
  }
}

function scheduleProbe() {
  if (probeTimer || isOnline()) return;
  probeTimer = setTimeout(() => {
    probeTimer = null;
    if (!useConnectivity.getState().browser) {
      scheduleProbe();
      return;
    }
    void probe().then((ok) => {
      if (!ok) scheduleProbe();
    });
  }, PROBE_INTERVAL_MS);
}

let started = false;

/** Tarayıcı olaylarını ve React Query'nin çevrimiçi durumunu bağlar; uygulama açılışında bir kez. */
export function startConnectivity() {
  if (started || typeof window === 'undefined') return;
  started = true;
  onlineManager.setEventListener((setOnline) => {
    setQueryOnline = setOnline;
    setOnline(isOnline());
    return () => {
      setQueryOnline = null;
    };
  });
  window.addEventListener('online', () => {
    update({ browser: true });
    // Ağ geldi; sunucunun da ulaşılabilir olduğunu hemen yokla (beklemeden).
    void probe();
  });
  window.addEventListener('offline', () => update({ browser: false }));
}

/** Testler için. */
export function resetConnectivity() {
  if (probeTimer) clearTimeout(probeTimer);
  probeTimer = null;
  reconnectListeners.clear();
  useConnectivity.setState({ browser: true, server: true, lastReachedAt: null });
}
