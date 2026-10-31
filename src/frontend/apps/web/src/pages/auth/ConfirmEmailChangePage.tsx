import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Alert, Spinner } from '@apivator/ui';
import { AuthLayout } from '../../components/AuthLayout';
import { translate, useT } from '../../i18n';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { useSession } from '../../stores/session';

type State = { kind: 'pending' } | { kind: 'done'; email: string } | { kind: 'error'; message: string };

/** E-posta değişikliğinin doğrulama bağlantısı (yeni adrese gönderilir). */
export function ConfirmEmailChangePage() {
  const t = useT('auth');
  const [params] = useSearchParams();
  const status = useSession((s) => s.status);
  const [state, setState] = useState<State>({ kind: 'pending' });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const userId = params.get('userId');
    const email = params.get('email');
    const token = params.get('token');
    if (!userId || !email || !token) {
      setState({ kind: 'error', message: translate('auth', 'verifyLinkInvalid') });
      return;
    }

    api.account
      .confirmEmailChange(userId, email, token)
      .then(() => {
        setState({ kind: 'done', email });
        const { user, setUser } = useSession.getState();
        if (user?.id === userId) setUser({ ...user, email, emailConfirmed: true });
      })
      .catch((e: unknown) => setState({ kind: 'error', message: errorMessage(e) }));
  }, [params]);

  const next =
    status === 'authenticated'
      ? { to: '/account', label: t('confirmEmailChange.toAccount') }
      : { to: '/login', label: t('confirmEmailChange.toLogin') };

  return (
    <AuthLayout title={t('confirmEmailChange.title')}>
      {state.kind === 'pending' && (
        <div className="flex items-center gap-2 text-sm text-fg-muted">
          <Spinner className="h-4 w-4" /> {t('verifying')}
        </div>
      )}
      {state.kind === 'done' && (
        <Alert tone="success">
          {t.rich('confirmEmailChange.done', { b: (c) => <strong>{c}</strong> }, { email: state.email })}
        </Alert>
      )}
      {state.kind === 'error' && <Alert tone="error">{state.message}</Alert>}
      {state.kind !== 'pending' && (
        <Link to={next.to} className="mt-4 inline-block text-sm font-medium text-accent hover:underline">
          {next.label}
        </Link>
      )}
    </AuthLayout>
  );
}
