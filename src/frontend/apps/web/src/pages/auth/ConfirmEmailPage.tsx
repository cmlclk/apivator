import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Alert, Spinner } from '@apivator/ui';
import { AuthLayout } from '../../components/AuthLayout';
import { translate, useT } from '../../i18n';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { useSession } from '../../stores/session';

type State = { kind: 'pending' } | { kind: 'done' } | { kind: 'error'; message: string };

export function ConfirmEmailPage() {
  const t = useT('auth');
  const [params] = useSearchParams();
  const status = useSession((s) => s.status);
  const [state, setState] = useState<State>({ kind: 'pending' });
  const started = useRef(false);

  useEffect(() => {
    // StrictMode'da efekt iki kez çalışır; token tek kullanımlık olduğu için isteği bir kez gönderiyoruz.
    if (started.current) return;
    started.current = true;

    const userId = params.get('userId');
    const token = params.get('token');
    if (!userId || !token) {
      setState({ kind: 'error', message: translate('auth', 'verifyLinkInvalid') });
      return;
    }

    api.auth
      .confirmEmail(userId, token)
      .then(() => {
        setState({ kind: 'done' });
        const { user, setUser } = useSession.getState();
        if (user?.id === userId) setUser({ ...user, emailConfirmed: true });
      })
      .catch((e: unknown) => setState({ kind: 'error', message: errorMessage(e) }));
  }, [params]);

  const next =
    status === 'authenticated'
      ? { to: '/', label: t('confirmEmail.toApp') }
      : { to: '/login', label: t('confirmEmail.toLogin') };

  return (
    <AuthLayout title={t('confirmEmail.title')}>
      {state.kind === 'pending' && (
        <div className="flex items-center gap-2 text-sm text-fg-muted">
          <Spinner className="h-4 w-4" /> {t('verifying')}
        </div>
      )}
      {state.kind === 'done' && <Alert tone="success">{t('confirmEmail.done')}</Alert>}
      {state.kind === 'error' && <Alert tone="error">{state.message}</Alert>}
      {state.kind !== 'pending' && (
        <Link to={next.to} className="mt-4 inline-block text-sm font-medium text-accent hover:underline">
          {next.label}
        </Link>
      )}
    </AuthLayout>
  );
}
