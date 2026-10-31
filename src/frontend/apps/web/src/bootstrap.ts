import { api } from './lib/api';
import { onReconnect, startConnectivity } from './lib/connectivity';
import { startOfflineCache } from './lib/offlineCache';
import { queryClient } from './lib/queryClient';
import { useSession } from './stores/session';
import { flushPendingSaves } from './features/requests/useRequestActions';

/**
 * Çevrimdışı çalışma: bağlantı izleme, kullanıcı başına kalıcı önbellek ve bağlantı geri gelince yapılacaklar
 * (oturumu yenile → çevrimdışıyken kaydedilenleri gönder → her şeyi tazele).
 */
export function bootstrapOffline() {
  startConnectivity();
  startOfflineCache(queryClient);
  onReconnect(() => {
    void (async () => {
      if (useSession.getState().status === 'offline') {
        // Oturum sunucuda sonlanmışsa istemci kendisi giriş ekranına döndürür; yine ulaşılamazsa çevrimdışı kalınır.
        if (!(await api.refreshSession())) return;
      }
      await flushPendingSaves(queryClient);
      await queryClient.invalidateQueries();
    })();
  });
}
