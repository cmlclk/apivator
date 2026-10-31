import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Alert, Button, Input } from '@apivator/ui';
import { AuthLayout } from '../../components/AuthLayout';
import { useT } from '../../i18n';
import { safeRedirect } from '../../lib/safeRedirect';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { useSession } from '../../stores/session';
import { ApiError, type AuthResult, type SsoDiscoveryDto } from '@apivator/core';
import { startSsoLogin } from '../../features/sso/ssoLogin';

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DISCOVER_DELAY_MS = 300;

/** Yazılan e-posta için SSO var mı? (yazmayı bıraktıktan sonra sorulur; hata sessizce yok sayılır) */
function useSsoDiscovery(email: string): SsoDiscoveryDto | null {
  const [found, setFound] = useState<{ email: string; result: SsoDiscoveryDto } | null>(null);
  useEffect(() => {
    const value = email.trim();
    if (!EMAIL_SHAPE.test(value)) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      Promise.resolve()
        .then(() => api.auth.ssoDiscover(value))
        .then(
          (result) => !cancelled && setFound({ email: value, result }),
          () => undefined,
        );
    }, DISCOVER_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [email]);
  return found?.email === email.trim() && found.result.available ? found.result : null;
}

export function LoginPage() {
  const t = useT('auth');
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const setSession = useSession((s) => s.setSession);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const unreachable = useSession((s) => s.unreachable);
  const [submitting, setSubmitting] = useState(false);
  /** İki adımlı doğrulama: şifre doğruysa sunucunun verdiği kısa ömürlü belirteç. */
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const discovery = useSsoDiscovery(email);
  /** Sunucu şifreyle girişi reddetti (auth.sso_required): bu e-posta için yalnızca SSO. */
  const [ssoRequired, setSsoRequired] = useState(false);
  const ssoOnly = ssoRequired || discovery?.enforced === true;
  const ssoAvailable = ssoOnly || discovery !== null;

  function finish(session: AuthResult) {
    setSession(session);
    navigate(safeRedirect(params.get('redirect')), { replace: true });
  }

  async function onSso() {
    setSubmitting(true);
    setError(null);
    try {
      const session = await startSsoLogin(email.trim(), params.get('redirect'));
      if (session) finish(session);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSubmitting(false);
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (ssoOnly) return onSso();
    setSubmitting(true);
    setError(null);
    try {
      const result = await api.auth.login({ email, password });
      if ('twoFactorRequired' in result) {
        setChallenge(result.challengeToken);
        setCode('');
      } else {
        finish(result);
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === 'auth.sso_required') setSsoRequired(true);
      setError(errorMessage(e));
    } finally {
      setSubmitting(false);
    }
  }

  async function onSubmitCode(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      finish(await api.auth.loginTwoFactor(challenge!, code));
    } catch (e) {
      if (e instanceof ApiError && e.code === 'auth.challenge_expired') {
        setChallenge(null);
        setPassword('');
      }
      setError(errorMessage(e));
      setCode('');
    } finally {
      setSubmitting(false);
    }
  }

  if (challenge) {
    return (
      <AuthLayout
        title={t('login.twoFactor.title')}
        subtitle={useRecovery ? t('login.twoFactor.subtitleRecovery') : t('login.twoFactor.subtitleTotp')}
      >
        <form onSubmit={onSubmitCode} className="flex flex-col gap-4" noValidate>
          {error && <Alert tone="error">{error}</Alert>}
          <Input
            key={useRecovery ? 'recovery' : 'totp'}
            label={useRecovery ? t('login.twoFactor.recoveryLabel') : t('login.twoFactor.codeLabel')}
            autoFocus
            autoComplete="one-time-code"
            inputMode={useRecovery ? 'text' : 'numeric'}
            placeholder={useRecovery ? 'abcde-fghjk' : '123456'}
            maxLength={useRecovery ? 11 : 7}
            className="font-mono tracking-widest"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <Button
            type="submit"
            loading={submitting}
            disabled={code.replace(/[^0-9a-z]/gi, '').length < (useRecovery ? 10 : 6)}
          >
            {t('login.twoFactor.submit')}
          </Button>
          <div className="flex justify-between text-xs">
            <button
              type="button"
              onClick={() => {
                setUseRecovery(!useRecovery);
                setCode('');
                setError(null);
              }}
              className="text-fg-muted hover:text-accent"
            >
              {useRecovery ? t('login.twoFactor.useTotp') : t('login.twoFactor.useRecovery')}
            </button>
            <button
              type="button"
              onClick={() => {
                setChallenge(null);
                setError(null);
              }}
              className="text-fg-muted hover:text-accent"
            >
              {t('login.twoFactor.back')}
            </button>
          </div>
        </form>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title={t('login.title')}
      subtitle={t.rich('login.noAccount', {
        link: (c) => (
          <Link
            to={
              params.get('redirect')
                ? `/register?redirect=${encodeURIComponent(params.get('redirect')!)}`
                : '/register'
            }
            className="font-medium text-accent hover:underline"
          >
            {c}
          </Link>
        ),
      })}
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        {error && <Alert tone="error">{error}</Alert>}
        {!error && unreachable && <Alert tone="warning">{t('login.unreachable')}</Alert>}
        <Input
          label={t('fields.email')}
          type="email"
          autoComplete="email"
          autoFocus
          required
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setSsoRequired(false);
          }}
        />
        {ssoOnly ? (
          <>
            <p className="text-[13px] text-fg-muted">
              {discovery?.organizationName
                ? t('login.ssoOnlyOrg', { organization: discovery.organizationName })
                : t('login.ssoOnly')}
            </p>
            <Button type="submit" loading={submitting} disabled={!EMAIL_SHAPE.test(email.trim())}>
              {t('login.sso')}
            </Button>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <Input
                label={t('fields.password')}
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <Link to="/forgot-password" className="self-end text-xs text-fg-muted hover:text-accent">
                {t('login.forgot')}
              </Link>
            </div>
            <Button type="submit" loading={submitting} disabled={!email || !password}>
              {t('login.submit')}
            </Button>
            {ssoAvailable && (
              <Button type="button" variant="secondary" loading={submitting} onClick={() => void onSso()}>
                {t('login.sso')}
              </Button>
            )}
          </>
        )}
      </form>
    </AuthLayout>
  );
}
