import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { OAUTH_CHANNEL, OAUTH_MESSAGE, type OAuthCallbackMessage } from '../features/oauth/oauthFlow';

/**
 * OAuth sağlayıcısının yönlendirdiği sayfa (açılır pencerede açılır). Kodu ana pencereye iletir ve kapanır.
 * Oturum gerektirmez; kod tek başına işe yaramaz (PKCE doğrulayıcısı ana penceredeki bellekte).
 */
export function OAuthCallbackPage() {
  const t = useT('team');
  const [delivered, setDelivered] = useState<boolean | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const message: OAuthCallbackMessage = {
      type: OAUTH_MESSAGE,
      state: params.get('state'),
      code: params.get('code'),
      error: params.get('error'),
      errorDescription: params.get('error_description'),
    };
    let sent = false;
    if (window.opener && !window.opener.closed) {
      (window.opener as Window).postMessage(message, window.location.origin);
      sent = true;
    }
    if ('BroadcastChannel' in window) {
      const channel = new BroadcastChannel(OAUTH_CHANNEL);
      channel.postMessage(message);
      channel.close();
      sent = true;
    }
    setDelivered(sent);
    // Ana pencere de kapatır; tarayıcı izin vermezse kullanıcı kapatır.
    const timer = setTimeout(() => window.close(), 300);
    return () => clearTimeout(timer);
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg p-8 text-center text-sm text-fg-muted">
      {delivered === false ? t('oauthCallback.failed') : t('oauthCallback.done')}
    </main>
  );
}
