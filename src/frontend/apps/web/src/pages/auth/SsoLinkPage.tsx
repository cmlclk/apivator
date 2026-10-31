import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Alert, Spinner } from '@apivator/ui';
import { ApiError } from '@apivator/core';
import { AuthLayout } from '../../components/AuthLayout';
import { translate, useT } from '../../i18n';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';

/** Bağlantı tek kullanımlık: çift efekt çalıştırması aynı belirteci ikinci kez harcamasın. */
let linking: { token: string; promise: Promise<void> } | null = null;

function linkOnce(token: string): Promise<void> {
  if (linking?.token !== token) {
    window.history.replaceState(null, '', window.location.pathname);
    const promise = api.auth.ssoLink(token);
    linking = { token, promise };
    const clear = () => {
      if (linking?.promise === promise) linking = null;
    };
    promise.then(clear, clear);
  }
  return linking.promise;
}

function readToken(): string | null {
  return new URLSearchParams(window.location.search).get('token');
}

/**
 * E-postadaki "hesabı SSO'ya bağla" bağlantısının açıldığı sayfa. Bağlantı oturum açmaz (iletilen bir bağlantı
 * başkasına oturum vermesin); bağlandıktan sonra kullanıcı SSO ile giriş yapar.
 */
export function SsoLinkPage() {
  const t = useT('auth');
  const invalid = translate('auth', 'ssoLink.invalid');
  const [token] = useState(readToken);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(token ? null : invalid);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    linkOnce(token).then(
      () => !cancelled && setDone(true),
      (e) => {
        if (cancelled) return;
        setError(e instanceof ApiError && e.code === 'sso.invalid_link' ? invalid : errorMessage(e));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [token, invalid]);

  if (error || done) {
    return (
      <AuthLayout title={done ? t('ssoLink.doneTitle') : t('ssoLink.failedTitle')}>
        <div className="flex flex-col gap-4">
          <Alert tone={done ? 'success' : 'error'}>{done ? t('ssoLink.done') : error}</Alert>
          <Link to="/login" replace className="text-sm font-medium text-accent hover:underline">
            {done ? t('ssoLink.toLogin') : t('backToLogin')}
          </Link>
        </div>
      </AuthLayout>
    );
  }
  return (
    <div className="flex h-full items-center justify-center text-fg-subtle" aria-label={t('ssoLink.linking')}>
      <Spinner className="h-6 w-6" />
    </div>
  );
}
