import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { RealtimeClient } from '../lib/realtime';
import { onReconnect } from '../lib/connectivity';
import { useWorkspaces } from '../lib/useWorkspaces';
import { useTabs } from '../features/requests/tabsStore';
import { collabManager } from '../features/collab/collabManager';
import { useSession } from '../stores/session';

/** Canlı kanalı oturum boyunca açık tutar; seçili workspace'i ve etkin sekmedeki isteği sunucuya bildirir. */
export function RealtimeBridge() {
  const queryClient = useQueryClient();
  const { current } = useWorkspaces();
  const clientRef = useRef<RealtimeClient | null>(null);
  const activeRequestId = useTabs((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    return tab && tab.workspaceId === current?.id ? tab.requestId : null;
  });

  useEffect(() => {
    const client = new RealtimeClient(queryClient);
    clientRef.current = client;
    client.start();
    // Çevrimdışıyken kopan kanal, sunucuya yeniden ulaşılınca hemen kurulur.
    const unsubscribe = onReconnect(() => client.retryNow());
    return () => {
      unsubscribe();
      client.stop();
      clientRef.current = null;
    };
  }, [queryClient]);

  const user = useSession((s) => s.user);
  useEffect(() => {
    collabManager.setUser(user ? { id: user.id, name: user.displayName } : null);
  }, [user?.id, user?.displayName]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    clientRef.current?.setWorkspace(current?.id ?? null);
  }, [current?.id]);

  useEffect(() => {
    clientRef.current?.setViewing(activeRequestId);
  }, [activeRequestId]);

  return null;
}
