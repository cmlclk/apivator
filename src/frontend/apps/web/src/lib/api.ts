import { createApiClient } from '@apivator/core';
import { useSession } from '../stores/session';
import { isDesktop, keychainRefreshTokens } from './desktop';
import { localAgentWithSettings } from './networkSettings';
import { serverUrl } from './serverUrl';
import { isLocalMode, localSession } from './localMode';
import { clientId } from './clientId';
import { reportReachability } from './connectivity';

const desktop = isDesktop();

export const api = createApiClient({
  baseUrl: serverUrl,
  getAccessToken: () => useSession.getState().accessToken,
  clientId,
  onSession: (session) => useSession.getState().setSession(session),
  // Sunucuya ulaşılamazsa çevrimdışı moda geçilir (açılışta önceki oturumla); bağlantı gelince geri döner.
  onReachability: (reachable) => {
    reportReachability(reachable);
    if (!reachable) useSession.getState().setUnreachable();
  },
  // Masaüstünde istekler yerel ajanla yürütülür (localhost ve iç ağ); refresh token anahtar zincirinde durur.
  localAgent: desktop ? localAgentWithSettings : undefined,
  refreshTokens: desktop ? keychainRefreshTokens(serverUrl) : undefined,
  // Yerel modda giriş yok: oturum token'ı uygulamadan gelir.
  sessionSource: () => (isLocalMode() ? localSession() : null),
  // Oturum listesinde "Apivator Masaüstü" olarak görünür.
  app: desktop ? 'desktop' : undefined,
});
