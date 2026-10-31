import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Alert, Spinner } from '@apivator/ui';
import { SSO_LINK_SENT, type AuthResult } from '@apivator/core';
import { AuthLayout } from '../../components/AuthLayout';
import { translate, useT } from '../../i18n';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { safeRedirect } from '../../lib/safeRedirect';
import { useSession } from '../../stores/session';
import {
  SSO_REDIRECT_KEY,
  SSO_VERIFIER_KEY,
  ssoErrorMessage,
  ssoLinkSentMessage,
} from '../../features/sso/ssoLogin';

interface Outcome {
  tone: 'error' | 'info';
  message: string;
}

interface CallbackInput {
  code: string | null;
  verifier: string | null;
  outcome: Outcome | null;
}

function readStorage(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function readCallback(): CallbackInput {
  const params = new URLSearchParams(window.location.search);
  const failure = params.get('error');
  const code = params.get('code');
  const verifier = readStorage(SSO_VERIFIER_KEY);
  if (failure === SSO_LINK_SENT)
    return { code, verifier, outcome: { tone: 'info', message: ssoLinkSentMessage() } };
  if (failure) return { code, verifier, outcome: { tone: 'error', message: ssoErrorMessage(failure) } };
  if (!code) return { code, verifier, outcome: { tone: 'error', message: ssoErrorMessage('') } };
  if (!verifier) {
    return {
      code,
      verifier,
      outcome: { tone: 'error', message: translate('auth', 'ssoCallback.notStarted') },
    };
  }
  return { code, verifier, outcome: null };
}

/** Kod tek kullanımlık: React'in çift efekt çalıştırması aynı kodu ikinci kez harcamasın. */
let exchange: { code: string; promise: Promise<AuthResult> } | null = null;

function exchangeOnce(code: string, verifier: string): Promise<AuthResult> {
  if (exchange?.code !== code) {
    // Kod adres çubuğunda ve geçmişte kalmasın; doğrulayıcı da tek kullanımlık.
    window.history.replaceState(null, '', window.location.pathname);
    try {
      sessionStorage.removeItem(SSO_VERIFIER_KEY);
    } catch {
      // Depolama yoksa yapılacak bir şey yok.
    }
    const promise = api.auth.ssoExchange(code, verifier);
    exchange = { code, promise };
    // Çözüldükten sonra önbellek tutulmaz: aynı adres yeniden açılınca eski oturum dönmesin.
    const clear = () => {
      if (exchange?.promise === promise) exchange = null;
    };
    promise.then(clear, clear);
  }
  return exchange.promise;
}

function savedRedirect(): string {
  try {
    const value = sessionStorage.getItem(SSO_REDIRECT_KEY);
    sessionStorage.removeItem(SSO_REDIRECT_KEY);
    return safeRedirect(value);
  } catch {
    return '/';
  }
}

/**
 * Kimlik sağlayıcıdan dönen tarayıcının açıldığı sayfa: ?code= tek kullanımlık giriş kodunu, bu tarayıcıda
 * saklanan doğrulayıcıyla oturuma çevirir; ?error=sso_<neden> okunur bir mesaj gösterir.
 * Oturum açılışını (SessionBoot) beklemez.
 */
export function SsoCallbackPage() {
  const t = useT('auth');
  const navigate = useNavigate();
  const setSession = useSession((s) => s.setSession);
  const [input] = useState(readCallback);
  const [failure, setFailure] = useState<Outcome | null>(input.outcome);

  useEffect(() => {
    // Kod/hata adres çubuğunda ve geçmişte kalmasın.
    if (window.location.search) window.history.replaceState(null, '', window.location.pathname);
    if (input.outcome || !input.code || !input.verifier) return;
    let cancelled = false;
    exchangeOnce(input.code, input.verifier).then(
      (session) => {
        if (cancelled) return;
        setSession(session);
        navigate(savedRedirect(), { replace: true });
      },
      (e) => !cancelled && setFailure({ tone: 'error', message: errorMessage(e) }),
    );
    return () => {
      cancelled = true;
    };
  }, [input, navigate, setSession]);

  if (failure) {
    return (
      <AuthLayout title={failure.tone === 'info' ? t('ssoCallback.checkEmail') : t('ssoCallback.failed')}>
        <div className="flex flex-col gap-4">
          <Alert tone={failure.tone}>{failure.message}</Alert>
          <Link to="/login" replace className="text-sm font-medium text-accent hover:underline">
            {t('backToLogin')}
          </Link>
        </div>
      </AuthLayout>
    );
  }
  return (
    <div
      className="flex h-full items-center justify-center text-fg-subtle"
      aria-label={t('ssoCallback.signingIn')}
    >
      <Spinner className="h-6 w-6" />
    </div>
  );
}
